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

export interface AgentRunHistoryItem {
  id: string
  status: 'running' | 'done' | 'error' | 'cancelled' | string
  agent_name: string | null
  task_description: string | null
  result_summary: string | null
  affected_slide_id: string | null
  started_at: string | null
  finished_at: string | null
}

export const fetchAgentRuns = (projectId: string) =>
  api.get<AgentRunHistoryItem[]>(`/agent/logs/${projectId}`)
