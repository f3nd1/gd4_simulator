// "What will the full audit look at that this check does not", answered from
// real sources only.
//
// The limit is structural: this check reads a procedure folder and a records
// folder, so it can speak to Approach and Processes and to nothing else.
// Telling an auditor that and stopping leaves them with nothing to act on, so
// this assembles what the two unassessed dimensions actually need, from three
// sources that already exist in the app and nothing else:
//
//   1. The official §23 descriptors, verbatim (data/edutrustRubric.ts). These
//      ARE the answer in the document's own words, at each band.
//   2. The official expected-evidence list for the requirement, filtered to the
//      entries that literally name review. 30 of the 31 requirement items carry
//      one ("Governance review records", "Procedure review records", ...), so
//      this is a filter on shipped official data, not a mapping invented here.
//   3. What THIS run already reported missing, in its own words.
//
// Deliberately asymmetric: there is no equivalent filter for Systems &
// Outcomes. Only 9 of 31 items have an expected-evidence entry that could be
// read as outcome evidence, and the words that would catch them ("data",
// "analysis") also catch entries that are nothing of the kind. Inventing a
// dimension-to-evidence map would be fabricating an official list, so that
// dimension shows the descriptors and the run's own gaps, and says the official
// list does not itemise outcome evidence for this requirement.
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS } from "../data/edutrustRubric";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { normalizeAuditRef } from "./gd4Refs";
import type { Band } from "../types";
import type { SelfCheckRow } from "./selfCheck";

export type UnassessedDimension = {
  key: "systemsOutcomes" | "review";
  label: string;
  // The official §23 definition, verbatim.
  definition: string;
  // The plain question the dimension asks, for a reader who will not parse
  // "Desired outcome(s) derived from implementation."
  plainQuestion: string;
  // The official descriptor at each band from here up, verbatim, so "what does
  // better look like" is answered by the document rather than by this app.
  ladder: { band: Band; name: string; descriptor: string }[];
  // Official expected-evidence entries for this requirement that name this
  // dimension. Empty when the official list does not itemise it.
  officialEvidence: string[];
  // Said instead, when officialEvidence is empty.
  noOfficialList: string;
};

const PLAIN_QUESTION: Record<UnassessedDimension["key"], string> = {
  systemsOutcomes: "Are the results of this process measured and tracked, and do the numbers show it working?",
  review: "Is this process formally reviewed on a schedule, and are the improvements agreed and then actually done?",
};

const NO_OFFICIAL_LIST: Record<UnassessedDimension["key"], string> = {
  systemsOutcomes: "The official expected-evidence list for this requirement does not itemise outcome evidence, so nothing is listed here rather than guessing at it. The descriptors above are the official wording for what this dimension asks.",
  review: "The official expected-evidence list for this requirement does not itemise review evidence, so nothing is listed here rather than guessing at it.",
};

// A literal word filter on official text, not a classification. "Procedure
// review records" names review; that is the whole claim being made.
const NAMES_REVIEW = /\breview(s|ed|ing)?\b/i;

function officialEvidenceFor(key: UnassessedDimension["key"], itemIds: string[]): string[] {
  if (key !== "review") return [];
  const out = new Set<string>();
  for (const id of itemIds) {
    const req = GD4_REQUIREMENTS.find((r) => r.id === id);
    for (const e of req?.expectedEvidence ?? []) if (NAMES_REVIEW.test(e)) out.add(e);
  }
  return [...out];
}

export function unassessedDimensions(itemIds: string[]): UnassessedDimension[] {
  return (["systemsOutcomes", "review"] as const).map((key) => {
    const meta = EDUTRUST_DIMENSIONS.find((d) => d.key === key)!;
    const officialEvidence = officialEvidenceFor(key, itemIds);
    return {
      key,
      label: meta.label,
      definition: meta.definition,
      plainQuestion: PLAIN_QUESTION[key],
      ladder: EDUTRUST_BANDS.filter((b) => b.band >= 3).map((b) => ({ band: b.band, name: b.name, descriptor: b[key] })),
      officialEvidence,
      noOfficialList: officialEvidence.length > 0 ? "" : NO_OFFICIAL_LIST[key],
    };
  });
}

// What this run already said was missing, gathered in one place. Every string
// is one the page is already showing on a row; nothing new is written here.
export function runNamedGaps(rows: SelfCheckRow[]): { ref: string; requirement: string; text: string }[] {
  const out: { ref: string; requirement: string; text: string }[] = [];
  for (const r of rows) {
    if (!r.working || r.verdict === "Met" || r.verdict === "Not assessed") continue;
    for (const m of r.working.missing) out.push({ ref: r.ref, requirement: r.requirement, text: `${m.text} — ${m.why}` });
  }
  return out;
}

export const IMPROVE_HEADLINE =
  "Two of the four dimensions are not assessed here, and that is not a judgement on your area.";

export const IMPROVE_WHY =
  "Nothing on this run reached a verdict on the outcome data and review records those two are judged on. Your audit lead assesses them in the full audit, and sets the band from all four. What follows is what they will be looking for, in the Guidance Document's own words.";

// Said INSTEAD once the results-and-review pass HAS produced verdicts. The pair
// above is then untrue: this run did look, and says what it found further up.
// What is still missing is the band, which this page does not set.
export const IMPROVE_HEADLINE_CHECKED =
  "These two dimensions were checked on this run, but this page does not turn them into a band.";

export const IMPROVE_WHY_CHECKED =
  "What the check found for each is reported above: requirement by requirement for Review, and for the area as a whole for Systems & Outcomes. Your audit lead weighs that alongside everything else and sets the band from all four. What follows is the standard they will weigh it against, in the Guidance Document's own words.";

// The pattern the reported 4.1 run showed, named only when the run's own gaps
// actually show it. Not asserted from nothing.
export function reviewShapedGapNote(gaps: { text: string }[]): string {
  const hits = gaps.filter((g) => NAMES_REVIEW.test(g.text) || /\b(KPI|minutes|report|register|log|action plan|CAP)\b/i.test(g.text));
  if (hits.length === 0) return "";
  return `${hits.length} of the ${gaps.length} gaps this run named are missing records rather than missing wording: minutes, reports, registers, logs or action plans. That is the shape that holds Systems & Outcomes and Review down in the full audit, so closing them is the work that moves the band your audit lead sets, not rewording the procedure.`;
}


// ── What this run already found about Review ─────────────────────────────
//
// The one thing this check DOES produce that bears on an unassessed dimension.
//
// Measured against the shipped requirement data, not asserted: of the 200
// official Describe/Show lines, 42 name a process review, and every one of the
// 31 requirement items carries at least one. They read "Review the internal
// assessment process for continual improvement", "Review the management review
// process for continual improvement", and so on. All 42 were printed and read:
// there is not a single false positive, because the word "review" in a
// Describe/Show line always means reviewing the process itself.
//
// This check already judges those lines and already shows the verdicts in the
// table. Gathering them in one place adds no judgement: same refs, same
// verdicts, same words.
//
// What it deliberately is NOT:
//   - not a Review band, and not an input to one. Turning line verdicts into a
//     dimension verdict is what optionAChecklistWrite does, it feeds
//     buildScored, and it is scoring. Nothing here touches it.
//   - not a claim that these lines ARE the Review dimension. A line asks
//     whether one process is reviewed; the dimension asks whether the whole
//     system is evaluated, with improvement actions tracked and benchmarked.
//     The higher bands need evidence this check never opens.
//   - deliberately absent for Systems & Outcomes. Only 18 of 31 items have a
//     line an outcome-word filter catches, and the words that catch them
//     ("data", "performance") also catch "Ensure the confidentiality and
//     security of all data" and "Appraisal and performance monitoring", which
//     are processes. A filter that wrong is a fabricated list.

// Built once from the shipped official data, so the set can never drift from
// the requirement text the check is run against.
const REVIEW_LINE_REFS: Set<string> = (() => {
  const out = new Set<string>();
  for (const r of GD4_REQUIREMENTS) {
    for (const p of r.flatAuditPoints ?? []) {
      if (p.sourceType === "describeShow" && NAMES_REVIEW.test(p.text)) out.add(normalizeAuditRef(p.ref));
    }
  }
  return out;
})();

// The run's own rows for those lines, in the order the table shows them.
// Every field is one the row already carries; nothing is re-judged.
export function reviewShapedRows<T extends { ref: string }>(rows: T[]): T[] {
  return rows.filter((r) => REVIEW_LINE_REFS.has(normalizeAuditRef(r.ref)));
}

export const REVIEW_FINDINGS_HEADING = "What this run already found about Review";

export const REVIEW_FINDINGS_INTRO =
  "These requirement lines are the official GD4 wording asking whether a process is reviewed for continual improvement, and this check has already judged them. They are repeated here, unchanged, because they are the one part of Review this check can speak to at all. They are not a Review score and do not add up to one: your audit lead weighs them alongside the outcome and improvement evidence this check never opens, and sets the band.";

export const REVIEW_FINDINGS_NONE =
  "This area's review lines were not among the ones this run judged, so there is nothing to repeat here.";
