import { create } from 'zustand'
import type { AgentProposal } from '@/shared/types'
import { useSlideStore } from './slideStore'

interface ProposalState {
  proposals: AgentProposal[]

  setProposals: (proposals: AgentProposal[]) => void
  addProposal: (proposal: AgentProposal) => void
  approveProposal: (id: string) => Promise<void>
  rejectProposal: (id: string) => Promise<void>
}

export const useProposalStore = create<ProposalState>((set) => ({
  proposals: [],

  setProposals: (proposals) => set({ proposals }),

  addProposal: (proposal) => set((s) => ({ proposals: [...s.proposals, proposal] })),

  approveProposal: async (id) => {
    const ppt = useSlideStore.getState().presentation
    if (!ppt) return
    try {
      const { approveProposal: apiApprove } = await import('@/shared/lib/proposalApi')
      await apiApprove(id)
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }))
      await useSlideStore.getState().loadPresentation(ppt.id)
    } catch (e) {
      console.error('approveProposal failed', e)
    }
  },

  rejectProposal: async (id) => {
    try {
      const { rejectProposal: apiReject } = await import('@/shared/lib/proposalApi')
      await apiReject(id)
      set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) }))
    } catch (e) {
      console.error('rejectProposal failed', e)
    }
  },
}))
