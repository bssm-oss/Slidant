from dataclasses import dataclass
from typing import Callable, Any


@dataclass
class NodeContext:
    llm: Any
    llm_plain: Any
    gen_prompt: Any
    on_token: Callable[[str], None] | None
    on_event: Callable[[str, str], None] | None
    slide_scope_locked: bool = False
    llm_batch: Any = None  # higher max_tokens for batch slide generation
