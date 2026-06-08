import { useState, useEffect, useRef, useCallback } from 'react'
import { History, RotateCcw, ChevronDown, Clock, Check, X, ImageUp, Trash2, AlignLeft, AlignCenter, AlignRight, ChevronUp, Plus } from 'lucide-react'
import type { HtmlComponentStyle } from './SlideCanvas'
import { useEditorStore } from '../store/editorStore'
import { useProposalStore } from '../store/proposalStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { fetchSlideHistory, restoreFromHistory, type SlideHistoryEntry } from '@/shared/lib/projectApi'
import type { AgentProposal } from '@/shared/types'

// ── Chart utils ───────────────────────────────────────────────────────────────

interface ChartDataRow { label: string; values: number[] }
interface ParsedChart { datasetLabels: string[]; rows: ChartDataRow[] }

function parseChartData(outerHtml: string): ParsedChart | null {
  try {
    const scriptMatch = outerHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
    if (!scriptMatch) return null
    const script = scriptMatch[1]
    const labelsMatch = script.match(/labels\s*:\s*\[([^\]]+)\]/)
    if (!labelsMatch) return null
    const xLabels = [...labelsMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1])
    if (!xLabels.length) return null
    const datasetLabels = [...script.matchAll(/\blabel\s*:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1])
    const dsDataMatches = [...script.matchAll(/\bdata\s*:\s*\[([\d\s,.+\-e]+)\]/g)]
    if (!dsDataMatches.length) return null
    const rows: ChartDataRow[] = xLabels.map((label, i) => ({
      label,
      values: dsDataMatches.map(m => {
        const nums = m[1].match(/-?[\d.]+(?:e[+-]?\d+)?/gi) ?? []
        return parseFloat(nums[i] ?? '0') || 0
      }),
    }))
    return { datasetLabels, rows }
  } catch { return null }
}

function rebuildChartHtml(originalHtml: string, rows: ChartDataRow[]): string {
  let result = originalHtml
  result = result.replace(
    /(labels\s*:\s*)\[([^\]]+)\]/,
    `$1[${rows.map(r => `'${r.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')}]`,
  )
  const datasetCount = rows[0]?.values.length ?? 0
  let dsIdx = 0
  result = result.replace(/(\bdata\s*:\s*)\[([\d\s,.+\-e]+)\]/g, (match, prefix) => {
    if (dsIdx < datasetCount) {
      const vals = rows.map(r => r.values[dsIdx] ?? 0)
      dsIdx++
      return `${prefix}[${vals.join(', ')}]`
    }
    return match
  })
  return result
}

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

function previewComponent(componentId: string, newHtml: string, fullProposalHtml?: string) {
  window.dispatchEvent(new CustomEvent('html-component-preview', {
    detail: { componentId, newHtml, fullProposalHtml },
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

// ── Image Position Grid ───────────────────────────────────────────────────────

const POSITION_CELLS = [
  ['left top', 'center top', 'right top'],
  ['left center', 'center center', 'right center'],
  ['left bottom', 'center bottom', 'right bottom'],
]

function ImagePositionGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
  const current = normalize(value)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">위치</span>
      <div className="grid grid-cols-3 gap-0.5 p-1 rounded-[6px] bg-[var(--bg-muted)] border border-[var(--border)]">
        {POSITION_CELLS.map((row) =>
          row.map((cell) => {
            const active = normalize(cell) === current
            return (
              <button
                key={cell}
                title={cell}
                onClick={() => onChange(cell)}
                className={cn(
                  'w-5 h-5 rounded-[3px] transition-colors',
                  active ? 'bg-[var(--accent)]' : 'hover:bg-[var(--border)]'
                )}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <div className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-white' : 'bg-[var(--text-disabled)]')} />
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Inline History ────────────────────────────────────────────────────────────

function InlineHistory({ open, componentId }: { open: boolean; componentId: string }) {
  const { presentation, currentSlideIndex, loadPresentation } = useEditorStore()
  const projectId = presentation?.id
  const currentSlide = presentation?.slides[currentSlideIndex]

  const [versions, setVersions] = useState<SlideHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoringComponent, setRestoringComponent] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId || !currentSlide) return
    setLoading(true)
    try {
      const data = await fetchSlideHistory(projectId, currentSlide.id, componentId)
      setVersions(data)
    } finally {
      setLoading(false)
    }
  }, [projectId, currentSlide?.id, componentId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleRestore = async (versionId: string) => {
    if (!projectId || !currentSlide) return
    clearFullPreview()
    setRestoring(versionId)
    try {
      await restoreFromHistory(projectId, currentSlide.id, versionId)
      await loadPresentation(projectId)
      await load()
    } finally {
      setRestoring(null)
    }
  }

  const handleRestoreComponent = async (versionId: string) => {
    if (!projectId || !currentSlide || !componentId) return
    clearPreview(componentId)
    setRestoringComponent(versionId)
    try {
      const { restoreComponentFromHistory } = await import('@/shared/lib/projectApi')
      await restoreComponentFromHistory(projectId, currentSlide.id, versionId, componentId)
      await loadPresentation(projectId)
      await load()
    } finally {
      setRestoringComponent(null)
    }
  }

  function showPreview(html: string) {
    window.dispatchEvent(new CustomEvent('html-component-preview', {
      detail: { componentId: '__history_preview__', newHtml: '', fullProposalHtml: html },
    }))
  }

  function clearFullPreview() {
    window.dispatchEvent(new CustomEvent('html-component-preview-clear', {
      detail: { componentId: '__history_preview__' },
    }))
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
              <div key={v.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-muted)] group transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-[var(--accent-text)] bg-[var(--accent-subtle)] px-1.5 py-0.5 rounded">
                      v{v.version}
                    </span>
                    {agent && (
                      <span className="text-[10px] font-medium text-[var(--text-muted)]">
                        {agent}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text)] leading-snug line-clamp-2">{command}</p>
                  <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">{formatDate(v.created_at)}</p>
                </div>
                <div
                  className="shrink-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100"
                >
                  <button
                    onClick={() => handleRestoreComponent(v.id)}
                    onMouseEnter={() => {
                      if (v.html_content) {
                        const compHtml = extractComponentHtml(v.html_content, componentId)
                        if (compHtml) previewComponent(componentId, compHtml)
                      }
                    }}
                    onMouseLeave={() => clearPreview(componentId)}
                    disabled={!!restoring || !!restoringComponent}
                    className={cn(
                      'flex flex-col items-center justify-center gap-0.5 w-16 py-1.5 rounded-[7px] text-[10px] font-semibold transition-all',
                      'bg-[var(--accent)] text-white',
                      'hover:opacity-90 hover:shadow-sm',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    title="이 컴포넌트만 복원"
                  >
                    {restoringComponent === v.id ? (
                      <span className="animate-spin inline-block text-sm">↻</span>
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    컴포넌트
                  </button>
                  <button
                    onClick={() => handleRestore(v.id)}
                    onMouseEnter={() => v.html_content && showPreview(v.html_content)}
                    onMouseLeave={clearFullPreview}
                    disabled={!!restoring || !!restoringComponent}
                    className={cn(
                      'flex flex-col items-center justify-center gap-0.5 w-16 py-1.5 rounded-[7px] text-[10px] font-medium transition-all',
                      'bg-[var(--bg-muted)] border border-[var(--border)] text-[var(--text-muted)]',
                      'hover:bg-[var(--border)] hover:text-[var(--text)]',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                    title="슬라이드 전체 복원"
                  >
                    {isRestoring ? (
                      <span className="animate-spin inline-block text-sm">↻</span>
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    슬라이드
                  </button>
                </div>
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
  const [fontWeight, setFontWeight] = useState(style.fontWeight ?? 400)
  const [textAlign, setTextAlign] = useState(style.textAlign || 'left')
  const [lineHeight, setLineHeight] = useState(style.lineHeight ?? 1.4)
  const [letterSpacing, setLetterSpacing] = useState(style.letterSpacing ?? 0)
  const [borderRadius, setBorderRadius] = useState(style.borderRadius ?? 0)
  const [aspectLock, setAspectLock] = useState(false)
  const [objectFit, setObjectFit] = useState(style.objectFit || 'cover')
  const [objectPosition, setObjectPosition] = useState(style.objectPosition || 'center center')
  const [backgroundSize, setBackgroundSize] = useState(style.backgroundSize || 'cover')
  const [backgroundPosition, setBackgroundPosition] = useState(style.backgroundPosition || 'center center')
  const [showHistory, setShowHistory] = useState(true)
  const [dismissedProposalIds, setDismissedProposalIds] = useState<Set<string>>(new Set())
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [expandedSummary, setExpandedSummary] = useState(false)
  const [chartData, setChartData] = useState<ParsedChart | null>(
    style.isChart && style.chartOuterHtml ? parseChartData(style.chartOuterHtml) : null
  )

  const { proposals, approveProposal } = useProposalStore()
  const { presentation, currentSlideIndex } = useSlideStore()
  const currentSlide = presentation?.slides[currentSlideIndex]

  // 컴포넌트 교체 시 전체 리셋
  useEffect(() => {
    setPos({ x: style.left, y: style.top })
    setSize({ w: style.width, h: style.height })
    setOpacity(Math.round(style.opacity * 100))
    setColor(style.color)
    setBgColor(style.backgroundColor)
    setFontSize(style.fontSize)
    setFontWeight(style.fontWeight ?? 400)
    setTextAlign(style.textAlign || 'left')
    setLineHeight(style.lineHeight ?? 1.4)
    setLetterSpacing(style.letterSpacing ?? 0)
    setBorderRadius(style.borderRadius ?? 0)
    setAspectLock(false)
    setObjectFit(style.objectFit || 'cover')
    setObjectPosition(style.objectPosition || 'center center')
    setBackgroundSize(style.backgroundSize || 'cover')
    setBackgroundPosition(style.backgroundPosition || 'center center')
    setShowHistory(true)
    setChartData(style.isChart && style.chartOuterHtml ? parseChartData(style.chartOuterHtml) : null)
  }, [style.componentId])

  // 같은 컴포넌트에서 외부(오버레이/onStyleUpdate) 변경 반영
  useEffect(() => { setOpacity(Math.round(style.opacity * 100)) }, [style.opacity])
  useEffect(() => { setPos({ x: style.left, y: style.top }) }, [style.left, style.top])
  useEffect(() => { setSize({ w: style.width, h: style.height }) }, [style.width, style.height])
  useEffect(() => { setFontSize(style.fontSize) }, [style.fontSize])
  useEffect(() => { setFontWeight(style.fontWeight ?? 400) }, [style.fontWeight])
  useEffect(() => { setTextAlign(style.textAlign || 'left') }, [style.textAlign])
  useEffect(() => { setLineHeight(style.lineHeight ?? 1.4) }, [style.lineHeight])
  useEffect(() => { setLetterSpacing(style.letterSpacing ?? 0) }, [style.letterSpacing])
  useEffect(() => { setBorderRadius(style.borderRadius ?? 0) }, [style.borderRadius])

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

  const dispatchChartUpdate = useCallback((data: ParsedChart) => {
    if (!style.chartOuterHtml) return
    const newOuterHtml = rebuildChartHtml(style.chartOuterHtml, data.rows)
    window.dispatchEvent(new CustomEvent('html-chart-data-update', { detail: { componentId: id, newOuterHtml } }))
  }, [id, style.chartOuterHtml])

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

      {/* 헤더: 컴포넌트 타입 + 삭제 버튼 */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-[var(--border)]">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">
          {style.isChart ? '차트' : style.isImage ? '이미지' : style.isText ? '텍스트' : '요소'}
        </span>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('html-component-delete-request', { detail: { componentId: id } }))}
          className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[var(--text-muted)] hover:bg-red-50 hover:text-red-500 transition-colors"
          title="컴포넌트 삭제 (Delete)"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* 위치 */}
      <SectionLabel>위치</SectionLabel>
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

      {/* 크기 + 비율 고정 */}
      <SectionLabel>크기</SectionLabel>
      <div className="px-4 pb-2 flex gap-2 items-center">
        <NumInput
          label="W"
          value={size.w}
          min={1}
          onChange={(v) => {
            if (aspectLock && size.h > 0) setSize({ w: v, h: Math.round(v / (size.w / size.h)) })
            else setSize((s) => ({ ...s, w: v }))
          }}
          onCommit={(v) => {
            if (aspectLock && size.h > 0) {
              const newH = Math.round(v / (size.w / size.h))
              setSize({ w: v, h: newH })
              commitProp('width', v); commitProp('height', newH)
            } else { setSize((s) => ({ ...s, w: v })); commitProp('width', v) }
          }}
        />
        <NumInput
          label="H"
          value={size.h}
          min={1}
          onChange={(v) => {
            if (aspectLock && size.w > 0) setSize({ w: Math.round(v * (size.w / size.h)), h: v })
            else setSize((s) => ({ ...s, h: v }))
          }}
          onCommit={(v) => {
            if (aspectLock && size.w > 0) {
              const newW = Math.round(v * (size.w / size.h))
              setSize({ w: newW, h: v })
              commitProp('width', newW); commitProp('height', v)
            } else { setSize((s) => ({ ...s, h: v })); commitProp('height', v) }
          }}
        />
        <button
          title={aspectLock ? '비율 고정 해제' : '비율 고정'}
          onClick={() => setAspectLock((v) => !v)}
          className={cn(
            'w-6 h-6 rounded-[5px] shrink-0 flex items-center justify-center transition-colors',
            aspectLock
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-muted)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)]'
          )}
        >
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
            <rect x="1" y="5" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill={aspectLock ? 'currentColor' : 'none'} />
            <path d="M3 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <Divider />

      {/* 투명도 */}
      <SectionLabel>투명도</SectionLabel>
      <div className="px-4 pb-2 flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <NumInput
            label=""
            value={opacity}
            min={0}
            max={100}
            onChange={(v) => setOpacity(v)}
            onCommit={(v) => { setOpacity(v); commitProp('opacity', v / 100) }}
          />
          <span className="text-[10px] text-[var(--text-disabled)] shrink-0">%</span>
        </div>
      </div>

      <Divider />

      {/* 모서리 반경 + 레이어 */}
      <SectionLabel>스타일</SectionLabel>
      <div className="px-4 pb-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">모서리</span>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <NumInput
              label=""
              value={borderRadius}
              min={0}
              onChange={(v) => setBorderRadius(v)}
              onCommit={(v) => { setBorderRadius(v); commitProp('borderRadius', v) }}
            />
            <span className="text-[10px] text-[var(--text-disabled)] shrink-0">px</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">레이어</span>
          <div className="flex gap-1">
            <button
              onClick={() => { const z = style.zIndex + 1; commitProp('zIndex', z) }}
              className="flex items-center gap-1 px-2 h-7 rounded-[6px] text-[11px] text-[var(--text-muted)] bg-[var(--bg-muted)] border border-[var(--border)] hover:bg-[var(--border)] transition-colors"
              title="앞으로 가져오기"
            >
              <ChevronUp size={11} />앞으로
            </button>
            <button
              onClick={() => { const z = Math.max(0, style.zIndex - 1); commitProp('zIndex', z) }}
              className="flex items-center gap-1 px-2 h-7 rounded-[6px] text-[11px] text-[var(--text-muted)] bg-[var(--bg-muted)] border border-[var(--border)] hover:bg-[var(--border)] transition-colors"
              title="뒤로 보내기"
            >
              <ChevronDown size={11} />뒤로
            </button>
          </div>
        </div>
      </div>

      <Divider />

      {/* 배경색 */}
      {!isTransparent(bgColor) && (
        <>
          <SectionLabel>배경색</SectionLabel>
          <ColorRow
            label="색상"
            value={bgColor}
            onChange={(hex) => { setBgColor(hex); commitProp('backgroundColor', hex) }}
          />
          <div className="pb-1" />
          <Divider />
        </>
      )}

      {/* 이미지 */}
      {style.isImage && (
        <>
          <SectionLabel>이미지</SectionLabel>
          <div className="px-4 py-2 flex flex-col gap-2">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('html-image-upload-request', { detail: { componentId: id } }))}
              className="w-full flex items-center justify-center gap-2 h-8 rounded-[7px] border border-[var(--border)] text-[var(--text-muted)] text-[11px] font-medium hover:bg-[var(--bg-muted)] transition-colors"
            >
              <ImageUp size={13} />
              이미지 업로드
            </button>
            {/* object-fit (img 태그) */}
            {style.tagName === 'img' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">맞춤</span>
                  <select
                    value={objectFit}
                    onChange={(e) => { setObjectFit(e.target.value); commitProp('objectFit', e.target.value) }}
                    className="flex-1 h-7 px-2 rounded-[6px] text-[11px] text-[var(--text)] bg-[var(--bg-muted)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="cover">꽉 채우기 (cover)</option>
                    <option value="contain">전체 보기 (contain)</option>
                    <option value="fill">늘리기 (fill)</option>
                    <option value="none">원본 크기</option>
                  </select>
                </div>
                {(objectFit === 'cover' || objectFit === 'contain') && (
                  <ImagePositionGrid
                    value={objectPosition}
                    onChange={(v) => { setObjectPosition(v); commitProp('objectPosition', v) }}
                  />
                )}
              </>
            )}
            {/* background-size (div 배경 이미지) */}
            {style.tagName !== 'img' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">맞춤</span>
                  <select
                    value={backgroundSize}
                    onChange={(e) => {
                      setBackgroundSize(e.target.value)
                      commitProp('backgroundSize', e.target.value)
                    }}
                    className="flex-1 h-7 px-2 rounded-[6px] text-[11px] text-[var(--text)] bg-[var(--bg-muted)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="cover">꽉 채우기 (cover)</option>
                    <option value="contain">전체 보기 (contain)</option>
                    <option value="100% 100%">늘리기</option>
                    <option value="auto">원본 크기</option>
                  </select>
                </div>
                {(backgroundSize === 'cover' || backgroundSize === 'contain') && (
                  <ImagePositionGrid
                    value={backgroundPosition}
                    onChange={(v) => { setBackgroundPosition(v); commitProp('backgroundPosition', v) }}
                  />
                )}
              </>
            )}
          </div>
          <div className="pb-1" />
          <Divider />
        </>
      )}

      {/* 텍스트 */}
      {style.isText && (
        <>
          <SectionLabel>텍스트</SectionLabel>
          <ColorRow
            label="색상"
            value={color}
            onChange={(hex) => { setColor(hex); commitProp('color', hex) }}
          />
          {/* 글꼴 굵기 */}
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">굵기</span>
            <div className="flex gap-0.5">
              {([400, 500, 600, 700] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => { setFontWeight(w); commitProp('fontWeight', w) }}
                  className={cn(
                    'h-7 px-2 rounded-[5px] text-[10px] transition-colors',
                    fontWeight === w
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-muted)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)]'
                  )}
                  style={{ fontWeight: w }}
                >
                  {w === 400 ? 'R' : w === 500 ? 'M' : w === 600 ? 'SB' : 'B'}
                </button>
              ))}
            </div>
          </div>
          {/* 텍스트 정렬 */}
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">정렬</span>
            <div className="flex gap-0.5">
              {([
                { value: 'left', icon: <AlignLeft size={12} /> },
                { value: 'center', icon: <AlignCenter size={12} /> },
                { value: 'right', icon: <AlignRight size={12} /> },
              ] as const).map(({ value, icon }) => (
                <button
                  key={value}
                  onClick={() => { setTextAlign(value); commitProp('textAlign', value) }}
                  className={cn(
                    'w-7 h-7 rounded-[5px] flex items-center justify-center transition-colors',
                    textAlign === value
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-muted)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)]'
                  )}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          {/* 글자 크기 */}
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">글자 크기</span>
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
          {/* 줄 간격 */}
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">줄 간격</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <NumInput
                label=""
                value={parseFloat(lineHeight.toFixed(2))}
                min={0.5}
                max={5}
                onChange={(v) => setLineHeight(v)}
                onCommit={(v) => { setLineHeight(v); commitProp('lineHeight', v) }}
              />
            </div>
          </div>
          {/* 자간 */}
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] w-16 shrink-0">자간</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <NumInput
                label=""
                value={letterSpacing}
                min={-10}
                max={50}
                onChange={(v) => setLetterSpacing(v)}
                onCommit={(v) => { setLetterSpacing(v); commitProp('letterSpacing', v) }}
              />
              <span className="text-[10px] text-[var(--text-disabled)] shrink-0">px</span>
            </div>
          </div>
          <div className="pb-1" />
          <Divider />
        </>
      )}

      {/* 차트 데이터 편집 */}
      {style.isChart && (
        <>
          <SectionLabel>차트 데이터</SectionLabel>
          <div className="px-4 pb-3">
            {chartData ? (
              <div>
                {/* 헤더: 데이터셋 이름 */}
                {chartData.datasetLabels.length > 0 && (
                  <div className="flex gap-1 mb-1.5 items-center">
                    <div className="flex-1 min-w-0 text-[10px] text-[var(--text-disabled)]">레이블</div>
                    {chartData.datasetLabels.map((ds, i) => (
                      <div key={i} className="w-16 text-center text-[10px] text-[var(--text-disabled)] truncate">{ds}</div>
                    ))}
                    <div className="w-5 shrink-0" />
                  </div>
                )}
                {/* 데이터 행 */}
                {chartData.rows.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex gap-1 mb-1 items-center">
                    <input
                      className="flex-1 min-w-0 h-6 px-1.5 rounded-[5px] text-[11px] border border-[var(--border)] bg-transparent focus:outline-none focus:border-[var(--accent)]"
                      value={row.label}
                      onChange={(e) => {
                        const newRows = chartData.rows.map((r, i) => i === rowIdx ? { ...r, label: e.target.value } : r)
                        setChartData({ ...chartData, rows: newRows })
                      }}
                      onBlur={() => dispatchChartUpdate(chartData)}
                    />
                    {chartData.datasetLabels.map((_, dsIdx) => (
                      <input
                        key={dsIdx}
                        type="number"
                        className="w-16 h-6 px-1 rounded-[5px] text-[11px] border border-[var(--border)] bg-transparent text-right focus:outline-none focus:border-[var(--accent)]"
                        value={row.values[dsIdx] ?? 0}
                        onChange={(e) => {
                          const newRows = chartData.rows.map((r, i) => {
                            if (i !== rowIdx) return r
                            const vals = [...r.values]
                            vals[dsIdx] = parseFloat(e.target.value) || 0
                            return { ...r, values: vals }
                          })
                          setChartData({ ...chartData, rows: newRows })
                        }}
                        onBlur={() => dispatchChartUpdate(chartData)}
                      />
                    ))}
                    <button
                      onClick={() => {
                        const newData = { ...chartData, rows: chartData.rows.filter((_, i) => i !== rowIdx) }
                        setChartData(newData)
                        dispatchChartUpdate(newData)
                      }}
                      className="w-5 h-5 shrink-0 flex items-center justify-center rounded text-[var(--text-disabled)] hover:text-red-400 hover:bg-red-50 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {/* 항목 추가 */}
                <button
                  onClick={() => {
                    const newData = {
                      ...chartData,
                      rows: [...chartData.rows, { label: '새 항목', values: chartData.datasetLabels.map(() => 0) }],
                    }
                    setChartData(newData)
                    dispatchChartUpdate(newData)
                  }}
                  className="mt-1 w-full h-6 flex items-center justify-center gap-1 rounded-[5px] border border-dashed border-[var(--border)] text-[10px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:border-[var(--accent)] transition-colors"
                >
                  <Plus size={10} />
                  항목 추가
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-[var(--text-disabled)]">차트 데이터를 파싱할 수 없습니다.</p>
            )}
          </div>
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
                <p
                  className={`text-[11px] text-[var(--text-muted)] mb-2.5 leading-snug cursor-pointer ${expandedSummary ? 'break-words' : 'line-clamp-2'}`}
                  onClick={() => setExpandedSummary(v => !v)}
                  title={expandedSummary ? '접기' : '펼치기'}
                >
                  {activeProposal.agent_name}: {activeProposal.summary || activeProposal.command}
                </p>
                <div className="flex gap-2">
                  <button
                    onMouseEnter={() => previewComponent(id, activeProposal.proposedHtml, activeProposal.html_content ?? undefined)}
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
          변경 내역
          <ChevronDown size={12} className={cn('ml-auto transition-transform', showHistory && 'rotate-180')} />
        </button>
      </div>

      <InlineHistory open={showHistory} componentId={id} />

    </div>
  )
}
