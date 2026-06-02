import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Annotated, AsyncGenerator, TypedDict
from uuid import UUID

from pydantic import BaseModel, Field

logger = logging.getLogger("slidant.agent")

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from app.core.security import decrypt_api_key


# ── Structured output schema (RFC 6902 JSON Patch) ────────────────────────────

class JsonPatchOp(BaseModel):
    op: str = Field(..., description="RFC 6902 op: 'add' | 'replace' | 'remove'")
    path: str = Field(..., description="JSON Pointer path e.g. '/-' or '/{id}/properties/{key}'")
    value: dict | list | str | int | float | bool | None = Field(
        default=None, description="Value for add/replace ops"
    )


class SlidePatches(BaseModel):
    summary: str = Field(..., description="한국어 1-2문장 작업 요약")
    ops: list[JsonPatchOp] = Field(..., description="RFC 6902 JSON Patch 작업 목록")


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-pro"


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    command: str
    slide_context: str
    agent_name: str
    conversation_history: str  # 최근 N턴 대화 기록 (세션 유지용)
    plan: str               # planner 노드 출력
    image_urls: list        # image_resolver가 미리 조회한 URL 목록
    result_patches: list    # RFC 6902 JSON Patch ops
    result_summary: str     # 사람이 읽을 수 있는 작업 요약
    retry_count: int        # generator 재시도 횟수


_SHARED_RULES = """
OUTPUT FORMAT — MUST FOLLOW EXACTLY. No markdown, no explanation, only JSON:
{"summary":"한국어 1-2문장 요약","ops":[{"op":"...","path":"...","value":...},...]}

PATH rules:
  Modify property  → "/{component_id}/properties/{key}"
  Add component    → "/-"
  Delete component → "/{component_id}"
  Add slide (MUST have components) → "/slides/-"

LIMIT: max 5 slides per request.

━━ DESIGN SYSTEM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CANVAS: 960×540px. Component ops order = render order (first = bottom layer).

LAYER ORDER (CRITICAL): background → accent bars → image → overlay → text
  1. Background shape/image: ALWAYS (0,0,960,540)
  2. Overlay shape on images: bgColor:#000000 opacity:0.45 (for text readability)
  3. Accent bars: left bar (0,0,6,540) or top bar (0,0,960,8)
  4. Title divider: (80, titleBottom+10, 60, 4)
  5. Content shapes/boxes
  6. Text (always on top)

TYPOGRAPHY HIERARCHY (never skip):
  H1 cover title : fontSize:64-72 fontWeight:700 h:110
  H2 slide title : fontSize:44-48 fontWeight:700 h:80
  Subtitle       : fontSize:26-32 fontWeight:400 h:55
  Body item      : fontSize:20-22 fontWeight:400 h:40
  Caption        : fontSize:14-16 fontWeight:400 h:30

TEXT SAFE ZONE: x≥80, x+w≤880. Never use fontSize<18 for main content.

COLOR PALETTES — pick one per presentation:
  DARK  : bg:#0A0F1E accent:#3B82F6 text:#F9FAFB text2:#9CA3AF
  WARM  : bg:#1C0F0A accent:#F59E0B text:#FEF3C7 text2:#D97706
  LIGHT : bg:#F8FAFC accent:#7C3AED text:#0F172A text2:#475569
  NATURE: bg:#0D1F1A accent:#34D399 text:#ECFDF5 text2:#6EE7B7
  SLATE : bg:#1E293B accent:#F1F5F9 text:#F8FAFC text2:#94A3B8

IMAGE RULES:
  Background  : w:960 h:540 objectFit:cover — ALWAYS full canvas
  Hero panel  : w:400 h:420 (x:520 y:60) — never w<300
  Portrait    : w:220 h:220 borderRadius:110 (centered)
  Thumbnail   : w:260 h:180 borderRadius:8 — never w<240
  ALWAYS add dark overlay shape on top of background images for text readability.
  IMAGE PLACEHOLDER RULES (CRITICAL):
  - 이미지가 필요한 경우 src/url 필드 없이 placeholder로 생성할 것
  - {"type":"image","properties":{"placeholder":true,"alt":"이미지 설명","position":{...},"size":{...}}}
  - src, url 필드 절대 생성 금지
  - 사용자가 직접 이미지를 업로드하거나 URL을 입력함

LAYOUT TEMPLATES:
  [COVER]   bg(0,0,960,540) → overlay(0,300,960,240,op:0.8) → left-bar(0,0,6,540) →
            title(80,170,800,110,fs:68,fw:700) → subtitle(80,300,800,55,fs:28) → label(80,380,400,30,fs:16)
  [CONTENT] bg → left-bar → title(60,60,420,80,fs:44,fw:700) → divider(60,148,60,4) →
            body×4(60,175+55n,420,40,fs:21) → hero-image(520,60,400,420,r:8)
  [TOC]     bg → side-panel(0,0,320,540,bg:accent,op:0.9) → section-title(40,200,240,100,fs:40,fw:700,clr:#FFF) →
            item-shape×5(360,100+80n,540,60,r:4,bg:surface) → item-text×5(420,115+80n,420,30,fs:22,fw:600)
  [QUOTE]   bg → top-bar(0,0,960,8) → bottom-bar(0,532,960,8) →
            quote-symbol(60,80,80,110,fs:96,fw:700,clr:accent) → quote-text(80,180,800,160,fs:34,fw:300) →
            author(80,370,800,40,fs:22,fw:600) → role(80,415,800,30,fs:16)
  [CLOSING] bg → left-bar → right-bar(954,0,6,540) →
            center-circle(380,140,200,200,r:100,bg:accent,op:0.2) →
            main(80,220,800,100,fs:64,fw:700,center) → sub(80,340,800,50,fs:26,center) →
            contact(80,430,800,30,fs:18,center)

ACCENT SHAPES (add at least 2 per slide):
  Left bar    : (0,0,6,540)
  Top bar     : (0,0,960,8)
  Divider     : (80,Y,60,4)
  Callout box : (60,Y,840,H,r:8,op:0.15)
  Number box  : (360,Y,50,50,r:4,bg:accent)
  Bottom rule : (0,532,960,8)

FEW-SHOT — Professional dark cover slide:
{"summary":"어두운 배경에 바다 이미지 placeholder와 큰 제목, 액센트 바를 적용한 표지 슬라이드","ops":[
  {"op":"add","path":"/-","value":{"type":"image","properties":{"placeholder":true,"alt":"바다 배경 이미지","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#000000","position":{"x":0,"y":0},"size":{"w":960,"h":540},"opacity":0.55}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#3B82F6","position":{"x":0,"y":0},"size":{"w":6,"h":540}}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#3B82F6","position":{"x":80,"y":275},"size":{"w":60,"h":4}}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"제목 텍스트","position":{"x":80,"y":160},"size":{"w":800,"h":110},"fontSize":68,"fontWeight":700,"color":"#F9FAFB","align":"left"}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"부제목 설명","position":{"x":80,"y":295},"size":{"w":700,"h":55},"fontSize":28,"fontWeight":400,"color":"#9CA3AF","align":"left"}}}
]}
"""

def _make_cached_system_prompt(role_intro: str) -> list[dict]:
    """
    Anthropic prompt caching 형식으로 system prompt 구성.
    role_intro(짧은 텍스트) + _SHARED_RULES(긴 정적 블록, cache_control 적용).
    _SHARED_RULES는 토큰이 많고 변하지 않으므로 캐시 효과가 크다.
    """
    return [
        {"type": "text", "text": role_intro},
        {
            "type": "text",
            "text": _SHARED_RULES,
            "cache_control": {"type": "ephemeral"},
        },
    ]


SYSTEM_PROMPTS = {
    "content": _make_cached_system_prompt(
        "You are ContentAgent for Slidant. Create rich, well-structured text content."
    ),
    "design": _make_cached_system_prompt(
        "You are DesignAgent for Slidant. Apply professional visual design — colors, typography, layout, accents."
    ),
    "layout": _make_cached_system_prompt(
        "You are LayoutAgent for Slidant. Optimize positioning, spacing, visual hierarchy."
    ),
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


def _make_llm(api_key_plaintext: str, provider: str = "anthropic", json_mode: bool = False):
    if provider == "openrouter":
        extra: dict = {}
        if json_mode:
            extra["response_format"] = {"type": "json_object"}
        return ChatOpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=api_key_plaintext,
            model=OPENROUTER_DEFAULT_MODEL,
            max_tokens=8192,          # 전체 토큰 버짓 증가
            model_kwargs={
                "max_completion_tokens": 8192,
                "reasoning": {"max_tokens": 1024},  # 추론 토큰 1024로 제한 (나머지가 응답)
                **extra,
            },
        )
    # Anthropic: prompt caching 헤더 활성화 (betas 파라미터)
    return ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key_plaintext,
        max_tokens=4096,
        model_kwargs={
            "extra_headers": {"anthropic-beta": "prompt-caching-2024-07-31"},
        },
    )


def _extract_json(text: str) -> dict | list | None:
    """LLM 응답에서 JSON 추출. 마크다운 코드블록, 중간 삽입 등 모두 처리."""
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


PLANNER_PROMPT = """\
You are a professional PPT design planner. Analyze the command and slide context, then produce a specific action plan.

RULES:
- Output ONLY plain Korean text. No JSON. No code blocks.
- Write 3-6 bullet lines starting with •
- Be SPECIFIC: mention exact hex colors, font sizes, positions, layout template name
- Reference design templates: [COVER] [CONTENT] [TOC] [QUOTE] [CLOSING]
- Always plan: 1) background layer, 2) accent elements, 3) typography hierarchy
- Start directly with the first bullet. No preamble.

Design principles to apply:
- Always include left accent bar (0,0,6,540)
- Background image needs dark overlay for readability
- Title 64-72pt, subtitle 26-32pt, body 20-22pt
- Choose coherent color palette: DARK/WARM/LIGHT/NATURE/SLATE

Example:
• [CONTENT] 레이아웃 적용 — DARK 팔레트 (#0A0F1E 배경, #3B82F6 액센트)
• 배경 shape (0,0,960,540) #0A0F1E 단색
• 좌측 액센트 바 (0,0,6,540) #3B82F6
• 제목 "돼지국밥의 유래" — 흰색(#F9FAFB) 44pt 굵게, 좌상단 (60,60,420,80)
• 제목 아래 구분선 (60,148,60,4) #3B82F6
• 본문 텍스트 4줄 — #9CA3AF 21pt, (60,175~340)
• 우측 음식 사진 (520,60,400,420) picsum seed:korean-food"""

MAX_RETRIES = 2


def build_agent_graph(
    role: str,
    llm,
    llm_plain,
    system_prompt: list[dict] | str | None = None,
    on_token: "Callable[[str], None] | None" = None,
    on_event: "Callable[[str, str], None] | None" = None,  # (event_type, message)
) -> StateGraph:
    from typing import Callable
    gen_prompt = system_prompt or SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS["content"])
    # Anthropic provider: structured output via tool_use (with_structured_output)
    # OpenRouter/openai provider: 기존 astream + _extract_json fallback 유지
    _is_anthropic = isinstance(llm, ChatAnthropic)
    llm_structured = llm.with_structured_output(SlidePatches, include_raw=True) if _is_anthropic else None

    # ── Node 1: planner — 자연어 계획, SSE push ──────────────────
    async def planner_node(state: AgentState) -> AgentState:
        logger.info("  [planner] 계획 수립 중...")
        if on_event: on_event("node_start", "🧠 계획 수립 중...")
        history = state.get("conversation_history", "")
        history_section = f"\n\nPrevious conversation (for context):\n{history}" if history else ""
        messages = [
            SystemMessage(content=PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}{history_section}\n\nSlide context:\n{state['slide_context']}"),
        ]
        plan = ""
        async for chunk in llm_plain.astream(messages):  # json_mode 없는 LLM
            raw = chunk.content if hasattr(chunk, "content") else ""
            # reasoning 모델은 content가 list: [{"type":"thinking",...},{"type":"text",...}]
            if isinstance(raw, list):
                token = "".join(
                    block.get("text", "") for block in raw
                    if isinstance(block, dict) and block.get("type") == "text"
                )
            else:
                token = str(raw) if raw else ""
            if token:
                plan += token
                if on_token:
                    on_token(token)  # 자연어 계획 실시간 표시
        logger.info("  [planner] 계획: %r", plan[:200])
        if on_event: on_event("node_done", "✅ 계획 완료")
        return {**state, "plan": plan, "messages": []}

    # ── Node 2: generator ─────────────────────────────────────────
    async def generator_node(state: AgentState) -> AgentState:
        retry = state.get("retry_count", 0)
        logger.info("  [generator] JSON ops 생성 (retry=%d)", retry)
        msg = "⚙️ 슬라이드 생성 중..." if retry == 0 else f"⚙️ 재시도 중... ({retry}/{MAX_RETRIES})"
        if on_event: on_event("node_start", msg)

        human_text = (
            f"Command: {state['command']}\n\n"
            f"Action plan:\n{state.get('plan', '')}\n\n"
            f"Slide context:\n{state['slide_context']}"
        )

        patches: list = []
        summary: str = ""

        if llm_structured is not None:
            # Anthropic: with_structured_output (tool_use) → 보장된 JSON Patch
            messages = [
                SystemMessage(content=gen_prompt),
                HumanMessage(content=human_text),
            ]
            try:
                result_raw = await llm_structured.ainvoke(messages)
                parsed_model: SlidePatches | None = result_raw.get("parsed") if isinstance(result_raw, dict) else None
                if parsed_model is None:
                    # include_raw=True → {"raw": ..., "parsed": ..., "parsing_error": ...}
                    parsing_error = result_raw.get("parsing_error") if isinstance(result_raw, dict) else None
                    logger.warning("  [generator] structured output parse error: %s", parsing_error)
                else:
                    patches = _flatten_ops([op.model_dump(exclude_none=True) for op in parsed_model.ops])
                    summary = parsed_model.summary
            except Exception as exc:
                logger.warning("  [generator] structured output failed (%s), falling back to astream", exc)
                # fallback: raw stream + regex parse
                messages_fallback = [
                    SystemMessage(content=gen_prompt),
                    HumanMessage(content=human_text),
                ]
                raw_content = ""
                async for chunk in llm.astream(messages_fallback):
                    raw = chunk.content if hasattr(chunk, "content") else ""
                    if isinstance(raw, list):
                        token = "".join(
                            block.get("text", "") for block in raw
                            if isinstance(block, dict) and block.get("type") == "text"
                        )
                    else:
                        token = str(raw) if raw else ""
                    if token:
                        raw_content += token
                parsed = _extract_json(raw_content)
                if parsed is None:
                    logger.warning("  [generator] parse fail  raw=%r", raw_content[:300])
                elif isinstance(parsed, dict) and "ops" in parsed:
                    patches = _flatten_ops(parsed["ops"] if isinstance(parsed["ops"], list) else [])
                    summary = parsed.get("summary", "")
                elif isinstance(parsed, list):
                    patches = _flatten_ops(parsed)
        else:
            # OpenRouter / non-Anthropic: 기존 astream + _extract_json 방식
            messages = [
                SystemMessage(content=gen_prompt if isinstance(gen_prompt, str) else
                              "\n".join(block["text"] for block in gen_prompt
                                        if isinstance(block, dict) and block.get("type") == "text")),
                HumanMessage(content=human_text),
            ]
            raw_content = ""
            async for chunk in llm.astream(messages):
                raw = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw, list):
                    token = "".join(
                        block.get("text", "") for block in raw
                        if isinstance(block, dict) and block.get("type") == "text"
                    )
                else:
                    token = str(raw) if raw else ""
                if token:
                    raw_content += token
            parsed = _extract_json(raw_content)
            if parsed is None:
                logger.warning("  [generator] parse fail  raw=%r", raw_content[:300])
            elif isinstance(parsed, dict) and "ops" in parsed:
                patches = _flatten_ops(parsed["ops"] if isinstance(parsed["ops"], list) else [])
                summary = parsed.get("summary", "")
            elif isinstance(parsed, list):
                patches = _flatten_ops(parsed)

        if on_event: on_event("node_done", f"✅ {len(patches)}개 작업 생성")
        return {**state, "result_patches": patches, "result_summary": summary, "messages": []}

    # ── Node 4: validator (Python only, no LLM) ───────────────────
    def validator_node(state: AgentState) -> AgentState:
        patches = state.get("result_patches", [])
        valid = [
            op for op in patches
            if isinstance(op, dict) and op.get("op") in ("add", "replace", "remove") and "path" in op
        ]
        invalid = len(patches) - len(valid)
        if invalid:
            logger.warning("  [validator] %d개 무효 op 제거", invalid)
        logger.info("  [validator] valid ops=%d  retry=%d", len(valid), state.get("retry_count", 0))
        return {**state, "result_patches": valid}

    # ── Node 5: formatter — Python, patches → 사람이 읽는 설명 ──────
    def formatter_node(state: AgentState) -> AgentState:
        patches = state.get("result_patches", [])
        llm_summary = state.get("result_summary", "")

        if not patches:
            return state

        lines: list[str] = []
        for op in patches:
            kind = op.get("op")
            path = op.get("path", "")
            value = op.get("value", {})
            props = value.get("properties", {}) if isinstance(value, dict) else {}
            comp_type = value.get("type", "") if isinstance(value, dict) else ""

            if kind == "add" and path == "/-":
                if comp_type == "text":
                    content = str(props.get("content", ""))
                    preview = content[:40] + "…" if len(content) > 40 else content
                    fs = props.get("fontSize", "")
                    fw = "굵게 " if props.get("fontWeight", 400) >= 700 else ""
                    color = props.get("color", "")
                    lines.append(f'✏️ 텍스트 추가  "{preview}"')
                    if fs or fw or color:
                        lines.append(f'   {fw}{fs}pt  {color}')
                elif comp_type == "shape":
                    bg = props.get("bgColor", props.get("color", ""))
                    sz = props.get("size", {})
                    lines.append(f'🔷 도형 추가  색상 {bg}  {sz.get("w","?")}×{sz.get("h","?")}px')
                elif comp_type == "image":
                    src = props.get("src", props.get("url", ""))
                    lines.append(f'🖼 이미지 추가  {src[:60]}')
                else:
                    lines.append(f'➕ {comp_type} 컴포넌트 추가')

            elif kind == "add" and path.startswith("/slides/"):
                title = value.get("title", "") if isinstance(value, dict) else ""
                n_comp = len(value.get("components", [])) if isinstance(value, dict) else 0
                lines.append(f'📄 슬라이드 추가  "{title}"  컴포넌트 {n_comp}개')

            elif kind == "replace":
                parts = path.strip("/").split("/")
                if "properties" in parts:
                    key = parts[-1]
                    val = op.get("value", "")
                    labels = {"content": "텍스트", "bgColor": "배경색", "color": "글자색",
                              "fontSize": "폰트 크기", "fontWeight": "굵기"}
                    lines.append(f'✏️ {labels.get(key, key)} 변경 → {str(val)[:40]}')

            elif kind == "remove":
                lines.append(f'🗑 컴포넌트 삭제')

        # LLM summary가 있으면 먼저, 그 다음 변경 목록
        formatted = ""
        if llm_summary:
            formatted = llm_summary.strip() + "\n\n"
        if lines:
            formatted += "\n".join(lines)

        logger.info("  [formatter] %d ops → %d lines", len(patches), len(lines))
        return {**state, "result_summary": formatted.strip()}

    # ── Conditional: retry or done ────────────────────────────────
    def should_retry(state: AgentState) -> str:
        retry = state.get("retry_count", 0)
        if not state.get("result_patches") and retry < MAX_RETRIES:
            logger.info("  [validator] ops 없음 → generator 재시도 (%d/%d)", retry + 1, MAX_RETRIES)
            return "retry"
        return "done"

    def increment_retry(state: AgentState) -> AgentState:
        return {**state, "retry_count": state.get("retry_count", 0) + 1}

    # ── Graph 조립 ────────────────────────────────────────────────
    # START → planner → generator → validator → formatter → END
    #                       ↑______________|  (retry)
    graph = StateGraph(AgentState)
    graph.add_node("planner", planner_node)
    graph.add_node("generator", generator_node)
    graph.add_node("validator", validator_node)
    graph.add_node("formatter", formatter_node)
    graph.add_node("retry_inc", increment_retry)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "generator")
    graph.add_edge("generator", "validator")
    graph.add_conditional_edges("validator", should_retry, {
        "retry": "retry_inc",
        "done": "formatter",
    })
    graph.add_edge("formatter", END)
    graph.add_edge("retry_inc", "generator")

    return graph.compile()


def _flatten_ops(ops: list) -> list[dict]:
    result = []
    for item in ops:
        if isinstance(item, list):
            result.extend(i for i in item if isinstance(i, dict))
        elif isinstance(item, dict):
            result.append(item)
    return result


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
    on_token: "Callable[[str], None] | None" = None,
    on_event: "Callable[[str, str], None] | None" = None,
    conversation_history: str = "",
) -> tuple[list[dict], str, str]:
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

    from typing import Callable
    api_key = decrypt_api_key(encrypted_api_key)
    # Anthropic: 두 LLM 모두 prompt caching 헤더 포함; json_mode 구분 불필요 (structured output 사용)
    llm_json  = _make_llm(api_key, provider, json_mode=False)  # generator: structured output으로 대체
    llm_plain = _make_llm(api_key, provider, json_mode=False)  # planner: 자연어
    # system_prompt가 문자열로 넘어온 경우(커스텀 Agent) cached list 형식으로 래핑
    resolved_prompt: list[dict] | str | None = system_prompt
    if isinstance(system_prompt, str):
        resolved_prompt = _make_cached_system_prompt(system_prompt)
    graph = build_agent_graph(role, llm_json, llm_plain, resolved_prompt, on_token=on_token, on_event=on_event)

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
