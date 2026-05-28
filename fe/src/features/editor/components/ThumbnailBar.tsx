import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Plus } from 'lucide-react'

export default function ThumbnailBar() {
  const { presentation, currentSlideIndex, setCurrentSlide, addSlide } = useEditorStore()
  return (
    <div className="h-24 border-t border-[var(--border)] bg-white flex items-center gap-2 px-4 overflow-x-auto shrink-0">
      {presentation?.slides.map((slide, i) => (
        <button key={slide.id} onClick={() => setCurrentSlide(i)}
          className={cn(
            'shrink-0 w-32 h-16 rounded-[8px] border-2 transition-all duration-150 overflow-hidden bg-[var(--bg)] cursor-pointer',
            currentSlideIndex === i
              ? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-subtle)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]',
          )}>
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[var(--text-disabled)] text-xs font-medium">{i + 1}</span>
          </div>
        </button>
      ))}
      <button
        onClick={addSlide}
        className="shrink-0 w-32 h-16 rounded-[8px] border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] flex items-center justify-center transition-all duration-150 cursor-pointer group"
      >
        <Plus size={16} className="text-[var(--text-disabled)] group-hover:text-[var(--accent)] transition-colors" />
      </button>
    </div>
  )
}
