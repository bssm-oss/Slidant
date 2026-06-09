# History Diff Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 히스토리 항목 클릭 시 우측 패널이 슬라이드인되며 Before/After 미니 슬라이드 + 어떤 컴포넌트 ID가 추가/제거/수정됐는지 태그로 표시

**Architecture:**
- BE: `SlideHistory` 연속 두 버전 HTML diff → `{added, removed, modified}` 컴포넌트 ID 목록 반환. 이미 존재하는 `_parse_html_components` 재사용.
- FE: `HistoryPanel` 클릭 시 diff fetch → Dialog를 좌우 split으로 전환 (왼쪽: 히스토리 목록, 오른쪽: Before/After iframe + 태그)

**Tech Stack:** FastAPI, SQLAlchemy async, React, TypeScript, iframe srcDoc

---

## File Map

| 파일 | 작업 |
|------|------|
| `api/app/repositories/slide_history.py` | `get_previous_entry` 메서드 추가 |
| `api/app/services/slide_history_service.py` | `compute_history_diff` 함수 추가 |
| `api/app/api/v1/endpoints/projects.py` | `GET .../history/{id}/diff` 엔드포인트 추가 |
| `ui/src/shared/lib/projectApi.ts` | `HistoryDiff` 타입 + `fetchHistoryDiff` 함수 추가 |
| `ui/src/features/editor/components/HistoryPanel.tsx` | 클릭 핸들러, diff 상태, 우측 패널 UI 추가 |

---

### Task 1: SlideHistoryRepository — `get_previous_entry`

**Files:**
- Modify: `api/app/repositories/slide_history.py`

- [ ] **Step 1: `get_previous_entry` 메서드 추가**

```python
# api/app/repositories/slide_history.py
from datetime import datetime

class SlideHistoryRepository(BaseRepository[SlideHistory]):
    model = SlideHistory

    async def list_by_slide(self, slide_id: UUID, limit: int = 50) -> list[SlideHistory]:
        result = await self.session.execute(
            select(SlideHistory)
            .where(SlideHistory.slide_id == slide_id)
            .order_by(SlideHistory.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_previous_entry(self, slide_id: UUID, before_dt: datetime) -> SlideHistory | None:
        """주어진 시각 이전에 저장된 가장 최신 SlideHistory 반환."""
        result = await self.session.execute(
            select(SlideHistory)
            .where(
                SlideHistory.slide_id == slide_id,
                SlideHistory.created_at < before_dt,
            )
            .order_by(SlideHistory.created_at.desc())
            .limit(1)
        )
        return result.scalars().first()
```

- [ ] **Step 2: 커밋**

```bash
git add api/app/repositories/slide_history.py
git commit -m "feat(history): add get_previous_entry to SlideHistoryRepository"
```

---

### Task 2: slide_history_service — `compute_history_diff`

**Files:**
- Modify: `api/app/services/slide_history_service.py`

`_parse_html_components`는 `history_diff.py`에 private 함수로 존재. 서비스에서 직접 import해서 재사용.

- [ ] **Step 1: `compute_history_diff` 함수 추가**

```python
# api/app/services/slide_history_service.py 하단에 추가

from dataclasses import dataclass


@dataclass
class HistoryDiffResult:
    added: list[str]      # 추가된 component_id 목록
    removed: list[str]    # 제거된 component_id 목록
    modified: list[str]   # 수정된 component_id 목록 (중복 제거)
    before_html: str | None
    after_html: str | None


async def compute_history_diff(uow, slide_id: UUID, history_id: UUID) -> HistoryDiffResult:
    """SlideHistory 한 항목과 그 직전 항목을 diff해 변경된 컴포넌트 ID 목록 반환."""
    from fastapi import HTTPException, status
    from app.core.domain.history_diff import _parse_html_components

    entry = await uow.slide_history.get(history_id)
    if not entry or entry.slide_id != slide_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History entry not found")

    prev = await uow.slide_history.get_previous_entry(slide_id, entry.created_at)

    before_html = prev.html_content if prev else None
    after_html = entry.html_content

    old_map = _parse_html_components(before_html or "")
    new_map = _parse_html_components(after_html or "")

    all_ids = set(old_map) | set(new_map)
    added, removed, modified = [], [], []

    for comp_id in all_ids:
        old = old_map.get(comp_id)
        new = new_map.get(comp_id)
        if old is None and new is not None:
            added.append(comp_id)
        elif old is not None and new is None:
            removed.append(comp_id)
        elif old != new:
            modified.append(comp_id)

    return HistoryDiffResult(
        added=sorted(added),
        removed=sorted(removed),
        modified=sorted(modified),
        before_html=before_html,
        after_html=after_html,
    )
```

- [ ] **Step 2: 커밋**

```bash
git add api/app/services/slide_history_service.py
git commit -m "feat(history): add compute_history_diff service function"
```

---

### Task 3: API 엔드포인트 — `GET .../history/{id}/diff`

**Files:**
- Modify: `api/app/api/v1/endpoints/projects.py`

- [ ] **Step 1: `SlideHistoryDiffResponse` 모델 + 엔드포인트 추가**

`SlideHistoryResponse` 정의 바로 아래에 추가:

```python
class SlideHistoryDiffResponse(BaseModel):
    added: list[str]
    removed: list[str]
    modified: list[str]
    before_html: str | None = None
    after_html: str | None = None
```

`restore_from_history_endpoint` 함수 바로 위에 엔드포인트 추가:

```python
@router.get("/{project_id}/slides/{slide_id}/history/{history_id}/diff", response_model=SlideHistoryDiffResponse)
async def get_history_diff(
    project_id: UUID, slide_id: UUID, history_id: UUID,
    current_user: CurrentUser, uow: UoW,
):
    await project_service.get_slide(uow.projects, uow.slides, project_id, current_user.id, slide_id)
    from app.services.slide_history_service import compute_history_diff
    result = await compute_history_diff(uow, slide_id, history_id)
    return SlideHistoryDiffResponse(
        added=result.added,
        removed=result.removed,
        modified=result.modified,
        before_html=result.before_html,
        after_html=result.after_html,
    )
```

- [ ] **Step 2: 서버 재시작 후 동작 확인**

```bash
curl -s "http://localhost:8000/projects/{project_id}/slides/{slide_id}/history/{history_id}/diff" \
  -H "Authorization: Bearer {token}" | python3 -m json.tool
# Expected: {"added":[],"removed":[],"modified":["title","bg"],"before_html":"...","after_html":"..."}
```

- [ ] **Step 3: 커밋**

```bash
git add api/app/api/v1/endpoints/projects.py
git commit -m "feat(history): add GET history/{id}/diff endpoint"
```

---

### Task 4: 프론트 — `fetchHistoryDiff` API 함수

**Files:**
- Modify: `ui/src/shared/lib/projectApi.ts`

- [ ] **Step 1: 타입 + 함수 추가**

`SlideHistoryEntry` 인터페이스 바로 아래에 추가:

```typescript
export interface HistoryDiff {
  added: string[]
  removed: string[]
  modified: string[]
  before_html: string | null
  after_html: string | null
}

export async function fetchHistoryDiff(
  projectId: string,
  slideId: string,
  historyId: string,
): Promise<HistoryDiff> {
  return api.get(`/projects/${projectId}/slides/${slideId}/history/${historyId}/diff`)
}
```

- [ ] **Step 2: 커밋**

```bash
git add ui/src/shared/lib/projectApi.ts
git commit -m "feat(history): add fetchHistoryDiff API function"
```

---

### Task 5: HistoryPanel UI — B 방식 우측 diff 패널

**Files:**
- Modify: `ui/src/features/editor/components/HistoryPanel.tsx`

**동작:**
- 히스토리 항목 클릭 → `selectedId` 상태 설정 + diff fetch
- Dialog를 `w-[820px]`로 확장, 좌우 split
- 왼쪽(280px): 기존 히스토리 목록 (선택된 항목 하이라이트)
- 오른쪽: Before/After iframe + 컴포넌트 태그
- 클릭된 항목 다시 클릭 → 패널 닫기 (selectedId = null)

- [ ] **Step 1: 상태 + diff fetch 로직 추가**

기존 `const [restoring, setRestoring] = useState<string | null>(null)` 아래에 추가:

```typescript
const [selectedId, setSelectedId] = useState<string | null>(null)
const [diff, setDiff] = useState<HistoryDiff | null>(null)
const [diffLoading, setDiffLoading] = useState(false)

const handleSelect = useCallback(async (v: SlideHistoryEntry) => {
  if (selectedId === v.id) {
    setSelectedId(null)
    setDiff(null)
    return
  }
  setSelectedId(v.id)
  setDiff(null)
  setDiffLoading(true)
  try {
    const result = await fetchHistoryDiff(projectId!, currentSlide!.id, v.id)
    setDiff(result)
  } finally {
    setDiffLoading(false)
  }
}, [selectedId, projectId, currentSlide?.id])
```

import에 `fetchHistoryDiff`, `HistoryDiff` 추가:

```typescript
import { fetchSlideHistory, restoreFromHistory, fetchHistoryDiff, type SlideHistoryEntry, type HistoryDiff } from '@/shared/lib/projectApi'
```

- [ ] **Step 2: Dialog 너비 동적 조절 + split 레이아웃**

```typescript
// DialogContent className 변경:
className={cn(
  'flex flex-col p-0 gap-0 transition-all duration-300',
  selectedId ? 'w-[820px] max-h-[75vh]' : 'w-[420px] max-h-[70vh]',
)}
```

기존 `<div className="flex-1 overflow-y-auto">` 를 다음으로 교체:

```typescript
<div className="flex flex-1 overflow-hidden">
  {/* 왼쪽: 히스토리 목록 */}
  <div className={cn(
    'flex-shrink-0 overflow-y-auto border-r border-[var(--border)] transition-all duration-300',
    selectedId ? 'w-[280px]' : 'w-full',
  )}>
    {loading ? (
      <div className="flex items-center justify-center py-12 text-[12px] text-[var(--text-disabled)]">
        불러오는 중...
      </div>
    ) : versions.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Clock size={24} className="text-[var(--text-disabled)]" />
        <p className="text-[12px] text-[var(--text-disabled)]">아직 저장된 버전이 없습니다</p>
        <p className="text-[11px] text-[var(--text-disabled)]">Agent가 슬라이드를 수정하면 자동으로 저장됩니다</p>
      </div>
    ) : (
      <div className="flex flex-col divide-y divide-[var(--border)]">
        {versions.map((v) => {
          const { agent, command } = parseAgentName(v.reason)
          const isRestoring = restoring === v.id
          const isSelected = selectedId === v.id
          return (
            <div
              key={v.id}
              onClick={() => handleSelect(v)}
              className={cn(
                'flex items-start gap-3 px-4 py-3 cursor-pointer group transition-colors',
                isSelected
                  ? 'bg-[var(--accent-subtle)] border-l-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--bg-muted)]',
              )}
            >
              <div className="mt-0.5 w-6 h-6 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center shrink-0">
                <ChevronRight size={10} className="text-[var(--accent)]" />
              </div>
              <div className="flex-1 min-w-0">
                {agent && (
                  <span className={cn(
                    'inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1',
                    'bg-[var(--accent-subtle)] text-[var(--accent-text)]',
                  )}>
                    {agent}
                  </span>
                )}
                <p className="text-[11px] text-[var(--text)] leading-snug line-clamp-2">{command}</p>
                <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">{formatDate(v.created_at)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleRestore(v.id) }}
                disabled={!!restoring}
                onMouseEnter={() => v.html_content && showPreview(v.html_content)}
                onMouseLeave={clearPreview}
                className={cn(
                  'shrink-0 flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all',
                  'opacity-0 group-hover:opacity-100',
                  'bg-[var(--accent-subtle)] text-[var(--accent-text)]',
                  'hover:bg-[var(--accent)] hover:text-white',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {isRestoring ? <span className="animate-spin">↻</span> : <RotateCcw size={10} />}
                복원
              </button>
            </div>
          )
        })}
      </div>
    )}
  </div>

  {/* 오른쪽: diff 패널 */}
  {selectedId && (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {diffLoading ? (
        <div className="flex items-center justify-center h-full text-[12px] text-[var(--text-disabled)]">
          비교 중...
        </div>
      ) : diff ? (
        <>
          {/* Before / After 미니 슬라이드 */}
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] text-[var(--text-disabled)] text-center">BEFORE</span>
              <div className="aspect-video rounded-[6px] overflow-hidden border border-[var(--border)] bg-[#0A0F1E]">
                {diff.before_html ? (
                  <iframe
                    srcDoc={diff.before_html}
                    className="w-full h-full pointer-events-none"
                    style={{ transform: 'scale(0.33)', transformOrigin: 'top left', width: '300%', height: '300%' }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
                )}
              </div>
            </div>
            <div className="flex items-center text-[var(--text-disabled)] text-sm">→</div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] text-[var(--text-disabled)] text-center">AFTER</span>
              <div className="aspect-video rounded-[6px] overflow-hidden border border-[var(--accent)] bg-[#0A0F1E]">
                {diff.after_html ? (
                  <iframe
                    srcDoc={diff.after_html}
                    className="w-full h-full pointer-events-none"
                    style={{ transform: 'scale(0.33)', transformOrigin: 'top left', width: '300%', height: '300%' }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
                )}
              </div>
            </div>
          </div>

          {/* 변경 컴포넌트 태그 */}
          {(diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-[var(--text-disabled)] font-medium uppercase tracking-wide">변경 컴포넌트</span>
              <div className="flex flex-wrap gap-1.5">
                {diff.added.map(id => (
                  <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e3a1e] text-[#4ade80] font-medium">
                    + {id}
                  </span>
                ))}
                {diff.removed.map(id => (
                  <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3a2020] text-[#f87171] font-medium">
                    − {id}
                  </span>
                ))}
                {diff.modified.map(id => (
                  <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#2a2a1e] text-[#fbbf24] font-medium">
                    ~ {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && (
            <p className="text-[11px] text-[var(--text-disabled)] text-center">변경된 컴포넌트 없음</p>
          )}
        </>
      ) : null}
    </div>
  )}
</div>
```

- [ ] **Step 3: `open` 상태 변할 때 선택 초기화**

`useEffect` 중 `open` 감지 부분 수정:

```typescript
useEffect(() => {
  if (open) {
    load()
    setSelectedId(null)
    setDiff(null)
  }
}, [open, load])
```

- [ ] **Step 4: 커밋**

```bash
git add ui/src/features/editor/components/HistoryPanel.tsx
git commit -m "feat(history): add before/after diff panel with component change tags"
```

---

## 완료 체크리스트

- [ ] `GET .../history/{id}/diff` 엔드포인트 응답 확인
- [ ] 히스토리 항목 클릭 시 패널 슬라이드인
- [ ] Before/After iframe 렌더링 (첫 버전은 before=없음)
- [ ] 추가/제거/수정 태그 표시
- [ ] 같은 항목 재클릭 시 패널 닫힘
- [ ] 복원 버튼 여전히 동작 (클릭 이벤트 stopPropagation 확인)
