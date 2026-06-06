# Slidant — AI Agent 기반 HTML PPT 협업 툴

## 프로젝트 개요

여러 AI Agent가 역할 분담하여 HTML 슬라이드를 생성·편집하는 협업 플랫폼.
사용자는 자연어로 요청 → Agent가 HTML 직접 생성 → iframe 렌더링.

## 디렉터리 구조

```
slidant/
├── ui/          # 프론트엔드 (슬라이드 렌더링, 편집 UI)
├── api/         # 백엔드 (Agent 오케스트레이션, 버전 관리, LLM 로그)
└── CLAUDE.md
```

## 핵심 아키텍처

### 슬라이드 데이터 모델

**저장 방식**: `slides.html_content TEXT` — 슬라이드당 HTML 문자열 1개

```html
<style>.slide{width:960px;height:540px;position:relative;overflow:hidden;}</style>
<div class="slide">
  <div data-component-id="bg" style="position:absolute;inset:0;background:#0A0F1E"></div>
  <div data-component-id="title" style="position:absolute;left:80px;top:170px;font-size:68px;color:#F9FAFB">제목</div>
</div>
```

- 모든 요소: `position:absolute` + `data-component-id` 속성
- CSS 전체 기능 사용 가능 (gradient, shadow, animation, SVG 등)
- **렌더링**: `<iframe srcDoc={html_content}>` — 변환 없이 브라우저 직접 렌더링
- **하위 호환**: `html_content`가 null인 기존 슬라이드 → JSON 컴포넌트 렌더러 사용 (점진적 전환)

### Agent 파이프라인 (LangGraph)

```
planner → html_composer → html_validator → formatter → END
              ↑___________________|  (retry)
```

- `planner`: 자연어 계획 수립 (스트리밍)
- `html_composer`: LLM이 HTML 직접 생성 (`HTML_COMPOSER_PROMPT`)
- `html_validator`: HTML 유효성 검사 (비어있으면 retry)
- Agent 출력: `{"summary":"...","html":"..."}` 또는 `{"summary":"...","slides":[...]}`
- `html_mode=True`로 `run_agent` 호출 → 반환 5-tuple `(patches, ctx, summary, html_output, html_slides)`

### 패치 적용 흐름

```
html_output 있음  → slide.html_content 업데이트 (archive_and_apply)
html_output 없음  → JSON patch fallback (기존 comp_ops 방식)
html_slides 있음  → 새 슬라이드 생성 (html_content 포함)
```

### 슬라이드 컨텍스트 빌드

- `html_content` 있으면: `build_slide_context_from_html(html)` → HTML 그대로 LLM에 전달
- 없으면: `build_slide_context(components)` → JSON → HTML 변환본 (기존 방식)

### 유저 LLM API Key 관리
- BE 프록시 — 유저 key AES-256 암호화 저장, 요청 처리 중에만 메모리에 plaintext
- 로그에 절대 기록 안 함
- LLM 호출: api/ 레이어에서 수행

### AI Agent 시스템
- 역할별 Agent: `ContentAgent` | `DesignAgent` | `LayoutAgent`
- 사용자 정의 Agent 생성 지원
- 다중 Agent 동시 작업 → 충돌 감지 → ConflictResolver 모달

### 버전 관리
- `slide_history`: 슬라이드 전체 스냅샷 (JSON content 기준, 롤백용)
- `component_history`: 컴포넌트 단위 변경 기록
- Agent 작업 로그 항상 저장

### 변경 적용 방식
- Agent HTML 편집: `AgentProposal` 저장 → `agent_done` SSE에 `proposal` 포함 → 프론트엔드 ProposalPanel에서 컴포넌트별 승인/거절
  - `accepted_ids: null` → 전체 승인, `accepted_ids: [...]` → 선택 컴포넌트만 `merge_component_changes()`로 병합
- Agent 슬라이드 신규 생성 (`html_slides`): 즉시 적용 (승인 흐름 없음)
- JSON patch (레거시): 기존 ProposalPanel 통해 전체 승인/거절
- `data-component-id` 값은 IMMUTABLE — LLM 프롬프트에서 절대 불변 규칙으로 강제

## 기술 스택

| 영역 | 확정 |
|------|------|
| Frontend | React + TypeScript + Vite |
| Slide Render | `<iframe srcDoc>` (HTML 직렬) / JSON React 렌더러 (레거시) |
| Backend | FastAPI + Python 3.12 |
| Agent 오케스트레이션 | LangGraph |
| LLM | OpenRouter (기본) / Anthropic Claude |
| DB | PostgreSQL + SQLModel |
| 캐시 | Redis |
| 실시간 | SSE (Server-Sent Events) |

## 개발 원칙

- Agent는 HTML 직접 생성 — 중간 JSON 스키마 변환 없음
- `data-component-id` 필수 — 컴포넌트 식별 및 선택 UI 기반
- Agent HTML 편집 → Proposal 저장 → 사용자가 컴포넌트별 승인/거절 (즉시 적용 X)
- Agent 슬라이드 신규 생성은 즉시 적용 (편집과 구분)
- Agent 작업 로그 항상 저장 (디버깅 + 롤백 근거)
- 하위 호환 유지 — `html_content` null 슬라이드는 기존 렌더러 사용

## 유사 서비스 분석

| 서비스 | 강점 | 약점 |
|--------|------|------|
| 젠스파크 | AI PPT 생성 특화 | 수정·협업 어려움 |
| 미리캔버스 | 사람 중심 편집 | AI 기능 유료, Agent 협업 없음 |
| Snapdeck | 텍스트 프롬프트 → 완성 슬라이드, 버전 관리 | 세부 스타일 제어 부족, 다중 Agent 협업 없음 |

**차별점**: Agent 간 협업 + HTML 직접 저장/렌더링 + CSS 전체 표현력 + 충돌 시각화
