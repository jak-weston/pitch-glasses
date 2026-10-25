import type { FollowUpDraft } from "./agent.js";

export async function sendFollowUp(draft: FollowUpDraft): Promise<string> {
  const { RESEND_API_KEY, FOLLOWUP_TO, FOLLOWUP_FROM } = process.env;
  if (!RESEND_API_KEY || !FOLLOWUP_TO) return "Approved (email not configured - draft saved)";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FOLLOWUP_FROM || "onboarding@resend.dev",
      to: FOLLOWUP_TO,
      subject: draft.subject,
      text: draft.body,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return `Sent to ${FOLLOWUP_TO}`;
}
