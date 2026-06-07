import { useEffect, useRef, useCallback } from 'react'
import type { HtmlComponentStyle } from './SlideCanvas'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: { id: HandleId; cursor: string; pos: React.CSSProperties }[] = [
  { id: 'nw', cursor: 'nw-resize', pos: { top: -4, left: -4 } },
  { id: 'n',  cursor: 'n-resize',  pos: { top: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'ne', cursor: 'ne-resize', pos: { top: -4, right: -4 } },
  { id: 'e',  cursor: 'e-resize',  pos: { top: '50%', right: -4, transform: 'translateY(-50%)' } },
  { id: 'se', cursor: 'se-resize', pos: { bottom: -4, right: -4 } },
  { id: 's',  cursor: 's-resize',  pos: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'sw', cursor: 'sw-resize', pos: { bottom: -4, left: -4 } },
  { id: 'w',  cursor: 'w-resize',  pos: { top: '50%', left: -4, transform: 'translateY(-50%)' } },
]

const SLIDE_W = 960
const SLIDE_H = 540
const MIN_SIZE = 20

interface Props {
  style: HtmlComponentStyle
  scale: number
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onDelete: () => void
}

function dispatchStyleUpdate(componentId: string, prop: string, value: string | number) {
  window.dispatchEvent(new CustomEvent('html-component-style-update', {
    detail: { componentId, prop, value },
  }))
}

export default function SelectionOverlay({ style, scale, iframeRef, onDelete }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef(style)
  const liveRef = useRef({ left: style.left, top: style.top, w: style.width, h: style.height })
  const dragRef = useRef<{
    handle: HandleId | 'move'
    startMX: number; startMY: number
    startLeft: number; startTop: number; startW: number; startH: number
  } | null>(null)

  // Always keep styleRef current
  useEffect(() => { styleRef.current = style })

  // Sync overlay position when style changes (but not during active drag)
  useEffect(() => {
    if (dragRef.current) return
    liveRef.current = { left: style.left, top: style.top, w: style.width, h: style.height }
    const el = overlayRef.current
    if (el) {
      el.style.left = `${style.left * scale}px`
      el.style.top = `${style.top * scale}px`
      el.style.width = `${style.width * scale}px`
      el.style.height = `${style.height * scale}px`
    }
  }, [style.componentId, style.left, style.top, style.width, style.height, scale])

  const getIframeEl = useCallback(() =>
    iframeRef.current?.contentDocument?.querySelector<HTMLElement>(
      `[data-component-id="${styleRef.current.componentId}"]`
    ), [iframeRef])

  const startDrag = useCallback((e: React.MouseEvent, handle: HandleId | 'move') => {
    e.preventDefault()
    e.stopPropagation()
    const { left, top, w, h } = liveRef.current
    dragRef.current = { handle, startMX: e.clientX, startMY: e.clientY, startLeft: left, startTop: top, startW: w, startH: h }
  }, [])

  // Global drag + resize handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.startMX) / scale
      const dy = (e.clientY - d.startMY) / scale
      let { startLeft: left, startTop: top, startW: w, startH: h } = d
      if (d.handle === 'move') {
        left = Math.max(0, Math.min(SLIDE_W - w, d.startLeft + dx))
        top = Math.max(0, Math.min(SLIDE_H - h, d.startTop + dy))
      } else {
        const dir = d.handle
        if (dir.includes('e')) w = Math.max(MIN_SIZE, d.startW + dx)
        if (dir.includes('s')) h = Math.max(MIN_SIZE, d.startH + dy)
        if (dir.includes('w')) { w = Math.max(MIN_SIZE, d.startW - dx); left = d.startLeft + d.startW - w }
        if (dir.includes('n')) { h = Math.max(MIN_SIZE, d.startH - dy); top = d.startTop + d.startH - h }
      }
      liveRef.current = { left, top, w, h }
      const ov = overlayRef.current
      if (ov) {
        ov.style.left = `${left * scale}px`
        ov.style.top = `${top * scale}px`
        ov.style.width = `${w * scale}px`
        ov.style.height = `${h * scale}px`
      }
      // Live preview in iframe
      const el = getIframeEl()
      if (el) {
        el.style.left = `${left}px`
        el.style.top = `${top}px`
        el.style.width = `${w}px`
        el.style.height = `${h}px`
      }
    }

    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      const { left, top, w, h } = liveRef.current
      const id = styleRef.current.componentId
      // Batch dispatch — each call updates DOM and debounces save; last debounce wins
      dispatchStyleUpdate(id, 'left', Math.round(left))
      dispatchStyleUpdate(id, 'top', Math.round(top))
      dispatchStyleUpdate(id, 'width', Math.round(w))
      dispatchStyleUpdate(id, 'height', Math.round(h))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [scale, getIframeEl])

  // Keyboard shortcuts (only active when focus is in outer window, not inside iframe)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if ((e.target as HTMLElement).isContentEditable) return
      const id = styleRef.current.componentId
      if (!id) return
      const step = e.shiftKey ? 10 : 1
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          onDelete()
          break
        case 'ArrowLeft': {
          e.preventDefault()
          const l = Math.max(0, liveRef.current.left - step)
          liveRef.current.left = l
          dispatchStyleUpdate(id, 'left', Math.round(l))
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const l = Math.min(SLIDE_W - liveRef.current.w, liveRef.current.left + step)
          liveRef.current.left = l
          dispatchStyleUpdate(id, 'left', Math.round(l))
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const t = Math.max(0, liveRef.current.top - step)
          liveRef.current.top = t
          dispatchStyleUpdate(id, 'top', Math.round(t))
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const t = Math.min(SLIDE_H - liveRef.current.h, liveRef.current.top + step)
          liveRef.current.top = t
          dispatchStyleUpdate(id, 'top', Math.round(t))
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDelete])

  // Forward double-click into iframe for text editing
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = getIframeEl()
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  }

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        left: style.left * scale,
        top: style.top * scale,
        width: style.width * scale,
        height: style.height * scale,
        outline: '2px solid var(--accent)',
        outlineOffset: '1px',
        zIndex: 20,
        cursor: 'move',
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => startDrag(e, 'move')}
      onDoubleClick={handleDoubleClick}
      onClick={(e) => e.stopPropagation()}
    >
      {HANDLES.map((h) => (
        <div
          key={h.id}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            background: 'white',
            border: '2px solid var(--accent)',
            borderRadius: 2,
            cursor: h.cursor,
            zIndex: 21,
            pointerEvents: 'auto',
            ...h.pos,
          }}
          onMouseDown={(e) => { e.stopPropagation(); startDrag(e, h.id) }}
        />
      ))}
    </div>
  )
}
