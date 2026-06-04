"""Send API dispatch, routing helpers, legacy intent nodes."""
from __future__ import annotations

import json
import logging
import re

from app.agent.context import NodeContext
from app.agent.state import AgentState

logger = logging.getLogger("slidant.agent")


def make_dispatch_slides(_ctx: NodeContext):
    def dispatch_slides(state: AgentState):
        from langgraph.constants import Send
        specs = state.get("slide_specs", [])
        if not specs:
            plan = state.get("plan", "")
            titles = re.findall(r'슬라이드\s*\d+\s*[:：]\s*(?:\[\w+\]\s*)?(.*?)(?:\n|$)', plan)
            specs = [
                {"title": t.strip(), "layout": "CONTENT", "key_points": [], "image_needed": False}
                for t in titles[:6] if t.strip()
            ]
        if not specs:
            specs = [{"title": "슬라이드", "layout": "COVER", "key_points": [], "image_needed": False}]
        return [
            Send("slide_composer", {
                **state,
                "slide_index": i,
                "current_slide_spec": spec,
                "slide_specs": specs,   # 전체 슬라이드 계획 전달 (목차 일관성)
                "html_slides": [],
            })
            for i, spec in enumerate(specs)
        ]
    return dispatch_slides


def make_increment_retry(_ctx: NodeContext):
    def increment_retry(state: AgentState) -> AgentState:
        return {**state, "retry_count": state.get("retry_count", 0) + 1}
    return increment_retry


def make_route_after_planner_v2(_ctx: NodeContext):
    def route_after_planner_v2(state: AgentState) -> str:
        if state.get("search_queries"):
            return "search"
        if state.get("ops_queue"):
            return "dispatcher"
        return "dispatch"
    return route_after_planner_v2


# ── legacy intent 노드들 ──────────────────────────────────────────────────────

def make_intent_router(ctx: NodeContext):
    def intent_router_node(state: AgentState) -> AgentState:
        plan = state.get("plan", "")
        mode = "full_presentation" if "[PRESENTATION]" in plan else "single_edit"
        logger.info("  [intent_router] mode=%s", mode)
        if ctx.on_event:
            ctx.on_event("node_start", f"🔀 {'전체 PPT' if mode == 'full_presentation' else '단일 슬라이드'} 모드")
        return {**state, "mode": mode}
    return intent_router_node


def make_context_reader(_ctx: NodeContext):
    def context_reader_node(state: AgentState) -> AgentState:
        slide_ctx = state.get("slide_context", "")
        component_map: dict = {}
        for m in re.finditer(
            r'data-component-id="([^"]+)"\s+data-type="([^"]+)"[^>]*><props>(.*?)</props>',
            slide_ctx, re.DOTALL,
        ):
            cid, ctype, props_str = m.group(1), m.group(2), m.group(3)
            try:
                props = json.loads(props_str)
            except json.JSONDecodeError:
                props = {}
            component_map[cid] = {"id": cid, "type": ctype, "properties": props}
        logger.info("  [context_reader] components=%d", len(component_map))
        return {**state, "component_map": component_map}
    return context_reader_node


def make_should_retry_legacy(_ctx: NodeContext):
    def should_retry(state: AgentState) -> str:
        from app.core.config import settings
        patches = state.get("result_patches", [])
        retry = state.get("retry_count", 0)
        if not patches and retry < settings.AGENT_MAX_RETRIES:
            return "retry"
        return "done"
    return should_retry
