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
// The actionable half of the note, surfaced in the AFI column so a not-assessed
// row never shows a blank next-action (Task 4) — a reader scanning the AFI
// column sees a concrete step on every non-strength row.
const NOT_ASSESSED_AFI = "Run the staged audit or attach outcome or review evidence to assess this dimension.";

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
  // The suggested next action: the real per-line action for a WEAKNESS row (or
  // an honest "no action recorded" note when none exists), or the "run the
  // staged audit / attach evidence" step for a NOT-ASSESSED row so its AFI
  // column is never blank (Task 4). Undefined only for strength rows — nothing
  // to close.
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
        return { lineId: l.id, itemRef, verdict: "not-assessed", finding: NOT_ASSESSED_FINDING, afi: NOT_ASSESSED_AFI };
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

// A plain-English rendering of ONE dimension's assessed band — a faithful
// restatement of the band the reviewer/AI already set (the official rubric
// descriptor in words a non-technical reader gets at a glance), never a new
// judgment. band 0 = "Not evident" on the scale; bands 1-5 climb the rubric.
function plainDimensionState(key: DimensionFindingsGroup["key"], band: ApsrDimensionScore): string {
  const P: Record<DimensionFindingsGroup["key"], string[]> = {
    // index by band 0..5
    approach: ["no documented approach yet", "little organised approach", "a partially developed approach", "an established approach", "a well-developed approach", "a mature, fully embedded approach"],
    processes: ["no evidence of implementation", "little evidence of implementation", "limited evidence of implementation", "some evidence of implementation", "strong evidence of implementation", "consistent, fully deployed implementation"],
    systemsOutcomes: ["no outcome data yet", "little outcome data", "limited outcome data", "some outcome data", "clear outcome data", "strong, sustained outcome data"],
    review: ["no review activity yet", "little review activity", "limited review activity", "some review activity", "regular review activity", "systematic, embedded review"],
  };
  return P[key][band];
}

// Ten-second read above the findings table. LEADS with a plain general
// assessment of how the item is actually performing (Task 2) — a faithful
// plain-English restatement of the four per-dimension bands, carrying the
// weight of the summary — THEN, separately, the band/% and what closing the
// gap would take. No new AI call, no invented content: every phrase is a
// deterministic rendering of data already on the entry (per-dimension bands
// from matrixScores, fastestPathToNextBand's limiting-factor logic).
function buildOverallSummary(result: ApsrMatrixResult, groups: DimensionFindingsGroup[], scale: ApsrScale): string {
  const sentences: string[] = [];

  // 1) The general performance statement, first and carrying the weight:
  // the item's four dimensions described plainly, in APSR order.
  const parts = groups.map((g) => plainDimensionState(g.key, g.band));
  if (parts.length === 4) {
    sentences.push(`Overall, this area shows ${parts[0]}, with ${parts[1]}, ${parts[2]}, and ${parts[3]}.`);
  } else if (parts.length) {
    sentences.push(`Overall, this area shows ${parts.join(", ")}.`);
  }

  // 2) The band and %, noted separately after the general read.
  sentences.push(`It is banded at Band ${result.band} (${result.total}%).`);

  // 3) What closing the gap would take — the limiting dimension(s) and the
  // count of open AFIs there, from the SAME logic the Band Improvement Panel
  // uses. Skipped at Band 5 (nothing to reach).
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

  // 4) An honest note when a dimension was structurally not assessed on this
  // run, so the reader knows the band rests on partial coverage.
  const naGroups = groups.filter((g) => g.rows.length > 0 && g.rows.every((r) => r.verdict === "not-assessed"));
  if (naGroups.length) {
    const labels = naGroups.map((g) => g.label);
    sentences.push(`${labels.join(" and ")} ${labels.length > 1 ? "were" : "was"} not assessed on this run, so ${labels.length > 1 ? "those bands rest" : "that band rests"} on the band-scoring judgment rather than fresh evidence.`);
  }

  // Keep it to at most four sentences (general read + band + path + optional
  // not-assessed caveat) so it stays a ten-second read.
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
