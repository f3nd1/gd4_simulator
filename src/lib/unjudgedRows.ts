// One definition of "neither pass judged this line", shared by the engine-side
// migration and the self-check display layer so they can never drift apart.
//
// The engine's zero-evidence branch (agentRuntime.ts) used to decide such a
// line deterministically from the PPD verdict, and its `else` lumped PPD
// "Partial" (a real judgement, conservatively capped) together with PPD "Not
// assessed" (the ABSENCE of a judgement). With the records side also empty
// that produced a stored "Partial" for a line nothing had judged, and a stored
// Partial is not display-only: it writes a Weak checklist line
// (optionAChecklistWrite.ts), raises a Partial finding (compileEvidenceFindings)
// and feeds computeChecklistOverrides. The engine now returns "Not assessed"
// for that case; this module fixes the runs already stored.
import type { EvidenceAssessmentResult, EvidenceAssessmentRow } from "../types";

export function unjudgedBothSides(r: Pick<EvidenceAssessmentRow, "verdict" | "ppdVerdict" | "evidenceChunkIds">): boolean {
  return r.verdict === "Partial" && r.ppdVerdict === "Not assessed" && (r.evidenceChunkIds?.length ?? 0) === 0;
}

export const UNJUDGED_MIGRATION_NOTE =
  "Corrected on load: this line was stored as Partial although neither pass judged it (the procedure pass returned no verdict and no evidence passage was cited). It is now recorded as Not assessed.";

// Rewrites only rows that match, and only the fields that have to change. The
// row keeps its savedFindingId: a finding already raised from it stays in the
// register, visible, for a human to withdraw — deleting findings automatically
// is exactly the kind of silent write this app does not do.
export function demoteUnjudgedRows<T extends EvidenceAssessmentResult>(result: T): T {
  if (!result?.rows?.some(unjudgedBothSides)) return result;
  return {
    ...result,
    rows: result.rows.map((r) =>
      unjudgedBothSides(r)
        ? { ...r, verdict: "Not assessed" as const, comment: `${r.comment ? `${r.comment}\n\n` : ""}${UNJUDGED_MIGRATION_NOTE}` }
        : r
    ),
  };
}

export function demoteUnjudgedMap<T extends EvidenceAssessmentResult>(map: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!map) return map;
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, demoteUnjudgedRows(v)]));
}

export function demoteUnjudgedHistory<T extends EvidenceAssessmentResult>(map: Record<string, T[]> | undefined): Record<string, T[]> | undefined {
  if (!map) return map;
  return Object.fromEntries(Object.entries(map).map(([k, arr]) => [k, arr.map(demoteUnjudgedRows)]));
}
