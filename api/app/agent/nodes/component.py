"""component_editor, component_deleter, slide_deleter 노드."""
from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import COMPONENT_EDITOR_PROMPT

logger = logging.getLogger("slidant.agent")


def _extract_json(text: str):
    import re
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    for pattern in (r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"):
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                continue
    return None


def make_component_editor(ctx: NodeContext):
    async def component_editor_node(state: AgentState) -> AgentState:
        op = state.get("current_op", {})
        component_id = op.get("component_id", "")
        instruction = op.get("instruction", state.get("command", ""))

        if ctx.on_event:
            ctx.on_event("node_start", f"🔧 컴포넌트 수정 중 ({component_id})...")

        from app.core.domain.html_slide import HtmlSlide
        existing_html = state.get("slide_context", "")
        slide_entity = HtmlSlide(html=existing_html)
        target_comp = slide_entity.components.get(component_id)

        if not target_comp:
            logger.warning("component_editor: component '%s' not found", component_id)
            return {"result_summary": f"컴포넌트 '{component_id}' 없음"}

        human_text = (
            f"TARGET COMPONENT (data-component-id=\"{component_id}\"):\n"
            f"{target_comp['html']}\n\n"
            f"MODIFICATION: {instruction}\n\n"
            "위 지시에 따라 이 요소만 수정하라. data-component-id 보존 필수."
        )

        messages = [SystemMessage(content=COMPONENT_EDITOR_PROMPT), HumanMessage(content=human_text)]
        raw = ""
        try:
            async for chunk in ctx.llm.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("component_editor failed: %s", e)

        parsed_result = _extract_json(raw)
        new_comp_html = ""
        summary = ""
        if isinstance(parsed_result, dict):
            new_comp_html = parsed_result.get("html", "")
            summary = parsed_result.get("summary", f"컴포넌트 {component_id} 수정 완료")

        if new_comp_html:
            new_slide_html = slide_entity.update_component(component_id, new_comp_html).html
            result = {"type": "component_edit", "component_id": component_id,
                      "html": new_comp_html, "slide_html": new_slide_html, "summary": summary}
        else:
            new_slide_html = existing_html
            result = {"type": "component_edit", "component_id": component_id, "error": "no output"}

        if ctx.on_event and new_comp_html:
            ctx.on_event("step_done", f"comp-{component_id}")
            ctx.on_event("node_done", f"✅ {summary[:30]}")

        ops_results = list(state.get("ops_results", []))
        ops_results.append(result)
        return {"html_output": new_slide_html, "ops_results": ops_results, "result_summary": summary}
    return component_editor_node


def make_component_deleter(ctx: NodeContext):
    async def component_deleter_node(state: AgentState) -> AgentState:
        op = state.get("current_op", {})
        component_id = op.get("component_id", "")
        if ctx.on_event:
            ctx.on_event("node_start", f"🗑️ 컴포넌트 삭제 중 ({component_id})...")

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
            ctx.on_event("node_start", "🗑️ 슬라이드 삭제 중...")
            ctx.on_event("step_done", step_id)
            ctx.on_event("node_done", "✅ 슬라이드 삭제")
        return {"delete_slide": True, "result_summary": "슬라이드가 삭제되었습니다."}
    return slide_deleter_node
