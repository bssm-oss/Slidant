# Agent History UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에이전트 작업 이력(어떤 에이전트가 무슨 명령을 받아 무슨 결과를 냈는지)을 DB에 저장하고, 에디터 우측 패널에서 목록으로 볼 수 있게 한다.

**Architecture:** `AgentRun` 모델에 `task_description`, `result_summary`, `agent_name`, `affected_slide_id` 4개 필드를 추가하고 Alembic 마이그레이션으로 반영한다. 백엔드 생성/완료 흐름에서 이 필드를 채우고, 기존 `/agent/logs/{project_id}` 엔드포인트를 enriched 응답으로 업그레이드한다. 프론트는 `AgentHistoryPanel` Dialog 컴포넌트를 새로 만들어 RightPanel Agent 탭 헤더의 아이콘 버튼으로 열도록 연결한다.

**Tech Stack:** Python 3.12 / SQLModel / Alembic (BE) · React + TypeScript + Vite (FE) · Tailwind CSS / lucide-react (UI)

---

## File Map

| 파일 | 변경 종류 | 역할 |
|------|-----------|------|
| `api/app/models/agent.py` | Modify | `AgentRun`에 4개 필드 추가 |
| `api/alembic/versions/p6q7r8s9t0u1_agent_run_history_fields.py` | Create | `agent_runs` 테이블 칼럼 추가 마이그레이션 |
| `api/app/services/agent_service.py` | Modify | `create_agent_run()` 시그니처 확장, `finalize_agent_run()` result_summary 파라미터 추가 |
| `api/app/api/v1/endpoints/agents.py` | Modify | `create_agent_run()` 호출부에 새 인자 전달, 완료 직전 `result_summary` 저장, `/logs` 응답 필드 보강 |
| `ui/src/shared/lib/agentApi.ts` | Modify | `AgentRunHistoryItem` 타입 + `fetchAgentRuns()` 함수 추가 |
| `ui/src/features/editor/components/AgentHistoryPanel.tsx` | Create | 작업 이력 Dialog 컴포넌트 |
| `ui/src/features/editor/components/RightPanel.tsx` | Modify | 이력 버튼 + `AgentHistoryPanel` 마운트 |

---

## Task 1: AgentRun 모델 필드 추가

**Files:**
- Modify: `api/app/models/agent.py`

- [ ] **Step 1: 모델 수정**

`AgentRun` 클래스의 `finished_at` 뒤에 아래 4개 필드를 추가한다.

```python
# api/app/models/agent.py  (AgentRun 클래스 내부)
    finished_at: datetime | None = None
    task_description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    result_summary: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    agent_name: str | None = Field(default=None, max_length=100)
    affected_slide_id: UUID | None = Field(default=None, foreign_key="slides.id", nullable=True)
```

파일 상단 import에 `Text` 추가가 필요하다:
```python
from sqlalchemy import Column, Text
```

- [ ] **Step 2: 문법 검증**

```bash
cd /Users/comodoflow/Documents/project/slidant/api
python -c "from app.models.agent import AgentRun; print('OK')"
```
Expected: `OK`

---

## Task 2: Alembic 마이그레이션 생성

**Files:**
- Create: `api/alembic/versions/p6q7r8s9t0u1_agent_run_history_fields.py`

- [ ] **Step 1: 마이그레이션 파일 생성**

```python
# api/alembic/versions/p6q7r8s9t0u1_agent_run_history_fields.py
"""agent_run history fields

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-06-08

"""
from alembic import op
import sqlalchemy as sa

revision = 'p6q7r8s9t0u1'
down_revision = 'o5p6q7r8s9t0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('task_description', sa.Text(), nullable=True))
    op.add_column('agent_runs', sa.Column('result_summary', sa.Text(), nullable=True))
    op.add_column('agent_runs', sa.Column('agent_name', sa.String(100), nullable=True))
    op.add_column('agent_runs',
        sa.Column('affected_slide_id', sa.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_agent_runs_affected_slide_id',
        'agent_runs', 'slides',
        ['affected_slide_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_agent_runs_affected_slide_id', 'agent_runs', type_='foreignkey')
    op.drop_column('agent_runs', 'affected_slide_id')
    op.drop_column('agent_runs', 'agent_name')
    op.drop_column('agent_runs', 'result_summary')
    op.drop_column('agent_runs', 'task_description')
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
cd /Users/comodoflow/Documents/project/slidant/api
alembic upgrade head
```
Expected: `Running upgrade o5p6q7r8s9t0 -> p6q7r8s9t0u1, agent_run history fields`

- [ ] **Step 3: 롤백 테스트 후 재적용**

```bash
alembic downgrade -1
alembic upgrade head
```
Expected: 두 명령 모두 오류 없이 완료

---

## Task 3: agent_service.py 업데이트

**Files:**
- Modify: `api/app/services/agent_service.py`

- [ ] **Step 1: `create_agent_run` 시그니처 확장**

기존:
```python
async def create_agent_run(
    agent_run_repo: AgentRunRepository,
    project_id: UUID,
    agent_definition_id: UUID,
) -> AgentRun:
    agent_run = AgentRun(
        project_id=project_id,
        agent_definition_id=agent_definition_id,
        status="running",
        started_at=datetime.utcnow(),
    )
```

변경 후:
```python
async def create_agent_run(
    agent_run_repo: AgentRunRepository,
    project_id: UUID,
    agent_definition_id: UUID,
    task_description: str | None = None,
    agent_name: str | None = None,
    affected_slide_id: UUID | None = None,
) -> AgentRun:
    agent_run = AgentRun(
        project_id=project_id,
        agent_definition_id=agent_definition_id,
        status="running",
        started_at=datetime.utcnow(),
        task_description=task_description,
        agent_name=agent_name,
        affected_slide_id=affected_slide_id,
    )
```

- [ ] **Step 2: `finalize_agent_run`에 `result_summary` 파라미터 추가**

기존:
```python
async def finalize_agent_run(
    agent_run_repo: AgentRunRepository,
    llm_log_repo: LlmLogRepository,
    agent_run: AgentRun,
    command: str,
    patches: list[dict],
    status: str = "done",
    error: str = "",
) -> None:
    agent_run.status = status
    agent_run.finished_at = datetime.utcnow()
```

변경 후:
```python
async def finalize_agent_run(
    agent_run_repo: AgentRunRepository,
    llm_log_repo: LlmLogRepository,
    agent_run: AgentRun,
    command: str,
    patches: list[dict],
    status: str = "done",
    error: str = "",
    result_summary: str | None = None,
) -> None:
    agent_run.status = status
    agent_run.finished_at = datetime.utcnow()
    if result_summary is not None:
        agent_run.result_summary = result_summary
```

- [ ] **Step 3: import 검증**

```bash
cd /Users/comodoflow/Documents/project/slidant/api
python -c "from app.services.agent_service import create_agent_run, finalize_agent_run; print('OK')"
```
Expected: `OK`

---

## Task 4: agents.py 엔드포인트 업데이트

**Files:**
- Modify: `api/app/api/v1/endpoints/agents.py`

- [ ] **Step 1: `create_agent_run` 호출부에 새 인자 전달**

`run_agent_endpoint` 함수 내 아래 라인을 찾는다 (현재 line ~60):
```python
agent_run = await agent_service.create_agent_run(uow.agent_runs, body.project_id, agent_def.id)
```

아래로 교체:
```python
agent_run = await agent_service.create_agent_run(
    uow.agent_runs,
    body.project_id,
    agent_def.id,
    task_description=body.command,
    agent_name=agent_def.name,
    affected_slide_id=body.slide_id,
)
```

- [ ] **Step 2: `finalize_agent_run` 호출부에 `result_summary` 전달**

`_run_agent_background_inner` 내 성공 경로의 `finalize_agent_run` 호출 (현재 line ~480):
```python
await agent_service.finalize_agent_run(
    uow.agent_runs, uow.llm_logs, agent_run, body.command, patches
)
```

아래로 교체:
```python
await agent_service.finalize_agent_run(
    uow.agent_runs, uow.llm_logs, agent_run, body.command, patches,
    result_summary=agent_content,
)
```

주의: `agent_content`는 line ~494에서 계산되지만, `finalize_agent_run`은 line ~480에서 호출된다. 순서를 바꿔야 한다 — `agent_content` 계산 블록(line 489-494)을 `finalize_agent_run` 호출 위로 이동한다.

이동 전:
```python
            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, patches
            )

            affected_ids = list({
                op.get("path", "").strip("/").split("/")[0]
                for op in comp_ops if op.get("path", "").strip("/")
            })

            # summary 우선, 없으면 변경 수 표시
            stats = []
            if comp_ops: stats.append(f"컴포넌트 {len(comp_ops)}개 수정")
            if new_slides: stats.append(f"슬라이드 {len(new_slides)}장 추가")
            fallback_content = "、".join(stats) if stats else "변경 없음"
            agent_content = llm_summary if llm_summary else fallback_content
```

이동 후:
```python
            affected_ids = list({
                op.get("path", "").strip("/").split("/")[0]
                for op in comp_ops if op.get("path", "").strip("/")
            })

            # summary 우선, 없으면 변경 수 표시
            stats = []
            if comp_ops: stats.append(f"컴포넌트 {len(comp_ops)}개 수정")
            if new_slides: stats.append(f"슬라이드 {len(new_slides)}장 추가")
            fallback_content = "、".join(stats) if stats else "변경 없음"
            agent_content = llm_summary if llm_summary else fallback_content

            await agent_service.finalize_agent_run(
                uow.agent_runs, uow.llm_logs, agent_run, body.command, patches,
                result_summary=agent_content,
            )
```

- [ ] **Step 3: `/logs/{project_id}` 응답 필드 보강**

기존 (line ~632-643):
```python
@router.get("/logs/{project_id}", response_model=list[dict])
async def get_agent_logs(project_id: UUID, current_user: CurrentUser, uow: UoW):
    runs = await uow.agent_runs.list_by_project(project_id)
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]
```

변경 후:
```python
@router.get("/logs/{project_id}", response_model=list[dict])
async def get_agent_logs(project_id: UUID, current_user: CurrentUser, uow: UoW):
    runs = await uow.agent_runs.list_by_project(project_id)
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "agent_name": r.agent_name,
            "task_description": r.task_description,
            "result_summary": r.result_summary,
            "affected_slide_id": str(r.affected_slide_id) if r.affected_slide_id else None,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        }
        for r in runs
    ]
```

- [ ] **Step 4: 서버 기동 검증**

```bash
cd /Users/comodoflow/Documents/project/slidant/api
python -c "from app.api.v1.endpoints.agents import router; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add api/app/models/agent.py \
        api/alembic/versions/p6q7r8s9t0u1_agent_run_history_fields.py \
        api/app/services/agent_service.py \
        api/app/api/v1/endpoints/agents.py
git commit -m "feat(agent): store task_description, result_summary, agent_name on AgentRun"
```

---

## Task 5: Frontend API 함수 추가

**Files:**
- Modify: `ui/src/shared/lib/agentApi.ts`

- [ ] **Step 1: 타입과 fetch 함수 추가**

`agentApi.ts` 파일 끝에 추가:

```typescript
export interface AgentRunHistoryItem {
  id: string
  status: 'running' | 'done' | 'error' | 'cancelled' | string
  agent_name: string | null
  task_description: string | null
  result_summary: string | null
  affected_slide_id: string | null
  started_at: string | null
  finished_at: string | null
}

export const fetchAgentRuns = (projectId: string): Promise<AgentRunHistoryItem[]> =>
  fetch(`/api/v1/agent/logs/${projectId}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  }).then((r) => {
    if (!r.ok) throw new Error('fetch agent runs failed')
    return r.json()
  })
```

주의: `localStorage.getItem('token')` 패턴이 기존 `agentApi.ts`에서 쓰이는 auth 패턴과 다를 수 있다. 기존 `fetchAgents` 구현의 `fetch` 호출 패턴을 그대로 따른다. 기존 함수가 `apiClient` 또는 별도 helper를 쓰면 같은 helper 사용.

- [ ] **Step 2: 빌드 검증**

```bash
cd /Users/comodoflow/Documents/project/slidant/ui
npx tsc --noEmit 2>&1 | grep -i "agentApi\|AgentRunHistoryItem" | head -10
```
Expected: 출력 없음 (에러 없음)

---

## Task 6: AgentHistoryPanel 컴포넌트 생성

**Files:**
- Create: `ui/src/features/editor/components/AgentHistoryPanel.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { History, CheckCircle2, XCircle, Loader2, Ban } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'
import { fetchAgentRuns, type AgentRunHistoryItem } from '@/shared/lib/agentApi'

function formatDate(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
  if (status === 'error') return <XCircle size={13} className="text-red-400 shrink-0" />
  if (status === 'running') return <Loader2 size={13} className="text-[var(--accent)] shrink-0 animate-spin" />
  if (status === 'cancelled') return <Ban size={13} className="text-[var(--text-disabled)] shrink-0" />
  return <History size={13} className="text-[var(--text-disabled)] shrink-0" />
}

const ROLE_COLOR: Record<string, string> = {
  content: 'bg-blue-50 text-blue-700',
  design: 'bg-purple-50 text-purple-700',
  layout: 'bg-green-50 text-green-700',
  custom: 'bg-orange-50 text-orange-700',
}

function agentColor(name: string | null): string {
  if (!name) return 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
  const lower = name.toLowerCase()
  if (lower.includes('content')) return ROLE_COLOR.content
  if (lower.includes('design')) return ROLE_COLOR.design
  if (lower.includes('layout')) return ROLE_COLOR.layout
  return ROLE_COLOR.custom
}

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

export default function AgentHistoryPanel({ projectId, open, onClose }: Props) {
  const [runs, setRuns] = useState<AgentRunHistoryItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAgentRuns(projectId)
      setRuns(data)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="w-[440px] max-h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History size={14} className="text-[var(--text-muted)]" />
            에이전트 작업 이력
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[12px] text-[var(--text-disabled)]">
              불러오는 중...
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <History size={24} className="text-[var(--text-disabled)]" />
              <p className="text-[12px] text-[var(--text-disabled)]">아직 작업 이력이 없습니다</p>
              <p className="text-[11px] text-[var(--text-disabled)]">에이전트가 작업하면 여기에 기록됩니다</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {runs.map((run) => (
                <div key={run.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--bg-muted)] transition-colors">
                  <div className="mt-0.5 shrink-0">
                    <StatusIcon status={run.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {run.agent_name && (
                        <span className={cn(
                          'inline-block text-[10px] font-medium px-1.5 py-0.5 rounded',
                          agentColor(run.agent_name),
                        )}>
                          {run.agent_name}
                        </span>
                      )}
                    </div>
                    {run.task_description && (
                      <p className="text-[12px] text-[var(--text)] leading-snug line-clamp-2">
                        {run.task_description}
                      </p>
                    )}
                    {run.result_summary && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                        {run.result_summary}
                      </p>
                    )}
                    {run.started_at && (
                      <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">
                        {formatDate(run.started_at)}
                        {run.finished_at && run.started_at && (
                          <span className="ml-1.5">
                            · {Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 타입 검사**

```bash
cd /Users/comodoflow/Documents/project/slidant/ui
npx tsc --noEmit 2>&1 | grep -i "AgentHistoryPanel" | head -10
```
Expected: 출력 없음

---

## Task 7: RightPanel에 이력 버튼 + 패널 연결

**Files:**
- Modify: `ui/src/features/editor/components/RightPanel.tsx`

- [ ] **Step 1: import 추가**

`RightPanel.tsx` 상단 import 블록에 추가:
```tsx
import { Maximize2, History } from 'lucide-react'  // History 추가 (Maximize2는 이미 있음)
import AgentHistoryPanel from './AgentHistoryPanel'
```

기존 `import { Maximize2 } from 'lucide-react'` 라인을 찾아 `History`를 추가한다. 없으면 별도 import로 추가:
```tsx
import { History } from 'lucide-react'
```

- [ ] **Step 2: 상태 추가**

컴포넌트 상단 state 선언부 (기존 `const [activeTab, setActiveTab] = ...` 근처)에 추가:
```tsx
const [historyOpen, setHistoryOpen] = useState(false)
```

- [ ] **Step 3: 이력 버튼 추가**

Agent 헤더 영역의 아이콘 버튼 그룹 (`div.flex items-center gap-0.5 ml-auto`)을 찾는다:
```tsx
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => navigate(`/edit/${id}/agent`)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="전체 화면"
          >
            <Maximize2 size={14} />
          </button>
        </div>
```

`Maximize2` 버튼 앞에 이력 버튼 삽입:
```tsx
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => setHistoryOpen(true)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="작업 이력"
          >
            <History size={14} />
          </button>
          <button
            onClick={() => navigate(`/edit/${id}/agent`)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="전체 화면"
          >
            <Maximize2 size={14} />
          </button>
        </div>
```

- [ ] **Step 4: AgentHistoryPanel 마운트**

Agent 탭 블록(`{activeTab === 'agent' && <>`) 안의 Dialog 계열 컴포넌트들 근처(이미 다른 Dialog들이 있는 곳)에 추가한다. RightPanel return 블록 끝, 닫는 `</>` 바로 전:

```tsx
      {id && (
        <AgentHistoryPanel
          projectId={id}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      )}
```

`id`는 `presentation?.id`로 이미 컴포넌트에 존재한다. 해당 변수명을 확인 후 맞춰서 사용.

- [ ] **Step 5: 타입 검사**

```bash
cd /Users/comodoflow/Documents/project/slidant/ui
npx tsc --noEmit 2>&1 | grep -i "RightPanel\|AgentHistoryPanel\|historyOpen" | head -10
```
Expected: 출력 없음

- [ ] **Step 6: Commit**

```bash
git add ui/src/shared/lib/agentApi.ts \
        ui/src/features/editor/components/AgentHistoryPanel.tsx \
        ui/src/features/editor/components/RightPanel.tsx
git commit -m "feat(ui): add AgentHistoryPanel with work log history view"
```

---

## Task 8: 통합 수동 검증

- [ ] **Step 1: 서비스 기동 확인**

```bash
# docker가 실행 중이라면:
docker compose ps
```
모든 서비스 Up 상태 확인.

- [ ] **Step 2: 에이전트 실행 후 이력 확인**

1. 에디터에서 에이전트에 명령 전송 (예: "배경색 바꿔줘")
2. 작업 완료 후 RightPanel 우상단 `History` 아이콘 클릭
3. 확인 항목:
   - 에이전트 이름 뱃지 표시
   - 명령어(`task_description`) 표시
   - 결과 요약(`result_summary`) 표시
   - 상태 아이콘(done=초록, error=빨강) 표시
   - 소요 시간 표시

- [ ] **Step 3: API 직접 확인**

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/api/v1/agent/logs/<project_id> | python3 -m json.tool | head -40
```
Expected: `task_description`, `result_summary`, `agent_name` 필드 포함된 JSON

---

## Self-Review Checklist

- [x] `AgentRun` 모델 → Task 1
- [x] 마이그레이션 → Task 2
- [x] `create_agent_run` 확장 → Task 3
- [x] `finalize_agent_run` result_summary 저장 → Task 4
- [x] `/logs` 엔드포인트 응답 보강 → Task 4
- [x] FE 타입 + fetch 함수 → Task 5
- [x] `AgentHistoryPanel` 컴포넌트 → Task 6
- [x] RightPanel 버튼 + 마운트 → Task 7
- [x] 통합 검증 → Task 8

**순서 의존성:** Task 2는 Task 1 완료 후. Task 4는 Task 3 완료 후. Task 6-7은 Task 5 완료 후. Task 8은 모두 완료 후.

**agent_content 순서 주의 (Task 4):** `finalize_agent_run` 호출 시점에 `agent_content`가 아직 계산되지 않은 경우, `agent_content` 계산 블록을 먼저 이동한 뒤 `result_summary=agent_content` 전달.
