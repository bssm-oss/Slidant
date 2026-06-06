import { useState, useEffect, useRef, useCallback } from 'react'
import { History } from 'lucide-react'
import type { HtmlComponentStyle } from './SlideCanvas'

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
}

function NumInput({ label, value, onChange, onCommit, min = -9999 }: NumInputProps) {
  const [local, setLocal] = useState(String(Math.round(value)))

  useEffect(() => {
    setLocal(String(Math.round(value)))
  }, [value])

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <span className="text-[10px] text-[var(--text-disabled)] w-3 shrink-0 select-none">{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        className="
          flex-1 min-w-0 h-7 px-2 rounded-[6px] text-[12px] text-[var(--text)]
          bg-[var(--bg-muted)] border border-[var(--border)]
          focus:outline-none focus:border-[var(--accent)] focus:bg-[var(--bg)]
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
        "
        onChange={(e) => {
          setLocal(e.target.value)
          const n = parseFloat(e.target.value)
          if (!isNaN(n)) onChange(Math.max(min, n))
        }}
        onBlur={() => {
          const n = parseFloat(local)
          if (!isNaN(n)) onCommit(Math.max(min, n))
          else setLocal(String(Math.round(value)))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp') { e.preventDefault(); const n = value + 1; onChange(n); onCommit(n) }
          if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.max(min, value - 1); onChange(n); onCommit(n) }
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

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  style: HtmlComponentStyle
  onOpenHistory: () => void
}

export default function ComponentInspector({ style, onOpenHistory }: Props) {
  // Local state mirrors style — updated on commit
  const [pos, setPos] = useState({ x: style.left, y: style.top })
  const [size, setSize] = useState({ w: style.width, h: style.height })
  const [opacity, setOpacity] = useState(Math.round(style.opacity * 100))
  const [color, setColor] = useState(style.color)
  const [bgColor, setBgColor] = useState(style.backgroundColor)
  const [fontSize, setFontSize] = useState(style.fontSize)

  // Sync when a different component is selected
  useEffect(() => {
    setPos({ x: style.left, y: style.top })
    setSize({ w: style.width, h: style.height })
    setOpacity(Math.round(style.opacity * 100))
    setColor(style.color)
    setBgColor(style.backgroundColor)
    setFontSize(style.fontSize)
  }, [style.componentId])

  const id = style.componentId

  const commitProp = useCallback((prop: string, value: string | number) => {
    dispatch(id, prop, value)
  }, [id])

  return (
    <div className="flex flex-col text-[var(--text)] select-none overflow-y-auto">

      {/* Component ID tag */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <span className="text-[10px] font-mono text-[var(--text-disabled)] bg-[var(--bg-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded-[4px] max-w-full truncate">
          {id}
        </span>
        <span className="text-[10px] text-[var(--text-disabled)] shrink-0">{style.tagName}</span>
      </div>

      <Divider />

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
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          className="flex-1 h-1 accent-[var(--accent)]"
          onChange={(e) => {
            const v = parseInt(e.target.value)
            setOpacity(v)
            commitProp('opacity', v / 100)
          }}
        />
        <div className="flex items-center gap-0.5 w-14 h-7 px-2 rounded-[6px] bg-[var(--bg-muted)] border border-[var(--border)] focus-within:border-[var(--accent)]">
          <input
            type="number"
            min={0}
            max={100}
            value={opacity}
            className="w-full text-[12px] text-[var(--text)] bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            onChange={(e) => {
              const v = Math.min(100, Math.max(0, parseInt(e.target.value) || 0))
              setOpacity(v)
              commitProp('opacity', v / 100)
            }}
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

      {/* Version History */}
      <div className="px-4 py-3">
        <button
          onClick={onOpenHistory}
          className="w-full flex items-center justify-center gap-2 h-8 rounded-[8px] text-[12px] font-medium text-[var(--text-muted)] border border-[var(--border)] bg-[var(--bg-muted)] hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors"
        >
          <History size={13} />
          슬라이드 변경 내역
        </button>
      </div>

    </div>
  )
}
