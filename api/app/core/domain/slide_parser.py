"""
슬라이드 HTML 파싱/렌더 — HtmlSlide 엔티티 기반 편의 함수들.
신규 코드는 HtmlSlide 엔티티 직접 사용 권장.
"""
from app.core.domain.html_slide import HtmlSlide  # noqa: F401


def parse_slide_html(html: str) -> dict:
    """HTML → {style, components, orphans}."""
    slide = HtmlSlide(html=html)
    return {"style": slide.style, "components": slide.components, "orphans": slide.orphans}


def render_slide_html(
    style: str,
    components: dict,
    orphans: list | None = None,
) -> str:
    return HtmlSlide._render(style, components, orphans or [])


def update_component_in_html(html: str, component_id: str, new_component_html: str) -> str:
    return HtmlSlide(html=html).update_component(component_id, new_component_html).html


def delete_component_from_html(html: str, component_id: str) -> str:
    return HtmlSlide(html=html).delete_component(component_id).html


def update_slide_style(html: str, new_style: str) -> str:
    return HtmlSlide(html=html).update_style(new_style).html


def list_component_ids(html: str) -> list[str]:
    return HtmlSlide(html=html).component_ids
