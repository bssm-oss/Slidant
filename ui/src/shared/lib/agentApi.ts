import { api } from './apiClient'

export interface AgentDefinition {
  id: string
  name: string
  role: string
  is_system: boolean
  project_id: string | null
  config: Record<string, unknown>
}

export interface AgentListResponse {
  system: AgentDefinition[]
  library: AgentDefinition[]
  project: AgentDefinition[]
}

export interface AgentCreateRequest {
  name: string
  role: string
  description: string
  config?: Record<string, unknown>
  project_id?: string | null
}

export interface AgentUpdateRequest {
  name: string
  description: string
  config?: Record<string, unknown>
}

export const fetchAgents = (projectId?: string) =>
  api.get<AgentListResponse>(`/agent-definitions${projectId ? `?project_id=${projectId}` : ''}`)

export const createAgent = (body: AgentCreateRequest) =>
  api.post<AgentDefinition>('/agent-definitions', body)

export const updateAgent = (id: string, body: AgentUpdateRequest) =>
  api.patch<AgentDefinition>(`/agent-definitions/${id}`, body)

export const deleteAgent = (id: string) =>
  api.delete<void>(`/agent-definitions/${id}`)

export const cloneAgentToProject = (id: string, projectId: string) =>
  api.post<AgentDefinition>(`/agent-definitions/${id}/clone`, { project_id: projectId })
