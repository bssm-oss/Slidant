import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Plus } from 'lucide-react'

export default function ThumbnailBar() {
  const { presentation, currentSlideIndex, setCurrentSlide } = useEditorStore()

  return (
    <div className="h-24 border-t border-[var(--border)] bg-[var(--bg-subtle)] flex items-center gap-2 px-4 overflow-x-auto shrink-0">
      {presentation?.slides.map((slide, i) => (
        <button
          key={slide.id}
          onClick={() => setCurrentSlide(i)}
          className={cn(
            'shrink-0 w-32 h-16 rounded-[8px] border-2 transition-all duration-150 overflow-hidden bg-white cursor-pointer',
            currentSlideIndex === i
              ? 'border-[var(--accent)] shadow-[0_0_12px_rgba(167,139,250,0.4)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]',
          )}
        >
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-gray-300 text-xs">{i + 1}</span>
          </div>
        </button>
      ))}

      <button className="shrink-0 w-32 h-16 rounded-[8px] border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)]/50 flex items-center justify-center transition-colors cursor-pointer group">
        <Plus size={16} className="text-[var(--text-disabled)] group-hover:text-[var(--accent)] transition-colors" />
      </button>
    </div>
  )
}
