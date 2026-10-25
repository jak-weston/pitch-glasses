import WebSocket from "ws";

export interface TranscriptHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private pending: Buffer[] = [];

  constructor(private apiKey: string, private keyterms: string[], private handlers: TranscriptHandlers) {}

  start() {
    const params = new URLSearchParams({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      endpointing: "300",
    });
    for (const term of this.keyterms) params.append("keyterm", term);

    this.socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    this.socket.on("open", () => {
      for (const chunk of this.pending) this.socket?.send(chunk);
      this.pending = [];
      this.keepAlive = setInterval(() => this.socket?.send(JSON.stringify({ type: "KeepAlive" })), 8000);
    });
    this.socket.on("message", (raw) => this.handleMessage(raw.toString()));
    this.socket.on("error", (err) => this.handlers.onError(`Deepgram error: ${err.message}`));
    this.socket.on("close", () => this.clearKeepAlive());
  }

  send(pcm: Buffer) {
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(pcm);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.pending.push(pcm);
  }

  stop() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "CloseStream" }));
    this.clearKeepAlive();
    setTimeout(() => this.socket?.close(), 1500);
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "Results") return;
    const text: string = msg.channel?.alternatives?.[0]?.transcript ?? "";
    if (!text) return;
    if (msg.is_final) this.handlers.onFinal(text);
    else this.handlers.onInterim(text);
  }

  private clearKeepAlive() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }
}
