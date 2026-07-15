// Builds the read-only Final Report: overall + per-criterion + per-item
// banding, strengths, AFIs/gaps, and a deterministic "how to reach a higher
// band" analysis derived from the same checklist banding the score uses, plus
// the findings register with closure (root cause / corrective action) detail.
import type { Scored } from "./scoring";
import { getBand } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine, ApsrDimensionScore, Band } from "../types";
import {
  lineSufficiency, lineCompleteness, needsReassessment, bandEvidenceAdvisories, apsrMatrixResult, bandToScore,
  lineDimensionDiagnosis, lineSuggestedAction, DEFAULT_APSR_SCALE, type LineCompleteness, type ApsrScale,
} from "./checklistBanding";
import { bandTitle, EDUTRUST_BANDS, EDUTRUST_DIMENSIONS } from "../data/edutrustRubric";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "./../data/gd4Requirements";

export type ClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted"; aiNeed?: string };

// Plain-language rendering of ONE dimension's judgment for one item — built
// entirely from already-computed, already-real data (the official §23
// descriptor text for the scored band, and the SAME per-line APSR note /
// suggestedAction fields the Band Improvement Panel already shows), never a
// new AI call and never parsed out of the dense, citation-heavy composed
// holisticBand.rationale (which stays available separately, unabridged, for
// anyone who wants the AI's original wording).
export type ItemDimensionSummary = {
  key: "approach" | "processes" | "systemsOutcomes" | "review";
  label: string;
  band: ApsrDimensionScore;
  pct: number;
  // "What's actually true right now" — the verbatim official §23 descriptor
  // for the band this dimension was scored at (or the honest 0%-floor note).
  finding: string;
  // True when at least one line under this dimension has an open gap (a
  // Not met/Partial line, or a Met line without sufficient evidence) —
  // distinguishes "no gap, nothing to say" from "there IS a gap but no real
  // diagnosis was captured on file" so the UI never invents either.
  hasGap: boolean;
  // Real per-line diagnosis (lineDimensionDiagnosis), verbatim — undefined
  // when hasGap is false (nothing to report) OR when no line under this
  // dimension carries a recorded diagnosis (honest fallback in the UI).
  missing?: string;
  // Real per-line "what would make this Met" (lineSuggestedAction), verbatim
  // — same undefined rule as missing.
  howToImprove?: string;
};

export type ItemReport = {
  id: string;
  title: string;
  criterion: string;
  subCriterionId: string;
  gate: boolean;
  band: number;
  started: boolean;
  hasChecklist: boolean;
  // Requirement-line completeness — evidence context, not a band input.
  completeness: LineCompleteness;
  // True when the item has old-model checklist data but no holistic band yet
  // — its band needs re-assessment under the official §23 rubric.
  needsReassessment: boolean;
  // The AI's or reviewer's own composed rationale, dense and citation-heavy
  // by design (it's the record of exactly what was judged and why) — kept
  // for full traceability, shown collapsed behind the plain-language
  // dimensionSummaries below rather than as the primary reading.
  bandRationale?: string;
  bandTotalPct?: number;
  dimensionSummaries: ItemDimensionSummary[];
  strengths: string[];
  gaps: string[];
  targetBand: number;
  howToImprove: string[];
};

export type SubCriterionReport = {
  id: string;
  criterionId: string;
  title: string;
  band: Band;
  // A proportional share of the parent criterion's official points, split by
  // item count — NOT a separately-allocated official figure (GD4 only
  // allocates points at criterion level). Informational grouping only; the
  // report's overall total is still summed from criterion-level `scored`.
  points: number;
  scored: number;
  started: boolean;
};

export type FindingReport = {
  id: string;
  itemId: string;
  issue: string;
  severity: string;
  type: string;
  status: string;
  closed: boolean;
  rootCause?: string;
  corrective?: string;
  preventive?: string;
  closureEvidence?: string;
  stillNeeded?: string;
};

export type FinalReport = {
  overall: { total: number; award: string; gatePass: boolean; gateFail: string[]; openAFIs: number };
  crits: { id: string; title: string; band: number; scored: number; points: number; started: boolean }[];
  subCriteria: SubCriterionReport[];
  items: ItemReport[];
  findings: FindingReport[];
};

function lineLabel(l: SpecificChecklistLine): string {
  return l.clause ? `${l.clause}: ${l.text}` : l.text;
}

function brief(items: string[], n = 4): string {
  return items.length > n ? `${items.slice(0, n).join("; ")}; +${items.length - n} more` : items.join("; ");
}

// Verbatim official §23 descriptor for a scored dimension — the same table
// ApsrMatrixSelector already renders cell-by-cell, just looked up here instead
// of re-typed. 0% is an honest floor below Band 1, not a missing value.
function dimensionDescriptor(dimKey: ItemDimensionSummary["key"], score: ApsrDimensionScore): string {
  if (score === 0) return "No evidence / not yet assessed — a genuine 0% floor, below Band 1.";
  return (EDUTRUST_BANDS[score - 1] as unknown as Record<string, string>)[dimKey];
}

const APSR_DIM_KEYS: ItemDimensionSummary["key"][] = ["approach", "processes", "systemsOutcomes", "review"];

// Builds the plain-language per-dimension breakdown for one item, restructured
// entirely from data already computed/recorded elsewhere (see
// ItemDimensionSummary's own comment) — no new AI call, no free-text parsing.
function buildDimensionSummaries(entry: SubCriterionChecklistEntry | undefined, scale: ApsrScale): ItemDimensionSummary[] {
  const hb = entry?.holisticBand;
  if (!hb?.matrixScores) return [];
  const specific = entry?.specific ?? [];
  const result = apsrMatrixResult(hb.matrixScores, scale);
  const out: ItemDimensionSummary[] = [];
  for (const key of APSR_DIM_KEYS) {
    const score = hb.matrixScores[key];
    if (score === undefined) continue;
    const label = EDUTRUST_DIMENSIONS.find((d) => d.key === key)!.label;
    const dimLines = specific.filter((l) => l.apsrDimension === label && l.status !== "Not Applicable");
    const gapLines = dimLines.filter((l) => l.status !== "Met" || lineSufficiency(l) !== "Present");
    const missing = gapLines.map((l) => lineDimensionDiagnosis(l, key)).find((t) => !!t);
    const howToImprove = gapLines.map((l) => lineSuggestedAction(l)).find((t) => !!t);
    out.push({ key, label, band: score, pct: result.pcts[key], finding: dimensionDescriptor(key, score), hasGap: gapLines.length > 0, missing, howToImprove });
  }
  return out;
}

// Sub-criterion rollup — the SAME band/points formula the criterion level
// already uses (bandToScore -> getBand -> band/5 x points), one grouping
// level finer. Points are a proportional share of the parent criterion's
// official points by item count (see SubCriterionReport's own comment) —
// GD4 itself only allocates points at criterion granularity.
function buildSubCriterionReports(scored: Scored): SubCriterionReport[] {
  const out: SubCriterionReport[] = [];
  for (const sc of GD4_SUB_CRITERIA) {
    const crit = scored.crits.find((c) => c.id === sc.criterionId);
    if (!crit || crit.items.length === 0) continue;
    const items = crit.items.filter((i) => i.subCriterionId === sc.id);
    if (items.length === 0) continue;
    const cappedAvg = items.reduce((a, i) => a + bandToScore(i.band), 0) / items.length;
    const band = getBand(cappedAvg);
    const rawAvg = items.reduce((a, i) => a + i.eff, 0) / items.length;
    const points = crit.points * (items.length / crit.items.length);
    const scoredPts = rawAvg === 0 ? 0 : Math.round((band / 5) * points);
    out.push({ id: sc.id, criterionId: sc.criterionId, title: sc.title, band, points, scored: scoredPts, started: rawAvg > 0 });
  }
  return out;
}

function analyseItem(
  id: string,
  title: string,
  criterion: string,
  subCriterionId: string,
  gate: boolean,
  band: number,
  started: boolean,
  entry: SubCriterionChecklistEntry | undefined,
  scale: ApsrScale
): ItemReport {
  const specific: SpecificChecklistLine[] = entry?.specific || [];
  const hasChecklist = specific.length > 0;
  const completeness = lineCompleteness(specific);
  const reassess = entry ? needsReassessment(entry) : false;
  const graded = specific.filter((l) => l.status !== "Not Applicable");

  const strengths = graded
    .filter((l) => l.status === "Met" && lineSufficiency(l) === "Present")
    .map((l) => lineLabel(l));

  const notMet = graded.filter((l) => l.status !== "Met");
  const missingEv = graded.filter((l) => lineSufficiency(l) === "Missing");
  const gaps: string[] = [
    ...notMet.map((l) => `${lineLabel(l)} — ${l.status || "Not started"}`),
    ...missingEv.filter((l) => l.status === "Met").map((l) => `${lineLabel(l)} — marked Met but evidence is missing`),
  ];

  // The band is a holistic judgment (official §23 rubric) — improvement
  // advice points at the evidence gaps and the target band's official
  // descriptors, never at a coverage-% formula (the retired engine's model).
  const targetBand = Math.min(band + 1, 5);
  const howToImprove: string[] = [];
  if (!hasChecklist) {
    howToImprove.push("Generate the Sub-Criterion Checklist for this item (run the Evidence Folder audit, or generate it on the Sub-Criterion Checklist page), then attach evidence and set its holistic band.");
  } else if (reassess) {
    howToImprove.push("Re-assess this item's band under the official EduTrust §23 rubric: open the Sub-Criterion Checklist and select the band level whose four dimension descriptors best fit the evidence.");
  } else if (band >= 5) {
    howToImprove.push("Already at Band 5 — keep evidence current and the review cadence going to hold it.");
  } else {
    const hb = entry?.holisticBand;
    if (hb) howToImprove.push(...bandEvidenceAdvisories(specific, hb.band));
    if (notMet.length) howToImprove.push(`Close the requirement-line gaps: ${brief(notMet.map(lineLabel))}.`);
    if (missingEv.length) howToImprove.push(`Attach or strengthen evidence on: ${brief(missingEv.map(lineLabel))}.`);
    howToImprove.push(`Then compare the evidence against the official ${bandTitle(targetBand as 1 | 2 | 3 | 4 | 5)} descriptors on the Sub-Criterion Checklist and re-judge the band.`);
  }

  return {
    id,
    title,
    criterion,
    subCriterionId,
    gate,
    band,
    started,
    hasChecklist,
    completeness,
    needsReassessment: reassess,
    bandRationale: entry?.holisticBand?.rationale,
    bandTotalPct: entry?.holisticBand?.matrixScores ? apsrMatrixResult(entry.holisticBand.matrixScores, scale).total : undefined,
    dimensionSummaries: buildDimensionSummaries(entry, scale),
    strengths,
    gaps,
    targetBand,
    howToImprove,
  };
}

export function buildFinalReport(
  scored: Scored,
  entries: Record<string, SubCriterionChecklistEntry>,
  findings: Finding[],
  closures: Record<string, ClosureLite>,
  scale: ApsrScale = DEFAULT_APSR_SCALE
): FinalReport {
  const items = scored.items.map((it) => analyseItem(it.id, it.title, it.crit, it.subCriterionId, it.gate, it.band, it.started, entries[it.id], scale));

  const crits = scored.crits.map((c) => ({ id: c.id, title: c.title, band: c.band, scored: c.scored, points: c.points, started: c.started }));
  const subCriteria = buildSubCriterionReports(scored);

  const findingReports: FindingReport[] = findings.map((f) => {
    const c = closures[f.id] || {};
    const reqTitle = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.requirement;
    return {
      id: f.id,
      itemId: f.gd4ItemId + (reqTitle ? ` ${reqTitle}` : ""),
      issue: f.issue,
      // Resolved NC/OFI/OBS classification (which applyPanelConclusion updates),
      // not the raw legacy fields — the report must agree with the Findings
      // register and Export Centre, both of which already resolve.
      severity: resolveNcSeverity(f) ?? f.severity,
      type: resolveFindingType(f),
      status: f.status,
      closed: (c.human || "") === "Accepted",
      rootCause: c.root,
      corrective: c.corr,
      preventive: c.prev,
      closureEvidence: c.evid,
      stillNeeded: c.aiNeed,
    };
  });

  return {
    overall: {
      total: scored.total,
      award: scored.award,
      gatePass: scored.gatePass,
      gateFail: scored.gateFail.map((g) => g.id),
      openAFIs: scored.openAFIs,
    },
    crits,
    subCriteria,
    items,
    findings: findingReports,
  };
}
