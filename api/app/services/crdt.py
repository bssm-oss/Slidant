"""
CRDT 서비스 — 컴포넌트 레벨 Y.Map 구조.

Y.Doc 구조:
  slides: Y.Map<slide_id>
    └── {slide_id}: Y.Map
        ├── style:      Y.Text          (CSS block)
        ├── title:      Y.Text
        └── components: Y.Map<component_id>
            └── {cid}: Y.Map
                ├── html:  Y.Text       (element outerHTML)
                └── order: Y.Number     (render order)

역할 분리:
  - CRDT: 사용자 간 / 에이전트 간 컴포넌트 단위 동시 편집 동기화
  - 충돌: 같은 component_id에 복수 에이전트가 동시 write → ConflictResolver
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import TYPE_CHECKING

import pycrdt

from app.services.slide_parser import parse_slide_html, render_slide_html

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("slidant.crdt")

_docs: dict[str, pycrdt.Doc] = {}
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_dirty: set[str] = set()

# 컴포넌트 단위 agent 점유 추적 (충돌 감지용)
# {project_id: {slide_id: {component_id: agent_name}}}
_component_locks: dict[str, dict[str, dict[str, str]]] = defaultdict(lambda: defaultdict(dict))


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
            _init_doc_from_slides(doc, slides)
            logger.info("crdt_init  project=%s  slides=%d", project_id, len(slides))

        _docs[project_id] = doc
        return doc


def _init_doc_from_slides(doc: pycrdt.Doc, slides: list) -> None:
    """기존 슬라이드 DB 데이터 → Y.Doc 초기화."""
    slides_map = doc.get("slides", type=pycrdt.Map)

    for slide in sorted(slides, key=lambda s: s.order):
        sid = str(slide.id)
        html = slide.html_content or ""
        parsed = parse_slide_html(html)

        with doc.transaction():
            slide_map = pycrdt.Map()
            slides_map[sid] = slide_map

        orphans_html = "".join(parsed.get("orphans", []))
        with doc.transaction():
            slides_map[sid]["style"] = pycrdt.Text(parsed["style"])
            slides_map[sid]["title"] = pycrdt.Text(slide.title or "")
            slides_map[sid]["orphans"] = pycrdt.Text(orphans_html)  # <script> 등 보존

        # components Y.Map
        with doc.transaction():
            comp_map = pycrdt.Map()
            slides_map[sid]["components"] = comp_map

        for cid, comp in parsed["components"].items():
            with doc.transaction():
                c = pycrdt.Map()
                comp_map[cid] = c
            with doc.transaction():
                comp_map[cid]["html"] = pycrdt.Text(comp["html"])
                comp_map[cid]["order"] = comp["order"]


def get_doc(project_id: str) -> pycrdt.Doc | None:
    return _docs.get(project_id)


# ── HTML 재조립 ───────────────────────────────────────────────────────────────

def get_slide_html(project_id: str, slide_id: str) -> str | None:
    """Y.Doc에서 슬라이드 컴포넌트 → HTML 재조립."""
    doc = _docs.get(project_id)
    if not doc:
        return None
    slides_map = doc.get("slides", type=pycrdt.Map)
    if str(slide_id) not in slides_map:
        return None

    slide_map = slides_map[str(slide_id)]
    style = str(slide_map.get("style", pycrdt.Text("")))
    orphans_text = str(slide_map.get("orphans", pycrdt.Text("")))
    orphans = [orphans_text] if orphans_text else []

    comp_map = slide_map.get("components")
    if not comp_map:
        return render_slide_html(style, {}, orphans)

    components = {}
    for cid in list(comp_map.keys()):
        c = comp_map[cid]
        components[cid] = {
            "html": str(c.get("html", pycrdt.Text(""))),
            "order": c.get("order", 0),
        }

    return render_slide_html(style, components, orphans)


# ── 에이전트 → Y.Doc 컴포넌트 업데이트 ────────────────────────────────────────

def apply_agent_html(
    project_id: str,
    slide_id: str,
    html: str,
    agent_name: str = "",
) -> tuple[bytes | None, list[str]]:
    """
    에이전트 생성 HTML → 컴포넌트별 Y.Map 업데이트.

    Returns:
        (update_bytes, conflicted_component_ids)
        conflicted_component_ids: 다른 에이전트가 이미 점유 중인 컴포넌트 목록
    """
    doc = _docs.get(project_id)
    if not doc:
        return None, []

    slides_map = doc.get("slides", type=pycrdt.Map)
    sid = str(slide_id)

    parsed = parse_slide_html(html)
    new_style = parsed["style"]
    new_components = parsed["components"]
    new_orphans = "".join(parsed.get("orphans", []))

    # 충돌 감지: 같은 컴포넌트를 다른 에이전트가 이미 점유 중?
    slide_locks = _component_locks[project_id][sid]
    conflicted = [
        cid for cid in new_components
        if cid in slide_locks and slide_locks[cid] != agent_name
    ]

    # 슬라이드 없으면 생성
    if sid not in slides_map:
        with doc.transaction():
            slides_map[sid] = pycrdt.Map()
        with doc.transaction():
            slides_map[sid]["style"] = pycrdt.Text(new_style)
            slides_map[sid]["title"] = pycrdt.Text("")
            slides_map[sid]["components"] = pycrdt.Map()

    slide_map = slides_map[sid]

    # style + orphans 업데이트
    with doc.transaction():
        style_text: pycrdt.Text = slide_map.get("style", pycrdt.Text(""))
        style_text.clear()
        style_text.insert(0, new_style)
    with doc.transaction():
        orphan_text: pycrdt.Text = slide_map.get("orphans", pycrdt.Text(""))
        if orphan_text is not None:
            orphan_text.clear()
            orphan_text.insert(0, new_orphans)

    # 컴포넌트 업데이트
    comp_map = slide_map.get("components")
    if comp_map is None:
        with doc.transaction():
            slide_map["components"] = pycrdt.Map()
        comp_map = slide_map["components"]

    for cid, comp in new_components.items():
        if cid not in comp_map:
            with doc.transaction():
                comp_map[cid] = pycrdt.Map()
            with doc.transaction():
                comp_map[cid]["html"] = pycrdt.Text(comp["html"])
                comp_map[cid]["order"] = comp["order"]
        else:
            with doc.transaction():
                html_text: pycrdt.Text = comp_map[cid].get("html", pycrdt.Text(""))
                html_text.clear()
                html_text.insert(0, comp["html"])
                comp_map[cid]["order"] = comp["order"]

        # 점유 등록
        if agent_name:
            slide_locks[cid] = agent_name

    _dirty.add(project_id)
    return pycrdt.create_update_message(doc.get_update()), conflicted


def release_agent_lock(project_id: str, slide_id: str, agent_name: str) -> None:
    """에이전트 작업 완료 시 컴포넌트 점유 해제."""
    slide_locks = _component_locks[project_id].get(str(slide_id), {})
    released = [cid for cid, a in list(slide_locks.items()) if a == agent_name]
    for cid in released:
        slide_locks.pop(cid, None)
    if released:
        logger.debug("crdt_unlock  project=%s  slide=%s  agent=%s  comps=%s",
                     project_id, slide_id, agent_name, released)


def apply_component_update(
    project_id: str,
    slide_id: str,
    component_id: str,
    component_html: str,
    agent_name: str = "",
) -> tuple[bytes | None, bool]:
    """
    단일 컴포넌트 업데이트.
    Returns: (update_bytes, conflicted)
    """
    doc = _docs.get(project_id)
    if not doc:
        return None, False

    slides_map = doc.get("slides", type=pycrdt.Map)
    sid = str(slide_id)
    if sid not in slides_map:
        return None, False

    slide_map = slides_map[sid]
    comp_map = slide_map.get("components")
    if comp_map is None:
        return None, False

    # 충돌 체크
    slide_locks = _component_locks[project_id][sid]
    conflicted = component_id in slide_locks and slide_locks[component_id] != agent_name

    if component_id not in comp_map:
        with doc.transaction():
            comp_map[component_id] = pycrdt.Map()
        with doc.transaction():
            comp_map[component_id]["html"] = pycrdt.Text(component_html)
            comp_map[component_id]["order"] = len(comp_map) - 1
    else:
        with doc.transaction():
            html_text: pycrdt.Text = comp_map[component_id].get("html", pycrdt.Text(""))
            html_text.clear()
            html_text.insert(0, component_html)

    if agent_name:
        slide_locks[component_id] = agent_name

    _dirty.add(project_id)
    return pycrdt.create_update_message(doc.get_update()), conflicted


def delete_component(
    project_id: str,
    slide_id: str,
    component_id: str,
) -> bytes | None:
    """컴포넌트 삭제."""
    doc = _docs.get(project_id)
    if not doc:
        return None
    slides_map = doc.get("slides", type=pycrdt.Map)
    sid = str(slide_id)
    if sid not in slides_map:
        return None
    comp_map = slides_map[sid].get("components")
    if comp_map and component_id in comp_map:
        with doc.transaction():
            del comp_map[component_id]
        _dirty.add(project_id)
        return pycrdt.create_update_message(doc.get_update())
    return None


def add_slide_to_doc(project_id: str, slide_id: str, html: str = "", title: str = "") -> bytes | None:
    doc = _docs.get(project_id)
    if not doc:
        return None
    slides_map = doc.get("slides", type=pycrdt.Map)
    parsed = parse_slide_html(html)
    sid = str(slide_id)

    with doc.transaction():
        slides_map[sid] = pycrdt.Map()
    with doc.transaction():
        slides_map[sid]["style"] = pycrdt.Text(parsed["style"])
        slides_map[sid]["title"] = pycrdt.Text(title)
        slides_map[sid]["components"] = pycrdt.Map()

    comp_map = slides_map[sid]["components"]
    for cid, comp in parsed["components"].items():
        with doc.transaction():
            comp_map[cid] = pycrdt.Map()
        with doc.transaction():
            comp_map[cid]["html"] = pycrdt.Text(comp["html"])
            comp_map[cid]["order"] = comp["order"]

    _dirty.add(project_id)
    return pycrdt.create_update_message(doc.get_update())


# ── Yjs 동기화 프로토콜 ───────────────────────────────────────────────────────

def make_initial_sync(project_id: str) -> bytes:
    doc = _docs.get(project_id)
    if not doc:
        doc = pycrdt.Doc()
    return pycrdt.create_sync_message(doc)


def make_full_update(project_id: str) -> bytes:
    doc = _docs.get(project_id)
    if not doc:
        return pycrdt.create_update_message(pycrdt.Doc().get_update())
    return pycrdt.create_update_message(doc.get_update())


def handle_client_message(project_id: str, raw: bytes) -> bytes | None:
    doc = _docs.get(project_id)
    if not doc:
        return None
    inner = raw[1:] if raw else b""
    if not inner:
        return None
    try:
        reply = pycrdt.handle_sync_message(inner, doc)
    except Exception as e:
        logger.warning("crdt_handle_fail  project=%s  err=%s", project_id, e)
        return None

    msg_type = inner[0] if inner else -1
    if msg_type == int(pycrdt.YSyncMessageType.SYNC_STEP1):
        return reply
    if msg_type in (int(pycrdt.YSyncMessageType.SYNC_STEP2), int(pycrdt.YSyncMessageType.SYNC_UPDATE)):
        _dirty.add(project_id)
        return raw
    return None


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
    _component_locks.pop(project_id, None)
