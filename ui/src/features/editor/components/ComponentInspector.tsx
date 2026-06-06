import { useState, useEffect, useRef, useCallback } from 'react'
import { History, RotateCcw, ChevronDown, Clock, Check, X } from 'lucide-react'
import type { HtmlComponentStyle } from './SlideCanvas'
import { useEditorStore } from '../store/editorStore'
import { useProposalStore } from '../store/proposalStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { fetchSlideHistory, restoreFromHistory, type SlideHistoryEntry } from '@/shared/lib/projectApi'
import type { AgentProposal } from '@/shared/types'

// ── Util ──────────────────────────────────────────────────────────────────────

function colorToHex(css: string): string {
  if (!css || css === 'transparent') return '#000000'
  if (/^#[0-9a-f]{3,8}$/i.test(css)) return css.slice(0, 7)
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return '#000000'
  return `#${[m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('')}`
}

function isTransparent(css: string): boolean {
  return !css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)'
}

function dispatch(componentId: string, prop: string, value: string | number) {
  window.dispatchEvent(new CustomEvent('html-component-style-update', {
    detail: { componentId, prop, value },
  }))
}

function previewComponent(componentId: string, newHtml: string) {
  window.dispatchEvent(new CustomEvent('html-component-preview', {
    detail: { componentId, newHtml },
  }))
}

function clearPreview(componentId: string) {
  window.dispatchEvent(new CustomEvent('html-component-preview-clear', {
    detail: { componentId },
  }))
}

function extractComponentHtml(proposalHtml: string, componentId: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const doc = new DOMParser().parseFromString(proposalHtml, 'text/html')
    const el = doc.querySelector(`[data-component-id="${componentId}"]`)
    return el?.outerHTML ?? null
  } catch { return null }
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-disabled)]">
        {children}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-[var(--border)] mx-0" />
}

interface NumInputProps {
  label: string
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
  min?: number
  max?: number
}

function NumInput({ label, value, onChange, onCommit, min = -9999, max = 99999 }: NumInputProps) {
  const [local, setLocal] = useState(String(Math.round(value)))

  useEffect(() => {
    setLocal(String(Math.round(value)))
  }, [value])

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <span className="text-[10px] text-[var(--text-disabled)] w-3 shrink-0 select-none">{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        className="
          flex-1 min-w-0 h-7 px-2 rounded-[6px] text-[12px] text-[var(--text)]
          bg-[var(--bg-muted)] border border-[var(--border)]
          focus:outline-none focus:border-[var(--accent)] focus:bg-[var(--bg)]
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
        "
        onChange={(e) => {
          setLocal(e.target.value)
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onChange(clamp(n))
        }}
        onBlur={() => {
          const n = parseFloat(local)
          if (!isNaN(n)) onCommit(clamp(n))
          else setLocal(String(Math.round(value)))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp') { e.preventDefault(); const n = clamp(value + 1); onChange(n); onCommit(n) }
          if (e.key === 'ArrowDown') { e.preventDefault(); const n = clamp(value - 1); onChange(n); onCommit(n) }
        }}
      />
    </div>
  )
}

interface ColorRowProps {
  label: string
  value: string
  onChange: (hex: string) => void
}

function ColorRow({ label, value, onChange }: ColorRowProps) {
  const hex = colorToHex(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const [hexInput, setHexInput] = useState(hex.slice(1))

  useEffect(() => {
    setHexInput(colorToHex(value).slice(1))
  }, [value])

  const handleHexCommit = () => {
    const clean = hexInput.replace(/[^0-9a-f]/gi, '').slice(0, 6)
    if (clean.length === 6) {
      onChange(`#${clean}`)
    } else {
      setHexInput(hex.slice(1))
    }
  }

  return (
    <div className="px-4 py-1.5 flex items-center gap-2">
      <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <button
        className="w-5 h-5 rounded-[4px] border border-[var(--border)] shrink-0 cursor-pointer relative overflow-hidden"
        style={{ background: hex }}
        onClick={() => inputRef.current?.click()}
        title="색상 선택"
      >
        <input
          ref={inputRef}
          type="color"
          value={hex}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          onChange={(e) => {
            onChange(e.target.value)
            setHexInput(e.target.value.slice(1))
          }}
        />
      </button>
      <div className="flex items-center gap-0.5 flex-1 min-w-0 h-7 px-2 rounded-[6px] bg-[var(--bg-muted)] border border-[var(--border)] focus-within:border-[var(--accent)]">
        <span className="text-[11px] text-[var(--text-disabled)]">#</span>
        <input
          type="text"
          maxLength={6}
          value={hexInput}
          className="flex-1 min-w-0 text-[12px] text-[var(--text)] bg-transparent focus:outline-none uppercase font-mono"
          onChange={(e) => setHexInput(e.target.value.toUpperCase())}
          onBlur={handleHexCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleHexCommit() }}
        />
      </div>
    </div>
  )
}

// ── Inline History ────────────────────────────────────────────────────────────

function InlineHistory({ open }: { open: boolean }) {
  const { presentation, currentSlideIndex, loadPresentation } = useEditorStore()
  const projectId = presentation?.id
  const currentSlide = presentation?.slides[currentSlideIndex]

  const [versions, setVersions] = useState<SlideHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !projectId || !currentSlide) return
    setLoading(true)
    fetchSlideHistory(projectId, currentSlide.id)
      .then(setVersions)
      .finally(() => setLoading(false))
  }, [open, projectId, currentSlide?.id])

  const handleRestore = async (versionId: string) => {
    if (!projectId || !currentSlide) return
    setRestoring(versionId)
    try {
      await restoreFromHistory(projectId, currentSlide.id, versionId)
      await loadPresentation(projectId)
    } finally {
      setRestoring(null)
    }
  }

  if (!open) return null

  return (
    <div className="border-t border-[var(--border)]">
      {loading ? (
        <div className="py-6 flex items-center justify-center text-[12px] text-[var(--text-disabled)]">
          불러오는 중...
        </div>
      ) : versions.length === 0 ? (
        <div className="py-6 flex flex-col items-center justify-center gap-1.5">
          <Clock size={18} className="text-[var(--text-disabled)]" />
          <p className="text-[11px] text-[var(--text-disabled)]">저장된 버전이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {versions.map((v) => {
            const colonIdx = v.reason.indexOf(':')
            const agent = colonIdx > 0 ? v.reason.slice(0, colonIdx).trim() : ''
            const command = colonIdx > 0 ? v.reason.slice(colonIdx + 1).trim() : v.reason
            const isRestoring = restoring === v.id
            return (
              <div key={v.id} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-muted)] group transition-colors">
                <div className="flex-1 min-w-0">
                  {agent && (
                    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 bg-[var(--accent-subtle)] text-[var(--accent-text)]">
                      {agent}
                    </span>
                  )}
                  <p className="text-[11px] text-[var(--text)] leading-snug line-clamp-2">{command}</p>
                  <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">{formatDate(v.created_at)}</p>
                </div>
                <button
                  onClick={() => handleRestore(v.id)}
                  disabled={!!restoring}
                  className={cn(
                    'shrink-0 flex items-center gap-1 px-2 py-1 rounded-[5px] text-[10px] font-medium transition-colors',
                    'opacity-0 group-hover:opacity-100',
                    'bg-[var(--bg-muted)] hover:bg-[var(--border)] text-[var(--text-muted)]',
                    'disabled:opacity-40',
                  )}
                >
                  {isRestoring ? <span className="animate-spin">↻</span> : <RotateCcw size={10} />}
                  복원
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  style: HtmlComponentStyle
}

export default function ComponentInspector({ style }: Props) {
  const [pos, setPos] = useState({ x: style.left, y: style.top })
  const [size, setSize] = useState({ w: style.width, h: style.height })
  const [opacity, setOpacity] = useState(Math.round(style.opacity * 100))
  const [color, setColor] = useState(style.color)
  const [bgColor, setBgColor] = useState(style.backgroundColor)
  const [fontSize, setFontSize] = useState(style.fontSize)
  const [showHistory, setShowHistory] = useState(false)
  const [dismissedProposalIds, setDismissedProposalIds] = useState<Set<string>>(new Set())
  const [approvingId, setApprovingId] = useState<string | null>(null)

  const { proposals, approveProposal } = useProposalStore()
  const { presentation, currentSlideIndex } = useSlideStore()
  const currentSlide = presentation?.slides[currentSlideIndex]

  useEffect(() => {
    setPos({ x: style.left, y: style.top })
    setSize({ w: style.width, h: style.height })
    setOpacity(Math.round(style.opacity * 100))
    setColor(style.color)
    setBgColor(style.backgroundColor)
    setFontSize(style.fontSize)
    setShowHistory(false)
  }, [style.componentId])

  const id = style.componentId

  // 이 컴포넌트에 영향을 주는 pending 제안 찾기 (수정 또는 삭제)
  const activeProposal: (AgentProposal & { proposedHtml: string; isDeleted: boolean }) | null = (() => {
    const currentHtmlRaw = currentSlide?.html_content || ''
    for (const p of proposals) {
      if (p.status !== 'pending') continue
      if (p.slide_id !== currentSlide?.id) continue
      if (!p.html_content) continue
      if (dismissedProposalIds.has(p.id)) continue
      const proposedHtml = extractComponentHtml(p.html_content, id)
      if (!proposedHtml) {
        // proposal에 없음 → 삭제 예정
        return { ...p, proposedHtml: '', isDeleted: true }
      }
      // 현재 슬라이드와 동일하면 이미 적용된 것 (추가 자동 적용 후) → skip
      const currentHtml = extractComponentHtml(currentHtmlRaw, id)
      if (proposedHtml === currentHtml) continue
      return { ...p, proposedHtml, isDeleted: false }
    }
    return null
  })()

  const commitProp = useCallback((prop: string, value: string | number) => {
    dispatch(id, prop, value)
  }, [id])

  const handleApproveComponent = async () => {
    if (!activeProposal) return
    setApprovingId(activeProposal.id)
    try {
      clearPreview(id)
      await approveProposal(activeProposal.id, [id], true)
    } finally {
      setApprovingId(null)
    }
  }

  const handleDismiss = () => {
    if (!activeProposal) return
    clearPreview(id)
    setDismissedProposalIds((s) => new Set([...s, activeProposal.id]))
  }

  return (
    <div className="flex flex-col text-[var(--text)] select-none overflow-y-auto">

      {/* Position */}
      <SectionLabel>Position</SectionLabel>
      <div className="px-4 pb-2 flex gap-2">
        <NumInput
          label="X"
          value={pos.x}
          onChange={(v) => setPos((p) => ({ ...p, x: v }))}
          onCommit={(v) => { setPos((p) => ({ ...p, x: v })); commitProp('left', v) }}
        />
        <NumInput
          label="Y"
          value={pos.y}
          onChange={(v) => setPos((p) => ({ ...p, y: v }))}
          onCommit={(v) => { setPos((p) => ({ ...p, y: v })); commitProp('top', v) }}
        />
      </div>

      <Divider />

      {/* Size */}
      <SectionLabel>Size</SectionLabel>
      <div className="px-4 pb-2 flex gap-2">
        <NumInput
          label="W"
          value={size.w}
          min={1}
          onChange={(v) => setSize((s) => ({ ...s, w: v }))}
          onCommit={(v) => { setSize((s) => ({ ...s, w: v })); commitProp('width', v) }}
        />
        <NumInput
          label="H"
          value={size.h}
          min={1}
          onChange={(v) => setSize((s) => ({ ...s, h: v }))}
          onCommit={(v) => { setSize((s) => ({ ...s, h: v })); commitProp('height', v) }}
        />
      </div>

      <Divider />

      {/* Appearance */}
      <SectionLabel>Appearance</SectionLabel>
      <div className="px-4 pb-2 flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">Opacity</span>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <NumInput
            label=""
            value={opacity}
            min={0}
            max={100}
            onChange={(v) => { setOpacity(v); commitProp('opacity', v / 100) }}
            onCommit={(v) => { setOpacity(v); commitProp('opacity', v / 100) }}
          />
          <span className="text-[10px] text-[var(--text-disabled)] shrink-0">%</span>
        </div>
      </div>

      <Divider />

      {/* Fill */}
      {!isTransparent(bgColor) && (
        <>
          <SectionLabel>Fill</SectionLabel>
          <ColorRow
            label="배경"
            value={bgColor}
            onChange={(hex) => { setBgColor(hex); commitProp('backgroundColor', hex) }}
          />
          <div className="pb-1" />
          <Divider />
        </>
      )}

      {/* Text properties */}
      {style.isText && (
        <>
          <SectionLabel>Text</SectionLabel>
          <ColorRow
            label="색상"
            value={color}
            onChange={(hex) => { setColor(hex); commitProp('color', hex) }}
          />
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">Font size</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <NumInput
                label=""
                value={fontSize}
                min={6}
                onChange={(v) => setFontSize(v)}
                onCommit={(v) => { setFontSize(v); commitProp('fontSize', v) }}
              />
              <span className="text-[10px] text-[var(--text-disabled)] shrink-0">px</span>
            </div>
          </div>
          <div className="pb-1" />
          <Divider />
        </>
      )}

      {/* Proposal: 수정 또는 삭제 예정 */}
      {activeProposal && (
        <>
          <Divider />
          <div className="px-4 py-3">
            {activeProposal.isDeleted ? (
              <>
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500">삭제 예정</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mb-2.5 leading-snug line-clamp-2">
                  {activeProposal.agent_name}이(가) 이 컴포넌트를 삭제하려 합니다.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleApproveComponent}
                    disabled={!!approvingId}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[7px] bg-red-500 text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Check size={11} />
                    {approvingId ? '삭제 중...' : '삭제 확인'}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="flex items-center justify-center w-8 rounded-[7px] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
                    title="유지"
                  >
                    <X size={13} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">변경 제안</span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mb-2.5 leading-snug line-clamp-2">
                  {activeProposal.agent_name}: {activeProposal.summary || activeProposal.command}
                </p>
                <div className="flex gap-2">
                  <button
                    onMouseEnter={() => previewComponent(id, activeProposal.proposedHtml)}
                    onMouseLeave={() => clearPreview(id)}
                    onClick={handleApproveComponent}
                    disabled={!!approvingId}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[7px] bg-[var(--accent)] text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Check size={11} />
                    {approvingId ? '적용 중...' : '적용'}
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="flex items-center justify-center w-8 rounded-[7px] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
                    title="나중에"
                  >
                    <X size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Version History */}
      <div className="px-4 py-3">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="w-full flex items-center justify-center gap-2 h-8 rounded-[8px] text-[12px] font-medium text-[var(--text-muted)] border border-[var(--border)] bg-[var(--bg-muted)] hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
        >
          <History size={13} />
          슬라이드 변경 내역
          <ChevronDown size={12} className={cn('ml-auto transition-transform', showHistory && 'rotate-180')} />
        </button>
      </div>

      <InlineHistory open={showHistory} />

    </div>
  )
}
