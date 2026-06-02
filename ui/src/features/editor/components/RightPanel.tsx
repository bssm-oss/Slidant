import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/lib/apiClient'
import { Maximize2, Send, Loader2, Settings, ChevronDown, Zap } from 'lucide-react'
import type { Agent, ChatMessage } from '@/shared/types'
import AgentManagerPanel from './AgentManagerPanel'
import ProposalPanel from './ProposalPanel'

// ── Chat bubble ──────────────────────────────────────────────────────────────
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

  // 이모지 줄 포함 시 줄 단위로 나눠서 렌더링
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
function AgentSelector({ agents, selectedId, onSelect, compact = false, upward = false }: {
  agents: Agent[]
  selectedId: string | null
  onSelect: (id: string) => void
  compact?: boolean
  upward?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = agents.find((a) => a.definitionId === selectedId) ?? agents[0]

  if (agents.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-[6px] bg-[var(--bg-muted)] hover:bg-[var(--border)] transition-colors font-medium text-[var(--text)]',
          compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]',
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
        <span className="max-w-[72px] truncate">{selected?.name ?? '에이전트'}</span>
        <ChevronDown size={compact ? 10 : 12} className="text-[var(--text-disabled)] shrink-0" />
      </button>
      {open && (
        <div className={cn(
          'absolute left-0 z-30 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 min-w-[160px]',
          upward ? 'bottom-full mb-1' : 'top-full mt-1',
        )}>
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
function AgentChat({ agent, agents, onSelectAgent }: {
  agent: Agent
  agents: Agent[]
  onSelectAgent: (id: string) => void
}) {
  const { chatMessages, runningAgentIds, sendMessage, selectChatAgent, presentation } = useEditorStore()
  const [input, setInput] = useState('')
  const [showSlidePicker, setShowSlidePicker] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const msgs = chatMessages.filter((m) => m.agentDefinitionId === agent.definitionId)
  const isRunning = agent.definitionId ? runningAgentIds.has(agent.definitionId) : false
  const slides = presentation?.slides ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length, isRunning])

  // @ picker 외부 클릭 시 닫기
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
    setShowSlidePicker(false)
    selectChatAgent(agent.definitionId ?? null)
    try { await sendMessage(cmd) } catch {}
  }

  const handleSlideSelect = (slide: { id: string; title: string; order: number }) => {
    const mention = `@슬라이드${slide.order + 1}(${slide.title || '제목 없음'}) `
    setInput((prev) => prev + mention)
    setShowSlidePicker(false)
    inputRef.current?.focus()
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

      {/* Input area — SnapDeck style */}
      <div className="px-3 py-2.5 border-t border-[var(--border)] bg-white relative">
        {/* @ slide picker */}
        {showSlidePicker && slides.length > 0 && (
          <div
            ref={pickerRef}
            className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 z-30 max-h-48 overflow-y-auto"
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

        <div className="border border-[var(--border)] rounded-[12px] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)] transition-all bg-white overflow-hidden">
          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            onFocus={() => selectChatAgent(agent.definitionId ?? null)}
            placeholder={`${agent.name}에게 요청...`}
            disabled={isRunning}
            rows={2}
            className="w-full px-3 pt-2.5 pb-1 text-[13px] outline-none bg-transparent disabled:opacity-50 resize-none leading-relaxed"
          />
          {/* Bottom bar */}
          <div className="flex items-center justify-between px-2 pb-2 pt-0.5 gap-1">
            <div className="flex items-center gap-1 min-w-0">
              {/* Agent selector — compact, dropdown opens upward */}
              <AgentSelector
                agents={agents}
                selectedId={agent.definitionId ?? null}
                onSelect={onSelectAgent}
                compact
                upward
              />
              {/* @ slide context button */}
              {slides.length > 0 && (
                <button
                  onClick={() => setShowSlidePicker((v) => !v)}
                  className={cn(
                    'px-2 py-1 rounded-[6px] text-[12px] font-semibold transition-colors',
                    showSlidePicker
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)]',
                  )}
                  title="슬라이드 컨텍스트 추가 (@)"
                >
                  @
                </button>
              )}
            </div>
            {/* Send */}
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
      {/* AgentSelector is now inside AgentChat's input bottom bar */}
      {activeAgent && (
        <AgentChat
          agent={activeAgent}
          agents={agents}
          onSelectAgent={handleSelect}
        />
      )}
    </div>
  )
}

// ── Properties tab ────────────────────────────────────────────────────────────
function PropertiesTab() {
  const { presentation, currentSlideIndex, selectedComponentId, deleteComponent } = useEditorStore()
  const comp = presentation?.slides[currentSlideIndex]?.components.find((c) => c.id === selectedComponentId)
  const [imageUrl, setImageUrl] = useState('')
  const [saving, setSaving] = useState(false)

  // selectedComponentId 바뀌면 현재 src로 초기화
  useEffect(() => {
    const props = comp?.props as Record<string, unknown> | undefined
    setImageUrl((props?.src as string) ?? (props?.url as string) ?? '')
  }, [selectedComponentId])

  const handleApplyUrl = async () => {
    if (!presentation || !comp) return
    const slide = presentation.slides[currentSlideIndex]
    setSaving(true)
    try {
      await api.patch(
        `/projects/${presentation.id}/slides/${slide.id}/components/${comp.id}`,
        { properties: { ...(comp.props as object), src: imageUrl, placeholder: false } }
      )
      // presentation 재로드
      const { fetchProjectWithSlides } = await import('@/shared/lib/projectApi')
      const updated = await fetchProjectWithSlides(presentation.id)
      useSlideStore.setState({ presentation: updated })
    } catch (e) {
      console.error('Failed to update image URL', e)
    } finally {
      setSaving(false)
    }
  }

  if (!comp) return (
    <div className='flex flex-col items-center justify-center h-40 gap-2'>
      <p className='text-[12px] text-[var(--text-disabled)]'>컴포넌트를 선택하세요</p>
    </div>
  )

  return (
    <div className='p-4 flex flex-col gap-4'>
      {[
        { label: '타입', value: comp.type },
        { label: '위치', value: `x: ${Math.round(comp.position.x)},  y: ${Math.round(comp.position.y)}` },
        { label: '크기', value: `w: ${Math.round(comp.size.w)},  h: ${Math.round(comp.size.h)}` },
      ].map(({ label, value }) => (
        <div key={label} className='flex flex-col gap-0.5'>
          <p className='text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide'>{label}</p>
          <p className='text-[13px] text-[var(--text)]'>{value}</p>
        </div>
      ))}

      {comp.type === 'image' && (
        <div className='flex flex-col gap-1.5 pt-2 border-t border-[var(--border)]'>
          <p className='text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide'>이미지 URL</p>
          <input
            className='w-full h-8 px-2.5 text-[12px] border border-[var(--border)] rounded-[6px] outline-none focus:border-[var(--accent)] bg-white'
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder='https://...'
            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyUrl() }}
          />
          <button
            onClick={handleApplyUrl}
            disabled={saving || !imageUrl.trim()}
            className='h-8 px-3 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[6px] disabled:opacity-40 hover:opacity-90 transition-opacity'
          >
            {saving ? '적용 중...' : '적용'}
          </button>
        </div>
      )}

      <div className="pt-2 border-t border-[var(--border)]">
        <button
          onClick={() => deleteComponent()}
          className="w-full h-8 text-xs font-medium text-red-500 hover:bg-red-50 border border-red-200 rounded-[8px] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
        >
          🗑 컴포넌트 삭제
        </button>
        <p className="text-[10px] text-[var(--text-disabled)] text-center mt-1.5">또는 선택 후 Delete 키</p>
      </div>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function RightPanel() {
  const { activeRightTab, setActiveRightTab, proposals, presentation } = useEditorStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [showManager, setShowManager] = useState(false)
  const [showProposal, setShowProposal] = useState(false)

  const pendingCount = proposals.filter((p) => p.status === 'pending').length

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
        {activeRightTab === 'agent' && pendingCount > 0 && (
          <button
            onClick={() => {
              const firstProposal = proposals.find((p) => p.status === 'pending')
              if (firstProposal && presentation) {
                const slideIdx = presentation.slides.findIndex((s) => s.id === firstProposal.slide_id)
                if (slideIdx >= 0) useSlideStore.getState().setCurrentSlide(slideIdx)
              }
              setShowProposal(true)
            }}
            className='mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[var(--accent-subtle)] border border-purple-200 text-[var(--accent)] text-[12px] font-medium hover:bg-purple-100 transition-colors w-auto'
          >
            <Zap size={13} />
            변경 제안 {pendingCount}건 검토 필요
            <span className='ml-auto text-[11px] underline'>보기</span>
          </button>
        )}
        {activeRightTab === 'agent' ? <AgentTab /> : <PropertiesTab />}
      </div>

      <AgentManagerPanel open={showManager} onClose={() => setShowManager(false)} />
      {showProposal && <ProposalPanel open={showProposal} onClose={() => setShowProposal(false)} />}
    </div>
  )
}
