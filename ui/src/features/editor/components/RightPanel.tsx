import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { Maximize2, Send, Loader2, Settings, ChevronDown, Zap } from 'lucide-react'
import type { Agent, ChatMessage } from '@/shared/types'
import AgentManagerPanel from './AgentManagerPanel'
import ProposalPanel from './ProposalPanel'

// ── Chat bubble ───────────────────────────────────────────────────────────────
function formatContent(content: string, isUser: boolean): React.ReactNode {
  if (isUser) return <span>{content}</span>

  const trimmed = content.trim()

  // JSON 감지 → action_plan 추출
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      const plan: string = parsed.action_plan ?? parsed.plan ?? parsed.summary ?? ''
      if (plan) {
        return plan.split(/\n+/).filter(Boolean).map((line, i) => (
          <span key={i} className="block leading-relaxed">{line}</span>
        ))
      }
    } catch {}
  }

  // 줄바꿈이 있으면 줄 단위로 렌더링
  if (/\n/.test(trimmed)) {
    return trimmed.split('\n').filter(Boolean).map((line, i) => (
      <span key={i} className="block leading-relaxed">{line}</span>
    ))
  }

  return <span>{trimmed}</span>
}

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
            : msg.type === 'info'
              ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border border-purple-100 rounded-bl-[4px]'
              : 'bg-[var(--bg-muted)] text-[var(--text)] rounded-bl-[4px]',
      )}>
        {formatContent(msg.content, isUser)}
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
        className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] text-[13px] font-semibold hover:bg-purple-100 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0" />
        <span className="max-w-[120px] truncate">{selected?.name ?? '에이전트'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 min-w-[180px]">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => { onSelect(a.definitionId ?? a.id); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-left transition-colors hover:bg-[var(--bg-muted)]',
                a.definitionId === selectedId && 'text-[var(--accent)] font-semibold',
              )}
            >
              <span className={cn(
                'w-2 h-2 rounded-full shrink-0',
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

// ── Root ──────────────────────────────────────────────────────────────────────
export default function RightPanel() {
  const { agents, chatMessages, runningAgentIds, sendMessage, selectChatAgent,
          selectedAgentDefinitionId, proposals } = useEditorStore()
  const { presentation } = useSlideStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [showManager, setShowManager] = useState(false)
  const [showProposal, setShowProposal] = useState(false)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showSlidePicker, setShowSlidePicker] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Init agent selection
  useEffect(() => {
    if (agents.length > 0 && !localSelectedId) {
      const first = agents[0].definitionId ?? agents[0].id
      setLocalSelectedId(first)
      selectChatAgent(first)
    }
  }, [agents])

  const handleSelectAgent = (id: string) => {
    setLocalSelectedId(id)
    selectChatAgent(id)
  }

  const activeId = localSelectedId ?? selectedAgentDefinitionId
  const activeAgent = agents.find((a) => a.definitionId === activeId) ?? agents[0]

  const msgs = activeAgent
    ? chatMessages.filter((m) => m.agentDefinitionId === activeAgent.definitionId)
    : []
  const isRunning = activeAgent?.definitionId
    ? runningAgentIds.has(activeAgent.definitionId)
    : false
  const slides = presentation?.slides ?? []
  const pendingCount = proposals.filter((p) => p.status === 'pending').length

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length, isRunning])

  // Close slide picker on outside click
  useEffect(() => {
    if (!showSlidePicker) return
    const handle = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSlidePicker(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showSlidePicker])

  const handleSend = async () => {
    const cmd = input.trim()
    if (!cmd || isRunning) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = '72px'
    setShowSlidePicker(false)
    if (activeAgent) selectChatAgent(activeAgent.definitionId ?? null)
    try { await sendMessage(cmd) } catch {}
  }

  const handleSlideSelect = (slide: { id: string; title: string; order: number }) => {
    const mention = `@슬라이드${slide.order + 1}(${slide.title || '제목 없음'}) `
    setInput((prev) => prev + mention)
    setShowSlidePicker(false)
    inputRef.current?.focus()
  }

  return (
    <div className="w-80 border-l border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden">

      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
        {agents.length > 0 && activeAgent ? (
          <AgentSelector
            agents={agents}
            selectedId={activeId}
            onSelect={handleSelectAgent}
          />
        ) : (
          <span className="text-[12px] text-[var(--text-disabled)]">에이전트 로딩 중...</span>
        )}
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => setShowManager(true)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="에이전트 관리"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => navigate(`/edit/${id}/agent`)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="전체 화면"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Proposal banner */}
      {pendingCount > 0 && (
        <button
          onClick={() => {
            const firstProposal = proposals.find((p) => p.status === 'pending')
            if (firstProposal && presentation) {
              const slideIdx = presentation.slides.findIndex((s) => s.id === firstProposal.slide_id)
              if (slideIdx >= 0) useSlideStore.getState().setCurrentSlide(slideIdx)
            }
            setShowProposal(true)
          }}
          className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[var(--accent-subtle)] border border-purple-200 text-[var(--accent)] text-[12px] font-medium hover:bg-purple-100 transition-colors shrink-0"
        >
          <Zap size={13} />
          변경 제안 {pendingCount}건 검토 필요
          <span className="ml-auto text-[11px] underline">보기</span>
        </button>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 min-h-0">
        {msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center">
              <span className="text-[var(--accent)] text-[16px]">✦</span>
            </div>
            <p className="text-[12px] text-[var(--text-disabled)]">
              {activeAgent ? `${activeAgent.name}에게 요청해보세요` : 'Agent에게 요청해보세요'}
            </p>
          </div>
        ) : (
          msgs.map((msg: ChatMessage) => <ChatBubble key={msg.id} msg={msg} />)
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

      {/* Input area */}
      <div className="px-3 py-3 border-t border-[var(--border)] bg-white shrink-0">
        {/* @ slide picker */}
        {showSlidePicker && slides.length > 0 && (
          <div
            ref={pickerRef}
            className="mb-1 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 z-30 max-h-48 overflow-y-auto"
          >
            <p className="px-3 py-1 text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wide">슬라이드 선택</p>
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => handleSlideSelect({ id: s.id, title: s.title ?? '', order: i })}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:bg-[var(--bg-muted)] transition-colors"
              >
                <span className="w-5 h-5 flex items-center justify-center rounded-[4px] bg-[var(--bg-muted)] text-[10px] font-bold text-[var(--text-muted)] shrink-0">
                  {i + 1}
                </span>
                <span className="truncate text-[var(--text)]">{s.title || `슬라이드 ${i + 1}`}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-[10px] border border-[var(--border)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)] bg-white px-3 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(Math.max(el.scrollHeight, 72), 150) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            onFocus={() => activeAgent && selectChatAgent(activeAgent.definitionId ?? null)}
            placeholder={activeAgent ? `${activeAgent.name}에게 요청... (Shift+Enter 줄바꿈)` : '요청...'}
            disabled={isRunning}
            className="flex-1 resize-none text-[13px] border-0 outline-none bg-transparent py-2.5 leading-relaxed disabled:opacity-50"
            style={{ height: '72px', maxHeight: '150px' }}
          />
          <div className="flex items-center gap-1 pb-2 shrink-0">
            {/* @ button */}
            {slides.length > 0 && (
              <button
                onClick={() => setShowSlidePicker((v) => !v)}
                className={cn(
                  'px-1.5 py-1 rounded-[6px] text-[12px] font-semibold transition-colors',
                  showSlidePicker
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)]',
                )}
                title="슬라이드 컨텍스트 추가 (@)"
              >
                @
              </button>
            )}
            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isRunning}
              className="h-7 w-7 flex items-center justify-center rounded-[7px] bg-[var(--accent)] text-white disabled:opacity-40 hover:bg-[var(--accent-hover)] transition-colors shrink-0"
            >
              {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>

      <AgentManagerPanel open={showManager} onClose={() => setShowManager(false)} />
      {showProposal && <ProposalPanel open={showProposal} onClose={() => setShowProposal(false)} />}
    </div>
  )
}
