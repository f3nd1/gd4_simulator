// "Assessed via N of M sliding windows" for an Option A pass.
//
// Option B's staged passes have stated their window coverage since they were
// built (agentRuntime's buildStagedRow caller). Option A returned the same two
// numbers and the store never read them, so an Option A run that covered part
// of a folder looked exactly like one that covered all of it. This is the
// missing sentence, shared by both Option A passes so their wording cannot
// drift apart.
//
// Says nothing when the pass covered everything AND nothing is outstanding:
// a clean run does not need a paragraph explaining that it was clean.
export function windowCoverageNote(args: {
  label: string;            // "Policy" | "Evidence"
  windowsProcessed: number;
  windowsTotal: number;
  docChars: number;
  notAssessedLines: number;
  totalLines: number;
  stoppedEarly?: boolean;
}): string | undefined {
  const { label, windowsProcessed, windowsTotal, docChars, notAssessedLines, totalLines, stoppedEarly } = args;
  if (windowsTotal === 0) return undefined;
  const complete = windowsProcessed >= windowsTotal && notAssessedLines === 0 && !stoppedEarly;
  if (complete) return undefined;
  const parts = [
    `${label} documents were searched through ${windowsProcessed} of ${windowsTotal} sliding window${windowsTotal === 1 ? "" : "s"} (${docChars.toLocaleString()} characters of extracted text).`,
  ];
  if (windowsProcessed < windowsTotal) {
    parts.push(`${windowsTotal - windowsProcessed} window${windowsTotal - windowsProcessed === 1 ? " was" : "s were"} not searched${stoppedEarly ? " because the run was stopped" : ""}, so part of the text was never looked at.`);
  }
  if (notAssessedLines > 0) {
    parts.push(`${notAssessedLines} of ${totalLines} requirement line${totalLines === 1 ? "" : "s"} ended Not assessed — these are missing judgements, not gaps.`);
  }
  return parts.join(" ");
}
