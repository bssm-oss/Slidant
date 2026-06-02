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
  Add component to CURRENT slide → "/-"
  Delete component → "/{component_id}"
  Add NEW slide with all components → "/slides/-"

FULL PRESENTATION MODE (전체 PPT 생성):
  플래너가 [PRESENTATION] 계획을 세우면 반드시 다음 규칙 적용:
  1. "/slides/-" op 여러 개 생성 (슬라이드 수 = 계획된 장 수)
  2. 각 "/slides/-" value에 "components" 배열 포함 — 레이어 순서 지킬 것
  3. "/-" (단일 컴포넌트 추가) op 절대 사용 금지 — 모든 컴포넌트는 해당 슬라이드 value.components 안에
  4. 각 슬라이드는 독립적으로 완성된 디자인

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

FEW-SHOT A — Single slide edit (current slide modification):
{"summary":"어두운 배경에 바다 이미지 placeholder와 큰 제목, 액센트 바를 적용한 표지 슬라이드","ops":[
  {"op":"add","path":"/-","value":{"type":"image","properties":{"placeholder":true,"alt":"바다 배경 이미지","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#000000","position":{"x":0,"y":0},"size":{"w":960,"h":540},"opacity":0.55}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#3B82F6","position":{"x":0,"y":0},"size":{"w":6,"h":540}}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"제목 텍스트","position":{"x":80,"y":160},"size":{"w":800,"h":110},"fontSize":68,"fontWeight":700,"color":"#F9FAFB","align":"left"}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"부제목 설명","position":{"x":80,"y":295},"size":{"w":700,"h":55},"fontSize":28,"fontWeight":400,"color":"#9CA3AF","align":"left"}}}
]}

FEW-SHOT B — Full presentation (전체 PPT 생성, 슬라이드 여러 장):
Command: "김치찌개 레시피 PPT 만들어줘"
{"summary":"김치찌개 레시피 5장 프레젠테이션 생성 — WARM 팔레트","ops":[
  {"op":"add","path":"/slides/-","value":{"title":"표지","components":[
    {"type":"shape","properties":{"bgColor":"#1C0F0A","position":{"x":0,"y":0},"size":{"w":960,"h":540}}},
    {"type":"image","properties":{"placeholder":true,"alt":"김치찌개 배경","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}},
    {"type":"shape","properties":{"bgColor":"#000000","position":{"x":0,"y":0},"size":{"w":960,"h":540},"opacity":0.55}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":80,"y":295},"size":{"w":60,"h":4}}},
    {"type":"text","properties":{"content":"얼큰한 김치찌개\n황금 레시피","position":{"x":80,"y":160},"size":{"w":800,"h":120},"fontSize":64,"fontWeight":700,"color":"#FEF3C7","align":"left","lineHeight":1.3}},
    {"type":"text","properties":{"content":"집에서 완성하는 감칠맛 끝판왕","position":{"x":80,"y":305},"size":{"w":700,"h":50},"fontSize":26,"fontWeight":400,"color":"#D97706","align":"left"}}
  ]}},
  {"op":"add","path":"/slides/-","value":{"title":"재료 준비","components":[
    {"type":"shape","properties":{"bgColor":"#1C0F0A","position":{"x":0,"y":0},"size":{"w":960,"h":540}}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}},
    {"type":"text","properties":{"content":"재료 준비","position":{"x":60,"y":60},"size":{"w":500,"h":70},"fontSize":44,"fontWeight":700,"color":"#FEF3C7","align":"left"}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":138},"size":{"w":60,"h":4}}},
    {"type":"text","properties":{"content":"• 묵은지 300g\n• 돼지고기 앞다리살 200g\n• 두부 1/2모\n• 대파 1대\n• 마늘 4쪽","position":{"x":60,"y":165},"size":{"w":400,"h":200},"fontSize":21,"fontWeight":400,"color":"#D97706","align":"left","lineHeight":1.6}},
    {"type":"image","properties":{"placeholder":true,"alt":"재료 모음 사진","position":{"x":520,"y":60},"size":{"w":400,"h":420},"borderRadius":8}}
  ]}},
  {"op":"add","path":"/slides/-","value":{"title":"조리 순서","components":[
    {"type":"shape","properties":{"bgColor":"#1C0F0A","position":{"x":0,"y":0},"size":{"w":960,"h":540}}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}},
    {"type":"text","properties":{"content":"조리 순서","position":{"x":60,"y":60},"size":{"w":500,"h":70},"fontSize":44,"fontWeight":700,"color":"#FEF3C7","align":"left"}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":138},"size":{"w":60,"h":4}}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":170},"size":{"w":36,"h":36},"borderRadius":18}},
    {"type":"text","properties":{"content":"1","position":{"x":60,"y":173},"size":{"w":36,"h":30},"fontSize":18,"fontWeight":700,"color":"#1C0F0A","align":"center"}},
    {"type":"text","properties":{"content":"김치를 먹기 좋은 크기로 자른다","position":{"x":110,"y":173},"size":{"w":400,"h":30},"fontSize":21,"fontWeight":400,"color":"#FEF3C7","align":"left"}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":230},"size":{"w":36,"h":36},"borderRadius":18}},
    {"type":"text","properties":{"content":"2","position":{"x":60,"y":233},"size":{"w":36,"h":30},"fontSize":18,"fontWeight":700,"color":"#1C0F0A","align":"center"}},
    {"type":"text","properties":{"content":"돼지고기와 함께 볶아 김치를 익힌다","position":{"x":110,"y":233},"size":{"w":400,"h":30},"fontSize":21,"fontWeight":400,"color":"#FEF3C7","align":"left"}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":290},"size":{"w":36,"h":36},"borderRadius":18}},
    {"type":"text","properties":{"content":"3","position":{"x":60,"y":293},"size":{"w":36,"h":30},"fontSize":18,"fontWeight":700,"color":"#1C0F0A","align":"center"}},
    {"type":"text","properties":{"content":"물 600ml 추가 후 20분 끓인다","position":{"x":110,"y":293},"size":{"w":400,"h":30},"fontSize":21,"fontWeight":400,"color":"#FEF3C7","align":"left"}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":60,"y":350},"size":{"w":36,"h":36},"borderRadius":18}},
    {"type":"text","properties":{"content":"4","position":{"x":60,"y":353},"size":{"w":36,"h":30},"fontSize":18,"fontWeight":700,"color":"#1C0F0A","align":"center"}},
    {"type":"text","properties":{"content":"두부, 대파 넣고 5분 더 끓인다","position":{"x":110,"y":353},"size":{"w":400,"h":30},"fontSize":21,"fontWeight":400,"color":"#FEF3C7","align":"left"}}
  ]}}
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


def build_all_slides_context(all_slides: list[dict]) -> str:
    """전체 슬라이드 구조 요약 — 빈 슬라이드 식별을 위해 component 수 포함."""
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
        "Do NOT add '/slides/-' ops for slides that already exist. "
        "To fill an EMPTY slide: the user must navigate to that slide first, "
        "OR use slide_ops with '/slides/-' ONLY for genuinely new slides."
    )
    return "\n".join(lines)


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
            max_tokens=8192,          # 전체 토큰 버짓 증가
            model_kwargs={
                "max_completion_tokens": 8192,
                "reasoning": {"max_tokens": 1024},  # 추론 토큰 1024로 제한 (나머지가 응답)
                **extra,
            },
        )
    # Anthropic: prompt caching 헤더 활성화 (betas 파라미터)
    return ChatAnthropic(
        model=settings.ANTHROPIC_MODEL,
        api_key=api_key_plaintext,
        max_tokens=settings.AGENT_MAX_TOKENS,
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

━━ FULL PRESENTATION MODE (최우선 규칙) ━━
명령에 다음 중 하나라도 포함되면 반드시 전체 프레젠테이션 계획을 수립해야 한다:
  키워드: PPT, 프레젠테이션, 발표자료, 슬라이드셋, 만들어, 제작, 작성
  조건: 현재 슬라이드가 비어있거나 슬라이드 수가 1개 이하

전체 프레젠테이션 계획 형식:
  [PRESENTATION] 총 N장 슬라이드 계획 (N = 5~7장)
  슬라이드 1: [COVER] — 표지 (제목, 부제목, 배경)
  슬라이드 2: [CONTENT] — 첫 번째 섹션
  슬라이드 3: [CONTENT] — 두 번째 섹션
  ...
  슬라이드 N: [CLOSING] — 마무리

  각 슬라이드마다: 팔레트, 배경색, 액센트색, 제목 텍스트, 본문 요소, 레이아웃 명시
  → generator는 각 슬라이드를 "/slides/-" op으로 생성한다

RULES:
- Output ONLY plain Korean text. No JSON. No code blocks.
- 단일 슬라이드 편집: 3-6 bullet lines starting with •
- 전체 PPT 생성: [PRESENTATION] 헤더 + 슬라이드별 계획
- Be SPECIFIC: mention exact hex colors, font sizes, positions, layout template name
- Reference design templates: [COVER] [CONTENT] [TOC] [QUOTE] [CLOSING]
- Start directly. No preamble.

Design principles to apply:
- Always include left accent bar (0,0,6,540)
- Title 64-72pt (cover), 44-48pt (content), body 20-22pt
- Choose ONE coherent color palette for all slides: DARK/WARM/LIGHT/NATURE/SLATE

Example (단일 슬라이드 편집):
• [CONTENT] 레이아웃 — DARK 팔레트 (#0A0F1E 배경, #3B82F6 액센트)
• 배경 shape (0,0,960,540) #0A0F1E
• 좌측 액센트 바 (0,0,6,540) #3B82F6
• 제목 "돼지국밥의 유래" — #F9FAFB 44pt 굵게 (60,60,420,80)
• 구분선 (60,148,60,4) #3B82F6
• 본문 4줄 — #9CA3AF 21pt (60,175~340)

Example (전체 PPT 생성 — "김치찌개 PPT 만들어줘"):
[PRESENTATION] 총 5장 — WARM 팔레트 (bg:#1C0F0A accent:#F59E0B)
슬라이드 1: [COVER] 표지 — "얼큰한 김치찌개" 타이틀 68pt, "황금 레시피" 서브타이틀 28pt, 배경 이미지 placeholder
슬라이드 2: [CONTENT] "재료 준비" — 김치, 돼지고기, 두부, 대파 등 6가지 재료 목록, 재료 이미지 placeholder
슬라이드 3: [CONTENT] "조리 순서" — 4단계 스텝 번호 박스, 각 단계 21pt 설명
슬라이드 4: [QUOTE] "핵심 팁" — 감칠맛 비법 인용구, 큰 따옴표 장식
슬라이드 5: [CLOSING] "맛있는 한 끼" 마무리, 연락처/해시태그"""


def _check_design_rules(add_ops: list[dict]) -> list[str]:
    """디자인 룰 위반 경고 수집 (로깅 전용)."""
    warnings = []
    types_added = [op.get("value", {}).get("type") for op in add_ops]
    props_list = [op.get("value", {}).get("properties", {}) for op in add_ops]

    has_background = any(
        props.get("size", {}).get("w", 0) >= 900 and props.get("size", {}).get("h", 0) >= 500
        for props in props_list
    )
    if not has_background:
        warnings.append("배경 레이어 없음 (960x540 shape/image 없음)")

    text_ops_props = [p for t, p in zip(types_added, props_list) if t == "text"]
    if text_ops_props:
        max_font = max((p.get("fontSize", 0) for p in text_ops_props), default=0)
        if max_font < 28:
            warnings.append(f"최대 폰트 {max_font}pt — 28pt 이상 권장")

    text_count = sum(1 for t in types_added if t == "text")
    if text_count > 8:
        warnings.append(f"텍스트 컴포넌트 {text_count}개 — 슬라이드당 8개 이하 권장")

    return warnings


def build_agent_graph(
    role: str,
    llm,
    llm_plain,
    system_prompt: list[dict] | str | None = None,
    on_token: "Callable[[str], None] | None" = None,
    on_event: "Callable[[str, str], None] | None" = None,  # (event_type, message)
    slide_scope_locked: bool = False,
) -> StateGraph:
    from typing import Callable
    gen_prompt = system_prompt or SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS["content"])

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
        from app.core.config import settings

        retry = state.get("retry_count", 0)
        logger.info("  [generator] JSON ops 생성 (retry=%d)", retry)
        msg = "⚙️ 슬라이드 생성 중..." if retry == 0 else f"⚙️ 재시도 중... ({retry}/{settings.AGENT_MAX_RETRIES})"
        if on_event: on_event("node_start", msg)

        human_text = (
            f"Command: {state['command']}\n\n"
            f"Action plan:\n{state.get('plan', '')}\n\n"
            f"Slide context:\n{state['slide_context']}"
        )

        if isinstance(gen_prompt, str):
            system_content = gen_prompt
        else:
            system_content = "\n".join(
                block["text"] for block in gen_prompt
                if isinstance(block, dict) and block.get("type") == "text"
            )

        messages = [
            SystemMessage(content=system_content),
            HumanMessage(content=human_text),
        ]

        raw_content = ""
        patches: list = []
        summary: str = ""

        try:
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
                    if on_token:
                        on_token(token)

            parsed = _extract_json(raw_content)
            if parsed is None:
                logger.warning("  [generator] parse fail  raw=%r", raw_content[:300])
            elif isinstance(parsed, dict) and "ops" in parsed:
                patches = _flatten_ops(parsed["ops"] if isinstance(parsed["ops"], list) else [])
                summary = parsed.get("summary", "")
            elif isinstance(parsed, list):
                patches = _flatten_ops(parsed)
        except Exception as exc:
            logger.warning("  [generator] astream failed: %s", exc)

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

        # 슬라이드 스코프 잠금 시 신규 슬라이드 생성 op 제거
        if slide_scope_locked:
            before = len(valid)
            valid = [op for op in valid if not op.get("path", "").startswith("/slides/")]
            removed = before - len(valid)
            if removed:
                logger.info("  [validator] slide_scope_locked: /slides/ op %d개 제거", removed)

        add_ops = [op for op in valid if op.get("op") == "add" and op.get("path") in ("/-", "/")]
        if add_ops:
            for w in _check_design_rules(add_ops):
                logger.warning("  [validator] design: %s", w)

        logger.info("  [validator] valid ops=%d  retry=%d", len(valid), state.get("retry_count", 0))
        return {**state, "result_patches": valid}

    # ── Node 5: formatter — LLM 요약 + 변경 수 통계만 표시 ──────────
    def formatter_node(state: AgentState) -> AgentState:
        patches = state.get("result_patches", [])
        llm_summary = state.get("result_summary", "")

        if not patches:
            return state

        # 변경 수 통계 (세부 목록 없이 숫자만)
        adds = sum(1 for op in patches if op.get("op") == "add" and op.get("path") == "/-")
        replaces = sum(1 for op in patches if op.get("op") == "replace")
        removes = sum(1 for op in patches if op.get("op") == "remove")
        slide_adds = sum(1 for op in patches if op.get("op") == "add" and op.get("path", "").startswith("/slides/"))

        stats_parts = []
        if adds: stats_parts.append(f"컴포넌트 {adds}개 추가")
        if replaces: stats_parts.append(f"{replaces}개 수정")
        if removes: stats_parts.append(f"{removes}개 삭제")
        if slide_adds: stats_parts.append(f"슬라이드 {slide_adds}장 추가")
        stats = " · ".join(stats_parts) if stats_parts else "변경 없음"

        # LLM 자연어 요약이 있으면 그것만, 없으면 통계
        if llm_summary:
            formatted = llm_summary.strip()
        else:
            formatted = stats

        logger.info("  [formatter] %d ops → %s", len(patches), stats)
        return {**state, "result_summary": formatted}

    # ── Conditional: retry or done ────────────────────────────────
    def should_retry(state: AgentState) -> str:
        from app.core.config import settings

        retry = state.get("retry_count", 0)
        if not state.get("result_patches") and retry < settings.AGENT_MAX_RETRIES:
            logger.info("  [validator] ops 없음 → generator 재시도 (%d/%d)", retry + 1, settings.AGENT_MAX_RETRIES)
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
    theme: dict | None = None,
    slide_scope_locked: bool = False,
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
Do NOT deviate from these values. All new components must use these colors.
</presentation_theme>"""

    if slide_scope_locked:
        slide_context += """

<scope_constraint>
CRITICAL — SCOPE LOCKED TO CURRENT SLIDE:
- The user explicitly mentioned a specific slide using @슬라이드N.
- You MUST ONLY add or modify components in THIS slide.
- Do NOT generate ANY '/slides/-' operations (new slide creation is FORBIDDEN).
- Do NOT plan or suggest creating additional slides.
- Focus entirely on improving the content/design of the current slide only.
</scope_constraint>"""
        logger.info("  slide_scope_locked=True: /slides/ ops will be stripped by validator")

    logger.info("agent_run  role=%s  components=%d  slides=%d  command=%r  scope_locked=%s",
                role, len(components), len(all_slides or []), command[:80], slide_scope_locked)

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
    graph = build_agent_graph(role, llm_json, llm_plain, resolved_prompt, on_token=on_token, on_event=on_event, slide_scope_locked=slide_scope_locked)

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
