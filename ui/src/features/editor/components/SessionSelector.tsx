import { useState } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useSlideStore } from '../store/slideStore'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export default function SessionSelector() {
  const { sessions, currentSessionId, setCurrentSession, createSession, deleteSession } = useSessionStore()
  const presentation = useSlideStore((s) => s.presentation)
  const [open, setOpen] = useState(false)

  const current = sessions.find((s) => s.id === currentSessionId)

  const handleCreate = async () => {
    if (!presentation) return
    const name = `세션 ${sessions.length + 1}`
    await createSession(presentation.id, name)
    setOpen(false)
  }

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!presentation) return
    if (sessions.length <= 1) return
    await deleteSession(presentation.id, sessionId)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-[var(--bg-muted)] hover:bg-[var(--border)] text-[11px] font-medium text-[var(--text-muted)] transition-colors max-w-[140px]"
      >
        <span className="truncate">{current?.name ?? '세션 선택'}</span>
        <ChevronDown size={10} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 min-w-[180px]">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setCurrentSession(s.id); setOpen(false) }}
              className={cn(
                'flex items-center justify-between px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--bg-muted)] transition-colors',
                s.id === currentSessionId && 'text-[var(--accent)] font-medium',
              )}
            >
              <span className="truncate flex-1">{s.name}</span>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="ml-2 p-0.5 rounded hover:bg-red-50 text-[var(--text-disabled)] hover:text-red-500 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
            >
              <Plus size={12} />
              새 세션
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
