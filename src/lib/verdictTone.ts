import type { PPDVerdict, EvidenceVerdict } from "../types";

// Verdict → display tone/color, shared by PPDReview.tsx's tables and
// LineageDiagram.tsx's per-line status pill — one mapping, reused everywhere
// a PPD/Evidence verdict needs a color, so the two surfaces can never
// disagree on what "Adequate"/"Met" etc. look like.

export function ppdVerdictTone(v: PPDVerdict): "good" | "medium" | "critical" | "neutral" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : v === "Not assessed" ? "neutral" : "critical";
}

// Display label for a verdict — the SINGLE source of truth for the word shown
// to a human, so the lineage matrix's column cell and every other surface
// (full per-line table Pills, run summaries, CSV/PDF export) can never show
// two different words for the same stored verdict value (e.g. the matrix
// saying "Documented" while a Pill elsewhere on the same row said the raw
// enum value "Adequate"). Never used for data binding/comparison — only for
// what's rendered; code that needs the actual verdict still compares against
// the real PPDVerdict/EvidenceVerdict string.
export function ppdVerdictLabel(v: PPDVerdict): string {
  return v === "Adequate" ? "Documented" : v === "Partial" ? "Partly" : v === "Not assessed" ? "Not checked" : "Not covered";
}

// "Partially met" (not "Partly") deliberately — ppdVerdictLabel's own Partial
// word IS "Partly", so a shared word here made "Combined verdict: Partly."
// read as if PPD vocabulary had leaked into the Combined half of a sentence,
// even when it hadn't (see the investigation this fixes). The two verdict
// axes must never render identically for their respective Partial states.
export function evVerdictLabel(v: EvidenceVerdict): string {
  return v === "Met" ? "Evidenced" : v === "Partial" ? "Partially met" : v === "Not assessed" ? "Not checked" : "No evidence";
}
