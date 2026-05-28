import { useNavigate } from 'react-router-dom'
import type { Presentation } from '@/shared/types'
import { cn } from '@/shared/lib/utils'
import { MoreHorizontal } from 'lucide-react'

interface PresentationTableProps {
  presentations: Presentation[]
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function PresentationTable({ presentations }: PresentationTableProps) {
  const navigate = useNavigate()

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
      {/* 헤더 */}
      <div className="grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-2.5 bg-[var(--bg-muted)] border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-muted)]">제목</span>
        <span className="text-xs font-medium text-[var(--text-muted)]">수정일</span>
        <span className="text-xs font-medium text-[var(--text-muted)]">슬라이드</span>
        <span />
      </div>

      {/* 행 */}
      {presentations.map((ppt, i) => (
        <div
          key={ppt.id}
          className={cn(
            'grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-3 items-center',
            'hover:bg-[var(--bg-muted)] transition-colors cursor-pointer group',
            i !== presentations.length - 1 && 'border-b border-[var(--border)]',
          )}
          onClick={() => navigate(`/edit/${ppt.id}`)}
        >
          <span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--accent)] transition-colors">
            {ppt.title}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{formatDate(ppt.updatedAt)}</span>
          <span className="text-xs text-[var(--text-muted)]">{ppt.slides.length}장</span>
          <button
            onClick={(e) => e.stopPropagation()}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
