# 하위 호환 re-export — 비즈니스 로직은 core/domain/slide_parser.py에 있음
from app.core.domain.slide_parser import (  # noqa: F401
    parse_slide_html,
    render_slide_html,
    update_component_in_html,
    delete_component_from_html,
    update_slide_style,
    list_component_ids,
)
