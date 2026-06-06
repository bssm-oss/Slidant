import { api } from './apiClient'
import type { AgentProposal } from '@/shared/types'

export const fetchPendingProposals = (_projectId: string, slideId: string): Promise<AgentProposal[]> =>
  api.get(`/proposals/by-slide/${slideId}?status_filter=pending`)

export const approveProposal = (proposalId: string, acceptedIds?: string[] | null, partial = false): Promise<void> =>
  api.post(`/proposals/${proposalId}/approve`, { accepted_ids: acceptedIds ?? null, partial })

export const rejectProposal = (proposalId: string): Promise<void> =>
  api.post(`/proposals/${proposalId}/reject`, {})
