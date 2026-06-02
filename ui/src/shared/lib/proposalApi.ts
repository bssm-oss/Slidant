import { api } from './apiClient'
import type { AgentProposal } from '@/shared/types'

export const fetchPendingProposals = (projectId: string, slideId: string): Promise<AgentProposal[]> =>
  api.get(`/projects/${projectId}/slides/${slideId}/proposals?status=pending`)

export const approveProposal = (proposalId: string): Promise<void> =>
  api.post(`/proposals/${proposalId}/approve`, {})

export const rejectProposal = (proposalId: string): Promise<void> =>
  api.post(`/proposals/${proposalId}/reject`, {})
