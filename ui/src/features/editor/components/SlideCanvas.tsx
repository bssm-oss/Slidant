import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import type { SlideComponent } from '@/shared/types'

const SLIDE_W = 960
const SLIDE_H = 540

function RenderComponent({ comp, isSelected, onClick }: {
  comp: SlideComponent
  isSelected: boolean
  onClick: () => void
}) {
  const props = comp.props as Record<string, unknown>
  return (
    <div
      style={{
        position: 'absolute',
        left: comp.position.x,
        top: comp.position.y,
        width: comp.size.w,
        height: comp.size.h,
        zIndex: comp.zIndex,
        cursor: 'pointer',
      }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        'transition-all duration-100',
        isSelected && 'outline outline-2 outline-[var(--accent)] outline-offset-2 rounded-[4px]',
      )}
    >
      {comp.type === 'text' ? (
        <p style={{
          fontSize: (props.fontSize as number) ?? 16,
          fontWeight: (props.fontWeight as number) ?? 400,
          color: (props.color as string) ?? '#1A1523',
          textAlign: (props.align as React.CSSProperties['textAlign']) ?? 'left',
          lineHeight: 1.4,
          userSelect: 'none',
        }}>
          {(props.content as string) ?? ''}
        </p>
      ) : (
        <div
          style={{ background: (props.bgColor as string) ?? undefined }}
          className="w-full h-full rounded-[6px] bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-disabled)] text-sm border border-[var(--border)]"
        >
          {comp.type}
        </div>
      )}
    </div>
  )
}

export default function SlideCanvas() {
  const { presentation, currentSlideIndex, selectedComponentId, selectComponent } = useEditorStore()
  const currentSlide = presentation?.slides[currentSlideIndex]
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.75)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const padding = 64
      const maxW = width - padding
      const maxH = height - padding
      const s = Math.min(maxW / SLIDE_W, maxH / SLIDE_H)
      setScale(Math.max(0.3, Math.min(s, 1.2)))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden"
      onClick={() => selectComponent(null)}
    >
      <div
        className="relative bg-white rounded-[8px] shadow-[0_8px_40px_rgba(0,0,0,0.18)] overflow-hidden shrink-0"
        style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}
      >
        <div style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: SLIDE_W,
          height: SLIDE_H,
          position: 'absolute',
          top: 0,
          left: 0,
        }}>
          {currentSlide?.components.map((comp) => (
            <RenderComponent
              key={comp.id}
              comp={comp}
              isSelected={selectedComponentId === comp.id}
              onClick={() => selectComponent(comp.id)}
            />
          ))}
          {(!currentSlide || currentSlide.components.length === 0) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <p className="text-gray-200 text-xl font-light">빈 슬라이드</p>
              <p className="text-gray-300 text-sm">오른쪽 Agent에게 요청하세요</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
