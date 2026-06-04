type WsMessage = Record<string, unknown>
type JsonHandler = (msg: WsMessage) => void
type BinaryHandler = (data: ArrayBuffer) => void

class WsClient {
  private socket: WebSocket | null = null
  private jsonHandlers: JsonHandler[] = []
  private binaryHandlers: BinaryHandler[] = []
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

    const token = localStorage.getItem('access_token') ?? ''
    this.socket = new WebSocket(`${wsBase}/ws/${this.projectId}?token=${token}`)
    this.socket.binaryType = 'arraybuffer'

    this.socket.onopen = () => {
      this.reconnectDelay = 1000
    }

    this.socket.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.binaryHandlers.forEach((h) => h(e.data as ArrayBuffer))
        return
      }
      try {
        const msg = JSON.parse(e.data as string) as WsMessage
        this.jsonHandlers.forEach((h) => h(msg))
      } catch {}
    }

    this.socket.onclose = () => {
      this.socket = null
      if (this.projectId) {
        this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      }
    }
  }

  disconnect(): void {
    this.projectId = null
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = null }
  }

  // JSON 메시지 핸들러 (에이전트 이벤트, presence 등)
  onMessage(handler: JsonHandler): () => void {
    this.jsonHandlers.push(handler)
    return () => { this.jsonHandlers = this.jsonHandlers.filter((h) => h !== handler) }
  }

  // Binary 메시지 핸들러 (Yjs CRDT sync)
  onBinaryMessage(handler: BinaryHandler): () => void {
    this.binaryHandlers.push(handler)
    return () => { this.binaryHandlers = this.binaryHandlers.filter((h) => h !== handler) }
  }

  send(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
  }

  sendBinary(data: ArrayBuffer | Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    // new Uint8Array(src) copies into a fresh ArrayBuffer — no SharedArrayBuffer ambiguity
    const buf: ArrayBuffer = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)).buffer
    this.socket.send(buf)
  }

  sendPresence(currentSlide: number): void {
    this.send(JSON.stringify({
      type: 'presence_update',
      data: { currentSlide },
    }))
  }
}

export const wsClient = new WsClient()
