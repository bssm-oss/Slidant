import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import type { SlideComponent } from '@/shared/types'

function RenderComponent({
  comp,
  isSelected,
  onClick,
}: {
  comp: SlideComponent
  isSelected: boolean
  onClick: () => void
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: comp.position.x,
    top: comp.position.y,
    width: comp.size.w,
    height: comp.size.h,
    zIndex: comp.zIndex,
    cursor: 'pointer',
  }

  const props = comp.props as Record<string, string | number>

  return (
    <div
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'transition-all duration-100',
        isSelected && 'outline outline-2 outline-[var(--accent)] outline-offset-1 rounded-[4px]',
      )}
    >
      {comp.type === 'text' && (
        <p
          style={{
            fontSize: props.fontSize ?? 16,
            fontWeight: props.fontWeight ?? 400,
            color: (props.color as string) ?? '#111013',
            textAlign: (props.align as React.CSSProperties['textAlign']) ?? 'left',
            lineHeight: 1.4,
          }}
        >
          {(props.content as string) ?? ''}
        </p>
      )}
      {comp.type !== 'text' && (
        <div className="w-full h-full rounded-[6px] bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
          {comp.type}
        </div>
      )}
    </div>
  )
}

export default function SlideCanvas() {
  const { presentation, currentSlideIndex, selectedComponentId, selectComponent } = useEditorStore()
  const currentSlide = presentation?.slides[currentSlideIndex]

  // 16:9 슬라이드 비율 (960x540 기준)
  const SLIDE_W = 960
  const SLIDE_H = 540

  return (
    <div
      className="flex-1 flex items-center justify-center bg-[var(--bg)] overflow-hidden p-8"
      onClick={() => selectComponent(null)}
    >
      <div
        className="relative bg-white rounded-[8px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden"
        style={{ width: SLIDE_W * 0.7, height: SLIDE_H * 0.7 }}
      >
        {/* 슬라이드 내부 — 0.7x 스케일 */}
        <div
          style={{
            transform: 'scale(0.7)',
            transformOrigin: 'top left',
            width: SLIDE_W,
            height: SLIDE_H,
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          {currentSlide?.components.map((comp) => (
            <RenderComponent
              key={comp.id}
              comp={comp}
              isSelected={selectedComponentId === comp.id}
              onClick={() => selectComponent(comp.id)}
            />
          ))}

          {(!currentSlide || currentSlide.components.length === 0) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-300 text-lg">빈 슬라이드</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
