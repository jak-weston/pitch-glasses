import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(here, "../../logs");
const RUNS_DIR = path.join(LOG_DIR, "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

export interface CallRecord {
  step: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  webSearches?: number;
  stopReason?: string | null;
  error?: string;
}

// One JSON line per Claude call: timing, tokens, searches, and failures.
export function logCall(record: CallRecord) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...record });
  fs.appendFileSync(path.join(LOG_DIR, "calls.jsonl"), line + "\n");
  console.log(`[claude] ${record.step} ${record.ms}ms tokens=${record.inputTokens ?? "?"}/${record.outputTokens ?? "?"} searches=${record.webSearches ?? 0}${record.error ? ` ERROR ${record.error}` : ""}`);
}

export interface RunReport {
  playbook: string;
  transcript: string;
  liveLines: string[];
  brief: string;
  followUp: { subject: string; body: string };
  timings: Record<string, number>;
}

// A human-readable record of one pitch, end to end.
export function writeRunReport(run: RunReport): string {
  const company = (run.brief.match(/^#\s+(.+)$/m)?.[1] ?? "unnamed").split(/\s+[-–—]\s+/)[0];
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unnamed";
  const file = path.join(RUNS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.md`);
  const timings = Object.entries(run.timings).map(([k, v]) => `- ${k}: ${(v / 1000).toFixed(1)}s`).join("\n");
  const body = [
    `# Run: ${company}`,
    `Playbook: ${run.playbook}`,
    `## Timings\n${timings}`,
    `## Live facts shown on glasses\n${run.liveLines.map((l) => `- ${l}`).join("\n") || "- (none)"}`,
    `## Follow-up draft\n**${run.followUp.subject}**\n\n${run.followUp.body}`,
    `## Brief\n${run.brief}`,
    `## Transcript\n${run.transcript}`,
  ].join("\n\n");
  fs.writeFileSync(file, body + "\n");
  return file;
}
