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

import { getComponentIds as _getComponentIds, extractComponentHtml as _extractComponentHtml } from '@/shared/lib/slideHtml'

function _computeAddedComponentIds(currentHtml: string, proposalHtml: string): string[] {
  const current = _getComponentIds(currentHtml)
  const proposed = _getComponentIds(proposalHtml)
  return [...proposed].filter((id) => !current.has(id))
}

function _anyExistingComponentModified(currentHtml: string, proposalHtml: string): boolean {
  const currentIds = _getComponentIds(currentHtml)
  const proposedIds = _getComponentIds(proposalHtml)
  const commonIds = [...currentIds].filter((id) => proposedIds.has(id))
  return commonIds.some(
    (id) => _extractComponentHtml(currentHtml, id) !== _extractComponentHtml(proposalHtml, id)
  )
}

import { create } from 'zustand'
import type { Agent, AgentLog, AgentStatus, ChatMessage } from '@/shared/types'
import { runAgent as apiRunAgent } from '@/shared/lib/agentRunApi'
import { api } from '@/shared/lib/apiClient'
import { wsClient } from '@/shared/lib/wsClient'
import { useSlideStore } from './slideStore'
import { useProposalStore } from './proposalStore'
import { useSessionStore } from './sessionStore'

// 사용자 직접 편집 broadcast — 연속 편집(드래그 등) 묶어서 1회만 재조회
let _slideChangedDebounce: ReturnType<typeof setTimeout> | null = null

export interface AgentStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export interface PresenceUser {
  userId: string
  name: string
  color: string
  currentSlide: number
  isAgentRunning: boolean
}

interface AgentState {
  agents: Agent[]
  agentLogs: AgentLog[]
  chatMessages: ChatMessage[]
  selectedAgentDefinitionId: string | null
  runningAgentIds: Set<string>
  conflictComponentIds: Set<string>
  overallStatus: AgentStatus
  activeRightTab: 'agent' | 'properties'
  agentSteps: AgentStep[]
  lastRunAgentName: string | null
  presenceUsers: PresenceUser[]
  currentAgentRunId: string | null
  currentRunSessionId: string | null
  pendingSlideCount: number
  agentStartTime: number | null
  estimatedSeconds: number | null

  loadAgents: (projectId?: string) => Promise<void>
  loadChatHistory: (projectId: string) => Promise<void>
  loadAgentLogs: (projectId: string) => Promise<void>
  connectWs: (projectId: string) => () => void
  selectChatAgent: (definitionId: string | null) => void
  setActiveRightTab: (tab: 'agent' | 'properties') => void
  sendMessage: (command: string) => Promise<void>
  runAgent: (command: string, agentRole?: string, agentDefinitionId?: string) => Promise<void>
  cancelAgent: () => Promise<void>
}

const USER_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  agentLogs: [],
  presenceUsers: [],
  chatMessages: [],
  selectedAgentDefinitionId: null,
  runningAgentIds: new Set(),
  conflictComponentIds: new Set(),
  overallStatus: 'idle',
  activeRightTab: 'agent',
  agentSteps: [],
  lastRunAgentName: null,
  currentAgentRunId: null,
  currentRunSessionId: null,
  pendingSlideCount: 0,
  agentStartTime: null,
  estimatedSeconds: null,

  loadAgents: async (projectId) => {
    try {
      const { fetchAgents, getAgentDisplayName } = await import('@/shared/lib/agentApi')
      const data = await fetchAgents(projectId)
      const toAgent = (prefix: string) => (a: any): Agent => ({
        id: `${prefix}-${a.id}`,
        definitionId: a.id,
        name: getAgentDisplayName(a),
        role: a.role,
        status: 'idle' as AgentStatus,
        description: (a.config?.description as string) ?? '',
      })
      const allAgents: Agent[] = [
        ...data.system.map(toAgent('sys')),
        ...(data.library ?? []).map(toAgent('lib')),
        ...(data.project ?? []).map(toAgent('proj')),
      ]
      set({ agents: allAgents })
    } catch {}
  },

  loadChatHistory: async (projectId) => {
    try {
      const { fetchChatHistory } = await import('@/shared/lib/agentRunApi')
      const currentSessionId = useSessionStore.getState().currentSessionId
      const msgs = await fetchChatHistory(projectId, currentSessionId ?? undefined)
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
    wsClient.connect(projectId)
    const unsubscribe = wsClient.onMessage((msg) => {
      const type = msg.type as string
      const isReplayed = !!(msg.replayed)  // Redis에서 replay된 이벤트

      if (type === 'user_joined') {
        const userId = msg.userId as string
        const name = msg.name as string
        const colorIdx = Math.abs(userId.charCodeAt(0)) % USER_COLORS.length
        set((s) => ({
          presenceUsers: s.presenceUsers.some((u) => u.userId === userId)
            ? s.presenceUsers
            : [...s.presenceUsers, { userId, name, color: USER_COLORS[colorIdx], currentSlide: 0, isAgentRunning: false }],
        }))
        return
      }

      if (type === 'user_left') {
        set((s) => ({ presenceUsers: s.presenceUsers.filter((u) => u.userId !== (msg.userId as string)) }))
        return
      }

      if (type === 'presence_update') {
        const userId = msg.userId as string
        const data = (msg.data ?? {}) as { currentSlide?: number }
        set((s) => ({
          presenceUsers: s.presenceUsers.map((u) =>
            u.userId === userId ? { ...u, currentSlide: data.currentSlide ?? u.currentSlide } : u
          ),
        }))
        return
      }

      if (type === 'presence_state') {
        const users = (msg.users ?? []) as Array<{ userId: string; name: string; currentSlide?: number }>
        set({
          presenceUsers: users.map((u, i) => ({
            userId: u.userId,
            name: u.name,
            color: USER_COLORS[i % USER_COLORS.length],
            currentSlide: u.currentSlide ?? 0,
            isAgentRunning: false,
          })),
        })
        return
      }

      if (type === 'agent_done' || type === 'agent_error') {
        const doneUserId = msg.user_id as string | undefined
        if (doneUserId) {
          set((s) => ({
            presenceUsers: s.presenceUsers.map((u) =>
              u.userId === doneUserId ? { ...u, isAgentRunning: false } : u
            ),
          }))
        }
        // agent_done/error 기존 처리 계속 진행 (return 안 함)
      }

      // 다른 유저의 에이전트 응답 메시지 실시간 동기화
      if (type === 'chat_message') {
        const { currentSessionId } = useSessionStore.getState()
        const sessionId = msg.session_id as string | undefined
        if (sessionId && sessionId === currentSessionId) {
          const newMsgs = (msg.messages as Array<Record<string, unknown>> | undefined) ?? []
          set((s) => ({
            chatMessages: [
              ...s.chatMessages,
              ...newMsgs.map((m) => ({
                id: `ws-${Date.now()}-${Math.random()}`,
                role: (m.role as 'user' | 'agent') ?? 'agent',
                content: m.content as string,
                agentName: m.agent_name as string | undefined,
                agentDefinitionId: m.agent_definition_id as string | undefined,
                timestamp: new Date().toISOString(),
                type: 'info' as const,
              })),
            ],
          }))
        }
        return
      }

      // 다른 커넥션의 직접 편집(컴포넌트 수정/생성/삭제, 슬라이드 추가/삭제/재정렬, 인라인 HTML 편집) 알림
      if (type === 'slide_changed') {
        const ppt = useSlideStore.getState().presentation
        if (ppt) {
          if (_slideChangedDebounce) clearTimeout(_slideChangedDebounce)
          _slideChangedDebounce = setTimeout(() => {
            _slideChangedDebounce = null
            useSlideStore.getState().loadPresentation(ppt.id)
          }, 400)
        }
        return
      }

      // 다른 커넥션에서 proposal 승인/거절 처리됨 — 로컬 pending 목록에서 제거
      if (type === 'proposal_resolved') {
        const proposalId = msg.proposal_id as string
        useProposalStore.getState().resolveProposal(proposalId)
        const ppt = useSlideStore.getState().presentation
        if ((msg.status as string) === 'approved' && ppt) {
          useSlideStore.getState().loadPresentation(ppt.id)
        }
        return
      }

      if (type === 'component_conflict') {
        const { component_ids, agent_name } = msg as {
          slide_id: string; component_ids: string[]; agent_name: string
        }
        // 컴포넌트 단위 충돌 → conflictComponentIds에 추가
        set((s) => {
          const newConflicts = new Set(s.conflictComponentIds)
          component_ids.forEach((id) => newConflicts.add(id))
          return { conflictComponentIds: newConflicts }
        })
        // 충돌 알림 채팅 메시지
        set((s) => ({
          chatMessages: [
            ...s.chatMessages,
            {
              id: `conflict-${Date.now()}`,
              role: 'agent' as const,
              content: `⚠️ 컴포넌트 충돌: ${agent_name}이 이미 수정 중인 요소(${component_ids.join(', ')})를 다른 에이전트가 수정했습니다.`,
              agentName: 'System',
              timestamp: new Date().toISOString(),
              type: 'error' as const,
            },
          ],
        }))
        return
      }

      if (type === 'slide_deleted') {
        const deletedSlideId = msg.slide_id as string
        const ppt = useSlideStore.getState().presentation
        if (ppt) {
          useSlideStore.setState({
            presentation: {
              ...ppt,
              slides: ppt.slides.filter((s) => s.id !== deletedSlideId),
            },
            currentSlideIndex: Math.max(0, useSlideStore.getState().currentSlideIndex - 1),
          })
        }
        return
      }

      if (type === 'agent_started') {
        const role = (msg.role as string) ?? 'content'
        const agentName = (msg.agent_name as string) ?? `${role.charAt(0).toUpperCase()}${role.slice(1)}Agent`
        const isResumed = !!(msg.resumed)
        const runningUserId = msg.user_id as string | undefined
        const runSessionId = (msg.session_id as string | undefined) ?? null
        set((s) => {
          const runningAgent = s.agents.find((a) => a.name === agentName)
          const newRunningIds = new Set(s.runningAgentIds)
          if (runningAgent?.definitionId) newRunningIds.add(runningAgent.definitionId)
          return {
            overallStatus: 'running',
            runningAgentIds: newRunningIds,
            currentAgentRunId: (msg.agent_run_id as string) ?? s.currentAgentRunId,
            currentRunSessionId: runSessionId,
            agentStartTime: Date.now(),
            lastRunAgentName: agentName,
            agents: s.agents.map((a) =>
              a.name === agentName
                ? {
                    ...a,
                    status: 'running',
                    // 재연결 시: 기존 currentTask 유지, 없으면 command 사용
                    currentTask: isResumed ? (a.currentTask ?? (msg.command as string) ?? '실행 중...') : (msg.command as string),
                    taskProgress: 0,
                  }
                : a,
            ),
            presenceUsers: runningUserId
              ? s.presenceUsers.map((u) => u.userId === runningUserId ? { ...u, isAgentRunning: true } : u)
              : s.presenceUsers,
          }
        })
        // 재연결 후 replay 완료되면 첫 번째 pending step을 active로 승격
        if (isResumed) {
          const promoteFirstPending = () => {
            const { agentSteps } = get()
            if (agentSteps.length === 0) return  // steps_init 아직 안 왔음, live 이벤트 기다림
            const firstPendingIdx = agentSteps.findIndex((s) => s.status === 'pending')
            if (firstPendingIdx === -1) return
            set((s) => ({
              agentSteps: s.agentSteps.map((st, i) =>
                i === firstPendingIdx ? { ...st, status: 'active' } : st
              ),
            }))
          }
          setTimeout(promoteFirstPending, 600)
        }
      }

      // slide_ready: 슬라이드 완성 즉시 UI에 반영 (옵티미스틱)
      if (type === 'agent_node_event' && (msg.event_type as string) === 'slide_ready') {
        set((s) => ({ pendingSlideCount: Math.max(0, s.pendingSlideCount - 1) }))
        try {
          const data = JSON.parse(msg.message as string) as { index: number; title: string; html: string }
          useSlideStore.setState((s) => {
            if (!s.presentation) return s
            const slides = [...s.presentation.slides]
            // order 값으로 기존 슬롯 탐색 (배열 위치가 아니라 order 기준)
            const existingIdx = slides.findIndex((sl) => (sl.order ?? -1) === data.index)
            if (existingIdx >= 0) {
              slides[existingIdx] = { ...slides[existingIdx], html_content: data.html, title: data.title || slides[existingIdx].title }
            } else {
              const newSlide = {
                id: `preview-slide-${data.index}`,
                order: data.index,
                title: data.title,
                html_content: data.html,
                components: [],
              }
              // order 순서에 맞는 위치에 삽입 (병렬 도착 시에도 정렬 유지)
              const insertAt = slides.findIndex((sl) => (sl.order ?? Infinity) > data.index)
              if (insertAt === -1) slides.push(newSlide)
              else slides.splice(insertAt, 0, newSlide)
            }
            return { presentation: { ...s.presentation, slides } }
          })
        } catch {}
        return
      }

      if (type === 'agent_node_event') {
        const eventType = msg.event_type as string
        const message = msg.message as string

        // steps_init: 단계 목록 초기화
        if (eventType === 'steps_init') {
          // replayed 이벤트는 현재 세션이 시작한 agent run에 한해서만 표시
          if (isReplayed) {
            const { currentRunSessionId } = get()
            const { currentSessionId } = useSessionStore.getState()
            // session_id 둘 다 알고 있을 때만 필터링 — 어느 쪽이 null이면 표시 허용
            if (currentRunSessionId && currentSessionId && currentRunSessionId !== currentSessionId) return
          }
          try {
            const raw = JSON.parse(message) as {id: string, label: string}[]
            const steps: AgentStep[] = raw.map((s, i) => ({
              ...s,
              status: (isReplayed ? 'pending' : (i === 0 ? 'active' : 'pending')) as AgentStep['status'],
            }))
            const slideCount = raw.filter((s) => s.id.startsWith('slide-')).length
            const hasSearch = raw.some((s) => s.id === 'search')
            const estimated = slideCount > 0 ? slideCount * 7 + (hasSearch ? 25 : 5) : null
            set({ agentSteps: steps, pendingSlideCount: slideCount, estimatedSeconds: estimated })
          } catch {}
          return
        }

        // step_done: 해당 단계 완료, 다음 단계 active
        // step_failed: 해당 단계 생성 실패 (slide_ready 안 옴 → pendingSlideCount도 함께 감소)
        if (eventType === 'step_done' || eventType === 'step_failed') {
          const nextStatus = eventType === 'step_done' ? 'done' : 'failed'
          set((s) => {
            const idx = s.agentSteps.findIndex((st) => st.id === message)
            if (idx === -1) return s
            return {
              agentSteps: s.agentSteps.map((st, i) => {
                if (i === idx) return { ...st, status: nextStatus }
                // 다음 단계 active 승격 — 병렬 슬라이드 단계는 완료 순서가 배열 순서와
                // 다를 수 있으므로, 아직 'pending'인 단계만 승격 (이미 done/failed/active인
                // 단계를 뒤늦게 도착한 step_done이 'active'로 되돌리는 버그 방지)
                if (!isReplayed && i === idx + 1 && st.status === 'pending') return { ...st, status: 'active' }
                return st
              }),
              pendingSlideCount: nextStatus === 'failed'
                ? Math.max(0, s.pendingSlideCount - 1)
                : s.pendingSlideCount,
            }
          })
          return
        }

        // node_start/node_done/slide_progress → currentTask만 업데이트, 채팅 버블 추가 안 함
        // (StepsChecklist가 파이프라인 시각화 전담)
        set((s) => {
          const streamingAgent = s.agents.find((a) => a.status === 'running')
          if (!streamingAgent) return s
          return {
            agents: s.agents.map((a) =>
              a.definitionId === streamingAgent.definitionId
                ? { ...a, currentTask: message }
                : a
            ),
          }
        })
      }

      if (type === 'agent_token') {
        const accumulated = (msg.accumulated as string) ?? ''
        const streamOps = extractCompleteOps(accumulated)

        // 백엔드가 <status> 필터링 후 plain text만 전송 — 그대로 사용
        const displayText = accumulated.trim()

        set((s) => {
          const streamingAgent = s.agents.find((a) => a.status === 'running')
          if (!streamingAgent) return s

          // currentTask를 플래너 스트리밍 텍스트 첫 줄로 업데이트 (상태 바 표시용)
          const firstLine = displayText.split('\n')[0].slice(0, 40)
          const updatedAgents = s.agents.map((a) =>
            a.definitionId === streamingAgent.definitionId
              ? { ...a, currentTask: firstLine || a.currentTask }
              : a
          )

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
            return { agents: updatedAgents, chatMessages: newMessages }
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

      // new_slides: agent_done에서 loadPresentation이 호출되므로 append 불필요
      // type==='new_slides' (독립 이벤트)만 처리, agent_done 내 new_slides는 무시
      if (type === 'new_slides') {
        const newSlides = (msg.new_slides as any[]) ?? []
        if (newSlides.length > 0) {
          const slideState = useSlideStore.getState()
          if (slideState.presentation) {
            useSlideStore.setState({
              presentation: {
                ...slideState.presentation,
                slides: [
                  ...slideState.presentation.slides.filter((sl) => !sl.id.startsWith('preview-slide-')),
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
            !m.id.startsWith(`optimistic-agent-${doneAgent?.definitionId}`) &&
            !m.id.startsWith('log-')
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

          // preview 슬라이드/컴포넌트 제거 (loadPresentation 전 낙관적 클린업)
          const slideState = useSlideStore.getState()
          if (slideState.presentation) {
            const cleanedSlides = slideState.presentation.slides
              .filter((sl) => !sl.id.startsWith('preview-slide-'))
              .map((sl) => ({
                ...sl,
                components: sl.components.filter((c) => !c.id.startsWith('preview-')),
              }))
            useSlideStore.setState({ presentation: { ...slideState.presentation, slides: cleanedSlides } })
          }

          // step_done이 agent_done보다 늦게 도착할 수 있으므로 즉시 done으로 마킹
          // (failed는 실제 생성 실패를 나타내므로 done으로 덮어쓰지 않음)
          // 완료된 steps는 채팅 히스토리에 남겨두고, 다음 steps_init에서 교체
          const completedSteps = s.agentSteps.map((st) =>
            st.status === 'done' || st.status === 'failed' ? st : { ...st, status: 'done' as const }
          )

          // 실행 상태 정리 — replay 여부와 무관하게 항상 수행 (재연결로 놓친 agent_done이
          // 채팅 버블 중복을 피해 일찍 return 하면서 isRunning이 영구히 멈추는 버그 방지)
          const base = {
            runningAgentIds: newRunningIds,
            overallStatus: (newRunningIds.size > 0 ? 'running' : 'idle') as AgentStatus,
            conflictComponentIds: newConflicts,
            agentSteps: completedSteps,
            currentAgentRunId: null,
            currentRunSessionId: null,
            pendingSlideCount: 0,
            agentStartTime: null,
            estimatedSeconds: null,
            agents: s.agents.map((a) =>
              a.name === doneAgentName
                ? { ...a, status: (newConflicts.size > 0 ? 'conflict' : 'done') as AgentStatus, currentTask: undefined, taskProgress: 100 }
                : a,
            ),
          }

          // replay된 agent_done은 채팅 버블/로그 재추가 안 함 (이미 chat history에 있음)
          if (isReplayed) return base

          return {
            ...base,
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

        // replay된 agent_done은 제안/슬라이드 반영도 건너뜀 (재연결 시 별도 로드 흐름이 처리)
        if (isReplayed) return

        // HTML 변경 제안 처리
        type ProposalPayload = { id: string; html_content: string; summary: string; slide_id: string; agent_name: string }
        const proposalPayload = msg.proposal as ProposalPayload | undefined
        if (proposalPayload) {
          const ppt2 = useSlideStore.getState().presentation
          // 추가된 컴포넌트 즉시 적용 — 단, 삭제되는 컴포넌트도 있으면(replace 상황) auto-apply 하지 않음
          let affectedComponentIds: { changed: string[]; deleted: string[] } | undefined
          if (ppt2) {
            const currentSlide = ppt2.slides.find((s) => s.id === proposalPayload.slide_id)
            const currentHtml = currentSlide?.html_content || ''
            const addedIds = _computeAddedComponentIds(currentHtml, proposalPayload.html_content)
            const deletedIds = _computeAddedComponentIds(proposalPayload.html_content, currentHtml) // 현재에 있는데 제안에 없는 것
            const anyModified = _anyExistingComponentModified(currentHtml, proposalPayload.html_content)
            if (addedIds.length > 0 && deletedIds.length === 0 && !anyModified) {
              // 순수 추가만 있을 때만 auto-apply (기존 컴포넌트 수정/교체가 있으면 사용자 확인 필요)
              useProposalStore.getState().approveProposal(proposalPayload.id, addedIds, true).catch(() => {})
            }
            // 에이전트가 의도한 컴포넌트 변경 목록 — 도착 시점 기준으로 저장 (사용자 직접 편집과 분리)
            const changedIds: string[] = []
            const currentIds = _getComponentIds(currentHtml)
            const proposalIds = _getComponentIds(proposalPayload.html_content)
            currentIds.forEach((id) => {
              if (proposalIds.has(id) && _extractComponentHtml(currentHtml, id) !== _extractComponentHtml(proposalPayload.html_content, id)) {
                changedIds.push(id)
              }
            })
            affectedComponentIds = { changed: changedIds, deleted: deletedIds }
          }
          useProposalStore.getState().addProposal({
            id: proposalPayload.id,
            slide_id: proposalPayload.slide_id,
            agent_run_id: (msg.agent_run_id as string) || '',
            agent_name: proposalPayload.agent_name,
            command: '',
            patches: [],
            html_content: proposalPayload.html_content,
            summary: proposalPayload.summary,
            affected_component_ids: affectedComponentIds,
            status: 'pending',
            created_at: new Date().toISOString(),
          })
          if (ppt2) get().loadChatHistory(ppt2.id)
          return
        }

        const ppt = useSlideStore.getState().presentation
        if (ppt) {
          // html_content 즉시 반영 (loadPresentation 전에 먼저 캐시 업데이트)
          const htmlContent = msg.html_content as string | undefined
          const slideId = msg.slide_id as string | undefined
          if (htmlContent && slideId) {
            useSlideStore.setState((s) => ({
              presentation: s.presentation ? {
                ...s.presentation,
                slides: s.presentation.slides.map((sl) =>
                  sl.id === slideId ? { ...sl, html_content: htmlContent } : sl
                ),
              } : null,
            }))
          }
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
            currentAgentRunId: null,
            currentRunSessionId: null,
            pendingSlideCount: 0,
            agentStartTime: null,
            estimatedSeconds: null,
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
    // selectedAgentDefinitionId가 null이면 첫 번째 에이전트 사용
    const activeAgent = agents.find((a) => a.definitionId === selectedAgentDefinitionId) ?? agents[0]
    const activeDefId = activeAgent?.definitionId ?? undefined

    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        {
          id: `optimistic-user-${Date.now()}`,
          role: 'user' as const,
          content: command,
          agentDefinitionId: activeDefId,  // 항상 유효한 definitionId 사용
          timestamp: new Date().toISOString(),
          type: 'info' as const,
        },
      ],
      activeRightTab: 'agent',
    }))

    await get().runAgent(command, activeAgent?.role ?? 'content', activeDefId)
  },

  cancelAgent: async () => {
    const { currentAgentRunId } = get()
    if (!currentAgentRunId) return
    try {
      await api.delete(`/agent/run/${currentAgentRunId}`)
    } catch {}
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

    const sessionId = useSessionStore.getState().currentSessionId

    await apiRunAgent({
      project_id: ppt.id,
      slide_id: currentSlide.id,
      command,
      agent_role: agentRole,
      agent_definition_id: agentDefinitionId,
      session_id: sessionId ?? undefined,
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
