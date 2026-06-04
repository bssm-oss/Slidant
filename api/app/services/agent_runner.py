import json
import logging
import operator
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
    retry_count: int        # layout_composer 재시도 횟수
    # Pipeline state (세분화된 노드 간 공유):
    mode: str               # "single_edit" | "full_presentation" | "edit" | "create"
    component_map: dict     # {id: {id, type, properties}}
    design_tokens: dict     # {palette, bg, accent, text, text2, sizes}
    component_specs: list   # layout_composer 출력 (components or slides)
    html_output: str        # html_composer 출력 (단일 슬라이드)
    html_slides: Annotated[list, operator.add]  # Send API 병렬 append용 reducer
    # html_mode 신규 필드
    slide_specs: list       # content_planner 출력: [{title, layout, key_points, image_needed}]
    slide_index: int        # Send API: 현재 슬라이드 인덱스 (기본 0)
    current_slide_spec: dict  # Send API: 현재 슬라이드 스펙
    search_queries: list    # search_router 출력
    search_results: list    # web_searcher 출력


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

DESIGN_RESOLVER_PROMPT = """\
You are DesignResolver for Slidant. Given the action plan, choose the optimal color palette and typography.

COLOR PALETTES (pick ONE):
  DARK  : bg:#0A0F1E accent:#3B82F6 text:#F9FAFB text2:#9CA3AF — tech/modern/cool
  WARM  : bg:#1C0F0A accent:#F59E0B text:#FEF3C7 text2:#D97706 — food/culture/warm
  LIGHT : bg:#F8FAFC accent:#7C3AED text:#0F172A text2:#475569 — clean/business
  NATURE: bg:#0D1F1A accent:#34D399 text:#ECFDF5 text2:#6EE7B7 — environment/health
  SLATE : bg:#1E293B accent:#F1F5F9 text:#F8FAFC text2:#94A3B8 — minimal/corporate

TYPOGRAPHY SCALE: cover_title:64-72  slide_title:44-48  subtitle:26-32  body:20-22  caption:14-16

Output ONLY JSON (no markdown):
{"palette":"DARK","bg":"#0A0F1E","accent":"#3B82F6","text":"#F9FAFB","text2":"#9CA3AF","cover_title_size":68,"slide_title_size":44,"subtitle_size":28,"body_size":21}
"""

CONTENT_PLANNER_PROMPT = """\
You are ContentPlanner for Slidant. Given the command and action plan, specify the content for each slide.

Output ONLY JSON (no markdown):
{"slides":[
  {"title":"슬라이드 제목","layout":"COVER|TOC|CONTENT|QUOTE|CLOSING|DATA|TABLE","key_points":["핵심 내용1","핵심 내용2"],"image_needed":true}
]}

Max 6 slides. Be specific about key_points (actual text content, not descriptions).
layout types: COVER(표지), TOC(목차), CONTENT(본문), QUOTE(인용), CLOSING(마무리), DATA(차트 포함), TABLE(비교표)
"""

SLIDE_COMPOSER_PROMPT = """\
You are SlideComposer for Slidant. Generate HTML for ONE specific slide.
This is an HTML-native tool — use the FULL power of CSS. Go beyond basic rectangles.

CANVAS: 960×540px. ONE SLIDE ONLY.

OUTPUT FORMAT (JSON ONLY, no markdown):
{"html":"<style>...</style><div class=\"slide\">...</div>"}

━━ CORE RULES ━━
• <div class="slide"> must have: width:960px;height:540px;position:relative;overflow:hidden;font-family:system-ui,sans-serif;
• Every element: position:absolute; data-component-id="[unique-kebab-id]"
• Use design_tokens for ALL colors/sizes. No <script> tags.
• z-index: bg(1) → overlay(2) → accent-bars(3) → shapes(4) → text(10+)

━━ CSS TECHNIQUES — USE FREELY ━━

GRADIENTS (richer than solid colors):
  • Linear multi-stop: background:linear-gradient(135deg,#0A0F1E 0%,#1E3A5F 50%,#0A0F1E 100%)
  • Radial spotlight: background:radial-gradient(ellipse at 30% 50%,rgba(59,130,246,0.3) 0%,transparent 60%)
  • Conic sweep:       background:conic-gradient(from 180deg at 50% 50%,#3B82F6,#8B5CF6,#3B82F6)
  • Mesh overlay:      background:linear-gradient(45deg,rgba(59,130,246,0.1) 25%,transparent 25%) center/40px 40px

GLASS / FROSTED:
  • backdrop-filter:blur(20px); background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:16px;

CLIP-PATH SHAPES (escape rectangles):
  • Diagonal cut:  clip-path:polygon(0 0,100% 0,85% 100%,0 100%)
  • Arrow right:   clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%)
  • Parallelogram: clip-path:polygon(10% 0,100% 0,90% 100%,0 100%)
  • Hexagon:       clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)

FILTERS & EFFECTS:
  • Glow:    filter:drop-shadow(0 0 20px rgba(59,130,246,0.6))
  • Depth:   box-shadow:0 20px 60px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.05)
  • Blur bg: filter:blur(40px); opacity:0.4  (on a duplicate bg element for depth)

CSS ANIMATIONS (use for key elements — entrance only, forwards fill):
  • Fade up:   @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
  • Scale in:  @keyframes scaleIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:none}}
  • Slide in:  @keyframes slideIn{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}
  Apply: animation:fadeUp 0.6s ease forwards; animation-delay:0.2s;
  Stagger children: delay 0s, 0.15s, 0.3s, 0.45s

INLINE SVG (icons, decorations — no external URL needed):
  • Abstract shape, geometric accent, icon as <svg> directly in HTML
  • Example accent: <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#3B82F6" stroke-width="2" opacity="0.3"/></svg>

━━ DATA VISUALIZATION — Chart.js (iframe sandbox="allow-scripts" 활성화됨) ━━

Chart.js CDN을 <style> 직후 <script src="...">로 로드하고 <canvas>에 렌더링.
MUST: canvas id는 unique (chart-1, chart-2 ...), 반드시 실제 데이터 값 사용.

LINE CHART (트렌드, 시계열):
<canvas id="chart-1" width="440" height="250" data-component-id="chart-1" style="position:absolute;left:480px;top:110px;width:440px;height:250px;z-index:10;background:rgba(255,255,255,0.04);border-radius:12px;"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
new Chart(document.getElementById('chart-1'),{type:'line',data:{labels:['2022','2023','2024','2025E'],datasets:[{label:'시장규모(억$)',data:[120,185,260,380],borderColor:'#3B82F6',backgroundColor:'rgba(59,130,246,0.15)',fill:true,tension:0.4,pointRadius:5,pointBackgroundColor:'#3B82F6'}]},options:{responsive:false,animation:false,plugins:{legend:{labels:{color:'#9CA3AF',font:{size:12}}},title:{display:true,text:'연도별 시장 규모',color:'#F9FAFB',font:{size:14,weight:'bold'}}},scales:{x:{ticks:{color:'#9CA3AF'},grid:{color:'rgba(255,255,255,0.06)'}},y:{ticks:{color:'#9CA3AF'},grid:{color:'rgba(255,255,255,0.06)'}}}}});
</script>

BAR CHART (카테고리 비교):
<canvas id="chart-1" width="440" height="250" data-component-id="chart-1" style="position:absolute;left:480px;top:110px;width:440px;height:250px;z-index:10;background:rgba(255,255,255,0.04);border-radius:12px;"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
new Chart(document.getElementById('chart-1'),{type:'bar',data:{labels:['A후보','B후보','C후보'],datasets:[{label:'득표수',data:[28461,25590,1200],backgroundColor:['#3B82F6','#EF4444','#10B981'],borderRadius:6}]},options:{responsive:false,animation:false,plugins:{legend:{display:false},title:{display:true,text:'후보별 득표 현황',color:'#F9FAFB',font:{size:14,weight:'bold'}}},scales:{x:{ticks:{color:'#9CA3AF'},grid:{display:false}},y:{ticks:{color:'#9CA3AF'},grid:{color:'rgba(255,255,255,0.06)'}}}}});
</script>

DOUGHNUT/PIE (점유율, 구성비):
<canvas id="chart-1" width="360" height="280" data-component-id="chart-1" style="position:absolute;left:540px;top:120px;width:360px;height:280px;z-index:10;background:rgba(255,255,255,0.04);border-radius:12px;"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>
new Chart(document.getElementById('chart-1'),{type:'doughnut',data:{labels:['A','B','C'],datasets:[{data:[45,32,23],backgroundColor:['#3B82F6','#8B5CF6','#10B981'],borderWidth:0}]},options:{responsive:false,animation:false,plugins:{legend:{position:'bottom',labels:{color:'#9CA3AF',padding:16}},title:{display:true,text:'구성 비율',color:'#F9FAFB',font:{size:14,weight:'bold'}}}}});
</script>

COMPARISON TABLE (HTML table — chart.js 불필요):
<div data-component-id="comp-table" style="position:absolute;left:60px;top:150px;width:840px;z-index:10;">
  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#F9FAFB;font-family:system-ui;">
    <thead><tr style="border-bottom:2px solid #3B82F6;">
      <th style="padding:10px 14px;text-align:left;color:#9CA3AF;font-weight:600;font-size:12px;">구분</th>
      <th style="padding:10px 14px;text-align:center;color:#3B82F6;font-weight:700;">항목A</th>
      <th style="padding:10px 14px;text-align:center;color:#8B5CF6;font-weight:700;">항목B</th>
      <th style="padding:10px 14px;text-align:center;color:#10B981;font-weight:700;">항목C</th>
    </tr></thead>
    <tbody>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
        <td style="padding:10px 14px;color:#9CA3AF;">특징1</td>
        <td style="padding:10px 14px;text-align:center;color:#34D399;">✓</td>
        <td style="padding:10px 14px;text-align:center;color:#34D399;">✓</td>
        <td style="padding:10px 14px;text-align:center;color:#6B7280;">—</td>
      </tr>
    </tbody>
  </table>
</div>

CHART.JS RULES:
• canvas에 반드시 width="W" height="H" HTML 어트리뷰트 설정 — CSS만으로는 Chart.js가 크기 인식 못함
• canvas 영역에 다른 요소(이미지 플레이스홀더, 텍스트 div) 절대 겹치지 말 것 — canvas 투명하여 뒤 요소가 비침
• canvas에 background 스타일 포함해서 뒤 요소가 보이지 않도록 할 것
• data 배열에 실제 수치 값 반드시 사용 — 예시값(120,185...) 그대로 쓰지 말 것
• animation:false 필수 (슬라이드 렌더링 완료 보장)
• responsive:false 필수 (position:absolute와 충돌 방지)
• canvas는 position:absolute, z-index:10 이상
• Chart.js CDN은 슬라이드당 1회만 로드 (중복 <script src> 금지)
• 여러 차트 필요 시 하나의 <script src> 후 여러 new Chart() 호출
• When slide needs chart → [DATA] layout; table → [TABLE] layout

WEB FONTS (import in <style>):
  • @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
  • Then: font-family:'Inter',system-ui,sans-serif;

LAYOUT PATTERNS (go beyond rectangles):
  • Hero split: 55% left text + 45% right image with clip-path diagonal edge
  • Card grid:  2×2 glassmorphism cards (backdrop-filter)
  • Timeline:   vertical line + dot markers + text rows
  • Stat row:   3 large numbers with labels, spaced evenly
  • Quote block: large decorative quotemark SVG + indented text

━━ STANDARD LAYOUT TEMPLATES ━━
[COVER]   bg → radial-spotlight-overlay → accent-bar(left,6×540) → title(80,170,fw:700) → subtitle(80,300)
[CONTENT] bg → accent-bar → title(60,60) → divider-line(60,140,60px×4px) → body-items(60,165+45n) → [right-image]
[TOC]     bg → accent-bar → title(60,60) → divider → numbered items(60,175+55n)
[QUOTE]   bg → top+bottom bars → large-quote-svg → quote-text(80,180,fs:34,fw:300) → author(80,370)
[DATA]    bg → accent-bar → title(60,60) → divider → bullet-list(60,150,w:400) → Chart.js canvas(480,110,w:440,h:250)
[TABLE]   bg → accent-bar → title(60,60) → divider → comparison-table(60,150,w:840)
[CLOSING] bg → dual accent bars → radial-glow-circle → main-text(center,fs:64) → sub(center)
[STATS]   bg → accent-bar → title → 3 stat cards with large numbers + labels
[SPLIT]   bg → diagonal-clip left-panel(accent color) → right content area → text on both sides

IMAGE PLACEHOLDER (NO src/url):
<div data-component-id="img-X" class="img-placeholder" data-alt="설명"
  style="position:absolute;left:Xpx;top:Ypx;width:Wpx;height:Hpx;
         border:2px dashed rgba(255,255,255,0.25);border-radius:12px;
         display:flex;align-items:center;justify-content:center;
         background:rgba(255,255,255,0.04);">
  <span style="color:rgba(255,255,255,0.35);font-size:13px;">이미지</span>
</div>

TEXT SAFE ZONE: left≥80px right≤880px. Never fontSize<18.

FEW-SHOT A — COVER with animations + radial gradient:
{"html":"<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');@keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}@keyframes scaleIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:none}}.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:'Inter',system-ui,sans-serif;}</style><div class=\\"slide\\"><div data-component-id=\\"bg\\" style=\\"position:absolute;inset:0;background:#0A0F1E;z-index:1\\"></div><div data-component-id=\\"radial\\" style=\\"position:absolute;left:-100px;top:-100px;width:600px;height:600px;background:radial-gradient(ellipse,rgba(59,130,246,0.25) 0%,transparent 60%);z-index:2\\"></div><div data-component-id=\\"accent\\" style=\\"position:absolute;left:0;top:0;width:6px;height:540px;background:linear-gradient(180deg,#3B82F6,#8B5CF6);z-index:3\\"></div><div data-component-id=\\"title\\" style=\\"position:absolute;left:80px;top:160px;width:700px;font-size:68px;font-weight:900;color:#F9FAFB;line-height:1.1;z-index:10;animation:fadeUp 0.7s ease forwards\\">슬라이드 제목</div><div data-component-id=\\"sub\\" style=\\"position:absolute;left:80px;top:290px;width:600px;font-size:26px;color:#9CA3AF;z-index:10;animation:fadeUp 0.7s 0.2s ease both\\">부제목 텍스트</div><div data-component-id=\\"divider\\" style=\\"position:absolute;left:80px;top:345px;width:60px;height:4px;background:#3B82F6;z-index:10;animation:scaleIn 0.5s 0.4s ease both\\"></div></div>"}

FEW-SHOT B — STATS slide with glassmorphism cards:
{"html":"<style>@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}.slide{width:960px;height:540px;position:relative;overflow:hidden;font-family:system-ui,sans-serif;}</style><div class=\\"slide\\"><div data-component-id=\\"bg\\" style=\\"position:absolute;inset:0;background:#0A0F1E;z-index:1\\"></div><div data-component-id=\\"glow\\" style=\\"position:absolute;left:200px;top:-100px;width:560px;height:400px;background:radial-gradient(ellipse,rgba(59,130,246,0.2),transparent 70%);z-index:2\\"></div><div data-component-id=\\"accent\\" style=\\"position:absolute;left:0;top:0;width:6px;height:540px;background:#3B82F6;z-index:3\\"></div><div data-component-id=\\"title\\" style=\\"position:absolute;left:80px;top:50px;font-size:36px;font-weight:700;color:#F9FAFB;z-index:10\\">핵심 수치</div><div data-component-id=\\"card1\\" style=\\"position:absolute;left:80px;top:130px;width:240px;height:150px;backdrop-filter:blur(20px);background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:16px;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeUp 0.6s ease forwards\\"><span style=\\"font-size:52px;font-weight:900;color:#3B82F6\\">1위</span><span style=\\"font-size:14px;color:#9CA3AF;margin-top:4px\\">항목 설명</span></div><div data-component-id=\\"card2\\" style=\\"position:absolute;left:360px;top:130px;width:240px;height:150px;backdrop-filter:blur(20px);background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:16px;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeUp 0.6s 0.15s ease both\\"><span style=\\"font-size:52px;font-weight:900;color:#8B5CF6\\">340만</span><span style=\\"font-size:14px;color:#9CA3AF;margin-top:4px\\">항목 설명</span></div><div data-component-id=\\"card3\\" style=\\"position:absolute;left:640px;top:130px;width:240px;height:150px;backdrop-filter:blur(20px);background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:16px;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeUp 0.6s 0.3s ease both\\"><span style=\\"font-size:52px;font-weight:900;color:#10B981\\">98%</span><span style=\\"font-size:14px;color:#9CA3AF;margin-top:4px\\">항목 설명</span></div></div>"}
"""

LAYOUT_COMPOSER_PROMPT = """\
You are LayoutComposer for Slidant. Given the plan and design tokens, produce RFC 6902 JSON Patch ops.

OUTPUT FORMAT — MUST FOLLOW EXACTLY. No markdown, no explanation, only JSON:
{"summary":"한국어 1-2문장 요약","ops":[{"op":"...","path":"...","value":...},...]}

PATH rules:
  Add component to CURRENT slide → "/-"
  Modify existing component property → "/{component_id}/properties/{key}"
  Delete existing component → "/{component_id}"
  Add NEW slide (full_presentation mode) → "/slides/-"

FULL PRESENTATION MODE:
  • Use "/slides/-" ops only (never "/-" for individual components)
  • Each "/slides/-" value must include a "components" array
  • Max 5 slides

CANVAS: 960×540px. Op order = render order (first = bottom layer).

LAYER ORDER (CRITICAL): background → accent bars → image → overlay → text
  1. Background shape/image: ALWAYS (0,0,960,540)
  2. Overlay on images: bgColor:#000000 opacity:0.45
  3. Accent bars: left-bar(0,0,6,540) or top-bar(0,0,960,8)
  4. Title divider: (80,Y,60,4)
  5. Content shapes/boxes
  6. Text (always on top)

TEXT SAFE ZONE: x≥80, x+w≤880. Never fontSize<18.

LAYOUT TEMPLATES:
  [COVER]   bg(0,0,960,540) → overlay(0,300,960,240,op:0.8) → left-bar(0,0,6,540) →
            title(80,170,800,110) → subtitle(80,300,800,55) → label(80,380,400,30,fs:16)
  [CONTENT] bg → left-bar → title(60,60,420,80) → divider(60,148,60,4) →
            body×4(60,175+55n,420,40) → hero-image(520,60,400,420,borderRadius:8)
  [TOC]     bg → side-panel(0,0,320,540,bg:accent,op:0.9) → section-title(40,200,240,100,fw:700) →
            item-shape×5(360,100+80n,540,60,borderRadius:4) → item-text×5(420,115+80n,420,30,fs:22,fw:600)
  [QUOTE]   bg → top-bar(0,0,960,8) → bottom-bar(0,532,960,8) →
            quote-symbol(60,80,80,110,fs:96,fw:700) → quote-text(80,180,800,160,fs:34,fw:300) →
            author(80,370,800,40,fs:22,fw:600) → role(80,415,800,30,fs:16)
  [CLOSING] bg → left-bar → right-bar(954,0,6,540) →
            center-circle(380,140,200,200,borderRadius:100,op:0.2) →
            main(80,220,800,100,fs:64,fw:700,center) → sub(80,340,800,50) → contact(80,430,800,30)

IMAGE PLACEHOLDER (NO src/url field):
  {"type":"image","properties":{"placeholder":true,"alt":"설명","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}}

ACCENT SHAPES (add ≥2 per slide):
  Left bar(0,0,6,540)  Top bar(0,0,960,8)  Divider(80,Y,60,4)  Bottom rule(0,532,960,8)

Use ALL colors and font sizes from design_tokens in input. Output ONLY JSON. No markdown.

FEW-SHOT A — single_edit (색상 변경 + 새 슬라이드 구성):
{"summary":"어두운 배경에 바다 이미지와 큰 제목 표지 슬라이드","ops":[
  {"op":"add","path":"/-","value":{"type":"image","properties":{"placeholder":true,"alt":"바다 배경 이미지","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#000000","position":{"x":0,"y":0},"size":{"w":960,"h":540},"opacity":0.55}}},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#3B82F6","position":{"x":0,"y":0},"size":{"w":6,"h":540}}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"제목 텍스트","position":{"x":80,"y":160},"size":{"w":800,"h":110},"fontSize":68,"fontWeight":700,"color":"#F9FAFB","align":"left"}}},
  {"op":"add","path":"/-","value":{"type":"text","properties":{"content":"부제목 설명","position":{"x":80,"y":295},"size":{"w":700,"h":55},"fontSize":28,"fontWeight":400,"color":"#9CA3AF","align":"left"}}}
]}

FEW-SHOT B — single_edit (기존 컴포넌트 색상 변경 — replace 사용):
Command: "노란 디자인으로 수정해줘"  existing component ids: bg_shape, title_text, sub_text
{"summary":"WARM 팔레트로 배경과 텍스트 색상 변경","ops":[
  {"op":"replace","path":"/bg_shape/properties/bgColor","value":"#1C0F0A"},
  {"op":"replace","path":"/title_text/properties/color","value":"#FEF3C7"},
  {"op":"replace","path":"/sub_text/properties/color","value":"#D97706"},
  {"op":"add","path":"/-","value":{"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}}}
]}

FEW-SHOT C — full_presentation (전체 PPT 생성):
{"summary":"김치찌개 5장 PPT — WARM 팔레트","ops":[
  {"op":"add","path":"/slides/-","value":{"title":"표지","components":[
    {"type":"shape","properties":{"bgColor":"#1C0F0A","position":{"x":0,"y":0},"size":{"w":960,"h":540}}},
    {"type":"image","properties":{"placeholder":true,"alt":"김치찌개","position":{"x":0,"y":0},"size":{"w":960,"h":540},"objectFit":"cover"}},
    {"type":"shape","properties":{"bgColor":"#000000","position":{"x":0,"y":0},"size":{"w":960,"h":540},"opacity":0.55}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}},
    {"type":"text","properties":{"content":"얼큰한 김치찌개\n황금 레시피","position":{"x":80,"y":160},"size":{"w":800,"h":120},"fontSize":64,"fontWeight":700,"color":"#FEF3C7","align":"left","lineHeight":1.3}},
    {"type":"text","properties":{"content":"집에서 완성하는 감칠맛 끝판왕","position":{"x":80,"y":305},"size":{"w":700,"h":50},"fontSize":26,"fontWeight":400,"color":"#D97706","align":"left"}}
  ]}},
  {"op":"add","path":"/slides/-","value":{"title":"재료 준비","components":[
    {"type":"shape","properties":{"bgColor":"#1C0F0A","position":{"x":0,"y":0},"size":{"w":960,"h":540}}},
    {"type":"shape","properties":{"bgColor":"#F59E0B","position":{"x":0,"y":0},"size":{"w":6,"h":540}}},
    {"type":"text","properties":{"content":"재료 준비","position":{"x":60,"y":60},"size":{"w":500,"h":70},"fontSize":44,"fontWeight":700,"color":"#FEF3C7","align":"left"}},
    {"type":"image","properties":{"placeholder":true,"alt":"재료 사진","position":{"x":520,"y":60},"size":{"w":400,"h":420},"borderRadius":8}}
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


def build_slide_context_from_html(html_content: str) -> str:
    """HTML 슬라이드 → Agent 컨텍스트 (그대로 반환)"""
    return html_content or "(빈 슬라이드)"


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


UNIFIED_PLANNER_PROMPT = """\
You are PlannerAgent for Slidant. Analyze the command and produce a complete plan in ONE response.

━━ OUTPUT FORMAT (JSON ONLY, no markdown) ━━
{
  "mode": "edit",
  "summary": "한국어 1-2문장",
  "search_queries": [],
  "design_tokens": {
    "palette": "DARK",
    "bg": "#0A0F1E", "accent": "#3B82F6", "text": "#F9FAFB", "text2": "#9CA3AF",
    "cover_title_size": 68, "slide_title_size": 44, "subtitle_size": 28, "body_size": 21
  },
  "slides": [
    {"title": "슬라이드 제목", "layout": "COVER", "key_points": ["핵심 내용"], "image_needed": false}
  ]
}

━━ MODE ━━
edit: 수정/변경/바꿔/적용 키워드 → mode:"edit", slides:1개 (수정 내용 설명)
create: PPT/만들어/생성 키워드 → mode:"create", slides:N개 (max 6)

━━ WEB SEARCH ━━
최신/실제 데이터가 필요하면 search_queries 생성.

검색어 작성 원칙:
• 사용자 명령의 고유명사(인명·지명·기관명·제품명·직책명 등)를 검색어에 그대로 사용 — 일반화 금지
• 상위 카테고리보다 사용자가 실제로 언급한 구체적 단위로 검색
• 필요시 쿼리 2-3개로 분리해 서로 다른 측면 커버

예) "영도구청장 후보자 현황" → ["제9회 전국동시지방선거 영도구청장 후보자 결과", "영도구청장 개표현황 득표수"]
예) "삼성전자 2024 실적" → ["삼성전자 2024년 연간 매출 영업이익", "삼성전자 2024 반기보고서"]
예) "AI 트렌드" → ["2025 생성형 AI 시장 규모 통계", "2025 AI 기술 트렌드"]

명령에 "[웹검색 활성화]"가 포함되면 반드시 search_queries에 추가.

━━ DESIGN PALETTES ━━
DARK  : bg#0A0F1E accent#3B82F6 text#F9FAFB text2#9CA3AF — tech/modern
WARM  : bg#1C0F0A accent#F59E0B text#FEF3C7 text2#D97706 — food/culture/warm
LIGHT : bg#F8FAFC accent#7C3AED text#0F172A text2#475569 — clean/business
NATURE: bg#0D1F1A accent#34D399 text#ECFDF5 text2#6EE7B7 — environment/health
SLATE : bg#1E293B accent#F1F5F9 text#F8FAFC text2#94A3B8 — minimal/corporate

━━ LAYOUT TYPES ━━
COVER: 표지  TOC: 목차  CONTENT: 본문  QUOTE: 인용  CLOSING: 마무리  STATS: 통계  SPLIT: 분할  DATA: 차트포함  TABLE: 비교표

key_points: 해당 슬라이드에 포함할 실제 텍스트 내용 (불릿 형태).
Output ONLY JSON.
"""

PLANNER_PROMPT = """\
You are a professional PPT design planner. Analyze the command and slide context, then produce a specific action plan.

━━ MODE 판단 (최우선 규칙) ━━

[EDIT] 모드 — 다음 중 하나라도 해당하면:
  키워드: 수정, 변경, 바꿔, 바꿔줘, 적용, 고쳐, 다시, 노란, 어둡게, 밝게, 색상, 폰트, 크기, 디자인 변경
  → 현재 슬라이드 HTML을 수정하는 계획. [EDIT] 헤더 사용.
  → [PRESENTATION] 절대 사용 금지.
  형식: [EDIT] 현재 슬라이드 수정 — {변경 내용 요약}
        • 변경 항목 1
        • 변경 항목 2

[PRESENTATION] 모드 — 다음 중 하나라도 해당하고 위 EDIT 키워드가 없을 때:
  키워드: PPT, 프레젠테이션, 발표자료, 슬라이드셋, 만들어, 제작, 작성
  조건: 현재 슬라이드가 비어있거나 슬라이드 수가 1개 이하
  형식:
  [PRESENTATION] 총 N장 슬라이드 계획 (N = 5~7장)
  슬라이드 1: [COVER] — 표지 (제목, 부제목, 배경)
  ...
  슬라이드 N: [CLOSING] — 마무리
  각 슬라이드마다: 팔레트, 배경색, 액센트색, 제목 텍스트, 본문 요소, 레이아웃 명시

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
    html_mode: bool = False,
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
        logger.info("  [planner] 계획: %r", plan[:200])
        if on_event: on_event("node_done", "✅ 계획 완료")
        return {**state, "plan": plan, "messages": []}

    # ── Node 2: intent_router — planner 결과 파싱 → 모드 분기 ────
    def intent_router_node(state: AgentState) -> AgentState:
        plan = state.get("plan", "")
        mode = "full_presentation" if "[PRESENTATION]" in plan else "single_edit"
        logger.info("  [intent_router] mode=%s", mode)
        if on_event: on_event("node_start", f"🔀 {'전체 PPT' if mode == 'full_presentation' else '단일 슬라이드'} 모드")
        return {**state, "mode": mode}

    # ── Node 3: context_reader — 컴포넌트 JSON → 내부 맵 ─────────
    def context_reader_node(state: AgentState) -> AgentState:
        slide_ctx = state.get("slide_context", "")
        component_map: dict = {}
        for m in re.finditer(
            r'data-component-id="([^"]+)"\s+data-type="([^"]+)"[^>]*><props>(.*?)</props>',
            slide_ctx, re.DOTALL,
        ):
            cid, ctype, props_str = m.group(1), m.group(2), m.group(3)
            try:
                props = json.loads(props_str)
            except json.JSONDecodeError:
                props = {}
            component_map[cid] = {"id": cid, "type": ctype, "properties": props}
        logger.info("  [context_reader] components=%d", len(component_map))
        return {**state, "component_map": component_map}

    # ── Node 4: design_resolver — 팔레트/타이포그래피 토큰 결정 ──
    async def design_resolver_node(state: AgentState) -> AgentState:
        if on_event: on_event("node_start", "🎨 디자인 토큰 결정 중...")
        messages = [
            SystemMessage(content=DESIGN_RESOLVER_PROMPT),
            HumanMessage(content=f"Plan:\n{state.get('plan', '')}\nMode: {state.get('mode', 'single_edit')}"),
        ]
        raw = ""
        try:
            async for chunk in llm_plain.astream(messages):
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
        if on_event: on_event("node_done", f"✅ {design_tokens.get('palette', 'DARK')} 팔레트 확정")
        return {**state, "design_tokens": design_tokens}

    # ── Node 5: layout_composer — 컴포넌트 스펙 창작 (핵심) ──────
    async def layout_composer_node(state: AgentState) -> AgentState:
        from app.core.config import settings

        retry = state.get("retry_count", 0)
        msg = "✏️ 컴포넌트 설계 중..." if retry == 0 else f"✏️ 재시도 중... ({retry}/{settings.AGENT_MAX_RETRIES})"
        if on_event: on_event("node_start", msg)

        design_tokens = state.get("design_tokens", {})

        # 커스텀 Agent는 gen_prompt 사용, 기본은 LAYOUT_COMPOSER_PROMPT
        if gen_prompt:
            if isinstance(gen_prompt, str):
                composer_system = gen_prompt
            else:
                composer_system = "\n".join(
                    b["text"] for b in gen_prompt
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
        messages = [
            SystemMessage(content=composer_system),
            HumanMessage(content=human_text),
        ]

        raw_content = ""
        try:
            async for chunk in llm.astream(messages):
                raw = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw, list):
                    token = "".join(b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw) if raw else ""
                if token:
                    raw_content += token
                    if on_token:
                        on_token(token)
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
        if on_event: on_event("node_done", f"✅ {len(ops)}개 op 생성")
        return {**state, "component_specs": ops, "result_summary": summary, "messages": []}

    # ── Node 6: patch_serializer — layout_composer ops → result_patches ──
    def patch_serializer_node(state: AgentState) -> AgentState:
        # layout_composer가 이미 RFC 6902 ops를 component_specs에 저장함 → passthrough
        ops = state.get("component_specs", [])
        logger.info("  [patch_serializer] ops=%d", len(ops))
        return {**state, "result_patches": ops}

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

        # html_mode: html_slides 기반 통계
        if not patches:
            html_slides = state.get("html_slides", [])
            html_out = state.get("html_output", "")
            if html_slides or html_out:
                if llm_summary:
                    return {**state, "result_summary": llm_summary.strip()}
                cnt = len(html_slides) if html_slides else 1
                return {**state, "result_summary": f"{cnt}장 슬라이드 생성 완료"}
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

    # ── HTML mode nodes (신규 파이프라인) ─────────────────────────

    async def intent_analyzer_node(state: AgentState) -> AgentState:
        plan = state.get("plan", "")
        is_edit = "[EDIT]" in plan or "[PRESENTATION]" not in plan
        mode = "edit" if is_edit else "create"
        # search_queries는 [SEARCH: ...] 파싱
        sq_matches = re.findall(r'\[SEARCH:\s*(.*?)\]', plan)
        queries = []
        for m in sq_matches:
            queries.extend([q.strip() for q in m.split(',') if q.strip()])

        if on_event:
            on_event("node_start", f"🔍 {'수정' if is_edit else '생성'} 모드 감지")

        # steps_init emit (검색 포함 여부 반영)
        slide_titles = re.findall(r'슬라이드\s*\d+\s*[:：]\s*(?:\[\w+\]\s*)?(.*?)(?:\n|$)', plan)
        slide_titles = [t.strip() for t in slide_titles if t.strip()]
        total = len(slide_titles) if slide_titles and not is_edit else (0 if is_edit else 1)

        steps = [{"id": "plan", "label": "계획 수립"}]
        if queries:
            steps.append({"id": "search", "label": f"웹 검색 ({len(queries)}개)"})
        if not is_edit:
            steps.append({"id": "content", "label": "콘텐츠 기획"})
        steps.append({"id": "design", "label": "디자인 확정"})
        for i, t in enumerate(slide_titles[:6]):
            steps.append({"id": f"slide-{i}", "label": t[:20] or f"슬라이드 {i+1}"})
        if not steps[-1]["id"].startswith("slide"):
            steps.append({"id": "slide-0", "label": "슬라이드 생성"})

        if on_event:
            on_event("steps_init", json.dumps(steps, ensure_ascii=False))
            on_event("step_done", "plan")
            on_event("node_done", f"✅ {'수정' if is_edit else '생성'} 모드")

        return {**state, "mode": mode, "search_queries": queries}

    def search_router_node(state: AgentState) -> AgentState:
        # 단순 라우터, 실제 분기는 conditional_edge로
        return state

    async def web_searcher_node(state: AgentState) -> AgentState:
        from app.core.config import settings
        if on_event:
            on_event("node_start", f"🔍 웹 검색 중 ({len(state.get('search_queries', []))}개)...")
        results = []
        tavily_key = getattr(settings, "TAVILY_API_KEY", "")
        if tavily_key:
            try:
                from tavily import TavilyClient
                client = TavilyClient(api_key=tavily_key)
                for q in state.get("search_queries", [])[:3]:
                    resp = client.search(
                        q,
                        max_results=7,
                        search_depth="advanced",
                        include_answer=True,
                        include_raw_content=False,
                    )
                    tavily_answer = resp.get("answer", "")

                    # 검색어와 제목 유사도로 관련성 필터링
                    # 동일 지역/주제의 엉뚱한 결과(시장선거 → 구청장 쿼리) 걸러냄
                    q_tokens = set(q.replace("  ", " ").split())
                    def relevance_score(r: dict) -> float:
                        title = r.get("title", "").lower()
                        score = r.get("score", 0)
                        # 쿼리 토큰이 제목에 포함될수록 가중치
                        overlap = sum(1 for t in q_tokens if t in title)
                        return score + overlap * 0.1

                    sorted_results = sorted(
                        resp.get("results", []),
                        key=relevance_score,
                        reverse=True,
                    )

                    results.append({
                        "query": q,
                        "answer": tavily_answer,
                        "results": [
                            {
                                "title": r["title"],
                                "url": r["url"],
                                "snippet": r.get("content", "")[:800],
                                "score": r.get("score", 0),
                            }
                            for r in sorted_results
                        ],
                    })
            except Exception as e:
                logger.warning("web_searcher failed: %s", e)
        if on_event:
            on_event("step_done", "search")
            on_event("node_done", f"✅ {len(results)}개 검색 완료")
        return {**state, "search_results": results}

    async def content_planner_node(state: AgentState) -> AgentState:
        if on_event:
            on_event("node_start", "📋 콘텐츠 기획 중...")

        search_ctx = ""
        if state.get("search_results"):
            search_ctx = "\n\n## 웹 검색 결과 (주제와 관련된 내용만 슬라이드에 반영)\n"
            for sr in state["search_results"]:
                search_ctx += f"\n### 검색어: {sr['query']}\n"
                if sr.get("answer"):
                    search_ctx += f"**요약**: {sr['answer']}\n"
                for r in sr["results"][:5]:
                    search_ctx += f"\n**{r['title']}** ({r['url']})\n{r['snippet']}\n"
            search_ctx += "\n※ 검색어와 무관한 데이터를 혼용하지 말 것. 확실하지 않은 수치는 생략.\n"

        messages = [
            SystemMessage(content=CONTENT_PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}\n\nPlan:\n{state.get('plan', '')}{search_ctx}"),
        ]
        raw = ""
        async for chunk in llm_plain.astream(messages):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw_c) if raw_c else ""
            raw += token

        parsed = _extract_json(raw)
        slide_specs = []
        if isinstance(parsed, dict) and "slides" in parsed:
            slide_specs = parsed["slides"]

        if on_event:
            on_event("step_done", "content")
            on_event("node_done", f"✅ {len(slide_specs)}장 콘텐츠 기획 완료")
        return {**state, "slide_specs": slide_specs}

    async def design_resolver_node_html(state: AgentState) -> AgentState:
        if on_event:
            on_event("node_start", "🎨 디자인 확정 중...")
        messages = [
            SystemMessage(content=DESIGN_RESOLVER_PROMPT),
            HumanMessage(content=f"Plan:\n{state.get('plan', '')}\nMode: {state.get('mode', 'create')}"),
        ]
        raw = ""
        async for chunk in llm_plain.astream(messages):
            raw_c = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(raw_c, list):
                token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
            else:
                token = str(raw_c) if raw_c else ""
            raw += token
        parsed = _extract_json(raw)
        design_tokens = parsed if isinstance(parsed, dict) and "bg" in parsed else {
            "palette": "DARK", "bg": "#0A0F1E", "accent": "#3B82F6", "text": "#F9FAFB", "text2": "#9CA3AF",
            "cover_title_size": 68, "slide_title_size": 44, "subtitle_size": 28, "body_size": 21,
        }
        if on_event:
            on_event("step_done", "design")
            on_event("node_done", f"✅ {design_tokens.get('palette', 'DARK')} 팔레트 확정")
        return {**state, "design_tokens": design_tokens}

    async def slide_composer_node(state: AgentState) -> dict:
        idx = state.get("slide_index", 0)
        spec = state.get("current_slide_spec") or (state.get("slide_specs") or [{}])[0]
        design_tokens = state.get("design_tokens", {})

        if on_event:
            on_event("node_start", f"✏️ 슬라이드 {idx+1} 생성 중...")

        is_edit = state.get("mode") == "edit"
        format_hint = (
            "\n\nOUTPUT: single-slide modification — preserve data-component-id values."
            if is_edit else ""
        )

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
            f"{search_ctx}{format_hint}"
        )

        composer_system = SLIDE_COMPOSER_PROMPT
        if isinstance(gen_prompt, str):
            composer_system = gen_prompt

        messages = [SystemMessage(content=composer_system), HumanMessage(content=human_text)]

        raw = ""
        try:
            async for chunk in llm.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("slide_composer[%d] failed: %s", idx, e)

        parsed = _extract_json(raw)
        html = ""
        if isinstance(parsed, dict):
            html = parsed.get("html", "")

        title = spec.get("title", f"슬라이드 {idx+1}")

        # 완성 즉시 SSE emit (프론트 즉시 렌더링)
        if on_event and html:
            on_event("slide_ready", json.dumps({"index": idx, "title": title, "html": html}, ensure_ascii=False))
            on_event("step_done", f"slide-{idx}")
            on_event("node_done", f"✅ {title[:15]} 완성")

        logger.info("  [slide_composer] idx=%d html=%d chars", idx, len(html))
        return {"html_slides": [{"index": idx, "title": title, "html": html}]}

    def html_aggregator_node(state: AgentState) -> AgentState:
        slides = sorted(state.get("html_slides", []), key=lambda s: s.get("index", 0))
        valid = [s for s in slides if s.get("html")]

        # EDIT 모드: html_output에 단일 결과 저장
        if state.get("mode") == "edit" and valid:
            return {**state, "html_slides": valid, "html_output": valid[0]["html"], "result_summary": "슬라이드 수정 완료"}

        summary = f"{len(valid)}장 슬라이드 생성 완료"
        return {**state, "html_slides": valid, "result_summary": summary}

    def html_validator_node_new(state: AgentState) -> AgentState:
        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")
        valid = bool(slides) or (bool(html_out) and "<div" in html_out)
        if not valid:
            logger.warning("  [html_validator] 결과 없음")
        return state

    def should_retry_html_new(state: AgentState) -> str:
        from app.core.config import settings
        retry = state.get("retry_count", 0)
        slides = state.get("html_slides", [])
        html_out = state.get("html_output", "")
        has_output = bool(slides) or bool(html_out)
        if not has_output and retry < settings.AGENT_MAX_RETRIES:
            return "retry"
        return "done"

    # ── unified_planner_node (planner + content_planner + design_resolver 통합) ──
    async def unified_planner_node(state: AgentState) -> AgentState:
        if on_event: on_event("node_start", "🧠 계획 수립 중...")
        history = state.get("conversation_history", "")
        history_section = f"\n\nPrevious conversation:\n{history}" if history else ""

        messages = [
            SystemMessage(content=UNIFIED_PLANNER_PROMPT),
            HumanMessage(content=f"Command: {state['command']}{history_section}\n\nCurrent slide:\n{state['slide_context']}"),
        ]

        raw = ""
        try:
            async for chunk in llm_plain.astream(messages):
                raw_c = chunk.content if hasattr(chunk, "content") else ""
                if isinstance(raw_c, list):
                    token = "".join(b.get("text", "") for b in raw_c if isinstance(b, dict) and b.get("type") == "text")
                else:
                    token = str(raw_c) if raw_c else ""
                raw += token
        except Exception as e:
            logger.warning("  [unified_planner] failed: %s", e)

        parsed = _extract_json(raw)

        # 파싱 실패 시 폴백
        if not isinstance(parsed, dict):
            if on_event: on_event("node_done", "✅ 계획 완료")
            return {**state, "plan": raw, "mode": "create", "design_tokens": {}, "slide_specs": [], "search_queries": [], "result_summary": ""}

        mode = parsed.get("mode", "create")
        design_tokens = parsed.get("design_tokens", {})
        if not design_tokens or "bg" not in design_tokens:
            design_tokens = {
                "palette": "DARK", "bg": "#0A0F1E", "accent": "#3B82F6",
                "text": "#F9FAFB", "text2": "#9CA3AF",
                "cover_title_size": 68, "slide_title_size": 44, "subtitle_size": 28, "body_size": 21,
            }
        slide_specs = parsed.get("slides", [])
        search_queries = [q for q in parsed.get("search_queries", []) if isinstance(q, str) and q.strip()]
        summary = parsed.get("summary", "")

        # steps_init emit
        if on_event:
            steps = [{"id": "plan", "label": "계획 수립"}]
            if search_queries:
                steps.append({"id": "search", "label": f"웹 검색 ({len(search_queries)}개)"})
            for i, s in enumerate(slide_specs[:6]):
                steps.append({"id": f"slide-{i}", "label": (s.get("title", "") or f"슬라이드 {i+1}")[:20]})
            if not any(step["id"].startswith("slide") for step in steps):
                steps.append({"id": "slide-0", "label": "슬라이드 생성"})
            on_event("steps_init", json.dumps(steps, ensure_ascii=False))
            on_event("step_done", "plan")
            on_event("node_done", "✅ 계획 완료")

        logger.info("  [unified_planner] mode=%s slides=%d search=%d palette=%s",
                    mode, len(slide_specs), len(search_queries), design_tokens.get("palette", "?"))

        return {
            **state,
            "plan": raw,
            "mode": mode,
            "design_tokens": design_tokens,
            "slide_specs": slide_specs,
            "search_queries": search_queries,
            "result_summary": summary,
            "messages": [],
        }

    # ── slide_dispatch 더미 노드 (Send API 트리거용) ──────────────
    def slide_dispatch_node(state: AgentState) -> AgentState:
        return state

    def route_after_planner(state: AgentState) -> str:
        return "search" if state.get("search_queries") else "dispatch"

    # ── Send API dispatch functions ───────────────────────────────
    def dispatch_slides(state: AgentState):
        from langgraph.constants import Send
        specs = state.get("slide_specs", [])
        if not specs:
            # content_planner 실패 시 폴백: 플랜 기반 단순 스펙 생성
            plan = state.get("plan", "")
            titles = re.findall(r'슬라이드\s*\d+\s*[:：]\s*(?:\[\w+\]\s*)?(.*?)(?:\n|$)', plan)
            specs = [
                {"title": t.strip(), "layout": "CONTENT", "key_points": [], "image_needed": False}
                for t in titles[:6] if t.strip()
            ]
        if not specs:
            specs = [{"title": "슬라이드", "layout": "COVER", "key_points": [], "image_needed": False}]

        return [
            Send("slide_composer", {
                **state,
                "slide_index": i,
                "current_slide_spec": spec,
                "html_slides": [],  # 각 Send는 독립 상태 시작
            })
            for i, spec in enumerate(specs)
        ]

    def should_search(state: AgentState) -> str:
        return "search" if state.get("search_queries") else "skip"

    def route_by_mode(state: AgentState) -> str:
        return "edit" if state.get("mode") == "edit" else "create"

    # ── HTML mode graph (통합 플래너 파이프라인) ──────────────────
    # START → unified_planner → [web_searcher →] slide_dispatch → N×slide_composer
    #       → html_aggregator → html_validator → formatter → END
    if html_mode:
        graph = StateGraph(AgentState)
        graph.add_node("unified_planner", unified_planner_node)
        graph.add_node("web_searcher", web_searcher_node)
        graph.add_node("slide_dispatch", slide_dispatch_node)
        graph.add_node("slide_composer", slide_composer_node)
        graph.add_node("html_aggregator", html_aggregator_node)
        graph.add_node("html_validator", html_validator_node_new)
        graph.add_node("formatter", formatter_node)
        graph.add_node("retry_inc", increment_retry)

        graph.add_edge(START, "unified_planner")
        graph.add_conditional_edges("unified_planner", route_after_planner, {
            "search": "web_searcher",
            "dispatch": "slide_dispatch",
        })
        graph.add_edge("web_searcher", "slide_dispatch")
        # Send API fan-out: slide_dispatch → N×slide_composer
        # path_map 명시 → 정적 그래프 시각화에서 slide_composer 엣지 표시
        graph.add_conditional_edges("slide_dispatch", dispatch_slides, ["slide_composer"])
        graph.add_edge("slide_composer", "html_aggregator")
        graph.add_edge("html_aggregator", "html_validator")
        graph.add_conditional_edges("html_validator", should_retry_html_new, {
            "retry": "retry_inc",
            "done": "formatter",
        })
        graph.add_edge("retry_inc", "slide_dispatch")
        graph.add_edge("formatter", END)
        return graph.compile()

    # ── Graph 조립 ─────────────────────────────────────────────────
    # START → planner → intent_router → context_reader → design_resolver
    #       → layout_composer → patch_serializer → validator → formatter → END
    #              ↑___________________________________|  (retry — design_resolver 생략)
    graph = StateGraph(AgentState)
    graph.add_node("planner", planner_node)
    graph.add_node("intent_router", intent_router_node)
    graph.add_node("context_reader", context_reader_node)
    graph.add_node("design_resolver", design_resolver_node)
    graph.add_node("layout_composer", layout_composer_node)
    graph.add_node("patch_serializer", patch_serializer_node)
    graph.add_node("validator", validator_node)
    graph.add_node("formatter", formatter_node)
    graph.add_node("retry_inc", increment_retry)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "intent_router")
    graph.add_edge("intent_router", "context_reader")
    graph.add_edge("context_reader", "design_resolver")
    graph.add_edge("design_resolver", "layout_composer")
    graph.add_edge("layout_composer", "patch_serializer")
    graph.add_edge("patch_serializer", "validator")
    graph.add_conditional_edges("validator", should_retry, {
        "retry": "retry_inc",
        "done": "formatter",
    })
    graph.add_edge("formatter", END)
    graph.add_edge("retry_inc", "layout_composer")  # design_resolver 재호출 없이 layout만 재시도

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
    html_mode: bool = False,
) -> tuple[list[dict], str, str, str, list]:
    """
    Returns: (patch_ops, slide_context, summary, html_output, html_slides)
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
        return patches, slide_context, "[MOCK] 테스트 응답", "", []

    from typing import Callable
    api_key = decrypt_api_key(encrypted_api_key)
    # Anthropic: 두 LLM 모두 prompt caching 헤더 포함; json_mode 구분 불필요 (structured output 사용)
    llm_json  = _make_llm(api_key, provider, json_mode=False)  # generator: structured output으로 대체
    llm_plain = _make_llm(api_key, provider, json_mode=False)  # planner: 자연어
    # system_prompt가 문자열로 넘어온 경우(커스텀 Agent) cached list 형식으로 래핑
    resolved_prompt: list[dict] | str | None = system_prompt
    if isinstance(system_prompt, str):
        resolved_prompt = _make_cached_system_prompt(system_prompt)
    graph = build_agent_graph(role, llm_json, llm_plain, resolved_prompt, on_token=on_token, on_event=on_event, slide_scope_locked=slide_scope_locked, html_mode=html_mode)

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
        })
        patches = result.get("result_patches", [])
        summary = result.get("result_summary", "")
        html_output = result.get("html_output", "")
        html_slides = result.get("html_slides", [])
        ms = (time.perf_counter() - t0) * 1000
        logger.info("llm_done  provider=%s  patches=%d  summary=%r  %.0fms", provider, len(patches), summary[:60], ms)
        if not patches and not html_output and not html_slides:
            msgs = result.get("messages", [])
            if msgs:
                last = msgs[-1]
                logger.warning("llm_empty_patches  content=%r", str(getattr(last, 'content', last))[:400])
        return patches, slide_context, summary, html_output, html_slides
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000
        err_str = str(e)
        logger.warning("llm_error  %.0fms  %s", ms, err_str[:120])
        if "credit balance" in err_str or "insufficient" in err_str.lower():
            logger.info("fallback  credit exhausted → mock")
            return _mock_patches(role, command, components), slide_context, "[Mock fallback] 크레딧 부족", "", []
        raise
