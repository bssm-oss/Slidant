"""
agent_runner — 공개 API.

노드/프롬프트/그래프 조립 로직은 app.agent 패키지에 있음.
이 파일은 run_agent() + 컨텍스트 빌드 유틸만 노출.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import TYPE_CHECKING

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from app.core.security import decrypt_api_key

if TYPE_CHECKING:
    from typing import Callable

logger = logging.getLogger("slidant.agent")

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# re-export: 다른 모듈에서 직접 import 하던 것들
from app.agent.state import AgentState  # noqa: F401
from app.agent.prompts import (  # noqa: F401
    SYSTEM_PROMPTS, _make_cached_system_prompt,
    SLIDE_COMPOSER_PROMPT, HTML_EDITOR_PROMPT,
    COMPONENT_EDITOR_PROMPT, LAYOUT_COMPOSER_PROMPT,
    UNIFIED_PLANNER_PROMPT, PLANNER_PROMPT,
)


# ── LLM 팩토리 ────────────────────────────────────────────────────────────────

def _make_llm(api_key_plaintext: str, provider: str = "anthropic", json_mode: bool = False):
    from app.core.config import settings

    if provider == "openrouter":
        extra: dict = {}
        if json_mode:
            extra["response_format"] = {"type": "json_object"}
        return ChatOpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=api_key_plaintext,
            model=settings.OPENROUTER_MODEL,
            max_tokens=8192,
            model_kwargs={
                "max_completion_tokens": 8192,
                "reasoning": {"max_tokens": 1024},
                **extra,
            },
        )
    return ChatAnthropic(
        model=settings.ANTHROPIC_MODEL,
        api_key=api_key_plaintext,
        max_tokens=settings.AGENT_MAX_TOKENS,
        model_kwargs={
            "extra_headers": {"anthropic-beta": "prompt-caching-2024-07-31"},
        },
    )


# ── JSON 추출 ─────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | list | None:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    for pattern in (r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"):
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    return None


# ── 슬라이드 컨텍스트 빌더 ────────────────────────────────────────────────────

def build_slide_context(components: list[dict]) -> str:
    parts = []
    for comp in components:
        props_str = json.dumps(comp.get("properties", {}), ensure_ascii=False)
        parts.append(
            f'<div data-component-id="{comp["id"]}" data-type="{comp["type"]}">'
            f'<props>{props_str}</props>'
            f'</div>'
        )
    return f'<slide>{"".join(parts)}</slide>'


def build_all_slides_context(all_slides: list[dict]) -> str:
    lines = [f"<presentation_structure total_slides='{len(all_slides)}'>"]
    for s in all_slides:
        comp_count = len(s.get("components", []))
        title = s.get("title") or "(제목 없음)"
        is_empty = "EMPTY" if comp_count == 0 else f"{comp_count}개 컴포넌트"
        lines.append(
            f'  <slide index="{s["order"]}" id="{s["id"]}" title="{title}" status="{is_empty}" />'
        )
    lines.append("</presentation_structure>")
    lines.append(
        "\nIMPORTANT: To fill or modify existing slides, use path '/{slide_id}/...' or add "
        "components to the current slide with path '/-'. "
        "Do NOT add '/slides/-' ops for slides that already exist."
    )
    return "\n".join(lines)


def build_slide_context_from_html(html_content: str) -> str:
    return html_content or "(빈 슬라이드)"


# ── mock / helpers ────────────────────────────────────────────────────────────

def _flatten_ops(ops: list) -> list[dict]:
    result = []
    for item in ops:
        if isinstance(item, list):
            result.extend(i for i in item if isinstance(i, dict))
        elif isinstance(item, dict):
            result.append(item)
    return result


def _check_design_rules(add_ops: list[dict]) -> list[str]:
    warnings = []
    props_list = [op.get("value", {}).get("properties", {}) for op in add_ops]
    has_background = any(
        props.get("size", {}).get("w", 0) >= 900 and props.get("size", {}).get("h", 0) >= 500
        for props in props_list
    )
    if not has_background:
        warnings.append("배경 요소(960×540) 없음")
    small_text = [
        props.get("content", "")[:20]
        for props in props_list
        if props.get("fontSize", 99) < 18 and props.get("content")
    ]
    if small_text:
        warnings.append(f"fontSize<18 텍스트: {small_text[:3]}")
    return warnings


def _mock_patches(role: str, command: str, components: list[dict]) -> list[dict]:
    if not components:
        return [{"op": "add", "path": "/-", "value": {
            "type": "text",
            "properties": {
                "content": f"[MOCK] {command}",
                "position": {"x": 100, "y": 200},
                "size": {"w": 760, "h": 80},
                "fontSize": 36, "fontWeight": 700,
                "color": "#1A1523", "align": "center",
            },
        }}]
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


# ── run_agent (공개 API) ──────────────────────────────────────────────────────

async def run_agent(
    *,
    role: str,
    command: str,
    components: list[dict],
    encrypted_api_key: str,
    provider: str = "anthropic",
    system_prompt: str | None = None,
    all_slides: list[dict] | None = None,
    theme: dict | None = None,
    slide_scope_locked: bool = False,
    on_token: "Callable[[str], None] | None" = None,
    on_event: "Callable[[str, str], None] | None" = None,
    conversation_history: str = "",
    html_mode: bool = False,
) -> tuple[list[dict], str, str, str, list, bool]:
    """
    Returns: (patch_ops, slide_context, summary, html_output, html_slides, delete_slide)
    """
    from app.core.config import settings
    from app.agent.context import NodeContext
    from app.agent.graph import build_graph

    slide_context = build_slide_context(components)
    if all_slides:
        slide_context += "\n\n" + build_all_slides_context(all_slides)

    if theme:
        slide_context += f"""

<presentation_theme>
MANDATORY: Always use these exact colors and font for this presentation:
  background: {theme.get('bg', '#0A0F1E')}
  accent: {theme.get('accent', '#3B82F6')}
  text_primary: {theme.get('text', '#F9FAFB')}
  text_secondary: {theme.get('text2', '#9CA3AF')}
  font: {theme.get('font', 'Pretendard')}
Do NOT deviate from these values.
</presentation_theme>"""

    if slide_scope_locked:
        slide_context += """

<scope_constraint>
CRITICAL — SCOPE LOCKED TO CURRENT SLIDE:
- MUST ONLY add or modify components in THIS slide.
- Do NOT generate ANY '/slides/-' operations.
</scope_constraint>"""
        logger.info("  slide_scope_locked=True")

    logger.info("agent_run  role=%s  components=%d  slides=%d  command=%r  scope_locked=%s",
                role, len(components), len(all_slides or []), command[:80], slide_scope_locked)

    if getattr(settings, "MOCK_AGENT", False):
        logger.info("mock_mode  returning mock patches")
        patches = _mock_patches(role, command, components)
        return patches, slide_context, "[MOCK] 테스트 응답", "", [], False

    api_key = decrypt_api_key(encrypted_api_key)
    llm       = _make_llm(api_key, provider, json_mode=False)
    llm_plain = _make_llm(api_key, provider, json_mode=False)

    resolved_prompt = system_prompt
    if isinstance(system_prompt, str):
        resolved_prompt = _make_cached_system_prompt(system_prompt)

    ctx = NodeContext(
        llm=llm,
        llm_plain=llm_plain,
        gen_prompt=resolved_prompt or SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS["content"]),
        on_token=on_token,
        on_event=on_event,
        slide_scope_locked=slide_scope_locked,
    )
    graph = build_graph(ctx, html_mode=html_mode)

    t0 = time.perf_counter()
    try:
        result = await graph.ainvoke({
            "messages": [],
            "command": command,
            "slide_context": slide_context,
            "agent_name": role,
            "conversation_history": conversation_history,
            "plan": "",
            "image_urls": [],
            "result_patches": [],
            "result_summary": "",
            "retry_count": 0,
            "mode": "single_edit",
            "component_map": {},
            "design_tokens": {},
            "component_specs": [],
            "html_output": "",
            "html_slides": [],
            "slide_specs": [],
            "slide_index": 0,
            "current_slide_spec": {},
            "search_queries": [],
            "search_results": [],
            "ops_queue": [],
            "ops_results": [],
            "current_op": {},
            "all_slides_context": all_slides or [],
            "review_ok": True,
            "delete_slide": False,
        })
        patches      = result.get("result_patches", [])
        summary      = result.get("result_summary", "")
        html_output  = result.get("html_output", "")
        html_slides  = result.get("html_slides", [])
        delete_slide = result.get("delete_slide", False)
        ms = (time.perf_counter() - t0) * 1000
        logger.info("llm_done  provider=%s  patches=%d  delete=%s  summary=%r  %.0fms",
                    provider, len(patches), delete_slide, summary[:60], ms)
        if not patches and not html_output and not html_slides and not delete_slide:
            msgs = result.get("messages", [])
            if msgs:
                last = msgs[-1]
                logger.warning("llm_empty_patches  content=%r", str(getattr(last, "content", last))[:400])
        return patches, slide_context, summary, html_output, html_slides, delete_slide
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        err_str = str(e)
        logger.warning("llm_error  %.0fms  %s", ms, err_str[:120])
        if "credit balance" in err_str or "insufficient" in err_str.lower():
            logger.info("fallback  credit exhausted → mock")
            return _mock_patches(role, command, components), slide_context, "[Mock fallback] 크레딧 부족", "", [], False
        raise
