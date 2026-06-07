import { useState } from 'react'
import { useSessionStore } from '../store/sessionStore'
import { useSlideStore } from '../store/slideStore'
import { useAgentStore } from '../store/agentStore'
import { ChevronDown, Plus, Trash2, Eye } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export default function SessionSelector() {
  const { sessions, currentSessionId, currentUserId, setCurrentSession, createSession, deleteSession } = useSessionStore()
  const presentation = useSlideStore((s) => s.presentation)
  const presenceUsers = useAgentStore((s) => s.presenceUsers)
  const [open, setOpen] = useState(false)

  const current = sessions.find((s) => s.id === currentSessionId)

  const isMySession = (s: { user_id?: string | null }) =>
    !s.user_id || s.user_id === currentUserId

  const getUserLabel = (session: { user_id?: string | null }) => {
    if (isMySession(session)) return null
    const presence = presenceUsers.find((u) => u.userId === session.user_id)
    return presence?.name ?? '다른 유저'
  }

  const handleCreate = async () => {
    if (!presentation) return
    const name = `세션 ${sessions.length + 1}`
    await createSession(presentation.id, name)
    setOpen(false)
  }

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!presentation) return
    const mySessionCount = sessions.filter((s) => isMySession(s)).length
    if (mySessionCount <= 1) return
    await deleteSession(presentation.id, sessionId)
  }

  const mySessions = sessions.filter((s) => isMySession(s))
  const otherSessions = sessions.filter((s) => !isMySession(s))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-[var(--bg-muted)] hover:bg-[var(--border)] text-[11px] font-medium text-[var(--text-muted)] transition-colors max-w-[160px]"
      >
        <span className="truncate">
          {current
            ? isMySession(current)
              ? current.name
              : `${getUserLabel(current)} · ${current.name}`
            : '세션 선택'}
        </span>
        <ChevronDown size={10} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-[var(--border)] rounded-[10px] shadow-lg py-1 min-w-[200px]">
          {mySessions.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-[var(--text-disabled)] font-semibold uppercase tracking-wide">내 세션</div>
              {mySessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { setCurrentSession(s.id); setOpen(false) }}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--bg-muted)] transition-colors',
                    s.id === currentSessionId && 'text-[var(--accent)] font-medium',
                  )}
                >
                  <span className="truncate flex-1">{s.name}</span>
                  {mySessions.length > 1 && (
                    <button
                      onClick={(e) => handleDelete(e, s.id)}
                      className="ml-2 p-0.5 rounded hover:bg-red-50 text-[var(--text-disabled)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {otherSessions.length > 0 && (
            <>
              <div className={cn('px-3 py-1 text-[10px] text-[var(--text-disabled)] font-semibold uppercase tracking-wide', mySessions.length > 0 && 'mt-1 border-t border-[var(--border)] pt-2')}>
                다른 유저
              </div>
              {otherSessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { setCurrentSession(s.id); setOpen(false) }}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-[12px] cursor-pointer hover:bg-[var(--bg-muted)] transition-colors',
                    s.id === currentSessionId && 'text-[var(--accent)] font-medium',
                  )}
                >
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Eye size={10} className="shrink-0 text-[var(--text-disabled)]" />
                    <span className="truncate">{getUserLabel(s)} · {s.name}</span>
                  </div>
                </div>
              ))}
            </>
          )}

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
