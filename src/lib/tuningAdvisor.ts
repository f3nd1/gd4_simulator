// Tuning Advisor — turns a completed calibration test into concrete
// recommendations. Pure and store-free so the rules are unit-tested. The AI
// RECOMMENDS; the human decides: only two recommendation kinds carry a
// one-click apply (temperature, per-sub-criterion path defaults — both
// visible, reversible settings). Prompt/skill/scoring changes are ALWAYS
// advisory-only, offered as a copyable Claude Code instruction.

import type { ConsistencyTestResult, ABTestResult } from "./calibrationTesting";
import { abOverallTally } from "./calibrationTesting";
import type { MatchStatus } from "../store/useCalibrationStore";

export type RecommendationApply =
  | { type: "temperature"; value: number }
  | { type: "path-defaults"; paths: Record<string, "A" | "B"> };

export type Recommendation = {
  id: string;
  severity: "action" | "advisory" | "ok";
  title: string;
  reasoning: string;
  // The data the recommendation is derived from, shown for transparency.
  evidence: string[];
  // Present only for the two one-click-applicable kinds.
  apply?: RecommendationApply;
  // Present for advisory-only recommendations (prompt/skill work).
  copyableInstruction?: string;
  // True when derived from the fixed benchmark — surfaces the overfitting
  // caution and forbids item-specific tuning.
  benchmarkDerived?: boolean;
};

export const AGREEMENT_TARGET = 80;
const TEMP_FLOOR = 0.15; // at/below this, temperature is "already low"

// From ONE consistency result. Below-target agreement recommends either
// lowering the temperature (if there's room) or, when temperature is already
// low, flagging the disagreeing lines as genuinely ambiguous for human review.
export function recommendFromConsistency(r: ConsistencyTestResult): Recommendation[] {
  if (r.agreementPct == null) {
    return [{
      id: `cons-${r.subCriterionId}-nodata`, severity: "advisory",
      title: "Consistency could not be scored",
      reasoning: "Too many runs failed to produce comparable verdicts. Re-run with the folders connected and AI available.",
      evidence: [r.summary],
    }];
  }
  if (r.agreementPct >= AGREEMENT_TARGET) {
    return [{
      id: `cons-${r.subCriterionId}-ok`, severity: "ok",
      title: `Agreement ${r.agreementPct}% — at or above the ${AGREEMENT_TARGET}% target`,
      reasoning: `Option ${r.path} is reproducible on ${r.subCriterionId} at temperature ${(r.temperature ?? 0.1).toFixed(2)}. No tuning needed.`,
      evidence: [r.summary],
    }];
  }
  const temp = r.effectiveTemperature ?? r.temperature ?? 0.1;
  const disagreeing = r.lines.filter((l) => {
    const vs = l.verdicts.filter((v): v is string => v != null);
    return vs.length >= 2 && !vs.every((v) => v === vs[0]);
  });
  // effectiveTemperature === null means the model IGNORES the temperature
  // parameter entirely (gpt-5/o-series) — recommending "lower the
  // temperature" would be a lie, since the dial has no effect on this model.
  // The variation is the model's own; treat the disagreeing lines as
  // genuinely needing human review / firmer rule wording instead.
  if (r.effectiveTemperature === null) {
    return [{
      id: `cons-${r.subCriterionId}-model-temp`, severity: "advisory",
      title: `Agreement ${r.agreementPct}% — the selected model ignores the temperature setting`,
      reasoning: `This model does not accept a temperature parameter, so the verdict-consistency dial cannot reduce this variation — it comes from the model itself. The ${disagreeing.length} disagreeing line(s) should be flagged for MANDATORY human review, or the Met/Partial rule wording tightened so repeated runs resolve them the same way (advisory — a prompt change, not a one-click apply).`,
      evidence: disagreeing.map((l) => `${l.ref} — ${l.text.slice(0, 80)}: ${l.verdicts.map((v) => v ?? "—").join(" / ")}`),
      copyableInstruction: `In the GD4 assessment prompts (src/lib/ai/agentRuntime.ts), the Met/Partial boundary is still ambiguous for these requirement lines on ${r.subCriterionId}: ${disagreeing.map((l) => l.ref).join(", ")}. Review each line's wording and add an explicit, deterministic rule for when it is Met vs Partial so repeated runs resolve it the same way. Do not tune to specific evidence — generalise the rule. Note: the model in use ignores the temperature parameter, so sampling settings cannot fix this.`,
    }];
  }
  if (temp > TEMP_FLOOR) {
    return [{
      id: `cons-${r.subCriterionId}-temp`, severity: "action",
      title: `Agreement ${r.agreementPct}% at temperature ${temp.toFixed(2)} → lower temperature to 0.10`,
      reasoning: `The runs disagree on ${disagreeing.length} line(s). The most likely cause at temperature ${temp.toFixed(2)} is sampling randomness. Lowering the verdict temperature to 0.10 makes identical input yield identical verdicts. This is a reversible setting — re-run the test to confirm agreement climbs.`,
      evidence: [r.summary, ...disagreeing.slice(0, 5).map((l) => `${l.ref}: ${l.verdicts.map((v) => v ?? "—").join(" / ")}`)],
      apply: { type: "temperature", value: 0.1 },
    }];
  }
  // Temperature already low → the disagreement is genuine ambiguity.
  return [{
    id: `cons-${r.subCriterionId}-ambiguous`, severity: "advisory",
    title: `Agreement ${r.agreementPct}% even at temperature ${temp.toFixed(2)} — these lines are genuinely ambiguous`,
    reasoning: `Temperature is already low, so randomness is not the cause. The ${disagreeing.length} disagreeing line(s) sit on a real judgement boundary and should be flagged for MANDATORY human review rather than trusted to the AI. Consider tightening the Met/Partial rule wording for these requirement types (advisory — a prompt change, not a one-click apply).`,
    evidence: disagreeing.map((l) => `${l.ref} — ${l.text.slice(0, 80)}: ${l.verdicts.map((v) => v ?? "—").join(" / ")}`),
    copyableInstruction: `In the GD4 assessment prompts (src/lib/ai/agentRuntime.ts), the Met/Partial boundary is still ambiguous for these requirement lines on ${r.subCriterionId}: ${disagreeing.map((l) => l.ref).join(", ")}. Review each line's wording and add an explicit, deterministic rule for when it is Met vs Partial so repeated runs resolve it the same way. Do not tune to specific evidence — generalise the rule.`,
  }];
}

// From ALL A-vs-B results: recommend defaulting each decided sub-criterion to
// its winning path, and surface the pattern lean. One applicable action sets
// the path defaults for every decided sub-criterion at once.
export function recommendFromAB(tests: ABTestResult[]): Recommendation[] {
  const decided = tests.filter((t) => t.winner === "A" || t.winner === "B");
  if (decided.length === 0) {
    return [{
      id: "ab-none", severity: "advisory",
      title: "No accuracy-decided A-vs-B comparisons yet",
      reasoning: "Run A vs B on sub-criteria that have benchmark findings — only those produce an accuracy winner that can inform a path default.",
      evidence: tests.length ? [`${tests.length} comparison(s) run, none had benchmark truth to decide a winner.`] : [],
      benchmarkDerived: true,
    }];
  }
  const paths: Record<string, "A" | "B"> = {};
  for (const t of decided) paths[t.subCriterionId] = t.winner as "A" | "B";
  const tally = abOverallTally(tests);
  const aList = decided.filter((t) => t.winner === "A").map((t) => t.subCriterionId);
  const bList = decided.filter((t) => t.winner === "B").map((t) => t.subCriterionId);
  const evidence = decided.map((t) => `${t.subCriterionId}: Option ${t.winner} won (A caught ${t.a.caught}, B caught ${t.b.caught} of ${t.benchmarkCount})`);
  return [{
    id: "ab-path-defaults", severity: "action",
    title: `Set path defaults to the accuracy winner on ${decided.length} tested sub-criteri${decided.length === 1 ? "on" : "a"}`,
    reasoning: `Based on catching the real benchmark findings: ${aList.length ? `Option A won on ${aList.join(", ")}` : ""}${aList.length && bList.length ? "; " : ""}${bList.length ? `Option B won on ${bList.join(", ")}` : ""}.${tally.patternNote ? ` Pattern: ${tally.patternNote}.` : ""} Applying sets each sub-criterion's Evidence Folder path toggle to its winner — visible and reversible.`,
    evidence,
    apply: { type: "path-defaults", paths },
    benchmarkDerived: true,
  }];
}

// From the benchmark match analysis: which pattern do we MISS most, and which
// skill/prompt area to strengthen. Advisory ONLY (prompt/skill work goes
// through the deliberate process) — never references benchmark items verbatim.
const PATTERN_TO_AREA: Record<string, string> = {
  "not documented in PPD": "the PPD requirements review pass (per-sub-clause documented/not decomposition) and the evidence-standards skill",
  "not implemented per PPD": "the promise-verification pass in the evidence assessment (each PPD promise as a named check) and the evidence-standards skill",
  "internal contradiction": "the PPD internal-contradiction hunt (compare every repeated value/timeline/owner)",
  "cross-document mismatch": "the cross-document reconciliation checks (PPD ↔ contract ↔ registry) and the source-citation-verification skill",
  "no timeline/monitoring": "the timeline/monitoring checks (count how many actions carry dates and owners) and the evidence-timeliness skill",
  "other": "the general assessor-grade specificity guidance (named examples, dates compared)",
};

export function recommendFromBenchmark(
  matches: Record<string, { status: MatchStatus }>,
  afis: { id: string; findingPattern: string; kind: string }[],
): Recommendation[] {
  const gapAFIs = afis.filter((a) => a.kind === "AFI");
  const missed = gapAFIs.filter((a) => {
    const st = matches[a.id]?.status;
    return st === "missed" || st === "partial";
  });
  if (missed.length === 0) {
    return [{
      id: "bench-ok", severity: "ok",
      title: "No missed or partially-caught benchmark findings",
      reasoning: "The tool currently catches every real finding it has been matched against. Re-verify against new real findings when available.",
      evidence: [],
      benchmarkDerived: true,
    }];
  }
  const byPattern = new Map<string, number>();
  for (const a of missed) byPattern.set(a.findingPattern, (byPattern.get(a.findingPattern) ?? 0) + 1);
  const ranked = [...byPattern.entries()].sort((x, y) => y[1] - x[1]);
  const [topPattern, topCount] = ranked[0];
  const area = PATTERN_TO_AREA[topPattern] ?? PATTERN_TO_AREA.other;
  return [{
    id: "bench-weak-pattern", severity: "advisory",
    title: `${topCount} of ${missed.length} misses are "${topPattern}" — strengthen that assessment area`,
    reasoning: `The dominant miss pattern is "${topPattern}". The weak point is ${area}. Strengthening it is a prompt/skill change — advisory only, made through the normal deliberate process, never auto-applied.`,
    evidence: ranked.map(([p, n]) => `${n} miss(es): ${p}`),
    copyableInstruction: `The GD4 audit tool is missing real SSG findings that follow the "${topPattern}" pattern (${topCount} of ${missed.length} current misses). Strengthen ${area} so this class of gap is caught. Improve the GENERAL detection rule for this pattern — do not encode the specific benchmark findings; the change must generalise to new, unseen findings of the same kind.`,
    benchmarkDerived: true,
  }];
}

export const OVERFITTING_CAUTION =
  "These recommendations target the 54 known SSG findings in the benchmark. Improvements should GENERALISE — avoid tuning narrowly to this set. Re-verify against new real findings when they become available.";
