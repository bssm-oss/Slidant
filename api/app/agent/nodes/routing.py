"""Send API dispatch, routing helpers, legacy intent nodes."""
from __future__ import annotations

import json
import logging
import re

from app.agent.context import NodeContext
from app.core.config import settings
from app.agent.state import AgentState

logger = logging.getLogger("slidant.agent")


def make_dispatch_slides(_ctx: NodeContext):
    def dispatch_slides(state: AgentState):
        logger.info("━━ [routing] dispatch_slides specs=%d", len(state.get("slide_specs") or []))
        from langgraph.constants import Send
        specs = state.get("slide_specs", [])
        if not specs:
            plan = state.get("plan", "")
            titles = re.findall(r'슬라이드\s*\d+\s*[:：]\s*(?:\[\w+\]\s*)?(.*?)(?:\n|$)', plan)
            specs = [
                {"title": t.strip(), "layout": "CONTENT", "key_points": [], "image_needed": False}
                for t in titles[:15] if t.strip()
            ]
        if not specs:
            specs = [{"title": "슬라이드", "layout": "COVER", "key_points": [], "image_needed": False}]
        specs = specs[:settings.AGENT_MAX_SLIDES]
        batch_size = settings.AGENT_BATCH_SIZE

        from app.core.domain.layout_budget import compute_layout_budget

        sends = []
        for i in range(0, len(specs), batch_size):
            batch = specs[i:i + batch_size]
            batch_specs = [
                {"index": i + j, "spec": s, "layout_budget": compute_layout_budget(s, specs)}
                for j, s in enumerate(batch)
            ]
            sends.append(Send("slide_composer", {
                **state,
                "slide_index": i,
                "current_slide_spec": batch[0],
                "batch_specs": batch_specs,
                "slide_specs": specs,
                "html_slides": "__RESET__",
            }))
        logger.info("  [dispatch_slides] %d specs → %d batches (batch_size=%d)",
                    len(specs), len(sends), batch_size)
        return sends
    return dispatch_slides


def make_increment_retry(_ctx: NodeContext):
    def increment_retry(state: AgentState) -> AgentState:
        return {"retry_count": state.get("retry_count", 0) + 1}
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
        return {"mode": mode}
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
                logger.warning("  [context_reader] JSONDecodeError parsing props for cid=%s", cid, exc_info=True)
                props = {}
            component_map[cid] = {"id": cid, "type": ctype, "properties": props}
        logger.info("  [context_reader] components=%d", len(component_map))
        return {"component_map": component_map}
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
