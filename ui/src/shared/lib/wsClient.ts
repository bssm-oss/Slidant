type WsMessage = Record<string, unknown>
type Handler = (msg: WsMessage) => void

class WsClient {
  private socket: WebSocket | null = null
  private handlers: Handler[] = []
  private projectId: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxDelay = 30000

  connect(projectId: string): void {
    if (this.socket && this.projectId === projectId &&
        this.socket.readyState === WebSocket.OPEN) return
    this.projectId = projectId
    this._connect()
  }

  private _connect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = null }

    const wsBase = (() => {
      if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
      const apiUrl = import.meta.env.VITE_API_URL
      if (apiUrl && /^https?:\/\//.test(apiUrl)) return apiUrl.replace(/^http/, 'ws')
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1`
    })()

    this.socket = new WebSocket(`${wsBase}/agent/ws/${this.projectId}`)

    this.socket.onopen = () => {
      this.reconnectDelay = 1000  // reset backoff on successful connect
    }

    this.socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WsMessage
        this.handlers.forEach((h) => h(msg))
      } catch {}
    }

    this.socket.onclose = () => {
      this.socket = null
      if (this.projectId) {
        this.reconnectTimer = setTimeout(() => {
          this._connect()
        }, this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      }
    }
  }

  disconnect(): void {
    this.projectId = null
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = null }
  }

  onMessage(handler: Handler): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }

  send(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
  }
}

export const wsClient = new WsClient()
