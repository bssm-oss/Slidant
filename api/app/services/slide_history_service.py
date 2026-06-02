import re
from datetime import datetime, timezone
from uuid import UUID

from app.models.component_history import ComponentHistory
from app.models.slide_history import SlideHistory


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_html_components(html: str) -> dict[str, dict]:
    """HTML에서 data-component-id 요소를 파싱해 컴포넌트 맵 반환."""
    result: dict[str, dict] = {}
    if not html:
        return result
    # 자기 닫힘 태그(div/span/p 등)까지 포함하는 패턴
    for m in re.finditer(
        r'<(\w+)([^>]*data-component-id="([^"]+)"[^>]*)(?:>([\s\S]*?)</\1>|/>)',
        html,
    ):
        tag, all_attrs, comp_id, inner = m.group(1), m.group(2), m.group(3), m.group(4) or ""
        style_m = re.search(r'style="([^"]*)"', all_attrs)
        class_m = re.search(r'class="([^"]*)"', all_attrs)
        data_alt = re.search(r'data-alt="([^"]*)"', all_attrs)
        result[comp_id] = {
            "tag": tag,
            "style": style_m.group(1) if style_m else "",
            "class": class_m.group(1) if class_m else "",
            "alt": data_alt.group(1) if data_alt else "",
            "text": re.sub(r"<[^>]+>", "", inner).strip()[:300],
        }
    return result


def _record_html_component_changes(
    uow,
    slide_id: UUID,
    old_html: str | None,
    new_html: str,
    reason: str,
    agent_name: str | None = None,
) -> None:
    """HTML 요소(data-component-id) 단위로 변경 이력 기록."""
    old_map = _parse_html_components(old_html or "")
    new_map = _parse_html_components(new_html)
    all_ids = set(old_map) | set(new_map)

    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)

        if old is None and new is not None:
            uow.component_history.add(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="add", path=f"/{comp_id}",
                old_value=None, new_value=new,
                agent_name=agent_name, reason=reason,
            ))
        elif old is not None and new is None:
            uow.component_history.add(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="remove", path=f"/{comp_id}",
                old_value=old, new_value=None,
                agent_name=agent_name, reason=reason,
            ))
        elif old != new:
            # style/text/class 중 변경된 것만 기록
            for key in ("style", "text", "class", "alt"):
                if old.get(key) != new.get(key):
                    uow.component_history.add(ComponentHistory(
                        slide_id=slide_id, component_id=comp_id,
                        op="replace", path=f"/{comp_id}/{key}",
                        old_value={"v": old.get(key)},
                        new_value={"v": new.get(key)},
                        agent_name=agent_name, reason=reason,
                    ))


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
    uow, slide_id: UUID, new_content: list, reason: str,
    agent_name: str | None = None, html_content: str | None = None
) -> None:
    slide = await uow.slides.get(slide_id)
    if not slide:
        return
    old_content = list(slide.content or [])
    old_html = slide.html_content

    # 슬라이드 전체 스냅샷 (롤백용 — html_content도 저장)
    uow.slide_history.add(SlideHistory(
        slide_id=slide_id,
        version=slide.version,
        content=old_content,
        html_content=old_html,
        reason=reason,
    ))

    if html_content is not None:
        # HTML 모드: data-component-id 요소 단위로 diff
        _record_html_component_changes(uow, slide_id, old_html, html_content, reason, agent_name)
        slide.html_content = html_content
    else:
        # JSON 모드: 기존 컴포넌트 단위 diff
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
    await archive_and_apply(
        uow, slide_id, list(history.content or []),
        f'버전 복원 (v{history.version})',
        html_content=getattr(history, "html_content", None),
    )
