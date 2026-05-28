import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import type { SlideComponent } from '@/shared/types'

function RenderComponent({ comp, isSelected, onClick }: { comp: SlideComponent; isSelected: boolean; onClick: () => void }) {
  const props = comp.props as Record<string, string | number>
  return (
    <div
      style={{ position: 'absolute', left: comp.position.x, top: comp.position.y, width: comp.size.w, height: comp.size.h, zIndex: comp.zIndex, cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn('transition-all duration-100', isSelected && 'outline outline-2 outline-[var(--accent)] outline-offset-1 rounded-[4px]')}
    >
      {comp.type === 'text' ? (
        <p style={{ fontSize: props.fontSize ?? 16, fontWeight: props.fontWeight ?? 400, color: (props.color as string) ?? '#1A1523', textAlign: (props.align as React.CSSProperties['textAlign']) ?? 'left', lineHeight: 1.4 }}>
          {(props.content as string) ?? ''}
        </p>
      ) : (
        <div className="w-full h-full rounded-[6px] bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-disabled)] text-xs border border-[var(--border)]">
          {comp.type}
        </div>
      )}
    </div>
  )
}

export default function SlideCanvas() {
  const { presentation, currentSlideIndex, selectedComponentId, selectComponent } = useEditorStore()
  const currentSlide = presentation?.slides[currentSlideIndex]
  const SLIDE_W = 960, SLIDE_H = 540

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-muted)] overflow-hidden p-8" onClick={() => selectComponent(null)}>
      <div className="relative bg-white rounded-[8px] shadow-[0_4px_32px_rgba(0,0,0,0.15)] overflow-hidden"
        style={{ width: SLIDE_W * 0.7, height: SLIDE_H * 0.7 }}>
        <div style={{ transform: 'scale(0.7)', transformOrigin: 'top left', width: SLIDE_W, height: SLIDE_H, position: 'absolute', top: 0, left: 0 }}>
          {currentSlide?.components.map(comp => (
            <RenderComponent key={comp.id} comp={comp} isSelected={selectedComponentId === comp.id} onClick={() => selectComponent(comp.id)} />
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
