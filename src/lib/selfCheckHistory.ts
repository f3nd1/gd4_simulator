// Previous self-check runs, so an auditor can reopen an earlier result and see
// what changed since.
//
// NO NEW STORE. The workspace store has kept per-sub-criterion run history
// since before this page existed: `ppdReviewHistory` and
// `evidenceAssessmentHistory`, both Record<string, Result[]>, newest first,
// both already capped at OPTION_A_RUN_HISTORY_CAP = 20 per sub-criterion
// (useWorkspaceStore.ts:182, :1496, :1886) and both already in `partialize`
// with their prompts capped. The self-check page simply never read them.
//
// So the retention rule is the one already in force, and this adds no storage
// at all beyond one number per run (durationMs). Nothing here writes.
import { runDuration } from "./selfCheckEvidence";
import type { EvidenceAssessmentResult, PPDReviewResult } from "../types";

export type SelfCheckRunRef = {
  // Index into the combined list: 0 is the current result, 1.. are history.
  index: number;
  current: boolean;
  runAt: string;
  label: string;
  // "2 minutes 14 seconds", or "" on a run from before durations were kept.
  duration: string;
  // The two passes are timed separately and a run is both of them, so the
  // headline figure is their sum and the parts are shown beside it.
  procedureDuration: string;
  recordsDuration: string;
  lines: number;
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-SG");
};

// One list per area, newest first, current first. The two passes are paired by
// POSITION rather than by timestamp: each is pushed to its own history array
// by the same run, so position 0 of each is the same run's two halves. Pairing
// by runAt would drift, because the two passes finish seconds apart.
export function selfCheckRuns(
  ev: EvidenceAssessmentResult | undefined,
  evHistory: EvidenceAssessmentResult[] | undefined,
  ppd: PPDReviewResult | undefined,
  ppdHistory: PPDReviewResult[] | undefined,
): SelfCheckRunRef[] {
  const evAll = [ev, ...(evHistory ?? [])].filter(Boolean) as EvidenceAssessmentResult[];
  const ppdAll = [ppd, ...(ppdHistory ?? [])].filter(Boolean) as PPDReviewResult[];
  // A procedure-only run has no evidence result at all, so the spine is
  // whichever list is longer rather than the evidence one.
  const count = Math.max(evAll.length, ppdAll.length);
  const out: SelfCheckRunRef[] = [];
  for (let i = 0; i < count; i++) {
    const e = evAll[i], p = ppdAll[i];
    const runAt = e?.runAt || p?.runAt || "";
    if (!runAt) continue;
    const total = (e?.durationMs ?? 0) + (p?.durationMs ?? 0);
    out.push({
      index: i,
      current: i === 0,
      runAt,
      label: fmt(runAt),
      duration: runDuration(total),
      procedureDuration: runDuration(p?.durationMs),
      recordsDuration: runDuration(e?.durationMs),
      lines: (e?.rows ?? p?.rows ?? []).length,
    });
  }
  return out;
}

// How this run compares with the one before it, in words, from the two figures
// the runs themselves recorded. No judgement: a slower run is not a worse one,
// it usually means the folder grew or a file stopped being served from cache.
export function runTimingNote(runs: SelfCheckRunRef[], index: number): string {
  const here = runs[index], prev = runs[index + 1];
  if (!here || !prev || !here.duration || !prev.duration) return "";
  if (here.duration === prev.duration) return `Same time as the run before it.`;
  return `The run before this one took ${prev.duration}.`;
}

// What changed between two runs, counted from the rows themselves. Only the
// verdicts each run actually recorded are compared; a line present in one run
// and absent from the other is reported as such rather than counted as a
// change, because the requirement set itself can differ between runs.
export type RunDiff = {
  improved: { ref: string; from: string; to: string }[];
  worsened: { ref: string; from: string; to: string }[];
  unchanged: number;
  onlyHere: string[];
  onlyThere: string[];
};

// Worse is a bigger number. "Not assessed" is deliberately OUTSIDE this scale:
// it is neither a pass nor a fail, so a move to or from it is not a direction.
const RANK: Record<string, number> = { Met: 0, Partial: 1, "Not met": 2 };

export function diffRuns(
  here: { gdRef: string; verdict: string }[] | undefined,
  there: { gdRef: string; verdict: string }[] | undefined,
): RunDiff {
  const a = new Map((here ?? []).map((r) => [r.gdRef, r.verdict]));
  const b = new Map((there ?? []).map((r) => [r.gdRef, r.verdict]));
  const d: RunDiff = { improved: [], worsened: [], unchanged: 0, onlyHere: [], onlyThere: [] };
  for (const [ref, to] of a) {
    if (!b.has(ref)) { d.onlyHere.push(ref); continue; }
    const from = b.get(ref)!;
    if (from === to) { d.unchanged++; continue; }
    const rf = RANK[from], rt = RANK[to];
    // One side off the pass/fail scale: a real change, but not a direction.
    if (rf === undefined || rt === undefined) { d.unchanged++; continue; }
    (rt < rf ? d.improved : d.worsened).push({ ref, from, to });
  }
  for (const ref of b.keys()) if (!a.has(ref)) d.onlyThere.push(ref);
  return d;
}

export function diffSummary(d: RunDiff): string {
  const bits: string[] = [];
  if (d.improved.length) bits.push(`${d.improved.length} improved`);
  if (d.worsened.length) bits.push(`${d.worsened.length} went backwards`);
  bits.push(`${d.unchanged} unchanged`);
  if (d.onlyHere.length) bits.push(`${d.onlyHere.length} only in this run`);
  if (d.onlyThere.length) bits.push(`${d.onlyThere.length} only in the earlier run`);
  return bits.join(" · ");
}
