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
  title?: string
  components: SlideComponent[]
  html_content?: string | null
  thumbnail?: string
}

export interface PresentationTheme {
  palette: string
  bg: string
  accent: string
  text: string
  text2: string
  font: string
}

export interface Presentation {
  id: string
  title: string
  slides: Slide[]
  slideCount?: number
  theme?: PresentationTheme | null
  createdAt: string
  updatedAt: string
  ownerId: string
  myRole: 'owner' | 'editor' | 'viewer'
  shareToken?: string | null
}

// Agent 타입
export type AgentRole = 'content' | 'design' | 'layout' | 'custom'
export type AgentStatus = 'idle' | 'running' | 'done' | 'error' | 'conflict'

export interface Agent {
  id: string
  definitionId?: string   // DB AgentDefinition.id
  name: string
  role: string
  status: AgentStatus
  description?: string
  currentTask?: string
  taskProgress?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  agentName?: string
  agentDefinitionId?: string
  timestamp: string
  type: 'info' | 'success' | 'error'
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

export interface ChatSession {
  id: string
  project_id: string
  name: string
  user_id?: string | null
  user_email?: string | null
  created_at: string
}

// JSON Patch / Proposal 타입
export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: unknown
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected'

export interface AgentProposal {
  id: string
  slide_id: string
  agent_run_id: string
  agent_name: string
  command: string
  patches: JsonPatchOp[]
  summary: string
  html_content?: string | null
  affected_component_ids?: { changed: string[]; deleted: string[] }
  status: ProposalStatus
  created_at: string
}

// 컴포넌트 단위 충돌 타입
export interface ComponentConflict {
  componentId: string
  proposals: AgentProposal[]   // 이 컴포넌트를 동시에 수정하는 제안들 (2개 이상)
}
