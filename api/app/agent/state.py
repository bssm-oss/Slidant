import operator
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    command: str
    slide_context: str
    agent_name: str
    conversation_history: str
    plan: str
    image_urls: list
    result_patches: list
    result_summary: str
    retry_count: int
    mode: str
    component_map: dict
    design_tokens: dict
    component_specs: list
    html_output: str
    html_slides: Annotated[list, operator.add]
    slide_specs: list
    slide_index: int
    current_slide_spec: dict
    search_queries: list
    search_results: list
    delete_slide: bool
    ops_queue: list
    ops_results: list
    current_op: dict
    all_slides_context: list
    review_ok: bool
