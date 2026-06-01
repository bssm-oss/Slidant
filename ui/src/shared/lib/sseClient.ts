type SseMessage = Record<string, unknown>
type Handler = (msg: SseMessage) => void

class SseClient {
  private es: EventSource | null = null
  private handlers: Handler[] = []
  private projectId: string | null = null

  connect(projectId: string): void {
    if (this.es && this.projectId === projectId &&
        this.es.readyState === EventSource.OPEN) return
    this.disconnect()
    this.projectId = projectId

    const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
    this.es = new EventSource(`${apiBase}/agent/events/${projectId}`)

    // 에이전트 이벤트 타입별 수신
    const eventTypes = ['connected', 'ping', 'agent_started', 'agent_done', 'agent_error', 'new_slides']
    eventTypes.forEach((type) => {
      this.es?.addEventListener(type, (e: MessageEvent) => {
        if (type === 'ping' || type === 'connected') return
        try {
          const msg = JSON.parse(e.data) as SseMessage
          this.handlers.forEach((h) => h(msg))
        } catch {}
      })
    })

    this.es.onerror = () => {
      // EventSource 브라우저 자동 재연결 — 별도 처리 불필요
    }
  }

  disconnect(): void {
    this.es?.close()
    this.es = null
    this.projectId = null
  }

  onMessage(handler: Handler): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }
}

export const sseClient = new SseClient()
