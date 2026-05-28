import { useEditorStore } from '../store/editorStore'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { Save, Share2, History } from 'lucide-react'

export default function EditorTopbar() {
  const { presentation, overallStatus, setCommandPaletteOpen } = useEditorStore()

  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border)] bg-[var(--bg-subtle)] shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 rounded-[6px] bg-[var(--accent-subtle)] flex items-center justify-center">
          <span className="text-[var(--accent)] text-xs font-bold">S</span>
        </div>
        <span className="text-sm font-medium text-[var(--text)]">
          {presentation?.title ?? '제목 없음'}
        </span>
        <AgentStatusBadge status={overallStatus} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setCommandPaletteOpen(true)}>
          <span className="text-[var(--text-muted)] text-xs mr-1">⌘K</span>
          Agent 요청
        </Button>
        <Button variant="ghost" size="sm">
          <History size={14} />
        </Button>
        <Button variant="ghost" size="sm">
          <Share2 size={14} />
        </Button>
        <Button variant="primary" size="sm">
          <Save size={14} />
          저장
        </Button>
      </div>
    </div>
  )
}
