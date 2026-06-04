"""slide_composer, html_editor 노드."""
from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import SLIDE_COMPOSER_PROMPT, HTML_EDITOR_PROMPT

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


def make_slide_composer(ctx: NodeContext):
    async def slide_composer_node(state: AgentState) -> dict:
        idx = state.get("slide_index", 0)
        spec = state.get("current_slide_spec") or (state.get("slide_specs") or [{}])[0]
        design_tokens = state.get("design_tokens", {})

        if ctx.on_event:
            ctx.on_event("node_start", f"✏️ 슬라이드 {idx+1} 생성 중...")

        search_ctx = ""
        if state.get("search_results"):
            search_ctx = "\n\n## 웹 검색 데이터 (슬라이드에 반영할 것 — 검색어와 무관한 결과는 무시):\n"
            for sr in state["search_results"]:
                search_ctx += f"\n### 검색어: {sr['query']}\n"
                if sr.get("answer"):
                    search_ctx += f"**요약**: {sr['answer']}\n"
                for r in sr["results"][:4]:
                    search_ctx += f"- **{r['title']}**: {r['snippet']}\n"
            search_ctx += "\n※ 검색 결과 중 슬라이드 주제와 무관한 항목은 사용하지 말 것.\n"

        human_text = (
            f"Slide spec: {json.dumps(spec, ensure_ascii=False)}\n\n"
            f"Design tokens: {json.dumps(design_tokens, ensure_ascii=False)}\n\n"
            f"Slide index: {idx} (0-based)\n\n"
            f"Current slide HTML (for reference/edit):\n{state.get('slide_context', '(empty)')}"
            f"{search_ctx}"
        )

        composer_system = SLIDE_COMPOSER_PROMPT
        if isinstance(ctx.gen_prompt, str):
            composer_system = ctx.gen_prompt

        messages = [SystemMessage(content=composer_system), HumanMessage(content=human_text)]
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
            logger.warning("slide_composer[%d] failed: %s", idx, e)

        parsed = _extract_json(raw)
        html = parsed.get("html", "") if isinstance(parsed, dict) else ""
        title = spec.get("title", f"슬라이드 {idx+1}")

        if ctx.on_event and html:
            ctx.on_event("slide_ready", json.dumps({"index": idx, "title": title, "html": html}, ensure_ascii=False))
            ctx.on_event("step_done", f"slide-{idx}")
            ctx.on_event("node_done", f"✅ {title[:15]} 완성")

        logger.info("  [slide_composer] idx=%d html=%d chars", idx, len(html))
        return {"html_slides": [{"index": idx, "title": title, "html": html}]}
    return slide_composer_node


def make_html_editor(ctx: NodeContext):
    async def html_editor_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "✏️ 슬라이드 수정 중...")

        existing_html = state.get("slide_context", "")
        if not existing_html:
            return {**state, "mode": "create"}

        spec = (state.get("slide_specs") or [{}])[0]
        design_tokens = state.get("design_tokens", {})
        command = state.get("command", "")
        op = state.get("current_op", {})
        instruction = op.get("instruction", command)

        human_text = (
            f"EXISTING SLIDE HTML:\n{existing_html}\n\n"
            f"MODIFICATION INSTRUCTION: {instruction}\n"
            f"Edit spec: {json.dumps(spec, ensure_ascii=False)}\n"
            f"Design tokens (참고용): {json.dumps(design_tokens, ensure_ascii=False)}\n\n"
            "위 지시에 따라 기존 HTML을 수정하라. 내용은 보존, 요청된 것만 변경."
        )

        messages = [SystemMessage(content=HTML_EDITOR_PROMPT), HumanMessage(content=human_text)]
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
            logger.warning("html_editor failed: %s", e)

        parsed = _extract_json(raw)
        html = ""
        summary = ""
        if isinstance(parsed, dict):
            html = parsed.get("html", "")
            summary = parsed.get("summary", "슬라이드 수정 완료")

        if ctx.on_event and html:
            ctx.on_event("step_done", "edit")
            ctx.on_event("node_done", f"✅ {summary[:30]}")

        logger.info("[html_editor] html=%d chars", len(html))
        ops_results = list(state.get("ops_results", []))
        ops_results.append({"type": "edit", "summary": summary})
        return {**state, "html_output": html, "result_summary": summary, "ops_results": ops_results}
    return html_editor_node
