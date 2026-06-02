import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Slide, SlideComponent } from '@/shared/types'
import { type CSSProperties, useRef, useState } from 'react'

// ---- minimal JSON renderer (same logic as SlideCanvas) ----

function SlideComp({ comp }: { comp: SlideComponent }) {
  const props = comp.props as Record<string, unknown>

  if (comp.type === 'text') {
    return (
      <p style={{
        fontSize: (props.fontSize as number) ?? 16,
        fontWeight: (props.fontWeight as number) ?? 400,
        color: (props.color as string) ?? '#1A1523',
        textAlign: (props.align as CSSProperties['textAlign']) ?? 'left',
        lineHeight: (props.lineHeight as number) ?? 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        width: '100%', height: '100%',
        margin: 0, padding: 0,
        overflow: 'hidden',
        userSelect: 'none',
      }}>
        {(props.content as string) ?? ''}
      </p>
    )
  }

  if (comp.type === 'shape') {
    return (
      <div style={{
        width: '100%', height: '100%',
        background: (props.bgColor as string) ?? (props.color as string) ?? '#e5e7eb',
        borderRadius: (props.borderRadius as number) ?? 0,
        opacity: (props.opacity as number) ?? 1,
      }} />
    )
  }

  if (comp.type === 'image') {
    const src = (props.src ?? props.url) as string | undefined
    if (!src || props.placeholder) {
      return (
        <div style={{
          width: '100%', height: '100%',
          background: '#EAF2FF',
          borderRadius: (props.borderRadius as number) ?? 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="#93B4F6" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
        </div>
      )
    }
    return (
      <img src={src} alt="" style={{
        width: '100%', height: '100%',
        objectFit: (props.objectFit as CSSProperties['objectFit']) ?? 'cover',
        borderRadius: (props.borderRadius as number) ?? 0,
        opacity: (props.opacity as number) ?? 1,
        display: 'block',
        pointerEvents: 'none',
      }} />
    )
  }

  return null
}

function SlideView({ slide }: { slide: Slide }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const calc = () => {
      const { clientWidth, clientHeight } = el
      const scaleX = clientWidth / 960
      const scaleY = clientHeight / 540
      setScale(Math.min(scaleX, scaleY))
    }
    calc()
    const obs = new ResizeObserver(calc)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const sorted = [...slide.components].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {slide.html_content ? (
        <div style={{ width: 960 * scale, height: 540 * scale, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
          <iframe
            srcDoc={slide.html_content}
            style={{
              width: 960,
              height: 540,
              border: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              display: 'block',
              pointerEvents: 'none',
            }}
            sandbox="allow-same-origin"
            title="슬라이드"
          />
        </div>
      ) : (
        <div style={{
          width: 960 * scale,
          height: 540 * scale,
          position: 'relative',
          background: '#fff',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: 960, height: 540,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}>
            {sorted.map((comp) => (
              <div key={comp.id} style={{
                position: 'absolute',
                left: comp.position.x, top: comp.position.y,
                width: comp.size.w, height: comp.size.h,
                zIndex: comp.zIndex,
                overflow: 'hidden',
              }}>
                <SlideComp comp={comp} />
              </div>
            ))}
            {slide.components.length === 0 && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 18, color: '#94a3b8' }}>빈 슬라이드</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- PresentationMode overlay ----

interface PresentationModeProps {
  slides: Slide[]
  startIndex: number
  onClose: () => void
}

export default function PresentationMode({ slides, startIndex, onClose }: PresentationModeProps) {
  const [current, setCurrent] = useState(startIndex)

  const goNext = useCallback(() => {
    setCurrent((i) => Math.min(i + 1, slides.length - 1))
  }, [slides.length])

  const goPrev = useCallback(() => {
    setCurrent((i) => Math.max(i - 1, 0))
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev, onClose])

  const slide = slides[current]

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#000',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Main slide area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {slide && <SlideView slide={slide} />}

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            width: 36, height: 36,
            background: 'rgba(255,255,255,0.12)',
            border: 'none', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.24)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)' }}
          title="발표 종료 (ESC)"
        >
          <X size={18} />
        </button>

        {/* Prev arrow */}
        {current > 0 && (
          <button
            onClick={goPrev}
            style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
              width: 40, height: 40,
              background: 'rgba(255,255,255,0.12)',
              border: 'none', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.24)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)' }}
            title="이전 슬라이드 (←)"
          >
            <ChevronLeft size={22} />
          </button>
        )}

        {/* Next arrow */}
        {current < slides.length - 1 && (
          <button
            onClick={goNext}
            style={{
              position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
              width: 40, height: 40,
              background: 'rgba(255,255,255,0.12)',
              border: 'none', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.24)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)' }}
            title="다음 슬라이드 (→)"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8,
      }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            style={{
              width: i === current ? 20 : 8,
              height: 8,
              borderRadius: 4,
              border: 'none',
              background: i === current ? '#fff' : 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              padding: 0,
              transition: 'all 0.2s',
            }}
            title={`슬라이드 ${i + 1}`}
          />
        ))}
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>
          {current + 1} / {slides.length}
        </span>
      </div>
    </div>
  )
}
