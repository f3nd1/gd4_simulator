// Builds the read-only Final Report: overall + per-criterion + per-item
// banding, a findings table of real per-line strengths/weaknesses with AFIs,
// and the findings register with closure (root cause / corrective action)
// detail.
import type { Scored } from "./scoring";
import { getBand } from "./scoring";
import type { SubCriterionChecklistEntry, Finding, SpecificChecklistLine, ApsrDimensionScore, Band } from "../types";
import {
  lineSufficiency, lineCompleteness, needsReassessment, apsrMatrixResult, bandToScore, fastestPathToNextBand,
  lineDimensionDiagnosis, lineSuggestedAction, lineApsr, resolveLineDimension, classifyApsrByContent, DEFAULT_APSR_SCALE, type LineCompleteness, type ApsrScale, type ApsrMatrixResult,
} from "./checklistBanding";
import { EDUTRUST_DIMENSIONS, bandLevel } from "../data/edutrustRubric";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";
import { isOptionANotAssessedNote } from "./optionAChecklistWrite";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "./../data/gd4Requirements";

// House-style restatement of the Option A not-assessed note for the report,
// no em dash. Detection uses the raw sentinel (isOptionANotAssessedNote); the
// displayed text is this clean version, saying the same thing.
export const NOT_ASSESSED_FINDING = "Not assessed by Option A (PPD and Evidence). Run the staged audit or attach outcome or review evidence to assess this dimension.";
// The actionable half of the note, surfaced in the AFI column so a not-assessed
// row never shows a blank next-action (Task 4) — a reader scanning the AFI
// column sees a concrete step on every non-strength row.
export const NOT_ASSESSED_AFI = "Run the staged audit or attach outcome or review evidence to assess this dimension.";
// The AFI for a STRENGTH row: a next-band-specific line that quotes the
// official rubric descriptor for the band ABOVE this dimension's current band,
// verbatim from EDUTRUST_BANDS (the single source of truth). Gated on the
// dimension's OWN band (dimBand), not the item's overall band, because "next
// band up" is inherently per-dimension. Returns undefined at Band 5, where
// there is no higher rung to cite (do not invent an above-excellent line).
// Only the surrounding frame is templated; the quoted descriptor is never
// paraphrased. No AI call, no fabrication (see docs/afi-improvement-investigation.md).
function strengthNextBandAfi(key: DimensionFindingsGroup["key"], dimLabel: string, dimBand: ApsrDimensionScore): string | undefined {
  // Only 1-4 yield a meaningful "next band": 5 has no higher rung, and 0
  // ("Not evident") has no coherent "Band 0 strength" line to build.
  if (dimBand < 1 || dimBand >= 5) return undefined;
  const next = (dimBand + 1) as Band;
  const descriptor = bandLevel(next)[key];
  return `Band ${dimBand} strength. To reach Band ${next} on ${dimLabel}, the EduTrust rubric looks for: "${descriptor}". Keep this evidenced and build toward that at the next review cycle.`;
}

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
  // The real per-line text for this dimension, IN FULL — the evidence
  // summary for a strength, the diagnosis for a weakness, or the honest
  // "not assessed" explanation for a not-assessed row. Never truncated
  // (R3/INV-05) and never carries a "Weakness —" prefix: the verdict drives
  // the label/colour in the UI.
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
  // How many of this ITEM's official GD4 audit points classify to this
  // dimension (same classifier the line grouping uses). Lets the UI's
  // empty-group placeholder distinguish "the official rubric defines no
  // line of this type for this item" (0 — the band is still a real holistic
  // judgement, see docs/dimension-band-without-lines-investigation.md) from
  // "official lines of this type exist but none is drafted/tagged yet"
  // (>0 — drafting guidance applies). Display data only, never a score input.
  rubricDefined: number;
  // True when `rows` was built from the item's OTHER lines' apsr[key] legs
  // because no line groups under this dimension (Bug B fix, 2026-07-17): the
  // assessment genuinely exists (e.g. the Outcomes & Review pass wrote it),
  // it just has no same-dimension requirement line to hang on. The UI shows a
  // lead-in explaining why other lines' refs appear here. False/absent for
  // normally-grouped rows.
  rowsFromLegs?: boolean;
  // Empty when no line is tagged to this dimension AND no real leg content
  // exists for it — the UI shows an honest placeholder row, never a
  // fabricated finding.
  rows: ItemFindingRow[];
};

// Trims real AI-authored text to ONE sentence, without inventing wording.
// Used ONLY for inline embedding (the overall summary's "for example, …"
// clause) — findings-table rows show the FULL recorded text, untruncated
// (R3/INV-05: the old first-"." split cut real text mid-token at the "."
// inside "e.g."/"i.e.", producing rows ending "(e."). The boundary scan
// below skips those abbreviations, and only a punctuation mark followed by
// whitespace (or end of text) counts as a sentence end.
export function firstSentence(text: string, cap = 220): string {
  const trimmed = text.trim();
  const boundary = /[.!?](?:\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(trimmed))) {
    const candidate = trimmed.slice(0, m.index + 1);
    if (/\b(?:e\.g|i\.e|etc|vs|cf|approx)\.$/i.test(candidate)) continue;
    return candidate.trim();
  }
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

// The nature of a finding's gap, derived ONLY from data the finding already
// carries — never a new schema field (docs/report-issues-investigation.md,
// Issue 2). Option A fuses the PPD (policy) verdict into the Approach APSR
// leg and the evidence verdict into the Processes leg, so the failing leg IS
// the policy-vs-evidence distinction. Rule, in priority order:
//   1. source "PPD Review" (the internal-contradiction findings) → Policy.
//   2. APSR present: Approach failing alone → Policy; Processes failing
//      alone → Evidence; BOTH failing → "Policy + evidence gap" (picking one
//      would hide the other).
//   3. Otherwise fall back to the finding's dimension tag: Procedure →
//      Policy, Evidence/Unverified → Evidence, Outcomes/Review → their own
//      honest labels (neither policy nor implementation evidence).
//   4. No signal at all → undefined, no pill — never guessed.
export function findingGapNature(f: Finding): string | undefined {
  if (f.source === "PPD Review") return "Policy gap (PPD)";
  const a = f.apsr;
  if (a) {
    const approachFails = a.approach.status !== "Meeting";
    const processesFails = a.processes.status !== "Deployed";
    if (approachFails && processesFails) return "Policy + evidence gap";
    if (approachFails) return "Policy gap (PPD)";
    if (processesFails) return "Evidence gap";
  }
  switch (f.dimension) {
    case "Procedure": return "Policy gap (PPD)";
    case "Evidence":
    case "Unverified": return "Evidence gap";
    case "Outcomes": return "Outcome gap";
    case "Review": return "Review gap";
  }
  return undefined;
}

export type FindingReport = {
  id: string;
  // The raw GD4 item id (e.g. "6.2.1"), used to fold each finding into its
  // matching item card on the Final Report. itemId below is the display form
  // ("6.2.1 Management Review").
  gd4ItemId: string;
  itemId: string;
  issue: string;
  severity: string;
  type: string;
  status: string;
  closed: boolean;
  // See findingGapNature above — undefined when the finding carries no signal.
  gapNature?: string;
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
  // How many OFFICIAL audit points of each dimension this item has — the same
  // classifier the line grouping uses (REF_DIMENSION is built from it), so
  // the empty-group placeholder can tell "the rubric defines no such line"
  // apart from "lines exist but none is drafted/tagged". Display only.
  const officialPoints = GD4_REQUIREMENTS.find((r) => r.id === entry?.gd4ItemId)?.flatAuditPoints ?? [];
  const out: DimensionFindingsGroup[] = [];
  for (const key of APSR_DIM_KEYS) {
    const score = hb.matrixScores[key];
    if (score === undefined) continue;
    const label = EDUTRUST_DIMENSIONS.find((d) => d.key === key)!.label;
    const rubricDefined = officialPoints.filter((fp) => classifyApsrByContent(fp.text) === label).length;
    // Group by the line's AUTHORITATIVE dimension (resolved from its official
    // source ref), NOT its stored apsrDimension — so a line the Option A audit
    // wrote with a ref but no tag, or one the live-gen AI mis-tagged, still
    // lands under the correct dimension (Task 3 fix, 2026-07-15). Grouping only;
    // no band/verdict/score is affected.
    const dimLines = specific.filter((l) => resolveLineDimension(l) === label && l.status !== "Not Applicable");
    const buildRow = (l: SpecificChecklistLine, fromLeg: boolean): ItemFindingRow => {
      const itemRef = l.clause || l.sourceRef || l.id;
      const text = lineDimensionDiagnosis(l, key);
      // A dimension Option A structurally never assessed (its per-line note is
      // the not-assessed sentinel) is NEITHER a strength nor a weakness — no
      // data exists to judge it. Detect it first, before any status test, so
      // an unassessed dimension is never mislabelled a finding just because
      // the line's overall status is Not met/Partial.
      if (isOptionANotAssessedNote(text)) {
        return { lineId: l.id, itemRef, verdict: "not-assessed", finding: NOT_ASSESSED_FINDING, afi: NOT_ASSESSED_AFI };
      }
      // The row's verdict comes from the SAME dimension leg its text comes
      // from (Bug A / R4 / INV-06 fix, 2026-07-17): a positive leg status can
      // never render as a Weakness and a negative one never as a Strength, so
      // label and text always agree. Middle values (Beginning/Weak/Limited)
      // are genuinely ambiguous — exactly the set R4 deliberately never flags
      // — so they, and lines with no APSR at all, fall back to the line-level
      // rule this replaced.
      const legStatus = lineApsr(l)?.[key]?.status;
      const isWeakness =
        legStatus === "Meeting" || legStatus === "Deployed" || legStatus === "Evident" ? false :
        legStatus === "Not evident" ? true :
        l.status !== "Met" || lineSufficiency(l) !== "Present";
      // Finding/AFI text is the user's real recorded diagnosis and action —
      // shown IN FULL, never sentence-truncated (R3/INV-05: truncation cut
      // rows off mid-token at "e.g."). Only the overall summary's inline
      // example still trims to one sentence, via the fixed firstSentence.
      if (isWeakness) {
        const action = lineSuggestedAction(l);
        return {
          lineId: l.id, itemRef, verdict: "weakness",
          finding: text || "No detailed diagnosis recorded for this line.",
          // A leg-derived row's stored action belongs to the line's own
          // evidence pass and may not be about THIS dimension — show it only
          // when it exists, never the generic filler.
          afi: action || (fromLeg ? undefined : "No concrete suggested action recorded for this line."),
        };
      }
      // A strength gets a next-band-specific AFI quoting the rubric descriptor
      // for the band above THIS dimension's current band (score), or blank when
      // the dimension is already at Band 5. Gated per-dimension, not on the
      // item's overall band.
      return {
        lineId: l.id, itemRef, verdict: "strength",
        finding: text || "No evidence summary recorded for this line.",
        afi: strengthNextBandAfi(key, label, score),
      };
    };
    let rows: ItemFindingRow[] = dimLines.map((l) => buildRow(l, false));
    // Bug B fix: a scored dimension with NO grouped lines can still carry a
    // real recorded assessment on the item's OTHER lines' apsr[key] legs
    // (e.g. the Outcomes & Review pass wrote Systems & Outcomes / Review
    // judgements onto every line). Surface that verbatim leg content,
    // attributed to the lines it came from, instead of only a placeholder.
    // A leg qualifies only with a real non-sentinel note — a dimension with
    // no such content anywhere keeps the honest empty-group placeholder.
    let rowsFromLegs = false;
    if (rows.length === 0) {
      const legLines = specific.filter((l) => {
        if (l.status === "Not Applicable") return false;
        const note = lineDimensionDiagnosis(l, key);
        return !!note && !isOptionANotAssessedNote(note);
      });
      if (legLines.length > 0) {
        rows = legLines.map((l) => buildRow(l, true));
        rowsFromLegs = true;
      }
    }
    out.push({ key, label, band: score, pct: result.pcts[key], rubricDefined, rowsFromLegs, rows });
  }
  return out;
}

// Per-dimension English used by the overall summary. Each dimension has a
// plain "face": a strong clause, a weak clause, a short noun, and a concrete
// verb-led action. Chosen so several can be joined and still read naturally.
const DIM_FACE: Record<DimensionFindingsGroup["key"], { noun: string; strong: string; weak: string; act: string }> = {
  approach: {
    noun: "the approach",
    strong: "the approach is clearly documented",
    weak: "the approach itself is barely documented",
    act: "document the approach for this area and get it formally approved",
  },
  processes: {
    noun: "how it is carried out",
    strong: "there is solid evidence it is being carried out",
    weak: "there is little to show these plans are actually being carried out",
    act: "produce records that show these plans are actually being acted on",
  },
  systemsOutcomes: {
    noun: "outcome measurement",
    strong: "outcomes are being measured",
    weak: "its results are not being measured",
    act: "start capturing outcome or results data that shows the impact",
  },
  review: {
    noun: "the review process",
    strong: "it is being reviewed for effectiveness",
    weak: "nothing shows it is reviewed for effectiveness afterwards",
    act: "put a review in place that evaluates effectiveness and feeds improvements back in",
  },
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// The ten-second read above the findings table. ANALYTICAL, not descriptive
// (Task 1, 2026-07-15): it diagnoses the PATTERN behind the gaps — where the
// item is strong versus where it falls off — then states the SINGLE
// highest-priority action, and deliberately never repeats the band number or
// percentage (both already shown in the panel header just above it). Every
// clause is a deterministic reading of data already on the entry (per-dimension
// bands from matrixScores, the limiting dimension from fastestPathToNextBand,
// and the real per-line weakness text for the priority dimension). No new AI
// call, no invented content.
function buildOverallSummary(result: ApsrMatrixResult, groups: DimensionFindingsGroup[], scale: ApsrScale): string {
  if (groups.length === 0) return "";
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g])) as Record<DimensionFindingsGroup["key"], DimensionFindingsGroup>;
  const keys = groups.map((g) => g.key);
  const bandOf = (k: DimensionFindingsGroup["key"]) => byKey[k]?.band ?? 0;
  const joinFaces = (ks: DimensionFindingsGroup["key"][], which: "strong" | "weak") => {
    const parts = ks.map((k) => DIM_FACE[k][which]);
    return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  };

  // ── 1) Diagnose the pattern (strong >=4, weak/absent <=2). ──
  const strongKeys = keys.filter((k) => bandOf(k) >= 4);
  const weakKeys = keys.filter((k) => bandOf(k) <= 2);
  let diagnosis: string;
  if (weakKeys.length === 0) {
    diagnosis = strongKeys.length === keys.length
      ? "Every dimension holds up here — the approach is documented, carried out, measured and reviewed."
      : "This area is reasonably solid across the board, with no single dimension clearly dragging it down.";
  } else {
    const strongPhrase = strongKeys.length
      ? cap(joinFaces(strongKeys, "strong"))
      : `${cap(DIM_FACE[keys.reduce((a, b) => (bandOf(b) > bandOf(a) ? b : a))].noun)} is the most developed part`;
    diagnosis = `${strongPhrase}, but ${joinFaces(weakKeys, "weak")}.`;
  }

  // ── 2) The single highest-priority action (the lowest-scoring dimension is
  // the highest-leverage one to raise — same logic as the Band Improvement
  // Panel). A dimension Option A never assessed needs assessing, not fixing. ──
  const path = fastestPathToNextBand(result, scale);
  let action: string;
  if (!path) {
    action = "Every dimension is already at the top of the scale — keep re-evidencing it at each review cycle so it stays there.";
  } else {
    const dim = path.dims[0];
    const g = byKey[dim];
    const allNotAssessed = g && g.rows.length > 0 && g.rows.every((r) => r.verdict === "not-assessed");
    if (allNotAssessed) {
      action = `The single highest-priority step is to get ${DIM_FACE[dim].noun} assessed at all — run the staged audit or attach ${dim === "review" ? "review" : "outcome"} evidence.`;
    } else {
      // Ground the action in a REAL per-line weakness reason when one exists —
      // never the "No detailed diagnosis recorded" placeholder fallback (that
      // would read as invented filler). Rows now carry the FULL diagnosis, so
      // trim to its first sentence here for the inline example clause only.
      const reason = g?.rows.find((r) => r.verdict === "weakness" && !/^No (detailed diagnosis|concrete|evidence)/i.test(r.finding))?.finding;
      action = `The single highest-priority step is to ${DIM_FACE[dim].act}${reason ? ` — for example, ${lowerFirst(firstSentence(reason).replace(/\.$/, ""))}.` : "."}`;
    }
  }

  return `${diagnosis} ${action}`;
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

// Splits a multi-entry evidence note (the staged pass's merged
// "#1 [file · chunk]:\n… \n\n#2 […]" format, see agentRuntime's
// renderWindowNotes) into its numbered entries; any other text comes back as
// a single entry. Lets the report show the first entry by default with the
// rest behind an expand — the full text is never deleted, just not all shown
// at once (Item 1, 2026-07-17).
export function splitEvidenceNote(note: string): string[] {
  const parts = note.split(/\n\n(?=#\d+\b)/);
  return parts.length > 1 ? parts : [note];
}

// ── Item 2 (2026-07-17): concise auditor-voice summaries for long finding
// text. Pure helpers; the AI call lives in FinalReport.tsx on the same
// generate-once-and-save plumbing as the improvement suggestions. Summaries
// are stored ALONGSIDE the raw text (useWorkspaceStore.reportConciseFindings,
// keyed per row) — the raw text always stays reachable behind the expand. ──

export function conciseKey(itemId: string, dimKey: DimensionFindingsGroup["key"], lineId: string): string {
  return `${itemId}::${dimKey}::${lineId}`;
}

// Which row texts qualify for a concise summary: anything over the length
// threshold, or any multi-entry numbered evidence merge (even a short one
// reads as a citation dump). Not-assessed rows never qualify — there is no
// assessment to summarise, and the honest note must stay verbatim. Genuine
// 2-3 sentence diagnoses stay as they are.
export const CONCISE_THRESHOLD = 400;
export function needsConciseSummary(finding: string, verdict: FindingVerdict): boolean {
  if (verdict === "not-assessed") return false;
  return finding.length > CONCISE_THRESHOLD || splitEvidenceNote(finding).length > 1;
}

export type ConciseRowRef = {
  key: string;
  dimKey: DimensionFindingsGroup["key"];
  dimLabel: string;
  lineId: string;
  itemRef: string;
  verdict: FindingVerdict;
  text: string;
};

export function qualifyingConciseRows(it: ItemReport): ConciseRowRef[] {
  const out: ConciseRowRef[] = [];
  for (const g of it.findingsGroups) {
    for (const r of g.rows) {
      if (!needsConciseSummary(r.finding, r.verdict)) continue;
      out.push({ key: conciseKey(it.id, g.key, r.lineId), dimKey: g.key, dimLabel: g.label, lineId: r.lineId, itemRef: r.itemRef, verdict: r.verdict, text: r.finding });
    }
  }
  return out;
}

// The grounding block: each qualifying row's key, dimension, verdict and
// FULL raw text — the model may only reference facts already in that text.
export function buildConciseUserPrompt(it: ItemReport): string {
  const rows = qualifyingConciseRows(it).map((q) =>
    `Row key "${q.key}" — ${q.dimLabel}, ${q.verdict}, requirement line ${q.itemRef}.\nRaw assessment text:\n"""\n${q.text}\n"""`
  );
  return `Item ${it.id} ${it.title} — overall Band ${it.band}.\n\n${rows.join("\n\n")}`;
}

// The honesty filter on the reply: only REQUESTED row keys survive, and only
// as non-empty strings — the model can never attach a summary to a row that
// was not asked about (e.g. a not-assessed row).
export function filterConciseSummaries(raw: unknown, it: ItemReport): Record<string, string> {
  const wanted = new Set(qualifyingConciseRows(it).map((q) => q.key));
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() && wanted.has(k)) out[k] = v.trim();
    }
  }
  return out;
}

// ── Item 3: AI improvement suggestions (pure helpers; the AI call itself
// lives in FinalReport.tsx, reusing the generateSummary plumbing) ──────────
// A dimension is ELIGIBLE for a suggestion only when it has at least one
// genuinely assessed row: all-not-assessed and empty dimensions keep their
// honest notes and never get a fabricated suggestion.
export function eligibleSuggestionDims(groups: DimensionFindingsGroup[]): DimensionFindingsGroup[] {
  return groups.filter((g) => g.rows.length > 0 && g.rows.some((r) => r.verdict !== "not-assessed"));
}

// Storage key in useWorkspaceStore.reportAiSuggestions.
export function suggestionKey(itemId: string, dimKey: DimensionFindingsGroup["key"]): string {
  return `${itemId}::${dimKey}`;
}

// The grounding block the AI sees — ONLY real stored data: each eligible
// dimension's band/%, the verbatim next-band rubric descriptor as the
// target, and every assessed row's ref, verdict and FULL recorded text.
// Not-assessed rows and ineligible dimensions never appear, so the model
// has nothing unassessed to speculate about.
export function buildAiSuggestionUserPrompt(it: ItemReport): string {
  const dims = eligibleSuggestionDims(it.findingsGroups).map((g) => {
    const next = g.band >= 1 && g.band < 5 ? ((g.band + 1) as Band) : undefined;
    const target = next
      ? `Target (verbatim EduTrust Band ${next} descriptor for this dimension): "${bandLevel(next)[g.key]}"`
      : `This dimension is already at Band ${g.band} — suggest how to keep it evidenced, not how to climb.`;
    const rows = g.rows
      .filter((r) => r.verdict !== "not-assessed")
      .map((r) => `  - [${r.itemRef}] ${r.verdict === "strength" ? "Strength" : "Weakness"}: ${r.finding}${r.verdict === "weakness" && r.afi ? ` | Recorded action: ${r.afi}` : ""}`)
      .join("\n");
    return `${g.label} (JSON key "${g.key}") — current Band ${g.band} (${g.pct}%).\n${target}\nAssessed findings:\n${rows}`;
  });
  return `Item ${it.id} ${it.title} — overall Band ${it.band}.\n\n${dims.join("\n\n")}`;
}

// The honesty filter on the AI's reply: keeps ONLY non-empty string
// suggestions for eligible dimensions — the model can never attach a
// suggestion to a not-assessed or empty dimension, whatever it returns.
export function filterAiSuggestions(
  raw: unknown,
  groups: DimensionFindingsGroup[]
): Partial<Record<DimensionFindingsGroup["key"], string>> {
  const eligible = new Set(eligibleSuggestionDims(groups).map((g) => g.key));
  const out: Partial<Record<DimensionFindingsGroup["key"], string>> = {};
  if (raw && typeof raw === "object") {
    for (const key of APSR_DIM_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim() && eligible.has(key)) out[key] = v.trim();
    }
  }
  return out;
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
      gd4ItemId: f.gd4ItemId,
      itemId: f.gd4ItemId + (reqTitle ? ` ${reqTitle}` : ""),
      issue: f.issue,
      // Resolved NC/OFI/OBS classification (which applyPanelConclusion updates),
      // not the raw legacy fields — the report must agree with the Findings
      // register and Export Centre, both of which already resolve.
      severity: resolveNcSeverity(f) ?? f.severity,
      type: resolveFindingType(f),
      status: f.status,
      closed: (c.human || "") === "Accepted",
      gapNature: findingGapNature(f),
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
