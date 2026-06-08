"""component_deleter, slide_deleter 노드."""
from __future__ import annotations

import logging

from app.agent.context import NodeContext
from app.agent.state import AgentState

logger = logging.getLogger("slidant.agent")


def make_component_deleter(ctx: NodeContext):
    async def component_deleter_node(state: AgentState) -> AgentState:
        op = state.get("current_op", {})
        component_id = op.get("component_id", "")
        if ctx.on_event:
            ctx.on_event("node_start", f"컴포넌트 삭제 중 ({component_id})...")

        from app.core.domain.html_slide import HtmlSlide
        existing_html = state.get("slide_context", "")
        new_html = HtmlSlide(html=existing_html).delete_component(component_id).html

        summary = f"컴포넌트 '{component_id}' 삭제 완료"
        if ctx.on_event:
            ctx.on_event("step_done", f"comp-del-{component_id}")
            ctx.on_event("node_done", f"✅ {summary}")

        ops_results = list(state.get("ops_results", []))
        ops_results.append({"type": "component_delete", "component_id": component_id})
        return {"html_output": new_html, "ops_results": ops_results, "result_summary": summary}
    return component_deleter_node


def make_slide_deleter(ctx: NodeContext):
    async def slide_deleter_node(state: AgentState) -> AgentState:
        step_id = state.get("current_op", {}).get("step_id", "delete-0-0")
        if ctx.on_event:
            ctx.on_event("node_start", "슬라이드 삭제 중...")
            ctx.on_event("step_done", step_id)
            ctx.on_event("node_done", "✅ 슬라이드 삭제")
        return {"delete_slide": True, "result_summary": "슬라이드가 삭제되었습니다."}
    return slide_deleter_node
