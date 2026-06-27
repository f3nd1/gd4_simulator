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

// Builds a per-call settings object: picks the analysis vs utility model and
// merges in the School Context briefing. One helper so every call site routes
// the model and injects context consistently.
export function effectiveSettings(base: AISettings, opts: { purpose: "analysis" | "utility"; context?: string }): AISettings {
  return {
    ...base,
    model: opts.purpose === "utility" ? base.utilityModel || base.model : base.model,
    context: opts.context,
  };
}

// School Context is background, never evidence — labeled so the model weighs
// it for interpretation but can't treat it as proof of a requirement.
//
// Hard cap on the injected context. The API is stateless — this prefix is
// re-sent on EVERY call — so we bound it. It's also placed first and kept
// identical across calls so OpenAI's automatic prompt caching applies (much
// cheaper than full price for the repeated prefix). The School Context page
// shows the live size + this cap so the user can see what's actually sent.
export const CONTEXT_CHAR_CAP = 8000; // ≈ 2000 tokens

function withContext(messages: AIChatMessage[], settings: AISettings): AIChatMessage[] {
  const ctx = settings.context?.trim();
  if (!ctx) return messages;
  const preamble: AIChatMessage = {
    role: "system",
    content: `Background context about the institution being audited (use it to interpret evidence and tailor your comments to this school; it is itself NOT evidence and cannot on its own satisfy any requirement):\n${ctx.slice(0, CONTEXT_CHAR_CAP)}`,
  };
  return [preamble, ...messages];
}

export async function chatComplete(messages: AIChatMessage[], settings: AISettings): Promise<string> {
  if (!settings.enabled) throw new AIClientError("AI integration is disabled in Settings.");
  if (!settings.apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");

  const model = settings.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: withContext(messages, settings),
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

// Condenses one document's text to a fact-dense summary (utility model) so a
// big folder can be audited in full instead of being silently truncated.
// Keeps concrete specifics — dates, names, approvals, figures, the presence of
// records/implementation — which is exactly what the audit judges on.
export async function summariseText(label: string, text: string, settings: AISettings, maxChars = 1500): Promise<string> {
  if (!settings.enabled || !settings.apiKey) return text.slice(0, maxChars);
  const model = settings.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: `Summarise this audit-evidence document into at most ${Math.round(maxChars / 5)} words. Preserve concrete, verifiable specifics: dates, names, approvals/sign-offs, figures, version/record numbers, and any sign that something is actually implemented and reviewed (not just a policy). Do not add anything not in the text. Plain text only.` },
      { role: "user", content: `Document: ${label}\n"""\n${text.slice(0, 16000)}\n"""` },
    ],
  };
  if (supportsTemperature(model)) body.temperature = 0.1;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) return text.slice(0, maxChars); // best-effort: fall back to truncation
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  return typeof out === "string" ? out.slice(0, maxChars) : text.slice(0, maxChars);
}
