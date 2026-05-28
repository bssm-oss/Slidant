import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Presentation } from '@/shared/types'
import { cn } from '@/shared/lib/utils'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useDriveStore } from '../store/driveStore'
import { useToastStore } from '@/shared/components/ui/Toast'

function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
}

export default function PresentationTable({ presentations }: { presentations: Presentation[] }) {
  const navigate = useNavigate()
  const { deletePresentation, renamePresentation } = useDriveStore()
  const toast = useToastStore((s) => s.push)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (ppt: Presentation) => {
    setRenamingId(ppt.id)
    setRenameValue(ppt.title)
    setMenuOpenId(null)
  }

  const submitRename = (id: string) => {
    if (renameValue.trim()) {
      renamePresentation(id, renameValue.trim())
      toast('이름이 변경되었습니다', 'success')
    }
    setRenamingId(null)
  }

  const handleDelete = (id: string) => {
    deletePresentation(id)
    toast('삭제되었습니다', 'success')
    setMenuOpenId(null)
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] overflow-hidden bg-white">
      <div className="grid grid-cols-[1fr_160px_120px_48px] gap-4 px-6 py-3 bg-[var(--bg-muted)] border-b border-[var(--border)]">
        {['제목','수정일','슬라이드',''].map((h, i) => (
          <span key={i} className="text-sm font-semibold text-[var(--text-muted)]">{h}</span>
        ))}
      </div>
      {presentations.map((ppt, i) => (
        <div key={ppt.id}
          className={cn('grid grid-cols-[1fr_160px_120px_48px] gap-4 px-6 py-4 items-center hover:bg-[var(--bg-muted)] transition-colors group relative',
            i !== presentations.length - 1 && 'border-b border-[var(--border)]')}>
          {renamingId === ppt.id ? (
            <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => submitRename(ppt.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(ppt.id); if (e.key === 'Escape') setRenamingId(null) }}
              className="text-base font-semibold text-[var(--text)] border-b border-[var(--accent)] outline-none bg-transparent px-0.5" />
          ) : (
            <span onClick={() => navigate(`/edit/${ppt.id}`)}
              className="text-base font-medium text-[var(--text)] truncate group-hover:text-[var(--accent)] transition-colors cursor-pointer">
              {ppt.title}
            </span>
          )}
          <span className="text-sm text-[var(--text-muted)]">{formatDate(ppt.updatedAt)}</span>
          <span className="text-sm text-[var(--text-muted)]">{ppt.slides.length}장</span>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === ppt.id ? null : ppt.id) }}
              className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-[var(--border)] hover:text-[var(--text)] transition-colors cursor-pointer">
              <MoreHorizontal size={16} />
            </button>
            {menuOpenId === ppt.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                <div className="absolute right-0 top-9 z-20 w-40 bg-white border border-[var(--border)] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] overflow-hidden">
                  <button onClick={() => startRename(ppt)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">
                    <Pencil size={13} className="text-[var(--text-muted)]" />이름 변경
                  </button>
                  <button onClick={() => handleDelete(ppt.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors cursor-pointer">
                    <Trash2 size={13} />삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
