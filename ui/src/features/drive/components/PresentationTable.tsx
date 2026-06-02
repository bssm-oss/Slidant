import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Presentation } from '@/shared/types'
import { cn } from '@/shared/lib/utils'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useDriveStore } from '../store/driveStore'
import { useToastStore } from '@/shared/components/ui/Toast'
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

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
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

  const submitRename = async (id: string) => {
    if (renameValue.trim()) {
      try {
        await renamePresentation(id, renameValue.trim())
        toast('이름이 변경되었습니다', 'success')
      } catch (err: unknown) {
        toast(errorMessage(err, '이름 변경 실패'), 'error')
      }
    }
    setRenamingId(null)
  }

  const handleDelete = async (id: string) => {
    try {
      await deletePresentation(id)
      toast('삭제되었습니다', 'success')
    } catch (err: unknown) {
      toast(errorMessage(err, '삭제 실패'), 'error')
    }
    setMenuOpenId(null)
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-[var(--shadow-soft)]">
      <div className="hidden grid-cols-[minmax(180px,1fr)_88px_132px_88px_40px] gap-4 border-b border-[var(--border)] bg-[var(--bg-raised)] px-5 py-3 md:grid">
        {['제목','미리보기','수정일','슬라이드',''].map((h, i) => (
          <span key={i} className="text-[12px] font-semibold text-[var(--text-muted)]">{h}</span>
        ))}
      </div>
      {presentations.map((ppt, i) => (
        <div key={ppt.id}
          className={cn('grid grid-cols-[64px_minmax(0,1fr)_40px] gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_88px_132px_88px_40px] md:gap-4 md:px-5 md:py-3.5 items-center cursor-pointer hover:bg-[var(--bg-raised)] transition-colors group relative',
            i !== presentations.length - 1 && 'border-b border-[var(--border)]')}>
          {renamingId === ppt.id ? (
            <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => submitRename(ppt.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(ppt.id); if (e.key === 'Escape') setRenamingId(null) }}
              className="order-2 text-[14px] font-semibold text-[var(--text)] border-b border-[var(--accent)] outline-none bg-transparent px-0.5 md:order-none" />
          ) : (
            <span onClick={() => navigate(`/edit/${ppt.id}`)}
              className="order-2 min-w-0 truncate text-[14px] font-medium text-[var(--text)] transition-colors cursor-pointer group-hover:text-[var(--accent-text)] md:order-none">
              {ppt.title}
            </span>
          )}
          <div className="order-1 w-16 overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg-muted)] md:order-none md:w-[88px]">
            <SlideThumbnail projectId={ppt.id} />
          </div>
          <span className="hidden text-[13px] text-[var(--text-muted)] md:block">{formatDate(ppt.updatedAt)}</span>
          <span className="hidden text-[13px] text-[var(--text-muted)] md:block">{ppt.slideCount ?? ppt.slides.length}장</span>
          <div className="relative order-3 md:order-none">
            <button onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === ppt.id ? null : ppt.id) }}
              className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[var(--text-disabled)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] transition-colors cursor-pointer">
              <MoreHorizontal size={16} />
            </button>
            {menuOpenId === ppt.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                <div className="absolute right-0 top-9 z-20 w-40 bg-white border border-[var(--border)] rounded-[8px] shadow-[0_12px_28px_rgba(15,23,42,0.16)] overflow-hidden">
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
