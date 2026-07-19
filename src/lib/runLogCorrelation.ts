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

// Rough "how long will this take" figure for the Full-Auto / Hybrid drafting
// modal, derived ONLY from real history: the whole-run wall clock
// (endedAt - startedAt) of past COMPLETE runs of the SAME mode. Cancelled runs
// are excluded (their duration is truncated and would bias the figure low).
// The Run Log records no per-step timing and no file count, so a per-step ETA
// or a files-scaled estimate would be fabricated — this is deliberately the
// whole-run typical only. Returns the MEDIAN (robust to a single stuck run,
// which a mean is not) and the sample size, or null when there is no matching
// history to be honest about (first run of this type).
export function typicalRunDurationSec(
  runLog: RunLogEntry[],
  mode: RunLogEntry["mode"]
): { medianSec: number; sampleCount: number } | null {
  const durations = runLog
    .filter((e) => e.mode === mode && e.status === "complete")
    .map((e) => (Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 1000)
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  const medianSec = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  return { medianSec: Math.round(medianSec), sampleCount: durations.length };
}

// "about 45s" / "about 4m" / "about 1h 5m" — a rough spoken duration, never a
// precise countdown (the modal must not imply precision the app lacks).
export function formatRoughDuration(sec: number): string {
  if (sec < 90) return `about ${Math.max(1, Math.round(sec))}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `about ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `about ${h}h ${m}m` : `about ${h}h`;
}
