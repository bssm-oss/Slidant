// editorStore.ts — backward-compat facade
// All state is now split into slideStore, agentStore, proposalStore.
// This file re-exports a unified hook for components and an imperative accessor.

export { useSlideStore } from './slideStore'
export { useAgentStore } from './agentStore'
export { useProposalStore } from './proposalStore'

import { useSlideStore } from './slideStore'
import { useAgentStore } from './agentStore'
import { useProposalStore } from './proposalStore'

export function useEditorStore() {
  const slide = useSlideStore()
  const agent = useAgentStore()
  const proposal = useProposalStore()
  return { ...slide, ...agent, ...proposal }
}

/** Imperative accessor — use in event handlers and SSE callbacks */
export const editorGetState = () => ({
  ...useSlideStore.getState(),
  ...useAgentStore.getState(),
  ...useProposalStore.getState(),
})
