// Whether the Outcomes & Review pass is allowed to judge anything, and what the
// self-check says about its two dimensions when it is not.
//
// WHY THIS IS A GATE AND NOT A TRY-IT-AND-SEE. buildStagedApsr maps "the pass
// found nothing" to status "Not evident" (agentRuntime.ts:2259-2271), and the
// ApsrBreakdown unions carry no "not assessed" value at all — "Not evident" is
// the bottom of the scale and reads as Band 1 everywhere downstream. So a pass
// run over documents it could not read converts "I did not look" into "you have
// nothing", on every one of this scope's requirement lines at once. That error
// has been removed from this page three times in three forms.
//
// The pass reads the SAME documents the check has already opened, so the
// condition is about those: at least one file from the RECORDS side must have
// had its text obtained for this pass. Records specifically, not "any document"
// — outcome data and review records are records. A run that read the written
// procedure and none of the records would otherwise report "no outcome data,
// no review records" when what actually happened is that nothing was opened.
//
// A folder that lists files and then fails to read every one of them is the
// dangerous case, because it looks like a working folder from the outside. It
// is gated exactly like an empty one.
//
// Pure and store-free so it is unit-testable (importing the stores pulls in
// pdfjs, which has no Worker under Vitest).

export type PassDocumentRead = {
  // Records-side files the run's own ledger carried into this pass.
  listed: number;
  // Of those, the ones whose text was actually obtained (session cache hit, or
  // a fresh read). Not "attempted", not "found" — read.
  read: number;
  // Names of the ones that produced no text, so the reason can name them rather
  // than asserting a silent absence.
  failed?: string[];
};

export type OutcomePassGate =
  | { run: true }
  | { run: false; reason: string };

// The reason strings are user-facing and are stored on the run
// (OutcomeReviewPassResult.skippedReason), so the page can still name the
// reason after a reload.
export function outcomePassGate(read: PassDocumentRead): OutcomePassGate {
  if (read.listed <= 0) {
    return { run: false, reason: "This check opened no records for your area, so there was nothing to look at for these two areas. They are left unassessed rather than marked down." };
  }
  if (read.read <= 0) {
    const names = (read.failed ?? []).slice(0, 3).join(", ");
    const more = (read.failed ?? []).length > 3 ? ", and others" : "";
    return {
      run: false,
      reason: `Your records folder has ${read.listed} file${read.listed === 1 ? "" : "s"} in it, but none of ${read.listed === 1 ? "it" : "them"} could be read${names ? ` (${names}${more})` : ""}. Nothing was checked, so both areas are left unassessed rather than marked down. Check the files open for you in Drive and are not empty or password protected.`,
    };
  }
  return { run: true };
}

export const NOT_RUN_REASON =
  "These two areas were not looked at on this run. That is not a judgement on your area.";

// What the self-check says about Systems & Outcomes and Review after a run.
// "assessed" is the ONLY state in which a negative finding from the pass may be
// shown as a finding about the area rather than about the check.
export type OutcomeDimensionState = "not-run" | "not-read" | "assessed";

export function outcomeDimensionState(
  result: { rows?: unknown[]; skippedReason?: string } | undefined,
): { state: OutcomeDimensionState; reason: string } {
  if (!result) return { state: "not-run", reason: NOT_RUN_REASON };
  if (result.skippedReason) return { state: "not-read", reason: result.skippedReason };
  // A stored result with no rows asserts nothing about any requirement line;
  // treated as not read rather than as a clean pass over nothing.
  if (!result.rows || result.rows.length === 0) {
    return { state: "not-read", reason: "The results and review check did not produce a verdict on any requirement line, so both areas are left unassessed." };
  }
  return { state: "assessed", reason: "" };
}

// The pass's own counts. Reported as counts, never as a band: turning them into
// a dimension score is the decision this page deliberately does not take.
export function outcomePassTally(rows: { outcomeEvident?: boolean; reviewEvident?: boolean }[] | undefined): {
  total: number; withOutcome: number; withReview: number;
} {
  const r = rows ?? [];
  return {
    total: r.length,
    withOutcome: r.filter((x) => x.outcomeEvident === true).length,
    withReview: r.filter((x) => x.reviewEvident === true).length,
  };
}
