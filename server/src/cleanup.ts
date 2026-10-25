// Tidies deals.csv: drops aborted runs, keeps only the newest run of each identical transcript,
// and renders a brief PDF for any row that doesn't have one yet.
// Usage: npm run cleanup
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { readDeals, replaceDeals } from "./dealLog.js";
import { BRIEFS_DIR, renderBriefPdf } from "./pdf.js";

const MIN_TRANSCRIPT_WORDS = 20;
const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

const all = readDeals();
const newestByTranscript = new Map<string, Record<string, string>>();
for (const deal of all) {
  if (deal.Transcript.split(/\s+/).length < MIN_TRANSCRIPT_WORDS) continue;
  const key = normalize(deal.Transcript);
  const kept = newestByTranscript.get(key);
  if (!kept || deal.Date > kept.Date) newestByTranscript.set(key, deal);
}
const deals = [...newestByTranscript.values()].sort((a, b) => a.Date.localeCompare(b.Date));

for (const deal of deals) {
  if (deal["Brief PDF"] && fs.existsSync(path.join(BRIEFS_DIR, deal["Brief PDF"]))) continue;
  deal["Brief PDF"] = await renderBriefPdf(deal.Brief, { subject: deal["Follow-up Subject"], body: deal["Follow-up Body"] }, "Pitch vetting (pre-seed rubric)");
  console.log(`PDF: ${deal.Company || "Unnamed"} -> ${deal["Brief PDF"]}`);
}

replaceDeals(deals);
console.log(`Kept ${deals.length} of ${all.length} rows.`);
process.exit(0);
