import type { Agent, AgentLog } from '@/shared/types'

export const mockAgents: Agent[] = [
  { id: 'agent-1', name: 'ContentAgent', role: 'content', status: 'idle', description: '텍스트 콘텐츠 생성 및 편집' },
  { id: 'agent-2', name: 'DesignAgent', role: 'design', status: 'running', description: '시각 디자인 및 스타일 적용' },
  { id: 'agent-3', name: 'LayoutAgent', role: 'layout', status: 'done', description: '컴포넌트 배치 및 레이아웃 구성' },
]

export const mockAgentLogs: AgentLog[] = [
  { id: 'log-1', agentId: 'agent-3', agentName: 'LayoutAgent', message: '슬라이드 1 레이아웃 구성 완료', timestamp: '2024-10-22T11:00:00Z', type: 'success' },
  { id: 'log-2', agentId: 'agent-2', agentName: 'DesignAgent', message: '타이포그래피 스타일 적용 중...', timestamp: '2024-10-22T11:01:00Z', type: 'info' },
  { id: 'log-3', agentId: 'agent-1', agentName: 'ContentAgent', message: '텍스트 내용 개선 제안 준비 완료', timestamp: '2024-10-22T11:02:00Z', type: 'info' },
]
