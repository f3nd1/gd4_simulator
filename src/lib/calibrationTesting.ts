// Pure calculations for the AI Calibration page's Consistency and A-vs-B
// measurement tabs. NO imports from driveClient or the stores — this file is
// unit-tested under Vitest (pdfjs constraint) and holds every score/verdict
// rule so the numbers shown on the page are pinned by tests.
//
// These are MEASUREMENT tools: nothing here (or in calibrationRunner.ts,
// the impure counterpart) writes to the checklist, findings register,
// ppdReviewResults or evidenceAssessments — scratch runs are stored only in
// useCalibrationStore.

import { coverageCap } from "./checklistBanding";

// Single "Run on 04 Jul 2026, 14:30" formatter, used identically on both
// tabs' result blocks and re-used (as ISO) in the CSV exports, so timestamps
// read the same everywhere.
export function formatRunOn(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Line status shared by both paths after normalisation (Option A's PPD
// verdicts are mapped onto it; Option B's staged APSR already derives it).
export type ScratchStatus = "Met" | "Partial" | "Not met";

// Option A PPD verdicts → the shared status scale, so A and B runs are
// comparable line-for-line. (Used when A runs PPD-only — with an evidence
// stage the evidence verdict IS already Met/Partial/Not met.)
// "Not assessed" returns NULL — that line's AI call failed or never ran, so
// it carries NO verdict. It used to map to "Not met", silently folding
// call failures into the measurement as if they were real gaps.
export function ppdVerdictToStatus(verdict: string): ScratchStatus | null {
  if (verdict === "Adequate") return "Met";
  if (verdict === "Partially documented" || verdict === "Partial") return "Partial";
  if (verdict === "Not assessed") return null;
  return "Not met";
}

// Gap = a line that would raise a finding (NC or OFI under the app's
// status→type rule: Not met→NC, Partial→OFI, Met→OBS-only).
// Null statuses (line not assessed — its AI call failed) are excluded from
// every count: an unassessed line is missing data, never a gap.
export function countGaps(statuses: (ScratchStatus | null)[]): number {
  return statuses.filter((s) => s != null && s !== "Met").length;
}

export function countByType(statuses: (ScratchStatus | null)[]): { NC: number; OFI: number; OBS: number } {
  return {
    NC: statuses.filter((s) => s === "Not met").length,
    OFI: statuses.filter((s) => s === "Partial").length,
    OBS: statuses.filter((s) => s === "Met").length,
  };
}

// Coverage-cap band ESTIMATE from line statuses alone, reusing the real
// coverageCap thresholds (checklistBanding). Deliberately labelled an
// estimate everywhere it is shown: the full computeBand also weighs evidence
// attachments and maturity lenses, which a scratch run has no data for.
export function bandEstimate(statuses: (ScratchStatus | null)[]): number | null {
  const assessed = statuses.filter((s): s is ScratchStatus => s != null);
  if (assessed.length === 0) return null;
  const met = assessed.filter((s) => s === "Met").length;
  const partial = assessed.filter((s) => s === "Partial").length;
  const pct = ((met + partial * 0.5) / assessed.length) * 100;
  return coverageCap(pct);
}

// ── Consistency (repeatability of one path) ─────────────────────────────

// The underlying result behind ONE verdict: the reasoning/comment the engine
// produced and the evidence it cited. Lets the user drill in to see WHY a
// verdict was reached (and why two runs disagreed), not just the label.
export type LineDetail = { note: string; evidence: string[] };

// One requirement line across N repeat runs. verdicts[i] is run i's verdict
// for this line, or null when that run failed / did not assess the line —
// failures are carried honestly, never fabricated into a verdict. details[i]
// is the reasoning/evidence behind verdicts[i] (null when that run had no
// result for this line). Kept parallel to `verdicts` so the scoring math
// (which reads only `verdicts`) is unaffected.
export type ConsistencyLine = { ref: string; text: string; verdicts: (string | null)[]; details?: (LineDetail | null)[] };

export type ConsistencyTestResult = {
  subCriterionId: string;
  path: "A" | "B";
  runs: number;
  runAt: string; // ISO
  // Verdict temperature DIAL VALUE at test time. Kept for legacy records —
  // on gpt-5/o-series models the dial was silently ignored, so this number
  // was never actually in effect for those runs. New records also carry
  // effectiveTemperature (below), which is the honest value.
  temperature?: number;
  // Temperature ACTUALLY in effect: the dial value when the model honours a
  // temperature parameter, null when it doesn't (gpt-5/o-series decide their
  // own sampling). undefined = legacy record from before this field existed
  // — its `temperature` was recorded under the old, incorrect assumption.
  effectiveTemperature?: number | null;
  // True when this run used production-identical prompt assembly (same
  // memories/calibration/rules/file-type skills a real run sends — see
  // labParity.ts). undefined = legacy pre-parity record measured against a
  // DIFFERENT pipeline than production; not comparable with new results.
  pipelineParity?: boolean;
  lines: ConsistencyLine[];
  bands: (number | null)[]; // band estimate per run (null = run failed)
  gapCounts: (number | null)[]; // findings(gaps) count per run
  failedRuns: number[]; // 1-based run indices that errored entirely
  // Run number → the REAL error that failed it (Drive token expiry, listing
  // error, …), so a failed run is diagnosable and actionable instead of a
  // bare ✗. undefined on records from before this field (their reasons were
  // discarded at capture time — unrecoverable).
  failedRunErrors?: Record<number, string>;
  agreementPct: number | null;
  summary: string;
};

// % of scorable lines where every completed run gave the SAME verdict.
// A line is scorable when at least two runs produced a verdict for it; a
// failed run contributes nulls, shrinking scorability rather than agreement.
export function consistencyAgreement(lines: ConsistencyLine[]): { agreementPct: number | null; agreedLines: number; scorableLines: number } {
  let scorable = 0;
  let agreed = 0;
  for (const line of lines) {
    const vs = line.verdicts.filter((v): v is string => v != null);
    if (vs.length < 2) continue;
    scorable++;
    if (vs.every((v) => v === vs[0])) agreed++;
  }
  return { agreementPct: scorable === 0 ? null : Math.round((agreed / scorable) * 100), agreedLines: agreed, scorableLines: scorable };
}

// Splice ONE retried run's output back into a saved consistency result —
// so a transient failure (Drive token expiry, rate-limit burst) doesn't
// force paying for all N runs again. Pure so the column-splice arithmetic
// is unit-tested. Replaces run `runNumber`'s column everywhere (per-line
// verdicts/details, band, gap count, failed-run bookkeeping) and recomputes
// the agreement + summary. A retry that itself fails updates the stored
// error instead — the run stays honestly marked failed, never blank.
// NOTE: the retry runs under the CURRENT settings; record-level fields
// (temperature/effectiveTemperature/pipelineParity/runAt) describe the
// original test and are left untouched.
export type RetryRunOutput = {
  ok: boolean;
  error?: string;
  lines: { ref: string; text: string; status: ScratchStatus | null; note: string; evidence: string[] }[];
  gapCount: number;
  bandEstimate: number | null;
};

export function spliceRetryIntoConsistencyResult(result: ConsistencyTestResult, runNumber: number, out: RetryRunOutput): ConsistencyTestResult {
  const i = runNumber - 1;
  if (i < 0 || i >= result.runs) return result;
  const blankDetails = () => Array.from({ length: result.runs }, () => null as LineDetail | null);

  // Replace run i's column on every existing line.
  const lines: ConsistencyLine[] = result.lines.map((l) => {
    const nl = out.ok ? out.lines.find((x) => x.ref === l.ref) : undefined;
    const verdicts = [...l.verdicts];
    verdicts[i] = nl ? nl.status : null;
    const details = l.details ? [...l.details] : blankDetails();
    details[i] = nl ? { note: nl.note, evidence: nl.evidence } : null;
    return { ...l, verdicts, details };
  });
  // Lines the retried run assessed that the original runs never saw.
  if (out.ok) {
    const seen = new Set(lines.map((l) => l.ref));
    for (const nl of out.lines) {
      if (seen.has(nl.ref)) continue;
      const verdicts = Array.from({ length: result.runs }, () => null as string | null);
      verdicts[i] = nl.status;
      const details = blankDetails();
      details[i] = { note: nl.note, evidence: nl.evidence };
      lines.push({ ref: nl.ref, text: nl.text, verdicts, details });
    }
  }

  const bands = [...result.bands];
  bands[i] = out.ok ? out.bandEstimate : null;
  const gapCounts = [...result.gapCounts];
  gapCounts[i] = out.ok ? out.gapCount : null;
  const failedRuns = out.ok
    ? result.failedRuns.filter((n) => n !== runNumber)
    : [...new Set([...result.failedRuns, runNumber])].sort((a, b) => a - b);
  const failedRunErrors = { ...(result.failedRunErrors ?? {}) };
  if (out.ok) delete failedRunErrors[runNumber];
  else failedRunErrors[runNumber] = out.error || "Run failed with no error message.";

  const { agreementPct } = consistencyAgreement(lines);
  return {
    ...result,
    lines, bands, gapCounts, failedRuns,
    failedRunErrors: Object.keys(failedRunErrors).length > 0 ? failedRunErrors : undefined,
    agreementPct,
    summary: consistencySummary(agreementPct, bands, gapCounts, failedRuns, result.runs),
  };
}

const seq = (xs: (number | null)[]) => xs.map((x) => (x == null ? "✗" : String(x))).join(", ");

export function bandStabilityLabel(bands: (number | null)[]): string {
  const real = bands.filter((b): b is number => b != null);
  if (real.length === 0) return "no bands (all runs failed)";
  const stable = real.every((b) => b === real[0]);
  return stable ? `band stable (${seq(bands)})` : `band varied (${seq(bands)})`;
}

export function gapVariationLabel(counts: (number | null)[]): string {
  const real = counts.filter((c): c is number => c != null);
  if (real.length === 0) return "no findings counts (all runs failed)";
  const spread = Math.max(...real) - Math.min(...real);
  return spread === 0 ? `findings stable (${seq(counts)})` : `findings varied by ${spread} (${seq(counts)})`;
}

export function consistencySummary(agreementPct: number | null, bands: (number | null)[], gapCounts: (number | null)[], failedRuns: number[], runs: number): string {
  const parts: string[] = [];
  // Say how many runs the number actually rests on — "71% across 5 runs"
  // when 3 of the 5 failed misrepresents 2 completed runs as 5.
  const completed = runs - failedRuns.length;
  parts.push(agreementPct == null ? "No scorable lines (too many failed runs)" : `${agreementPct}% verdict agreement across ${completed} completed run${completed === 1 ? "" : "s"} (of ${runs})`);
  parts.push(bandStabilityLabel(bands));
  parts.push(gapVariationLabel(gapCounts));
  if (failedRuns.length > 0) parts.push(`⚠ run${failedRuns.length === 1 ? "" : "s"} ${failedRuns.join(", ")} failed — scored on completed runs only`);
  const verdict = agreementPct == null ? "" : agreementPct >= 90 ? " → highly repeatable." : agreementPct >= 75 ? " → mostly repeatable." : " → ⚠ inconsistent: this path gives different answers on identical input.";
  return parts.join(" · ") + verdict;
}

// ── A vs B (accuracy against the benchmark truth) ────────────────────────

// One path's per-line result, kept so the user can drill into WHAT each path
// actually raised (verdict + reasoning + evidence) and compare A against B
// line by line.
// status null = the line was not assessed in that path's run (AI call
// failed) — displayed as such, never shown as a verdict.
export type ABLine = { ref: string; text: string; status: string | null; note: string; evidence: string[] };

export type ABPathOutcome = {
  ran: boolean;
  error?: string;
  findingsTotal: number; // gaps raised (NC+OFI)
  byType: { NC: number; OFI: number; OBS: number };
  bandEstimate: number | null;
  // Accuracy vs the benchmark's real AFIs (only when the sub-criterion has
  // benchmark truth AND the judge call succeeded).
  judged: boolean;
  caught: number;
  partial: number;
  missed: number;
  lines?: ABLine[];
};

export type ABTestResult = {
  subCriterionId: string;
  runAt: string;
  temperature?: number; // verdict temperature DIAL VALUE (see ConsistencyTestResult.temperature)
  // Same semantics as ConsistencyTestResult.effectiveTemperature / pipelineParity.
  effectiveTemperature?: number | null;
  pipelineParity?: boolean;
  benchmarkCount: number; // real AFIs available as truth (0 = raw counts only)
  patterns: string[]; // the benchmark AFIs' finding patterns for this sub-criterion
  a: ABPathOutcome;
  b: ABPathOutcome;
  winner: "A" | "B" | "tie" | "no-truth";
  verdictLine: string;
};

// Accuracy is the PRIMARY measure: more caught real findings wins; partial
// catches break ties; raw counts never decide when truth exists. With no
// benchmark truth (or no successful judge), there is no accuracy winner.
export function abWinner(a: ABPathOutcome, b: ABPathOutcome, benchmarkCount: number): "A" | "B" | "tie" | "no-truth" {
  if (benchmarkCount === 0 || !a.judged || !b.judged) return "no-truth";
  if (a.caught !== b.caught) return a.caught > b.caught ? "A" : "B";
  if (a.partial !== b.partial) return a.partial > b.partial ? "A" : "B";
  return "tie";
}

export function abVerdictLine(subCriterionId: string, a: ABPathOutcome, b: ABPathOutcome, benchmarkCount: number): string {
  const winner = abWinner(a, b, benchmarkCount);
  const raw = `A raised ${a.findingsTotal} finding${a.findingsTotal === 1 ? "" : "s"} (${a.byType.NC} NC / ${a.byType.OFI} OFI), B raised ${b.findingsTotal} (${b.byType.NC} NC / ${b.byType.OFI} OFI); A band est. ${a.bandEstimate ?? "–"}, B band est. ${b.bandEstimate ?? "–"}`;
  if (winner === "no-truth") {
    return `On ${subCriterionId}: no benchmark truth to compare against — raw output only. ${raw}. Raw counts alone cannot say which path is BETTER.`;
  }
  const acc = `Option A caught ${a.caught} of ${benchmarkCount} real finding${benchmarkCount === 1 ? "" : "s"} (+${a.partial} partial), Option B caught ${b.caught} (+${b.partial} partial)`;
  const tail = winner === "tie"
    ? "→ Tie on accuracy."
    : `→ Option ${winner} performed better here (accuracy — catching the RIGHT findings beats raising more of them).`;
  return `On ${subCriterionId}: ${acc}; ${raw}. ${tail}`;
}

// Overall tally across every stored A-vs-B test, with a pattern breakdown:
// each decided test's win is attributed to the finding patterns of that
// sub-criterion's benchmark AFIs, surfacing e.g. "A stronger on
// not-documented-in-PPD sub-criteria".
export function abOverallTally(tests: ABTestResult[]): {
  aWins: number; bWins: number; ties: number; noTruth: number;
  byPattern: Record<string, { a: number; b: number }>;
  patternNote: string | null;
} {
  let aWins = 0, bWins = 0, ties = 0, noTruth = 0;
  const byPattern: Record<string, { a: number; b: number }> = {};
  for (const t of tests) {
    if (t.winner === "A") aWins++;
    else if (t.winner === "B") bWins++;
    else if (t.winner === "tie") ties++;
    else noTruth++;
    if (t.winner === "A" || t.winner === "B") {
      for (const p of new Set(t.patterns)) {
        byPattern[p] ??= { a: 0, b: 0 };
        byPattern[p][t.winner === "A" ? "a" : "b"]++;
      }
    }
  }
  const leans = Object.entries(byPattern)
    .filter(([, c]) => c.a !== c.b)
    .map(([p, c]) => `${c.a > c.b ? "A" : "B"} stronger on "${p}"`);
  return { aWins, bWins, ties, noTruth, byPattern, patternNote: leans.length ? leans.join(" · ") : null };
}
