import { useRef, useState } from 'react'
import { Download, Palette, Play, Share2, Undo2, Redo2 } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { useAgentStore } from '../store/agentStore'
import ThemePanel from '@/features/presentation/components/ThemePanel'
import type { AgentStatus } from '@/shared/types'
import BrandMark from '@/shared/components/layout/BrandMark'

const statusMap: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: '#22c55e', label: '대기' },
  running: { color: '#f59e0b', label: '실행 중' },
  done: { color: '#22c55e', label: '완료' },
  error: { color: '#ef4444', label: '오류' },
  conflict: { color: '#f59e0b', label: '충돌' },
}

interface EditorTopbarProps {
  onPresent?: () => void
  onExport?: () => void
  onShare?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

export default function EditorTopbar({ onPresent, onExport, onShare, onUndo, onRedo, canUndo, canRedo }: EditorTopbarProps) {
  const { presentation, overallStatus, saveTitle, isTitleEditing, setTitleEditing } = useEditorStore()
  const { presenceUsers } = useAgentStore()
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
      catch {
        // Title edits are optimistic; keep the existing title if the save request fails.
      }
    }
    setTitleEditing(false)
  }

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] bg-white shrink-0">
      {/* Left: Logo + Title + Status */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <a
          href="/drive"
          className="transition-opacity hover:opacity-85"
          title="드라이브로 이동"
        >
          <BrandMark size="sm" />
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

      {/* Right: Presence + Undo/Redo + Export + Present + Theme */}
      <div className="flex items-center gap-1 shrink-0">
        {/* 접속 중인 사용자 아바타 */}
        {presenceUsers.length > 0 && (
          <div className="flex items-center gap-0.5 mr-2">
            {presenceUsers.slice(0, 5).map((u) => (
              <div key={u.userId} className="relative group">
                <div
                  style={{
                    background: u.color,
                    boxShadow: u.isAgentRunning ? `0 0 0 2px white, 0 0 0 4px ${u.color}` : undefined,
                  }}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm ring-2 ring-white transition-all cursor-default${u.isAgentRunning ? ' animate-pulse' : ''}`}
                >
                  {u.name?.[0]?.toUpperCase()}
                </div>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded bg-[#333] text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  {u.isAgentRunning ? `${u.name} (실행 중)` : u.name}
                </div>
              </div>
            ))}
          </div>
        )}
        {(onUndo || onRedo) && (
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded hover:bg-[var(--bg-muted)] text-[var(--text-disabled)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="실행 취소"
            >
              <Undo2 size={15} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded hover:bg-[var(--bg-muted)] text-[var(--text-disabled)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="다시 실행"
            >
              <Redo2 size={15} />
            </button>
          </div>
        )}
        {onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 h-8 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-muted)] transition-colors"
            title="PDF로 내보내기"
          >
            <Download size={13} />
            내보내기
          </button>
        )}
        {onShare && (
          <button
            onClick={onShare}
            className="flex items-center gap-1.5 px-3 h-8 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-muted)] transition-colors"
            title="공유 링크 생성"
          >
            <Share2 size={13} />
            공유
          </button>
        )}
        {onPresent && (
          <button
            onClick={onPresent}
            className="flex items-center gap-1.5 px-3 h-8 rounded-[8px] bg-[var(--accent)] text-white text-[12px] font-medium hover:opacity-90 transition-opacity"
            title="발표 모드"
          >
            <Play size={13} />
            발표
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setShowTheme((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:bg-[var(--accent-subtle)] transition-colors"
            title="디자인 테마"
          >
            <Palette size={16} />
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
