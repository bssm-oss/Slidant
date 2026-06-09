# History Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트 히스토리 diff 모달(슬라이드 변경 내역)에서 BEFORE/AFTER 썸네일을 클릭하면 해당 버전으로 롤백할 수 있게 한다.

**Architecture:** 새로운 BE endpoint `POST /projects/{project_id}/slides/{slide_id}/restore-html`로 raw HTML을 받아 `archive_and_apply`를 호출한다. 프론트엔드는 `AgentRunDetailModal`에 이미 있는 `before_html`/`after_html`을 그대로 전달하므로 history_id 조회가 불필요하다. 롤백 성공 후 `loadPresentation`으로 슬라이드를 갱신하고 토스트를 표시한다.

**Tech Stack:** FastAPI (Pydantic BaseModel, HTTP 204), React + TypeScript, Zustand (useToastStore, useSlideStore), lucide-react

---

## File Map

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `api/app/api/v1/endpoints/projects.py` | Modify | `restore-html` endpoint 추가 |
| `ui/src/shared/lib/projectApi.ts` | Modify | `restoreSlideHtml` 함수 추가 |
| `ui/src/features/editor/components/AgentRunDetailModal.tsx` | Modify | 클릭 선택 + 롤백 확인 버튼 UI |

---

### Task 1: BE — restore-html endpoint

**Files:**
- Modify: `api/app/api/v1/endpoints/projects.py` (after line 285, after `restore-component` endpoint)

- [ ] **Step 1: `RestoreHtmlBody` 모델 + endpoint 추가**

`api/app/api/v1/endpoints/projects.py`에서 `RestoreComponentBody` 클래스 아래(~line 286)에 추가:

```python
class RestoreHtmlBody(BaseModel):
    html: str
    reason: str = "사용자 버전 복원"


@router.post("/{project_id}/slides/{slide_id}/restore-html", status_code=status.HTTP_204_NO_CONTENT)
async def restore_html_endpoint(
    project_id: UUID, slide_id: UUID,
    body: RestoreHtmlBody,
    current_user: CurrentUser, uow: UoW,
):
    await project_service.get_slide(uow.projects, uow.slides, project_id, current_user.id, slide_id)
    from app.services.slide_history_service import archive_and_apply
    await archive_and_apply(uow, slide_id, [], body.reason, html_content=body.html)
```

- [ ] **Step 2: 서버 재시작 후 수동 확인**

```bash
# api/ 디렉터리에서
curl -s http://localhost:8000/openapi.json | python3 -c "import sys,json; routes=[r['path'] for r in json.load(sys.stdin)['paths'].keys() if True]; [print(r) for r in sorted(routes) if 'restore' in r]"
```

Expected output: `/projects/{project_id}/slides/{slide_id}/restore-html` 포함

- [ ] **Step 3: commit**

```bash
git add api/app/api/v1/endpoints/projects.py
git commit -m "feat(api): add restore-html endpoint for direct HTML rollback"
```

---

### Task 2: FE — projectApi.ts에 restoreSlideHtml 추가

**Files:**
- Modify: `ui/src/shared/lib/projectApi.ts` (line 104 근처, `restoreFromHistory` 바로 아래)

- [ ] **Step 1: 함수 추가**

`restoreFromHistory` 함수(line 104) 바로 아래에:

```typescript
export async function restoreSlideHtml(
  projectId: string,
  slideId: string,
  html: string,
  reason = '사용자 버전 복원',
): Promise<void> {
  await api.post<void>(`/projects/${projectId}/slides/${slideId}/restore-html`, { html, reason })
}
```

- [ ] **Step 2: TypeScript 타입 오류 없는지 확인**

```bash
cd /Users/comodoflow/Documents/project/slidant/ui
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 3: commit**

```bash
git add ui/src/shared/lib/projectApi.ts
git commit -m "feat(ui): add restoreSlideHtml API helper"
```

---

### Task 3: FE — AgentRunDetailModal 롤백 UI

**Files:**
- Modify: `ui/src/features/editor/components/AgentRunDetailModal.tsx`

전체 파일을 아래 내용으로 교체한다.

- [ ] **Step 1: import 수정**

파일 상단 import에 추가:

```typescript
import { RotateCcw } from 'lucide-react'
import { restoreSlideHtml } from '@/shared/lib/projectApi'
import { useSlideStore } from '../store/slideStore'
import { useToastStore } from '@/shared/components/ui/Toast'
```

- [ ] **Step 2: SlidePreview에 클릭/선택 prop 추가**

기존 `SlidePreview` 컴포넌트를 교체:

```typescript
function SlidePreview({
  html,
  label,
  selected,
  onClick,
}: {
  html: string | null
  label: string
  selected?: boolean
  onClick?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 960)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      <span className="text-[9px] text-[var(--text-disabled)] text-center uppercase tracking-wide">{label}</span>
      <div
        ref={containerRef}
        onClick={html ? onClick : undefined}
        className={cn(
          'w-full overflow-hidden rounded-[4px] border bg-[#0A0F1E] transition-all',
          html && onClick ? 'cursor-pointer' : '',
          selected
            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-30'
            : 'border-[var(--border)]',
        )}
        style={{ aspectRatio: '16/9' }}
      >
        {html ? (
          <iframe
            srcDoc={buildSlideSrc(html)}
            style={{
              width: 960,
              height: 540,
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
              display: 'block',
              pointerEvents: 'none',
              border: 'none',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: SlideChangeTile에 선택 상태 + 롤백 버튼 추가**

기존 `SlideChangeTile` 컴포넌트를 교체:

```typescript
function SlideChangeTile({
  change,
  projectId,
  onRestored,
}: {
  change: RunSlideChange
  projectId: string
  onRestored: (slideId: string) => void
}) {
  const hasChanges = change.added.length > 0 || change.removed.length > 0 || change.modified.length > 0
  const [selected, setSelected] = useState<'before' | 'after' | null>(null)
  const [restoring, setRestoring] = useState(false)
  const pushToast = useToastStore((s) => s.push)

  const handleSelect = (target: 'before' | 'after') => {
    setSelected((prev) => (prev === target ? null : target))
  }

  const handleRestore = async () => {
    const html = selected === 'before' ? change.before_html : change.after_html
    if (!html) return
    setRestoring(true)
    try {
      const reason = selected === 'before' ? '이전 버전으로 롤백' : '이후 버전으로 롤백'
      await restoreSlideHtml(projectId, change.slide_id, html, reason)
      pushToast('롤백 완료', 'success')
      setSelected(null)
      onRestored(change.slide_id)
    } catch {
      pushToast('롤백에 실패했습니다', 'error')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 border border-[var(--border)] rounded-[8px] bg-[var(--bg-muted)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">슬라이드 {change.slide_order + 1}</span>
        {change.slide_title && (
          <span className="text-[11px] text-[var(--text-disabled)] truncate">{change.slide_title}</span>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <SlidePreview
          html={change.before_html}
          label="Before"
          selected={selected === 'before'}
          onClick={() => handleSelect('before')}
        />
        <div className="text-[var(--text-disabled)] text-xs shrink-0 pb-1">→</div>
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-[var(--text-disabled)] text-center uppercase tracking-wide">After</span>
          <div
            className={cn(
              'w-full overflow-hidden rounded-[4px] bg-[#0A0F1E] transition-all',
              change.after_html ? 'cursor-pointer' : '',
              selected === 'after'
                ? 'border border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-30'
                : hasChanges ? 'border border-[var(--accent)]' : 'border border-[var(--border)]',
            )}
            style={{ aspectRatio: '16/9' }}
            onClick={() => change.after_html && handleSelect('after')}
            ref={(el) => {
              if (!el) return
              const obs = new ResizeObserver(([entry]) => {
                const iframe = el.querySelector('iframe') as HTMLIFrameElement | null
                if (iframe) iframe.style.transform = `scale(${entry.contentRect.width / 960})`
              })
              obs.observe(el)
            }}
          >
            {change.after_html ? (
              <iframe
                srcDoc={buildSlideSrc(change.after_html)}
                style={{
                  width: 960,
                  height: 540,
                  transformOrigin: 'top left',
                  transform: `scale(0.3)`,
                  display: 'block',
                  pointerEvents: 'none',
                  border: 'none',
                }}
                sandbox="allow-scripts allow-same-origin"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
            )}
          </div>
        </div>
      </div>

      {/* 롤백 확인 버튼 */}
      {selected && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            {selected === 'before' ? 'Before' : 'After'} 버전으로 롤백하시겠습니까?
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSelected(null)}
              className="px-2 py-1 rounded-[6px] text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
            >
              {restoring ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RotateCcw size={10} />
              )}
              롤백
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: AgentRunDetailModal에서 `onRestored` 연결**

`AgentRunDetailModal` 컴포넌트에서:

1. `useSlideStore` 접근 추가:
```typescript
const loadPresentation = useSlideStore((s) => s.loadPresentation)
```

2. `handleRestored` 콜백 정의:
```typescript
const handleRestored = useCallback((_slideId: string) => {
  loadPresentation(projectId)
}, [projectId, loadPresentation])
```

3. `changes.map` 부분을 교체:
```typescript
changes.map((c) => (
  <SlideChangeTile
    key={c.slide_id}
    change={c}
    projectId={projectId}
    onRestored={handleRestored}
  />
))
```

4. import에 `useCallback` 추가 (기존 `useState, useEffect, useRef` 옆에):
```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
```

- [ ] **Step 5: TypeScript 타입 확인**

```bash
cd /Users/comodoflow/Documents/project/slidant/ui
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 6: commit**

```bash
git add ui/src/features/editor/components/AgentRunDetailModal.tsx
git commit -m "feat(ui): add rollback from agent history diff modal"
```

---

### Task 4: 통합 검증

- [ ] **Step 1: 서버 + UI 실행 확인**

```bash
# api/ 에서 (이미 실행 중이면 스킵)
# docker compose up 또는 uvicorn app.main:app --reload

# ui/ 에서 (이미 실행 중이면 스킵)
# npm run dev
```

- [ ] **Step 2: 기능 검증 체크리스트**

브라우저에서 수동 확인:

1. History 탭 → 에이전트 run 클릭 → "슬라이드 변경 내역" 모달 열기
2. BEFORE 썸네일 클릭 → accent border + ring 표시 확인
3. 하단에 "Before 버전으로 롤백하시겠습니까?" + [취소] [롤백] 버튼 표시 확인
4. [취소] 클릭 → 선택 해제 확인
5. [롤백] 클릭 → 로딩 스피너 → "롤백 완료" 토스트 → 모달 유지 + 슬라이드 갱신 확인
6. AFTER 썸네일 클릭 동일하게 확인
7. `before_html` 없는 슬라이드(없음 표시)는 클릭 불가 확인

- [ ] **Step 3: 실패 케이스 확인**

네트워크 탭에서 restore-html 요청 차단 후 "롤백에 실패했습니다" 에러 토스트 표시 확인

- [ ] **Step 4: final commit (필요시)**

```bash
git add -p
git commit -m "fix(ui): post-review adjustments for history rollback"
```
