import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
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
      useEditorStore.setState({ presentation: updated })
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
  const { activeRightTab, setActiveRightTab, proposals, presentation, currentSlideIndex } = useEditorStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [showManager, setShowManager] = useState(false)
  const [showProposal, setShowProposal] = useState(false)

  const currentSlide = presentation?.slides[currentSlideIndex]
  const pendingCount = proposals.filter((p) => p.status === 'pending' && p.slide_id === currentSlide?.id).length

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
            onClick={() => setShowProposal(true)}
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
