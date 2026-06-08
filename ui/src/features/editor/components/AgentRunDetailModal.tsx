import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'
import { fetchRunSlideChanges, type RunSlideChange } from '@/shared/lib/projectApi'
import { buildSlideSrc } from '@/shared/lib/slideHtml'
import type { AgentRunHistoryItem } from '@/shared/lib/agentApi'

interface Props {
  projectId: string
  run: AgentRunHistoryItem | null
  onClose: () => void
}

const ROLE_COLOR: Record<string, string> = {
  content: 'bg-blue-50 text-blue-700',
  design: 'bg-purple-50 text-purple-700',
  layout: 'bg-green-50 text-green-700',
}

function agentBadgeColor(name: string | null): string {
  if (!name) return 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
  const lower = name.toLowerCase()
  if (lower.includes('content')) return ROLE_COLOR.content
  if (lower.includes('design')) return ROLE_COLOR.design
  if (lower.includes('layout')) return ROLE_COLOR.layout
  return 'bg-orange-50 text-orange-700'
}

/** 960×540 iframe을 컨테이너에 맞게 동적 스케일 */
function SlidePreview({ html, label }: { html: string | null; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 960)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      <span className="text-[9px] text-[var(--text-disabled)] text-center uppercase tracking-wide">{label}</span>
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-[4px] border border-[var(--border)] bg-[#0A0F1E]"
        style={{ aspectRatio: '16/9' }}
      >
        {html ? (
          <iframe
            srcDoc={buildSlideSrc(html)}
            style={{
              width: 960,
              height: 540,
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
              display: 'block',
              pointerEvents: 'none',
              border: 'none',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
        )}
      </div>
    </div>
  )
}

function SlideChangeTile({ change }: { change: RunSlideChange }) {
  const hasChanges = change.added.length > 0 || change.removed.length > 0 || change.modified.length > 0
  return (
    <div className="flex flex-col gap-2 p-3 border border-[var(--border)] rounded-[8px] bg-[var(--bg-muted)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">슬라이드 {change.slide_order + 1}</span>
        {change.slide_title && (
          <span className="text-[11px] text-[var(--text-disabled)] truncate">{change.slide_title}</span>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <SlidePreview html={change.before_html} label="Before" />
        <div className="text-[var(--text-disabled)] text-xs shrink-0 pb-1">→</div>
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[9px] text-[var(--text-disabled)] text-center uppercase tracking-wide">After</span>
          <div className="relative">
            {/* after 슬라이드에만 accent border 적용 */}
            <div
              className={cn(
                'w-full overflow-hidden rounded-[4px] bg-[#0A0F1E]',
                hasChanges ? 'border border-[var(--accent)]' : 'border border-[var(--border)]',
              )}
              style={{ aspectRatio: '16/9' }}
              ref={(el) => {
                if (!el) return
                const obs = new ResizeObserver(([entry]) => {
                  const iframe = el.querySelector('iframe') as HTMLIFrameElement | null
                  if (iframe) iframe.style.transform = `scale(${entry.contentRect.width / 960})`
                })
                obs.observe(el)
              }}
            >
              {change.after_html ? (
                <iframe
                  srcDoc={buildSlideSrc(change.after_html)}
                  style={{
                    width: 960,
                    height: 540,
                    transformOrigin: 'top left',
                    transform: `scale(0.3)`,
                    display: 'block',
                    pointerEvents: 'none',
                    border: 'none',
                  }}
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export default function AgentRunDetailModal({ projectId, run, onClose }: Props) {
  const [changes, setChanges] = useState<RunSlideChange[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!run) return
    setLoading(true)
    setChanges([])
    fetchRunSlideChanges(projectId, run.id)
      .then(setChanges)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [run?.id, projectId])

  const open = !!run

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex flex-col p-0 gap-0 overflow-hidden w-[860px] max-w-[95vw] max-h-[88vh]">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[13px]">
            {run?.agent_name && (
              <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', agentBadgeColor(run.agent_name))}>
                {run.agent_name}
              </span>
            )}
            <span className="font-semibold text-[var(--text)]">슬라이드 변경 내역</span>
          </DialogTitle>
          {run?.task_description && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">{run.task_description}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-[12px] text-[var(--text-disabled)]">
              <Loader2 size={14} className="animate-spin" />
              불러오는 중...
            </div>
          ) : changes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-1">
              <p className="text-[12px] text-[var(--text-disabled)]">변경된 슬라이드가 없습니다</p>
              <p className="text-[11px] text-[var(--text-disabled)]">이 에이전트 실행은 슬라이드를 수정하지 않았습니다</p>
            </div>
          ) : (
            changes.map((c) => <SlideChangeTile key={c.slide_id} change={c} />)
          )}
        </div>

      </DialogContent>
    </Dialog>
  )
}
