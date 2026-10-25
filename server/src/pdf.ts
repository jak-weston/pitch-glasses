import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { chromium, type Browser } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BRIEFS_DIR = path.resolve(here, "../../briefs");
fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// Uses a locally installed Chromium (CHROMIUM_PATH, or Playwright's cache) so no browser download is needed.
function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(cache)) return undefined;
  const shells = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const dir of shells) {
    const bin = path.join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

let browser: Promise<Browser> | null = null;
function getBrowser() {
  browser ??= chromium.launch({ executablePath: findChromium(), headless: true });
  return browser;
}

const STYLE = `
  body { font: 11pt/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1b1f1d; margin: 0; }
  header { border-bottom: 3px solid #1f9d55; padding-bottom: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; }
  header .brand { font-weight: 700; color: #1f9d55; } header .meta { color: #6b7570; font-size: 9pt; }
  h1 { font-size: 20pt; margin: 0 0 6px; } h2 { font-size: 12pt; color: #1f9d55; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10pt; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dfe5e2; vertical-align: top; }
  th { background: #f3f6f4; } td:nth-child(2) { font-weight: 700; white-space: nowrap; }
  ul { padding-left: 18px; margin: 4px 0; } li { margin: 2px 0; }
  .followup { margin-top: 20px; padding: 12px 14px; background: #f3f6f4; border-left: 3px solid #1f9d55; white-space: pre-wrap; font-size: 10pt; }
  footer { margin-top: 24px; color: #9aa39f; font-size: 8pt; }
`;

export async function renderBriefPdf(brief: string, followUp: { subject: string; body: string }, playbookName: string): Promise<string> {
  const company = (brief.match(/^#\s+(.+)$/m)?.[1] ?? "pitch").split(/\s+[-–—]\s+/)[0];
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pitch";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  let file = `${stamp}-${slug}.pdf`;
  for (let n = 2; fs.existsSync(path.join(BRIEFS_DIR, file)); n++) file = `${stamp}-${slug}-${n}.pdf`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <header><span class="brand">Pitch Glasses · Brief</span><span class="meta">${playbookName} · ${new Date().toLocaleString()}</span></header>
    ${await marked.parse(brief, { breaks: true })}
    <h2>Drafted email</h2>
    <div class="followup"><strong>${followUp.subject}</strong>\n\n${followUp.body}</div>
    <footer>Generated from a live conversation. Facts marked "(unverified)" could not be confirmed online.</footer>
  </body></html>`;
  const page = await (await getBrowser()).newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: path.join(BRIEFS_DIR, file), format: "Letter", margin: { top: "0.6in", bottom: "0.6in", left: "0.7in", right: "0.7in" }, printBackground: true });
  } finally {
    await page.close();
  }
  return file;
}
