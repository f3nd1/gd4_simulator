import { chatComplete, type AIUsage } from "./aiClient";
import { buildSystemPrompt } from "./skills";
import { buildAiSuggestionUserPrompt, filterDimensionNarratives, type ItemReport } from "../finalReport";
import type { AISettings } from "../../types";

// The auditor-narrative generator, extracted from FinalReport.tsx so BOTH the
// run flow (Hybrid draft / Full Auto, via useWorkspaceStore.writeReportNarratives)
// and the report's "Regenerate report text" button drive the SAME call — one
// prompt, one honesty filter, no drift between auto and manual generation.
// The caller supplies ready settings and owns persistence + AI Review Log
// logging; this function only makes the call and filters the reply.

export type NarrativeInput = Pick<ItemReport, "id" | "title" | "band" | "findingsGroups">;

export type NarrativeWriterResult = {
  narratives: ReturnType<typeof filterDimensionNarratives>;
  content: string;
  promptSent: string;
  usage?: AIUsage;
  model?: string;
};

export async function runNarrativeWriter(input: NarrativeInput, settings: AISettings): Promise<NarrativeWriterResult> {
  // The auditor-narrative voice + six-part structure live in the shared
  // narrativeWriter skill (auditor-narrative-voice.md), injected below. The
  // inline text keeps the JSON envelope, the field-to-part mapping, and the
  // CONCISION limits (the standard forbids oversized paragraphs; the numbers
  // here make that enforceable). The model must never emit its own field
  // labels or markdown — the report supplies the labels, and leaked "**"
  // markup was a real table-breaking bug (2026-07-18).
  const sys =
    "You are an experienced EduTrust auditor writing the narrative assessment for a GD4 internal audit readiness report for a Singapore PEI. Follow the auditor-narrative voice and structure in the guidance below, reasoning ONLY from the assessed findings listed for that dimension and the quoted verbatim next-band rubric target — never invent a document, figure, approver, number or fact not present in the source text; if the evidence is too thin to name specifics, say so plainly rather than inventing them. Use UK spelling, no em dashes. " +
    // Item 5 (2026-07-18): do not overclaim. A positive claim must not exceed
    // what the sighted evidence directly supports.
    "DO NOT draw a positive conclusion stronger than the sighted evidence supports. Distinguish clearly between what is newly introduced or partial and what is established or systematic: do not call a process \"systematic\", \"embedded\", \"established\" or \"routinely monitored\" unless the evidence shows it operating repeatedly over time — a single closure record, a newly-introduced control, or one completed initiative is \"newly introduced\" or \"partial\", not \"systematic\". " +
    "Follow this order in each section and add nothing beyond it: evidence sighted, then what it demonstrates, then the remaining gap, then the band implication. " +
    "Map that onto these JSON fields for EACH dimension in the user message: " +
    "\"strength\" — the sampled evidence present and what it demonstrates, claimed no more strongly than the evidence supports (omit if the dimension has no strength rows); " +
    "\"weakness\" — what is present, then \"However,\" and a concrete itemisation of what is absent, then the band implication (omit if the dimension has no weakness rows); " +
    "\"bandLine\" — one neutral sentence stating the current band and percentage, required for every dimension given; " +
    // Item 6 (2026-07-18): requiredAction is the grounded next-band suggestion
    // for BOTH strengths and weaknesses — a real, evidence-based statement of
    // what further evidence would move the dimension up a band, not the bare
    // rubric quote. Only omitted at Band 5 (nothing higher).
    "\"requiredAction\" — a specific, evidence-grounded statement of what further evidence or records would be needed to reach the next band up, phrased as a professional recommendation (not a command) and grounded in what was actually found, not the generic rubric wording. Provide it for EVERY dimension below Band 5, whether its rows are strengths or weaknesses; omit it only when the dimension is already at Band 5. " +
    "BE CONCISE — never an oversized paragraph: strength and weakness are each AT MOST three sentences (roughly 400 characters); requiredAction at most two sentences; remove repetition, internal chunk references and long explanations; condense repetitive evidence into one representative example. " +
    "Each field's value is PLAIN prose only: no markdown, no asterisks, and no leading label such as \"Weakness:\" or \"Band Assessment:\" — the report adds its own labels. " +
    "Respond with JSON only: {\"narratives\": {\"approach\"?: {\"strength\"?: string, \"weakness\"?: string, \"bandLine\": string, \"requiredAction\"?: string}, \"processes\"?: {...}, \"systemsOutcomes\"?: {...}, \"review\"?: {...}}} — include only the dimensions given, using the same shape for each." +
    buildSystemPrompt("narrativeWriter", null, "narrativeWriter.runNarrativeWriter");
  const user = buildAiSuggestionUserPrompt(input);
  let model: string | undefined;
  let usage: AIUsage | undefined;
  const content = await chatComplete([{ role: "system", content: sys }, { role: "user", content: user }], settings, { onUsage: (u) => { model = u.model; usage = u; } });
  let raw: unknown;
  try {
    raw = (JSON.parse(content) as { narratives?: unknown }).narratives;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) { try { raw = (JSON.parse(match[0]) as { narratives?: unknown }).narratives; } catch { /* no usable JSON */ } }
  }
  return {
    narratives: filterDimensionNarratives(raw, input.findingsGroups),
    content,
    promptSent: `SYSTEM:\n${sys}\n\nUSER:\n${user}`,
    usage,
    model,
  };
}
