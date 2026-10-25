import { LiveTranscriber } from "./deepgram.js";
import { draftFollowUp, liveLine, writeBrief, type FollowUpDraft } from "./agent.js";
import { sendFollowUp } from "./email.js";
import { appendDeal } from "./dealLog.js";
import { writeRunReport } from "./runLog.js";
import { renderBriefPdf } from "./pdf.js";
import type { Playbook } from "./playbooks.js";

export type Phase = "idle" | "listening" | "briefing" | "awaiting_approval";

export interface AppEvent {
  seq: number;
  type: "status" | "transcript" | "line" | "brief" | "brief_pdf" | "followup" | "result" | "error";
  [key: string]: unknown;
}

function briefField(brief: string, label: string): string {
  const match = brief.match(new RegExp(`${label}:\\**\\s*([^*\\n]+)`, "i"));
  return match ? match[1].trim() : "";
}

// The wrap-up card on the glasses: summary, score, what to look into, and the drafted action.
// The G2 shows ~45 characters per line in our container; wrap on word boundaries instead of truncating.
const GLASSES_LINE_CHARS = 42;

export function wrapForGlasses(text: string, width = GLASSES_LINE_CHARS): string {
  return text
    .split("\n")
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && (line + " " + word).length > width) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      lines.push(line);
      return lines.join("\n");
    })
    .join("\n");
}

function wrapUpCard(brief: string): string {
  const summary = briefField(brief, "Summary");
  const total = brief.match(/Total:\s*(\d+)\s*\/\s*20/i);
  const verdict = briefField(brief, "Verdict").replace("Review with investment team", "Review w/ team");
  const lookInto = briefField(brief, "Look into");
  const nextStep = briefField(brief, "Next step") || "Follow up";
  const sendLabel = nextStep === "Share with partners" ? "Send note to partners?" : nextStep === "Pass" ? "Send pass email?" : "Send follow-up?";
  return wrapForGlasses(
    [
      `${total ? `${total[1]}/20` : "--/20"}  ${verdict}`,
      summary || "Brief ready on screen",
      "",
      lookInto ? `Ask: ${lookInto}` : "",
      "",
      `${sendLabel}  Tap = yes · Swipe = no`,
    ].join("\n"),
  );
}

const LIVE_LINE_MIN_GAP_MS = 6000;
const AUTO_END_MIN_WORDS = 30;
const MIN_PITCH_WORDS = 40;
const LIVE_LINE_MIN_NEW_WORDS = 12;

export class Session {
  phase: Phase = "idle";
  playbook: Playbook;
  private events: AppEvent[] = [];
  private seq = 0;
  private listeners = new Set<(e: AppEvent) => void>();
  private transcriber: LiveTranscriber | null = null;
  private transcript = "";
  private wordsAtLastLine = 0;
  private lastLineAt = 0;
  private lineInFlight = false;
  private shownLines: string[] = [];
  private draft: FollowUpDraft | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;

  constructor(private playbooks: Map<string, Playbook>, private deepgramKey: string) {
    this.playbook = playbooks.values().next().value as Playbook;
  }

  subscribe(fn: (e: AppEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  eventsSince(seq: number) {
    return this.events.filter((e) => e.seq > seq);
  }

  snapshot() {
    return { phase: this.phase, playbook: this.playbook.id, playbooks: [...this.playbooks.values()].map((p) => ({ id: p.id, name: p.name })) };
  }

  setPlaybook(id: string) {
    const pb = this.playbooks.get(id);
    if (!pb || this.phase !== "idle") return;
    this.playbook = pb;
    this.emit({ type: "status", ...this.snapshot(), glasses: `Playbook: ${pb.name}\nTap to start listening` });
  }

  start() {
    if (this.phase !== "idle") return;
    this.transcript = "";
    this.wordsAtLastLine = 0;
    this.shownLines = [];
    this.draft = null;
    this.transcriber = new LiveTranscriber(this.deepgramKey, this.playbook.keyterms, {
      onInterim: (text) => {
        this.armSilenceTimer();
        this.emit({ type: "transcript", text, final: false });
      },
      onFinal: (text) => this.handleFinal(text),
      onError: (message) => this.emit({ type: "error", message }),
    });
    this.transcriber.start();
    this.setPhase("listening", "● Listening...\n\nEnds on its own when they stop\n(or tap)");
  }

  audio(pcm: Buffer) {
    if (this.phase === "listening") this.transcriber?.send(pcm);
  }

  async stop() {
    if (this.phase !== "listening") return;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.transcriber?.stop();
    this.transcriber = null;
    // Don't write a brief (or log a deal) for an accidental tap or a clip too short to judge.
    if (this.transcript.split(/\s+/).filter(Boolean).length < MIN_PITCH_WORDS) {
      this.setPhase("idle", "Didn't catch enough of the pitch.\n\nTap to try again");
      return;
    }
    await this.analyze(this.transcript);
  }

  // Runs a finished transcript through brief -> follow-up -> deal log. Also used to replay typed transcripts.
  async analyze(transcript: string) {
    this.transcript = transcript;
    this.setPhase("briefing", "Writing your brief...");
    try {
      const t0 = Date.now();
      const brief = await writeBrief(this.playbook, transcript);
      this.emit({ type: "brief", markdown: brief });
      const t1 = Date.now();
      this.draft = await draftFollowUp(this.playbook, transcript, brief);
      this.emit({ type: "followup", ...this.draft });
      let briefPdf = "";
      try {
        briefPdf = await renderBriefPdf(brief, this.draft, this.playbook.name);
        this.emit({ type: "brief_pdf", url: `/briefs/${briefPdf}` });
      } catch (err) {
        console.error("PDF render failed", err);
      }
      appendDeal(this.playbook.id, transcript, brief, this.draft, briefPdf);
      const report = writeRunReport({
        playbook: this.playbook.id, transcript, liveLines: this.shownLines, brief, followUp: this.draft,
        timings: { brief: t1 - t0, "follow-up": Date.now() - t1, total: Date.now() - t0 },
      });
      console.log(`[run] report saved: ${report}`);
      this.setPhase("awaiting_approval", wrapUpCard(brief));
    } catch (err) {
      this.fail(err);
    }
  }

  async approve() {
    if (this.phase !== "awaiting_approval" || !this.draft) return;
    try {
      const result = await sendFollowUp(this.draft);
      this.emit({ type: "result", message: result });
      this.setPhase("idle", `✓ ${result}\n\nTap to start again`);
    } catch (err) {
      this.fail(err);
    }
  }

  reject() {
    if (this.phase !== "awaiting_approval") return;
    this.emit({ type: "result", message: "Follow-up skipped" });
    this.setPhase("idle", "Follow-up skipped\n\nTap to start again");
  }

  tap() {
    if (this.phase === "idle") return this.start();
    if (this.phase === "listening") return void this.stop();
    if (this.phase === "awaiting_approval") return void this.approve();
  }

  // Hands-free end: once enough has been said, a long enough silence closes the session.
  private armSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    const seconds = this.playbook.silence_seconds;
    if (!seconds || this.transcript.split(/\s+/).length < AUTO_END_MIN_WORDS) return;
    this.silenceTimer = setTimeout(() => void this.stop(), seconds * 1000);
  }

  private handleFinal(text: string) {
    this.transcript = `${this.transcript} ${text}`.trim();
    this.armSilenceTimer();
    this.emit({ type: "transcript", text, final: true });
    const lower = this.transcript.toLowerCase();
    if (this.playbook.end_phrases.some((p) => lower.endsWith(p) || lower.includes(`${p}.`) || lower.includes(`${p},`))) {
      void this.stop();
      return;
    }
    void this.maybeLiveLine();
  }

  private async maybeLiveLine() {
    const words = this.transcript.split(/\s+/).length;
    const due = words - this.wordsAtLastLine >= LIVE_LINE_MIN_NEW_WORDS && Date.now() - this.lastLineAt >= LIVE_LINE_MIN_GAP_MS;
    if (!due || this.lineInFlight || this.phase !== "listening") return;
    this.lineInFlight = true;
    this.wordsAtLastLine = words;
    this.lastLineAt = Date.now();
    try {
      const line = await liveLine(this.playbook, this.transcript, this.shownLines);
      if (line && this.phase === "listening") {
        this.shownLines.push(line);
        const source = line.match(/\(([^)]+)\)\s*$/);
        const fact = source ? line.slice(0, source.index).trim() : line;
        this.emit({ type: "line", text: line, glasses: wrapForGlasses(`${fact}\n${source ? source[1] : ""}\n\n● listening`) });
      }
    } catch (err) {
      console.error("live line failed", err);
    } finally {
      this.lineInFlight = false;
    }
  }

  private setPhase(phase: Phase, glasses: string) {
    this.phase = phase;
    this.emit({ type: "status", ...this.snapshot(), glasses });
  }

  private fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    this.emit({ type: "error", message });
    this.setPhase("idle", "Something went wrong.\nTap to try again");
  }

  private emit(partial: Omit<AppEvent, "seq">) {
    const event = { ...partial, seq: ++this.seq } as AppEvent;
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    for (const fn of this.listeners) fn(event);
  }
}
