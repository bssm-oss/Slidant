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
        'group flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-white overflow-hidden text-left cursor-pointer w-full',
        'hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-[var(--border-strong)] hover:-translate-y-0.5 hover:scale-[1.01]',
        'transition-all duration-200',
      )}>
      {/* 슬라이드 썸네일 */}
      <div className="relative border-b border-[var(--border)]">
        <SlideThumbnail projectId={presentation.id} />
        <div className="absolute bottom-2 right-2 bg-[var(--text)] text-white text-xs font-medium rounded-full px-2 py-1">
          {presentation.slideCount ?? presentation.slides.length}
        </div>
      </div>
      {/* 카드 정보 */}
      <div className="p-4">
        <p className="text-base font-semibold text-[var(--text)] truncate">{presentation.title}</p>
        <p className="text-sm text-[var(--text-disabled)] mt-1">{formatDate(presentation.updatedAt)}</p>
      </div>
    </button>
  )
}
