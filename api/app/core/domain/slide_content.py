"""
SlideContent 도메인 엔티티.

슬라이드 JSON 컴포넌트 배열을 래핑하는 값 객체.
RFC 6902 패치 적용, 컴포넌트 CRUD 메서드 제공.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

logger = logging.getLogger("slidant.slide_content")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SlideContent:
    """슬라이드 JSON 컴포넌트 배열 도메인 엔티티."""

    components: list[dict] = field(default_factory=list)

    # ── 조회 ──────────────────────────────────────────────────────────────────

    def list(self) -> list[dict]:
        """order 기준 정렬된 컴포넌트 목록."""
        return sorted(self.components, key=lambda c: c.get("order", 0))

    def get(self, component_id: str) -> dict | None:
        return next((c for c in self.components if c.get("id") == component_id), None)

    # ── 변경 (in-place, side-effect 명시) ────────────────────────────────────

    def add(
        self,
        type: str,
        properties: dict,
        parent_id: str | None = None,
        order: int = 0,
    ) -> dict:
        """컴포넌트 추가 후 생성된 컴포넌트 반환."""
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
        self.components = list(self.components) + [comp]
        return comp

    def update(
        self,
        component_id: str,
        properties: dict | None = None,
        order: int | None = None,
    ) -> dict | None:
        """컴포넌트 속성/순서 변경. 성공 시 변경된 컴포넌트 반환, 없으면 None."""
        updated = None
        new_components = []
        for c in self.components:
            if c.get("id") == component_id:
                c = dict(c)
                if properties is not None:
                    c["properties"] = properties
                if order is not None:
                    c["order"] = order
                c["updated_at"] = _now()
                updated = c
            new_components.append(c)
        self.components = new_components
        return updated

    def remove(self, component_id: str) -> bool:
        """컴포넌트 제거. 삭제됐으면 True."""
        before = len(self.components)
        self.components = [c for c in self.components if c.get("id") != component_id]
        return len(self.components) < before

    def apply_patches(self, ops: list[dict]) -> None:
        """RFC 6902 ops를 self.components에 in-place 적용."""
        comp_map: dict[str, dict] = {c["id"]: dict(c) for c in self.components}
        order_counter = max((c.get("order", 0) for c in self.components), default=-1) + 1

        for op in ops:
            if not isinstance(op, dict):
                logger.warning("apply_patches: skip non-dict op: %r", op)
                continue
            operation = op.get("op")
            path_parts = op.get("path", "").strip("/").split("/")
            if not path_parts:
                continue

            # 새 컴포넌트 추가
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
                field_name = path_parts[1]
                if field_name == "properties" and len(path_parts) > 2:
                    prop_key = path_parts[2]
                    comp["properties"] = {**comp.get("properties", {}), prop_key: op.get("value")}
                elif field_name == "order":
                    comp["order"] = op.get("value")
                comp["updated_at"] = _now()
            elif operation == "remove":
                del comp_map[comp_id]

        self.components = sorted(comp_map.values(), key=lambda c: c.get("order", 0))

    # ── 팩토리 ────────────────────────────────────────────────────────────────

    @classmethod
    def from_slide(cls, slide) -> "SlideContent":
        """SQLModel Slide 객체에서 생성."""
        return cls(components=list(slide.content or []))

    def to_list(self) -> list[dict]:
        """저장용 리스트 반환."""
        return list(self.components)
