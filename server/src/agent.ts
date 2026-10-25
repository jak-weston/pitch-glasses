import Anthropic from "@anthropic-ai/sdk";
import type { Playbook } from "./playbooks.js";
import { logCall } from "./runLog.js";

const MODEL = "claude-sonnet-5-5";
const client = new Anthropic();

type Effort = "low" | "medium" | "high";

interface AskOptions {
  step: string;
  system: string;
  prompt: string;
  effort: Effort;
  maxSearches: number;
}

function extractAnswer(content: Anthropic.Beta.BetaContentBlock[]): string {
  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const tagged = text.match(/<answer>([\s\S]*?)<\/answer>/);
  return (tagged ? tagged[1] : text).trim();
}

async function ask({ step, system, prompt, effort, maxSearches }: AskOptions): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const tools = maxSearches > 0 ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: maxSearches }] : undefined;
  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let webSearches = 0;
  let stopReason: string | null = null;

  try {
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort },
        system,
        messages,
        ...(tools ? { tools } : {}),
      } as any);

      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      webSearches += (response.usage as any)?.server_tool_use?.web_search_requests ?? 0;
      stopReason = response.stop_reason;

      if (response.stop_reason === "refusal") return "";
      if (response.stop_reason !== "pause_turn") return extractAnswer(response.content);
      messages.push({ role: "assistant", content: response.content });
    }
    return "";
  } catch (err) {
    logCall({ step, ms: Date.now() - started, inputTokens, outputTokens, webSearches, stopReason, error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    if (stopReason !== null) logCall({ step, ms: Date.now() - started, inputTokens, outputTokens, webSearches, stopReason });
  }
}

export async function liveLine(playbook: Playbook, transcript: string, alreadyShown: string[]): Promise<string | null> {
  const answer = await ask({
    step: "live-line",
    effort: "low",
    maxSearches: 2,
    system:
      "You feed one-line facts to a person wearing smart glasses while someone talks to them. " +
      "Keep the fact under 70 characters, in plain words, with digits for numbers (e.g. 'Synthetic raised $10M seed, Khosla led'). " +
      "Only state facts you found in search results, never guesses. The transcript is live speech-to-text with errors; infer intended names. " +
      "Format: '<fact> (<source domain>)'. Put the final line inside <answer></answer>. " +
      "If nothing new and useful can be sourced, answer <answer>NONE</answer>.",
    prompt:
      `${playbook.live_lines}\n\nAlready shown (do not repeat):\n${alreadyShown.map((l) => `- ${l}`).join("\n") || "- (nothing yet)"}\n\n` +
      `Transcript so far:\n"""${transcript}"""`,
  });
  if (!answer || answer.toUpperCase().startsWith("NONE")) return null;
  return answer.replace(/\s+/g, " ").slice(0, 120);
}

export async function writeBrief(playbook: Playbook, transcript: string): Promise<string> {
  return ask({
    step: "brief",
    effort: "medium",
    maxSearches: 8,
    system:
      "You are a sharp analyst. Research with web search, then write the requested document. " +
      "Put the full markdown document inside <answer></answer>. Never invent numbers; say 'unknown' if you cannot source one.",
    prompt: `${playbook.brief}\n\nTranscript:\n"""${transcript}"""`,
  });
}

export interface FollowUpDraft {
  subject: string;
  body: string;
}

export async function draftFollowUp(playbook: Playbook, transcript: string, brief: string): Promise<FollowUpDraft> {
  const answer = await ask({
    step: "follow-up",
    effort: "low",
    maxSearches: 0,
    system:
      "You draft short emails in the user's own voice. Match the tone of their samples. " +
      'Return JSON {"subject": string, "body": string} inside <answer></answer>, nothing else.',
    prompt:
      `${playbook.followup}\n\nVoice samples:\n${playbook.voice_samples.map((s) => `- ${s}`).join("\n")}\n\n` +
      `Brief:\n${brief}\n\nTranscript:\n"""${transcript}"""`,
  });
  try {
    const parsed = JSON.parse(answer);
    return { subject: String(parsed.subject ?? "Following up"), body: String(parsed.body ?? "") };
  } catch {
    return { subject: "Following up", body: answer };
  }
}
