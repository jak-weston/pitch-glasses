// Runs saved transcripts through the brief + follow-up pipeline in parallel and appends each to deals.csv.
// Usage: npm run replay [-- path/to/folder-or-file ...]   (defaults to ../test-data)
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftFollowUp, writeBrief } from "./agent.js";
import { appendDeal, DEALS_CSV } from "./dealLog.js";
import { loadPlaybooks } from "./playbooks.js";
import { writeRunReport } from "./runLog.js";
import { BRIEFS_DIR, renderBriefPdf } from "./pdf.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [path.resolve(here, "../../test-data")];
const files = targets.flatMap((t) =>
  fs.statSync(t).isDirectory() ? fs.readdirSync(t).filter((f) => f.endsWith(".txt")).map((f) => path.join(t, f)) : [t],
);

const playbook = loadPlaybooks().get("pitch-vetting")!;

async function run(file: string) {
  const started = Date.now();
  const transcript = fs.readFileSync(file, "utf8").trim();
  const brief = await writeBrief(playbook, transcript);
  const briefMs = Date.now() - started;
  const draft = await draftFollowUp(playbook, transcript, brief);
  const pdf = await renderBriefPdf(brief, draft, playbook.name).catch((err) => { console.error("PDF failed", err); return ""; });
  appendDeal(playbook.id, transcript, brief, draft, pdf);
  if (pdf) console.log(`pdf: ${path.join(BRIEFS_DIR, pdf)}`);
  const report = writeRunReport({
    playbook: playbook.id, transcript, liveLines: [], brief, followUp: draft,
    timings: { brief: briefMs, "follow-up": Date.now() - started - briefMs, total: Date.now() - started },
  });
  console.log(`report: ${report}`);
  const headline = brief.split("\n").slice(0, 6).join("\n");
  console.log(`\n=== ${path.basename(file)} (${Math.round((Date.now() - started) / 1000)}s)\n${headline}\nFollow-up: ${draft.subject}`);
}

const results = await Promise.allSettled(files.map(run));
results.forEach((r, i) => {
  if (r.status === "rejected") console.error(`\n!!! ${path.basename(files[i])} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
});
console.log(`\nSaved to ${DEALS_CSV}`);
