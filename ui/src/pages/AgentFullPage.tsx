import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Agent } from '@/shared/types'
import { useEditorStore } from '@/features/editor/store/editorStore'
import { useToastStore } from '@/shared/components/ui/Toast'
import { AppShell } from '@/shared/components/layout'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { cn } from '@/shared/lib/utils'
import { ArrowLeft, Sparkles, Minimize2 } from 'lucide-react'

const agentColors = [
  'bg-[var(--accent-subtle)] border-purple-200',
  'bg-[var(--sky-subtle)] border-sky-200',
  'bg-[var(--mint-subtle)] border-emerald-200',
  'bg-[var(--pink-subtle)] border-pink-200',
  'bg-[var(--orange-subtle)] border-orange-200',
]

const logColors: Record<string, string> = {
  success: 'bg-[var(--mint-subtle)] text-[var(--mint-text)] border-emerald-100',
  error:   'bg-red-50 text-red-600 border-red-100',
  info:    'bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border)]',
  conflict:'bg-[var(--orange-subtle)] text-[var(--orange-text)] border-orange-100',
}

function formatTime(ts: string) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
}

export default function AgentFullPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { agents, agentLogs, overallStatus, loadPresentation, loadAgentLogs, loadAgents, connectWs, presentation, sendMessage } = useEditorStore()
  const toast = useToastStore((s) => s.push)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  useEffect(() => {
    if (!id) return
    loadPresentation(id)
    loadAgentLogs(id)
    loadAgents()
    const unsub = connectWs(id)
    return unsub
  }, [id])

  // 선택된 에이전트 상태 실시간 동기화
  useEffect(() => {
    if (selectedAgent) {
      const updated = agents.find((a) => a.id === selectedAgent.id)
      if (updated) setSelectedAgent(updated)
    }
  }, [agents])

  const handleQuickRun = async (label: string) => {
    try {
      await sendMessage(label)
      toast(`Agent 작업 시작: ${label}`, 'info')
    } catch (e: any) {
      toast(e.message ?? '실행 실패', 'error')
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-[var(--border)] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/edit/${id}`)}>
              <ArrowLeft size={14} />
              에디터로
            </Button>
            <div className="h-4 w-px bg-[var(--border)]" />
            <span className="text-sm font-semibold text-[var(--text)]">
              {presentation?.title ?? '...'} — Agent 뷰
            </span>
            <AgentStatusBadge status={overallStatus} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/edit/${id}`)}>
            <Minimize2 size={14} />
            축소
          </Button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-hidden flex gap-0">
          {/* 활성 Agent 목록 */}
          <div className="w-80 border-r border-[var(--border)] bg-white flex flex-col overflow-hidden shrink-0">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <p className="text-sm font-bold text-[var(--text)]">활성 Agent</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">클릭하면 진행 상황 확인</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {agents.map((agent, i) => (
                <button key={agent.id}
                  onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                  className={cn(
                    'flex flex-col gap-2 p-4 rounded-[12px] border text-left transition-all cursor-pointer',
                    agentColors[i % agentColors.length],
                    selectedAgent?.id === agent.id && 'ring-2 ring-[var(--accent)]',
                  )}>
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-bold text-[var(--text)]">{agent.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{agent.description}</p>
                    </div>
                    <AgentStatusBadge status={agent.status} />
                  </div>
                  {agent.status === 'running' && agent.currentTask && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs text-[var(--text-muted)] truncate">"{agent.currentTask}"</p>
                      <div className="w-full h-1.5 bg-white/60 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                          style={{ width: `${agent.taskProgress ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* 빠른 실행 */}
            <div className="px-3 py-4 border-t border-[var(--border)] flex flex-col gap-2">
              <p className="text-xs font-semibold text-[var(--text-muted)] px-1 mb-1">빠른 실행</p>
              {[
                { label: '슬라이드 디자인 개선', color: 'hover:bg-purple-50 hover:text-purple-600' },
                { label: '텍스트 내용 보완',      color: 'hover:bg-sky-50 hover:text-sky-600' },
                { label: '레이아웃 변경',          color: 'hover:bg-pink-50 hover:text-pink-600' },
              ].map((s) => (
                <button key={s.label} onClick={() => handleQuickRun(s.label)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-sm text-[var(--text-muted)] transition-colors cursor-pointer text-left',
                    s.color,
                  )}>
                  <Sparkles size={13} className="shrink-0" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* 작업 로그 */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg)]">
            <div className="px-6 py-4 border-b border-[var(--border)] bg-white flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-[var(--text)]">
                  {selectedAgent ? `${selectedAgent.name} 상세` : '작업 로그'}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {selectedAgent ? '이 에이전트의 작업 내역' : `총 ${agentLogs.length}개`}
                </p>
              </div>
              {selectedAgent && (
                <button onClick={() => setSelectedAgent(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer">
                  전체 보기
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2">
              {(selectedAgent
                ? agentLogs.filter((l) => l.agentName === selectedAgent.name)
                : agentLogs
              ).map((log) => (
                <div key={log.id} className={cn(
                  'flex items-start gap-3 px-4 py-3 rounded-[10px] border text-sm',
                  logColors[log.type] ?? logColors.info,
                )}>
                  <div className="flex flex-col gap-0.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{log.agentName}</span>
                      <span className="text-xs opacity-50">{formatTime(log.timestamp)}</span>
                    </div>
                    <p className="text-sm leading-relaxed">{log.message}</p>
                  </div>
                </div>
              ))}
              {agentLogs.length === 0 && (
                <div className="flex items-center justify-center h-32 text-sm text-[var(--text-disabled)]">
                  아직 작업 로그가 없습니다
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
