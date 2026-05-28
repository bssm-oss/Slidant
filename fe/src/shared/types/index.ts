// 슬라이드 컴포넌트 타입
export type ComponentType = 'text' | 'image' | 'chart' | 'layout' | 'shape'

export interface SlideComponent {
  id: string
  type: ComponentType
  position: { x: number; y: number }
  size: { w: number; h: number }
  props: Record<string, unknown>
  zIndex: number
}

export interface Slide {
  id: string
  order: number
  components: SlideComponent[]
  thumbnail?: string
}

export interface Presentation {
  id: string
  title: string
  slides: Slide[]
  createdAt: string
  updatedAt: string
  ownerId: string
}

// Agent 타입
export type AgentRole = 'content' | 'design' | 'layout' | 'custom'
export type AgentStatus = 'idle' | 'running' | 'done' | 'error' | 'conflict'

export interface Agent {
  id: string
  name: string
  role: AgentRole
  status: AgentStatus
  description?: string
}

export interface AgentLog {
  id: string
  agentId: string
  agentName: string
  message: string
  timestamp: string
  type: 'info' | 'success' | 'error' | 'conflict'
}

// Diff 타입
export interface ComponentDiff {
  componentId: string
  componentType: ComponentType
  before: Record<string, unknown>
  after: Record<string, unknown>
  agentId: string
  agentName: string
}
