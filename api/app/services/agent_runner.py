import json
from datetime import datetime, timezone
from typing import Annotated, AsyncGenerator, TypedDict
from uuid import UUID

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.core.security import decrypt_api_key

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free"


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    command: str
    slide_context: str       # HTML string 형태의 슬라이드 컨텍스트
    agent_name: str
    result_patches: list     # RFC 6902 JSON Patch ops


SYSTEM_PROMPTS = {
    "content": """You are ContentAgent for Slidant, an AI presentation tool.
Your role: improve and generate text content for slides.
Input: current slide context (HTML with data-component-id attributes) + user command.
Output: JSON array of RFC 6902 patch operations targeting component properties.
Always respond with valid JSON only. No explanation outside JSON.
Example output: [{"op": "replace", "path": "/{component_id}/properties/content", "value": "improved text"}]""",

    "design": """You are DesignAgent for Slidant, an AI presentation tool.
Your role: improve visual design — typography, colors, sizing, emphasis.
Input: current slide context (HTML with data-component-id attributes) + user command.
Output: JSON array of RFC 6902 patch operations targeting component properties.
Use semantic values only (e.g. "size": "xl", "weight": "bold", not raw pixel values).
Always respond with valid JSON only. No explanation outside JSON.""",

    "layout": """You are LayoutAgent for Slidant, an AI presentation tool.
Your role: optimize component positioning and layout structure.
Input: current slide context (HTML with data-component-id attributes) + user command.
Output: JSON array of RFC 6902 patch operations targeting component position/size/order.
Always respond with valid JSON only. No explanation outside JSON.""",
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
            max_tokens=2048,
        )
    return ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key_plaintext,
        max_tokens=2048,
    )


def build_agent_graph(role: str, llm: ChatAnthropic) -> StateGraph:
    system_prompt = SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS["content"])

    def agent_node(state: AgentState) -> AgentState:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Command: {state['command']}\n\nSlide context:\n{state['slide_context']}"),
        ]
        response = llm.invoke(messages)
        try:
            patches = json.loads(response.content)
            if not isinstance(patches, list):
                patches = []
        except (json.JSONDecodeError, AttributeError):
            patches = []

        return {**state, "result_patches": patches, "messages": [response]}

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", END)
    return graph.compile()


def _mock_patches(role: str, command: str, components: list[dict]) -> list[dict]:
    """크레딧 없을 때 사용하는 Mock 응답"""
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
                "path": f"/{comp['id']}/properties/weight",
                "value": "bold",
            })
    return patches


async def run_agent(
    *,
    role: str,
    command: str,
    components: list[dict],
    encrypted_api_key: str,
    provider: str = "anthropic",
) -> tuple[list[dict], str]:
    """
    Returns: (patch_ops, agent_response_text)
    """
    from app.core.config import settings

    slide_context = build_slide_context(components)

    # Mock 모드: MOCK_AGENT=true 또는 크레딧 부족 시 fallback
    if getattr(settings, "MOCK_AGENT", False):
        return _mock_patches(role, command, components), slide_context

    api_key = decrypt_api_key(encrypted_api_key)
    llm = _make_llm(api_key, provider)
    graph = build_agent_graph(role, llm)

    try:
        result = await graph.ainvoke({
            "messages": [],
            "command": command,
            "slide_context": slide_context,
            "agent_name": role,
            "result_patches": [],
        })
        return result.get("result_patches", []), slide_context
    except Exception as e:
        err_str = str(e)
        # 크레딧 부족 → mock으로 fallback
        if "credit balance" in err_str or "insufficient" in err_str.lower():
            return _mock_patches(role, command, components), slide_context
        raise
