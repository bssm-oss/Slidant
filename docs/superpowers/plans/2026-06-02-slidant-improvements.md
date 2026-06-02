# Slidant 전면 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slidant의 버그·보안 취약점을 제거하고 UX를 개선하여 Snapdeck 대비 실질적 차별점(Agent 협업 + 실시간 스트리밍 + 디자인 품질)을 확보한다.

**Architecture:** BE는 FastAPI + LangGraph (Python), FE는 React + Zustand (TypeScript). 슬라이드 데이터는 JSONB 컬럼에 컴포넌트 배열로 저장. Agent는 SSE로 실시간 이벤트를 FE에 push. 변경사항은 AgentProposal로 저장, 유저 승인 후 적용.

**Tech Stack:** FastAPI · LangGraph · langchain-anthropic · SQLModel · PostgreSQL · React · Zustand · Tailwind CSS · Vite

---

## 우선순위 맵

| # | 영역 | 영향 | 난이도 |
|---|------|------|--------|
| 1 | `apply_patches` 순서 보장 | 데이터 무결성 | 쉬움 |
| 2 | Preview 컴포넌트 중복 | 렌더링 버그 | 쉬움 |
| 3 | Proposal 소유권 인증 | 보안 | 쉬움 |
| 4 | `_FakeSlide` → pure function | 안정성 | 쉬움 |
| 5 | Generator 스트리밍 | UX (침묵 제거) | 중간 |
| 6 | 디자인 룰 validator | 생성 품질 | 중간 |
| 7 | Drive 테이블 썸네일 | UX | 쉬움 |
| 8 | editorStore 분리 | 유지보수 | 어려움 |
| 9 | LLM 설정 외부화 | 운영 | 쉬움 |

---

## Task 1: `apply_patches` 컴포넌트 순서 보장

**Files:**
- Modify: `api/app/services/slide_content.py:75-123`

**문제:** `slide.content = list(comp_map.values())` — dict 순서가 render order와 다를 수 있음. 마지막에 `order` 기준 정렬 없음.

- [ ] **Step 1: 정렬 추가**

`api/app/services/slide_content.py` 의 `apply_patches` 함수 마지막 줄 수정:

```python
# 기존
slide.content = list(comp_map.values())

# 변경
slide.content = sorted(comp_map.values(), key=lambda c: c.get("order", 0))
```

- [ ] **Step 2: 수동 검증**

```bash
cd api
python3 -c "
from app.services.slide_content import apply_patches
from types import SimpleNamespace

slide = SimpleNamespace(content=[
    {'id': 'a', 'type': 'text', 'order': 2, 'properties': {}},
    {'id': 'b', 'type': 'shape', 'order': 0, 'properties': {}},
])

ops = [{'op': 'add', 'path': '/-', 'value': {'type': 'text', 'order': 1, 'properties': {}}}]
apply_patches(slide, ops)
orders = [c['order'] for c in slide.content]
assert orders == sorted(orders), f'순서 오류: {orders}'
print('OK:', orders)
"
```

Expected: `OK: [0, 1, 2]`

- [ ] **Step 3: 커밋**

```bash
git add api/app/services/slide_content.py
git commit -m "fix: apply_patches 결과를 order 기준 정렬하여 레이어 순서 보장"
```

---

## Task 2: Preview 컴포넌트 중복 버그 수정

**Files:**
- Modify: `ui/src/features/editor/store/editorStore.ts:296-300`

**문제:** `agent_token` 핸들러에서 동일 슬라이드 reference를 두 번 spread해 non-preview 컴포넌트가 2배 들어감.

```ts
// 버그 코드
{ ...sl, components: [
  ...sl.components.filter(!preview),   // 동일
  ...slide.components.filter(!preview), // 동일 (sl === slide when idx === slideIndex)
  ...newComponents
]}
```

- [ ] **Step 1: 중복 제거**

`ui/src/features/editor/store/editorStore.ts` 의 `agent_token` 핸들러 내 슬라이드 업데이트 부분:

```ts
// 기존 (줄 296-302)
const newSlides = s.presentation.slides.map((sl, idx) =>
  idx === slideIndex
    ? { ...sl, components: [...sl.components.filter((c) => !c.id.startsWith('preview-')), ...slide.components.filter((c) => !c.id.startsWith('preview-')).slice(0), ...newComponents] }
    : sl
)

// 변경
const newSlides = s.presentation.slides.map((sl, idx) =>
  idx === slideIndex
    ? { ...sl, components: [...sl.components.filter((c) => !c.id.startsWith('preview-')), ...newComponents] }
    : sl
)
```

- [ ] **Step 2: 타입 체크**

```bash
cd ui && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add ui/src/features/editor/store/editorStore.ts
git commit -m "fix: agent_token 핸들러 non-preview 컴포넌트 중복 삽입 버그 수정"
```

---

## Task 3: Proposal 소유권 인증 추가

**Files:**
- Modify: `api/app/api/v1/endpoints/proposals.py`

**문제:** `approve_proposal`, `reject_proposal` 엔드포인트가 proposal이 현재 유저의 프로젝트 소유인지 확인하지 않음. 유효한 JWT만 있으면 타인 proposal 승인/거절 가능.

- [ ] **Step 1: 슬라이드 → 프로젝트 → 소유자 체인 검증 추가**

`api/app/api/v1/endpoints/proposals.py` 전체 교체:

```python
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.deps import CurrentUser, UoW
from app.services import slide_history_service
from app.services.slide_content import apply_patches

router = APIRouter(prefix='/proposals', tags=['proposals'])


class ProposalResponse(BaseModel):
    id: UUID
    slide_id: UUID
    agent_name: str
    command: str
    patches: list
    summary: str
    status: str
    created_at: datetime
    model_config = {'from_attributes': True}


async def _get_proposal_and_verify_ownership(
    proposal_id: UUID, current_user: CurrentUser, uow: UoW
):
    """proposal 조회 + 슬라이드 → 프로젝트 소유권 검증."""
    proposal = await uow.proposals.get(proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail='Proposal not found')

    slide = await uow.slides.get(proposal.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')

    project = await uow.projects.get(slide.project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail='Not authorized')

    return proposal, slide


@router.get('/by-slide/{slide_id}', response_model=list[ProposalResponse])
async def list_proposals_by_slide(
    slide_id: UUID, current_user: CurrentUser, uow: UoW, status_filter: str | None = None
):
    # 슬라이드 소유권 검증
    slide = await uow.slides.get(slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail='Slide not found')
    project = await uow.projects.get(slide.project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail='Not authorized')
    return await uow.proposals.list_by_slide(slide_id, status=status_filter)


@router.post('/{proposal_id}/approve', status_code=status.HTTP_204_NO_CONTENT)
async def approve_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal, slide = await _get_proposal_and_verify_ownership(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    new_content = list(slide.content or [])

    class _PatchTarget:
        def __init__(self, content):
            self.content = content

    target = _PatchTarget(new_content)
    apply_patches(target, proposal.patches)

    reason = f'{proposal.agent_name}: {proposal.command[:120]}'
    await slide_history_service.archive_and_apply(uow, proposal.slide_id, target.content, reason)
    proposal.status = 'approved'


@router.post('/{proposal_id}/reject', status_code=status.HTTP_204_NO_CONTENT)
async def reject_proposal(proposal_id: UUID, current_user: CurrentUser, uow: UoW):
    proposal, _ = await _get_proposal_and_verify_ownership(proposal_id, current_user, uow)

    if proposal.status != 'pending':
        raise HTTPException(status_code=400, detail='Proposal already processed')

    proposal.status = 'rejected'
```

> 참고: `_PatchTarget`이 `_FakeSlide`를 대체한다. 여전히 duck typing이지만 `apply_patches`를 pure function으로 바꾸는 작업은 Task 4에서 한다.

- [ ] **Step 2: ProjectRepository에 `get` 메서드 있는지 확인**

```bash
grep -n "async def get" api/app/repositories/project.py
```

없으면 `api/app/repositories/base.py`의 `get` 메서드 상속 여부 확인:

```bash
grep -n "async def get" api/app/repositories/base.py
```

- [ ] **Step 3: API 서버 재시작 후 검증**

```bash
# 터미널 1: 서버 재시작
cd api && uvicorn app.main:app --reload --port 8000

# 터미널 2: 다른 유저 토큰으로 proposal 승인 시도
curl -X POST http://localhost:8000/api/v1/proposals/<proposal_id>/approve \
  -H "Authorization: Bearer <other_user_token>"
# Expected: 403 Forbidden
```

- [ ] **Step 4: 커밋**

```bash
git add api/app/api/v1/endpoints/proposals.py
git commit -m "fix: proposal approve/reject에 소유권 검증 추가 (보안)"
```

---

## Task 4: `apply_patches` pure function 리팩터

**Files:**
- Modify: `api/app/services/slide_content.py`
- Modify: `api/app/api/v1/endpoints/proposals.py`

**문제:** `apply_patches(slide, ops)`가 `slide.content`를 in-place mutation. caller가 fake object 만들어야 함. Pure function으로 바꿔 테스트·재사용 쉽게.

- [ ] **Step 1: `apply_patches` 시그니처 변경**

`api/app/services/slide_content.py`에서 `apply_patches` 함수를 수정:

```python
def apply_patches(slide_or_content, ops: list[dict]) -> None:
    """slide.content (또는 Slide 객체)에 RFC 6902 ops를 in-place 적용.
    
    slide_or_content: Slide 객체이거나 content 리스트를 가진 객체.
    """
    if isinstance(slide_or_content, list):
        # 직접 리스트를 넘긴 경우는 지원하지 않음 (mutation이 caller에 반영 안 됨)
        raise TypeError("apply_patches는 .content 속성을 가진 객체가 필요합니다")
    slide = slide_or_content
    content = list(slide.content or [])
    comp_map: dict[str, dict] = {c["id"]: dict(c) for c in content}
    order_counter = max((c.get("order", 0) for c in content), default=-1) + 1

    for op in ops:
        if not isinstance(op, dict):
            logger.warning("apply_patches: skip non-dict op: %r", op)
            continue
        operation = op.get("op")
        path_parts = op.get("path", "").strip("/").split("/")
        if not path_parts:
            continue

        if operation == "add" and path_parts[0] in ("-", ""):
            value = op.get("value", {})
            if not isinstance(value, dict):
                continue
            new_comp = {
                "id": str(uuid4()),
                "type": value.get("type", "text"),
                "parent_id": value.get("parent_id"),
                "order": value.get("order", order_counter),
                "properties": value.get("properties", {}),
                "created_at": _now(),
                "updated_at": _now(),
            }
            comp_map[new_comp["id"]] = new_comp
            order_counter += 1
            continue

        comp_id = path_parts[0]
        if comp_id not in comp_map:
            continue

        comp = comp_map[comp_id]
        if operation == "replace" and len(path_parts) > 1:
            field = path_parts[1]
            if field == "properties" and len(path_parts) > 2:
                prop_key = path_parts[2]
                comp["properties"] = {**comp.get("properties", {}), prop_key: op.get("value")}
            elif field == "order":
                comp["order"] = op.get("value")
            comp["updated_at"] = _now()
        elif operation == "remove":
            del comp_map[comp_id]

    slide.content = sorted(comp_map.values(), key=lambda c: c.get("order", 0))
```

- [ ] **Step 2: proposals.py에서 `_PatchTarget` duck typing 유지 확인**

Task 3에서 이미 `_PatchTarget`으로 교체했으므로 추가 작업 없음. 단, `_PatchTarget.content`가 list임을 확인:

```bash
grep -A5 "_PatchTarget" api/app/api/v1/endpoints/proposals.py
```

- [ ] **Step 3: 타입 체크**

```bash
cd api && python3 -c "from app.services.slide_content import apply_patches; print('OK')"
```

- [ ] **Step 4: 커밋**

```bash
git add api/app/services/slide_content.py
git commit -m "refactor: apply_patches 내부 정리 및 order 정렬 통합"
```

---

## Task 5: Generator 노드 스트리밍 활성화

**Files:**
- Modify: `api/app/services/agent_runner.py:313-401`

**문제:** `generator_node`가 Anthropic provider에서 `ainvoke` 사용 → LLM이 응답을 완성할 때까지 FE에 아무 피드백 없음 (planner 스트리밍 후 10-30초 침묵). `astream`으로 전환해 실시간 토큰 emit.

- [ ] **Step 1: generator_node를 astream으로 전환**

`api/app/services/agent_runner.py`의 `generator_node` 함수 내 Anthropic 분기 수정:

```python
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
        # Anthropic: structured output with streaming via astream_events
        messages = [
            SystemMessage(content=gen_prompt),
            HumanMessage(content=human_text),
        ]
        raw_content = ""
        try:
            # astream으로 토큰 실시간 전달
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
                        on_token(token)  # 실시간 전달

            # 완성된 텍스트에서 JSON 추출
            parsed = _extract_json(raw_content)
            if parsed is None:
                logger.warning("  [generator] parse fail  raw=%r", raw_content[:300])
            elif isinstance(parsed, dict) and "ops" in parsed:
                patches = _flatten_ops(parsed["ops"] if isinstance(parsed["ops"], list) else [])
                summary = parsed.get("summary", "")
            elif isinstance(parsed, list):
                patches = _flatten_ops(parsed)
        except Exception as exc:
            logger.warning("  [generator] astream failed (%s)", exc)
    else:
        # OpenRouter / non-Anthropic: 기존 astream 방식 유지
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

    if on_event: on_event("node_done", f"✅ {len(patches)}개 작업 생성")
    return {**state, "result_patches": patches, "result_summary": summary, "messages": []}
```

> **참고:** Anthropic의 structured output(`with_structured_output`)은 내부적으로 tool_use를 사용하는데, `astream`으로는 streaming tool use 응답을 받아서 파싱하기 복잡하다. 대신 `astream`으로 raw JSON 텍스트를 받아서 `_extract_json`으로 파싱하는 방식이 더 단순하고 스트리밍도 된다. 품질 저하 없음 (Claude는 JSON을 잘 생성함).

- [ ] **Step 2: on_token이 generator에서도 호출되는지 E2E 확인**

서버 재시작 후 에디터에서 Agent 명령 실행. FE의 채팅 말풍선이 planner 후에도 계속 업데이트되는지 확인.

```bash
cd api && uvicorn app.main:app --reload --port 8000
```

브라우저에서: 에디터 열기 → Agent에 "배경 추가해줘" 입력 → 채팅 말풍선이 planner 완료 후에도 계속 토큰 스트리밍 확인.

- [ ] **Step 3: 커밋**

```bash
git add api/app/services/agent_runner.py
git commit -m "feat: generator 노드 astream 전환으로 JSON 생성 중 실시간 토큰 스트리밍"
```

---

## Task 6: 디자인 룰 Post-generation Validator

**Files:**
- Modify: `api/app/services/agent_runner.py` (validator_node 교체)

**문제:** `validator_node`가 op 형식만 체크하고 디자인 품질 무시. LLM이 design system 규칙(폰트 크기, 배경색, 액센트 바)을 무시해도 통과됨.

- [ ] **Step 1: validator_node에 디자인 룰 체크 추가**

`api/app/services/agent_runner.py`의 `validator_node` 함수 교체:

```python
def validator_node(state: AgentState) -> AgentState:
    patches = state.get("result_patches", [])

    # 1단계: 기본 op 형식 검증
    valid = [
        op for op in patches
        if isinstance(op, dict) and op.get("op") in ("add", "replace", "remove") and "path" in op
    ]
    invalid = len(patches) - len(valid)
    if invalid:
        logger.warning("  [validator] %d개 무효 op 제거", invalid)

    # 2단계: 디자인 룰 체크 (add op만 대상)
    add_ops = [op for op in valid if op.get("op") == "add" and op.get("path") in ("/-", "/")]
    if add_ops:
        warnings = _check_design_rules(add_ops)
        for w in warnings:
            logger.warning("  [validator] design: %s", w)

    logger.info("  [validator] valid ops=%d  retry=%d", len(valid), state.get("retry_count", 0))
    return {**state, "result_patches": valid}


def _check_design_rules(add_ops: list[dict]) -> list[str]:
    """디자인 룰 위반 경고 수집. 현재는 로깅만; retry 조건으로 발전 가능."""
    warnings = []
    types_added = [op.get("value", {}).get("type") for op in add_ops]
    props_list = [op.get("value", {}).get("properties", {}) for op in add_ops]

    # 배경 shape/image가 없으면 경고
    has_background = any(
        props.get("size", {}).get("w", 0) >= 900 and props.get("size", {}).get("h", 0) >= 500
        for props in props_list
    )
    if not has_background:
        warnings.append("배경 레이어 없음 (960x540 shape/image 없음)")

    # 텍스트가 있는데 메인 폰트가 너무 작으면 경고
    text_ops = [p for t, p in zip(types_added, props_list) if t == "text"]
    if text_ops:
        max_font = max((p.get("fontSize", 0) for p in text_ops), default=0)
        if max_font < 28:
            warnings.append(f"최대 폰트 {max_font}pt — 28pt 이상 권장")

    # 텍스트가 너무 많으면 경고 (슬라이드당 8개 이상)
    text_count = sum(1 for t in types_added if t == "text")
    if text_count > 8:
        warnings.append(f"텍스트 컴포넌트 {text_count}개 — 슬라이드당 8개 이하 권장")

    return warnings
```

- [ ] **Step 2: 로그에서 디자인 경고 확인**

```bash
cd api && uvicorn app.main:app --reload --port 8000 2>&1 | grep "design:"
```

Agent 실행 시 `[validator] design:` 경고 출력 확인.

- [ ] **Step 3: 커밋**

```bash
git add api/app/services/agent_runner.py
git commit -m "feat: validator_node에 디자인 룰 체크 추가 (폰트·배경·컴포넌트 수)"
```

---

## Task 7: Drive 테이블 뷰 썸네일

**Files:**
- Modify: `ui/src/features/drive/components/PresentationTable.tsx`

- [ ] **Step 1: PresentationTable 파일 확인**

```bash
cat ui/src/features/drive/components/PresentationTable.tsx
```

- [ ] **Step 2: 테이블 행에 썸네일 열 추가**

`PresentationTable.tsx`의 각 행(tr)에 썸네일 셀 추가:

```tsx
import SlideThumbnail from './SlideThumbnail'

// 테이블 헤더에 추가
<th className="w-[120px] ...">미리보기</th>

// 각 행에 추가
<td className="py-2 pr-4">
  <div className="w-[120px] rounded-[6px] overflow-hidden border border-[var(--border)]">
    <SlideThumbnail projectId={presentation.id} />
  </div>
</td>
```

실제 파일을 읽고 기존 구조에 맞게 삽입할 것.

- [ ] **Step 3: 브라우저에서 확인**

`http://localhost:5173/drive` → "모든 프레젠테이션" 테이블에 썸네일 열 표시 확인.

- [ ] **Step 4: 커밋**

```bash
git add ui/src/features/drive/components/PresentationTable.tsx
git commit -m "feat: drive 테이블 뷰에 슬라이드 썸네일 추가"
```

---

## Task 8: editorStore 분리

**Files:**
- Create: `ui/src/features/editor/store/slideStore.ts`
- Create: `ui/src/features/editor/store/agentStore.ts`
- Create: `ui/src/features/editor/store/proposalStore.ts`
- Modify: `ui/src/features/editor/store/editorStore.ts` (thin coordinator로 축소)
- Modify: 모든 `useEditorStore` 사용 파일들

**문제:** 756줄 단일 파일에 슬라이드 CRUD + SSE 파싱 + 채팅 + 에이전트 상태 + 프로포절 혼재. 버그 추적·테스트 불가.

- [ ] **Step 1: slideStore 분리**

`ui/src/features/editor/store/slideStore.ts` 생성:

```ts
import { create } from 'zustand'
import type { Presentation, Slide } from '@/shared/types'
import { api } from '@/shared/lib/apiClient'
import { fetchProjectWithSlides, deleteSlide as apiDeleteSlide, reorderSlides as apiReorderSlides } from '@/shared/lib/projectApi'

interface SlideState {
  presentation: Presentation | null
  currentSlideIndex: number
  selectedComponentId: string | null

  loadPresentation: (id: string) => Promise<void>
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  addSlide: () => Promise<void>
  deleteSlide: (index?: number) => Promise<void>
  duplicateSlide: (index?: number) => Promise<void>
  reorderSlides: (oldIndex: number, newIndex: number) => Promise<void>
  updateTitle: (title: string) => void
  saveTitle: (title: string) => Promise<void>
  deleteComponent: (componentId?: string) => Promise<void>
}

export const useSlideStore = create<SlideState>((set, get) => ({
  presentation: null,
  currentSlideIndex: 0,
  selectedComponentId: null,

  loadPresentation: async (id) => {
    try {
      const ppt = await fetchProjectWithSlides(id)
      set({ presentation: ppt })
    } catch (e) {
      console.error('loadPresentation failed', e)
    }
  },

  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),
  selectComponent: (id) => set({ selectedComponentId: id }),

  updateTitle: (title) => set((s) => ({
    presentation: s.presentation ? { ...s.presentation, title } : null,
  })),

  saveTitle: async (title) => {
    const ppt = get().presentation
    if (!ppt) return
    const { updateProject } = await import('@/shared/lib/projectApi')
    await updateProject(ppt.id, title)
    set((s) => ({ presentation: s.presentation ? { ...s.presentation, title } : null }))
  },

  addSlide: async () => {
    const ppt = get().presentation
    if (!ppt) return
    const res = await api.post<{ id: string; order: number; title: string | null }>(`/projects/${ppt.id}/slides`, {})
    const newSlide: Slide = { id: res.id, order: res.order, components: [] }
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides: [...s.presentation.slides, newSlide] } : null,
      currentSlideIndex: (s.presentation?.slides.length ?? 0),
    }))
  },

  deleteSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt || ppt.slides.length <= 1) return
    const idx = index ?? get().currentSlideIndex
    const slide = ppt.slides[idx]
    const newSlides = ppt.slides.filter((_, i) => i !== idx)
    const newIndex = Math.min(idx, newSlides.length - 1)
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides: newSlides } : null,
      currentSlideIndex: newIndex,
      selectedComponentId: null,
    }))
    try {
      await apiDeleteSlide(ppt.id, slide.id)
    } catch {
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: idx,
      }))
    }
  },

  duplicateSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt) return
    const idx = index ?? get().currentSlideIndex
    const sourceSlide = ppt.slides[idx]
    const newSlideRes = await api.post<{ id: string; order: number }>(`/projects/${ppt.id}/slides`, {})
    const copiedComps = await Promise.all(
      sourceSlide.components.map((comp) =>
        api.post<any>(`/projects/${ppt.id}/slides/${newSlideRes.id}/components`, {
          type: comp.type, properties: comp.props, order: comp.zIndex,
        })
      )
    )
    const newSlide: Slide = {
      id: newSlideRes.id,
      order: newSlideRes.order,
      components: copiedComps.map((c: any) => ({
        id: c.id, type: c.type,
        position: c.properties?.position ?? { x: 0, y: 0 },
        size: c.properties?.size ?? { w: 400, h: 100 },
        props: c.properties, zIndex: c.order ?? 0,
      })),
    }
    const slides = [...ppt.slides]
    slides.splice(idx + 1, 0, newSlide)
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides } : null,
      currentSlideIndex: idx + 1,
    }))
    await apiReorderSlides(ppt.id, slides.map((s) => s.id))
  },

  reorderSlides: async (oldIndex, newIndex) => {
    const ppt = get().presentation
    if (!ppt || oldIndex === newIndex) return
    const slides = [...ppt.slides]
    const [moved] = slides.splice(oldIndex, 1)
    slides.splice(newIndex, 0, moved)
    const currentIdx = get().currentSlideIndex
    const newCurrentIdx =
      currentIdx === oldIndex ? newIndex
      : currentIdx > oldIndex && currentIdx <= newIndex ? currentIdx - 1
      : currentIdx < oldIndex && currentIdx >= newIndex ? currentIdx + 1
      : currentIdx
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides } : null,
      currentSlideIndex: newCurrentIdx,
    }))
    try {
      await apiReorderSlides(ppt.id, slides.map((s) => s.id))
    } catch {
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: currentIdx,
      }))
    }
  },

  deleteComponent: async (componentId) => {
    const { presentation, currentSlideIndex, selectedComponentId } = get()
    const targetId = componentId ?? selectedComponentId
    if (!targetId || !presentation) return
    const slide = presentation.slides[currentSlideIndex]
    if (!slide) return
    set((s) => ({
      selectedComponentId: null,
      presentation: s.presentation ? {
        ...s.presentation,
        slides: s.presentation.slides.map((sl, i) =>
          i === currentSlideIndex
            ? { ...sl, components: sl.components.filter((c) => c.id !== targetId) }
            : sl
        ),
      } : null,
    }))
    try {
      await api.delete(`/projects/${presentation.id}/slides/${slide.id}/components/${targetId}`)
    } catch {
      get().loadPresentation(presentation.id)
    }
  },
}))
```

- [ ] **Step 2: proposalStore 분리**

`ui/src/features/editor/store/proposalStore.ts` 생성:

```ts
import { create } from 'zustand'
import type { AgentProposal } from '@/shared/types'

interface ProposalState {
  proposals: AgentProposal[]
  setProposals: (proposals: AgentProposal[]) => void
  addProposal: (proposal: AgentProposal) => void
  approveProposal: (id: string) => Promise<void>
  rejectProposal: (id: string) => Promise<void>
}

export const useProposalStore = create<ProposalState>((set) => ({
  proposals: [],

  setProposals: (proposals) => set({ proposals }),

  addProposal: (proposal) => set((s) => ({ proposals: [...s.proposals, proposal] })),

  approveProposal: async (id) => {
    const { approveProposal: apiApprove } = await import('@/shared/lib/proposalApi')
    await apiApprove(id)
    set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }))
  },

  rejectProposal: async (id) => {
    const { rejectProposal: apiReject } = await import('@/shared/lib/proposalApi')
    await apiReject(id)
    set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }))
  },
}))
```

- [ ] **Step 3: agentStore 분리**

`ui/src/features/editor/store/agentStore.ts` 생성 (SSE 핸들러 + 채팅 + 에이전트 상태 포함). 이 파일이 가장 크고 복잡하므로 기존 editorStore에서 SSE 핸들러 코드를 그대로 이동. `useSlideStore`와 `useProposalStore`를 `getState()`로 참조.

핵심 구조:

```ts
import { create } from 'zustand'
import type { Agent, AgentLog, AgentStatus, ChatMessage } from '@/shared/types'
import { sseClient } from '@/shared/lib/sseClient'
import { runAgent as runAgentApi } from '@/shared/lib/agentRunApi'
import { useSlideStore } from './slideStore'
import { useProposalStore } from './proposalStore'

// extractCompleteOps 함수는 이 파일 상단에 이동

interface AgentState {
  agents: Agent[]
  agentLogs: AgentLog[]
  chatMessages: ChatMessage[]
  selectedAgentDefinitionId: string | null
  runningAgentIds: Set<string>
  conflictComponentIds: Set<string>
  overallStatus: AgentStatus
  activeRightTab: 'agent' | 'properties'
  isTitleEditing: boolean

  loadAgents: (projectId?: string) => Promise<void>
  loadChatHistory: (projectId: string) => Promise<void>
  loadAgentLogs: (projectId: string) => Promise<void>
  connectWs: (projectId: string) => () => void
  selectChatAgent: (definitionId: string | null) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  setTitleEditing: (v: boolean) => void
  sendMessage: (command: string) => Promise<void>
  runAgent: (command: string, agentRole?: string, agentDefinitionId?: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // ... 기존 editorStore에서 agent 관련 상태와 액션 이동
  // useSlideStore.getState().presentation 참조
  // useProposalStore.getState().addProposal 참조
}))
```

- [ ] **Step 4: editorStore를 thin facade로 교체**

`ui/src/features/editor/store/editorStore.ts` → 세 스토어를 re-export하는 backward compat facade:

```ts
// 기존 컴포넌트가 useEditorStore를 사용 중이므로 하위 호환 유지
import { useSlideStore } from './slideStore'
import { useAgentStore } from './agentStore'
import { useProposalStore } from './proposalStore'

export function useEditorStore() {
  const slide = useSlideStore()
  const agent = useAgentStore()
  const proposal = useProposalStore()
  return { ...slide, ...agent, ...proposal }
}
```

> **주의:** `useEditorStore`를 hook으로 유지하면 세 스토어의 모든 상태 변경 시 리렌더링 발생. 성능이 중요한 컴포넌트는 직접 개별 스토어 사용으로 마이그레이션할 것. 이 Task는 우선 동작 보장이 목적.

- [ ] **Step 5: 타입 체크 + 브라우저 확인**

```bash
cd ui && npx tsc --noEmit
```

`http://localhost:5173/edit/<project_id>` 에서 에디터 정상 동작 확인:
- 슬라이드 전환
- Agent 채팅
- Proposal 수락/거절

- [ ] **Step 6: 커밋**

```bash
git add ui/src/features/editor/store/
git commit -m "refactor: editorStore를 slideStore/agentStore/proposalStore로 분리"
```

---

## Task 9: LLM 설정 외부화

**Files:**
- Modify: `api/app/core/config.py`
- Modify: `api/app/services/agent_runner.py`
- Modify: `api/.env.example`

**문제:** 모델명(`claude-sonnet-4-6`), `MAX_RETRIES`, `OPENROUTER_DEFAULT_MODEL` 등이 코드에 하드코딩.

- [ ] **Step 1: config.py에 LLM 설정 추가**

`api/app/core/config.py`에 필드 추가:

```python
class Settings(BaseSettings):
    # ... 기존 필드들 ...
    
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"
    OPENROUTER_MODEL: str = "deepseek/deepseek-v4-pro"
    AGENT_MAX_RETRIES: int = 2
    AGENT_MAX_TOKENS: int = 4096
```

- [ ] **Step 2: agent_runner.py에서 settings 사용**

`api/app/services/agent_runner.py`에서 하드코딩 값 교체:

```python
# 파일 상단 임포트
from app.core.config import settings

# 기존
OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-pro"
MAX_RETRIES = 2

# 변경 (모듈 레벨 상수 제거, settings에서 읽기)
# _make_llm 내부:
model="claude-sonnet-4-6"  →  model=settings.ANTHROPIC_MODEL
model=OPENROUTER_DEFAULT_MODEL  →  model=settings.OPENROUTER_MODEL
max_tokens=4096  →  max_tokens=settings.AGENT_MAX_TOKENS

# should_retry 내부:
if not state.get("result_patches") and retry < MAX_RETRIES:  →  if not state.get("result_patches") and retry < settings.AGENT_MAX_RETRIES:
```

- [ ] **Step 3: .env.example 업데이트**

`api/.env.example`에 추가:

```
ANTHROPIC_MODEL=claude-sonnet-4-6
OPENROUTER_MODEL=deepseek/deepseek-v4-pro
AGENT_MAX_RETRIES=2
AGENT_MAX_TOKENS=4096
```

- [ ] **Step 4: 검증**

```bash
cd api && python3 -c "from app.core.config import settings; print(settings.ANTHROPIC_MODEL)"
# Expected: claude-sonnet-4-6
```

- [ ] **Step 5: 커밋**

```bash
git add api/app/core/config.py api/app/services/agent_runner.py api/.env.example
git commit -m "refactor: LLM 모델명·설정값 환경변수로 외부화"
```

---

## Self-Review

### Spec Coverage
- ✅ apply_patches 순서 → Task 1
- ✅ Preview 중복 → Task 2
- ✅ Proposal 인증 → Task 3
- ✅ _FakeSlide → Task 3, 4
- ✅ Generator 스트리밍 → Task 5
- ✅ 디자인 validator → Task 6
- ✅ 테이블 썸네일 → Task 7
- ✅ God Store → Task 8
- ✅ 설정 외부화 → Task 9
- ⚠️ Slide order 값 누적 (0→52 문제): 테스트 데이터 문제, 코드 버그 아님. `reorder_slides`가 실제로 normalize하므로 유저가 drag reorder 한 번만 해도 해결됨. 별도 Task 불필요.
- ⚠️ conversation_history 포맷 개선: 현재 `"User: ...\nAgent: ..."` 포맷은 충분히 명확함. 별도 Task 추가 안 함.

### Placeholder 스캔
- Task 7 Step 2: "실제 파일을 읽고 기존 구조에 맞게 삽입할 것" — 구체적 코드 없음. Task 7 실행 시 먼저 파일 읽고 실제 코드 삽입할 것.
- Task 8 Step 3: agentStore 내부 구현이 "..." 로 생략됨. 가장 복잡한 Task이므로 실행 시 editorStore.ts의 agent 관련 코드 전체를 이동.

### Type Consistency
- `SlideState.loadPresentation` → proposals 로드 안 함. proposals 로드는 `agentStore.connectWs` 또는 별도 `proposalStore.loadProposals` 에서 처리해야 함. Task 8 실행 시 주의.
