import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditorStore } from '../store/editorStore'
import { useAgentStore, type AgentStep } from '../store/agentStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { Maximize2, Send, Loader2, ChevronDown, Search, X } from 'lucide-react'
import type { Agent, ChatMessage } from '@/shared/types'
import AgentManagerPanel from './AgentManagerPanel'
import ComponentInspector from './ComponentInspector'
import SessionSelector from './SessionSelector'
import { useSessionStore } from '../store/sessionStore'
import type { HtmlComponentStyle } from './SlideCanvas'

// ── 단일 노드 아이템 ──────────────────────────────────────────────────────────
function StepNode({ step, showLine, lineGreen }: { step: AgentStep; showLine: boolean; lineGreen: boolean }) {
  const isDone = step.status === 'done'
  const isActive = step.status === 'active'
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
          isDone && 'bg-emerald-500',
          isActive && 'bg-[var(--accent)] ring-4 ring-[var(--accent)] ring-opacity-20',
          !isDone && !isActive && 'border-2 border-[var(--border)] bg-[var(--bg-muted)]',
        )}>
          {isDone && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {isActive && <div className="w-[6px] h-[6px] rounded-full bg-white animate-pulse" />}
        </div>
        {showLine && (
          <div className={cn('w-px flex-1 my-0.5 min-h-[12px] transition-all duration-500', lineGreen ? 'bg-emerald-400' : 'bg-[var(--border)]')} />
        )}
      </div>
      <div className={cn(
        'pb-3 pt-0.5 text-[12px] leading-[18px] transition-all duration-300 break-words min-w-0',
        !showLine && 'pb-0',
        isDone && 'text-[var(--text-muted)]',
        isActive && 'text-[var(--text)] font-semibold',
        !isDone && !isActive && 'text-[var(--text-disabled)]',
      )}>
        {step.label}
      </div>
    </div>
  )
}

// ── 단계별 체크리스트 ─────────────────────────────────────────────────────────
function StepsChecklist({ steps }: { steps: AgentStep[] }) {
  // slide-* 단계를 병렬 그룹으로 분리
  const slideSteps = steps.filter((s) => s.id.startsWith('slide-'))
  const seqSteps = steps.filter((s) => !s.id.startsWith('slide-'))
  const hasSlides = slideSteps.length > 0
  const allSlidesDone = slideSteps.length > 0 && slideSteps.every((s) => s.status === 'done')
  const anySlideActive = slideSteps.some((s) => s.status === 'active' || s.status === 'done')
  // 순차 단계가 모두 완료돼야 슬라이드 병렬 그룹 활성화
  const seqAllDone = seqSteps.every((s) => s.status === 'done')
  const slideGroupReady = seqAllDone || anySlideActive

  return (
    <div className="mx-3 my-2 px-3 py-2.5">
      {seqSteps.map((step, i) => {
        const isLast = i === seqSteps.length - 1 && !hasSlides
        return (
          <StepNode
            key={step.id}
            step={step}
            showLine={!isLast}
            lineGreen={step.status === 'done'}
          />
        )
      })}

      {/* 병렬 슬라이드 그룹 */}
      {hasSlides && (
        <>
          {/* 진입 연결선 */}
          <div className="flex gap-3">
            <div className="flex flex-col items-center shrink-0 w-[18px]">
              <div className={cn('w-px flex-1 min-h-[8px] transition-all duration-500', anySlideActive ? 'bg-emerald-400' : 'bg-[var(--border)]')} />
            </div>
          </div>

          {/* 병렬 박스 — 순차 단계 완료 전엔 dimmed */}
          <div className={cn(
            'ml-0 border rounded-[8px] p-2 mb-1 transition-all duration-300',
            !slideGroupReady && 'opacity-40',
            allSlidesDone
              ? 'border-emerald-200 bg-emerald-50'
              : anySlideActive
                ? 'border-[var(--accent)] border-opacity-30 bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] bg-[var(--bg-muted)]',
          )}>
            {/* 병렬 헤더 */}
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <div className="flex gap-0.5">
                {[0,1,2].map((i) => <div key={i} className={cn('w-1 h-1 rounded-full', anySlideActive ? 'bg-[var(--accent)]' : 'bg-[var(--border)]')} />)}
              </div>
              <span className="text-[10px] text-[var(--text-disabled)] font-medium">슬라이드 생성</span>
            </div>

            {/* 슬라이드 아이템들 */}
            <div className="flex flex-col gap-1">
              {slideSteps.map((step) => {
                const isDone = step.status === 'done'
                const isActive = step.status === 'active'
                return (
                  <div key={step.id} className="flex items-center gap-2 px-1">
                    <div className={cn(
                      'w-[14px] h-[14px] rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
                      isDone && 'bg-emerald-500',
                      isActive && 'bg-[var(--accent)]',
                      !isDone && !isActive && 'border-2 border-[var(--border)] bg-white',
                    )}>
                      {isDone && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                      {isActive && <div className="w-[5px] h-[5px] rounded-full bg-white animate-pulse" />}
                    </div>
                    <span className={cn(
                      'text-[11px] truncate max-w-[160px] transition-colors duration-300',
                      isDone && 'text-[var(--text-muted)]',
                      isActive && 'text-[var(--text)] font-semibold',
                      !isDone && !isActive && 'text-[var(--text-disabled)]',
                    )}>
                      {step.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Chat bubble ───────────────────────────────────────────────────────────────
function shouldCollapseLines(lines: string[]) {
  if (lines.length >= 4) return true
  return lines.some((line) =>
    /\[PRESENTATION\]|^슬라이드\s*\d+[:：]|^\[[A-Z_]+\]/.test(line.trim()),
  )
}

function renderLines(lines: string[], className = 'block leading-relaxed') {
  return lines.map((line, i) => (
    <span key={i} className={className}>{line}</span>
  ))
}

function renderCollapsible(lines: string[]) {
  const [summaryLine, ...detailLines] = lines
  if (!detailLines.length) return renderLines(lines)

  return (
    <div className="space-y-2">
      <span className="block leading-relaxed">{summaryLine}</span>
      <details className="group rounded-[8px] border border-[var(--border)] bg-white/70 px-2.5 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--accent-text)]">
          <span>로그</span>
          <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--text-muted)]">
          {renderLines(detailLines)}
        </div>
      </details>
    </div>
  )
}

function formatContent(content: string, isUser: boolean): React.ReactNode {
  if (isUser) return <span>{content}</span>

  const trimmed = content.trim()

  // JSON 감지 → action_plan 추출 또는 예쁘게 포맷팅
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const plan: string = parsed.action_plan ?? parsed.plan ?? parsed.summary ?? ''
      if (plan) {
        const lines = plan.split(/\n+/).map((line) => line.trim()).filter(Boolean)
        return shouldCollapseLines(lines) ? renderCollapsible(lines) : renderLines(lines)
      }
      // 특정 필드가 없는 일반 JSON인 경우 예쁘게 출력
      const formattedJson = JSON.stringify(parsed, null, 2)
      return (
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-tight opacity-90 py-1 overflow-x-auto">
          {formattedJson}
        </pre>
      )
    } catch {
      // Fall through to plain text rendering.
    }
  }

  // 줄바꿈이 있으면 줄 단위로 렌더링
  if (/\n/.test(trimmed)) {
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
    return shouldCollapseLines(lines) ? renderCollapsible(lines) : renderLines(lines)
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

// ── Agent selector ────────────────────────────────────────────────────────────
function AgentSelector({ agents, selectedId, onSelect }: {
  agents: Agent[]
  selectedId?: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  if (agents.length === 0) return null

  const activeAgent = agents.find((a) => a.definitionId === selectedId) ?? agents[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] text-[13px] font-semibold hover:bg-purple-100 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
        <span className="max-w-[140px] truncate">{activeAgent.name}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-[var(--border)] rounded-[10px] shadow-lg min-w-[200px] overflow-hidden py-1">
          <div className="px-3 pt-1.5 pb-1">
            <span className="text-[10px] font-semibold text-[var(--text-disabled)] uppercase tracking-wide">에이전트 선택</span>
          </div>
          {agents.map((a) => (
            <button
              key={a.definitionId}
              onClick={() => { onSelect(a.definitionId ?? a.id); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-left transition-colors hover:bg-[var(--bg-muted)]',
                a.definitionId === activeAgent.definitionId && 'text-[var(--accent)] font-semibold bg-[var(--accent-subtle)]',
              )}
            >
              <span className={cn(
                'w-2 h-2 rounded-full shrink-0',
                a.definitionId === activeAgent.definitionId ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
              )} />
              <div className="flex-1 min-w-0">
                <span className="block truncate">{a.name}</span>
                <span className="text-[10px] text-[var(--text-disabled)] font-normal">{a.role}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── @mention highlight helper ─────────────────────────────────────────────────
function highlightMentions(text: string): React.ReactNode {
  if (!text) return null
  const parts = text.split(/(@슬라이드\d+)/)
  return parts.map((part, i) =>
    /^@슬라이드\d+$/.test(part)
      ? <span key={i} style={{ color: '#93C5FD' }}>{part}</span>
      : <span key={i}>{part}</span>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function RightPanel() {
  const { agents, chatMessages, runningAgentIds, sendMessage, selectChatAgent,
          selectedAgentDefinitionId, loadChatHistory } = useEditorStore()
  const { agentSteps, agentStartTime, estimatedSeconds, cancelAgent } = useAgentStore()
  const { currentSessionId, currentUserId, sessions } = useSessionStore()
  const [elapsed, setElapsed] = useState(0)
  const { presentation } = useSlideStore()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [showManager, setShowManager] = useState(false)
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showSlidePicker, setShowSlidePicker] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [panelWidth, setPanelWidth] = useState(320)
  const [htmlStyle, setHtmlStyle] = useState<HtmlComponentStyle | null>(null)
  const [activeTab, setActiveTab] = useState<'agent' | 'design'>('agent')
  const prevHtmlStyleRef = useRef<HtmlComponentStyle | null>(null)
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)

  // HTML 모드에서 선택된 요소 스타일 수신 + 탭 자동 전환
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<HtmlComponentStyle | null>).detail
      setHtmlStyle(detail ?? null)
      // null → non-null 전환 시 Design 탭으로 자동 이동
      if (detail && !prevHtmlStyleRef.current) setActiveTab('design')
      if (!detail) setActiveTab('agent')
      prevHtmlStyleRef.current = detail ?? null
    }
    window.addEventListener('html-component-select', handler)
    return () => window.removeEventListener('html-component-select', handler)
  }, [])

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const handleSelectAgent = (id: string) => {
    setLocalSelectedId(id)
    selectChatAgent(id)
  }

  const activeId = localSelectedId ?? selectedAgentDefinitionId ?? agents[0]?.definitionId ?? null
  const activeAgent = agents.find((a) => a.definitionId === activeId) ?? agents[0]

  const msgs = activeAgent
    ? chatMessages.filter((m) => m.agentDefinitionId === activeAgent.definitionId)
    : []
  // overallStatus로도 fallback — agentDefinitionId가 null일 때도 전송 차단
  const { overallStatus } = useAgentStore()
  const isRunning = overallStatus === 'running' || (
    activeAgent?.definitionId
      ? runningAgentIds.has(activeAgent.definitionId)
      : false
  )
  const slides = presentation?.slides ?? []

  // 경과 시간 타이머
  useEffect(() => {
    if (!agentStartTime) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - agentStartTime) / 1000)), 1000)
    return () => clearInterval(id)
  }, [agentStartTime])

  const handleCancel = useCallback(async () => {
    await cancelAgent()
  }, [cancelAgent])

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

  // 세션 전환 시 채팅 히스토리 재로드
  useEffect(() => {
    if (id && currentSessionId) loadChatHistory(id)
  }, [currentSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrentSessionMine = (() => {
    if (!currentSessionId) return true
    const s = sessions.find((ss) => ss.id === currentSessionId)
    return !s?.user_id || s.user_id === currentUserId
  })()

  const handleSend = async () => {
    let cmd = input.trim()
    if (!cmd || isRunning) return
    if (webSearchEnabled) {
      cmd = `[웹검색 활성화] ${cmd}`
    }
    setInput('')
    if (inputRef.current) inputRef.current.style.height = '72px'
    setShowSlidePicker(false)
    if (activeAgent) selectChatAgent(activeAgent.definitionId ?? null)
    try { await sendMessage(cmd) }
    catch {
      // sendMessage pushes its own error message into the chat state.
    }
  }

  const handleSlideSelect = (slide: { id: string; title: string; order: number }) => {
    const mention = `@슬라이드${slide.order + 1} `
    if (mentionQuery !== null) {
      setInput((prev) => prev.replace(/@[^@\s]*$/, mention))
    } else {
      setInput((prev) => prev + mention)
    }
    setMentionQuery(null)
    setShowSlidePicker(false)
    inputRef.current?.focus()
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    resizeStartXRef.current = e.clientX
    resizeStartWidthRef.current = panelWidth
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = resizeStartXRef.current - ev.clientX
      setPanelWidth(Math.min(Math.max(resizeStartWidthRef.current + delta, 256), 600))
    }
    const onUp = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const filteredSlides = mentionQuery !== null
    ? slides.filter((_, i) => {
        const label = `슬라이드${i + 1}`
        const numStr = `${i + 1}`
        return label.startsWith(mentionQuery) || numStr.startsWith(mentionQuery.replace(/^슬라이드/, ''))
      })
    : slides

  return (
    <div
      className="border-l border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden h-full relative"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[var(--accent)] hover:opacity-40 transition-colors"
      />

      {/* Tab bar */}
      <div className="border-b border-[var(--border)] flex items-stretch shrink-0">
        <button
          onClick={() => setActiveTab('design')}
          disabled={!htmlStyle}
          className={cn(
            'flex-1 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'design' && htmlStyle
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-disabled)] hover:text-[var(--text-muted)] disabled:opacity-40 disabled:cursor-default',
          )}
        >
          Design
        </button>
        <button
          onClick={() => setActiveTab('agent')}
          className={cn(
            'flex-1 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'agent'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-disabled)] hover:text-[var(--text-muted)]',
          )}
        >
          Agent
        </button>
      </div>

      {/* Design tab */}
      {activeTab === 'design' && htmlStyle && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <ComponentInspector style={htmlStyle} />
        </div>
      )}

      {/* Agent tab */}
      {activeTab === 'agent' && <>

      {/* Agent header */}
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
            onClick={() => navigate(`/edit/${id}/agent`)}
            className="p-1.5 rounded-[6px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
            title="전체 화면"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Session selector row */}
      <div className="px-3 py-1.5 border-b border-[var(--border)] flex items-center gap-2 shrink-0 bg-[var(--bg-muted)]">
        <span className="text-[10px] text-[var(--text-disabled)] shrink-0">세션</span>
        <SessionSelector />
        {!isCurrentSessionMine && (
          <span className="text-[10px] text-[var(--text-disabled)] ml-auto shrink-0">읽기 전용</span>
        )}
      </div>



      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 min-h-0">
        {/* 파이프라인 진행 시각화 — 실행 중일 때 채팅 최상단 고정 */}
        {agentSteps.length > 0 && (
          <div className="sticky top-0 z-10 -mx-4 px-1 pt-1 pb-2 bg-[var(--bg-muted)] border-b border-[var(--border)] mb-1">
            <StepsChecklist steps={agentSteps} />
          </div>
        )}
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
          <>
            {/* ETA + 취소 */}
            {agentStartTime && (
              <div className="flex items-center justify-between gap-2 px-1 py-0.5">
                <span className="text-[10px] text-[var(--text-disabled)]">
                  {estimatedSeconds
                    ? `${elapsed}s / 약 ${estimatedSeconds}s`
                    : `${elapsed}s 경과`}
                </span>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
                >
                  <X size={9} />
                  취소
                </button>
              </div>
            )}
            <div className="flex justify-start">
              <div className="bg-[var(--bg-muted)] px-3 py-2 rounded-[12px] rounded-bl-[4px] text-[12px] text-[var(--text-muted)] flex items-center gap-1.5 shadow-sm border border-[var(--border)] max-w-[90%]">
                <Loader2 size={10} className="animate-spin shrink-0" />
                <span className="truncate">{activeAgent?.currentTask || '처리 중...'}</span>
              </div>
            </div>
          </>
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
            {filteredSlides.map((s) => {
              const realIdx = slides.indexOf(s)
              return (
                <button
                  key={s.id}
                  onClick={() => handleSlideSelect({ id: s.id, title: s.title ?? '', order: realIdx })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:bg-[var(--bg-muted)] transition-colors"
                >
                  <span className="w-5 h-5 flex items-center justify-center rounded-[4px] bg-[var(--bg-muted)] text-[10px] font-bold text-[var(--text-muted)] shrink-0">
                    {realIdx + 1}
                  </span>
                  <span className="truncate text-[var(--text)]">{s.title || `슬라이드 ${realIdx + 1}`}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-[10px] border border-[var(--border)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)] bg-white px-3 transition-all">
          <div className="relative flex-1">
            {input && (
              <div
                aria-hidden="true"
                className="absolute inset-0 text-[13px] leading-relaxed py-2.5 pointer-events-none select-none whitespace-pre-wrap overflow-hidden break-words"
              >
                {highlightMentions(input)}
              </div>
            )}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              const val = e.target.value
              setInput(val)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(Math.max(el.scrollHeight, 72), 150) + 'px'
              const match = val.match(/@([^@\s]*)$/)
              if (match) {
                setMentionQuery(match[1])
                setShowSlidePicker(true)
              } else {
                setMentionQuery(null)
                setShowSlidePicker(false)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setShowSlidePicker(false); setMentionQuery(null) }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            onFocus={() => activeAgent && selectChatAgent(activeAgent.definitionId ?? null)}
            placeholder={!isCurrentSessionMine ? '다른 유저의 세션 — 읽기 전용' : activeAgent ? `${activeAgent.name}에게 요청... (Shift+Enter 줄바꿈)` : '요청...'}
            disabled={isRunning || !isCurrentSessionMine}
            className="relative w-full resize-none text-[13px] border-0 outline-none bg-transparent py-2.5 leading-relaxed disabled:opacity-50"
            style={{ height: '72px', maxHeight: '150px', color: input ? 'transparent' : undefined, caretColor: 'var(--text)' }}
          />
          </div>
          <div className="flex items-center gap-1 pb-2 shrink-0">
            {/* @ button */}
            {slides.length > 0 && (
              <button
                onClick={() => { setMentionQuery(null); setShowSlidePicker((v) => !v) }}
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
            {/* Web search toggle */}
            <button
              onClick={() => setWebSearchEnabled((v) => !v)}
              className={cn(
                'px-1.5 py-1 rounded-[6px] text-[12px] font-medium transition-colors',
                webSearchEnabled
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)]',
              )}
              title="웹 검색 포함"
            >
              <Search size={13} />
            </button>
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

      </> /* end Agent tab */}

      <AgentManagerPanel open={showManager} onClose={() => setShowManager(false)} />
    </div>
  )
}
