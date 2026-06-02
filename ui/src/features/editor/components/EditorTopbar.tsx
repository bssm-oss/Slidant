import { useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useToastStore } from '@/shared/components/ui/Toast'
import { Button } from '@/shared/components/ui'
import { Save } from 'lucide-react'
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
  const toast = useToastStore((s) => s.push)
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
      try { await saveTitle(val); toast('저장됨', 'success') }
      catch { toast('제목 저장 실패', 'error') }
    }
    setTitleEditing(false)
  }

  const handleSave = () => {
    toast('저장되었습니다', 'success')
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

      {/* Right: Theme + Save */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Theme button + panel */}
        <div className="relative">
          <button
            onClick={() => setShowTheme((v) => !v)}
            className="h-8 px-3 text-[12px] font-medium rounded-[8px] hover:bg-[var(--bg-muted)] transition-colors flex items-center gap-1.5"
            title="디자인 테마"
          >
            🎨 테마
          </button>
          {showTheme && (
            <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-white rounded-[12px] border border-[var(--border)] shadow-xl">
              <ThemePanel onClose={() => setShowTheme(false)} />
            </div>
          )}
        </div>

        {/* Save button */}
        <Button
          variant="primary"
          onClick={handleSave}
          className="h-8 px-4 text-[12px] leading-none"
        >
          <Save size={13} />
          저장
        </Button>
      </div>
    </div>
  )
}
