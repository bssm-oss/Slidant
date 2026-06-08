import { useState, useEffect, useCallback } from 'react'
import { History, CheckCircle2, XCircle, Loader2, Ban } from 'lucide-react'
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

interface ContentProps {
  projectId: string
  active: boolean
}

export function AgentHistoryContent({ projectId, active }: ContentProps) {
  const [runs, setRuns] = useState<AgentRunHistoryItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAgentRuns(projectId)
      setRuns(data)
    } catch {
      // keep stale data
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
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
            <div key={run.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-muted)] transition-colors">
              <div className="mt-0.5 shrink-0">
                <StatusIcon status={run.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
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
  )
}

export default AgentHistoryContent
