import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Maximize2, Send, Loader2, ChevronDown, ChevronUp, Settings } from 'lucide-react'
import type { Agent, ChatMessage } from '@/shared/types'
import AgentManagerPanel from './AgentManagerPanel'

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[88%] px-3 py-2 rounded-[10px] text-xs leading-relaxed',
        isUser
          ? 'bg-[var(--accent)] text-white rounded-br-[3px]'
          : msg.type === 'error'
            ? 'bg-red-50 text-red-600 border border-red-100 rounded-bl-[3px]'
            : 'bg-[var(--bg-muted)] text-[var(--text)] rounded-bl-[3px]',
      )}>
        <p>{msg.content}</p>
      </div>
    </div>
  )
}

function AgentChatPanel({ agent, isOpen, onToggle }: {
  agent: Agent
  isOpen: boolean
  onToggle: () => void
}) {
  const { chatMessages, runningAgentIds, conflictComponentIds, sendMessage, selectChatAgent, selectedAgentDefinitionId } = useEditorStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const agentMsgs = chatMessages.filter((m) => m.agentDefinitionId === agent.definitionId)

  // 이 에이전트만 running 여부 체크 (다른 에이전트 실행과 무관)
  const isRunning = agent.definitionId ? runningAgentIds.has(agent.definitionId) : false
  const isSelected = selectedAgentDefinitionId === agent.definitionId
  const hasConflict = conflictComponentIds.size > 0 && agent.status === 'conflict'

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentMsgs.length, isRunning, isOpen])

  const handleSend = async () => {
    const cmd = input.trim()
    if (!cmd || isRunning) return
    setInput('')
    selectChatAgent(agent.definitionId ?? null)
    try { await sendMessage(cmd) } catch {}
  }

  return (
    <div className={cn(
      'border border-[var(--border)] rounded-[10px] overflow-hidden',
      isSelected && 'border-[var(--accent)]',
    )}>
      {/* 패널 헤더 */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors cursor-pointer',
          isOpen ? 'bg-[var(--accent-subtle)]' : 'bg-[var(--bg-muted)] hover:bg-[var(--bg-muted-hover,var(--bg-muted))]',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn(
            'text-xs font-semibold truncate',
            isOpen ? 'text-[var(--accent)]' : 'text-[var(--text)]',
          )}>{agent.name}</span>
          {agent.description && (
            <span className="text-[10px] text-[var(--text-disabled)] truncate hidden sm:block">{agent.description}</span>
          )}
          {agentMsgs.length > 0 && (
            <span className="text-[10px] text-[var(--text-disabled)] shrink-0">{agentMsgs.length}개</span>
          )}
          {isRunning && <Loader2 size={10} className="animate-spin text-[var(--accent)] shrink-0" />}
          {hasConflict && <span className="text-[9px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-medium shrink-0">충돌</span>}
        </div>
        {isOpen ? <ChevronUp size={12} className="text-[var(--text-muted)] shrink-0" /> : <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />}
      </button>

      {/* 채팅 영역 */}
      {isOpen && (
        <>
          <div className="h-64 overflow-y-auto px-3 py-3 flex flex-col gap-2 bg-white">
            {agentMsgs.length === 0 && (
              <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">
                첫 메시지를 보내보세요
              </div>
            )}
            {agentMsgs.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
            {isRunning && (
              <div className="flex justify-start">
                <div className="bg-[var(--bg-muted)] px-2.5 py-1.5 rounded-[10px] text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                  <Loader2 size={9} className="animate-spin" />처리 중...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="px-2.5 py-2 border-t border-[var(--border)] bg-white flex gap-1.5">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              onFocus={() => selectChatAgent(agent.definitionId ?? null)}
              placeholder={`${agent.name}에게 요청...`}
              disabled={isRunning}
              className="flex-1 h-9 px-3 text-sm border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] bg-white disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isRunning}
              className="h-9 w-9 flex items-center justify-center rounded-[8px] bg-[var(--accent)] text-white disabled:opacity-40 hover:bg-purple-700 transition-colors shrink-0"
            >
              <Send size={11} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function AgentTab() {
  const { agents } = useEditorStore()
  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set())

  // 첫 로드 시 에이전트 있으면 첫번째 자동 열기
  useEffect(() => {
    if (agents.length > 0 && openPanels.size === 0) {
      setOpenPanels(new Set([agents[0].id]))
    }
  }, [agents])

  const toggle = (agentId: string) => {
    setOpenPanels((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-[var(--text-disabled)]">
        에이전트 로딩 중...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto">
      {agents.map((agent) => (
        <AgentChatPanel
          key={agent.id}
          agent={agent}
          isOpen={openPanels.has(agent.id)}
          onToggle={() => toggle(agent.id)}
        />
      ))}
    </div>
  )
}

function PropertiesTab() {
  const { presentation, currentSlideIndex, selectedComponentId } = useEditorStore()
  const comp = presentation?.slides[currentSlideIndex]?.components.find((c) => c.id === selectedComponentId)
  if (!comp) return (
    <div className="flex items-center justify-center h-32 text-xs text-[var(--text-disabled)] p-3">
      컴포넌트를 선택하세요
    </div>
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
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [showManager, setShowManager] = useState(false)

  return (
    <div className="w-96 border-l border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden">
      <div className="flex items-center border-b border-[var(--border)] shrink-0">
        {(['agent', 'properties'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveRightTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-semibold transition-colors cursor-pointer',
              activeRightTab === tab
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}>
            {tab === 'agent' ? 'Agent' : '속성'}
          </button>
        ))}
        <button
          onClick={() => setShowManager(true)}
          className="px-2.5 py-2.5 text-[var(--text-disabled)] hover:text-[var(--accent)] transition-colors cursor-pointer shrink-0"
          title="에이전트 관리"
        >
          <Settings size={14} />
        </button>
        <button
          onClick={() => navigate(`/edit/${id}/agent`)}
          className="px-2.5 py-2.5 text-[var(--text-disabled)] hover:text-[var(--accent)] transition-colors cursor-pointer shrink-0"
          title="전체 화면으로 보기"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeRightTab === 'agent' ? <AgentTab /> : <PropertiesTab />}
      </div>
      {showManager && <AgentManagerPanel onClose={() => setShowManager(false)} />}
    </div>
  )
}
