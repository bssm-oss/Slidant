import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { AgentStatusBadge } from '@/shared/components/ui'

function AgentTab() {
  const { agents, agentLogs } = useEditorStore()

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto">
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">활성 Agent</p>
        <div className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between px-2.5 py-2 rounded-[8px] bg-[var(--bg-muted)]"
            >
              <div>
                <p className="text-xs font-medium text-[var(--text)]">{agent.name}</p>
                <p className="text-xs text-[var(--text-disabled)] mt-0.5">{agent.description}</p>
              </div>
              <AgentStatusBadge status={agent.status} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2">작업 로그</p>
        <div className="flex flex-col gap-1">
          {agentLogs.map((log) => (
            <div
              key={log.id}
              className={cn(
                'px-2.5 py-1.5 rounded-[6px] text-xs',
                log.type === 'success' && 'bg-emerald-500/10 text-emerald-400',
                log.type === 'error' && 'bg-red-500/10 text-red-400',
                log.type === 'info' && 'bg-[var(--bg-muted)] text-[var(--text-muted)]',
                log.type === 'conflict' && 'bg-amber-500/10 text-amber-400',
              )}
            >
              <span className="font-medium">{log.agentName}</span>
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
  const currentSlide = presentation?.slides[currentSlideIndex]
  const selectedComp = currentSlide?.components.find((c) => c.id === selectedComponentId)

  if (!selectedComp) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-[var(--text-disabled)] p-3">
        컴포넌트를 선택하세요
      </div>
    )
  }

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto">
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-1">타입</p>
        <p className="text-sm text-[var(--text)]">{selectedComp.type}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-1">위치</p>
        <p className="text-xs text-[var(--text-muted)]">
          x: {selectedComp.position.x} / y: {selectedComp.position.y}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-1">크기</p>
        <p className="text-xs text-[var(--text-muted)]">
          w: {selectedComp.size.w} / h: {selectedComp.size.h}
        </p>
      </div>
      {selectedComp.type === 'text' && (
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-1">내용</p>
          <p className="text-xs text-[var(--text)]">
            {String((selectedComp.props as Record<string, unknown>).content ?? '')}
          </p>
        </div>
      )}
    </div>
  )
}

export default function RightPanel() {
  const { activeRightTab, setActiveRightTab } = useEditorStore()

  return (
    <div className="w-72 border-l border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col shrink-0 overflow-hidden">
      {/* 탭 헤더 */}
      <div className="flex border-b border-[var(--border)] shrink-0">
        {(['agent', 'properties'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveRightTab(tab)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors cursor-pointer',
              activeRightTab === tab
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
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
