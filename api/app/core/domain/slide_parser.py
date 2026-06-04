"""
슬라이드 HTML ↔ 컴포넌트 파싱/렌더.

HTML blob을 data-component-id 단위로 분해 → CRDT 컴포넌트 레벨 저장.
렌더 시 컴포넌트 목록 → HTML blob 재조립.
"""
from __future__ import annotations

import re
from bs4 import BeautifulSoup, Tag


# ── 파싱 ─────────────────────────────────────────────────────────────────────

def parse_slide_html(html: str) -> dict:
    """
    HTML → {style: str, components: {component_id: {html: str, order: int}}}

    반환 구조:
      style      : <style> 블록 내용 (CSS)
      components : {data-component-id → {html: outerHTML, order: 렌더순서}}
    """
    if not html or not html.strip():
        return {"style": "", "components": {}}

    soup = BeautifulSoup(html, "html.parser")

    # <style> 추출
    style_tag = soup.find("style")
    style = style_tag.get_text() if style_tag else ""

    # .slide 내부 또는 최상위에서 data-component-id 요소 수집
    slide_div = soup.find("div", class_="slide") or soup.find("div")
    if not slide_div:
        return {"style": style, "components": {}}

    components: dict[str, dict] = {}
    orphans: list[str] = []  # data-component-id 없는 태그 (<script>, <link> 등)
    order = 0
    for el in slide_div.children:
        if not isinstance(el, Tag):
            continue
        cid = el.get("data-component-id")
        if cid:
            components[cid] = {"html": str(el), "order": order}
            order += 1
        else:
            # <script>, <link>, <canvas> without id 등 보존
            orphans.append(str(el))

    return {"style": style, "components": components, "orphans": orphans}


# ── 렌더 ─────────────────────────────────────────────────────────────────────

def render_slide_html(
    style: str,
    components: dict[str, dict],
    orphans: list[str] | None = None,
) -> str:
    """
    {style, components, orphans} → 완전한 슬라이드 HTML 문자열.
    orphans: data-component-id 없는 <script> 등 — 컴포넌트 뒤에 붙임.
    """
    sorted_comps = sorted(components.values(), key=lambda c: c.get("order", 0))
    inner = "".join(c["html"] for c in sorted_comps)
    if orphans:
        inner += "".join(orphans)
    css = style.strip()
    slide_css = (
        ".slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:system-ui,sans-serif;}"
    )
    if ".slide" not in css:
        css = slide_css + "\n" + css
    return (
        f'<style>{css}</style>'
        f'<div class="slide">{inner}</div>'
    )


# ── 컴포넌트 단위 수정 ────────────────────────────────────────────────────────

def update_component_in_html(html: str, component_id: str, new_component_html: str) -> str:
    """
    기존 HTML에서 data-component-id=component_id 요소를 new_component_html로 교체.
    """
    parsed = parse_slide_html(html)
    if component_id not in parsed["components"]:
        return html  # 없는 컴포넌트면 원본 반환

    parsed["components"][component_id]["html"] = new_component_html
    return render_slide_html(parsed["style"], parsed["components"])


def delete_component_from_html(html: str, component_id: str) -> str:
    """기존 HTML에서 data-component-id=component_id 요소 제거."""
    parsed = parse_slide_html(html)
    parsed["components"].pop(component_id, None)
    return render_slide_html(parsed["style"], parsed["components"])


# ── CSS 스타일 수정 ───────────────────────────────────────────────────────────

def update_slide_style(html: str, new_style: str) -> str:
    """기존 HTML의 <style> 블록만 교체."""
    parsed = parse_slide_html(html)
    return render_slide_html(new_style, parsed["components"])


# ── 디버그 ────────────────────────────────────────────────────────────────────

def list_component_ids(html: str) -> list[str]:
    """HTML에서 data-component-id 목록 반환."""
    parsed = parse_slide_html(html)
    return sorted(parsed["components"].keys(), key=lambda k: parsed["components"][k]["order"])
