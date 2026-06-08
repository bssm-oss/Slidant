"""LangGraph 그래프 조립."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.nodes.planner import (
    make_unified_planner, make_ops_dispatcher, make_self_reviewer,
    make_legacy_planner, route_from_dispatcher, route_from_reviewer,
)
from app.agent.nodes.composer import make_slide_composer, make_html_editor
from app.agent.nodes.component import make_component_deleter, make_slide_deleter
from app.agent.nodes.searcher import make_web_searcher, make_search_merger
from app.agent.nodes.validator import (
    make_html_aggregator, make_html_validator, make_should_retry_html,
    make_formatter, make_patch_serializer, make_validator,
)
from app.agent.nodes.routing import (
    make_dispatch_slides, make_increment_retry, make_route_after_planner_v2,
    make_intent_router, make_context_reader,
)
from app.agent.nodes.legacy import make_design_resolver, make_layout_composer


def build_graph(ctx: NodeContext, html_mode: bool = False) -> StateGraph:
    """NodeContext를 받아 LangGraph 그래프를 조립 후 compile해서 반환."""

    if html_mode:
        return _build_html_graph(ctx)
    return _build_legacy_graph(ctx)


def _build_html_graph(ctx: NodeContext):
    """HTML mode: ops_dispatcher 루프 구조."""
    graph = StateGraph(AgentState)

    # 노드 등록
    graph.add_node("unified_planner",   make_unified_planner(ctx))
    graph.add_node("web_searcher",      make_web_searcher(ctx))
    graph.add_node("search_merger",     make_search_merger(ctx))
    graph.add_node("ops_dispatcher",    make_ops_dispatcher(ctx))
    graph.add_node("slide_dispatch",    lambda s: s)          # Send API 트리거용 passthrough
    graph.add_node("slide_composer",    make_slide_composer(ctx))
    graph.add_node("html_editor",       make_html_editor(ctx))
    graph.add_node("component_deleter", make_component_deleter(ctx))
    graph.add_node("slide_deleter",     make_slide_deleter(ctx))
    graph.add_node("html_aggregator",   make_html_aggregator(ctx))
    graph.add_node("html_validator",    make_html_validator(ctx))
    graph.add_node("self_reviewer",     make_self_reviewer(ctx))
    graph.add_node("formatter",         make_formatter(ctx))
    graph.add_node("retry_inc",         make_increment_retry(ctx))

    route_after_planner_v2 = make_route_after_planner_v2(ctx)
    dispatch_slides        = make_dispatch_slides(ctx)
    should_retry_html      = make_should_retry_html(ctx)

    # 엣지
    graph.add_edge(START, "unified_planner")
    graph.add_conditional_edges("unified_planner", route_after_planner_v2, {
        "search":     "web_searcher",
        "dispatcher": "ops_dispatcher",
        "dispatch":   "slide_dispatch",
    })
    graph.add_edge("web_searcher",   "search_merger")
    graph.add_edge("search_merger",  "ops_dispatcher")

    graph.add_conditional_edges("ops_dispatcher", route_from_dispatcher, {
        "create":           "slide_dispatch",
        "edit":             "html_editor",
        "component_edit":   "html_editor",   # html_mode: 컴포넌트 ID 추측 없이 전체 HTML 수정
        "component_delete": "component_deleter",
        "delete":           "slide_deleter",
        "review":           "self_reviewer",
    })

    graph.add_edge("html_editor",       "html_validator")
    graph.add_edge("component_deleter", "html_validator")
    graph.add_conditional_edges("html_validator", should_retry_html, {
        "retry": "retry_inc",
        "done":  "ops_dispatcher",
    })
    def _route_from_retry(state: AgentState) -> str:
        op_type = state.get("current_op", {}).get("type", "")
        if op_type in ("edit", "component_edit"):
            return "html_editor"
        if op_type == "component_delete":
            return "component_deleter"
        return "ops_dispatcher"

    graph.add_conditional_edges("retry_inc", _route_from_retry, {
        "html_editor": "html_editor",
        "component_deleter": "component_deleter",
        "ops_dispatcher": "ops_dispatcher",
    })

    graph.add_conditional_edges("slide_dispatch", dispatch_slides, ["slide_composer"])
    graph.add_edge("slide_composer",  "html_aggregator")
    graph.add_edge("html_aggregator", "ops_dispatcher")
    graph.add_edge("slide_deleter",   "ops_dispatcher")

    graph.add_conditional_edges("self_reviewer", route_from_reviewer, {
        "done":     "formatter",
        "dispatch": "ops_dispatcher",
    })
    graph.add_edge("formatter", END)
    return graph.compile()


def _build_legacy_graph(ctx: NodeContext):
    """Legacy JSON Patch 파이프라인."""
    from app.agent.nodes.validator import make_should_retry_legacy

    graph = StateGraph(AgentState)

    graph.add_node("planner",          make_legacy_planner(ctx))
    graph.add_node("intent_router",    make_intent_router(ctx))
    graph.add_node("context_reader",   make_context_reader(ctx))
    graph.add_node("design_resolver",  make_design_resolver(ctx))
    graph.add_node("layout_composer",  make_layout_composer(ctx))
    graph.add_node("patch_serializer", make_patch_serializer(ctx))
    graph.add_node("validator",        make_validator(ctx))
    graph.add_node("formatter",        make_formatter(ctx))
    graph.add_node("retry_inc",        make_increment_retry(ctx))

    should_retry = make_should_retry_legacy(ctx)

    graph.add_edge(START, "planner")
    graph.add_edge("planner",          "intent_router")
    graph.add_edge("intent_router",    "context_reader")
    graph.add_edge("context_reader",   "design_resolver")
    graph.add_edge("design_resolver",  "layout_composer")
    graph.add_edge("layout_composer",  "patch_serializer")
    graph.add_edge("patch_serializer", "validator")
    graph.add_conditional_edges("validator", should_retry, {
        "retry": "retry_inc",
        "done":  "formatter",
    })
    graph.add_edge("formatter", END)
    graph.add_edge("retry_inc", "layout_composer")
    return graph.compile()
