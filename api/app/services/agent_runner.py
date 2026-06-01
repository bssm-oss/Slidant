import json
import logging
import time
from datetime import datetime, timezone
from typing import Annotated, AsyncGenerator, TypedDict
from uuid import UUID

logger = logging.getLogger("slidant.agent")

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.core.security import decrypt_api_key

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-chat"


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    command: str
    slide_context: str
    agent_name: str
    result_patches: list     # RFC 6902 JSON Patch ops
    result_summary: str      # 사람이 읽을 수 있는 작업 요약


_SHARED_RULES = """
CRITICAL OUTPUT FORMAT — MUST FOLLOW EXACTLY:
Your ENTIRE response = one JSON object. NO markdown. NO explanation. NO code fences. ONLY the JSON.

{
  "summary": "한국어 1-2문장 요약",
  "ops": [
    {"op": "...", "path": "...", "value": ...},
    ...
  ]
}

EACH item in "ops" MUST have EXACTLY these fields:
  "op"   : "replace" | "add" | "remove"
  "path" : string (see rules below)
  "value": any (required for replace/add)

PATH rules:
  Modify component property → "/{component_id}/properties/{key}"
     Example: "/abc-123/properties/content"
  Create new component      → "/-"
  Delete component          → "/{component_id}"
  Add new slide             → "/slides/-"

FEW-SHOT EXAMPLE (부산 바다 테마 슬라이드 1장 만들기):
{
  "summary": "부산 바다 테마로 배경을 파란색으로 설정하고 제목과 부제목을 추가했습니다.",
  "ops": [
    {"op": "add", "path": "/-", "value": {"type": "text", "properties": {"content": "부산 바다", "position": {"x": 80, "y": 160}, "size": {"w": 800, "h": 120}, "fontSize": 72, "fontWeight": 700, "color": "#FFFFFF", "align": "center"}}},
    {"op": "add", "path": "/-", "value": {"type": "text", "properties": {"content": "해운대의 푸른 물결", "position": {"x": 80, "y": 300}, "size": {"w": 800, "h": 60}, "fontSize": 32, "fontWeight": 400, "color": "#B3E0FF", "align": "center"}}},
    {"op": "add", "path": "/-", "value": {"type": "shape", "properties": {"bgColor": "#004080", "position": {"x": 0, "y": 0}, "size": {"w": 960, "h": 540}, "borderRadius": 0}}}
  ]
}

Canvas: 960×540px. Always produce valid, meaningful content. NEVER omit "op" or "path" from any ops item.
"""

SYSTEM_PROMPTS = {
    "content": f"""You are ContentAgent for Slidant, an AI presentation tool.
Role: generate and improve text content for slides.
{_SHARED_RULES}""",

    "design": f"""You are DesignAgent for Slidant, an AI presentation tool.
Role: create and improve visual design — layout, colors, typography, styling.
{_SHARED_RULES}""",

    "layout": f"""You are LayoutAgent for Slidant, an AI presentation tool.
Role: optimize component positioning, sizing, and spatial arrangement.
{_SHARED_RULES}""",
}


def build_slide_context(components: list[dict]) -> str:
    """컴포넌트 목록 → HTML string (Agent 컨텍스트용)"""
    parts = []
    for comp in components:
        props_str = json.dumps(comp.get("properties", {}), ensure_ascii=False)
        parts.append(
            f'<div data-component-id="{comp["id"]}" data-type="{comp["type"]}">'
            f'<props>{props_str}</props>'
            f'</div>'
        )
    return f'<slide>{"".join(parts)}</slide>'


def _make_llm(api_key_plaintext: str, provider: str = "anthropic"):
    if provider == "openrouter":
        return ChatOpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=api_key_plaintext,
            model=OPENROUTER_DEFAULT_MODEL,
            max_tokens=4096,
            model_kwargs={"response_format": {"type": "json_object"}},
        )
    return ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key_plaintext,
        max_tokens=4096,
    )


def _extract_json(text: str) -> dict | list | None:
    """LLM 응답에서 JSON 추출. 마크다운 코드블록, 중간 삽입 등 모두 처리."""
    import re
    text = text.strip()

    # 1순위: 전체가 JSON인 경우 (json_mode)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2순위: ```json ... ``` 블록
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # 3순위: 텍스트 내 첫 번째 { ... } 또는 [ ... ] 블록
    for pattern in (r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"):
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue

    return None


def build_agent_graph(role: str, llm: ChatAnthropic, system_prompt: str | None = None) -> StateGraph:
    system_prompt = system_prompt or SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS["content"])

    def agent_node(state: AgentState) -> AgentState:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Command: {state['command']}\n\nSlide context:\n{state['slide_context']}"),
        ]
        response = llm.invoke(messages)
        patches: list = []
        summary: str = ""
        raw_content = str(getattr(response, 'content', ''))

        parsed = _extract_json(raw_content)
        if parsed is None:
            logger.warning("llm_parse_fail  raw=%r", raw_content[:400])
        elif isinstance(parsed, dict) and "ops" in parsed:
            raw_ops = parsed["ops"] if isinstance(parsed["ops"], list) else []
            # 중첩 list flatten: [[op1, op2]] → [op1, op2]
            patches = []
            for item in raw_ops:
                if isinstance(item, list):
                    patches.extend(i for i in item if isinstance(i, dict))
                elif isinstance(item, dict):
                    patches.append(item)
            summary = parsed.get("summary", "")
        elif isinstance(parsed, list):
            # 중첩 list flatten
            patches = []
            for item in parsed:
                if isinstance(item, list):
                    patches.extend(i for i in item if isinstance(i, dict))
                elif isinstance(item, dict):
                    patches.append(item)
        else:
            logger.warning("llm_bad_format  %r", str(parsed)[:200])

        logger.info("llm_parse_result  patches=%d  summary=%r", len(patches), summary[:60])
        return {**state, "result_patches": patches, "result_summary": summary, "messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", END)
    return graph.compile()


def _mock_patches(role: str, command: str, components: list[dict]) -> list[dict]:
    """크레딧 없을 때 사용하는 Mock 응답"""
    if not components:
        # 빈 슬라이드 → mock 컴포넌트 생성
        return [
            {"op": "add", "path": "/-", "value": {
                "type": "text",
                "properties": {
                    "content": f"[MOCK] {command}",
                    "position": {"x": 100, "y": 200},
                    "size": {"w": 760, "h": 80},
                    "fontSize": 36,
                    "fontWeight": 700,
                    "color": "#1A1523",
                    "align": "center",
                },
            }},
        ]
    patches = []
    for comp in components:
        if comp.get("type") == "text" and role in ("content", "custom"):
            patches.append({
                "op": "replace",
                "path": f"/{comp['id']}/properties/content",
                "value": f"[{role.upper()}] {comp.get('properties', {}).get('content', '')} (명령: {command})",
            })
        elif role == "design":
            patches.append({
                "op": "replace",
                "path": f"/{comp['id']}/properties/fontWeight",
                "value": 700,
            })
    return patches


async def run_agent(
    *,
    role: str,
    command: str,
    components: list[dict],
    encrypted_api_key: str,
    provider: str = "anthropic",
    system_prompt: str | None = None,
    all_slides: list[dict] | None = None,
) -> tuple[list[dict], str]:
    """
    Returns: (patch_ops, agent_response_text)
    """
    from app.core.config import settings

    slide_context = build_slide_context(components)
    if all_slides:
        slide_context += f"\n\n<presentation_structure>Total slides: {len(all_slides)}\n"
        for s in all_slides:
            slide_context += f"  Slide {s['order']+1}: id={s['id']} title={s.get('title') or '(no title)'}\n"
        slide_context += "</presentation_structure>"

    logger.info("agent_run  role=%s  components=%d  slides=%d  command=%r",
                role, len(components), len(all_slides or []), command[:80])

    # Mock 모드
    if getattr(settings, "MOCK_AGENT", False):
        logger.info("mock_mode  returning mock patches")
        patches = _mock_patches(role, command, components)
        logger.info("mock_done  patches=%d", len(patches))
        return patches, slide_context, "[MOCK] 테스트 응답"

    api_key = decrypt_api_key(encrypted_api_key)
    llm = _make_llm(api_key, provider)
    graph = build_agent_graph(role, llm, system_prompt)

    t0 = time.perf_counter()
    try:
        result = await graph.ainvoke({
            "messages": [],
            "command": command,
            "slide_context": slide_context,
            "agent_name": role,
            "result_patches": [],
        })
        patches = result.get("result_patches", [])
        summary = result.get("result_summary", "")
        ms = (time.perf_counter() - t0) * 1000
        logger.info("llm_done  provider=%s  patches=%d  summary=%r  %.0fms", provider, len(patches), summary[:60], ms)
        if not patches:
            msgs = result.get("messages", [])
            if msgs:
                last = msgs[-1]
                logger.warning("llm_empty_patches  content=%r", str(getattr(last, 'content', last))[:400])
        return patches, slide_context, summary
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        err_str = str(e)
        logger.warning("llm_error  %.0fms  %s", ms, err_str[:120])
        if "credit balance" in err_str or "insufficient" in err_str.lower():
            logger.info("fallback  credit exhausted → mock")
            return _mock_patches(role, command, components), slide_context, "[Mock fallback] 크레딧 부족"
        raise
