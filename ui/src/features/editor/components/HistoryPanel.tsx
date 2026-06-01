import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { RotateCcw, Clock, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { fetchSlideVersions, restoreVersion, type SlideVersion } from '@/shared/lib/projectApi'

function formatDate(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseAgentName(message: string): { agent: string; command: string } {
  const colonIdx = message.indexOf(':')
  if (colonIdx > 0) {
    return {
      agent: message.slice(0, colonIdx).trim(),
      command: message.slice(colonIdx + 1).trim(),
    }
  }
  return { agent: '', command: message }
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function HistoryPanel({ open, onClose }: Props) {
  const { presentation, currentSlideIndex, loadPresentation } = useEditorStore()
  const projectId = presentation?.id
  const currentSlide = presentation?.slides[currentSlideIndex]

  const [versions, setVersions] = useState<SlideVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId || !currentSlide) return
    setLoading(true)
    try {
      const data = await fetchSlideVersions(projectId, currentSlide.id)
      setVersions(data)
    } finally {
      setLoading(false)
    }
  }, [projectId, currentSlide?.id])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleRestore = async (versionId: string) => {
    if (!projectId || !currentSlide) return
    setRestoring(versionId)
    try {
      await restoreVersion(projectId, currentSlide.id, versionId)
      await loadPresentation(projectId)
      onClose()
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="w-[420px] max-h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={14} className="text-[var(--text-muted)]" />
            버전 히스토리
            {currentSlide && (
              <span className="text-[11px] text-[var(--text-disabled)] font-normal ml-1">
                슬라이드 {currentSlideIndex + 1}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[12px] text-[var(--text-disabled)]">
              불러오는 중...
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Clock size={24} className="text-[var(--text-disabled)]" />
              <p className="text-[12px] text-[var(--text-disabled)]">아직 저장된 버전이 없습니다</p>
              <p className="text-[11px] text-[var(--text-disabled)]">Agent가 슬라이드를 수정하면 자동으로 저장됩니다</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {versions.map((v) => {
                const { agent, command } = parseAgentName(v.message)
                const isRestoring = restoring === v.id
                return (
                  <div
                    key={v.id}
                    className="flex items-start gap-3 px-5 py-3.5 hover:bg-[var(--bg-muted)] group transition-colors"
                  >
                    <div className="mt-0.5 w-7 h-7 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center shrink-0">
                      <ChevronRight size={12} className="text-[var(--accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {agent && (
                        <span className={cn(
                          'inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1',
                          'bg-[var(--accent-subtle)] text-[var(--accent-text)]',
                        )}>
                          {agent}
                        </span>
                      )}
                      <p className="text-[12px] text-[var(--text)] leading-snug line-clamp-2">{command}</p>
                      <p className="text-[11px] text-[var(--text-disabled)] mt-0.5">{formatDate(v.created_at)}</p>
                    </div>
                    <button
                      onClick={() => handleRestore(v.id)}
                      disabled={!!restoring}
                      className={cn(
                        'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium transition-colors',
                        'opacity-0 group-hover:opacity-100',
                        'bg-[var(--bg-muted)] hover:bg-[var(--border)] text-[var(--text-muted)]',
                        'disabled:opacity-40',
                      )}
                    >
                      {isRestoring ? (
                        <span className="animate-spin">↻</span>
                      ) : (
                        <RotateCcw size={11} />
                      )}
                      복원
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
