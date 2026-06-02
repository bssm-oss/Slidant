import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import type { Presentation } from '@/shared/types'
import SlideThumbnail from './SlideThumbnail'

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
}

export default function PresentationCard({ presentation }: { presentation: Presentation; index?: number }) {
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate(`/edit/${presentation.id}`)}
      className={cn(
        'group flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-white overflow-hidden text-left cursor-pointer w-full',
        'hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:border-[var(--border-strong)] hover:-translate-y-0.5',
        'transition-all duration-200',
      )}>
      {/* 슬라이드 썸네일 */}
      <div className="relative border-b border-[var(--border)]">
        <SlideThumbnail projectId={presentation.id} />
      </div>
      {/* 카드 정보 */}
      <div className="p-4">
        <p className="text-base font-semibold text-[var(--text)] truncate">{presentation.title}</p>
        <p className="text-sm text-[var(--text-disabled)] mt-1">{formatDate(presentation.updatedAt)}</p>
      </div>
    </button>
  )
}
