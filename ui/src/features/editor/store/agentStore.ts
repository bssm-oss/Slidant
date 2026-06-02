/** 스트리밍 중인 JSON 텍스트에서 ops 배열의 완성된 객체만 추출 */
function extractCompleteOps(text: string): any[] {
  const opsIdx = text.indexOf('"ops"')
  if (opsIdx === -1) return []
  const arrStart = text.indexOf('[', opsIdx)
  if (arrStart === -1) return []

  const content = text.slice(arrStart + 1)
  const ops: any[] = []
  let depth = 0
  let objStart = -1
  let inString = false
  let escape = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') { if (depth === 0) objStart = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && objStart !== -1) {
        try { ops.push(JSON.parse(content.slice(objStart, i + 1))) } catch {}
        objStart = -1
      }
    }
  }
  return ops
}

import { create } from 'zustand'
import type { Agent, AgentLog, AgentStatus, ChatMessage } from '@/shared/types'
import { runAgent as apiRunAgent } from '@/shared/lib/agentRunApi'
import { sseClient } from '@/shared/lib/sseClient'
import { useSlideStore } from './slideStore'
import { useProposalStore } from './proposalStore'

interface AgentState {
  agents: Agent[]
  agentLogs: AgentLog[]
  chatMessages: ChatMessage[]
  selectedAgentDefinitionId: string | null
  runningAgentIds: Set<string>
  conflictComponentIds: Set<string>
  overallStatus: AgentStatus
  activeRightTab: 'agent' | 'properties'

  loadAgents: (projectId?: string) => Promise<void>
  loadChatHistory: (projectId: string) => Promise<void>
  loadAgentLogs: (projectId: string) => Promise<void>
  connectWs: (projectId: string) => () => void
  selectChatAgent: (definitionId: string | null) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  sendMessage: (command: string) => Promise<void>
  runAgent: (command: string, agentRole?: string, agentDefinitionId?: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  agentLogs: [],
  chatMessages: [],
  selectedAgentDefinitionId: null,
  runningAgentIds: new Set(),
  conflictComponentIds: new Set(),
  overallStatus: 'idle',
  activeRightTab: 'agent',

  loadAgents: async (projectId) => {
    try {
      const { fetchAgents } = await import('@/shared/lib/agentApi')
      const data = await fetchAgents(projectId)
      const toAgent = (prefix: string) => (a: any): Agent => ({
        id: `${prefix}-${a.id}`,
        definitionId: a.id,
        name: a.name,
        role: a.role,
        status: 'idle' as AgentStatus,
        description: (a.config?.description as string) ?? '',
      })
      const allAgents: Agent[] = [
        ...data.system.map(toAgent('sys')),
        ...(data.project ?? []).map(toAgent('proj')),
      ]
      set({ agents: allAgents })
    } catch {}
  },

  loadChatHistory: async (projectId) => {
    try {
      const { fetchChatHistory } = await import('@/shared/lib/agentRunApi')
      const msgs = await fetchChatHistory(projectId)
      const chatMessages: ChatMessage[] = msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        agentName: m.agent_name ?? (m.role === 'agent' ? 'Agent' : undefined),
        agentDefinitionId: m.agent_definition_id ?? undefined,
        timestamp: m.created_at,
        type: m.content.startsWith('오류') ? 'error' : m.role === 'agent' ? 'success' : 'info',
      }))
      set({ chatMessages })
    } catch {}
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
    sseClient.connect(projectId)
    const unsubscribe = sseClient.onMessage((msg) => {
      const type = msg.type as string

      if (type === 'agent_started') {
        const role = (msg.role as string) ?? 'content'
        const agentName = (msg.agent_name as string) ?? `${role.charAt(0).toUpperCase()}${role.slice(1)}Agent`
        set((s) => {
          const runningAgent = s.agents.find((a) => a.name === agentName)
          const newRunningIds = new Set(s.runningAgentIds)
          if (runningAgent?.definitionId) newRunningIds.add(runningAgent.definitionId)
          return {
            overallStatus: 'running',
            runningAgentIds: newRunningIds,
            agents: s.agents.map((a) =>
              a.name === agentName
                ? { ...a, status: 'running', currentTask: msg.command as string, taskProgress: 0 }
                : a,
            ),
          }
        })
      }

      if (type === 'agent_node_event') {
        const eventType = msg.event_type as string
        const message = msg.message as string
        set((s) => {
          const streamingAgent = s.agents.find((a) => a.status === 'running')
          if (!streamingAgent) return s
          const nodeId = `node-event-${streamingAgent.definitionId}`
          const isStart = eventType === 'node_start'
          const existing = s.chatMessages.find((m) => m.id === nodeId)
          if (existing) {
            return {
              chatMessages: s.chatMessages.map((m) =>
                m.id === nodeId
                  ? { ...m, content: message, type: isStart ? 'info' as const : 'success' as const }
                  : m
              ),
            }
          }
          return {
            chatMessages: [
              ...s.chatMessages,
              {
                id: nodeId,
                role: 'agent' as const,
                content: message,
                agentName: streamingAgent.name,
                agentDefinitionId: streamingAgent.definitionId,
                timestamp: new Date().toISOString(),
                type: 'info' as const,
              },
            ],
          }
        })
      }

      if (type === 'agent_token') {
        const accumulated = (msg.accumulated as string) ?? ''
        const streamOps = extractCompleteOps(accumulated)

        const displayText = (() => {
          const t = accumulated.trim()
          if (t.startsWith('{') && t.endsWith('}')) {
            try {
              const p = JSON.parse(t)
              return p.action_plan ?? p.plan ?? p.summary ?? t
            } catch {}
          }
          const m = t.match(/"action_plan"\s*:\s*"([\s\S]*?)(?=",|\s*}|$)/)
          if (m) return m[1].replace(/\\n/g, '\n')
          return t
        })()

        set((s) => {
          const streamingAgent = s.agents.find((a) => a.status === 'running')
          if (!streamingAgent) return s

          const streamId = `streaming-${streamingAgent.definitionId}`
          const existing = s.chatMessages.find((m) => m.id === streamId)
          const newMessages = existing
            ? s.chatMessages.map((m) => m.id === streamId ? { ...m, content: displayText } : m)
            : [
                ...s.chatMessages,
                {
                  id: streamId,
                  role: 'agent' as const,
                  content: displayText,
                  agentName: streamingAgent.name,
                  agentDefinitionId: streamingAgent.definitionId,
                  timestamp: new Date().toISOString(),
                  type: 'info' as const,
                },
              ]

          // 슬라이드 preview: slideStore에서 직접 업데이트
          if (streamOps.length === 0) {
            return { chatMessages: newMessages }
          }

          const slideState = useSlideStore.getState()
          const presentation = slideState.presentation
          if (!presentation) return { chatMessages: newMessages }

          const slideIndex = slideState.currentSlideIndex
          const slide = presentation.slides[slideIndex]
          if (!slide) return { chatMessages: newMessages }

          const previewCount = slide.components.filter((c) => c.id.startsWith('preview-')).length
          const newOps = streamOps.slice(previewCount)

          if (newOps.length === 0) return { chatMessages: newMessages }

          const newComponents = newOps
            .filter((op) => op.op === 'add' && op.path === '/-' && op.value?.properties)
            .map((op, i) => {
              const props = op.value.properties ?? {}
              return {
                id: `preview-${previewCount + i}-${Date.now()}`,
                type: op.value.type ?? 'text',
                position: props.position ?? { x: 0, y: 0 },
                size: props.size ?? { w: 400, h: 60 },
                props,
                zIndex: previewCount + i + 100,
              }
            })

          const newSlides = presentation.slides.map((sl, idx) =>
            idx === slideIndex
              ? { ...sl, components: [...sl.components.filter((c) => !c.id.startsWith('preview-')), ...newComponents] }
              : sl
          )

          useSlideStore.setState({ presentation: { ...presentation, slides: newSlides } })

          return { chatMessages: newMessages }
        })
      }

      if (type === 'new_slides' || (type === 'agent_done' && msg.new_slides)) {
        const newSlides = (msg.new_slides as any[]) ?? []
        if (newSlides.length > 0) {
          const slideState = useSlideStore.getState()
          if (slideState.presentation) {
            useSlideStore.setState({
              presentation: {
                ...slideState.presentation,
                slides: [
                  ...slideState.presentation.slides,
                  ...newSlides.map((sl: any) => ({
                    id: sl.id,
                    order: sl.order,
                    components: (sl.components ?? []).map((c: any) => ({
                      id: c.id,
                      type: c.type,
                      position: c.properties?.position ?? { x: 0, y: 0 },
                      size: c.properties?.size ?? { w: 400, h: 100 },
                      props: c.properties,
                      zIndex: c.order ?? 0,
                    })),
                  })),
                ],
              },
            })
          }
        }
      }

      if (type === 'agent_proposal') {
        const doneAgentName = (msg.agent_name as string) ?? ''
        const doneAgent = get().agents.find((a) => a.name === doneAgentName || a.status === 'running')

        const newProposal = {
          id: msg.proposal_id as string,
          slide_id: msg.slide_id as string,
          agent_run_id: '',
          agent_name: doneAgentName,
          command: '',
          patches: (msg.patches as any[]) ?? [],
          summary: (msg.summary as string) ?? '',
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        }

        useProposalStore.getState().addProposal(newProposal)

        set((s) => {
          const newRunningIds = new Set(s.runningAgentIds)
          if (doneAgent?.definitionId) newRunningIds.delete(doneAgent.definitionId)

          const cleanedMessages = s.chatMessages.filter((m) =>
            m.id !== `streaming-${doneAgent?.definitionId}` &&
            !m.id.startsWith(`optimistic-agent-${doneAgent?.definitionId}`)
          )

          return {
            runningAgentIds: newRunningIds,
            overallStatus: newRunningIds.size > 0 ? 'running' : 'idle',
            agents: s.agents.map((a) =>
              a.name === doneAgentName
                ? { ...a, status: 'idle', currentTask: undefined, taskProgress: 100 }
                : a,
            ),
            chatMessages: [
              ...cleanedMessages,
              {
                id: `proposal-${newProposal.id}`,
                role: 'agent' as const,
                content: newProposal.summary || '변경 제안이 준비되었습니다',
                agentName: doneAgentName || 'Agent',
                agentDefinitionId: doneAgent?.definitionId,
                timestamp: new Date().toISOString(),
                type: 'info' as const,
              },
            ],
            activeRightTab: 'agent',
          }
        })
      }

      if (type === 'agent_done') {
        const { agents } = get()
        const doneAgentName = (msg.agent_name as string) ?? ''
        const doneAgent = agents.find((a) => a.name === doneAgentName || a.status === 'running')
        const affectedIds: string[] = (msg.affected_component_ids as string[]) ?? []

        set((s) => {
          const newRunningIds = new Set(s.runningAgentIds)
          if (doneAgent?.definitionId) newRunningIds.delete(doneAgent.definitionId)

          const newConflicts = new Set(s.conflictComponentIds)
          const recentlyModified = new Set(
            s.chatMessages
              .filter((m) => m.role === 'agent' && m.agentDefinitionId !== doneAgent?.definitionId)
              .flatMap((m) => (m as any).affectedComponentIds ?? [])
          )
          affectedIds.forEach((id) => {
            if (recentlyModified.has(id)) newConflicts.add(id)
          })

          // preview 컴포넌트 제거
          const slideState = useSlideStore.getState()
          if (slideState.presentation) {
            const cleanedSlides = slideState.presentation.slides.map((sl) => ({
              ...sl,
              components: sl.components.filter((c) => !c.id.startsWith('preview-')),
            }))
            useSlideStore.setState({ presentation: { ...slideState.presentation, slides: cleanedSlides } })
          }

          return {
            runningAgentIds: newRunningIds,
            overallStatus: newRunningIds.size > 0 ? 'running' : 'idle',
            conflictComponentIds: newConflicts,
            agents: s.agents.map((a) =>
              a.name === doneAgentName
                ? { ...a, status: newConflicts.size > 0 ? 'conflict' : 'done', currentTask: undefined, taskProgress: 100 }
                : a,
            ),
            chatMessages: [
              ...s.chatMessages.filter((m) =>
                m.id !== `streaming-${doneAgent?.definitionId}` &&
                !m.id.startsWith(`optimistic-agent-${doneAgent?.definitionId}`)
              ),
              {
                id: `optimistic-agent-${doneAgent?.definitionId ?? Date.now()}`,
                role: 'agent' as const,
                content: (msg.summary as string) || '작업 완료',
                agentName: doneAgentName || 'Agent',
                agentDefinitionId: doneAgent?.definitionId,
                timestamp: new Date().toISOString(),
                type: newConflicts.size > 0 ? 'error' as const : 'success' as const,
              },
            ],
            agentLogs: [
              {
                id: `log-${Date.now()}`,
                agentId: doneAgent?.definitionId ?? '',
                agentName: doneAgentName || 'Agent',
                message: newConflicts.size > 0 ? `충돌 감지: ${newConflicts.size}개 컴포넌트` : '작업 완료',
                timestamp: new Date().toISOString(),
                type: newConflicts.size > 0 ? 'conflict' : 'success',
              },
              ...s.agentLogs,
            ],
            activeRightTab: 'agent',
          }
        })

        const ppt = useSlideStore.getState().presentation
        if (ppt) {
          useSlideStore.getState().loadPresentation(ppt.id)
          get().loadChatHistory(ppt.id)
        }
      }

      if (type === 'agent_error') {
        const { agents } = get()
        const errAgentName = (msg.agent_name as string) ?? ''
        const errAgent = agents.find((a) => a.name === errAgentName || a.status === 'running')
        const errMsg = (msg.error as string) ?? '알 수 없는 오류'

        set((s) => {
          const newRunningIds = new Set(s.runningAgentIds)
          if (errAgent?.definitionId) newRunningIds.delete(errAgent.definitionId)
          return {
            runningAgentIds: newRunningIds,
            overallStatus: newRunningIds.size > 0 ? 'running' : 'idle',
            agents: s.agents.map((a) =>
              a.name === errAgentName || (errAgentName === '' && a.status === 'running')
                ? { ...a, status: 'error', currentTask: undefined }
                : a,
            ),
            chatMessages: [
              ...s.chatMessages,
              {
                id: `optimistic-agent-err-${Date.now()}`,
                role: 'agent' as const,
                content: `오류: ${errMsg}`,
                agentName: errAgentName || 'Agent',
                agentDefinitionId: errAgent?.definitionId,
                timestamp: new Date().toISOString(),
                type: 'error' as const,
              },
            ],
            agentLogs: [
              {
                id: `log-${Date.now()}`,
                agentId: errAgent?.definitionId ?? '',
                agentName: errAgentName || 'Agent',
                message: `오류: ${errMsg}`,
                timestamp: new Date().toISOString(),
                type: 'error',
              },
              ...s.agentLogs,
            ],
          }
        })

        const ppt = useSlideStore.getState().presentation
        if (ppt) get().loadChatHistory(ppt.id)
      }
    })
    return unsubscribe
  },

  selectChatAgent: (definitionId) => set({ selectedAgentDefinitionId: definitionId }),
  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  sendMessage: async (command: string) => {
    const { selectedAgentDefinitionId, agents } = get()
    const selectedAgent = agents.find((a) => a.definitionId === selectedAgentDefinitionId)

    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        {
          id: `optimistic-user-${Date.now()}`,
          role: 'user' as const,
          content: command,
          agentDefinitionId: selectedAgentDefinitionId ?? undefined,
          timestamp: new Date().toISOString(),
          type: 'info' as const,
        },
      ],
      activeRightTab: 'agent',
    }))

    await get().runAgent(command, selectedAgent?.role ?? 'content', selectedAgentDefinitionId ?? undefined)
  },

  runAgent: async (command, agentRole = 'content', agentDefinitionId?) => {
    const ppt = useSlideStore.getState().presentation
    const slideIndex = useSlideStore.getState().currentSlideIndex
    const currentSlide = ppt?.slides[slideIndex]
    if (!ppt || !currentSlide) return

    set((s) => {
      const newRunningIds = new Set(s.runningAgentIds)
      if (agentDefinitionId) newRunningIds.add(agentDefinitionId)
      return { runningAgentIds: newRunningIds, overallStatus: 'running', activeRightTab: 'agent' }
    })

    await apiRunAgent({
      project_id: ppt.id,
      slide_id: currentSlide.id,
      command,
      agent_role: agentRole,
      agent_definition_id: agentDefinitionId,
    }).catch((e: any) => {
      set((s) => {
        const newRunningIds = new Set(s.runningAgentIds)
        if (agentDefinitionId) newRunningIds.delete(agentDefinitionId)
        return { runningAgentIds: newRunningIds, overallStatus: newRunningIds.size > 0 ? 'running' : 'idle' }
      })
      throw e
    })
  },
}))
