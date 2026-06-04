"""
SlideDiff 도메인 엔티티.

두 슬라이드 상태 간의 diff를 계산해 ComponentHistory / SlideHistory 레코드를 생성.
DB write 없음 — 생성된 레코드를 반환해 caller(service)가 저장.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import UUID

from app.models.component_history import ComponentHistory
from app.models.slide_history import SlideHistory


def _parse_html_components(html: str) -> dict[str, dict]:
    """HTML → {component_id: {tag, style, class, alt, text}} 맵."""
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


@dataclass(frozen=True)
class HtmlSlideDiff:
    """HTML 슬라이드 두 버전 간의 diff 엔티티."""

    slide_id: UUID
    old_html: str | None
    new_html: str
    reason: str
    agent_name: str | None = None

    def to_component_history(self) -> list[ComponentHistory]:
        """ComponentHistory 레코드 목록 반환 (DB write 없음)."""
        old_map = _parse_html_components(self.old_html or "")
        new_map = _parse_html_components(self.new_html)
        all_ids = set(old_map) | set(new_map)
        records: list[ComponentHistory] = []

        for comp_id in all_ids:
            old = old_map.get(comp_id)
            new = new_map.get(comp_id)

            if old is None and new is not None:
                records.append(ComponentHistory(
                    slide_id=self.slide_id, component_id=comp_id,
                    op="add", path=f"/{comp_id}",
                    old_value=None, new_value=new,
                    agent_name=self.agent_name, reason=self.reason,
                ))
            elif old is not None and new is None:
                records.append(ComponentHistory(
                    slide_id=self.slide_id, component_id=comp_id,
                    op="remove", path=f"/{comp_id}",
                    old_value=old, new_value=None,
                    agent_name=self.agent_name, reason=self.reason,
                ))
            elif old != new:
                for key in ("style", "text", "class", "alt"):
                    if old.get(key) != new.get(key):
                        records.append(ComponentHistory(
                            slide_id=self.slide_id, component_id=comp_id,
                            op="replace", path=f"/{comp_id}/{key}",
                            old_value={"v": old.get(key)},
                            new_value={"v": new.get(key)},
                            agent_name=self.agent_name, reason=self.reason,
                        ))
        return records


@dataclass(frozen=True)
class JsonSlideDiff:
    """JSON 컴포넌트 배열 두 버전 간의 diff 엔티티."""

    slide_id: UUID
    old_content: list
    new_content: list
    reason: str
    agent_name: str | None = None

    def to_component_history(self) -> list[ComponentHistory]:
        """ComponentHistory 레코드 목록 반환 (DB write 없음)."""
        old_map = {c["id"]: c for c in self.old_content if isinstance(c, dict) and "id" in c}
        new_map = {c["id"]: c for c in self.new_content if isinstance(c, dict) and "id" in c}
        all_ids = set(old_map) | set(new_map)
        records: list[ComponentHistory] = []

        for comp_id in all_ids:
            old = old_map.get(comp_id)
            new = new_map.get(comp_id)

            if old is None and new is not None:
                records.append(ComponentHistory(
                    slide_id=self.slide_id, component_id=comp_id,
                    op="add", path="/-",
                    old_value=None, new_value=new,
                    agent_name=self.agent_name, reason=self.reason,
                ))
            elif old is not None and new is None:
                records.append(ComponentHistory(
                    slide_id=self.slide_id, component_id=comp_id,
                    op="remove", path=f"/{comp_id}",
                    old_value=old, new_value=None,
                    agent_name=self.agent_name, reason=self.reason,
                ))
            elif old != new:
                old_props = old.get("properties", {})
                new_props = new.get("properties", {})
                for key in set(old_props) | set(new_props):
                    if old_props.get(key) != new_props.get(key):
                        records.append(ComponentHistory(
                            slide_id=self.slide_id, component_id=comp_id,
                            op="replace", path=f"/{comp_id}/properties/{key}",
                            old_value=old_props.get(key),
                            new_value=new_props.get(key),
                            agent_name=self.agent_name, reason=self.reason,
                        ))
        return records


@dataclass(frozen=True)
class SlideSnapshot:
    """슬라이드 롤백용 스냅샷 엔티티."""

    slide_id: UUID
    version: int
    old_content: list
    old_html: str | None
    reason: str

    def to_slide_history(self) -> SlideHistory:
        """SlideHistory 레코드 반환 (DB write 없음)."""
        return SlideHistory(
            slide_id=self.slide_id,
            version=self.version,
            content=self.old_content,
            html_content=self.old_html,
            reason=self.reason,
        )


# ── 하위 호환 함수 (services/에서 호출하던 기존 시그니처 유지) ───────────────

def build_html_component_history(
    slide_id: UUID, old_html: str | None, new_html: str, reason: str,
    agent_name: str | None = None,
) -> list[ComponentHistory]:
    return HtmlSlideDiff(slide_id, old_html, new_html, reason, agent_name).to_component_history()


def build_component_history(
    slide_id: UUID, old_content: list, new_content: list, reason: str,
    agent_name: str | None = None,
) -> list[ComponentHistory]:
    return JsonSlideDiff(slide_id, old_content, new_content, reason, agent_name).to_component_history()


def build_slide_snapshot(
    slide_id: UUID, version: int, old_content: list, old_html: str | None, reason: str,
) -> SlideHistory:
    return SlideSnapshot(slide_id, version, old_content, old_html, reason).to_slide_history()
