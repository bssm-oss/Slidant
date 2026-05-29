type WsMessage = Record<string, unknown>
type Handler = (msg: WsMessage) => void

class WsClient {
  private socket: WebSocket | null = null
  private handlers: Handler[] = []
  private projectId: string | null = null

  connect(projectId: string): void {
    if (this.socket && this.projectId === projectId) return
    this.disconnect()
    this.projectId = projectId
    this.socket = new WebSocket(`ws://localhost:8000/api/v1/agent/ws/${projectId}`)
    this.socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WsMessage
        this.handlers.forEach((h) => h(msg))
      } catch {}
    }
    this.socket.onclose = () => { this.socket = null }
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = null
    this.projectId = null
  }

  onMessage(handler: Handler): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }

  send(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data)
    }
  }
}

export const wsClient = new WsClient()
