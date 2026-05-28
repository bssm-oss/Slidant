import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { Layers, Type, Image, BarChart2, Layout, Square } from 'lucide-react'
import type { ComponentType } from '@/shared/types'

const typeIcons: Record<ComponentType, React.ReactNode> = {
  text: <Type size={12} />,
  image: <Image size={12} />,
  chart: <BarChart2 size={12} />,
  layout: <Layout size={12} />,
  shape: <Square size={12} />,
}

export default function LayerSidebar() {
  const { presentation, currentSlideIndex, selectedComponentId, selectComponent } = useEditorStore()
  const currentSlide = presentation?.slides[currentSlideIndex]

  return (
    <div className="w-52 border-r border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
        <Layers size={13} className="text-[var(--text-muted)]" />
        <span className="text-xs font-medium text-[var(--text-muted)]">레이어</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {currentSlide?.components.length === 0 && (
          <p className="text-xs text-[var(--text-disabled)] px-3 py-4 text-center">
            컴포넌트 없음
          </p>
        )}
        {currentSlide?.components.map((comp) => (
          <button
            key={comp.id}
            onClick={() => selectComponent(comp.id)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors cursor-pointer',
              selectedComponentId === comp.id
                ? 'bg-[var(--accent-subtle)] text-[var(--accent-text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)]',
            )}
          >
            <span className="shrink-0 opacity-60">{typeIcons[comp.type]}</span>
            <span className="truncate">{comp.type} #{comp.id.slice(-4)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
