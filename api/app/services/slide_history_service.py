from datetime import datetime, timezone
from uuid import UUID

from app.models.slide_history import SlideHistory


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def archive_and_apply(uow, slide_id: UUID, new_content: list, reason: str) -> None:
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    uow.slide_history.add(SlideHistory(
        slide_id=slide_id,
        version=slide.version,
        content=list(slide.content or []),
        reason=reason,
    ))
    slide.content = new_content
    slide.version += 1
    slide.updated_at = utcnow()


async def restore_from_history(uow, slide_id: UUID, history_id: UUID) -> None:
    history = await uow.slide_history.get(history_id)
    if not history or history.slide_id != slide_id:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='History entry not found')
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    await archive_and_apply(uow, slide_id, list(history.content or []), f'버전 복원 (v{history.version})')
