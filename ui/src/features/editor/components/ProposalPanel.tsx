import { useState, useMemo } from 'react'
import { useProposalStore } from '../store/proposalStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, CheckSquare, Square } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import DiffViewer from './DiffViewer'
import type { AgentProposal } from '@/shared/types'

interface ComponentDiffEntry {
  id: string
  type: 'modified' | 'added' | 'deleted'
  summary: string
}

function extractTextContent(outerHtml: string): string {
  const match = outerHtml.match(/>([^<]{1,80})/)
  return match ? match[1].trim().slice(0, 60) : ''
}

function parseComponents(html: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!html || typeof document === 'undefined') return map
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('[data-component-id]').forEach((el) => {
    const id = el.getAttribute('data-component-id')!
    map.set(id, el.outerHTML)
  })
  return map
}

function computeDiff(oldHtml: string, newHtml: string): ComponentDiffEntry[] {
  const oldMap = parseComponents(oldHtml)
  const newMap = parseComponents(newHtml)
  const entries: ComponentDiffEntry[] = []

  for (const [id, newH] of newMap) {
    const oldH = oldMap.get(id)
    if (!oldH) {
      entries.push({ id, type: 'added', summary: extractTextContent(newH) || id })
    } else if (oldH !== newH) {
      const txt = extractTextContent(newH)
      entries.push({ id, type: 'modified', summary: txt || id })
    }
  }
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) {
      entries.push({ id, type: 'deleted', summary: id })
    }
  }
  return entries
}

const TYPE_LABELS: Record<ComponentDiffEntry['type'], string> = {
  modified: '수정',
  added: '추가',
  deleted: '삭제',
}

const TYPE_COLORS: Record<ComponentDiffEntry['type'], string> = {
  modified: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  added: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  deleted: 'bg-red-500/10 text-red-400 border border-red-500/20',
}

interface HtmlDiffProps {
  proposal: AgentProposal
  currentHtml: string
  onApprove: (acceptedIds: string[] | null) => Promise<void>
  onReject: () => Promise<void>
  loading: boolean
}

function HtmlDiffPanel({ proposal, currentHtml, onApprove, onReject, loading }: HtmlDiffProps) {
  const diffs = useMemo(
    () => computeDiff(currentHtml, proposal.html_content || ''),
    [currentHtml, proposal.html_content]
  )
  const [selected, setSelected] = useState<Set<string>>(() => new Set(diffs.map((d) => d.id)))

  const toggleAll = () => {
    if (selected.size === diffs.length) setSelected(new Set())
    else setSelected(new Set(diffs.map((d) => d.id)))
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApproveSelected = () => {
    // 선택된 id만 승인 (전체 선택이면 null → 서버에서 전체 적용)
    const ids = [...selected]
    onApprove(ids.length === diffs.length ? null : ids)
  }

  return (
    <>
      {/* 에이전트 정보 */}
      <div className='px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-muted)]'>
        <div className='flex items-center gap-2 mb-1'>
          <span className='text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)]'>
            {proposal.agent_name}
          </span>
          <span className='text-[10px] text-[var(--text-muted)]'>{diffs.length}개 컴포넌트 변경</span>
        </div>
        <p className='text-[13px] text-[var(--text)] font-medium'>{proposal.summary || proposal.command}</p>
      </div>

      {/* 컴포넌트 목록 */}
      <div className='flex-1 overflow-y-auto px-4 py-3 space-y-1.5'>
        {/* 전체 선택 토글 */}
        <button
          onClick={toggleAll}
          className='flex items-center gap-2 w-full px-3 py-1.5 rounded-[6px] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-muted)] transition-colors'
        >
          {selected.size === diffs.length
            ? <CheckSquare size={13} className='text-[var(--accent)]' />
            : <Square size={13} />}
          전체 {selected.size === diffs.length ? '선택 해제' : '선택'}
        </button>

        {diffs.length === 0 && (
          <p className='text-center py-6 text-[12px] text-[var(--text-disabled)]'>변경된 컴포넌트 없음</p>
        )}

        {diffs.map((d) => (
          <button
            key={d.id}
            onClick={() => toggle(d.id)}
            className={cn(
              'flex items-center gap-3 w-full px-3 py-2.5 rounded-[8px] border text-left transition-colors',
              selected.has(d.id)
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {selected.has(d.id)
              ? <CheckSquare size={14} className='flex-shrink-0 text-[var(--accent)]' />
              : <Square size={14} className='flex-shrink-0 text-[var(--text-muted)]' />}
            <div className='flex-1 min-w-0'>
              <div className='flex items-center gap-2 mb-0.5'>
                <code className='text-[11px] font-mono text-[var(--text)]'>{d.id}</code>
                <span className={cn('text-[10px] px-1.5 py-0 rounded-full font-medium', TYPE_COLORS[d.type])}>
                  {TYPE_LABELS[d.type]}
                </span>
              </div>
              {d.summary && d.summary !== d.id && (
                <p className='text-[11px] text-[var(--text-muted)] truncate'>{d.summary}</p>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className='px-5 py-4 border-t border-[var(--border)] flex gap-3'>
        <button
          onClick={handleApproveSelected}
          disabled={loading || selected.size === 0}
          className='flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[8px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity'
        >
          <CheckCircle size={15} />
          {selected.size === diffs.length ? '전체 적용' : `선택 적용 (${selected.size})`}
        </button>
        <button
          onClick={onReject}
          disabled={loading}
          className='flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[8px] bg-white border border-[var(--border)] text-[var(--text)] text-[13px] font-medium hover:bg-[var(--bg-muted)] disabled:opacity-50 transition-colors'
        >
          <XCircle size={15} className='text-red-500' />
          전체 거절
        </button>
      </div>
    </>
  )
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function ProposalPanel({ open, onClose }: Props) {
  const { proposals, approveProposal, rejectProposal } = useProposalStore()
  const { presentation, currentSlideIndex } = useSlideStore()
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(false)

  const currentSlide = presentation?.slides[currentSlideIndex]
  const slideProposals = proposals.filter((p) => p.status === 'pending')
  const proposal = slideProposals[currentIdx]

  const handleApprove = async (acceptedIds: string[] | null = null) => {
    if (!proposal) return
    setLoading(true)
    try {
      await approveProposal(proposal.id, acceptedIds)
      if (slideProposals.length <= 1) onClose()
      else setCurrentIdx(Math.max(0, currentIdx - 1))
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!proposal) return
    setLoading(true)
    try {
      await rejectProposal(proposal.id)
      if (slideProposals.length <= 1) onClose()
      else setCurrentIdx(Math.max(0, currentIdx - 1))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className='w-[520px] max-h-[80vh] flex flex-col p-0 gap-0'>
        <DialogHeader className='px-5 py-4 border-b border-[var(--border)]'>
          <DialogTitle className='flex items-center justify-between'>
            <span>변경 제안 검토</span>
            {slideProposals.length > 1 && (
              <div className='flex items-center gap-2 text-[12px] font-normal text-[var(--text-muted)]'>
                <button
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                  className={cn(currentIdx === 0 && 'opacity-40 cursor-not-allowed')}
                >
                  <ChevronLeft size={14} />
                </button>
                {currentIdx + 1} / {slideProposals.length}
                <button
                  onClick={() => setCurrentIdx(Math.min(slideProposals.length - 1, currentIdx + 1))}
                  disabled={currentIdx === slideProposals.length - 1}
                  className={cn(currentIdx === slideProposals.length - 1 && 'opacity-40 cursor-not-allowed')}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        {!proposal ? (
          <div className='flex items-center justify-center py-12 text-[12px] text-[var(--text-disabled)]'>
            검토할 제안이 없습니다
          </div>
        ) : proposal.html_content ? (
          <HtmlDiffPanel
            proposal={proposal}
            currentHtml={currentSlide?.html_content || ''}
            onApprove={handleApprove}
            onReject={handleReject}
            loading={loading}
          />
        ) : (
          <>
            {/* JSON patch 모드 (레거시) */}
            <div className='px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-muted)]'>
              <div className='flex items-center gap-2 mb-1'>
                <span className='text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)]'>
                  {proposal.agent_name}
                </span>
              </div>
              <p className='text-[13px] text-[var(--text)] font-medium'>{proposal.summary || proposal.command}</p>
            </div>
            <div className='flex-1 overflow-y-auto px-5 py-4'>
              <DiffViewer
                currentContent={(currentSlide?.components ?? []) as unknown as Record<string, unknown>[]}
                patches={proposal.patches}
              />
            </div>
            <div className='px-5 py-4 border-t border-[var(--border)] flex gap-3'>
              <button
                onClick={() => handleApprove(null)}
                disabled={loading}
                className='flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[8px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity'
              >
                <CheckCircle size={15} />
                승인
              </button>
              <button
                onClick={handleReject}
                disabled={loading}
                className='flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[8px] bg-white border border-[var(--border)] text-[var(--text)] text-[13px] font-medium hover:bg-[var(--bg-muted)] disabled:opacity-50 transition-colors'
              >
                <XCircle size={15} className='text-red-500' />
                거절
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
