import { create } from 'zustand'
import type { Presentation, Slide, Agent, AgentLog, AgentStatus } from '@/shared/types'
import { api } from '@/shared/lib/apiClient'
import { runAgent } from '@/shared/lib/agentRunApi'
import { wsClient } from '@/shared/lib/wsClient'

interface EditorState {
  presentation: Presentation | null
  currentSlideIndex: number
  selectedComponentId: string | null
  agents: Agent[]
  agentLogs: AgentLog[]
  overallStatus: AgentStatus
  isCommandPaletteOpen: boolean
  activeRightTab: 'agent' | 'properties'
  isTitleEditing: boolean

  loadPresentation: (id: string) => Promise<void>
  loadAgentLogs: (projectId: string) => Promise<void>
  connectWs: (projectId: string) => () => void
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  addSlide: () => Promise<void>
  saveTitle: (title: string) => Promise<void>
  updateTitle: (title: string) => void
  setTitleEditing: (v: boolean) => void
  runAgent: (command: string, agentRole?: string) => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  presentation: null,
  currentSlideIndex: 0,
  selectedComponentId: null,
  agents: [
    { id: 'sys-content', name: 'ContentAgent', role: 'content', status: 'idle', description: '텍스트 콘텐츠 생성 및 편집' },
    { id: 'sys-design',  name: 'DesignAgent',  role: 'design',  status: 'idle', description: '시각 디자인 및 스타일 적용' },
    { id: 'sys-layout',  name: 'LayoutAgent',  role: 'layout',  status: 'idle', description: '컴포넌트 배치 및 레이아웃 구성' },
  ],
  agentLogs: [],
  overallStatus: 'idle',
  isCommandPaletteOpen: false,
  activeRightTab: 'agent',
  isTitleEditing: false,

  loadPresentation: async (id) => {
    try {
      const { fetchProjectWithSlides } = await import('@/shared/lib/projectApi')
      const ppt = await fetchProjectWithSlides(id)
      set({ presentation: ppt })
    } catch (e) {
      console.error('loadPresentation failed', e)
    }
  },

  loadAgentLogs: async (projectId) => {
    try {
      const { fetchAgentLogs } = await import('@/shared/lib/agentRunApi')
      const logs = await fetchAgentLogs(projectId)
      const agentLogs: AgentLog[] = logs.map((l) => ({
        id: l.id,
        agentId: '',
        agentName: 'Agent',
        message: `${l.status === 'done' ? '완료' : l.status === 'error' ? '오류' : '실행 중'} (${l.started_at?.slice(11, 19) ?? ''})`,
        timestamp: l.started_at ?? new Date().toISOString(),
        type: l.status === 'done' ? 'success' : l.status === 'error' ? 'error' : 'info',
      }))
      set({ agentLogs })
    } catch {}
  },

  connectWs: (projectId) => {
    wsClient.connect(projectId)
    const unsubscribe = wsClient.onMessage((msg) => {
      const type = msg.type as string

      if (type === 'agent_started') {
        const role = (msg.role as string) ?? 'content'
        const agentName = `${role.charAt(0).toUpperCase()}${role.slice(1)}Agent`
        set((s) => ({
          overallStatus: 'running',
          agents: s.agents.map((a) =>
            a.name === agentName
              ? { ...a, status: 'running', currentTask: msg.command as string, taskProgress: 0 }
              : a,
          ),
          agentLogs: [
            {
              id: `log-${Date.now()}`,
              agentId: role,
              agentName,
              message: `"${msg.command}" 작업 시작...`,
              timestamp: new Date().toISOString(),
              type: 'info',
            },
            ...s.agentLogs,
          ],
        }))
      }

      if (type === 'agent_done') {
        set((s) => ({
          overallStatus: 'idle',
          agents: s.agents.map((a) =>
            a.status === 'running'
              ? { ...a, status: 'done', currentTask: undefined, taskProgress: 100 }
              : a,
          ),
          agentLogs: [
            {
              id: `log-${Date.now()}`,
              agentId: '',
              agentName: 'Agent',
              message: '작업 완료',
              timestamp: new Date().toISOString(),
              type: 'success',
            },
            ...s.agentLogs,
          ],
          activeRightTab: 'agent',
        }))
        // 슬라이드 다시 불러오기 (Agent가 컴포넌트 수정했을 수 있음)
        const ppt = get().presentation
        if (ppt) get().loadPresentation(ppt.id)
      }

      if (type === 'agent_error') {
        set((s) => ({
          overallStatus: 'idle',
          agents: s.agents.map((a) =>
            a.status === 'running' ? { ...a, status: 'error', currentTask: undefined } : a,
          ),
          agentLogs: [
            {
              id: `log-${Date.now()}`,
              agentId: '',
              agentName: 'Agent',
              message: `오류: ${msg.error ?? '알 수 없는 오류'}`,
              timestamp: new Date().toISOString(),
              type: 'error',
            },
            ...s.agentLogs,
          ],
        }))
      }
    })
    return unsubscribe
  },

  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),

  selectComponent: (id) => set({ selectedComponentId: id }),

  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  setTitleEditing: (v) => set({ isTitleEditing: v }),

  updateTitle: (title) => set((s) => ({
    presentation: s.presentation ? { ...s.presentation, title } : null,
  })),

  saveTitle: async (title) => {
    const ppt = get().presentation
    if (!ppt) return
    try {
      const { updateProject } = await import('@/shared/lib/projectApi')
      await updateProject(ppt.id, title)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, title } : null,
      }))
    } catch (e) {
      console.error('saveTitle failed', e)
      throw e
    }
  },

  addSlide: async () => {
    const ppt = get().presentation
    if (!ppt) return
    try {
      const res = await api.post<{ id: string; order: number; title: string | null }>(`/projects/${ppt.id}/slides`, {})
      const newSlide: Slide = { id: res.id, order: res.order, components: [] }
      set((s) => ({
        presentation: s.presentation
          ? { ...s.presentation, slides: [...s.presentation.slides, newSlide] }
          : null,
        currentSlideIndex: (s.presentation?.slides.length ?? 0),
      }))
    } catch (e) {
      console.error('addSlide failed', e)
    }
  },

  runAgent: async (command, agentRole = 'content') => {
    const ppt = get().presentation
    const slideIndex = get().currentSlideIndex
    const currentSlide = ppt?.slides[slideIndex]
    if (!ppt || !currentSlide) return

    set({ overallStatus: 'running', isCommandPaletteOpen: false, activeRightTab: 'agent' })

    try {
      await runAgent({
        project_id: ppt.id,
        slide_id: currentSlide.id,
        command,
        agent_role: agentRole,
      })
    } catch (e: any) {
      set({ overallStatus: 'idle' })
      throw e
    }
  },
}))
