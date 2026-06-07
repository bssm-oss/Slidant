import { create } from 'zustand'
import type { ChatSession } from '@/shared/types'
import { fetchSessions, createSession as apiCreateSession, deleteSession as apiDeleteSession } from '@/shared/lib/chatSessionApi'
import { getMe } from '@/shared/lib/auth'

interface SessionState {
  sessions: ChatSession[]
  currentSessionId: string | null
  currentUserId: string | null

  loadSessions: (projectId: string) => Promise<void>
  createSession: (projectId: string, name?: string) => Promise<ChatSession>
  deleteSession: (projectId: string, sessionId: string) => Promise<void>
  setCurrentSession: (id: string | null) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentUserId: null,

  loadSessions: async (projectId) => {
    try {
      const [sessions, me] = await Promise.all([
        fetchSessions(projectId),
        get().currentUserId ? Promise.resolve(null) : getMe().catch(() => null),
      ])
      set({ sessions, ...(me ? { currentUserId: me.id } : {}) })
      if (sessions.length > 0 && !get().currentSessionId) {
        const mySession = sessions.find((s) => s.user_id === (get().currentUserId || me?.id))
        set({ currentSessionId: mySession?.id ?? sessions[0].id })
      }
    } catch (e) {
      console.error('loadSessions failed', e)
    }
  },

  createSession: async (projectId, name = '새 세션') => {
    const session = await apiCreateSession(projectId, name)
    set((s) => ({
      sessions: [...s.sessions, session],
      currentSessionId: session.id,
    }))
    return session
  },

  deleteSession: async (projectId, sessionId) => {
    await apiDeleteSession(projectId, sessionId)
    set((s) => {
      const remaining = s.sessions.filter((ss) => ss.id !== sessionId)
      const newCurrentId = s.currentSessionId === sessionId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : s.currentSessionId
      return { sessions: remaining, currentSessionId: newCurrentId }
    })
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),
}))
