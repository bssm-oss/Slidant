import { useEditorStore } from '../store/editorStore'
import { AgentStatusBadge, Button } from '@/shared/components/ui'
import { Save, Share2, History } from 'lucide-react'

export default function EditorTopbar() {
  const { presentation, overallStatus, setCommandPaletteOpen } = useEditorStore()

  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border)] bg-white shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-[var(--accent)] to-[var(--pink)] flex items-center justify-center shadow-sm">
          <span className="text-white text-xs font-bold">S</span>
        </div>
        <span className="text-sm font-semibold text-[var(--text)]">
          {presentation?.title ?? '제목 없음'}
        </span>
        <AgentStatusBadge status={overallStatus} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setCommandPaletteOpen(true)}>
          <kbd className="text-[10px] text-[var(--text-disabled)] bg-[var(--bg-muted)] px-1.5 py-0.5 rounded-[4px] font-mono">⌘K</kbd>
          Agent 요청
        </Button>
        <Button variant="ghost" size="sm"><History size={14} /></Button>
        <Button variant="ghost" size="sm"><Share2 size={14} /></Button>
        <Button variant="primary" size="sm"><Save size={14} />저장</Button>
      </div>
    </div>
  )
}
