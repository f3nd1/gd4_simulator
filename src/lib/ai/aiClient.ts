import type { AISettings } from "../../types";

// The ONLY place that knows how to reach an LLM. Right now this calls the
// OpenAI Chat Completions API directly from the browser using a key the
// user pasted into Settings — explicitly a prototype/internal-testing
// arrangement (see Settings page warning), never something to ship as-is.
// Swapping this for a backend proxy later means changing the fetch call in
// this one function; nothing else in the app should need to change.

export type AIChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class AIClientError extends Error {}

export async function chatComplete(messages: AIChatMessage[], settings: AISettings): Promise<string> {
  if (!settings.enabled) throw new AIClientError("AI integration is disabled in Settings.");
  if (!settings.apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "gpt-4o-mini",
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIClientError(`OpenAI request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AIClientError("OpenAI response did not contain a message.");
  return content;
}
