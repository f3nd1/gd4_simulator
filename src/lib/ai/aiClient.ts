import type { AISettings } from "../../types";

// The ONLY place that knows how to reach an LLM. Right now this calls the
// OpenAI Chat Completions API directly from the browser using a key the
// user pasted into Settings — explicitly a prototype/internal-testing
// arrangement (see Settings page warning), never something to ship as-is.
// Swapping this for a backend proxy later means changing the fetch call in
// this one function; nothing else in the app should need to change.

export type AIChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class AIClientError extends Error {}

const DEFAULT_MODEL = "gpt-5-mini";

// GPT-5 and the o-series are reasoning models: Chat Completions rejects any
// `temperature` other than the default (1) for them with a 400, which would
// otherwise silently drop every call back to the offline simulation. Only
// send a custom temperature to models that actually accept one.
function supportsTemperature(model: string): boolean {
  return !/^(gpt-5|o1|o3|o4)/.test(model);
}

export async function chatComplete(messages: AIChatMessage[], settings: AISettings): Promise<string> {
  if (!settings.enabled) throw new AIClientError("AI integration is disabled in Settings.");
  if (!settings.apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");

  const model = settings.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages,
    response_format: { type: "json_object" },
  };
  if (supportsTemperature(model)) body.temperature = 0.2;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
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

// Separate from chatComplete because image evidence (scanned forms, photos
// of signed documents, etc.) needs a vision-capable multimodal request and a
// free-text reply, not the JSON-verdict shape every other caller here wants.
export async function describeImage(imageDataUrl: string, settings: AISettings): Promise<string> {
  if (!settings.enabled) throw new AIClientError("AI integration is disabled in Settings.");
  if (!settings.apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");

  const model = settings.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content:
          "This image is evidence in a compliance audit. Transcribe all visible text verbatim, then briefly describe any non-text content (stamps, signatures, charts, diagrams).",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this evidence image." },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };
  if (supportsTemperature(model)) body.temperature = 0.1;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
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
