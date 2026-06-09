import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useProposalStore } from '../store/proposalStore'
import type { AgentProposal } from '@/shared/types'

interface Props {
  proposal: AgentProposal
}

function dispatchPreview(html: string) {
  window.dispatchEvent(
    new CustomEvent('html-component-preview', {
      detail: { componentId: '__slide_all__', newHtml: '', fullProposalHtml: html },
    })
  )
}

function clearPreview() {
  window.dispatchEvent(
    new CustomEvent('html-component-preview-clear', {
      detail: { componentId: '__slide_all__' },
    })
  )
}

export default function SlideProposalBanner({ proposal }: Props) {
  const { approveProposal, rejectProposal } = useProposalStore()
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleApprove = async () => {
    clearPreview()
    setApproving(true)
    try {
      await approveProposal(proposal.id, null, false)
    } finally {
      setApproving(false)
    }
  }

  const handleReject = async () => {
    clearPreview()
    setRejecting(true)
    try {
      await rejectProposal(proposal.id)
    } catch {
      // rejectProposal 내부에서 swallow — 여기서도 조용히 처리
    } finally {
      setRejecting(false)
    }
  }

  return (
    <div
      className="pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full items-start gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2.5 shadow-md">
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-amber-400 block leading-none mb-0.5">
            {proposal.agent_name}
          </span>
          <p
            className={`text-[12px] text-[var(--text-muted)] leading-snug break-words cursor-pointer ${expanded ? '' : 'truncate'}`}
            onClick={() => setExpanded(v => !v)}
            title={expanded ? '접기' : '펼치기'}
          >
            {proposal.summary || proposal.command}
          </p>
        </div>
        <button
          onMouseEnter={() => proposal.html_content && dispatchPreview(proposal.html_content)}
          onMouseLeave={clearPreview}
          onClick={handleApprove}
          disabled={approving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-400 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
        >
          <Check size={12} />
          {approving ? '적용 중...' : '전체 적용'}
        </button>
        <button
          onClick={handleReject}
          disabled={approving || rejecting}
          className="flex items-center justify-center w-8 h-8 rounded-[8px] border border-[var(--border)] text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400 hover:border-red-400/30 transition-colors shrink-0 disabled:opacity-50"
          title="거절"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
