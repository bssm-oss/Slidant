import { api } from './apiClient'

export interface AgentRunRequest {
  project_id: string
  slide_id: string
  command: string
  agent_role: string
  agent_definition_id?: string
  session_id?: string
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

export interface ChatMessageEntry {
  id: string
  role: 'user' | 'agent'
  content: string
  agent_run_id: string | null
  agent_definition_id: string | null
  agent_name: string | null
  affected_component_ids: string[]
  slide_id: string | null
  created_at: string
  message_type: string | null
  metadata: Record<string, unknown> | null
}

export const runAgent = (body: AgentRunRequest) =>
  api.post<AgentRunResponse>('/agent/run', body)

export const fetchAgentLogs = (projectId: string) =>
  api.get<AgentLogEntry[]>(`/agent/logs/${projectId}`)

export const fetchChatHistory = (projectId: string, sessionId?: string) => {
  const params = sessionId ? `?session_id=${sessionId}` : ''
  return api.get<ChatMessageEntry[]>(`/agent/chat/${projectId}${params}`)
}

export const saveStepsMessage = (
  projectId: string,
  body: { agent_name: string; steps: unknown[]; agent_definition_id?: string; session_id?: string; created_at?: string },
) => api.post<{ id: string }>(`/agent/chat/${projectId}/steps`, body)
