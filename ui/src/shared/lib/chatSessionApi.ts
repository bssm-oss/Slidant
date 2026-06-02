import { api } from './apiClient'
import type { ChatSession } from '@/shared/types'

export async function fetchSessions(projectId: string): Promise<ChatSession[]> {
  return api.get(`/projects/${projectId}/sessions`)
}

export async function createSession(projectId: string, name: string): Promise<ChatSession> {
  return api.post(`/projects/${projectId}/sessions`, { name })
}

export async function renameSession(projectId: string, sessionId: string, name: string): Promise<ChatSession> {
  return api.patch(`/projects/${projectId}/sessions/${sessionId}`, { name })
}

export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  return api.delete(`/projects/${projectId}/sessions/${sessionId}`)
}
