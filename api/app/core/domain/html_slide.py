"""
HtmlSlide 도메인 엔티티.

슬라이드 HTML을 래핑하는 불변 값 객체.
상태 변경은 새 인스턴스를 반환 (immutable pattern).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import cached_property

from bs4 import BeautifulSoup, Tag

_CANVAS_W = 960
_CANVAS_H = 540


def _parse_inline_style(style: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in style.split(";"):
        part = part.strip()
        if ":" in part:
            k, _, v = part.partition(":")
            result[k.strip().lower()] = v.strip()
    return result


def _serialize_inline_style(props: dict[str, str]) -> str:
    return ";".join(f"{k}:{v}" for k, v in props.items() if v is not None)


def _px(val: str | None) -> float | None:
    if not val:
        return None
    m = re.match(r"^(-?[\d.]+)px$", val.strip())
    return float(m.group(1)) if m else None


def _clamp_style(style: str) -> str:
    """position:absolute 요소의 style을 960×540 캔버스 경계 내로 클램핑."""
    if "absolute" not in style:
        return style

    props = _parse_inline_style(style)
    left = _px(props.get("left"))
    top = _px(props.get("top"))
    width = _px(props.get("width"))
    height = _px(props.get("height"))

    modified = False

    if left is not None and left < 0:
        props["left"] = "0px"
        left = 0.0
        modified = True

    if top is not None and top < 0:
        props["top"] = "0px"
        top = 0.0
        modified = True

    if left is not None and width is not None and (left + width) > _CANVAS_W:
        props["width"] = f"{max(20, _CANVAS_W - left):.0f}px"
        modified = True

    if top is not None and height is not None and (top + height) > _CANVAS_H:
        props["height"] = f"{max(20, _CANVAS_H - top):.0f}px"
        modified = True

    return _serialize_inline_style(props) if modified else style


@dataclass(frozen=True)
class HtmlSlide:
    """슬라이드 1장의 HTML을 래핑하는 도메인 엔티티."""

    html: str

    # ── 파싱 ──────────────────────────────────────────────────────────────────

    @cached_property
    def _parsed(self) -> dict:
        """HTML → {style, components, orphans} 파싱 결과 (lazy, 1회 계산)."""
        if not self.html or not self.html.strip():
            return {"style": "", "components": {}, "orphans": []}

        soup = BeautifulSoup(self.html, "html.parser")
        style_tag = soup.find("style")
        style = style_tag.get_text() if style_tag else ""

        slide_div = soup.find("div", class_="slide") or soup.find("div")
        if not slide_div:
            return {"style": style, "components": {}, "orphans": []}

        components: dict[str, dict] = {}
        orphans: list[str] = []
        order = 0
        for el in slide_div.children:
            if not isinstance(el, Tag):
                continue
            cid = el.get("data-component-id")
            if cid:
                components[cid] = {"html": str(el), "order": order}
                order += 1
            else:
                orphans.append(str(el))

        return {"style": style, "components": components, "orphans": orphans}

    @property
    def style(self) -> str:
        return self._parsed["style"]

    @property
    def components(self) -> dict[str, dict]:
        """{component_id: {html, order}} 딕셔너리."""
        return self._parsed["components"]

    @property
    def orphans(self) -> list[str]:
        """data-component-id 없는 <script> 등."""
        return self._parsed["orphans"]

    @property
    def component_ids(self) -> list[str]:
        """렌더 순서(order)로 정렬된 component_id 목록."""
        return sorted(self.components, key=lambda k: self.components[k]["order"])

    # ── 변환 (새 인스턴스 반환) ───────────────────────────────────────────────

    def update_component(self, component_id: str, new_component_html: str) -> "HtmlSlide":
        """특정 컴포넌트 HTML을 교체한 새 HtmlSlide 반환."""
        if component_id not in self.components:
            return self
        new_components = {
            cid: ({**comp, "html": new_component_html} if cid == component_id else comp)
            for cid, comp in self.components.items()
        }
        return HtmlSlide(html=self._render(self.style, new_components, self.orphans))

    def delete_component(self, component_id: str) -> "HtmlSlide":
        """특정 컴포넌트를 제거한 새 HtmlSlide 반환."""
        new_components = {k: v for k, v in self.components.items() if k != component_id}
        return HtmlSlide(html=self._render(self.style, new_components, self.orphans))

    def update_style(self, new_style: str) -> "HtmlSlide":
        """<style> 블록을 교체한 새 HtmlSlide 반환."""
        return HtmlSlide(html=self._render(new_style, self.components, self.orphans))

    def clamp_positions(self) -> "HtmlSlide":
        """절대 위치 요소가 960×540 캔버스를 넘지 않도록 width/height 클램핑."""
        new_html = re.sub(
            r'style="([^"]*)"',
            lambda m: f'style="{_clamp_style(m.group(1))}"',
            self.html,
        )
        return self if new_html == self.html else HtmlSlide(html=new_html)

    def render(self) -> str:
        """현재 상태를 완전한 HTML 문자열로 반환."""
        return self.html

    # ── 내부 렌더 ─────────────────────────────────────────────────────────────

    @staticmethod
    def _render(style: str, components: dict[str, dict], orphans: list[str]) -> str:
        sorted_comps = sorted(components.values(), key=lambda c: c.get("order", 0))
        inner = "".join(c["html"] for c in sorted_comps)
        if orphans:
            inner += "".join(orphans)
        css = style.strip()
        if ".slide" not in css:
            css = ".slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:system-ui,sans-serif;}\n" + css
        return f"<style>{css}</style><div class=\"slide\">{inner}</div>"

    # ── 팩토리 ────────────────────────────────────────────────────────────────

    @classmethod
    def empty(cls) -> "HtmlSlide":
        return cls(html="")


def merge_component_changes(
    old_html: str,
    new_html: str,
    accepted_ids: list[str],
) -> str:
    """
    선택한 컴포넌트 변경만 old_html에 병합.

    accepted_ids에 포함된 component_id에 대해:
    - 수정(old·new 모두 존재): new 버전으로 교체
    - 추가(new에만 존재): old에 추가
    - 삭제(old에만 존재): old에서 제거
    나머지 컴포넌트는 old_html 그대로 유지.
    """
    if not old_html:
        return new_html
    if not accepted_ids:
        return old_html

    old = HtmlSlide(html=old_html)
    new = HtmlSlide(html=new_html)

    accepted = set(accepted_ids)
    old_ids = set(old.components.keys())
    new_ids = set(new.components.keys())

    result = dict(old.components)

    for cid in accepted:
        if cid in new_ids and cid in old_ids:
            result[cid] = new.components[cid]
        elif cid in new_ids:
            max_order = max((c["order"] for c in result.values()), default=-1)
            result[cid] = {**new.components[cid], "order": max_order + 1}
        elif cid in old_ids:
            del result[cid]

    return HtmlSlide(html=HtmlSlide._render(old.style, result, old.orphans)).html
