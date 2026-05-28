import { create } from 'zustand'
import type { Presentation, Slide, Agent, AgentLog, AgentStatus } from '@/shared/types'
import { getMockPresentation } from '@/shared/mock/presentations'
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

  loadPresentation: (id: string) => void
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

  loadPresentation: (id) => set({ presentation: getMockPresentation(id) ?? null }),

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

    // 상태 running으로
    set((s) => ({
      overallStatus: 'running',
      agents: s.agents.map((a) =>
        a.name === agentName ? { ...a, status: 'running' } : a,
      ),
      agentLogs: [
        {
          id: `log-${Date.now()}`,
          agentId: agentName.toLowerCase(),
          agentName,
          message: `"${command}" 작업 시작...`,
          timestamp: new Date().toISOString(),
          type: 'info',
        },
        ...s.agentLogs,
      ],
    }))

    // 2초 후 완료
    setTimeout(() => {
      set((s) => ({
        overallStatus: 'idle',
        agents: s.agents.map((a) =>
          a.name === agentName ? { ...a, status: 'done' } : a,
        ),
        agentLogs: [
          {
            id: `log-${Date.now()}`,
            agentId: agentName.toLowerCase(),
            agentName,
            message: `"${command}" 작업 완료`,
            timestamp: new Date().toISOString(),
            type: 'success',
          },
          ...s.agentLogs,
        ],
        activeRightTab: 'agent',
      }))
    }, 2000)
  },
}))

