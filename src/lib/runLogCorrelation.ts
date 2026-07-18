import type { AIReviewLogEntry, RunLogEntry } from "../types";

// The AI Review Log entries that belong to one automated run. No shared runId
// is threaded through the (Full-Auto-shared) leaf functions — instead we
// correlate by the run's OWN recorded window + sub-criterion, which is exact
// because startedAt/endedAt already bound every step's AI call. A band
// suggestion logs under the ITEM id (e.g. "6.2.1"), the other steps under the
// sub-criterion (e.g. "6.2"), so match the sub itself AND any item beneath it
// (prefix + "."). ISO timestamps compare lexicographically = chronologically.
export function aiCallsForRun(log: AIReviewLogEntry[], entry: RunLogEntry): AIReviewLogEntry[] {
  const subs = entry.subCriterionIds;
  const belongs = (subjectId: string) => subs.some((s) => subjectId === s || subjectId.startsWith(s + "."));
  return log
    .filter((e) => belongs(e.subjectId) && e.createdAt >= entry.startedAt && e.createdAt <= entry.endedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
