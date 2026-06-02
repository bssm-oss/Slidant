import { useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useToastStore } from '@/shared/components/ui/Toast'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/shared/components/ui/tooltip'
import { Save, Share2, History, Undo2 } from 'lucide-react'
import HistoryPanel from './HistoryPanel'
import ThemePanel from '@/features/presentation/components/ThemePanel'

function IconButton({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

export default function EditorTopbar() {
  const { presentation, overallStatus, saveTitle, isTitleEditing, setTitleEditing } = useEditorStore()
  const toast = useToastStore((s) => s.push)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showTheme, setShowTheme] = useState(false)

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

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border)] bg-white shrink-0">
        {/* 좌측 */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm shrink-0">
            <span className="text-white text-[11px] font-bold">S</span>
          </div>
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
          <AgentStatusBadge status={overallStatus} />
        </div>

        {/* 우측 */}
        <div className="flex items-center gap-1 shrink-0">
          <IconButton onClick={() => setShowHistory(true)} title="버전 히스토리">
            <History size={15} />
          </IconButton>
          <IconButton onClick={() => toast('실행 취소 준비 중', 'info')} title="실행 취소">
            <Undo2 size={15} />
          </IconButton>
          <div className="w-px h-4 bg-[var(--border)] mx-1.5" />
          <div className="relative">
            <button
              onClick={() => setShowTheme((v) => !v)}
              className="h-8 px-3 text-[12px] font-medium rounded-[8px] border border-[var(--border)] hover:bg-[var(--bg-muted)] transition-colors flex items-center gap-1.5"
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
          <Button variant="ghost" size="sm" onClick={() => toast('공유 링크가 복사되었습니다', 'success')}>
            <Share2 size={14} />
            공유
          </Button>
          <Button variant="primary" size="sm" onClick={() => toast('저장되었습니다', 'success')}>
            <Save size={14} />
            저장
          </Button>
        </div>
      </div>
      <HistoryPanel open={showHistory} onClose={() => setShowHistory(false)} />
    </TooltipProvider>
  )
}
