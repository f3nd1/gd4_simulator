import type { AISettings } from "../../types";

// The ONLY place that knows how to reach an LLM. Right now this calls the
// OpenAI Chat Completions API directly from the browser using a key the
// user pasted into Settings — explicitly a prototype/internal-testing
// arrangement (see Settings page warning), never something to ship as-is.
// Swapping this for a backend proxy later means changing the fetch call in
// this one function; nothing else in the app should need to change.

export type AIChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Token usage reported by the API for one call, surfaced so the AI Review Log
// can show which model ran and how many tokens it cost.
export type AIUsage = { model: string; promptTokens: number; completionTokens: number; totalTokens: number };

// Adds two usage records (for functions that make more than one API call, e.g.
// the folder audit's challenge pass, or a verdict call plus its image/condense
// helper calls). Keeps the FIRST/primary call's model — the primary call is
// always accumulated first — so a row reports the model that did the main
// analysis, not whichever helper happened to run last on the utility model.
export function addUsage(a: AIUsage | undefined, b: AIUsage | undefined): AIUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    model: a.model || b.model,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export class AIClientError extends Error {}

const DEFAULT_MODEL = "gpt-5-mini";

// Fallback used by verdict-deciding calls when a settings object predates the
// verdictTemperature field (kept in sync with DEFAULT_VERDICT_TEMPERATURE in
// the settings store). Resolves the user-tuned verdict temperature for any
// assessment call: staged audit passes, PPD review, evidence assessment,
// auditor-panel classification.
export function verdictTemp(settings: Pick<AISettings, "verdictTemperature">): number {
  const t = settings.verdictTemperature;
  return typeof t === "number" && t >= 0 && t <= 1 ? t : 0.1;
}

// GPT-5 and the o-series are reasoning models: Chat Completions rejects any
// `temperature` other than the default (1) for them with a 400, which would
// otherwise silently drop every call back to the offline simulation. Only
// send a custom temperature to models that actually accept one.
function supportsTemperature(model: string): boolean {
  return !/^(gpt-5|o1|o3|o4)/.test(model);
}

// Why a run cannot use live AI, in words the user can act on — or null when
// live AI is available. Every audit gate that falls back to the offline
// keyword simulation uses this so the degradation is NEVER silent: the run
// summary says exactly why AI was not used and where to fix it.
export function aiOfflineReason(s: Pick<AISettings, "enabled" | "apiKey">): string | null {
  if (!s.enabled && !s.apiKey) return "AI analysis is switched off and no OpenAI API key is saved on this device — enable it and enter your key in Settings → OpenAI.";
  if (!s.enabled) return "AI analysis is switched off — enable it in Settings → OpenAI.";
  if (!s.apiKey) return "No OpenAI API key is saved on this device/browser. For security the key never syncs between devices — re-enter it in Settings → OpenAI on this device.";
  return null;
}

// Builds a per-call settings object: picks the analysis vs utility model and
// merges in the School Context briefing. One helper so every call site routes
// the model and injects context consistently.
export function effectiveSettings(base: AISettings, opts: { purpose: "analysis" | "utility" | "vision"; context?: string }): AISettings {
  const model =
    opts.purpose === "vision" ? base.visionModel || base.utilityModel || base.model
    : opts.purpose === "utility" ? base.utilityModel || base.model
    : base.model;
  return {
    ...base,
    model,
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

// Every OpenAI call is bounded by this wall-clock ceiling. Without it a single
// request that never resolves (dead connection, proxy black-hole) would hang
// forever — and because the folder audit awaits these calls in sequence, one
// hung call leaves the whole audit stuck on "Auditing…" with no way to clear it.
const REQUEST_TIMEOUT_MS = 90000;

// fetch + an AbortController timeout. An optional external signal (from the
// per-file abort controller in the audit loop) is chained so cancellation via
// skipCurrentFile()/cancelBusy() also aborts any in-flight AI calls immediately.
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Chain external signal: if the caller aborts (user skip/cancel), abort ours too.
  externalSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (externalSignal?.aborted) throw new AIClientError("AI call cancelled.");
      throw new AIClientError(`OpenAI request timed out after ${Math.round(timeoutMs / 1000)}s. The folder may be too large, or the network/API is unresponsive — try again, or audit fewer files at once.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Retries a fetch for 429 (rate-limit) and 5xx (transient server errors) with
// exponential backoff. Returns the final Response even on exhaustion so the
// caller can surface the status; only throws on network-level errors. An
// external signal (user cancel) aborts the in-flight request via
// fetchWithTimeout AND short-circuits the retry/backoff loop — a cancelled
// run must not sit in a backoff sleep or fire further attempts.
async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 3, timeoutMs?: number, externalSignal?: AbortSignal): Promise<Response> {
  let delay = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (externalSignal?.aborted) throw new AIClientError("AI call cancelled.");
    const res = await fetchWithTimeout(url, init, timeoutMs, externalSignal);
    // Success, or a definitive client error (bad request / auth) — stop immediately.
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    } else {
      return res; // return the last failed response for the caller to inspect
    }
  }
  // Unreachable but satisfies TS
  throw new AIClientError("Unexpected retry loop exit");
}

// Fetches the exact list of model ids the given API key can access, so the
// Settings page can offer real choices and flag a typo'd/unavailable model
// before it fails mid-audit. Returns ids sorted, filtered to chat-capable
// families (gpt / o-series) to keep the list relevant.
export async function listModels(apiKey: string): Promise<string[]> {
  if (!apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
    30000
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIClientError(`Could not list models (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const ids: string[] = Array.isArray(data?.data)
    ? data.data.map((m: { id?: unknown }) => (typeof m.id === "string" ? m.id : "")).filter(Boolean)
    : [];
  return ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id)).sort();
}

export async function chatComplete(
  messages: AIChatMessage[],
  settings: AISettings,
  opts?: { temperature?: number; onUsage?: (u: AIUsage) => void; timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  if (!settings.enabled) throw new AIClientError("AI integration is disabled in Settings.");
  if (!settings.apiKey) throw new AIClientError("No OpenAI API key configured in Settings.");

  const model = settings.model || DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: withContext(messages, settings),
    response_format: { type: "json_object" },
  };
  const temp = opts?.temperature ?? 0.2;
  if (supportsTemperature(model)) body.temperature = temp;

  const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  }, 3, opts?.timeoutMs, opts?.signal);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIClientError(`OpenAI request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AIClientError("OpenAI response did not contain a message.");
  if (opts?.onUsage && data?.usage) {
    opts.onUsage({
      model: typeof data.model === "string" ? data.model : model,
      promptTokens: Number(data.usage.prompt_tokens) || 0,
      completionTokens: Number(data.usage.completion_tokens) || 0,
      totalTokens: Number(data.usage.total_tokens) || 0,
    });
  }
  return content;
}

// Separate from chatComplete because image evidence (scanned forms, photos
// of signed documents, etc.) needs a vision-capable multimodal request and a
// free-text reply, not the JSON-verdict shape every other caller here wants.
export async function describeImage(imageDataUrl: string, settings: AISettings, opts?: { onUsage?: (u: AIUsage) => void; signal?: AbortSignal }): Promise<string> {
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

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  }, REQUEST_TIMEOUT_MS, opts?.signal);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIClientError(`OpenAI request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AIClientError("OpenAI response did not contain a message.");
  if (opts?.onUsage && data?.usage) {
    opts.onUsage({
      model: typeof data.model === "string" ? data.model : model,
      promptTokens: Number(data.usage.prompt_tokens) || 0,
      completionTokens: Number(data.usage.completion_tokens) || 0,
      totalTokens: Number(data.usage.total_tokens) || 0,
    });
  }
  return content;
}

