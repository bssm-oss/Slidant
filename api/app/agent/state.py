import operator
from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


_RESET_SENTINEL = "__RESET__"


def _accumulate_or_reset(left: list, right: list | str) -> list:
    """
    Send API 병렬 팬아웃을 위한 커스텀 reducer.
    - right == "__RESET__": 리스트 초기화 (ops 사이클 간 누적 방지)
    - right == ["__RESET__", ...]: 리셋 후 나머지 항목으로 대체 (head-sentinel replace)
    - right == []: 변화 없음
    - right == [...]: 기존에 추가
    """
    if isinstance(right, str) and right == _RESET_SENTINEL:
        return []
    if isinstance(right, list) and right and right[0] == _RESET_SENTINEL:
        return list(right[1:])  # head sentinel = reset then replace with rest
    return (left or []) + (right or [])


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
    html_slides: Annotated[list, _accumulate_or_reset]
    slide_specs: list
    slide_index: int
    current_slide_spec: dict
    search_queries: list
    search_results: list
    search_summary: str
    delete_slide: bool
    ops_queue: list
    ops_results: list
    current_op: dict
    all_slides_context: list
    review_ok: bool
    review_count: int  # self_reviewer 호출 횟수 (무한 루프 방지)
    validation_errors: list  # html_validator 정적 검사 결과 (재시도 시 피드백용)
