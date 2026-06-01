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
import type { Presentation, Slide, Agent, AgentLog, AgentStatus, ChatMessage } from '@/shared/types'
import { api } from '@/shared/lib/apiClient'
import { runAgent } from '@/shared/lib/agentRunApi'
import { sseClient } from '@/shared/lib/sseClient'

interface EditorState {
  presentation: Presentation | null
  currentSlideIndex: number
  selectedComponentId: string | null
  agents: Agent[]
  agentLogs: AgentLog[]
  chatMessages: ChatMessage[]
  selectedAgentDefinitionId: string | null
  runningAgentIds: Set<string>        // definitionId 기준 실행 중인 에이전트
  conflictComponentIds: Set<string>   // 동시 수정된 컴포넌트 ID
  overallStatus: AgentStatus          // 하위 호환용 (any running → 'running')
  activeRightTab: 'agent' | 'properties'
  isTitleEditing: boolean

  loadPresentation: (id: string) => Promise<void>
  loadAgentLogs: (projectId: string) => Promise<void>
  loadAgents: (projectId?: string) => Promise<void>
  loadChatHistory: (projectId: string) => Promise<void>
  connectWs: (projectId: string) => () => void
  setCurrentSlide: (index: number) => void
  selectComponent: (id: string | null) => void
  selectChatAgent: (definitionId: string | null) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  addSlide: () => Promise<void>
  deleteSlide: (index?: number) => Promise<void>
  duplicateSlide: (index?: number) => Promise<void>
  reorderSlides: (oldIndex: number, newIndex: number) => Promise<void>
  saveTitle: (title: string) => Promise<void>
  updateTitle: (title: string) => void
  setTitleEditing: (v: boolean) => void
  sendMessage: (command: string) => Promise<void>
  runAgent: (command: string, agentRole?: string, agentDefinitionId?: string) => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  presentation: null,
  currentSlideIndex: 0,
  selectedComponentId: null,
  agents: [],
  agentLogs: [],
  chatMessages: [],
  selectedAgentDefinitionId: null,
  runningAgentIds: new Set(),
  conflictComponentIds: new Set(),
  overallStatus: 'idle',
  activeRightTab: 'agent',
  isTitleEditing: false,

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
      // RightPanel에는 system(기본 3개) + 이 PPT 전용만 표시. library는 AgentManagerPanel 전용.
      const allAgents: Agent[] = [
        ...data.system.map(toAgent('sys')),
        ...(data.project ?? []).map(toAgent('proj')),
      ]
      set({ agents: allAgents })
    } catch {}
  },

  loadPresentation: async (id) => {
    try {
      const { fetchProjectWithSlides } = await import('@/shared/lib/projectApi')
      const ppt = await fetchProjectWithSlides(id)
      set({ presentation: ppt })
    } catch (e) {
      console.error('loadPresentation failed', e)
    }
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

      if (type === 'agent_token') {
        const accumulated = (msg.accumulated as string) ?? ''

        // 스트림 중 완성된 op 추출 → 슬라이드 preview 적용
        const streamOps = extractCompleteOps(accumulated)

        set((s) => {
          const streamingAgent = s.agents.find((a) => a.status === 'running')
          if (!streamingAgent) return s

          // 채팅 말풍선 실시간 업데이트
          const streamId = `streaming-${streamingAgent.definitionId}`
          const existing = s.chatMessages.find((m) => m.id === streamId)
          const newMessages = existing
            ? s.chatMessages.map((m) => m.id === streamId ? { ...m, content: accumulated } : m)
            : [
                ...s.chatMessages,
                {
                  id: streamId,
                  role: 'agent' as const,
                  content: accumulated,
                  agentName: streamingAgent.name,
                  agentDefinitionId: streamingAgent.definitionId,
                  timestamp: new Date().toISOString(),
                  type: 'info' as const,
                },
              ]

          // 슬라이드 preview: add op → 임시 컴포넌트 렌더링
          if (streamOps.length === 0 || !s.presentation) {
            return { chatMessages: newMessages }
          }

          const slideIndex = s.currentSlideIndex
          const slide = s.presentation.slides[slideIndex]
          if (!slide) return { chatMessages: newMessages }

          // 이미 preview 적용된 수를 추적 (streaming- id prefix로 구분)
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

          const newSlides = s.presentation.slides.map((sl, idx) =>
            idx === slideIndex
              ? { ...sl, components: [...sl.components.filter((c) => !c.id.startsWith('preview-')), ...slide.components.filter((c) => !c.id.startsWith('preview-')).slice(0), ...newComponents] }
              : sl
          )

          return {
            chatMessages: newMessages,
            presentation: { ...s.presentation, slides: newSlides },
          }
        })
      }

      if (type === 'new_slides' || (type === 'agent_done' && msg.new_slides)) {
        const newSlides = (msg.new_slides as any[]) ?? []
        if (newSlides.length > 0) {
          set((s) => ({
            presentation: s.presentation ? {
              ...s.presentation,
              slides: [
                ...s.presentation.slides,
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
            } : null,
          }))
        }
      }

      if (type === 'agent_done') {
        const { agents } = get()
        // agent_run_id로 어떤 에이전트인지 특정 (agent_name 사용)
        const doneAgentName = (msg.agent_name as string) ?? ''
        const doneAgent = agents.find((a) => a.name === doneAgentName || a.status === 'running')
        const affectedIds: string[] = (msg.affected_component_ids as string[]) ?? []

        set((s) => {
          // 이 에이전트만 runningIds에서 제거
          const newRunningIds = new Set(s.runningAgentIds)
          if (doneAgent?.definitionId) newRunningIds.delete(doneAgent.definitionId)

          // 충돌 감지: 이미 다른 에이전트가 수정한 컴포넌트와 겹치면 충돌
          const newConflicts = new Set(s.conflictComponentIds)
          const recentlyModified = new Set(
            s.chatMessages
              .filter((m) => m.role === 'agent' && m.agentDefinitionId !== doneAgent?.definitionId)
              .flatMap((m) => (m as any).affectedComponentIds ?? [])
          )
          affectedIds.forEach((id) => {
            if (recentlyModified.has(id)) newConflicts.add(id)
          })

          // preview 컴포넌트 제거 (loadPresentation이 실제 데이터로 교체)
          const cleanedSlides = s.presentation?.slides.map((sl) => ({
            ...sl,
            components: sl.components.filter((c) => !c.id.startsWith('preview-')),
          }))

          return {
            presentation: cleanedSlides && s.presentation ? { ...s.presentation, slides: cleanedSlides } : s.presentation,
            runningAgentIds: newRunningIds,
            overallStatus: newRunningIds.size > 0 ? 'running' : 'idle',
            conflictComponentIds: newConflicts,
            agents: s.agents.map((a) =>
              a.name === doneAgentName
                ? { ...a, status: newConflicts.size > 0 ? 'conflict' : 'done', currentTask: undefined, taskProgress: 100 }
                : a,
            ),
            chatMessages: [
              // streaming 임시 메시지 + optimistic 메시지 제거
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
        const ppt = get().presentation
        if (ppt) {
          get().loadPresentation(ppt.id)
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
        const ppt = get().presentation
        if (ppt) get().loadChatHistory(ppt.id)
      }
    })
    return unsubscribe
  },

  setCurrentSlide: (index) => set({ currentSlideIndex: index, selectedComponentId: null }),
  selectComponent: (id) => set({ selectedComponentId: id }),
  selectChatAgent: (definitionId) => set({ selectedAgentDefinitionId: definitionId }),
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

  deleteSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt || ppt.slides.length <= 1) return
    const idx = index ?? get().currentSlideIndex
    const slide = ppt.slides[idx]
    const newSlides = ppt.slides.filter((_, i) => i !== idx)
    const newIndex = Math.min(idx, newSlides.length - 1)
    // optimistic
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides: newSlides } : null,
      currentSlideIndex: newIndex,
      selectedComponentId: null,
    }))
    try {
      const { deleteSlide: apiDelete } = await import('@/shared/lib/projectApi')
      await apiDelete(ppt.id, slide.id)
    } catch (e) {
      console.error('deleteSlide failed', e)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: idx,
      }))
    }
  },

  duplicateSlide: async (index) => {
    const ppt = get().presentation
    if (!ppt) return
    const idx = index ?? get().currentSlideIndex
    const sourceSlide = ppt.slides[idx]
    try {
      const newSlideRes = await api.post<{ id: string; order: number }>(`/projects/${ppt.id}/slides`, {})
      const copiedComps = await Promise.all(
        sourceSlide.components.map((comp) =>
          api.post<any>(`/projects/${ppt.id}/slides/${newSlideRes.id}/components`, {
            type: comp.type,
            properties: comp.props,
            order: comp.zIndex,
          })
        )
      )
      const newSlide: Slide = {
        id: newSlideRes.id,
        order: newSlideRes.order,
        components: copiedComps.map((c: any) => ({
          id: c.id,
          type: c.type,
          position: c.properties?.position ?? { x: 0, y: 0 },
          size: c.properties?.size ?? { w: 400, h: 100 },
          props: c.properties,
          zIndex: c.order ?? 0,
        })),
      }
      const slides = [...ppt.slides]
      slides.splice(idx + 1, 0, newSlide)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides } : null,
        currentSlideIndex: idx + 1,
      }))
      const { reorderSlides: apiReorder } = await import('@/shared/lib/projectApi')
      await apiReorder(ppt.id, slides.map((s) => s.id))
    } catch (e) {
      console.error('duplicateSlide failed', e)
    }
  },

  reorderSlides: async (oldIndex, newIndex) => {
    const ppt = get().presentation
    if (!ppt || oldIndex === newIndex) return
    const slides = [...ppt.slides]
    const [moved] = slides.splice(oldIndex, 1)
    slides.splice(newIndex, 0, moved)
    const currentIdx = get().currentSlideIndex
    const newCurrentIdx =
      currentIdx === oldIndex ? newIndex
      : currentIdx > oldIndex && currentIdx <= newIndex ? currentIdx - 1
      : currentIdx < oldIndex && currentIdx >= newIndex ? currentIdx + 1
      : currentIdx
    // optimistic
    set((s) => ({
      presentation: s.presentation ? { ...s.presentation, slides } : null,
      currentSlideIndex: newCurrentIdx,
    }))
    try {
      const { reorderSlides: apiReorder } = await import('@/shared/lib/projectApi')
      await apiReorder(ppt.id, slides.map((s) => s.id))
    } catch (e) {
      console.error('reorderSlides failed', e)
      set((s) => ({
        presentation: s.presentation ? { ...s.presentation, slides: ppt.slides } : null,
        currentSlideIndex: currentIdx,
      }))
    }
  },

  sendMessage: async (command: string) => {
    const { selectedAgentDefinitionId, agents } = get()
    const selectedAgent = agents.find((a) => a.definitionId === selectedAgentDefinitionId)

    // 즉시 user 말풍선 표시 (optimistic)
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
    const ppt = get().presentation
    const slideIndex = get().currentSlideIndex
    const currentSlide = ppt?.slides[slideIndex]
    if (!ppt || !currentSlide) return

    // 해당 에이전트만 running으로 — 다른 에이전트 차단 없음
    set((s) => {
      const newRunningIds = new Set(s.runningAgentIds)
      if (agentDefinitionId) newRunningIds.add(agentDefinitionId)
      return { runningAgentIds: newRunningIds, overallStatus: 'running', activeRightTab: 'agent' }
    })

    await runAgent({
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
