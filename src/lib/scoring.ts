import type { Band, EvidenceLevel, Finding, ItemEvidence } from "../types";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { FINDINGS } from "../data/findings";
import type { ChecklistOverride } from "./checklistBanding";

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
// justification" — previously duplicated independently in CriterionScorecard
// and HumanReview, and not enforced at all in the store's confirmScore
// action, which let a score be confirmed with no justification text.
export function needsJustification(ais: number, reviewerValue: number, gate: boolean): boolean {
  const diff = Math.abs(reviewerValue - ais);
  return diff >= 5 || (gate && reviewerValue > ais);
}

// A weak review limb or weak processes limb caps the achievable band even if
// the weighted score would otherwise clear a higher threshold, mirroring the
// rubric's emphasis on Review (regular review/action plans) and Processes
// (deployed, well-managed processes) as gating dimensions for higher bands.
function capBandForEvidence(band: Band, ev: ItemEvidence): Band {
  let capped = band;
  if (ev.review === "Missing" && capped > 3) capped = 3;
  if (ev.processes === "Missing" && capped > 2) capped = 2;
  return capped;
}

export type ScoredItem = ReturnType<typeof buildScoredItem>;

function buildScoredItem(
  req: (typeof GD4_REQUIREMENTS)[number],
  evidence: Record<string, ItemEvidence>,
  reviewer: Record<string, number>,
  confirmed: Record<string, number | null>,
  checklistBandOverrides: Record<string, ChecklistOverride> | undefined
) {
  const ev = evidence[req.id];
  const ais = aiScore(ev);
  const rev = reviewer[req.id] != null ? reviewer[req.id] : ais;
  const conf = confirmed[req.id] ?? undefined;
  const override = checklistBandOverrides?.[req.id];
  const eff = override ? override.eff : conf != null ? conf : rev;
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
    band: override ? override.band : capBandForEvidence(getBand(eff), ev),
    aiBand: capBandForEvidence(getBand(ais), ev),
    checklistOverride: !!override,
  };
}

export function buildScored(state: ScoringInput) {
  const { evidence, reviewer, confirmed, closures, checklistBandOverrides, customFindings } = state;
  const allFindings: Finding[] = [...FINDINGS, ...(customFindings || [])];

  const items = GD4_REQUIREMENTS.map((req) => buildScoredItem(req, evidence, reviewer, confirmed, checklistBandOverrides));

  const crits = GD4_CRITERIA.map((c) => {
    const ci = items.filter((i) => i.crit === c.id);
    const avg = ci.reduce((a, i) => a + i.eff, 0) / ci.length;
    const band = getBand(avg);
    return { ...c, items: ci, avg, band, scored: Math.round((band / 5) * c.points) };
  });

  const total = Math.round(crits.reduce((a, c) => a + (c.band / 5) * c.points, 0));

  // Official gate rule (GD4 section 20): an average minimum of Band 3 of 5 is
  // required in sub-criterion 4.2, sub-criterion 4.6, and Criterion 5 as a
  // whole. These are group-level averages, not per-item pass/fail.
  const gateGroups = [
    { id: "Sub-criterion 4.2", items: items.filter((i) => i.subCriterionId === "4.2") },
    { id: "Sub-criterion 4.6", items: items.filter((i) => i.subCriterionId === "4.6") },
    { id: "Criterion 5", items: items.filter((i) => i.crit === "5") },
  ].map((g) => {
    const avgBand = g.items.reduce((a, i) => a + i.band, 0) / g.items.length;
    return { ...g, avgBand, pass: avgBand >= 3 };
  });
  const gateFail = gateGroups.filter((g) => !g.pass);
  const gatePass = gateFail.length === 0;

  let award = total >= 750 ? "EduTrust Star" : total >= 600 ? "EduTrust (4-Year)" : total >= 500 ? "EduTrust Provisional (1-Year)" : "Not certified";
  if (!gatePass && total >= 600) award = "Capped: critical gate not met";

  const openAFIs = allFindings.filter((a) => (closures[a.id]?.human || "") !== "Accepted").length;

  return { items, crits, total, gatePass, gateFail, award, openAFIs };
}

export type Scored = ReturnType<typeof buildScored>;
