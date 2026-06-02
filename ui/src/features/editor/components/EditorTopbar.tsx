import { useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import ThemePanel from '@/features/presentation/components/ThemePanel'
import type { AgentStatus } from '@/shared/types'

const statusMap: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: '#22c55e', label: '대기' },
  running: { color: '#f59e0b', label: '실행 중' },
  done: { color: '#22c55e', label: '완료' },
  error: { color: '#ef4444', label: '오류' },
  conflict: { color: '#f59e0b', label: '충돌' },
}

export default function EditorTopbar() {
  const { presentation, overallStatus, saveTitle, isTitleEditing, setTitleEditing } = useEditorStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [showTheme, setShowTheme] = useState(false)

  const status = statusMap[overallStatus] ?? statusMap.idle

  const handleTitleClick = () => {
    setTitleEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleTitleBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (val) {
      try { await saveTitle(val) }
      catch {}
    }
    setTitleEditing(false)
  }

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] bg-white shrink-0">
      {/* Left: Logo + Title + Status */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <a
          href="/drive"
          className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[#A855F7] flex items-center justify-center shadow-sm shrink-0 hover:opacity-80 transition-opacity"
          title="드라이브로 이동"
        >
          <span className="text-white text-[11px] font-bold">S</span>
        </a>

        {/* Title area */}
        {isTitleEditing ? (
          <input
            ref={inputRef}
            defaultValue={presentation?.title ?? ''}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="text-[13px] font-semibold text-[var(--text)] bg-transparent border-b border-[var(--accent)] outline-none px-0.5 w-48"
            autoFocus
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className="text-[13px] font-semibold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors truncate max-w-48"
          >
            {presentation?.title ?? '제목 없음'}
          </span>
        )}

        {/* Status dot */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-[11px] text-[var(--text-muted)]">{status.label}</span>
        </div>
      </div>

      {/* Right: Theme (icon only) */}
      <div className="flex items-center shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowTheme((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[var(--text-disabled)] hover:text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors text-[16px]"
            title="디자인 테마"
          >
            🎨
          </button>
          {showTheme && (
            <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-white rounded-[12px] border border-[var(--border)] shadow-xl">
              <ThemePanel onClose={() => setShowTheme(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
