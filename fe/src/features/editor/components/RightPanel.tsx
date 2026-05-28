import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { AgentStatusBadge } from '@/shared/components/ui'

const logColors: Record<string, string> = {
  success: 'bg-[var(--mint-subtle)] text-[var(--mint-text)]',
  error:   'bg-red-50 text-red-600',
  info:    'bg-[var(--bg-muted)] text-[var(--text-muted)]',
  conflict:'bg-[var(--orange-subtle)] text-[var(--orange-text)]',
}

function AgentTab() {
  const { agents, agentLogs } = useEditorStore()
  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto">
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">활성 Agent</p>
        <div className="flex flex-col gap-1.5">
          {agents.map((agent, i) => (
            <div key={agent.id} className={cn(
              'flex items-center justify-between px-2.5 py-2 rounded-[8px] border',
              i === 0 ? 'bg-[var(--accent-subtle)] border-purple-200' :
              i === 1 ? 'bg-[var(--sky-subtle)] border-sky-200' :
                        'bg-[var(--mint-subtle)] border-emerald-200',
            )}>
              <div>
                <p className="text-xs font-semibold text-[var(--text)]">{agent.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{agent.description}</p>
              </div>
              <AgentStatusBadge status={agent.status} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">작업 로그</p>
        <div className="flex flex-col gap-1">
          {agentLogs.map((log) => (
            <div key={log.id} className={cn('px-2.5 py-1.5 rounded-[6px] text-xs', logColors[log.type] ?? logColors.info)}>
              <span className="font-semibold">{log.agentName}</span>
              <span className="mx-1 opacity-50">·</span>
              {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PropertiesTab() {
  const { presentation, currentSlideIndex, selectedComponentId } = useEditorStore()
  const comp = presentation?.slides[currentSlideIndex]?.components.find(c => c.id === selectedComponentId)
  if (!comp) return (
    <div className="flex items-center justify-center h-32 text-xs text-[var(--text-disabled)] p-3">컴포넌트를 선택하세요</div>
  )
  return (
    <div className="p-3 flex flex-col gap-3">
      {[
        { label: '타입', value: comp.type },
        { label: '위치', value: `x: ${comp.position.x} / y: ${comp.position.y}` },
        { label: '크기', value: `w: ${comp.size.w} / h: ${comp.size.h}` },
      ].map(({ label, value }) => (
        <div key={label}>
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-0.5">{label}</p>
          <p className="text-xs text-[var(--text)]">{value}</p>
        </div>
      ))}
    </div>
  )
}

export default function RightPanel() {
  const { activeRightTab, setActiveRightTab } = useEditorStore()
  return (
    <div className="w-72 border-l border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden">
      <div className="flex border-b border-[var(--border)] shrink-0">
        {(['agent', 'properties'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveRightTab(tab)}
            className={cn(
              'flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer',
              activeRightTab === tab
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}>
            {tab === 'agent' ? 'Agent' : '속성'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeRightTab === 'agent' ? <AgentTab /> : <PropertiesTab />}
      </div>
    </div>
  )
}
