"""
슬라이드 이력 서비스 — 흐름(orchestration)만 담당.
비즈니스 로직(diff, 스냅샷 생성)은 core/domain/history_diff.py에 있음.
"""
from datetime import datetime, timezone
from uuid import UUID

from app.core.domain.history_diff import (
    build_html_component_history,
    build_component_history,
    build_slide_snapshot,
)


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
