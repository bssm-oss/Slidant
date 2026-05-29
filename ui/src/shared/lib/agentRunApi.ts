import { api } from './apiClient'

export interface AgentRunRequest {
  project_id: string
  slide_id: string
  command: string
  agent_role: string
}

export interface AgentRunResponse {
  id: string
  project_id: string
  status: string
  started_at: string | null
  finished_at: string | null
}

export interface AgentLogEntry {
  id: string
  status: string
  started_at: string | null
  finished_at: string | null
}

export const runAgent = (body: AgentRunRequest) =>
  api.post<AgentRunResponse>('/agent/run', body)

export const fetchAgentLogs = (projectId: string) =>
  api.get<AgentLogEntry[]>(`/agent/logs/${projectId}`)
