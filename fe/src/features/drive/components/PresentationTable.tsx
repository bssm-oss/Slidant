import { useNavigate } from 'react-router-dom'
import type { Presentation } from '@/shared/types'
import { cn } from '@/shared/lib/utils'
import { MoreHorizontal } from 'lucide-react'

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
}

export default function PresentationTable({ presentations }: { presentations: Presentation[] }) {
  const navigate = useNavigate()
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] overflow-hidden bg-white">
      <div className="grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-2.5 bg-[var(--bg-muted)] border-b border-[var(--border)]">
        {['제목','수정일','슬라이드',''].map((h) => (
          <span key={h} className="text-xs font-semibold text-[var(--text-muted)]">{h}</span>
        ))}
      </div>
      {presentations.map((ppt, i) => (
        <div key={ppt.id} onClick={() => navigate(`/edit/${ppt.id}`)}
          className={cn('grid grid-cols-[1fr_120px_100px_40px] gap-4 px-4 py-3 items-center hover:bg-[var(--bg-muted)] transition-colors cursor-pointer group',
            i !== presentations.length - 1 && 'border-b border-[var(--border)]')}>
          <span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--accent)] transition-colors font-medium">{ppt.title}</span>
          <span className="text-xs text-[var(--text-muted)]">{formatDate(ppt.updatedAt)}</span>
          <span className="text-xs text-[var(--text-muted)]">{ppt.slides.length}장</span>
          <button onClick={e => e.stopPropagation()} className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors cursor-pointer">
            <MoreHorizontal size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
