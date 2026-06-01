import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Maximize2, Send, Loader2, Settings, ChevronDown } from 'lucide-react'
import type { Agent, ChatMessage } from '@/shared/types'
import AgentManagerPanel from './AgentManagerPanel'

// ── Chat bubble ──────────────────────────────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[86%] px-3 py-2 rounded-[12px] text-[13px] leading-relaxed',
        isUser
          ? 'bg-[var(--accent)] text-white rounded-br-[4px]'
          : msg.type === 'error'
            ? 'bg-red-50 text-red-600 border border-red-100 rounded-bl-[4px]'
            : 'bg-[var(--bg-muted)] text-[var(--text)] rounded-bl-[4px]',
      )}>
        {msg.content}
      </div>
    </div>
  )
}

// ── Agent selector pill ───────────────────────────────────────────────────────
function AgentSelector({ agents, selectedId, onSelect }: {
  agents: Agent[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = agents.find((a) => a.definitionId === selectedId) ?? agents[0]

  if (agents.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[var(--bg-muted)] hover:bg-[var(--border)] transition-colors text-[12px] font-medium text-[var(--text)]"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
        {selected?.name ?? '에이전트 선택'}
        <ChevronDown size={12} className="text-[var(--text-disabled)]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 min-w-[160px]">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => { onSelect(a.definitionId ?? a.id); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors hover:bg-[var(--bg-muted)]',
                a.definitionId === selectedId && 'text-[var(--accent)] font-medium',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                a.definitionId === selectedId ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
              )} />
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Agent chat ────────────────────────────────────────────────────────────────
function AgentChat({ agent }: { agent: Agent }) {
  const { chatMessages, runningAgentIds, sendMessage, selectChatAgent } = useEditorStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const msgs = chatMessages.filter((m) => m.agentDefinitionId === agent.definitionId)
  const isRunning = agent.definitionId ? runningAgentIds.has(agent.definitionId) : false

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length, isRunning])

  const handleSend = async () => {
    const cmd = input.trim()
    if (!cmd || isRunning) return
    setInput('')
    selectChatAgent(agent.definitionId ?? null)
    try { await sendMessage(cmd) } catch {}
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        {msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-[16px]">✦</span>
            </div>
            <p className="text-[12px] text-[var(--text-disabled)]">{agent.name}에게 요청해보세요</p>
          </div>
        ) : (
          msgs.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
        )}
        {isRunning && (
          <div className="flex justify-start">
            <div className="bg-[var(--bg-muted)] px-3 py-2 rounded-[12px] rounded-bl-[4px] text-[12px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Loader2 size={10} className="animate-spin" />
              처리 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-[var(--border)] flex gap-2 bg-white">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          onFocus={() => selectChatAgent(agent.definitionId ?? null)}
          placeholder={`${agent.name}에게 요청...`}
          disabled={isRunning}
          className="flex-1 h-9 px-3 text-[13px] border border-[var(--border)] rounded-[8px] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-subtle)] bg-white disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isRunning}
          className="h-9 w-9 flex items-center justify-center rounded-[8px] bg-[var(--accent)] text-white disabled:opacity-40 hover:bg-[var(--accent-hover)] transition-colors shrink-0"
        >
          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
    </div>
  )
}

// ── Agent tab ─────────────────────────────────────────────────────────────────
function AgentTab() {
  const { agents, selectedAgentDefinitionId, selectChatAgent } = useEditorStore()
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (agents.length > 0 && !localSelectedId) {
      const first = agents[0].definitionId ?? agents[0].id
      setLocalSelectedId(first)
      selectChatAgent(first)
    }
  }, [agents])

  const handleSelect = (id: string) => {
    setLocalSelectedId(id)
    selectChatAgent(id)
  }

  const activeId = localSelectedId ?? selectedAgentDefinitionId
  const activeAgent = agents.find((a) => a.definitionId === activeId) ?? agents[0]

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[12px] text-[var(--text-disabled)]">
        에이전트 로딩 중...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Agent selector bar */}
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
        <AgentSelector agents={agents} selectedId={activeId} onSelect={handleSelect} />
      </div>
      {/* Chat */}
      {activeAgent && <AgentChat agent={activeAgent} />}
    </div>
  )
}

// ── Properties tab ────────────────────────────────────────────────────────────
function PropertiesTab() {
  const { presentation, currentSlideIndex, selectedComponentId } = useEditorStore()
  const comp = presentation?.slides[currentSlideIndex]?.components.find((c) => c.id === selectedComponentId)

  if (!comp) return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <p className="text-[12px] text-[var(--text-disabled)]">컴포넌트를 선택하세요</p>
    </div>
  )

  return (
    <div className="p-4 flex flex-col gap-4">
      {[
        { label: '타입', value: comp.type },
        { label: '위치', value: `x: ${comp.position.x},  y: ${comp.position.y}` },
        { label: '크기', value: `w: ${comp.size.w},  h: ${comp.size.h}` },
      ].map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-0.5">
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
          <p className="text-[13px] text-[var(--text)]">{value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function RightPanel() {
  const { activeRightTab, setActiveRightTab } = useEditorStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [showManager, setShowManager] = useState(false)

  return (
    <div className="w-80 border-l border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--border)] shrink-0 px-1">
        {(['agent', 'properties'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveRightTab(tab)}
            className={cn(
              'flex-1 py-3 text-[13px] font-semibold transition-colors cursor-pointer',
              activeRightTab === tab
                ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {tab === 'agent' ? 'Agent' : '속성'}
          </button>
        ))}
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => setShowManager(true)}
            className="p-2 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="에이전트 관리"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => navigate(`/edit/${id}/agent`)}
            className="p-2 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="전체 화면"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeRightTab === 'agent' ? <AgentTab /> : <PropertiesTab />}
      </div>

      <AgentManagerPanel open={showManager} onClose={() => setShowManager(false)} />
    </div>
  )
}
