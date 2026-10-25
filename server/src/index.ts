import "./env.js";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { loadPlaybooks } from "./playbooks.js";
import { Session } from "./session.js";
import { readDeals } from "./dealLog.js";
import { BRIEFS_DIR } from "./pdf.js";

const { DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, PORT = "8787" } = process.env;
if (!DEEPGRAM_API_KEY || !ANTHROPIC_API_KEY) {
  console.error("Missing DEEPGRAM_API_KEY or ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const session = new Session(loadPlaybooks(), DEEPGRAM_API_KEY);
const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
app.use(express.static(path.resolve(here, "../public")));
// The built glasses app, so a single public URL (tunnel) can serve both the app and its backend.
app.use("/glasses", express.static(path.resolve(here, "../../glasses/dist")));
app.use("/briefs", express.static(BRIEFS_DIR));

// Deal history for the dashboard's Deals tab (newest first; long fields trimmed except the brief).
app.get("/api/deals", (_req, res) => {
  const deals = readDeals().reverse().map((d) => ({ ...d, Transcript: undefined, pdfUrl: d["Brief PDF"] ? `/briefs/${d["Brief PDF"]}` : "" }));
  res.json(deals);
});

// HTTP fallback for clients that can't hold a WebSocket open (e.g. if the glasses WebView blocks it).
app.post("/api/audio", express.raw({ type: "*/*", limit: "2mb" }), (req, res) => {
  session.audio(req.body as Buffer);
  res.sendStatus(204);
});
app.post("/api/control", express.json(), (req, res) => {
  handleControl(req.body);
  res.json(session.snapshot());
});
// Replay a typed transcript through the full pipeline (demo fallback and testing without audio).
app.post("/api/replay", express.json({ limit: "1mb" }), (req, res) => {
  const transcript = String(req.body?.transcript ?? "").trim();
  if (!transcript || session.phase === "listening" || session.phase === "briefing") return void res.status(409).json(session.snapshot());
  void session.analyze(transcript);
  res.json(session.snapshot());
});
app.get("/api/events", (req, res) => {
  res.json({ ...session.snapshot(), events: session.eventsSince(Number(req.query.since ?? 0)) });
});

function handleControl(msg: { type?: string; id?: string }) {
  switch (msg.type) {
    case "tap": return session.tap();
    case "start": return session.start();
    case "stop": return void session.stop();
    case "approve": return void session.approve();
    case "reject": return session.reject();
    case "playbook": return msg.id && session.setPlaybook(msg.id);
  }
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", ...session.snapshot(), events: session.eventsSince(0) }));
  const unsubscribe = session.subscribe((event) => socket.send(JSON.stringify(event)));
  socket.on("message", (data, isBinary) => {
    if (isBinary) return session.audio(data as Buffer);
    try {
      handleControl(JSON.parse(data.toString()));
    } catch {
      /* ignore malformed control messages */
    }
  });
  socket.on("close", unsubscribe);
});

server.listen(Number(PORT), () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log("Expose for the glasses with: cloudflared tunnel --url http://localhost:" + PORT);
});
