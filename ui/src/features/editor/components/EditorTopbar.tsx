import { useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useToastStore } from '@/shared/components/ui/Toast'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { Save, Share2, History } from 'lucide-react'

export default function EditorTopbar() {
  const { presentation, overallStatus, setCommandPaletteOpen, updateTitle, isTitleEditing, setTitleEditing } = useEditorStore()
  const toast = useToastStore((s) => s.push)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleTitleClick = () => {
    setTitleEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleTitleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (val) updateTitle(val)
    setTitleEditing(false)
  }

  const handleSave = () => {
    toast('저장되었습니다', 'success')
  }

  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border)] bg-white shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm">
          <span className="text-white text-xs font-bold">S</span>
        </div>
        {isTitleEditing ? (
          <input
            ref={inputRef}
            defaultValue={presentation?.title ?? ''}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="text-sm font-semibold text-[var(--text)] bg-transparent border-b border-[var(--accent)] outline-none px-0.5"
            autoFocus
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className="text-sm font-semibold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors"
          >
            {presentation?.title ?? '제목 없음'}
          </span>
        )}
        <AgentStatusBadge status={overallStatus} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setCommandPaletteOpen(true)}>
          <kbd className="text-[10px] text-[var(--text-disabled)] bg-[var(--bg-muted)] px-1.5 py-0.5 rounded-[4px] font-mono">⌘K</kbd>
          Agent 요청
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toast('버전 히스토리 준비 중', 'info')}>
          <History size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toast('공유 링크가 복사되었습니다', 'success')}>
          <Share2 size={14} />
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave}>
          <Save size={14} />저장
        </Button>
      </div>
    </div>
  )
}
