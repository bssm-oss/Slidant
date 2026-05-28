import json
from datetime import datetime, timezone
from typing import Annotated, AsyncGenerator, TypedDict
from uuid import UUID

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.core.security import decrypt_api_key


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


def _make_llm(api_key_plaintext: str, model: str = "claude-sonnet-4-6") -> ChatAnthropic:
    return ChatAnthropic(
        model=model,
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


async def run_agent(
    *,
    role: str,
    command: str,
    components: list[dict],
    encrypted_api_key: str,
) -> tuple[list[dict], str]:
    """
    Returns: (patch_ops, agent_response_text)
    """
    api_key = decrypt_api_key(encrypted_api_key)
    llm = _make_llm(api_key)
    graph = build_agent_graph(role, llm)
    slide_context = build_slide_context(components)

    result = await graph.ainvoke({
        "messages": [],
        "command": command,
        "slide_context": slide_context,
        "agent_name": role,
        "result_patches": [],
    })

    return result.get("result_patches", []), slide_context
