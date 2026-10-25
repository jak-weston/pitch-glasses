export interface ServerEvent {
  type: string
  seq?: number
  phase?: string
  glasses?: string
  message?: string
  events?: ServerEvent[]
}

export interface ServerLink {
  sendAudio: (pcm: Uint8Array) => void
  control: (msg: { type: string; id?: string }) => void
}

const AUDIO_FLUSH_MS = 250
const POLL_MS = 700

// Prefers a WebSocket; falls back to HTTP POST + polling if the glasses WebView refuses WebSockets.
export function connectServer(baseUrl: string, onEvent: (e: ServerEvent) => void, onConnected: (mode: string) => void): ServerLink {
  let ws: WebSocket | null = null
  let httpMode = false
  let lastSeq = 0
  let audioQueue: Uint8Array[] = []

  const deliver = (e: ServerEvent) => {
    if (e.seq && e.seq <= lastSeq) return
    if (e.seq) lastSeq = e.seq
    onEvent(e)
  }

  const startHttp = () => {
    if (httpMode) return
    httpMode = true
    onConnected('http')
    setInterval(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/events?since=${lastSeq}`)
        const body = await res.json()
        for (const e of body.events as ServerEvent[]) deliver(e)
      } catch {
        /* transient network error - next poll retries */
      }
    }, POLL_MS)
    setInterval(() => {
      if (!audioQueue.length) return
      const total = audioQueue.reduce((n, c) => n + c.length, 0)
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of audioQueue) { merged.set(chunk, offset); offset += chunk.length }
      audioQueue = []
      fetch(`${baseUrl}/api/audio`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: merged }).catch(() => {})
    }, AUDIO_FLUSH_MS)
  }

  let everOpened = false
  const connectWs = () => {
    try {
      ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws')
    } catch {
      startHttp()
      return
    }
    ws.binaryType = 'arraybuffer'
    const fallbackTimer = setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN && !everOpened) { ws?.close(); startHttp() }
    }, 4000)
    ws.onopen = () => { clearTimeout(fallbackTimer); everOpened = true; lastSeq = 0; onConnected('websocket') }
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data as string) as ServerEvent
      if (msg.type === 'hello') { msg.events?.forEach(deliver); onEvent({ type: 'status', phase: msg.phase }); return }
      deliver(msg)
    }
    ws.onerror = () => { clearTimeout(fallbackTimer); if (!everOpened) startHttp() }
    // Server restarted or network blipped: reconnect instead of going silent.
    ws.onclose = () => { if (everOpened && !httpMode) setTimeout(connectWs, 1500) }
  }
  connectWs()

  return {
    sendAudio(pcm) {
      if (!httpMode && ws?.readyState === WebSocket.OPEN) ws.send(pcm)
      else if (httpMode) audioQueue.push(pcm)
    },
    control(msg) {
      if (!httpMode && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      else fetch(`${baseUrl}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {})
    },
  }
}
