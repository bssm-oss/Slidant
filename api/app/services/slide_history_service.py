from datetime import datetime, timezone
from uuid import UUID

from app.models.component_history import ComponentHistory
from app.models.slide_history import SlideHistory


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _record_component_changes(
    uow,
    slide_id: UUID,
    old_content: list,
    new_content: list,
    reason: str,
    agent_name: str | None = None,
) -> None:
    """old_content → new_content 변화를 ComponentHistory로 기록."""
    old_map = {c["id"]: c for c in old_content if isinstance(c, dict) and "id" in c}
    new_map = {c["id"]: c for c in new_content if isinstance(c, dict) and "id" in c}

    all_ids = set(old_map) | set(new_map)
    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)

        if old is None and new is not None:
            # add
            uow.component_history.add(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="add", path="/-",
                old_value=None, new_value=new,
                agent_name=agent_name, reason=reason,
            ))
        elif old is not None and new is None:
            # remove
            uow.component_history.add(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="remove", path=f"/{comp_id}",
                old_value=old, new_value=None,
                agent_name=agent_name, reason=reason,
            ))
        elif old != new:
            # replace — 변경된 properties key만 기록
            old_props = old.get("properties", {})
            new_props = new.get("properties", {})
            all_keys = set(old_props) | set(new_props)
            for key in all_keys:
                if old_props.get(key) != new_props.get(key):
                    uow.component_history.add(ComponentHistory(
                        slide_id=slide_id, component_id=comp_id,
                        op="replace", path=f"/{comp_id}/properties/{key}",
                        old_value=old_props.get(key),
                        new_value=new_props.get(key),
                        agent_name=agent_name, reason=reason,
                    ))


async def archive_and_apply(
    uow, slide_id: UUID, new_content: list, reason: str, agent_name: str | None = None
) -> None:
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    old_content = list(slide.content or [])

    # 슬라이드 전체 스냅샷 (기존 유지 — 전체 롤백용)
    uow.slide_history.add(SlideHistory(
        slide_id=slide_id,
        version=slide.version,
        content=old_content,
        reason=reason,
    ))

    # 컴포넌트 단위 변경 기록 (신규)
    _record_component_changes(uow, slide_id, old_content, new_content, reason, agent_name)

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
