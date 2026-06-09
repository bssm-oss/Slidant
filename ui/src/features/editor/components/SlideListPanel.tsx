import { useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useAgentStore, type PresenceUser } from '../store/agentStore'
import { cn } from '@/shared/lib/utils'
import { buildSlideSrc, extractSlideTitle } from '@/shared/lib/slideHtml'
import { Plus, X, Copy, ArrowUp, ArrowDown, MoreHorizontal, RefreshCw } from 'lucide-react'
import type { SlideComponent, Slide } from '@/shared/types'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/shared/components/ui/dropdown-menu'

function MiniComponent({ comp }: { comp: SlideComponent }) {
  const props = comp.props as Record<string, unknown>
  const SCALE = 200 / 960

  if (comp.type === 'shape') {
    return (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        background: (props.bgColor as string) ?? (props.color as string) ?? '#e5e7eb',
        opacity: (props.opacity as number) ?? 1,
        borderRadius: ((props.borderRadius as number) ?? 0) * SCALE,
      }} />
    )
  }
  if (comp.type === 'text') {
    return (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        overflow: 'hidden',
      }}>
        <p style={{
          fontSize: Math.max(2, ((props.fontSize as number) ?? 16) * SCALE),
          fontWeight: (props.fontWeight as number) ?? 400,
          color: (props.color as string) ?? '#1A1523',
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
          margin: 0,
        }}>{(props.content as string) ?? ''}</p>
      </div>
    )
  }
  if (comp.type === 'image') {
    const src = (props.src ?? props.url) as string | undefined
    return src && !props.placeholder ? (
      <img src={src} style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        objectFit: 'cover' as const,
        display: 'block',
      }} alt="" />
    ) : (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        background: 'rgba(124,58,237,0.06)',
      }} />
    )
  }
  return null
}

interface SortableSlideItemProps {
  slide: Slide
  index: number
  isCurrent: boolean
  totalSlides: number
  onSelect: (i: number) => void
  onDelete: (i: number) => void
  onDuplicate: (i: number) => void
  onMoveUp: (i: number) => void
  onMoveDown: (i: number) => void
  onRegenerate: (i: number) => void
  viewers?: PresenceUser[]
}

function SortableSlideItem({
  slide, index, isCurrent, totalSlides,
  onSelect, onDelete, onDuplicate, onMoveUp, onMoveDown, onRegenerate, viewers = [],
}: SortableSlideItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id })

  const sortedComponents = [...slide.components].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  const slideTitle = extractSlideTitle(slide.html_content, slide.title, index)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!menuOpen) setIsHovered(false) }}
    >
      <div className="relative">
      <button
        onClick={() => onSelect(index)}
        {...attributes}
        {...listeners}
        className={cn(
          'w-full aspect-video rounded-[6px] border-2 relative overflow-hidden bg-white transition-all duration-150 cursor-grab active:cursor-grabbing',
          isCurrent
            ? 'border-[var(--accent)] shadow-[0_0_0_2px_var(--accent-subtle)]'
            : 'border-[var(--border)] hover:border-[var(--text-disabled)]',
        )}
      >
        {slide.html_content ? (
          <div style={{ width: 200, height: 112.5, overflow: 'hidden', position: 'absolute', top: 0, left: 0 }}>
            <iframe
              srcDoc={buildSlideSrc(slide.html_content, true)}
              style={{
                width: 960,
                height: 540,
                border: 'none',
                transform: `scale(${200 / 960})`,
                transformOrigin: 'top left',
                display: 'block',
                pointerEvents: 'none',
              }}
              sandbox="allow-scripts allow-same-origin"
              title={`슬라이드 ${index + 1} 미리보기`}
            />
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0 }}>
            {sortedComponents.map((comp) => (
              <MiniComponent key={comp.id} comp={comp} />
            ))}
            {slide.components.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[8px] text-gray-300">빈 슬라이드</span>
              </div>
            )}
          </div>
        )}
        {/* Presence 아바타 */}
        {viewers.length > 0 && (
          <div className="absolute top-1 left-1 flex gap-0.5">
            {viewers.slice(0, 3).map((u) => (
              <div
                key={u.userId}
                title={u.name}
                style={{ background: u.color }}
                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm"
              >
                {u.name?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
        )}
      </button>

      {/* Slide number badge */}
      <div className="absolute bottom-1 right-1 z-10 min-w-[16px] h-[16px] flex items-center justify-center text-[9px] font-bold text-white bg-black/50 rounded-[3px] pointer-events-none px-1 leading-none">
        {index + 1}
      </div>

      {/* Regenerate overlay — bottom-right on hover */}
      {(isHovered || menuOpen) && (
        <div className="absolute bottom-1 left-1 z-10">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRegenerate(index) }}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-black/70 text-white text-[9px] rounded-[4px] hover:bg-black/90 transition-colors"
            title="이 슬라이드 재생성"
          >
            <RefreshCw size={9} />
            재생성
          </button>
        </div>
      )}

      {/* Hover overlay actions */}
      {(isHovered || menuOpen) && (
        <div className="absolute top-1 right-1 flex gap-0.5 z-10">
          <DropdownMenu open={menuOpen} onOpenChange={(v) => { setMenuOpen(v); if (!v) setIsHovered(false) }}>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                className="w-5 h-5 rounded bg-white/90 hover:bg-white border border-[var(--border)] flex items-center justify-center shadow-sm transition-colors"
              >
                <MoreHorizontal size={10} className="text-[var(--text-muted)]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onClick={() => onDuplicate(index)}>
                <Copy size={12} /> 복제
              </DropdownMenuItem>
              {index > 0 && (
                <DropdownMenuItem onClick={() => onMoveUp(index)}>
                  <ArrowUp size={12} /> 위로 이동
                </DropdownMenuItem>
              )}
              {index < totalSlides - 1 && (
                <DropdownMenuItem onClick={() => onMoveDown(index)}>
                  <ArrowDown size={12} /> 아래로 이동
                </DropdownMenuItem>
              )}
              {totalSlides > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(index)}
                    className="text-red-500 focus:text-red-500 focus:bg-red-50"
                  >
                    <X size={12} /> 삭제
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      </div>
      <p className="mt-0.5 px-1 text-[10px] leading-tight text-[var(--text-muted)] truncate" title={slideTitle}>
        {slideTitle}
      </p>
    </div>
  )
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0, scaleX: 1, scaleY: 1 })

function SkeletonSlideItem({ index }: { index: number }) {
  return (
    <div className="relative shrink-0">
      <div className="w-full aspect-video rounded-[6px] border-2 border-[var(--border)] overflow-hidden bg-[var(--bg-muted)] animate-pulse">
        <div className="absolute inset-0 flex flex-col gap-2 p-2 justify-center items-center opacity-30">
          <div className="h-2 w-3/4 rounded bg-gray-300" />
          <div className="h-1.5 w-1/2 rounded bg-gray-300" />
          <div className="h-1.5 w-2/3 rounded bg-gray-300" />
        </div>
      </div>
      <div className="absolute bottom-1 right-1 z-10 min-w-[16px] h-[16px] flex items-center justify-center text-[9px] font-bold text-white bg-black/50 rounded-[3px] pointer-events-none px-1 leading-none">
        {index + 1}
      </div>
    </div>
  )
}

export default function SlideListPanel() {
  const {
    presentation, currentSlideIndex,
    setCurrentSlide, addSlide, deleteSlide, duplicateSlide, reorderSlides,
  } = useEditorStore()
  const { presenceUsers, pendingSlideCount } = useAgentStore()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !presentation) return
    const oldIndex = presentation.slides.findIndex((s) => s.id === active.id)
    const newIndex = presentation.slides.findIndex((s) => s.id === over.id)
    if (!isViewer && oldIndex !== -1 && newIndex !== -1) reorderSlides(oldIndex, newIndex)
  }, [presentation, reorderSlides])

  const handleRegenerate = useCallback((slideIndex: number) => {
    const { sendMessage } = useAgentStore.getState()
    sendMessage(`@슬라이드${slideIndex + 1} 다시 생성해줘`)
  }, [])

  const slides = presentation?.slides ?? []
  const isViewer = presentation?.myRole === 'viewer'

  return (
    <div className="w-52 border-r border-[var(--border)] bg-white flex flex-col shrink-0 overflow-hidden h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">슬라이드</span>
        <span className="text-[11px] font-medium text-[var(--text-disabled)]">{slides.length}</span>
      </div>

      {/* Slide list */}
      <div className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {slides.map((slide, i) => (
              <SortableSlideItem
                key={slide.id}
                slide={slide}
                index={i}
                viewers={presenceUsers.filter((u) => u.currentSlide === i)}
                isCurrent={currentSlideIndex === i}
                totalSlides={slides.length}
                onSelect={setCurrentSlide}
                onDelete={isViewer ? () => {} : deleteSlide}
                onDuplicate={isViewer ? () => {} : duplicateSlide}
                onMoveUp={isViewer ? () => {} : (idx) => reorderSlides(idx, idx - 1)}
                onMoveDown={isViewer ? () => {} : (idx) => reorderSlides(idx, idx + 1)}
                onRegenerate={handleRegenerate}
              />
            ))}
          </SortableContext>
        </DndContext>
        {/* 생성 대기 중인 슬라이드 스켈레톤 */}
        {Array.from({ length: pendingSlideCount }).map((_, i) => (
          <SkeletonSlideItem key={`skeleton-${i}`} index={slides.length + i} />
        ))}
      </div>

      {/* Add slide button */}
      <div className="px-2 py-2 shrink-0 border-t border-[var(--border)]">
        <button
          onClick={isViewer ? undefined : addSlide}
          disabled={isViewer}
          className={`w-full py-1.5 rounded-[6px] border border-dashed border-[var(--border)] flex items-center justify-center gap-1.5 transition-all duration-150 ${isViewer ? 'opacity-30 cursor-not-allowed' : 'hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] cursor-pointer group'}`}
        >
          <Plus size={13} className="text-[var(--text-disabled)] group-hover:text-[var(--accent)] transition-colors" />
          <span className="text-[11px] text-[var(--text-disabled)] group-hover:text-[var(--accent)] transition-colors">슬라이드 추가</span>
        </button>
      </div>
    </div>
  )
}
