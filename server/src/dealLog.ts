import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FollowUpDraft } from "./agent.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEALS_CSV = path.resolve(here, "../../deals.csv");

const COLUMNS = [
  "Date", "Playbook", "Company", "Summary", "Team", "Product", "Market", "Execution", "Fundraisability",
  "Total Score", "Verdict", "Look Into", "Next Step", "Follow-up Subject", "Follow-up Body", "Brief", "Transcript", "Brief PDF",
];

function field(brief: string, label: string): string {
  const match = brief.match(new RegExp(`${label}:\\**\\s*([^*\\n]+)`, "i"));
  return match ? match[1].trim() : "";
}

function score(brief: string, category: string): string {
  const match = brief.match(new RegExp(`\\|\\s*\\**${category}\\**\\s*\\|\\s*(\\d)\\s*/\\s*4`, "i"));
  return match ? match[1] : "";
}

function company(brief: string): string {
  const heading = brief.match(/^#\s+(.+)$/m);
  return heading ? heading[1].split(/\s+[-–—]\s+/)[0].trim() : "";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Minimal RFC 4180 parser (quoted fields, embedded commas, quotes, and newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function writeAll(rows: string[][]) {
  fs.writeFileSync(DEALS_CSV, [COLUMNS, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
}

export function replaceDeals(deals: Record<string, string>[]) {
  writeAll(deals.map((d) => COLUMNS.map((c) => d[c] ?? "")));
}

export function readDeals(): Record<string, string>[] {
  if (!fs.existsSync(DEALS_CSV)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(DEALS_CSV, "utf8"));
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function appendDeal(playbookId: string, transcript: string, brief: string, draft: FollowUpDraft, briefPdf = "") {
  const total = brief.match(/Total:\s*(\d+)\s*\/\s*20/i);
  const row = [
    new Date().toISOString(), playbookId, company(brief), field(brief, "Summary"),
    score(brief, "Team"), score(brief, "Product"), score(brief, "Market"), score(brief, "Execution"), score(brief, "Fundraisability"),
    total ? total[1] : "", field(brief, "Verdict"), field(brief, "Look into"), field(brief, "Next step"),
    draft.subject, draft.body, brief, transcript, briefPdf,
  ];
  // Upgrade older files (written before a column was added) so every row lines up with the header.
  const existing = readDeals().map((d) => COLUMNS.map((c) => d[c] ?? ""));
  writeAll([...existing, row.map(String)]);
}
