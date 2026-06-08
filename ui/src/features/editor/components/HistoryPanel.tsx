import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { RotateCcw, Clock, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { fetchSlideHistory, restoreFromHistory, fetchHistoryDiff, type SlideHistoryEntry, type HistoryDiff } from '@/shared/lib/projectApi'
import { buildSlideSrc } from '@/shared/lib/slideHtml'

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

  const [versions, setVersions] = useState<SlideHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [diff, setDiff] = useState<HistoryDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const handleSelect = useCallback(async (v: SlideHistoryEntry) => {
    if (selectedId === v.id) {
      setSelectedId(null)
      setDiff(null)
      return
    }
    setSelectedId(v.id)
    setDiff(null)
    setDiffLoading(true)
    try {
      const result = await fetchHistoryDiff(projectId!, currentSlide!.id, v.id)
      setDiff(result)
    } finally {
      setDiffLoading(false)
    }
  }, [selectedId, projectId, currentSlide?.id])

  const load = useCallback(async () => {
    if (!projectId || !currentSlide) return
    setLoading(true)
    try {
      const data = await fetchSlideHistory(projectId, currentSlide.id)
      setVersions(data)
    } finally {
      setLoading(false)
    }
  }, [projectId, currentSlide?.id])

  useEffect(() => {
    if (open) {
      load()
      setSelectedId(null)
      setDiff(null)
    }
  }, [open, load])

  const handleRestore = async (versionId: string) => {
    if (!projectId || !currentSlide) return
    clearPreview()
    setRestoring(versionId)
    try {
      await restoreFromHistory(projectId, currentSlide.id, versionId)
      await loadPresentation(projectId)
      onClose()
    } finally {
      setRestoring(null)
    }
  }

  function showPreview(html: string) {
    window.dispatchEvent(new CustomEvent('html-component-preview', {
      detail: { componentId: '__history_preview__', newHtml: '', fullProposalHtml: html },
    }))
  }

  function clearPreview() {
    window.dispatchEvent(new CustomEvent('html-component-preview-clear', {
      detail: { componentId: '__history_preview__' },
    }))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className={cn(
        'flex flex-col p-0 gap-0 transition-all duration-300',
        selectedId ? 'w-[820px] max-h-[75vh]' : 'w-[420px] max-h-[70vh]',
      )}>
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

        <div className="flex flex-1 overflow-hidden">
          {/* 왼쪽: 히스토리 목록 */}
          <div className={cn(
            'flex-shrink-0 overflow-y-auto border-r border-[var(--border)] transition-all duration-300',
            selectedId ? 'w-[280px]' : 'w-full',
          )}>
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
                  const { agent, command } = parseAgentName(v.reason)
                  const isRestoring = restoring === v.id
                  const isSelected = selectedId === v.id
                  return (
                    <div
                      key={v.id}
                      onClick={() => handleSelect(v)}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 cursor-pointer group transition-colors',
                        isSelected
                          ? 'bg-[var(--accent-subtle)] border-l-2 border-[var(--accent)]'
                          : 'hover:bg-[var(--bg-muted)]',
                      )}
                    >
                      <div className="mt-0.5 w-6 h-6 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center shrink-0">
                        <ChevronRight size={10} className="text-[var(--accent)]" />
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
                        <p className="text-[11px] text-[var(--text)] leading-snug line-clamp-2">{command}</p>
                        <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">{formatDate(v.created_at)}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRestore(v.id) }}
                        disabled={!!restoring}
                        onMouseEnter={() => v.html_content && showPreview(v.html_content)}
                        onMouseLeave={clearPreview}
                        className={cn(
                          'shrink-0 flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all',
                          'opacity-0 group-hover:opacity-100',
                          'bg-[var(--accent-subtle)] text-[var(--accent-text)]',
                          'hover:bg-[var(--accent)] hover:text-white',
                          'disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                      >
                        {isRestoring ? <span className="animate-spin">↻</span> : <RotateCcw size={10} />}
                        복원
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 오른쪽: diff 패널 */}
          {selectedId && (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {diffLoading ? (
                <div className="flex items-center justify-center h-full text-[12px] text-[var(--text-disabled)]">
                  비교 중...
                </div>
              ) : diff ? (
                <>
                  {/* Before / After 미니 슬라이드 */}
                  <div className="flex gap-3">
                    <div className="flex-1 flex flex-col gap-1">
                      <span className="text-[10px] text-[var(--text-disabled)] text-center">BEFORE</span>
                      <div className="aspect-video rounded-[6px] overflow-hidden border border-[var(--border)] bg-[#0A0F1E]">
                        {diff.before_html ? (
                          <iframe
                            srcDoc={buildSlideSrc(diff.before_html)}
                            className="w-full h-full pointer-events-none"
                            style={{ transform: 'scale(0.33)', transformOrigin: 'top left', width: '300%', height: '300%' }}
                            sandbox="allow-scripts allow-same-origin"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center text-[var(--text-disabled)] text-sm">→</div>
                    <div className="flex-1 flex flex-col gap-1">
                      <span className="text-[10px] text-[var(--text-disabled)] text-center">AFTER</span>
                      <div className="aspect-video rounded-[6px] overflow-hidden border border-[var(--accent)] bg-[#0A0F1E]">
                        {diff.after_html ? (
                          <iframe
                            srcDoc={buildSlideSrc(diff.after_html)}
                            className="w-full h-full pointer-events-none"
                            style={{ transform: 'scale(0.33)', transformOrigin: 'top left', width: '300%', height: '300%' }}
                            sandbox="allow-scripts allow-same-origin"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-[10px] text-[var(--text-disabled)]">없음</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 변경 컴포넌트 태그 */}
                  {(diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-[var(--text-disabled)] font-medium uppercase tracking-wide">변경 컴포넌트</span>
                      <div className="flex flex-wrap gap-1.5">
                        {diff.added.map(id => (
                          <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e3a1e] text-[#4ade80] font-medium">
                            + {id}
                          </span>
                        ))}
                        {diff.removed.map(id => (
                          <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#3a2020] text-[#f87171] font-medium">
                            − {id}
                          </span>
                        ))}
                        {diff.modified.map(id => (
                          <span key={id} className="text-[10px] px-2 py-0.5 rounded-full bg-[#2a2a1e] text-[#fbbf24] font-medium">
                            ~ {id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && (
                    <p className="text-[11px] text-[var(--text-disabled)] text-center">변경된 컴포넌트 없음</p>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
