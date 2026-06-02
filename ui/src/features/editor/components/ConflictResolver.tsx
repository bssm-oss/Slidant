import { useState } from 'react'
import { useProposalStore } from '../store/proposalStore'
import { useSlideStore } from '../store/slideStore'
import { cn } from '@/shared/lib/utils'
import { X, CheckCircle } from 'lucide-react'
import type { AgentProposal, SlideComponent } from '@/shared/types'

const SLIDE_W = 960
const SCALE = 0.28

// 미니 컴포넌트 렌더러
function MiniComp({ comp }: { comp: SlideComponent }) {
  const props = comp.props as Record<string, unknown>
  if (comp.type === 'shape') {
    return (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        background: (props.bgColor as string) ?? '#e5e7eb',
        opacity: (props.opacity as number) ?? 1,
        borderRadius: ((props.borderRadius as number) ?? 0) * SCALE,
      }} />
    )
  }
  if (comp.type === 'text') {
    return (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        overflow: 'hidden',
      }}>
        <p style={{
          fontSize: Math.max(2, ((props.fontSize as number) ?? 14) * SCALE),
          fontWeight: (props.fontWeight as number) ?? 400,
          color: (props.color as string) ?? '#1A1523',
          margin: 0, lineHeight: 1.2,
          whiteSpace: 'pre-wrap', overflow: 'hidden',
        }}>{(props.content as string) ?? ''}</p>
      </div>
    )
  }
  if (comp.type === 'image') {
    const src = (props.src ?? props.url) as string | undefined
    return src && !props.placeholder ? (
      <img src={src} style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        objectFit: 'cover',
      }} alt="" />
    ) : (
      <div style={{
        position: 'absolute',
        left: comp.position.x * SCALE, top: comp.position.y * SCALE,
        width: comp.size.w * SCALE, height: comp.size.h * SCALE,
        background: 'rgba(124,58,237,0.07)',
      }} />
    )
  }
  return null
}

// 제안 적용 후 컴포넌트 상태 계산
function applyProposalToComponents(
  components: SlideComponent[],
  proposal: AgentProposal,
  targetId: string,
): SlideComponent[] {
  return components.map((comp) => {
    if (comp.id !== targetId) return comp
    const patches = proposal.patches.filter((op) =>
      op.path.startsWith(`/${targetId}`)
    )
    if (patches.length === 0) return comp
    const updated = { ...comp, props: { ...(comp.props as object) } as Record<string, unknown> }
    for (const op of patches) {
      const parts = op.path.replace(/^\//, '').split('/')
      if (parts.length >= 3 && parts[1] === 'properties') {
        ;(updated.props as Record<string, unknown>)[parts[2]] = op.value
      }
    }
    return updated
  })
}

interface Props {
  componentId: string
  onClose: () => void
}

export default function ConflictResolver({ componentId, onClose }: Props) {
  const { conflicts, approveProposal, rejectProposal } = useProposalStore()
  const { presentation, currentSlideIndex } = useSlideStore()
  const [resolving, setResolving] = useState(false)

  const conflict = conflicts.find((c) => c.componentId === componentId)
  const slide = presentation?.slides[currentSlideIndex]
  const allComps = slide?.components ?? []

  if (!conflict || !slide) return null

  const handlePick = async (winner: AgentProposal) => {
    setResolving(true)
    try {
      // 승인: 선택한 제안
      await approveProposal(winner.id)
      // 거절: 나머지 제안들
      for (const p of conflict.proposals) {
        if (p.id !== winner.id) await rejectProposal(p.id)
      }
      onClose()
    } finally {
      setResolving(false)
    }
  }

  const handleKeepCurrent = async () => {
    setResolving(true)
    try {
      for (const p of conflict.proposals) await rejectProposal(p.id)
      onClose()
    } finally {
      setResolving(false)
    }
  }

  const thumbW = SLIDE_W * SCALE

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-[16px] shadow-2xl w-[640px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">⚠️ 컴포넌트 충돌</h2>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              {conflict.proposals.length}개 Agent가 같은 컴포넌트를 수정했습니다. 적용할 버전을 선택하세요.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] hover:bg-[var(--bg-muted)] text-[var(--text-disabled)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Options */}
        <div className="p-6 flex flex-col gap-4">
          {/* Current state */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">현재 상태</p>
            <div
              className="rounded-[10px] border-2 border-[var(--border)] overflow-hidden cursor-pointer hover:border-[var(--text-muted)] transition-colors"
              onClick={handleKeepCurrent}
            >
              <div
                className="relative bg-[#f8fafc]"
                style={{ height: SLIDE_H * SCALE, width: thumbW }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, width: SLIDE_W, height: 540, transform: `scale(${SCALE})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
                  {[...allComps].sort((a, b) => a.zIndex - b.zIndex).map((c) => (
                    <MiniComp key={c.id} comp={c} />
                  ))}
                </div>
              </div>
              <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--text)]">현재 유지 (모든 제안 거절)</span>
                <span className="text-[11px] text-[var(--text-disabled)]">클릭하여 선택</span>
              </div>
            </div>
          </div>

          {/* Each proposal */}
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">제안된 버전들</p>
          <div className="grid grid-cols-2 gap-4">
            {conflict.proposals.map((proposal) => {
              const previewComps = applyProposalToComponents(allComps, proposal, componentId)
              return (
                <div
                  key={proposal.id}
                  className={cn(
                    'rounded-[10px] border-2 border-[var(--border)] overflow-hidden cursor-pointer transition-all',
                    'hover:border-[var(--accent)] hover:shadow-[0_0_0_2px_var(--accent-subtle)]',
                    resolving && 'opacity-50 pointer-events-none'
                  )}
                  onClick={() => handlePick(proposal)}
                >
                  <div
                    className="relative bg-[#f8fafc]"
                    style={{ height: SLIDE_H * SCALE, width: '100%' }}
                  >
                    <div style={{
                      position: 'absolute', top: 0, left: 0,
                      width: SLIDE_W, height: 540,
                      transform: `scale(${SCALE})`, transformOrigin: 'top left',
                      pointerEvents: 'none'
                    }}>
                      {[...previewComps].sort((a, b) => a.zIndex - b.zIndex).map((c) => (
                        <MiniComp key={c.id} comp={c} />
                      ))}
                    </div>
                  </div>
                  <div className="px-3 py-2.5 border-t border-[var(--border)]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent-subtle)] px-2 py-0.5 rounded-full">
                        {proposal.agent_name}
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--text)] leading-relaxed line-clamp-2">
                      {proposal.summary || '변경사항 적용'}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-[var(--accent)] text-[11px] font-medium">
                      <CheckCircle size={11} />
                      이 버전 사용
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const SLIDE_H = 540
