import type { Band, EvidenceLevel, Finding, ItemEvidence } from "../types";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { FINDINGS } from "../data/findings";
import { bandToScore, type ChecklistOverride } from "./checklistBanding";
import { resolveFindingType } from "./findingClassification";

export type ScoringInput = {
  evidence: Record<string, ItemEvidence>;
  reviewer: Record<string, number>;
  confirmed: Record<string, number | null>;
  closures: Record<string, { human?: string }>;
  // Band override from the Sub-Criterion Checklist module: when present for
  // a GD4 item, it replaces the evidence-derived band/eff score below, per
  // the "feed into overall score" decision.
  checklistBandOverrides?: Record<string, ChecklistOverride>;
  customFindings?: Finding[];
  // Gates the hard-coded sample findings register so openAFIs/gate counts
  // on a brand-new workspace don't count findings the user hasn't loaded.
  seedFindingsLoaded?: boolean;
  // Tunable EduTrust tier cut-offs (/1000), from useScoringConfigStore. Lets
  // the difficulty of each tier be set on the GD4 Scoring Setup page instead
  // of being hardcoded here.
  awardThresholds?: { provisional: number; fourYear: number; star: number };
};

// Internal simulation weighting across the four official rubric dimensions
// (Approach, Processes, Systems & Outcomes, Review). The weights themselves
// are a simulation choice, not part of the official GD4 text.
export const LAYER_WEIGHT = [0.25, 0.3, 0.25, 0.2] as const;

export function levelValue(level: EvidenceLevel): number {
  return level === "good" ? 1 : level === "Partial" ? 0.5 : 0;
}

export function aiScore(ev: ItemEvidence): number {
  return Math.round(
    100 *
      (levelValue(ev.approach) * LAYER_WEIGHT[0] +
        levelValue(ev.processes) * LAYER_WEIGHT[1] +
        levelValue(ev.systemsOutcomes) * LAYER_WEIGHT[2] +
        levelValue(ev.review) * LAYER_WEIGHT[3])
  );
}

export function getBand(score: number): Band {
  return score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : score >= 40 ? 2 : 1;
}

// Single source of truth for "does this reviewer override need a written
// justification" — used by the Criterion Scorecard and enforced in the
// store's confirmScore action so a score can't be confirmed without the
// required justification text.
export function needsJustification(ais: number, reviewerValue: number, gate: boolean): boolean {
  const diff = Math.abs(reviewerValue - ais);
  // Gate-sensitive items need a written reason for ANY override (up or down) —
  // scoring a critical gate item below the AI without explanation hides
  // auditor bias just as much as scoring it above.
  return diff >= 5 || (gate && reviewerValue !== ais);
}

// A weak review limb or weak processes limb caps the achievable band even if
// the weighted score would otherwise clear a higher threshold, mirroring the
// rubric's emphasis on Review (regular review/action plans) and Processes
// (deployed, well-managed processes) as gating dimensions for higher bands.
//
// This only runs on the Evidence Matrix's quick four-limb fallback path —
// once an item has Sub-Criterion Checklist lines, computeChecklistOverrides
// replaces eff/band outright and this function is never consulted for that
// item. Without a hard floor here, the fallback path let an auditor select
// "good" on all four limbs with no evidence document linked anywhere and no
// checklist used at all, and still score a full Band 5 — i.e. a real
// official score/award contribution with zero verifiable evidence behind
// it. So: no Drive evidence link means nothing here can be verified, and the
// item is capped to Band 1 regardless of what the limb dropdowns claim,
// until either a link is added or the item is scored through the checklist.
function capBandForEvidence(band: Band, ev: ItemEvidence): Band {
  let capped = band;
  if (ev.review === "Missing" && capped > 3) capped = 3;
  if (ev.processes === "Missing" && capped > 2) capped = 2;
  if (!ev.drive && capped > 1) capped = 1;
  return capped;
}

export type ScoredItem = ReturnType<typeof buildScoredItem>;

// A blank, unrated evidence limb-set. Used as a fallback when the evidence map
// has no entry for an item — e.g. a persisted workspace whose map lags the code
// after the GD4 re-align added, renamed or removed items. blankEvidence()
// documents that every current item should have an entry, but persisted state
// can lag the code; without this guard a single missing key threw in aiScore
// and white-screened the whole app. A missing entry scores as an unstarted
// item (all limbs Missing), which is the correct meaning.
const MISSING_EVIDENCE: ItemEvidence = { approach: "Missing", processes: "Missing", systemsOutcomes: "Missing", review: "Missing", owner: "", age: 0, trace: 0, drive: "" };

function buildScoredItem(
  req: (typeof GD4_REQUIREMENTS)[number],
  evidence: Record<string, ItemEvidence>,
  reviewer: Record<string, number>,
  confirmed: Record<string, number | null>,
  checklistBandOverrides: Record<string, ChecklistOverride> | undefined
) {
  const ev = evidence[req.id] ?? MISSING_EVIDENCE;
  const ais = aiScore(ev);
  const rev = reviewer[req.id] != null ? reviewer[req.id] : ais;
  const conf = confirmed[req.id] ?? undefined;
  const override = checklistBandOverrides?.[req.id];
  const eff = override ? override.eff : conf != null ? conf : rev;
  // Mirrors the criterion-level avg===0 special case below: getBand() has no
  // floor below Band 1, so an item with zero effective score would otherwise
  // still render "Band 1" — a real-looking result — on a brand-new
  // workspace. Consumers that render a band/points to the user should check
  // this before doing so; consumers that use band as a risk signal (e.g.
  // "items below Band 3") are unaffected since an un-started item is
  // legitimately at-risk either way.
  const started = override ? true : eff > 0;
  return {
    id: req.id,
    crit: req.criterion,
    subCriterionId: req.subCriterionId,
    title: req.requirement,
    gate: req.gateSensitive,
    requirement: req,
    ev,
    ais,
    rev,
    conf,
    eff,
    started,
    band: override ? override.band : capBandForEvidence(getBand(eff), ev),
    aiBand: capBandForEvidence(getBand(ais), ev),
    checklistOverride: !!override,
  };
}

export function buildScored(state: ScoringInput) {
  const { evidence, reviewer, confirmed, closures, checklistBandOverrides, customFindings, seedFindingsLoaded, awardThresholds } = state;
  const allFindings: Finding[] = [...(seedFindingsLoaded ? FINDINGS : []), ...(customFindings || [])];

  const items = GD4_REQUIREMENTS.map((req) => buildScoredItem(req, evidence, reviewer, confirmed, checklistBandOverrides));

  const crits = GD4_CRITERIA.map((c) => {
    const ci = items.filter((i) => i.crit === c.id);
    // Raw effective-score average — kept for display (RubricBanding shows it)
    // and for the "started" signal, but deliberately NOT used for the
    // criterion band/points any more.
    const avg = ci.reduce((a, i) => a + i.eff, 0) / ci.length;
    // Criterion band/points from each item's CAPPED band, not its raw eff.
    // Previously the average of uncapped eff scores fed the award, so the
    // per-item evidence caps (no Drive link → Band 1, review/processes
    // Missing → Band 3/2) were cosmetic: an all-good workspace with zero
    // linked evidence displayed Band 1 on every item yet still totalled a
    // Star award. bandToScore round-trips through getBand's thresholds, so a
    // criterion of uniform Band-N items lands back on Band N.
    const cappedAvg = ci.reduce((a, i) => a + bandToScore(i.band), 0) / ci.length;
    const band = getBand(cappedAvg);
    // getBand has no floor below Band 1, so a criterion with literally zero
    // evidence on every item would otherwise still be credited 1/5 of its
    // points (Band 1's share) on a brand-new workspace. Only this exact
    // all-zero case is special-cased to truly award nothing.
    const scored = avg === 0 ? 0 : Math.round((band / 5) * c.points);
    return { ...c, items: ci, avg, band, scored, started: avg > 0 };
  });

  const total = Math.round(crits.reduce((a, c) => a + c.scored, 0));

  // Official gate rule (GD4 section 20): an average minimum of Band 3 of 5 is
  // required in sub-criterion 4.2, sub-criterion 4.6, and Criterion 5 as a
  // whole. 4.6 and Criterion 5 remain group-level averages. Sub-criterion 4.2
  // was split into two items (4.2.1 Student Contract, 4.2.2 Fee Collection &
  // FPS); at Felix's explicit instruction (2026-07-19) each is gated
  // INDEPENDENTLY here rather than averaged together as one "Sub-criterion
  // 4.2" group — stricter than the literal §20 wording (a single
  // sub-criterion average), a deliberate deviation the user chose over the
  // official-average reading. A strong 4.2.1 can no longer offset a weak
  // 4.2.2, or vice versa.
  const gateGroups = [
    { id: "4.2.1", items: items.filter((i) => i.id === "4.2.1") },
    { id: "4.2.2", items: items.filter((i) => i.id === "4.2.2") },
    { id: "Sub-criterion 4.6", items: items.filter((i) => i.subCriterionId === "4.6") },
    { id: "Criterion 5", items: items.filter((i) => i.crit === "5") },
  ].map((g) => {
    // Guard the empty case: an empty group would give 0/0 = NaN, and NaN >= 3
    // is false, so the gate would silently "fail" (or with other arithmetic
    // silently pass). An empty gate group is "not started", not a pass.
    const avgBand = g.items.length ? g.items.reduce((a, i) => a + i.band, 0) / g.items.length : 0;
    return { ...g, avgBand, pass: g.items.length > 0 && avgBand >= 3 };
  });
  const gateFail = gateGroups.filter((g) => !g.pass);
  const gatePass = gateFail.length === 0;
  // Unrounded gate detail for every consumer (Final Report chart, analytics).
  // Consumers must NOT recompute this: analytics used to re-derive it with
  // 1-decimal rounding, so an avgBand of 2.96 rounded to 3.0 and displayed
  // "pass" beside the scorecard's "fail" on the same page.
  const gates = gateGroups.map((g) => ({ id: g.id, avgBand: g.avgBand, pass: g.pass }));

  const T = awardThresholds || { provisional: 500, fourYear: 600, star: 750 };
  let award = total >= T.star ? "EduTrust Star" : total >= T.fourYear ? "EduTrust (4-Year)" : total >= T.provisional ? "EduTrust Provisional (1-Year)" : "Not certified";
  if (!gatePass) {
    // Official gate rule (GD4 section 20): failing the minimum-Band-3 gate on
    // 4.2 / 4.6 / Criterion 5 means no certification, full stop — the tier is
    // denied outright, not merely annotated. Previously this only decorated
    // the award string, so a gate-failing workspace still exported a named
    // tier at full points. The numeric total is left as computed (it is the
    // points achieved), but the awarded tier is "Not certified" everywhere
    // this string is consumed (Final Report, exports, analytics, charts).
    award = "Not certified — critical gate not met";
  }

  // Open ISSUES only: positive observations (OBS / risk category D — "no
  // action required") are records of strength, not open items, so counting
  // them here overstated the open-issue figure everywhere it is shown.
  const openAFIs = allFindings.filter(
    (a) => (closures[a.id]?.human || "") !== "Accepted" && resolveFindingType(a) !== "OBS" && a.riskCategory !== "D"
  ).length;

  return { items, crits, total, gatePass, gateFail, gates, award, openAFIs };
}

export type Scored = ReturnType<typeof buildScored>;
