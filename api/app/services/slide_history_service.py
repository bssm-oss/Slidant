"""
슬라이드 이력 서비스 — 흐름(orchestration)만 담당.
비즈니스 로직(diff, 스냅샷 생성)은 core/domain/history_diff.py에 있음.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from app.core.domain.history_diff import (
    build_html_component_history,
    build_component_history,
    build_slide_snapshot,
)
from app.models.slide_history import SlideHistory


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def archive_and_apply(
    uow, slide_id: UUID, new_content: list, reason: str,
    agent_name: str | None = None, html_content: str | None = None,
) -> None:
    """슬라이드 스냅샷 저장 + 변경 이력 기록 + 슬라이드 업데이트."""
    slide = await uow.slides.get(slide_id)
    if not slide:
        return

    old_content = list(slide.content or [])
    old_html = slide.html_content

    # 스냅샷 (롤백용)
    uow.slide_history.add(build_slide_snapshot(slide_id, slide.version, old_content, old_html, reason))

    if html_content is not None:
        # HTML 모드: data-component-id 단위 diff
        for record in build_html_component_history(slide_id, old_html, html_content, reason, agent_name):
            uow.component_history.add(record)
        slide.html_content = html_content
    else:
        # JSON 모드: 컴포넌트 단위 diff
        for record in build_component_history(slide_id, old_content, new_content, reason, agent_name):
            uow.component_history.add(record)

    slide.content = new_content
    slide.version += 1
    slide.updated_at = utcnow()


def record_initial_slide(uow, slide, reason: str, agent_name: str | None = None) -> None:
    """신규 생성 슬라이드 초기 이력 기록.

    archive_and_apply와 달리 DB 조회 없이 SlideModel 인스턴스 직접 사용.
    history.version=0 → 생성 이전 상태(html=None)를 나타냄.
    이후 archive_and_apply 호출 시 version=1부터 시작하므로 충돌 없음.
    """
    uow.slide_history.add(SlideHistory(
        slide_id=slide.id,
        version=0,
        content=[],
        html_content=None,
        reason=reason,
    ))
    for record in build_html_component_history(
        slide.id, None, slide.html_content or "", reason, agent_name
    ):
        uow.component_history.add(record)


def filter_history_by_component(entries: list, component_id: str) -> list:
    """슬라이드 전체 history에서 특정 컴포넌트가 실제로 변경된 버전만 필터링."""
    from app.core.domain.html_slide import HtmlSlide

    result = []
    prev_html: str | None = None
    for entry in reversed(entries):  # 오래된 순으로 비교
        curr_html: str | None = None
        if entry.html_content:
            comp = HtmlSlide(html=entry.html_content).components.get(component_id)
            curr_html = comp["html"] if comp else None
        if curr_html != prev_html:
            result.append(entry)
            prev_html = curr_html
    return list(reversed(result))  # 최신 순 반환


async def restore_from_history(uow, slide_id: UUID, history_id: UUID) -> None:
    """특정 이력 버전으로 슬라이드 복원."""
    from fastapi import HTTPException, status
    history = await uow.slide_history.get(history_id)
    if not history or history.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History entry not found")
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    await archive_and_apply(
        uow, slide_id, list(history.content or []),
        f"버전 복원 (v{history.version})",
        html_content=getattr(history, "html_content", None),
    )


async def restore_component_from_history(uow, slide_id: UUID, history_id: UUID, component_id: str) -> None:
    """히스토리 스냅샷에서 특정 컴포넌트만 추출해 현재 슬라이드에 merge."""
    from fastapi import HTTPException, status as http_status
    from app.core.domain.html_slide import HtmlSlide

    history = await uow.slide_history.get(history_id)
    if not history or history.slide_id != slide_id:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="History entry not found")
    if not history.html_content:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="No HTML snapshot in this history entry")

    slide = await uow.slides.get(slide_id)
    if not slide or not slide.html_content:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Current slide has no HTML content")

    old_component = HtmlSlide(html=history.html_content).components.get(component_id)
    if not old_component:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=f"Component '{component_id}' not found in snapshot")

    new_html = HtmlSlide(html=slide.html_content).update_component(component_id, old_component["html"]).html
    await archive_and_apply(
        uow, slide_id, list(slide.content or []),
        f"컴포넌트 복원 ({component_id}, v{history.version})",
        html_content=new_html,
    )


@dataclass
class HistoryDiffResult:
    added: list[str]
    removed: list[str]
    modified: list[str]
    before_html: str | None
    after_html: str | None


async def compute_history_diff(uow, slide_id: UUID, history_id: UUID) -> HistoryDiffResult:
    """SlideHistory 한 항목과 그 직전 항목을 diff해 변경된 컴포넌트 ID 목록 반환."""
    from fastapi import HTTPException, status
    from app.core.domain.history_diff import _parse_html_components

    entry = await uow.slide_history.get(history_id)
    if not entry or entry.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History entry not found")

    prev = await uow.slide_history.get_previous_entry(slide_id, entry.created_at)

    before_html = prev.html_content if prev else None
    after_html = entry.html_content

    old_map = _parse_html_components(before_html or "")
    new_map = _parse_html_components(after_html or "")

    all_ids = set(old_map) | set(new_map)
    added, removed, modified = [], [], []

    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)
        if old is None and new is not None:
            added.append(comp_id)
        elif old is not None and new is None:
            removed.append(comp_id)
        elif old != new:
            modified.append(comp_id)

    return HistoryDiffResult(
        added=sorted(added),
        removed=sorted(removed),
        modified=sorted(modified),
        before_html=before_html,
        after_html=after_html,
    )
