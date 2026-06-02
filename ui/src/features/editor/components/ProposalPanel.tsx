import { useState } from 'react'
import { useProposalStore } from '../store/proposalStore'
import { useEditorStore } from '../store/editorStore'
import { cn } from '@/shared/lib/utils'
import { CheckCircle, XCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import DiffViewer from './DiffViewer'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ProposalPanel({ open, onClose }: Props) {
  const { proposals, approveProposal, rejectProposal } = useProposalStore()
  const { presentation, currentSlideIndex } = useEditorStore()
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(false)

  const currentSlide = presentation?.slides[currentSlideIndex]
  // 현재 슬라이드의 pending 제안만 필터
  const slideProposals = proposals.filter((p) => p.status === 'pending')
  const proposal = slideProposals[currentIdx]

  const handleApprove = async () => {
    if (!proposal) return
    setLoading(true)
    try {
      await approveProposal(proposal.id)
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
        <DialogHeader>
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
        ) : (
          <>
            {/* 에이전트 정보 */}
            <div className='px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-muted)]'>
              <div className='flex items-center gap-2 mb-1'>
                <span className='text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)]'>
                  {proposal.agent_name}
                </span>
              </div>
              <p className='text-[13px] text-[var(--text)] font-medium'>{proposal.summary || proposal.command}</p>
            </div>

            {/* Diff */}
            <div className='flex-1 overflow-y-auto px-5 py-4'>
              <DiffViewer
                currentContent={(currentSlide?.components ?? []) as unknown as Record<string, unknown>[]}
                patches={proposal.patches}
              />
            </div>

            {/* Actions */}
            <div className='px-5 py-4 border-t border-[var(--border)] flex gap-3'>
              <button
                onClick={handleApprove}
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
