import logging
from datetime import datetime, timezone
from uuid import uuid4

from app.models.slide import Slide

logger = logging.getLogger("slidant.slide_content")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_components(slide: Slide) -> list[dict]:
    return sorted(slide.content or [], key=lambda c: c.get("order", 0))


def get_component(slide: Slide, component_id: str) -> dict | None:
    return next((c for c in (slide.content or []) if c["id"] == component_id), None)


def add_component(
    slide: Slide,
    type: str,
    properties: dict,
    parent_id: str | None = None,
    order: int = 0,
) -> dict:
    now = _now()
    comp: dict = {
        "id": str(uuid4()),
        "type": type,
        "parent_id": parent_id,
        "order": order,
        "properties": properties,
        "created_at": now,
        "updated_at": now,
    }
    slide.content = list(slide.content or []) + [comp]
    return comp


def update_component(
    slide: Slide,
    component_id: str,
    properties: dict | None = None,
    order: int | None = None,
) -> dict | None:
    content = list(slide.content or [])
    updated = None
    new_content = []
    for c in content:
        if c["id"] == component_id:
            c = dict(c)
            if properties is not None:
                c["properties"] = properties
            if order is not None:
                c["order"] = order
            c["updated_at"] = _now()
            updated = c
        new_content.append(c)
    slide.content = new_content
    return updated


def remove_component(slide: Slide, component_id: str) -> bool:
    content = slide.content or []
    new_content = [c for c in content if c["id"] != component_id]
    if len(new_content) == len(content):
        return False
    slide.content = new_content
    return True


def apply_patches(slide: Slide, ops: list[dict]) -> None:
    content = list(slide.content or [])
    comp_map: dict[str, dict] = {c["id"]: dict(c) for c in content}
    order_counter = max((c.get("order", 0) for c in content), default=-1) + 1

    for op in ops:
        if not isinstance(op, dict):
            logger.warning("apply_patches: skip non-dict op: %r", op)
            continue
        operation = op.get("op")
        path_parts = op.get("path", "").strip("/").split("/")
        if not path_parts:
            continue

        # 새 컴포넌트 추가: {"op": "add", "path": "/-", "value": {...}}
        if operation == "add" and path_parts[0] in ("-", ""):
            value = op.get("value", {})
            if not isinstance(value, dict):
                continue
            new_comp = {
                "id": str(uuid4()),
                "type": value.get("type", "text"),
                "parent_id": value.get("parent_id"),
                "order": value.get("order", order_counter),
                "properties": value.get("properties", {}),
                "created_at": _now(),
                "updated_at": _now(),
            }
            comp_map[new_comp["id"]] = new_comp
            order_counter += 1
            continue

        comp_id = path_parts[0]
        if comp_id not in comp_map:
            continue

        comp = comp_map[comp_id]
        if operation == "replace" and len(path_parts) > 1:
            field = path_parts[1]
            if field == "properties" and len(path_parts) > 2:
                prop_key = path_parts[2]
                comp["properties"] = {**comp.get("properties", {}), prop_key: op.get("value")}
            elif field == "order":
                comp["order"] = op.get("value")
            comp["updated_at"] = _now()
        elif operation == "remove":
            del comp_map[comp_id]

    slide.content = list(comp_map.values())
