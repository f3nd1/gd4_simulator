// The results-and-review folder: whether the Outcomes & Review pass is allowed
// to run over it, and what the self-check says about the two dimensions when it
// is not.
//
// WHY THIS IS A GATE AND NOT A TRY-IT-AND-SEE. buildStagedApsr maps "the pass
// found nothing" to status "Not evident" (agentRuntime.ts:2259-2271), and the
// type unions carry no "not assessed" value at all — "Not evident" is the
// bottom of the scale and reads as Band 1 everywhere downstream. So a pass run
// over a folder whose files could not be read converts "I did not look" into
// "you have nothing", on every one of this scope's requirement lines at once.
// That error has been removed from this page three times in three forms.
//
// The rule is therefore: the pass runs ONLY when at least one file in that
// folder had its text actually read. A folder that lists files and fails to
// read every one of them is the dangerous case, because it looks like a
// working folder from the outside — it is gated exactly like an empty one.
//
// Pure and store-free so it is unit-testable (importing the stores pulls in
// pdfjs, which has no Worker under Vitest).

export type OutcomeFolderRead = {
  // Files the Drive listing returned for the folder.
  listed: number;
  // Files whose text was actually extracted (any tier: typed text, or vision
  // on a scan or image). Not "attempted", not "found" — read.
  read: number;
  // Names of files that were listed but produced no text, so the reason can
  // name them rather than asserting a silent absence.
  failed?: string[];
};

export type OutcomePassGate =
  | { run: true }
  | { run: false; reason: string };

// The reason strings are user-facing and are stored on the run
// (OutcomeReviewPassResult.skippedReason), so the page can still name the
// reason after a reload.
export function outcomePassGate(folderId: string | null | undefined, read: OutcomeFolderRead): OutcomePassGate {
  if (!folderId) return { run: false, reason: NOT_LINKED_REASON };
  if (read.listed <= 0) {
    return { run: false, reason: "The results and review folder is linked but has no files in it, so there was nothing to check. Both areas are left unassessed rather than marked down." };
  }
  if (read.read <= 0) {
    const names = (read.failed ?? []).slice(0, 3).join(", ");
    return {
      run: false,
      reason: `The results and review folder has ${read.listed} file${read.listed === 1 ? "" : "s"} in it, but none of ${read.listed === 1 ? "it" : "them"} could be read${names ? ` (${names}${(read.failed ?? []).length > 3 ? ", and others" : ""})` : ""}. Nothing was checked, so both areas are left unassessed rather than marked down. Check the files open for you in Drive and are not empty or password protected.`,
    };
  }
  return { run: true };
}

export const NOT_LINKED_REASON =
  "No results and review folder was linked, so these two areas were not looked at. That is not a judgement on your area.";

// What the self-check says about Systems & Outcomes and Review after a run.
// "assessed" is the ONLY state in which a negative finding from the pass may be
// shown as a finding about the area rather than about the check.
export type OutcomeDimensionState = "not-linked" | "not-read" | "assessed";

export function outcomeDimensionState(
  result: { rows?: unknown[]; skippedReason?: string; outcomeFilesRead?: number } | undefined,
): { state: OutcomeDimensionState; reason: string } {
  if (!result) return { state: "not-linked", reason: NOT_LINKED_REASON };
  if (result.skippedReason) return { state: "not-read", reason: result.skippedReason };
  // A stored result with no rows asserts nothing about any requirement line;
  // treated as not read rather than as a clean pass over an empty folder.
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
