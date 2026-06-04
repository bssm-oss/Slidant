"""
HtmlSlide 도메인 엔티티.

슬라이드 HTML을 래핑하는 불변 값 객체.
상태 변경은 새 인스턴스를 반환 (immutable pattern).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

from bs4 import BeautifulSoup, Tag


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
