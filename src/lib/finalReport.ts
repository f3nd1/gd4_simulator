// Builds the read-only Final Report: overall + per-criterion + per-item
// banding, a findings table of real per-line strengths/weaknesses with AFIs,
// and the findings register with closure (root cause / corrective action)
// detail.
import type { Scored } from "./scoring";
import { getBand } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine, ApsrDimensionScore, Band } from "../types";
import {
  lineSufficiency, lineCompleteness, needsReassessment, apsrMatrixResult, bandToScore, fastestPathToNextBand,
  lineDimensionDiagnosis, lineSuggestedAction, DEFAULT_APSR_SCALE, type LineCompleteness, type ApsrScale, type ApsrMatrixResult,
} from "./checklistBanding";
import { EDUTRUST_DIMENSIONS } from "../data/edutrustRubric";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "./../data/gd4Requirements";

export type ClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted"; aiNeed?: string };

// ONE real requirement line's row in the findings table — grouped under its
// dimension (see DimensionFindingsGroup). A line that carries a distinct
// weakness under two different dimensions (rare, but real — the same clause
// ref can back two separately-tagged lines) produces two separate rows, one
// per group, never merged.
export type ItemFindingRow = {
  lineId: string;
  // The line's own ref (clause, falling back to sourceRef then the line id)
  // — e.g. "6.2.1.DS2". Never invented when a line genuinely has no ref.
  itemRef: string;
  isWeakness: boolean;
  // Strength: the real evidence summary/comment for this line, one sentence.
  // Weakness: "Weakness — " + the real diagnosis, one sentence, or an honest
  // "no diagnosis recorded" note when the line has none on file.
  finding: string;
  // The real suggested action for a weakness row (or an honest "no action
  // recorded" note when none exists) — always undefined for strength rows,
  // since there is nothing to close.
  afi?: string;
};

export type DimensionFindingsGroup = {
  key: "approach" | "processes" | "systemsOutcomes" | "review";
  label: string;
  band: ApsrDimensionScore;
  pct: number;
  // Empty when no line is tagged to this dimension — the UI shows an honest
  // placeholder row, never a fabricated finding.
  rows: ItemFindingRow[];
};

// Trims real AI-authored text to ONE sentence for a report line, without
// inventing wording: the first sentence up to its terminal punctuation, or a
// hard character cap with an ellipsis when no sentence boundary exists.
function firstSentence(text: string, cap = 220): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  if (match) return match[0].trim();
  return trimmed.length > cap ? `${trimmed.slice(0, cap).trim()}…` : trimmed;
}

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
  // for full traceability, shown collapsed behind the summary+table below
  // rather than as the primary reading.
  bandRationale?: string;
  bandTotalPct?: number;
  // Ten-second read above the findings table: band, %, which dimensions are
  // strong/limiting, and roughly how many AFIs would close the gap to the
  // next band — built from apsrMatrixResult/fastestPathToNextBand, the SAME
  // limiting-factor logic the Band Improvement Panel already uses. Undefined
  // when no holisticBand.matrixScores exists yet (nothing to summarise).
  overallSummary?: string;
  findingsGroups: DimensionFindingsGroup[];
  // A general instruction for the ONE case the summary+table can't cover at
  // all: no per-line data exists yet (no checklist, or an old-model item
  // needing re-assessment). Undefined once real per-line data exists.
  generalNote?: string;
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

const APSR_DIM_KEYS: DimensionFindingsGroup["key"][] = ["approach", "processes", "systemsOutcomes", "review"];

// Builds the findings table for one item, grouped by dimension: one row per
// real tagged line (see ItemFindingRow), restructured entirely from data
// already computed/recorded elsewhere — no new AI call, no free-text parsing.
// A line tagged to a dimension where it's genuinely weak reads as a weakness
// row there even if the SAME clause ref also backs a different line tagged
// strong under another dimension (Task 2's DS2-style case) — each line
// object produces exactly one row, under its own dimension only.
function buildFindingsGroups(entry: SubCriterionChecklistEntry | undefined, scale: ApsrScale): DimensionFindingsGroup[] {
  const hb = entry?.holisticBand;
  if (!hb?.matrixScores) return [];
  const specific = entry?.specific ?? [];
  const result = apsrMatrixResult(hb.matrixScores, scale);
  const out: DimensionFindingsGroup[] = [];
  for (const key of APSR_DIM_KEYS) {
    const score = hb.matrixScores[key];
    if (score === undefined) continue;
    const label = EDUTRUST_DIMENSIONS.find((d) => d.key === key)!.label;
    const dimLines = specific.filter((l) => l.apsrDimension === label && l.status !== "Not Applicable");
    const rows: ItemFindingRow[] = dimLines.map((l) => {
      const itemRef = l.clause || l.sourceRef || l.id;
      const isWeakness = l.status !== "Met" || lineSufficiency(l) !== "Present";
      const text = lineDimensionDiagnosis(l, key);
      if (isWeakness) {
        const action = lineSuggestedAction(l);
        return {
          lineId: l.id, itemRef, isWeakness,
          finding: `Weakness — ${text ? firstSentence(text) : "No detailed diagnosis recorded for this line."}`,
          afi: action ? firstSentence(action) : "No concrete suggested action recorded for this line.",
        };
      }
      return {
        lineId: l.id, itemRef, isWeakness,
        finding: text ? firstSentence(text) : "No evidence summary recorded for this line.",
      };
    });
    out.push({ key, label, band: score, pct: result.pcts[key], rows });
  }
  return out;
}

// Ten-second read above the findings table: band, %, which dimensions are
// strong/limiting, and roughly how many real AFI rows would close the gap to
// the next band — reuses fastestPathToNextBand, the SAME limiting-factor
// logic the Band Improvement Panel already shows, never a new calculation.
function buildOverallSummary(result: ApsrMatrixResult, groups: DimensionFindingsGroup[], scale: ApsrScale): string {
  const strongLabels = groups.filter((g) => g.rows.length > 0 && g.rows.every((r) => !r.isWeakness)).map((g) => g.label);
  const strongPhrase = strongLabels.length ? ` ${strongLabels.join(", ")} ${strongLabels.length > 1 ? "are" : "is"} strong.` : "";
  const path = fastestPathToNextBand(result, scale);
  if (!path) {
    return `This item is banded at Band ${result.band} (${result.total}%).${strongPhrase} All four dimensions are already at the scale's maximum, so no further AFIs are needed to raise the band.`;
  }
  const limitingLabels = path.dims.map((d) => EDUTRUST_DIMENSIONS.find((x) => x.key === d)!.label);
  const afiCount = groups.filter((g) => path.dims.includes(g.key)).reduce((a, g) => a + g.rows.filter((r) => r.isWeakness).length, 0);
  const closePhrase = afiCount > 0 ? `closing ${afiCount} AFI${afiCount === 1 ? "" : "s"} in ${limitingLabels.join(" and ")}` : `raising ${limitingLabels.join(" and ")}`;
  return `This item is banded at Band ${result.band} (${result.total}%).${strongPhrase} ${limitingLabels.join(" and ")} ${limitingLabels.length > 1 ? "are" : "is"} limiting the band — ${closePhrase} would raise it to Band ${path.nextBand}.`;
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

  const hb = entry?.holisticBand;
  const findingsGroups = buildFindingsGroups(entry, scale);
  const overallSummary = hb?.matrixScores ? buildOverallSummary(apsrMatrixResult(hb.matrixScores, scale), findingsGroups, scale) : undefined;

  // The ONE case the summary+table can't cover: no per-line data exists yet
  // (no checklist at all, or an old-model item needing re-assessment under
  // the official rubric before a matrix even exists). A general instruction,
  // not tied to any specific line — kept separately per Task 3's finding
  // that everything else in the old bulleted sections (per-line strengths/
  // gaps, the compiled "how to reach Band N" advice) is now a strict subset
  // of the findings table and was removed rather than duplicated.
  const generalNote = !hasChecklist
    ? "Generate the Sub-Criterion Checklist for this item (run the Evidence Folder audit, or generate it on the Sub-Criterion Checklist page), then attach evidence and set its holistic band."
    : reassess
      ? "Re-assess this item's band under the official EduTrust §23 rubric: open the Sub-Criterion Checklist and select the band level whose four dimension descriptors best fit the evidence."
      : undefined;

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
    bandRationale: hb?.rationale,
    bandTotalPct: hb?.matrixScores ? apsrMatrixResult(hb.matrixScores, scale).total : undefined,
    overallSummary,
    findingsGroups,
    generalNote,
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
