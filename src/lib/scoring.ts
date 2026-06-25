import type { Band, ChecklistStatus, EvidenceLevel, ItemEvidence } from "../types";
import { GD4_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { FINDINGS } from "../data/findings";
import { DEPTS, CHECKLIST_LIB } from "../data/agents";

export type ScoringInput = {
  evidence: Record<string, ItemEvidence>;
  reviewer: Record<string, number>;
  confirmed: Record<string, number | null>;
  closures: Record<string, { human?: string }>;
  checklist: Record<string, { status?: ChecklistStatus }>;
};

// Weighting across the four evidence limbs: policy/approach, implementation,
// review, outcome. Matches the existing prototype's rubric.
export const LAYER_WEIGHT = [0.25, 0.3, 0.25, 0.2] as const;

export function levelValue(level: EvidenceLevel): number {
  return level === "good" ? 1 : level === "Partial" ? 0.5 : 0;
}

export function aiScore(ev: ItemEvidence): number {
  return Math.round(
    100 *
      (levelValue(ev.ppd) * LAYER_WEIGHT[0] +
        levelValue(ev.impl) * LAYER_WEIGHT[1] +
        levelValue(ev.review) * LAYER_WEIGHT[2] +
        levelValue(ev.outcome) * LAYER_WEIGHT[3])
  );
}

export function getBand(score: number): Band {
  return score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : score >= 40 ? 2 : 1;
}

export type ScoredItem = ReturnType<typeof buildScoredItem>;

function buildScoredItem(
  req: (typeof GD4_REQUIREMENTS)[number],
  evidence: Record<string, ItemEvidence>,
  reviewer: Record<string, number>,
  confirmed: Record<string, number | null>
) {
  const ev = evidence[req.id];
  const ais = aiScore(ev);
  const rev = reviewer[req.id] != null ? reviewer[req.id] : ais;
  const conf = confirmed[req.id] ?? undefined;
  const eff = conf != null ? conf : rev;
  return {
    id: req.id,
    crit: req.criterion,
    title: req.requirement,
    gate: req.gateSensitive,
    requirement: req,
    ev,
    ais,
    rev,
    conf,
    eff,
    band: getBand(eff),
    aiBand: getBand(ais),
  };
}

export function buildScored(state: ScoringInput) {
  const { evidence, reviewer, confirmed, closures, checklist } = state;

  const items = GD4_REQUIREMENTS.map((req) => buildScoredItem(req, evidence, reviewer, confirmed));

  const crits = GD4_CRITERIA.map((c) => {
    const ci = items.filter((i) => i.crit === c.id);
    const avg = ci.reduce((a, i) => a + i.eff, 0) / ci.length;
    const band = getBand(avg);
    return { ...c, items: ci, avg, band, scored: Math.round((band / 5) * c.points) };
  });

  const total = Math.round(crits.reduce((a, c) => a + (c.band / 5) * c.points, 0));
  const gateItems = items.filter((i) => i.gate);
  const gateFail = gateItems.filter((i) => i.band < 3);
  const gatePass = gateFail.length === 0;

  let award = total >= 750 ? "EduTrust Star" : total >= 600 ? "EduTrust (4-Year)" : total >= 500 ? "EduTrust Provisional (1-Year)" : "Not certified";
  if (!gatePass && total >= 600) award = "Capped: critical gate not met";

  const openAFIs = FINDINGS.filter((a) => (closures[a.id]?.human || "") !== "Accepted").length;

  const deptGates = DEPTS.map((d) => {
    const di = CHECKLIST_LIB.filter((c) => c.dept === d.dept);
    const states: ChecklistStatus[] = di.map((c) => checklist[c.id]?.status || "Not Started");
    const fail = states.some((s) => s === "Fail");
    const notStarted = states.some((s) => s === "Not Started");
    const partial = states.some((s) => s === "Partial");
    const gate = fail || notStarted ? "Fail" : partial ? "At risk" : "Pass";
    return { ...d, total: di.length, gate };
  });

  const checklistPass = deptGates.every((d) => d.gate === "Pass");
  const checklistDone = CHECKLIST_LIB.filter((c) => (checklist[c.id]?.status || "Not Started") !== "Not Started").length;

  return { items, crits, total, gatePass, gateFail, award, openAFIs, deptGates, checklistPass, checklistDone };
}

export type Scored = ReturnType<typeof buildScored>;
