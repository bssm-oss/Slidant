"""
CRDT 서비스 — 프레젠테이션당 Y.Doc 관리.

역할 분리:
  - CRDT: 사용자 간 실시간 동시 편집 동기화
  - 에이전트 충돌: ConflictResolver가 별도 처리 (Git-style 병합 선택)
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import TYPE_CHECKING

import pycrdt

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("slidant.crdt")

_docs: dict[str, pycrdt.Doc] = {}
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_dirty: set[str] = set()


def _lock(project_id: str) -> asyncio.Lock:
    return _locks[project_id]


# ── Y.Doc 초기화 ──────────────────────────────────────────────────────────────

async def get_or_create_doc(project_id: str, session: "AsyncSession") -> pycrdt.Doc:
    if project_id in _docs:
        return _docs[project_id]

    async with _lock(project_id):
        if project_id in _docs:
            return _docs[project_id]

        from app.repositories.project import ProjectRepository
        from app.repositories.slide import SlideRepository

        proj_repo = ProjectRepository(session)
        slide_repo = SlideRepository(session)

        project = await proj_repo.get(project_id)
        doc = pycrdt.Doc()

        if project and getattr(project, "yjs_state", None):
            doc.apply_update(project.yjs_state)
            logger.info("crdt_load  project=%s  bytes=%d", project_id, len(project.yjs_state))
        else:
            slides = await slide_repo.list_by_project(project_id)
            slides_map = doc.get("slides", type=pycrdt.Map)
            # 슬라이드 Map 먼저 생성
            with doc.transaction():
                for slide in sorted(slides, key=lambda s: s.order):
                    slides_map[str(slide.id)] = pycrdt.Map()
            # 내용 채우기
            with doc.transaction():
                for slide in sorted(slides, key=lambda s: s.order):
                    slides_map[str(slide.id)]["html_content"] = pycrdt.Text(slide.html_content or "")
                    slides_map[str(slide.id)]["title"] = pycrdt.Text(slide.title or "")
            logger.info("crdt_init  project=%s  slides=%d", project_id, len(slides))

        _docs[project_id] = doc
        return doc


def get_doc(project_id: str) -> pycrdt.Doc | None:
    return _docs.get(project_id)


# ── Yjs 동기화 프로토콜 ───────────────────────────────────────────────────────
# 모든 메시지는 첫 바이트가 YMessageType.SYNC(=0).
# handle_sync_message는 이 바이트를 제거한 inner 메시지를 받음.

def make_initial_sync(project_id: str) -> bytes:
    """연결 시 클라이언트에게 보낼 SYNC_STEP1 메시지 (서버 state vector)."""
    doc = _docs.get(project_id)
    if not doc:
        doc = pycrdt.Doc()
    return pycrdt.create_sync_message(doc)  # [SYNC][STEP1][sv]


def make_full_update(project_id: str) -> bytes:
    """서버 전체 상태 update 메시지."""
    doc = _docs.get(project_id)
    if not doc:
        return pycrdt.create_update_message(pycrdt.Doc().get_update())
    return pycrdt.create_update_message(doc.get_update())  # [SYNC][UPDATE][data]


def handle_client_message(project_id: str, raw: bytes) -> bytes | None:
    """
    클라이언트에서 받은 binary 메시지 처리.
    Returns: 다른 클라이언트에게 relay할 bytes (없으면 None).
    """
    doc = _docs.get(project_id)
    if not doc:
        return None

    # 첫 바이트(YMessageType.SYNC) 제거 후 처리
    inner = raw[1:] if raw else b""
    if not inner:
        return None

    try:
        reply = pycrdt.handle_sync_message(inner, doc)
    except Exception as e:
        logger.warning("crdt_handle_fail  project=%s  err=%s", project_id, e)
        return None

    msg_type = inner[0] if inner else -1
    if msg_type == pycrdt.YSyncMessageType.SYNC_STEP1:
        # reply = STEP2 (서버가 가진 update) → 요청한 클라이언트에게만 전송
        return reply  # 다른 peers에게 relay 불필요

    if msg_type in (pycrdt.YSyncMessageType.SYNC_STEP2, pycrdt.YSyncMessageType.SYNC_UPDATE):
        # 클라이언트가 새 update 보냄 → doc 적용됨, 나머지 peers에 relay
        _dirty.add(project_id)
        return raw  # relay: 원본 그대로

    return None


# ── 에이전트 → Y.Doc 업데이트 ────────────────────────────────────────────────
# 에이전트 충돌은 이 레이어가 아니라 ConflictResolver에서 처리.
# 여기서는 에이전트 결과를 Y.Doc에 기록만 함.

def apply_agent_html(project_id: str, slide_id: str, html: str) -> bytes | None:
    """
    에이전트가 생성한 HTML을 Y.Doc에 기록.
    Returns: 클라이언트에 broadcast할 update 메시지 bytes.
    """
    doc = _docs.get(project_id)
    if not doc:
        return None

    slides_map = doc.get("slides", type=pycrdt.Map)
    if str(slide_id) not in slides_map:
        logger.warning("crdt_agent_html  slide %s not in doc %s", slide_id, project_id)
        return None

    with doc.transaction():
        text: pycrdt.Text = slides_map[str(slide_id)]["html_content"]
        text.clear()          # pycrdt Text: clear() replaces delete(0, len)
        text.insert(0, html)

    _dirty.add(project_id)
    full_update = doc.get_update()
    return pycrdt.create_update_message(full_update)  # [SYNC][UPDATE][data]


def add_slide_to_doc(project_id: str, slide_id: str, html: str = "", title: str = "") -> bytes | None:
    doc = _docs.get(project_id)
    if not doc:
        return None
    slides_map = doc.get("slides", type=pycrdt.Map)
    with doc.transaction():
        slides_map[str(slide_id)] = pycrdt.Map()
    with doc.transaction():
        slides_map[str(slide_id)]["html_content"] = pycrdt.Text(html)
        slides_map[str(slide_id)]["title"] = pycrdt.Text(title)
    _dirty.add(project_id)
    return pycrdt.create_update_message(doc.get_update())


# ── DB 영속화 ─────────────────────────────────────────────────────────────────

async def flush_dirty(session: "AsyncSession") -> None:
    if not _dirty:
        return
    dirty_now = set(_dirty)
    _dirty.clear()

    from app.repositories.project import ProjectRepository
    repo = ProjectRepository(session)

    for project_id in dirty_now:
        doc = _docs.get(project_id)
        if not doc:
            continue
        try:
            state = doc.get_update()
            await repo.update_yjs_state(project_id, state)
            logger.debug("crdt_flush  project=%s  bytes=%d", project_id, len(state))
        except Exception as e:
            logger.error("crdt_flush_fail  project=%s  err=%s", project_id, e)
            _dirty.add(project_id)


async def evict(project_id: str, session: "AsyncSession") -> None:
    await flush_dirty(session)
    _docs.pop(project_id, None)
    _locks.pop(project_id, None)
