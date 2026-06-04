# 하위 호환 re-export — 비즈니스 로직은 core/domain/slide_content.py에 있음
from app.core.domain.slide_content import (  # noqa: F401
    list_components,
    get_component,
    add_component,
    update_component,
    remove_component,
    apply_patches,
)
