import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import type { Presentation } from '@/shared/types'

interface PresentationCardProps {
  presentation: Presentation
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function PresentationCard({ presentation }: PresentationCardProps) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/edit/${presentation.id}`)}
      className={cn(
        'group flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-subtle)]',
        'hover:border-[var(--accent)]/40 hover:shadow-[0_4px_20px_rgba(0,0,0,0.4),0_0_0_1px_rgba(167,139,250,0.12)]',
        'transition-all duration-200 overflow-hidden text-left cursor-pointer w-full',
      )}
    >
      {/* 슬라이드 프리뷰 영역 */}
      <div className="aspect-video bg-white flex items-center justify-center relative overflow-hidden">
        {/* 그라데이션 오버레이 */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-subtle)]/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        <span className="text-gray-300 text-sm">{presentation.slides.length}장</span>
      </div>

      {/* 카드 정보 */}
      <div className="p-3">
        <p className="text-sm font-medium text-[var(--text)] truncate">{presentation.title}</p>
        <p className="text-xs text-[var(--text-disabled)] mt-1">{formatDate(presentation.updatedAt)}</p>
      </div>
    </button>
  )
}
