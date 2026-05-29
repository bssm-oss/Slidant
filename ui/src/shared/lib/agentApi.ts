import { api } from './apiClient'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  is_system: boolean
  config: Record<string, unknown>
}

export interface AgentListResponse {
  system: AgentDefinition[]
  custom: AgentDefinition[]
}

export interface AgentCreateRequest {
  name: string
  role: string
  description: string
  config?: Record<string, unknown>
}

export const fetchAgents = () => api.get<AgentListResponse>('/agent-definitions')

export const createAgent = (body: AgentCreateRequest) =>
  api.post<AgentDefinition>('/agent-definitions', body)

export const deleteAgent = (id: string) =>
  api.delete(`/agent-definitions/${id}`)
