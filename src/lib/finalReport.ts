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
import { isOptionANotAssessedNote } from "./optionAChecklistWrite";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "./../data/gd4Requirements";

// House-style restatement of the Option A not-assessed note for the report,
// no em dash. Detection uses the raw sentinel (isOptionANotAssessedNote); the
// displayed text is this clean version, saying the same thing.
const NOT_ASSESSED_FINDING = "Not assessed by Option A (PPD and Evidence). Run the staged audit or attach outcome or review evidence to assess this dimension.";

export type ClosureLite = { root?: string; corr?: string; prev?: string; evid?: string; human?: "" | "Accepted"; aiNeed?: string };

// ONE real requirement line's row in the findings table — grouped under its
// dimension (see DimensionFindingsGroup). A line that carries a distinct
// weakness under two different dimensions (rare, but real — the same clause
// ref can back two separately-tagged lines) produces two separate rows, one
// per group, never merged.
//
// verdict is a THREE-state judgment, not a boolean:
//   "strength"     — Met with sufficient evidence.
//   "weakness"     — assessed and found lacking (a real finding to close).
//   "not-assessed" — Option A structurally never assessed this dimension
//     (Systems & Outcomes / Review), so there is NO data to judge it either
//     way. This is distinct from a weakness: an absence of assessment is not
//     a finding, and must never be dressed up as one (the bug this replaces
//     showed the SAME "not assessed by Option A" note as a red "Weakness"
//     on one row and plain green on another).
export type FindingVerdict = "strength" | "weakness" | "not-assessed";
export type ItemFindingRow = {
  lineId: string;
  // The line's own ref (clause, falling back to sourceRef then the line id)
  // — e.g. "6.2.1.DS2". Never invented when a line genuinely has no ref.
  itemRef: string;
  verdict: FindingVerdict;
  // The real per-line text for this dimension, one sentence — the evidence
  // summary for a strength, the diagnosis for a weakness, or the honest
  // "not assessed" explanation for a not-assessed row. Never carries a
  // "Weakness —" prefix: the verdict drives the label/colour in the UI.
  finding: string;
  // The real suggested action for a WEAKNESS row (or an honest "no action
  // recorded" note when none exists) — undefined for strength rows (nothing
  // to close) and for not-assessed rows (nothing was assessed to act on).
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
      const text = lineDimensionDiagnosis(l, key);
      // A dimension Option A structurally never assessed (its per-line note is
      // the not-assessed sentinel) is NEITHER a strength nor a weakness — no
      // data exists to judge it. Detect it first, before the status-based
      // weakness test, so an unassessed dimension is never mislabelled a
      // finding just because the line's overall status is Not met/Partial.
      if (isOptionANotAssessedNote(text)) {
        return { lineId: l.id, itemRef, verdict: "not-assessed", finding: NOT_ASSESSED_FINDING };
      }
      const isWeakness = l.status !== "Met" || lineSufficiency(l) !== "Present";
      if (isWeakness) {
        const action = lineSuggestedAction(l);
        return {
          lineId: l.id, itemRef, verdict: "weakness",
          finding: text ? firstSentence(text) : "No detailed diagnosis recorded for this line.",
          afi: action ? firstSentence(action) : "No concrete suggested action recorded for this line.",
        };
      }
      return {
        lineId: l.id, itemRef, verdict: "strength",
        finding: text ? firstSentence(text) : "No evidence summary recorded for this line.",
      };
    });
    out.push({ key, label, band: score, pct: result.pcts[key], rows });
  }
  return out;
}

// Ten-second read above the findings table: 2-4 plain sentences on band + %,
// what's genuinely strong (with a real one-line reason), what's limiting the
// band (with a real one-line reason), and roughly what closing the gap would
// take. Every clause is drawn from the SAME structured per-line data the
// findings table shows (real diagnosis/evidence text) plus fastestPathToNext-
// Band (the limiting-factor logic the Band Improvement Panel already uses) —
// no new AI call, no invented content. (The band-suggestion AI's own per-
// dimension reason fields are not persisted on the entry — only the composed
// rationale is — so the concrete reasons here are pulled from the equivalent
// real per-line text, which is structured and available at render time.)
function buildOverallSummary(result: ApsrMatrixResult, groups: DimensionFindingsGroup[], scale: ApsrScale): string {
  const firstText = (g: DimensionFindingsGroup, v: FindingVerdict): string | undefined =>
    g.rows.find((r) => r.verdict === v)?.finding;

  const sentences: string[] = [`This item is banded at Band ${result.band} (${result.total}%).`];

  // Strengths: dimensions whose assessed lines are all strengths (ignoring
  // not-assessed rows, which are neither strong nor weak). Name them and, if
  // available, quote one real evidenced strength so it's concrete, not a bare
  // "X is strong".
  const strongGroups = groups.filter((g) => g.rows.some((r) => r.verdict === "strength") && !g.rows.some((r) => r.verdict === "weakness"));
  if (strongGroups.length) {
    const labels = strongGroups.map((g) => g.label);
    const reason = firstText(strongGroups[0], "strength");
    sentences.push(`${labels.join(" and ")} ${labels.length > 1 ? "are" : "is"} the strongest ${labels.length > 1 ? "dimensions" : "dimension"}${reason ? `: ${reason}` : "."}`);
  }

  // Limiting: dimensions with at least one real weakness. Name them and quote
  // one real diagnosis for concreteness.
  const weakGroups = groups.filter((g) => g.rows.some((r) => r.verdict === "weakness"));
  if (weakGroups.length) {
    const labels = weakGroups.map((g) => g.label);
    const reason = firstText(weakGroups[0], "weakness");
    sentences.push(`${labels.join(" and ")} ${labels.length > 1 ? "are" : "is"} holding the band back${reason ? `: ${reason}` : "."}`);
  }

  // Path to the next band, from the real weakness rows in the limiting dims.
  // Pushed BEFORE the not-assessed caveat so the task's required "what closing
  // the gap would take" survives the 4-sentence cap; the caveat is bonus
  // context that only shows when there is room for it.
  const path = fastestPathToNextBand(result, scale);
  if (!path) {
    sentences.push("All four dimensions are already at the scale's maximum, so no further action is needed to raise the band.");
  } else {
    const limitingLabels = path.dims.map((d) => EDUTRUST_DIMENSIONS.find((x) => x.key === d)!.label);
    const afiCount = groups.filter((g) => path.dims.includes(g.key)).reduce((a, g) => a + g.rows.filter((r) => r.verdict === "weakness").length, 0);
    sentences.push(afiCount > 0
      ? `Closing ${afiCount} AFI${afiCount === 1 ? "" : "s"} in ${limitingLabels.join(" and ")} would raise it to Band ${path.nextBand}.`
      : `Raising ${limitingLabels.join(" and ")} would take it to Band ${path.nextBand}.`);
  }

  // Not-assessed dimensions get an honest one-liner so the reader knows the
  // band rests on partial coverage, never a silent omission.
  const naGroups = groups.filter((g) => g.rows.length > 0 && g.rows.every((r) => r.verdict === "not-assessed"));
  if (naGroups.length) {
    const labels = naGroups.map((g) => g.label);
    sentences.push(`${labels.join(" and ")} ${labels.length > 1 ? "were" : "was"} not assessed on this run, so ${labels.length > 1 ? "those bands rest" : "that band rests"} on the band-scoring judgment rather than fresh evidence.`);
  }

  // Keep it to at most four sentences (band line + up to three of
  // strengths/limiting/path/not-assessed) so it stays a ten-second read.
  return sentences.slice(0, 4).join(" ");
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
