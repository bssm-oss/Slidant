# Rich Slide Layout System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레이아웃 타입을 9종 → 15종으로 확장하고, 플래너가 콘텐츠 특성에 따라 자동으로 다양한 레이아웃을 선택하도록 한다. Chart.js 차트도 적극 활용.

**Architecture:**
- `SLIDE_COMPOSER_PROMPT`에 새 레이아웃 HTML 스켈레톤 추가 (CARD_GRID, TIMELINE, COMPARISON, ICON_LIST, CHART_BAR, CHART_LINE, CHART_PIE)
- `UNIFIED_PLANNER_PROMPT`에 레이아웃 선택 규칙 + `chart_type`/`visual_hint` spec 필드 추가
- `layout_budget.py`에 새 레이아웃 픽셀 예산 계산 추가
- `planner.py` 폴백 로직 개선 (무조건 CONTENT×N 방지)

**Tech Stack:** Python, Jinja-style string prompts, LangGraph AgentState

---

### Task 1: UNIFIED_PLANNER_PROMPT 레이아웃 선택 규칙 + spec 필드 추가

**Files:**
- Modify: `api/app/agent/prompts.py:711-712` (LAYOUT TYPES 섹션)

- [ ] **Step 1: LAYOUT TYPES 섹션 교체**

기존:
```
COVER: 표지  TOC: 목차  CONTENT: 본문  QUOTE: 인용  CLOSING: 마무리  STATS: 통계  SPLIT: 분할  DATA: 차트포함  TABLE: 비교표
```

교체:
```
━━ LAYOUT TYPES & SELECTION RULES ━━
COVER:      표지 슬라이드 — 첫 번째 슬라이드 전용
TOC:        목차 — 전체 구성 안내
CONTENT:    일반 본문 — 3개 이하 자유 텍스트 항목 (default, 최후 수단)
QUOTE:      인용/핵심 메시지 — 강조할 단일 문장/슬로건
CLOSING:    마무리 슬라이드 — 마지막 슬라이드 전용
STATS:      숫자/지표 강조 — 3개 대형 수치 (성장률, 매출, 달성률 등)
SPLIT:      좌우 분할 — 한쪽에 이미지/다이어그램, 반대쪽에 텍스트
DATA:       차트 포함 — 수치 데이터 시각화 (chart_type 필드 필수)
TABLE:      비교표 — 3-5열 구조화 데이터
CARD_GRID:  카드 그리드 — 3-4개 개념/구성요소를 카드로 표현 (각 카드: 아이콘+제목+설명)
TIMELINE:   타임라인 — 단계별 프로세스, 역사적 순서, 배포 단계
COMPARISON: 좌우 비교 — 장점vs한계, A vs B, before vs after
ICON_LIST:  아이콘 목록 — 4-6개 항목 각각 아이콘+텍스트 (plain bullet 대신)
FLOW:       플로우차트 — 프로세스 흐름, 의사결정 트리, 아키텍처

LAYOUT SELECTION RULES (CRITICAL — check these IN ORDER before using CONTENT):
1. key_points에 고유 개념/컴포넌트 3-4개 (OSD, MON, MDS...) → CARD_GRID
2. 순서/단계/역사 흐름 (1단계, 2단계... / 20XX년...) → TIMELINE
3. 장점 vs 한계 / A vs B / before vs after 비교 → COMPARISON
4. 숫자/퍼센트/통계 수치 포함 → DATA (chart_type: "bar"|"line"|"doughnut")
5. 아키텍처/시스템 구조 설명 → SPLIT (visual_hint: "architecture-diagram")
6. 4-6개 항목 나열 (이름+설명 쌍) → ICON_LIST
7. 프로세스 흐름/순서도 → FLOW
8. 위 어느 것도 해당 없을 때만 → CONTENT
```

- [ ] **Step 2: spec 포맷에 chart_type, visual_hint 필드 추가**

`operations` 예시 부분(라인 647-652) 수정:
```json
{"type": "create", "spec": {
  "title": "새 슬라이드",
  "layout": "CONTENT",
  "key_points": ["내용"],
  "chart_type": "bar",
  "visual_hint": "architecture-diagram"
}}
```
chart_type: DATA 레이아웃일 때 "bar" | "line" | "doughnut" 지정 필수
visual_hint: SPLIT/FLOW 레이아웃일 때 시각 요소 힌트 (선택)

- [ ] **Step 3: 서버 재시작 후 Ceph 10장 PPT 재생성해서 레이아웃 다양성 확인**

---

### Task 2: SLIDE_COMPOSER_PROMPT 새 레이아웃 HTML 스켈레톤 추가

**Files:**
- Modify: `api/app/agent/prompts.py:334-349` (STANDARD LAYOUT TEMPLATES 섹션)

- [ ] **Step 1: STANDARD LAYOUT TEMPLATES에 새 레이아웃 추가**

기존 `[STATS]`, `[SPLIT]` 뒤에 추가:
```
[CARD_GRID] bg → accent-bar → title(60,60,h:80,border-bottom:4px accent) →
  3 cards: each (60+i*300, 160, 260, 240, glass backdrop-filter, border-radius:16px, border:1px solid rgba(255,255,255,0.12))
  card contents: SVG icon(24×24, top:20, left:20), h3(top:60,left:16,right:16), p(top:100,left:16,right:16,font-size:16px)
  4 cards: each (60+i*225, 160, 200, 240) — adjust widths

[TIMELINE] bg → accent-bar → title(60,60) →
  vertical center line: (left:478,top:160,width:4,height:320,bg:accent,opacity:0.3)
  N steps (max 5): dot(left:466,top:160+i*70,width:28,height:28,border-radius:14,bg:accent)
  even steps: label on RIGHT (left:520,top:155+i*70) | odd steps: label on LEFT (right=450,text-align:right)
  horizontal: use if N≤4 — dots spaced evenly on y:340, labels above/below alternating

[COMPARISON] bg → accent-bar → title(60,60,full-width) →
  left-column(60,150,380,320,glass,border-radius:12): heading(accent-left, 12px border-left:4px),
  right-column(520,150,380,320,glass,border-radius:12): heading(red/warning color),
  each column: items with inline SVG check(✓,green) or warn(⚠,amber) icons

[ICON_LIST] bg → accent-bar → title(60,60) →
  2-column icon rows: left(60,160,380) right(500,160,380)
  each item: SVG icon circle bg(32×32,accent,opacity:0.2) + icon(20×20 centered) + text
  max 6 total items (3 per col), gap:68px between rows

[FLOW] bg → accent-bar → title(60,60) →
  SVG flowchart (60,150,840,320): boxes with rounded rect + connecting arrows
  max 5 nodes in sequence, use foreignObject for Korean text inside SVG
  arrow: path with marker-end:url(#arrow)
```

- [ ] **Step 2: DATA 레이아웃에 chart_type 분기 설명 추가**

기존 `[DATA]` 줄 뒤에:
```
[DATA]    bg → accent-bar → title → divider → bullet-list(60,150,w:380) → Chart.js(480,110,w:440,h:280)
  chart_type in spec:
    "bar"      → Bar chart (카테고리 비교, 순위, 점유율)
    "line"     → Line chart (시계열 트렌드, 성장 추이)
    "doughnut" → Doughnut chart (구성비, 점유율)
    없음/기타  → 데이터 특성 보고 자동 선택
```

---

### Task 3: layout_budget.py 새 레이아웃 픽셀 예산 추가

**Files:**
- Modify: `api/app/core/domain/layout_budget.py`

- [ ] **Step 1: compute_layout_budget 분기 추가**

```python
elif layout == "CARD_GRID":
    _card_grid_budget(lines, n_items)
elif layout == "TIMELINE":
    _timeline_budget(lines, n_items)
elif layout in ("COMPARISON", "ICON_LIST"):
    _comparison_budget(lines, n_items, layout)
elif layout == "FLOW":
    lines.append("FLOW: SVG area left=60 top=150 width=840 height=320")
```

- [ ] **Step 2: 각 budget 함수 구현**

```python
def _card_grid_budget(lines: list, n_items: int) -> None:
    n_cards = min(max(n_items, 3), 4)
    card_w = 260 if n_cards == 3 else 200
    gap = (840 - n_cards * card_w) // (n_cards + 1)
    lines += [
        f"CARD_GRID — {n_cards} cards:",
        f"  card_width: {card_w}px, card_height: 240px, top: 160px",
        f"  gap between cards: {gap}px",
    ] + [
        f"  card {i+1}: left={(60 + i * (card_w + gap))}px"
        for i in range(n_cards)
    ] + [
        "  card inner: icon(top:20,left:20,24×24), h3(top:60,left:16), p(top:100,left:16,font-size:16px)",
        "  card style: backdrop-filter:blur(12px); background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:16px",
    ]

def _timeline_budget(lines: list, n_items: int) -> None:
    n = min(max(n_items, 2), 5)
    gap = 300 // max(n - 1, 1)
    lines += [
        f"TIMELINE — {n} steps (vertical):",
        "  center line: left=478 top=160 width=4 height=320 opacity:0.3",
        f"  step gap: {gap}px",
        f"  dot size: 28×28px, border-radius:14px",
    ] + [
        f"  step {i+1}: dot top={160 + i*gap}px | "
        f"{'RIGHT label: left=520' if i%2==0 else 'LEFT label: right=450, text-align:right'}"
        for i in range(n)
    ]

def _comparison_budget(lines: list, n_items: int, layout: str) -> None:
    per_col = (n_items + 1) // 2 if n_items > 0 else 3
    item_h = min(60, 300 // max(per_col, 1))
    lines += [
        f"{layout} — 2 columns, {per_col} items each:",
        "  left col:  left=60  top=150 width=380 height=320 glass",
        "  right col: left=520 top=150 width=380 height=320 glass",
        "  col heading: top=160 (16px from col top), font-size:20px, border-left:4px solid accent",
        f"  items start: top=200, item_height≈{item_h}px, gap:8px",
        "  left col items: accent/green check icon | right col items: amber/red warning icon",
    ]
```

---

### Task 4: planner.py 폴백 레이아웃 배분 개선

**Files:**
- Modify: `api/app/agent/nodes/planner.py:133` (폴백 layouts 리스트)

- [ ] **Step 1: 폴백 배분 함수로 추출**

기존:
```python
_layouts = (["COVER", "TOC"] + ["CONTENT"] * (n - 3) + ["CLOSING"]) if n >= 3 else ["COVER"] * n
```

교체:
```python
_layouts = _default_layout_sequence(n)
```

- [ ] **Step 2: `_default_layout_sequence` 함수 추가 (파일 상단)**

```python
def _default_layout_sequence(n: int) -> list[str]:
    """N장 PPT용 기본 레이아웃 배분 — CONTENT 연속 방지."""
    if n <= 1:
        return ["COVER"]
    if n == 2:
        return ["COVER", "CLOSING"]
    
    # 고정: 첫 장 COVER, 두 번째 TOC, 마지막 CLOSING
    middle = n - 3  # TOC, CLOSING 제외한 본문 수
    if middle <= 0:
        return (["COVER", "TOC", "CLOSING"])[:n]
    
    # 본문 레이아웃 순환 배분 — CONTENT 연속 최대 2회
    cycle = ["CONTENT", "CARD_GRID", "CONTENT", "DATA", "CONTENT", "ICON_LIST",
             "CONTENT", "TIMELINE", "CONTENT", "COMPARISON"]
    body = [cycle[i % len(cycle)] for i in range(middle)]
    return ["COVER", "TOC"] + body + ["CLOSING"]
```

- [ ] **Step 3: 같은 패턴이 planner.py 두 곳에 있음 — 두 곳 모두 교체**

라인 133, 라인 197 모두 교체.

---

### Task 5: 통합 테스트

- [ ] **Step 1: Docker 재시작**
```bash
cd /Users/comodoflow/Documents/project/slidant
docker compose restart api
```

- [ ] **Step 2: Ceph 10장 재생성**
Slidant UI에서: "분산 스토리지 시스템 Ceph에 대한 설명 PPT 10장으로 만들어줘"
기대 레이아웃: COVER, TOC, CARD_GRID, DATA, ICON_LIST, TIMELINE, COMPARISON, CONTENT, CONTENT, CLOSING (순환)

- [ ] **Step 3: 레이아웃 다양성 확인**
10장 중 CONTENT가 3장 이하인지 확인. CARD_GRID, DATA 레이아웃이 생성됐는지 확인.

- [ ] **Step 4: Chart.js 렌더링 확인**
DATA 레이아웃 슬라이드가 실제 차트를 렌더링하는지 iframe에서 확인.
