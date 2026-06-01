import { useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Plus, X, Copy, ArrowUp, ArrowDown, MoreHorizontal } from 'lucide-react'
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
  const SCALE = 180 / 960

  return (
    <div style={{
      position: 'absolute',
      left: comp.position.x * SCALE,
      top: comp.position.y * SCALE,
      width: comp.size.w * SCALE,
      height: comp.size.h * SCALE,
      overflow: 'hidden',
    }}>
      {comp.type === 'text' ? (
        <p style={{
          fontSize: Math.max(3, ((props.fontSize as number) ?? 16) * SCALE),
          fontWeight: (props.fontWeight as number) ?? 400,
          color: (props.color as string) ?? '#1A1523',
          lineHeight: 1.3,
          whiteSpace: 'pre-wrap',
          overflow: 'hidden',
        }}>
          {(props.content as string) ?? ''}
        </p>
      ) : (
        <div style={{ width: '100%', height: '100%', background: '#e5e7eb', borderRadius: 2 }} />
      )}
    </div>
  )
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
}

function SortableSlideItem({
  slide, index, isCurrent, totalSlides,
  onSelect, onDelete, onDuplicate, onMoveUp, onMoveDown,
}: SortableSlideItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="relative shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!menuOpen) setIsHovered(false) }}
    >
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
        <div style={{ position: 'absolute', inset: 0 }}>
          {slide.components.map((comp) => (
            <MiniComponent key={comp.id} comp={comp} />
          ))}
          {slide.components.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[8px] text-gray-300">빈 슬라이드</span>
            </div>
          )}
        </div>
        <div className="absolute bottom-0.5 right-1 text-[9px] font-medium text-[var(--text-disabled)]">{index + 1}</div>
      </button>

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
  )
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0, scaleX: 1, scaleY: 1 })

export default function SlideListPanel() {
  const {
    presentation, currentSlideIndex,
    setCurrentSlide, addSlide, deleteSlide, duplicateSlide, reorderSlides,
  } = useEditorStore()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !presentation) return
    const oldIndex = presentation.slides.findIndex((s) => s.id === active.id)
    const newIndex = presentation.slides.findIndex((s) => s.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) reorderSlides(oldIndex, newIndex)
  }, [presentation, reorderSlides])

  const slides = presentation?.slides ?? []

  return (
    <div className="w-44 border-r border-[var(--border)] bg-[var(--bg-muted)] flex flex-col shrink-0 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--border)] shrink-0">
        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">슬라이드</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {slides.map((slide, i) => (
              <SortableSlideItem
                key={slide.id}
                slide={slide}
                index={i}
                isCurrent={currentSlideIndex === i}
                totalSlides={slides.length}
                onSelect={setCurrentSlide}
                onDelete={deleteSlide}
                onDuplicate={duplicateSlide}
                onMoveUp={(idx) => reorderSlides(idx, idx - 1)}
                onMoveDown={(idx) => reorderSlides(idx, idx + 1)}
              />
            ))}
          </SortableContext>
        </DndContext>

        <button
          onClick={addSlide}
          className="shrink-0 w-full aspect-video rounded-[6px] border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] flex items-center justify-center transition-all duration-150 cursor-pointer group"
        >
          <Plus size={14} className="text-[var(--text-disabled)] group-hover:text-[var(--accent)] transition-colors" />
        </button>
      </div>
    </div>
  )
}
