import { useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useToastStore } from '@/shared/components/ui/Toast'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { Save, Share2, History, Undo2 } from 'lucide-react'

export default function EditorTopbar() {
  const { presentation, overallStatus, saveTitle, isTitleEditing, setTitleEditing } = useEditorStore()
  const toast = useToastStore((s) => s.push)
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="flex items-center justify-between px-4 border-b border-[var(--border)] bg-white shrink-0" style={{ height: 56 }}>
      {/* 좌측: 로고 + 제목 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm shrink-0">
          <span className="text-white text-xs font-bold">S</span>
        </div>
        {isTitleEditing ? (
          <input
            ref={inputRef}
            defaultValue={presentation?.title ?? ''}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="text-sm font-semibold text-[var(--text)] bg-transparent border-b border-[var(--accent)] outline-none px-0.5 w-48"
            autoFocus
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className="text-sm font-semibold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors truncate max-w-48"
          >
            {presentation?.title ?? '제목 없음'}
          </span>
        )}
        <AgentStatusBadge status={overallStatus} />
      </div>

      {/* 우측: 액션 */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => toast('버전 히스토리 준비 중', 'info')} title="히스토리" className="w-9 px-0 justify-center">
          <History size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toast('실행 취소 준비 중', 'info')} title="실행 취소" className="w-9 px-0 justify-center">
          <Undo2 size={16} />
        </Button>
        <div className="w-px h-5 bg-[var(--border)] mx-1" />
        <Button variant="ghost" size="sm" onClick={() => toast('공유 링크가 복사되었습니다', 'success')}>
          <Share2 size={15} />
          공유
        </Button>
        <Button variant="primary" size="sm" onClick={() => toast('저장되었습니다', 'success')}>
          <Save size={15} />
          저장
        </Button>
      </div>
    </div>
  )
}
