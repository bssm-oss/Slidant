"""
슬라이드/컴포넌트 변경 diff 순수 로직.
DB 없음, I/O 없음 — 입력/출력만.
"""
from __future__ import annotations

import re
from uuid import UUID

from app.models.component_history import ComponentHistory
from app.models.slide_history import SlideHistory


def parse_html_components(html: str) -> dict[str, dict]:
    """HTML에서 data-component-id 요소를 파싱해 컴포넌트 맵 반환."""
    result: dict[str, dict] = {}
    if not html:
        return result
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


def build_html_component_history(
    slide_id: UUID,
    old_html: str | None,
    new_html: str,
    reason: str,
    agent_name: str | None = None,
) -> list[ComponentHistory]:
    """HTML diff → ComponentHistory 레코드 목록 반환 (DB write 없음)."""
    old_map = parse_html_components(old_html or "")
    new_map = parse_html_components(new_html)
    all_ids = set(old_map) | set(new_map)
    records: list[ComponentHistory] = []

    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)

        if old is None and new is not None:
            records.append(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="add", path=f"/{comp_id}",
                old_value=None, new_value=new,
                agent_name=agent_name, reason=reason,
            ))
        elif old is not None and new is None:
            records.append(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="remove", path=f"/{comp_id}",
                old_value=old, new_value=None,
                agent_name=agent_name, reason=reason,
            ))
        elif old != new:
            for key in ("style", "text", "class", "alt"):
                if old.get(key) != new.get(key):
                    records.append(ComponentHistory(
                        slide_id=slide_id, component_id=comp_id,
                        op="replace", path=f"/{comp_id}/{key}",
                        old_value={"v": old.get(key)},
                        new_value={"v": new.get(key)},
                        agent_name=agent_name, reason=reason,
                    ))
    return records


def build_component_history(
    slide_id: UUID,
    old_content: list,
    new_content: list,
    reason: str,
    agent_name: str | None = None,
) -> list[ComponentHistory]:
    """JSON 컴포넌트 배열 diff → ComponentHistory 레코드 목록 반환 (DB write 없음)."""
    old_map = {c["id"]: c for c in old_content if isinstance(c, dict) and "id" in c}
    new_map = {c["id"]: c for c in new_content if isinstance(c, dict) and "id" in c}
    all_ids = set(old_map) | set(new_map)
    records: list[ComponentHistory] = []

    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)

        if old is None and new is not None:
            records.append(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="add", path="/-",
                old_value=None, new_value=new,
                agent_name=agent_name, reason=reason,
            ))
        elif old is not None and new is None:
            records.append(ComponentHistory(
                slide_id=slide_id, component_id=comp_id,
                op="remove", path=f"/{comp_id}",
                old_value=old, new_value=None,
                agent_name=agent_name, reason=reason,
            ))
        elif old != new:
            old_props = old.get("properties", {})
            new_props = new.get("properties", {})
            for key in set(old_props) | set(new_props):
                if old_props.get(key) != new_props.get(key):
                    records.append(ComponentHistory(
                        slide_id=slide_id, component_id=comp_id,
                        op="replace", path=f"/{comp_id}/properties/{key}",
                        old_value=old_props.get(key),
                        new_value=new_props.get(key),
                        agent_name=agent_name, reason=reason,
                    ))
    return records


def build_slide_snapshot(
    slide_id: UUID,
    version: int,
    old_content: list,
    old_html: str | None,
    reason: str,
) -> SlideHistory:
    """슬라이드 스냅샷 레코드 생성 (DB write 없음)."""
    return SlideHistory(
        slide_id=slide_id,
        version=version,
        content=old_content,
        html_content=old_html,
        reason=reason,
    )
