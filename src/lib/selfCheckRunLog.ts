// The long tail of the self-check run history.
//
// Two things are kept, deliberately at different costs:
//
//   FULL runs — the complete stored result, openable, capped at
//     OPTION_A_RUN_HISTORY_CAP (20 archived plus the current one). Measured on
//     realistic runs: 13 KB for a median area, 29 KB typical, 54 KB for the
//     biggest, 99 KB with a fifteen-promise line and 60 files, and both passes
//     together about 1.7x that. Five areas at the cap already reach 4.8-8.9 MB
//     against a roughly 5 MB localStorage budget, which is why that cap cannot
//     simply be raised to give a longer history.
//
//   SUMMARIES — this file. Date, duration and the four headline counts, so a
//     run stays on the timeline and comparable long after its full result has
//     aged out. Measured at 75 bytes serialised, 150 per run across both
//     passes.
//
// Why the cap is 120, from those measured bytes rather than a guess:
//   - 17.8 KB per area, 89 KB for a realistic five areas: 1.7% of the budget.
//   - Worst case, all 29 sub-criteria full: 517 KB, 10.1% of the budget. That
//     needs 3,480 checks to reach, and by then the FULL runs hold 30-55 MB.
//     So the summaries can never be what tips the quota over; the full runs
//     get there first by a factor of sixty.
//   - 120 covers ten years of monthly checks or 2.3 years of weekly ones,
//     which spans several four-year EduTrust cycles either way.
//   - 200 would buy another 6.7 years of monthly history for 344 KB more
//     worst-case headroom, and nobody needs sixteen years. 60 would save
//     258 KB but cap monthly history at five years, inside a plausible
//     retention requirement.
import { unjudgedBothSides } from "./unjudgedRows";

export const SELF_CHECK_RUN_LOG_CAP = 120;

// Short keys on purpose: at 120 per area per pass the field names are a real
// share of the bytes, and nothing reads this but the code below.
export type SelfCheckRunSummary = {
  // ISO timestamp, the same value the full result carries as runAt. This is
  // what pairs a summary with its full result when one still exists.
  at: string;
  // Milliseconds. Absent on a run from before durations were recorded.
  ms?: number;
  c: number; // complies
  p: number; // partly complies
  d: number; // does not comply
  u: number; // could not check
  n: number; // lines
};

// The same verdict axis the result page counts on, applied to whichever pass
// produced these rows. A procedure-only run is counted on its PPD verdicts,
// mapped exactly as toProcedureRows maps them.
export function summariseRun(
  runAt: string,
  durationMs: number | undefined,
  rows: { verdict: string; gdRef?: string; ppdVerdict?: string }[] | undefined,
  pass: "procedure" | "records",
): SelfCheckRunSummary {
  const verdicts = (rows ?? []).map((r) =>
    pass === "records"
      ? (unjudgedBothSides(r as never) ? "Not assessed" : r.verdict)
      : r.verdict === "Adequate" ? "Met" : r.verdict === "Partial" ? "Partial" : r.verdict === "Not documented" ? "Not met" : "Not assessed");
  const n = (v: string) => verdicts.filter((x) => x === v).length;
  return {
    at: runAt,
    ...(typeof durationMs === "number" ? { ms: durationMs } : {}),
    c: n("Met"), p: n("Partial"), d: n("Not met"), u: n("Not assessed"), n: verdicts.length,
  };
}

// Newest first, capped. Total over whatever is actually stored: a log written
// before this field existed is undefined, and a corrupt one is not an array.
export function appendRunSummary(
  log: SelfCheckRunSummary[] | undefined,
  entry: SelfCheckRunSummary,
): SelfCheckRunSummary[] {
  const prev = Array.isArray(log) ? log : [];
  return [entry, ...prev].slice(0, SELF_CHECK_RUN_LOG_CAP);
}
