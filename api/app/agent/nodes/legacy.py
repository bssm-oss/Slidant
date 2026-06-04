"""레거시 JSON Patch 파이프라인 노드: design_resolver, layout_composer."""
from __future__ import annotations

import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.agent.context import NodeContext
from app.agent.state import AgentState
from app.agent.prompts import DESIGN_RESOLVER_PROMPT, LAYOUT_COMPOSER_PROMPT

logger = logging.getLogger("slidant.agent")


def _extract_json(text: str):
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


def _flatten_ops(ops: list) -> list[dict]:
    result = []
    for item in ops:
        if isinstance(item, list):
            result.extend(i for i in item if isinstance(i, dict))
        elif isinstance(item, dict):
            result.append(item)
    return result


def make_design_resolver(ctx: NodeContext):
    async def design_resolver_node(state: AgentState) -> AgentState:
        if ctx.on_event:
            ctx.on_event("node_start", "🎨 디자인 토큰 결정 중...")
        messages = [
            SystemMessage(content=DESIGN_RESOLVER_PROMPT),
            HumanMessage(content=f"Plan:\n{state.get('plan', '')}\nMode: {state.get('mode', 'single_edit')}"),
        ]
        raw = ""
        try:
            async for chunk in ctx.llm_plain.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as exc:
            logger.warning("  [design_resolver] failed: %s", exc)
        parsed = _extract_json(raw)
        design_tokens: dict = (
            parsed if isinstance(parsed, dict) and "bg" in parsed
            else {"palette": "DARK", "bg": "#0A0F1E", "accent": "#3B82F6", "text": "#F9FAFB",
                  "text2": "#9CA3AF", "cover_title_size": 68, "slide_title_size": 44,
                  "subtitle_size": 28, "body_size": 21}
        )
        logger.info("  [design_resolver] palette=%s", design_tokens.get("palette", "?"))
        if ctx.on_event:
            ctx.on_event("node_done", f"✅ {design_tokens.get('palette', 'DARK')} 팔레트 확정")
        return {**state, "design_tokens": design_tokens}
    return design_resolver_node


def make_layout_composer(ctx: NodeContext):
    async def layout_composer_node(state: AgentState) -> AgentState:
        from app.core.config import settings
        retry = state.get("retry_count", 0)
        msg = "✏️ 컴포넌트 설계 중..." if retry == 0 else f"✏️ 재시도 중... ({retry}/{settings.AGENT_MAX_RETRIES})"
        if ctx.on_event:
            ctx.on_event("node_start", msg)

        design_tokens = state.get("design_tokens", {})
        if ctx.gen_prompt:
            if isinstance(ctx.gen_prompt, str):
                composer_system = ctx.gen_prompt
            else:
                composer_system = "\n".join(
                    b["text"] for b in ctx.gen_prompt
                    if isinstance(b, dict) and b.get("type") == "text"
                )
        else:
            composer_system = LAYOUT_COMPOSER_PROMPT

        human_text = (
            f"Command: {state['command']}\n\n"
            f"Plan:\n{state.get('plan', '')}\n\n"
            f"Mode: {state.get('mode', 'single_edit')}\n\n"
            f"Design tokens: {json.dumps(design_tokens, ensure_ascii=False)}\n\n"
            f"Current slide:\n{state['slide_context']}"
        )
        messages = [SystemMessage(content=composer_system), HumanMessage(content=human_text)]

        raw_content = ""
        try:
            async for chunk in ctx.llm.astream(messages):
                raw = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw, list):
                    token = "".join(b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw) if raw else ""
                if token:
                    raw_content += token
                    if ctx.on_token:
                        ctx.on_token(token)
        except Exception as exc:
            logger.warning("  [layout_composer] astream failed: %s", exc)

        parsed = _extract_json(raw_content)
        ops: list = []
        summary: str = ""
        if isinstance(parsed, dict):
            summary = parsed.get("summary", "")
            if "ops" in parsed:
                ops = _flatten_ops(parsed["ops"] if isinstance(parsed["ops"], list) else [])
        elif isinstance(parsed, list):
            ops = _flatten_ops(parsed)

        if not ops:
            logger.warning("  [layout_composer] parse fail  raw=%r", raw_content[:300])
        logger.info("  [layout_composer] ops=%d  parse_ok=%s", len(ops), parsed is not None)
        if ctx.on_event:
            ctx.on_event("node_done", f"✅ {len(ops)}개 op 생성")
        return {**state, "component_specs": ops, "result_summary": summary, "messages": []}
    return layout_composer_node
