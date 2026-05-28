import { create } from 'zustand'
import type { Agent, AgentLog, AgentStatus } from '@/shared/types'
import type { Presentation } from '@/shared/types'
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

  // actions
  loadPresentation: (id: string) => void
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  setCommandPaletteOpen: (open: boolean) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
}

export const useEditorStore = create<EditorState>((set) => ({
  presentation: null,
  currentSlideIndex: 0,
  selectedComponentId: null,
  agents: mockAgents,
  agentLogs: mockAgentLogs,
  overallStatus: 'running',
  isCommandPaletteOpen: false,
  activeRightTab: 'agent',

  loadPresentation: (id) => set({ presentation: getMockPresentation(id) ?? null }),
  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),
  selectComponent: (id) => set({ selectedComponentId: id }),
  setCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
  setActiveRightTab: (tab) => set({ activeRightTab: tab }),
}))
