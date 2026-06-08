import { create } from 'zustand'
import type { AgentProposal, ComponentConflict } from '@/shared/types'
import { useSlideStore } from './slideStore'

function detectConflicts(proposals: AgentProposal[]): ComponentConflict[] {
  const pending = proposals.filter((p) => p.status === 'pending')
  const compToProposals = new Map<string, AgentProposal[]>()

  for (const proposal of pending) {
    for (const patch of proposal.patches) {
      const parts = patch.path.replace(/^\//, '').split('/')
      const compId = parts[0]
      // 새 컴포넌트 추가(/-) 또는 슬라이드 추가는 충돌 아님
      if (!compId || compId === '-' || compId === '' || compId === 'slides') continue
      const existing = compToProposals.get(compId) ?? []
      if (!existing.find((p) => p.id === proposal.id)) {
        compToProposals.set(compId, [...existing, proposal])
      }
    }
  }

  const conflicts: ComponentConflict[] = []
  for (const [componentId, props] of compToProposals) {
    if (props.length >= 2) conflicts.push({ componentId, proposals: props })
  }
  return conflicts
}

interface ProposalState {
  proposals: AgentProposal[]
  conflicts: ComponentConflict[]

  setProposals: (proposals: AgentProposal[]) => void
  addProposal: (proposal: AgentProposal) => void
  mergeProposalsForSlide: (slideId: string, slideProposals: AgentProposal[]) => void
  approveProposal: (id: string, acceptedIds?: string[] | null, partial?: boolean) => Promise<void>
  rejectProposal: (id: string) => Promise<void>
  resolveProposal: (id: string) => void
}

export const useProposalStore = create<ProposalState>((set) => ({
  proposals: [],
  conflicts: [],

  setProposals: (proposals) => set({ proposals, conflicts: detectConflicts(proposals) }),

  mergeProposalsForSlide: (slideId, slideProposals) => set((s) => {
    const others = s.proposals.filter((p) => p.slide_id !== slideId)
    const merged = [...others, ...slideProposals]
    return { proposals: merged, conflicts: detectConflicts(merged) }
  }),

  addProposal: (proposal) => set((s) => {
    const proposals = [...s.proposals, proposal]
    return { proposals, conflicts: detectConflicts(proposals) }
  }),

  approveProposal: async (id, acceptedIds?, partial = false) => {
    const ppt = useSlideStore.getState().presentation
    if (!ppt) return
    try {
      // 승인 전 상태 캡처 (컴포넌트 겹침 비교용)
      const thisProposal = useProposalStore.getState().proposals.find((p) => p.id === id)
      const preApprovalHtml = thisProposal
        ? ppt.slides.find((s) => s.id === thisProposal.slide_id)?.html_content ?? ''
        : ''

      const { approveProposal: apiApprove } = await import('@/shared/lib/proposalApi')
      await apiApprove(id, acceptedIds ?? null, partial)
      if (!partial) {
        set((s) => {
          const proposals = s.proposals.filter((p) => p.id !== id)
          return { proposals, conflicts: detectConflicts(proposals) }
        })
      }

      // 승인된 proposal과 컴포넌트 겹치는 다른 pending proposals 자동 reject
      if (thisProposal?.html_content && preApprovalHtml) {
        const { computeChangedComponentIds } = await import('@/shared/lib/slideHtml')
        const { rejectProposal: apiReject } = await import('@/shared/lib/proposalApi')
        const approvedChanged = computeChangedComponentIds(preApprovalHtml, thisProposal.html_content)

        if (approvedChanged.size > 0) {
          const conflicting = useProposalStore.getState().proposals.filter((p) => {
            if (p.id === id || p.slide_id !== thisProposal.slide_id || p.status !== 'pending' || !p.html_content) return false
            const pChanged = computeChangedComponentIds(preApprovalHtml, p.html_content)
            return [...pChanged].some((cid) => approvedChanged.has(cid))
          })

          if (conflicting.length > 0) {
            await Promise.all(conflicting.map((p) => apiReject(p.id).catch(() => {})))
            set((s) => {
              const conflictIds = new Set(conflicting.map((p) => p.id))
              const proposals = s.proposals.filter((p) => !conflictIds.has(p.id))
              return { proposals, conflicts: detectConflicts(proposals) }
            })
          }
        }
      }

      await useSlideStore.getState().loadPresentation(ppt.id)
    } catch (e) {
      console.error('approveProposal failed', e)
    }
  },

  // 다른 커넥션에서 이미 승인/거절된 proposal — API 재호출 없이 로컬 목록만 정리
  resolveProposal: (id) => set((s) => {
    const proposals = s.proposals.filter((p) => p.id !== id)
    return { proposals, conflicts: detectConflicts(proposals) }
  }),

  rejectProposal: async (id) => {
    const { rejectProposal: apiReject } = await import('@/shared/lib/proposalApi')
    await apiReject(id)
    set((s) => {
      const proposals = s.proposals.filter((p) => p.id !== id)
      return { proposals, conflicts: detectConflicts(proposals) }
    })
  },
}))
