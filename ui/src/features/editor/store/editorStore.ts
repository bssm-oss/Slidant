import { create } from 'zustand'
import type { Presentation, Slide, Agent, AgentLog, AgentStatus } from '@/shared/types'
import { mockAgents, mockAgentLogs } from '@/shared/mock/agents'

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
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  addSlide: () => void
  updateTitle: (title: string) => void
  setTitleEditing: (v: boolean) => void
  runAgentSimulation: (command: string) => void
}

export const useEditorStore = create<EditorState>((set, _get) => ({
  presentation: null,
  currentSlideIndex: 0,
  selectedComponentId: null,
  agents: mockAgents,
  agentLogs: mockAgentLogs,
  overallStatus: 'running',
  isCommandPaletteOpen: false,
  activeRightTab: 'agent',
  isTitleEditing: false,

  loadPresentation: async (id) => {
    try {
      const { fetchProjectWithSlides } = await import('@/shared/lib/projectApi')
      const ppt = await fetchProjectWithSlides(id)
      set({ presentation: ppt })
    } catch {
      // fallback to mock during development
      const { getMockPresentation } = await import('@/shared/mock/presentations')
      set({ presentation: getMockPresentation(id) ?? null })
    }
  },

  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),

  selectComponent: (id) => set({ selectedComponentId: id }),

  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  setTitleEditing: (v) => set({ isTitleEditing: v }),

  updateTitle: (title) => set((s) => ({
    presentation: s.presentation ? { ...s.presentation, title } : null,
  })),

  addSlide: () => set((s) => {
    if (!s.presentation) return s
    const newSlide: Slide = {
      id: `slide-${Date.now()}`,
      order: s.presentation.slides.length,
      components: [],
    }
    return {
      presentation: { ...s.presentation, slides: [...s.presentation.slides, newSlide] },
      currentSlideIndex: s.presentation.slides.length,
    }
  }),

  runAgentSimulation: (command: string) => {
    const agentNames = ['ContentAgent', 'DesignAgent', 'LayoutAgent']
    const agentName = agentNames[Math.floor(Math.random() * agentNames.length)]

    set((s) => ({
      overallStatus: 'running',
      agents: s.agents.map((a) =>
        a.name === agentName
          ? { ...a, status: 'running', currentTask: command, taskProgress: 0 }
          : a,
      ),
      agentLogs: [
        { id: `log-${Date.now()}`, agentId: agentName.toLowerCase(), agentName, message: `"${command}" 작업 시작...`, timestamp: new Date().toISOString(), type: 'info' },
        ...s.agentLogs,
      ],
    }))

    // 진행률 시뮬레이션
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 25) + 10
      if (progress >= 90) { clearInterval(interval); return }
      set((s) => ({
        agents: s.agents.map((a) =>
          a.name === agentName ? { ...a, taskProgress: Math.min(progress, 90) } : a,
        ),
      }))
    }, 400)

    setTimeout(() => {
      clearInterval(interval)
      set((s) => ({
        overallStatus: 'idle',
        agents: s.agents.map((a) =>
          a.name === agentName
            ? { ...a, status: 'done', currentTask: undefined, taskProgress: 100 }
            : a,
        ),
        agentLogs: [
          { id: `log-${Date.now()}`, agentId: agentName.toLowerCase(), agentName, message: `"${command}" 작업 완료`, timestamp: new Date().toISOString(), type: 'success' },
          ...s.agentLogs,
        ],
        activeRightTab: 'agent',
      }))
    }, 2000)
  },
}))

