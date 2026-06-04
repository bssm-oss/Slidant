"""
하위 호환 shim — 비즈니스 로직은 core/domain/slide_content.py(SlideContent 엔티티)에 있음.
신규 코드는 SlideContent 직접 사용 권장.
"""
from app.core.domain.slide_content import SlideContent  # noqa: F401


def list_components(slide) -> list[dict]:
    return SlideContent.from_slide(slide).list()


def get_component(slide, component_id: str) -> dict | None:
    return SlideContent.from_slide(slide).get(component_id)


def add_component(slide, type: str, properties: dict, parent_id=None, order: int = 0) -> dict:
    sc = SlideContent.from_slide(slide)
    comp = sc.add(type=type, properties=properties, parent_id=parent_id, order=order)
    slide.content = sc.to_list()
    return comp


def update_component(slide, component_id: str, properties=None, order=None) -> dict | None:
    sc = SlideContent.from_slide(slide)
    result = sc.update(component_id, properties=properties, order=order)
    slide.content = sc.to_list()
    return result


def remove_component(slide, component_id: str) -> bool:
    sc = SlideContent.from_slide(slide)
    result = sc.remove(component_id)
    slide.content = sc.to_list()
    return result


def apply_patches(slide, ops: list[dict]) -> None:
    sc = SlideContent.from_slide(slide)
    sc.apply_patches(ops)
    slide.content = sc.to_list()
