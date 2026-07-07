// AI Calibration → Benchmark tab's "upload a report" flow: reads the plain
// text already extracted from an uploaded audit report (see
// uploadedDocText.ts) and asks the model to pull out each distinct finding
// as a draft BenchmarkAFI-shaped record, for a human to review/edit before
// any of it is added to the ground-truth set (useBenchmarkAfiStore).
// Deliberately has NO offline/simulated fallback — genuine document
// understanding isn't something a rule-based keyword matcher can do
// credibly, unlike the rest of the app's audit steps. Callers must gate on
// live AI being enabled themselves (same aiSettings.enabled/apiKey check
// AICalibration.tsx's runMatchAnalysis already uses) and show a clear error
// otherwise — never silently return nothing.

import { chatComplete, type AIUsage } from "./aiClient";
import { GD4_SUB_CRITERIA } from "../../data/gd4Requirements";
import type { AISettings } from "../../types";
import type { BenchmarkAFI, BenchmarkFindingPattern } from "../../data/benchmarkAFIs";

// Same cap FOLDER_DOC_CAP uses in agentRuntime.ts — this is a similarly
// whole-document ingest, not a short context injection.
const EXTRACTION_DOC_CAP = 60_000;

const PATTERNS: BenchmarkFindingPattern[] = [
  "not documented in PPD",
  "not implemented per PPD",
  "internal contradiction",
  "cross-document mismatch",
  "no timeline/monitoring",
  "other",
];

// `year` is deliberately excluded — the AI has no reliable way to know a
// report's actual year from its body text alone, so it's supplied once by
// the human for the whole uploaded batch (alongside `source`) when
// confirming the review, not guessed per-finding.
export type ExtractedAFIDraft = Omit<BenchmarkAFI, "id" | "source" | "year"> & { confidence?: "high" | "medium" | "low" };

function capDocText(text: string): { capped: string; truncatedNote: string } {
  if (text.length <= EXTRACTION_DOC_CAP) return { capped: text, truncatedNote: "" };
  const truncatedNote = `\n\n[Document text (${text.length.toLocaleString()} chars) exceeds the ${EXTRACTION_DOC_CAP.toLocaleString()}-char limit for this call; the last ${(text.length - EXTRACTION_DOC_CAP).toLocaleString()} chars were not sent.]`;
  return { capped: text.slice(0, EXTRACTION_DOC_CAP), truncatedNote };
}

function isValidPattern(p: unknown): p is BenchmarkFindingPattern {
  return typeof p === "string" && (PATTERNS as string[]).includes(p);
}

export async function extractBenchmarkFindings(
  documentText: string,
  settings: AISettings,
  opts?: { signal?: AbortSignal; onUsage?: (u: AIUsage) => void }
): Promise<ExtractedAFIDraft[]> {
  const { capped, truncatedNote } = capDocText(documentText);
  const validSubCriteria = new Set(GD4_SUB_CRITERIA.map((s) => s.id));
  const subCriteriaList = GD4_SUB_CRITERIA.map((s) => `${s.id} ${s.title}`).join("; ");

  const system = `You are extracting individual audit findings from a real audit report so they can be used as ground-truth data to measure an AI audit tool's accuracy. Read the document text and identify EVERY distinct finding, observation, area-for-improvement, or strength it raises — one entry per finding, never merged.

For each finding, quote its text VERBATIM from the document — never paraphrase, summarise, or invent wording. If a finding spans multiple sentences, quote the whole relevant passage.

Assign each finding's "subCriterion" to EXACTLY one of these valid GD4 sub-criterion ids (format "id title"): ${subCriteriaList}. If you cannot confidently match a finding to one of these ids, omit "subCriterion" entirely (leave it null) rather than guessing — never invent an id not in this list.

"kind" is one of: "AFI" (a gap/nonconformity/area-for-improvement), "higher-band" (an opportunity to reach a higher band, not a compliance gap), "strength" (a positive observation, not a gap).
"findingPattern" is one of: ${PATTERNS.join(", ")} — pick "other" if none clearly fit.
"hasNamedExample" is true only if the finding cites a concrete document name, date, record, or role.
"confidence" is your own confidence ("high"|"medium"|"low") that this finding was extracted and categorised correctly.

Respond with JSON only: {"findings": [{"subCriterion": string|null, "gd4Ref": string|null, "kind": "AFI"|"higher-band"|"strength", "findingText": string, "findingPattern": string, "hasNamedExample": boolean, "confidence": "high"|"medium"|"low"}]}`;

  const user = `Document text:\n${capped}${truncatedNote}`;

  const content = await chatComplete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    settings,
    { temperature: 0.1, signal: opts?.signal, onUsage: opts?.onUsage }
  );

  let parsed: unknown;
  try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { parsed = null; }
  const raw = parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)
    ? (parsed as { findings: Array<Record<string, unknown>> }).findings
    : [];

  const drafts: ExtractedAFIDraft[] = [];
  for (const f of raw) {
    const findingText = typeof f.findingText === "string" ? f.findingText.trim() : "";
    if (!findingText) continue; // never accept a finding with no quoted text
    const subCriterionRaw = typeof f.subCriterion === "string" ? f.subCriterion : "";
    // Validate against the real set rather than trusting the model — an
    // unrecognised id is surfaced as blank for manual assignment in the
    // review UI, never silently accepted, mirroring runMatchAnalysis's own
    // id-validation before it applies a parsed result.
    const subCriterion = validSubCriteria.has(subCriterionRaw) ? subCriterionRaw : "";
    const kind = f.kind === "AFI" || f.kind === "higher-band" || f.kind === "strength" ? f.kind : "AFI";
    const findingPattern = isValidPattern(f.findingPattern) ? f.findingPattern : "other";
    drafts.push({
      subCriterion,
      gd4Ref: typeof f.gd4Ref === "string" && f.gd4Ref ? f.gd4Ref : undefined,
      kind,
      findingText,
      findingPattern,
      hasNamedExample: f.hasNamedExample === true,
      confidence: f.confidence === "high" || f.confidence === "medium" || f.confidence === "low" ? f.confidence : undefined,
    });
  }
  return drafts;
}
