import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import type { Presentation } from '@/shared/types'
import SlideThumbnail from './SlideThumbnail'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '어제'
  if (diffDays < 7) return diffDays + '일 전'
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0')
}

export default function PresentationCard({ presentation }: { presentation: Presentation; index?: number }) {
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate(`/edit/${presentation.id}`)}
      className={cn(
        'group flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white text-left shadow-[var(--shadow-soft)]',
        'hover:border-[var(--border-strong)] hover:shadow-[0_12px_28px_rgba(15,23,42,0.10)]',
        'transition-all duration-200',
      )}>
      {/* 슬라이드 썸네일 */}
      <div className="relative border-b border-[var(--border)] bg-[var(--bg-muted)]">
        <SlideThumbnail projectId={presentation.id} />
        <div className="absolute bottom-2 right-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] shadow-sm ring-1 ring-[var(--border)]">
          {presentation.slideCount ?? presentation.slides.length}
        </div>
      </div>
      {/* 카드 정보 */}
      <div className="p-3.5">
        <p className="truncate text-[14px] font-semibold text-[var(--text)] group-hover:text-[var(--accent-text)]">{presentation.title}</p>
        <p className="mt-1 text-[12px] text-[var(--text-disabled)]">{formatDate(presentation.updatedAt)}</p>
      </div>
    </button>
  )
}
