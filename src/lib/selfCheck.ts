// Self-check for a process owner — the pure half.
//
// Audience: one person who owns one functional area, is not an auditor, will
// never run a full audit, and opens this once a year. Everything here exists to
// turn the audit engine's own output into words that person already uses. It
// invents nothing: every verdict, reason and suggested fix is copied from the
// row the existing Option A engine produced.
//
// It computes no score of its own. The band is read from what the existing
// holistic banding produced; this module never derives one.

import { toCsv } from "./auditCsvExport";
import { buildStamp } from "./buildInfo";
import { escapeHtml } from "./printableDoc";
import { unjudgedBothSides } from "./unjudgedRows";
import { ROWS_DO_NOT_SUM_NOTE, dimensionsNote, selfCheckTotal, selfCheckTotalWorking, bandName, INFERRED_THRESHOLDS_NOTE, BAND_LADDER, bandGraphic, bandGraphicSvg, tallyBarSvg, tallyHeadline, PROCEDURE_FEEDS, RECORDS_FEEDS, PRINT_BAND_PALETTE, type BandWorking, type TabFeeds, type TallySlice } from "./selfCheckBanding";
import { unassessedDimensions, runNamedGaps, reviewShapedGapNote, reviewShapedRows, IMPROVE_HEADLINE, IMPROVE_WHY, REVIEW_FINDINGS_HEADING, REVIEW_FINDINGS_INTRO, REVIEW_FINDINGS_NONE } from "./selfCheckImprove";
import { buildWorking, expectedEvidenceFor, unreadableWarning, countFileRows, qualifyForUnreadable, splitTrailingQuotes, mergeQuotes, fileCheckMark, SAME_LINK_WARNING, type SelfCheckWorking, type SelfCheckFileRow } from "./selfCheckEvidence";
import type { EvidenceAssessmentRow, EvidenceVerdict, PPDReviewRow, PPDVerdict, Band } from "../types";

// The disclaimer the rest of the app carries, repeated verbatim in every
// surface this page produces, including both downloads.
export const SELF_CHECK_DISCLAIMER =
  "Internal practice check only. AI-assessed, never a final result, and not an official SSG or EduTrust outcome.";

// The four states the engine can return for a requirement line, in the words a
// process owner uses. The mapping is deliberately NOT a collapse to
// comply/not-comply: "Partial" is a real, different answer, and flattening it
// into a fail would misreport the engine. "Not assessed" is not a fail at all
// and never carries a fail colour.
// `icon` is carried beside `tone` so a state is never signalled by colour
// alone: the glyph reads in the table, in a print-out and for anyone who
// cannot separate the greens from the reds.
//
// Glyphs are restricted to ones that actually render in the print-to-tab PDF.
// A half-filled circle (U+25D0) looked right on screen and came out of the
// printer as a stray chevron, which is worse than no glyph at all.
export type PlainVerdict = { label: string; tone: string; isGap: boolean; icon: string };

// One line per state, shown ABOVE the table it applies to. An auditor could not
// tell whether "Written down" meant compliant, and the answer is that it does
// not: the two tabs each answer half the question, and only the overall view
// puts them together.
export type VerdictLegendLine = { icon: string; label: string; meaning: string };

export const PLAIN_VERDICT: Record<EvidenceVerdict, PlainVerdict> = {
  Met: { label: "Complies", tone: "good", isGap: false, icon: "✓" },
  Partial: { label: "Partly complies", tone: "medium", isGap: true, icon: "!" },
  "Not met": { label: "Does not comply", tone: "critical", isGap: true, icon: "✗" },
  // Neutral tone on purpose. Grey, never red: the documents did not say either
  // way, which is a gap in what was supplied, not a judgement on the area.
  "Not assessed": { label: "Could not check", tone: "neutral", isGap: false, icon: "?" },
};

// Two genuinely different things put a line here, and the note has to cover
// both or it misleads: either the documents did not speak to the requirement,
// or the tool could not confirm what it found well enough to judge. Neither is
// a fail, and the second is not the reader's fault at all.
export const COULD_NOT_CHECK_NOTE =
  '"Could not check" is not a fail. Either the documents in your folder did not say either way, or the tool could not confirm what it found. Each row below says which, and what to do about it.';

// The engine writes its own reason for an unjudged line, in its own words:
// "the extraction pass returned 1 candidate passage ... none could be verified
// as verbatim ... OCR/vision artifacts ... extraction defect". That is written
// for whoever maintains the engine, and it is unreadable for a process owner.
// These translate the real strings the engine produces, one for one. Nothing
// is softened: an unjudged line still says it was not judged, and still says
// whether the next move is theirs or the tool's.
const WHY_TRANSLATIONS: { match: RegExp; plain: string }[] = [
  {
    match: /run was stopped before/i,
    plain: "The check was stopped before it reached this one, so nothing was judged. Run the check again to include it.",
  },
  {
    match: /AI call.*(failed|timed out)|failed or timed out/i,
    plain: "The checking service did not answer for this one, so nothing was judged. Run the check again.",
  },
  {
    match: /extraction pass returned|none could be verified|extraction defect/i,
    plain: "The tool found something that may be relevant but could not match it word for word in your documents, so it did not judge this one. That is a limit of the tool, not a problem with your area. Run the check again, and tell your audit lead if it keeps happening.",
  },
  {
    match: /verdict.*and its own comment|disagreed/i,
    plain: "The check contradicted itself on this one, so no result was recorded. Run the check again.",
  },
];

// The engine's deterministic zero-extraction comment for the EVIDENCE pass
// opens "It was not evident that the PEI had implemented this requirement...",
// so the "Not assessed" gate below never saw it and the raw string reached the
// page: "the extraction pass read every provided evidence document and returned
// no candidate passage for this line (0 extracted). PPD verdict was ...".
// Matched on its own wording, and the trailing PPD verdict is dropped because
// it belongs in the procedure view, not appended to a records sentence.
const ZERO_EXTRACTION_EVIDENCE = /extraction pass read every provided evidence document|returned no candidate passage for this line/i;

export function plainWhy(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (ZERO_EXTRACTION_EVIDENCE.test(t)) {
    return "Nothing in your records spoke to this requirement. Every document in your records folder was read, and none of them mentioned it.";
  }
  if (!/^Not assessed/i.test(t)) return t;
  for (const { match, plain } of WHY_TRANSLATIONS) if (match.test(t)) return plain;
  // An unrecognised "Not assessed" reason: say the honest minimum rather than
  // showing engine wording, and never imply a fail.
  return "This one could not be judged from the documents in your folder. It is not a fail. Add the document you think covers it and run the check again.";
}

// The engine's own progress line is written for whoever is debugging it:
// "PPD contradiction hunt — window 1/1", "Verifying citations…". Those mean
// nothing to a process owner and read as though something has gone wrong. Only
// the lines that name a real document are shown; for everything else the four
// step labels carry the progress on their own. Allow-list, not a block-list, so
// a new engine phase stays hidden by default rather than leaking on the day it
// is added.
export function plainDetail(raw: string): string {
  const t = raw.trim();
  return /^(Reading|Re-reading) /.test(t) ? t : "";
}

// ── Procedure-only checks ────────────────────────────────────────────────
//
// Two separate folders are asked for because the engine treats them very
// differently, and the difference is invisible from outside:
//
//   * The procedure pass lists folder.policyLink and keeps EVERY file in it
//     only when policyLink itself parses; otherwise it filters by the FIRST
//     path segment against /polic|procedure/ (driveGuard.ts:89-92). In a flat
//     folder that segment is the filename, so bucketing silently becomes a
//     filename guess.
//   * Each pass also falls back to the OTHER field's link when its own is
//     empty (useWorkspaceStore.ts:1525 and 2025). So leaving the evidence
//     field blank does not mean "no evidence" — it means "read the procedure
//     folder as if it were the records", which produces confident, wrong
//     verdicts.
//   * And with genuinely no evidence documents, the evidence pass returns a
//     deterministic "Not met" on EVERY line (agentRuntime.ts:3468-3475). A
//     process owner who supplied only a procedure would be told their whole
//     area fails.
//
// So a procedure-only check runs the procedure pass ALONE and answers a
// different question, in different words, with no band. "Written down" can
// never be misread as "Complies".
// "Written down" did not read as a verdict: an auditor could not tell from it
// whether the requirement was satisfied. "Documented" is the word the GD4
// vocabulary already uses for this judgement, and the legend below says in one
// line what it does and does not settle.
export const PPD_PLAIN_VERDICT: Record<PPDVerdict, PlainVerdict> = {
  Adequate: { label: "Documented", tone: "good", isGap: false, icon: "✓" },
  Partial: { label: "Partly documented", tone: "medium", isGap: true, icon: "!" },
  "Not documented": { label: "Not documented", tone: "critical", isGap: true, icon: "✗" },
  "Not assessed": { label: "Could not check", tone: "neutral", isGap: false, icon: "?" },
};

// What each combination of the two fields will and will not check. Shown
// BEFORE the run, so nobody presses the button expecting the other half.
export type CheckPlan =
  | { kind: "none"; canRun: false; note: "" }
  | { kind: "evidence-only"; canRun: false; note: string }
  | { kind: "procedure-only"; canRun: true; button: string; note: string }
  | { kind: "full"; canRun: true; button: string; note: string };

export function planFor(hasProcedure: boolean, hasEvidence: boolean): CheckPlan {
  if (hasProcedure && hasEvidence) {
    return {
      kind: "full", canRun: true, button: "Check my area",
      note: "I will read your written procedure, then check your records against it.",
    };
  }
  if (hasProcedure) {
    return {
      kind: "procedure-only", canRun: true, button: "Check my written procedure",
      note: "I will check whether your written procedure covers what it has to. I will NOT check whether it actually happens, because that needs your records. Add your records folder above for the full check.",
    };
  }
  if (hasEvidence) {
    // Not a policy choice: without a procedure the engine has nothing to check
    // the records against and stops with "No Policy & Procedure files found"
    // (useWorkspaceStore.ts:1551). Better to say that than to start and fail.
    return {
      kind: "evidence-only", canRun: false,
      note: "I need your written procedure as well. Everything is checked against what your procedure says it will do, so on its own there is nothing to check your records against.",
    };
  }
  return { kind: "none", canRun: false, note: "" };
}

// Shown above a procedure-only result, so the missing half is never a silence.
export const PROCEDURE_ONLY_NOTE =
  "This checked your written procedure only. It does not say whether any of it actually happens, and it is not a band. Add your records folder and run it again for the full check.";

// The engine now returns "Not assessed" for a line neither pass judged, and the
// stored runs that predate that fix are migrated on load (unjudgedRows.ts).
// This display guard stays as the last line of defence, because two paths can
// still deliver such a row: a `derivedFromAudit` result reused from the staged
// audit (which never went through the Option A branch), and a workspace
// restored from an export made before the fix.
export { unjudgedBothSides } from "./unjudgedRows";

// The engine's own comment for this row explains the records half only, which
// on its own reads as a definite finding ("nothing spoke to this") sitting
// under a verdict that says nothing could be decided. Both halves are named.
export const UNJUDGED_BOTH_SIDES_WHY =
  "Neither half of this check could be judged. The check could not tell whether your written procedure covers this, and nothing in your records spoke to it either. It is not a fail: see the two tabs for each half.";

export type SelfCheckRow = {
  ref: string;
  requirement: string;
  verdict: EvidenceVerdict;
  label: string;
  tone: string;
  // Never colour alone: the glyph travels with the row into the table and the
  // printable page.
  icon: string;
  // One sentence, ENGINE-PRODUCED, never a truncation of `why`. Present only
  // where the engine genuinely writes a short form of its own:
  //
  //   procedure tab — PPDReviewRow.shortComment, which the prompt makes
  //     "MANDATORY for every verdict, never blank — one sentence stating WHY"
  //     (agentRuntime.ts:2557). It was being used only as a fallback for
  //     fullComment and otherwise thrown away.
  //   overall / records tabs — EvidenceAssessmentRow.evidenceSummary, "1-2
  //     sentences on what implementation evidence the passages show"
  //     (agentRuntime.ts:3157). That is a summary of the EVIDENCE, not of the
  //     verdict, so it is labelled "What was found" and never "why".
  //
  // Empty where no such field exists. Nothing is ever cut mid-thought to make
  // one: a half sentence an auditor has to defend is worse than no sentence.
  summary: string;
  // What `summary` actually summarises, so the label above it can be honest
  // rather than one word covering two different things.
  summaryKind: "verdictReason" | "whatWasFound" | "none";
  // The reasoning prose, with any TRAILING verbatim excerpt lifted out into
  // `working.citations`. The judge prompts require that excerpt in the prose
  // AND as its own field, so it used to print twice.
  why: string;
  // The engine's own "[Capped at …]" block, verbatim. Its own content type: it
  // says why the verdict could not be higher, which nothing else on the row
  // does, and it is machine-written rather than model prose. Empty when the
  // line was not capped.
  cappedNote: string;
  fix: string;
  // The working an auditor has to show to defend the verdict: what was looked
  // for, what was quoted, which named element is missing, and why nothing could
  // be decided. Absent on rows built without the run context.
  working?: SelfCheckWorking;
  // The official GD4 expected-evidence list for this requirement item, verbatim.
  // Empty when the shipped data has none; never generated.
  expected?: string[];
};

// The run context the working is read from. Optional everywhere, because a row
// list is still meaningful without it and old callers must keep working.
export type SelfCheckContext = {
  ppdRows?: PPDReviewRow[];
  // The two passes number their chunks INDEPENDENTLY, each from C001
  // (useWorkspaceStore.ts:1559 and 2065), and each keeps its own
  // chunkFileNames map. Merging them is therefore not a widening, it is a
  // COLLISION: the later map silently wins every shared id. That is exactly
  // what happened: every quote on the procedure tab was attributed to an
  // applicant's spreadsheet, because the evidence run's C001 overwrote the
  // procedure run's C001. One map per pass, never merged.
  policyChunkFileNames?: Record<string, string>;
  evidenceChunkFileNames?: Record<string, string>;
  // How many files the run could not read. A gap reported alongside an unread
  // file is not a clean gap, and the row has to say so.
  unreadableFiles?: number;
};

// The engine only writes suggestedAction from its AI judge. On a line where
// extraction returned nothing, the judge never runs (the verdict is decided
// deterministically), so the field is simply absent and the page said "No
// specific fix was suggested." to the very person whose whole purpose is
// knowing what to fix.
//
// This invents no fix and raises no finding. It states the one thing the row
// itself already proves: nothing in the records spoke to this requirement, so
// the first step is a record existing at all.
export const NO_EVIDENCE_FIRST_STEP =
  "Nothing in your records covers this yet, so there is no detail to correct. The first step is to keep a record of it happening, then run the check again.";

export function fixFor(r: EvidenceAssessmentRow, isGap: boolean): string {
  const given = (r.suggestedAction || "").trim();
  if (given) return given;
  // Only where the row genuinely found nothing, and only on a gap. A Met row
  // needs no fix, and a gap the engine DID reason about should not be given
  // generic advice in place of its own silence.
  if (isGap && (r.evidenceChunkIds?.length ?? 0) === 0) return NO_EVIDENCE_FIRST_STEP;
  return "";
}

// The trailing verbatim excerpt the judge prompts require inside the reasoning
// field is lifted out here, once, for all three row builders, and merged with
// the pass's own quote field when it is the same passage. Both halves of the
// row come back together so a builder cannot wire up one and forget the other.
function splitWhy(rawWhy: string, working: SelfCheckWorking, fallbackFile: string): Pick<SelfCheckRow, "why" | "working" | "cappedNote"> {
  const { prose, quotes, cap } = splitTrailingQuotes(rawWhy);
  return { why: prose, cappedNote: cap, working: { ...working, citations: mergeQuotes(working.citations, quotes, fallbackFile) } };
}

// Never a truncation. An absent engine field yields no summary at all.
function summaryOf(raw: string | undefined, kind: SelfCheckRow["summaryKind"]): Pick<SelfCheckRow, "summary" | "summaryKind"> {
  const t = (raw || "").trim();
  return t ? { summary: t, summaryKind: kind } : { summary: "", summaryKind: "none" };
}

// Read BEFORE the table, never after: the point of a legend is to tell you how
// to read the column you are about to scan.
export const VERDICT_LEGEND: Record<SelfCheckView, VerdictLegendLine[]> = {
  overview: [
    { icon: "✓", label: "Complies", meaning: "Your procedure covers this requirement AND your records show it happening." },
    { icon: "!", label: "Partly complies", meaning: "One half falls short: either the procedure is thin, or the records do not carry it all the way. The Missing line on the row names what is short." },
    { icon: "✗", label: "Does not comply", meaning: "The requirement is not satisfied on the evidence supplied. This is the state that becomes a finding." },
    { icon: "?", label: "Could not check", meaning: "Nothing was decided, in either direction. It is not a pass and not a fail, and the row says which of the four reasons applies." },
  ],
  procedure: [
    { icon: "✓", label: "Documented", meaning: "Your written procedure covers this requirement. It does NOT mean the requirement is met: your records still have to show it happening." },
    { icon: "!", label: "Partly documented", meaning: "The procedure covers some of the requirement and leaves part of it unsaid. The Missing line names the part." },
    { icon: "✗", label: "Not documented", meaning: "Nothing in the written procedure covers this requirement. Records alone cannot close it: the procedure has to say what the PEI does." },
    { icon: "?", label: "Could not check", meaning: "The procedure pass reached no verdict for this line. It is not a fail." },
  ],
  "procedure-only": [
    { icon: "✓", label: "Documented", meaning: "Your written procedure covers this requirement. It does NOT mean the requirement is met: nothing here looked at your records." },
    { icon: "!", label: "Partly documented", meaning: "The procedure covers some of the requirement and leaves part of it unsaid." },
    { icon: "✗", label: "Not documented", meaning: "Nothing in the written procedure covers this requirement." },
    { icon: "?", label: "Could not check", meaning: "The procedure pass reached no verdict for this line. It is not a fail." },
  ],
  records: [
    { icon: "✓", label: "Records found", meaning: "At least one record in your folder speaks to this requirement. It does NOT mean the requirement is met: the procedure must cover it too, and the record must actually satisfy it. The Overall tab is the combined answer." },
    { icon: "✗", label: "No records found", meaning: "Every file that could be read was searched and none of them spoke to this requirement." },
    { icon: "?", label: "Could not check", meaning: "Your records were not checked for this line, usually because the check did not answer for it." },
  ],
};

// Two different things a one-line summary can be, named apart, because calling
// an evidence summary "why" would attribute a judgement to a sentence that
// only reports what was found.
export const SUMMARY_LABEL: Record<SelfCheckRow["summaryKind"], string> = {
  verdictReason: "In one line",
  whatWasFound: "What was found",
  none: "",
};

export type SelfCheckCounts = { complies: number; partly: number; doesNot: number; couldNotCheck: number; total: number };

// The tally, in the tab's own vocabulary, as data. One definition behind the
// words above the table, the drawn bar and both exports, so they cannot
// disagree about what this tab found.
export function tallySlices(counts: SelfCheckCounts, view: SelfCheckView): TallySlice[] {
  const w = VIEW_TALLY[view];
  return [
    { label: w.complies, n: counts.complies, tone: "good" as const },
    ...(w.partly ? [{ label: w.partly, n: counts.partly, tone: "medium" as const }] : []),
    { label: w.doesNot, n: counts.doesNot, tone: "critical" as const },
    { label: "could not check", n: counts.couldNotCheck, tone: "neutral" as const },
  ];
}

// Which dimension this tab's verdicts feed. The overall tab feeds two and is
// already shown in full below the table, so it takes no marker.
export function feedsFor(view: SelfCheckView): TabFeeds | undefined {
  if (view === "procedure" || view === "procedure-only") return PROCEDURE_FEEDS;
  if (view === "records") return RECORDS_FEEDS;
  return undefined;
}

export function toSelfCheckRows(rows: EvidenceAssessmentRow[], ctx: SelfCheckContext = {}): SelfCheckRow[] {
  const ppdByRef = new Map((ctx.ppdRows ?? []).map((p) => [p.ref, p]));
  return rows.map((r) => {
    // An unjudged pair is shown for what it is, not as a partial pass.
    const plain = unjudgedBothSides(r)
      ? PLAIN_VERDICT["Not assessed"]
      : (PLAIN_VERDICT[r.verdict] ?? PLAIN_VERDICT["Not assessed"]);
    return {
      ref: r.gdRef,
      requirement: r.requirementText,
      // The tally counts off this field, so it has to agree with the label. A
      // row shown as "Could not check" must not be counted as a partial pass.
      verdict: unjudgedBothSides(r) ? "Not assessed" : r.verdict,
      label: plain.label,
      tone: plain.tone,
      icon: plain.icon,
      // The engine's own justification. A row whose AI call failed says so
      // rather than showing an empty cell that reads like "nothing to say".
      ...splitWhy(
        r.assessmentFailed
          ? "The checking service did not answer for this one, so nothing was judged. Run the check again."
          : unjudgedBothSides(r)
            ? UNJUDGED_BOTH_SIDES_WHY
            // Applied to every row, not only the gaps: a "Could not check" row
            // carried the same "every document was read" claim, and it is just
            // as wrong there.
            : qualifyForUnreadable(plainWhy(r.comment || r.evidenceSummary || ""), ctx.unreadableFiles ?? 0),
        buildWorking(r, ppdByRef.get(r.gdRef), ctx.evidenceChunkFileNames),
        "a document in your records",
      ),
      // Only when it is genuinely a DIFFERENT, shorter field. Where the engine
      // gave no comment, evidenceSummary already IS the why above, and showing
      // it twice is the defect this change exists to remove.
      ...summaryOf(r.comment ? r.evidenceSummary : "", "whatWasFound"),
      // OFI, taken only from the engine's suggestedAction. Never written here,
      // and only ever present on a row the engine judged short.
      fix: fixFor(r, plain.isGap),
      expected: expectedEvidenceFor(r.gd4ItemId),
    };
  });
}

// The procedure pass's own rows, in the same shape, so the table, the CSV and
// the printable page are the existing ones rather than a second set.
export function toProcedureRows(rows: PPDReviewRow[], ctx: SelfCheckContext = {}): SelfCheckRow[] {
  // The POLICY map: a PPDReviewRow's chunk ids were minted by the procedure
  // pass and mean nothing in the evidence pass's numbering.
  const fileOf = (cid: string) => ctx.policyChunkFileNames?.[cid] || "";
  return rows.map((r) => {
    const plain = PPD_PLAIN_VERDICT[r.verdict] ?? PPD_PLAIN_VERDICT["Not assessed"];
    return {
      ref: r.ref,
      requirement: r.requirementText,
      // Kept on the EvidenceVerdict axis only so the counts and the existing
      // table read it; the LABEL is what a process owner sees, and that stays
      // the procedure vocabulary above.
      verdict: r.verdict === "Adequate" ? "Met" : r.verdict === "Partial" ? "Partial" : r.verdict === "Not documented" ? "Not met" : "Not assessed",
      label: plain.label,
      tone: plain.tone,
      icon: plain.icon,
      ...splitWhy(plainWhy(r.fullComment || r.shortComment || ""), {
        lookedFor: r.requirementText,
        // Only a quote the pass verified as a real substring of the document.
        citations: r.supportQuote ? [{ file: fileOf(r.chunkIds?.[0] ?? "") || "your written procedure", quote: r.supportQuote }] : [],
        citedFiles: [...new Set((r.chunkIds ?? []).map(fileOf))].filter(Boolean),
        missing: (r.subClauses ?? []).filter((sc) => sc.verdict === "not documented").map((sc) => ({ text: sc.text, why: "Your written procedure does not cover this part." })),
        notCheckedReason: r.verdict === "Not assessed" && r.extractionStats && r.extractionStats.raw > 0
          ? "The tool found passages that may be relevant but could not match them word for word against your procedure, so it did not judge this line. That is a tool limit, not a finding about your area."
          : "",
        noBreakdown: (r.verdict === "Partial" || r.verdict === "Not documented") && (r.subClauses ?? []).filter((sc) => sc.verdict === "not documented").length === 0,
      }, "your written procedure"),
      // The one-sentence reason the prompt makes mandatory. Suppressed when
      // fullComment is absent, because shortComment is then the why itself.
      ...summaryOf(r.fullComment ? r.shortComment : "", "verdictReason"),
      // The procedure pass's OFI is its suggested rewrite. Copied, never written.
      fix: (r.suggestedRewrite || "").trim(),
      expected: expectedEvidenceFor(r.gd4ItemId),
    };
  });
}

// What the RECORDS pass alone found, with no verdict invented.
//
// EvidenceAssessmentRow.verdict is explicitly the COMBINED PPD-plus-evidence
// judgement, so it cannot answer "what did the records show" on its own. What
// the row does prove by itself is whether the records pass cited anything, and
// that is all this reports. Pairing it with the procedure view is what makes
// the four real combinations visible: documented and evidenced, documented but
// not evidenced, evidenced but not documented, neither.
export const RECORDS_PLAIN_VERDICT: Record<"found" | "none" | "unknown", PlainVerdict> = {
  found: { label: "Records found", tone: "good", isGap: false, icon: "✓" },
  none: { label: "No records found", tone: "critical", isGap: true, icon: "✗" },
  unknown: { label: "Could not check", tone: "neutral", isGap: false, icon: "?" },
};

export function toRecordsRows(rows: EvidenceAssessmentRow[], ctx: SelfCheckContext = {}): SelfCheckRow[] {
  const ppdByRef = new Map((ctx.ppdRows ?? []).map((p) => [p.ref, p]));
  return rows.map((r) => {
    const cited = (r.evidenceChunkIds?.length ?? 0) > 0;
    // An unjudged PAIR is deliberately NOT unknown here. What made the combined
    // verdict undecidable was the procedure side; the records side really did
    // run and really did find nothing, and saying "could not check" beside
    // "every document was read and none mentioned it" contradicts itself.
    const kind = r.assessmentFailed || r.verdict === "Not assessed"
      ? "unknown"
      : cited ? "found" : "none";
    const plain = RECORDS_PLAIN_VERDICT[kind];
    return {
      ref: r.gdRef,
      requirement: r.requirementText,
      // Mapped onto the shared axis so the one table and one tally can render
      // this view too. The LABEL above is what a process owner reads.
      verdict: kind === "found" ? "Met" : kind === "none" ? "Not met" : "Not assessed",
      label: plain.label,
      tone: plain.tone,
      icon: plain.icon,
      ...splitWhy(
        r.assessmentFailed
          ? "The checking service did not answer for this one, so your records were not checked. Run the check again."
          : cited
            ? (r.evidenceSummary || "").trim() || "A record covering this was found in your folder."
            : qualifyForUnreadable("Every document in your records folder was read, and none of them mentioned this requirement.", ctx.unreadableFiles ?? 0),
        buildWorking(r, ppdByRef.get(r.gdRef), ctx.evidenceChunkFileNames),
        "a document in your records",
      ),
      // evidenceSummary IS the why on this tab, so there is no second, shorter
      // field left to summarise it with.
      ...summaryOf("", "none"),
      fix: fixFor(r, plain.isGap),
      expected: expectedEvidenceFor(r.gd4ItemId),
    };
  });
}

// ── The two passes, shown apart ──────────────────────────────────────────
//
// Option A runs two passes that answer two different questions, and blending
// them into one verdict hid the distinction that is the whole point of it:
// "does your written procedure say this" and "do your records show it
// happening" can fail independently, and the fix is different for each.
//
// "procedure-only" is the run that never opened a record; "procedure" is the
// same pass seen as one half of a full run. Same words, different note: only
// one of them is missing its other half.
export type SelfCheckView = "overview" | "procedure" | "records" | "procedure-only";

// ONE definition, and it is the tab button, the CSV filename, the printed
// page's heading and the PDF tab title. Renaming here renames all four, which
// is the point: a tab called one thing on screen and another in the file an
// auditor files is two names for one thing.
export const VIEW_LABEL: Record<SelfCheckView, string> = {
  overview: "Overall",
  procedure: "Procedure",
  records: "Records",
  "procedure-only": "Procedure",
};

// Each view counts in its own vocabulary. A records view has no "partly":
// either a record covering the requirement was found or it was not, and
// inventing a middle state would be a judgement this pass never made.
export const VIEW_TALLY: Record<SelfCheckView, { complies: string; partly: string | null; doesNot: string }> = {
  overview: { complies: "complies", partly: "partly complies", doesNot: "does not comply" },
  // The tally words must be the same words as the row states, or the column and
  // the count read as two different vocabularies.
  procedure: { complies: "documented", partly: "partly documented", doesNot: "not documented" },
  "procedure-only": { complies: "documented", partly: "partly documented", doesNot: "not documented" },
  records: { complies: "records found", partly: null, doesNot: "no records found" },
};

// What the three tabs are, where a reader meets them. The Overall sentence is
// the engine's real decision procedure (agentRuntime.ts:3141-3148) in plain
// words, not a plausible-sounding summary: rule 2 makes an undocumented line
// "Not met" whatever the records show, rule 3 caps a partly documented line at
// "Partial" however complete the evidence, and only rule 4 lets the records
// decide. Kept to one sentence each; the counter below the tabs does the rest.
export const TABS_EXPLAINED: Record<"overview" | "procedure" | "records", { hint: string; text: string }> = {
  // `hint` rides on the tab button, so all three meanings are visible at once
  // whichever tab is open; `text` is the subheader for the tab actually open.
  overview: {
    hint: "The final result for each requirement",
    text: "The two together, and the one that counts. If your procedure does not cover a requirement it does not comply whatever your records show; if it covers it only partly the line can go no higher than partly complies; and where the procedure is adequate, your records decide.",
  },
  procedure: {
    hint: "What your written procedure says",
    text: "This view checks your documented approach only: policies, procedures, handbooks and terms of reference. It does not judge whether the process was actually carried out.",
  },
  records: {
    hint: "What your records show happened",
    text: "This view checks implementation evidence only: minutes, registers, logs, reports, signed records and emails. It does not judge whether your written procedure describes the process properly.",
  },
};

export const VIEW_NOTE: Record<SelfCheckView, string> = {
  overview: "",
  "procedure-only": PROCEDURE_ONLY_NOTE,
  // The tabs are named, now that their names are short enough to say in a
  // sentence: "the other tab" made a reader count tabs to work out which.
  procedure: "This is what your written procedure says it will do. It does not say whether any of it actually happened. Your records answer that, on the Records tab.",
  records: "This is what your records show actually happened. It does not say whether your written procedure covers it. Your written procedure answers that, on the Procedure tab.",
};

// The four combinations a process owner has to be able to see, and the fifth
// honest state. Read off the row itself: ppdVerdict is what the procedure pass
// decided, and a cited chunk is the records pass having found something. A
// missing judgement on either side is reported as unknown rather than folded
// into one of the four.
export type Combination = "both" | "written-only" | "records-only" | "neither" | "unknown";

// Same vocabulary as the row states, or the summary and the table read as two
// different languages for one result.
export const COMBINATION_LABEL: Record<Combination, string> = {
  both: "documented and evidenced",
  "written-only": "documented, no records",
  "records-only": "records only, not documented",
  neither: "neither",
  unknown: "could not tell",
};

export function combinationOf(r: EvidenceAssessmentRow): Combination {
  if (r.assessmentFailed || r.ppdVerdict === "Not assessed" || !r.ppdVerdict) return "unknown";
  const written = r.ppdVerdict === "Adequate" || r.ppdVerdict === "Partial";
  const cited = (r.evidenceChunkIds?.length ?? 0) > 0;
  return written ? (cited ? "both" : "written-only") : (cited ? "records-only" : "neither");
}

export function countCombinations(rows: EvidenceAssessmentRow[]): Record<Combination, number> {
  const out: Record<Combination, number> = { both: 0, "written-only": 0, "records-only": 0, neither: 0, unknown: 0 };
  for (const r of rows) out[combinationOf(r)] += 1;
  return out;
}

export function countSelfCheck(rows: SelfCheckRow[]): SelfCheckCounts {
  const n = (v: EvidenceVerdict) => rows.filter((r) => r.verdict === v).length;
  return {
    complies: n("Met"),
    partly: n("Partial"),
    doesNot: n("Not met"),
    couldNotCheck: n("Not assessed"),
    total: rows.length,
  };
}

// Shown when most of the run came back unjudged, which almost always means the
// folder was missing the documents rather than that the area is failing.
export const MOSTLY_UNCHECKED_NOTE =
  "Most of these could not be judged. That usually means the folder is missing the documents that cover this area, or the tool could not read them properly. It is not a sign that your area is failing. Check the folder has the right documents in a readable format, then run the check again.";

export function mostlyUnchecked(c: SelfCheckCounts): boolean {
  return c.total > 0 && c.couldNotCheck / c.total >= 0.5;
}

// Only two states, because a self-check run no longer produces a band. The
// auditor's committed band is a recorded fact about the area and survives;
// "none" means nobody has set one yet. The old "indicative" and "not-recorded"
// kinds both described a band this page worked out for itself, which it does
// not do any more.
export type SelfCheckBand =
  | { kind: "none" }
  | { kind: "auditor"; band: Band; name: string; totalPct: number };

// The check's OWN band, when all four dimensions carried a score. Separate from
// the auditor's: one is this tool reading your documents, the other is a
// recorded decision, and an export that blurred them would be the worst thing
// on the page.
export type SelfCheckOwnBand = { band: Band; name: string; working: string } | null;

// Derived from the WORKING the export is already printing, never passed in
// separately: the band line and the dimension panel beneath it then cannot
// disagree about whether all four were assessed.
export function ownBandOf(w: BandWorking | undefined): SelfCheckOwnBand {
  const t = selfCheckTotal(w);
  return t ? { band: t.band, name: bandName(t.band), working: selfCheckTotalWorking(t) } : null;
}

export const SELF_CHECK_HEADERS = [
  // "In one line" sits beside Result so a spreadsheet can be read down two
  // columns without opening Why. It holds an engine field verbatim and is
  // blank where the engine wrote no short form — never a cut-down Why.
  "Area", "GD4 reference", "What the requirement asks", "Result", "In one line", "Why", "What to fix",
  // The working an auditor files alongside the verdict. Three more columns
  // rather than a prose blob, so a spreadsheet can be sorted and filtered on
  // them the way working paper actually gets used.
  "Evidence quoted", "What is missing", "Official expected evidence",
];

// The leading tick is what makes the list checkable at a glance in a
// spreadsheet as well as on screen.
export const SELF_CHECK_FILE_HEADERS = ["Read?", "File", "Folder", "Was it read?", "What came out", "What to do about it", "Quoted in a result"];

// One place both exports turn a row's working into flat text, so the CSV and
// the printable page can never describe the same row differently.
export function citedText(w: SelfCheckWorking | undefined): string {
  if (!w) return "";
  if (w.citations.length > 0) return w.citations.map((c) => `"${c.quote}" (${c.file})`).join("\n");
  if (w.citedFiles.length > 0) return `Cited ${w.citedFiles.join(", ")}, with no exact excerpt captured.`;
  return "";
}

export const NO_BREAKDOWN_NOTE = "The check did not break this shortfall into named elements.";

// The official expected-evidence list is published per requirement ITEM, not
// per requirement line, so it is shown once per item rather than repeated
// under every line of that item — ten identical copies down a page is noise an
// auditor has to read past, and it implied a line-level list that does not
// exist. The label says which item it belongs to.
export type ExpectedEvidenceGroup = { itemId: string; items: string[] };

export function expectedEvidenceGroups(rows: SelfCheckRow[]): ExpectedEvidenceGroup[] {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const itemId = r.ref.split(".").slice(0, 3).join(".");
    if (!seen.has(itemId) && (r.expected ?? []).length > 0) seen.set(itemId, r.expected ?? []);
  }
  return [...seen].map(([itemId, items]) => ({ itemId, items }));
}

export function missingText(w: SelfCheckWorking | undefined): string {
  if (!w) return "";
  if (w.missing.length > 0) return w.missing.map((m) => `${m.text} — ${m.why}`).join("\n");
  if (w.notCheckedReason) return w.notCheckedReason;
  return w.noBreakdown ? NO_BREAKDOWN_NOTE : "";
}

// One wording for the band, used by BOTH downloads so a CSV and a PDF of the
// same run can never describe the result differently.
export const NO_BAND_LINE =
  "This check gives no band. It assesses two of the four EduTrust dimensions, Approach and Processes; your audit lead assesses all four and sets the band.";

export function bandLineOf(band: SelfCheckBand, own?: SelfCheckOwnBand): string {
  const ownLine = own
    ? `This check's band: Band ${own.band} of 5, ${own.name}. ${own.working}. All four dimensions were assessed on this run. This is the tool's reading of your own documents, not an SSG result.`
    : "";
  if (band.kind === "none") return ownLine || NO_BAND_LINE;
  // No em dash: house rule for anything a user reads.
  const auditorLine = `Band set by your auditor: Band ${band.band} of 5, ${band.name} (${band.totalPct}%)`;
  return ownLine ? `${ownLine} ${auditorLine}` : auditorLine;
}

// The band and the disclaimer ride in the CSV too. A spreadsheet gets
// forwarded and printed on its own; without them it reads like a bare verdict
// list that somebody could mistake for an official outcome.
export function buildSelfCheckCsv(
  areaLabel: string, rows: SelfCheckRow[], band: SelfCheckBand, view: SelfCheckView = "overview",
  files: SelfCheckFileRow[] = [],
  bandWorking?: BandWorking,
  bandCoverage?: string,
  // The scope's requirement items, for the official expected-evidence filter.
  itemIds: string[] = [],
  // How long the run took, already formatted, and whether both folder boxes
  // held the same link. Empty/false on an older result that recorded neither.
  timing: string = "",
  sameLink = false,
): string {
  const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, SELF_CHECK_HEADERS.length - cells.length)).fill("")];
  const blank = pad([]);
  // Only the overall view carries a band: one pass on its own was never banded,
  // and printing the area's band on top of half the answer would read as though
  // that half produced it.
  const trailer = [
    ...(view === "overview" ? [bandLineOf(band, ownBandOf(bandWorking))] : [VIEW_NOTE[view]]),
    ...(timing ? [`This check took ${timing}.`] : []),
    // Which build produced this file. A filed working paper that cannot say
    // which version of the tool wrote it cannot be reconciled with a later one.
    buildStamp(),
  ];
  // The drawn shape, as rows. A spreadsheet cannot carry the picture, so it
  // carries the same four numbers the picture is drawn from.
  const tally = countSelfCheck(rows);
  const shapeBlock = [
    blank,
    pad([tallyHeadline(tallySlices(tally, view))]),
    ...tallySlices(tally, view).map((sl) => pad([sl.label, String(sl.n)])),
    ...(feedsFor(view) ? [pad([feedsFor(view)!.caption])] : []),
  ];
  const counts = countFileRows(files);
  const warning = unreadableWarning(counts);
  const gaps = runNamedGaps(rows);
  const reviewRows = reviewShapedRows(rows);
  // The file list rides in the same spreadsheet, below the verdicts: a verdict
  // filed without the record of what was actually read is not defensible, and
  // two separate downloads get separated.
  const fileBlock = files.length === 0 ? [] : [
    blank,
    pad([`Every file this ${view === "overview" ? "check" : "tab"} read (${counts.total} file${counts.total === 1 ? "" : "s"}: ${counts.read} read, ${counts.check} to check, ${counts.unreadable} unreadable)`]),
    ...(sameLink ? [pad([SAME_LINK_WARNING])] : []),
    ...(warning ? [pad([warning])] : []),
    pad(SELF_CHECK_FILE_HEADERS),
    ...files.map((f) => pad([fileCheckMark(f).mark, f.name, f.bucket, f.label, f.detail, f.action, f.cited ? "yes" : "no"])),
  ];
  // The legend travels with the file: a spreadsheet forwarded to an external
  // assessor has to explain its own state names.
  const legendBlock = [
    blank,
    pad(["What each result means"]),
    ...VERDICT_LEGEND[view].map((l) => pad([`${l.icon} ${l.label}`, l.meaning])),
  ];
  // The graphic cannot travel into a spreadsheet, so the numbers it is drawn
  // from do instead, as rows: what each dimension earned out of what it could,
  // and which two were never assessed. No total row, because there is no total.
  const bandBlock = !bandWorking || view !== "overview" ? [] : [
    blank,
    pad(["What this check assessed"]),
    ...(bandCoverage ? [pad([bandCoverage])] : []),
    pad(["Dimension", "Band", "Earned", "Out of", "Assessed by this check?", "Official descriptor", "Where it came from"]),
    ...bandWorking.rows.map((d) => pad([
      d.label,
      d.band === undefined ? "not scored" : `Band ${d.band}`,
      d.assessedHere ? `${d.pct}%` : "",
      `${bandWorking.maxPct}%`,
      d.assessedHere ? "yes" : "NO",
      d.descriptor,
      d.assessedHere ? (d.reason || "assessed by this check") : "NOT assessed by this check",
    ])),
    pad([ROWS_DO_NOT_SUM_NOTE]),
    pad([dimensionsNote(bandWorking)]),
    pad([INFERRED_THRESHOLDS_NOTE]),
    blank,
    pad(["What the full audit will look for"]),
    pad([IMPROVE_HEADLINE]),
    pad([IMPROVE_WHY]),
    ...unassessedDimensions(itemIds).flatMap((d) => [
      pad([d.label, d.plainQuestion]),
      ...d.ladder.map((l) => pad(["", `Band ${l.band} ${l.name}`, l.descriptor])),
      ...(d.officialEvidence.length > 0
        ? d.officialEvidence.map((e) => pad(["", "Official expected evidence", e]))
        : [pad(["", "", d.noOfficialList])]),
      // Review only, and the same refs and verdicts the table above carries.
      ...(d.key !== "review" ? [] : [
        pad([REVIEW_FINDINGS_HEADING]),
        pad([REVIEW_FINDINGS_INTRO]),
        ...(reviewRows.length === 0
          ? [pad(["", "", REVIEW_FINDINGS_NONE])]
          : reviewRows.map((r) => pad([r.ref, r.label, r.requirement]))),
      ]),
    ]),
    ...(gaps.length === 0 ? [] : [
      pad(["What this run already told you is missing"]),
      ...(reviewShapedGapNote(gaps) ? [pad([reviewShapedGapNote(gaps)])] : []),
      ...gaps.map((g) => pad([g.ref, g.text])),
    ]),
  ];
  return toCsv(SELF_CHECK_HEADERS, [
    ...rows.map((r) => pad([areaLabel, r.ref, r.requirement, r.label, r.summary, [r.why, r.cappedNote].filter(Boolean).join("\n\n"), r.fix, citedText(r.working), missingText(r.working), (r.expected ?? []).join("; ")])),
    blank,
    ...trailer.map((t) => pad([t])),
    pad([SELF_CHECK_DISCLAIMER]),
    ...legendBlock,
    ...shapeBlock,
    ...bandBlock,
    ...fileBlock,
  ]);
}

export function selfCheckFilename(areaLabel: string, ext: "csv"): string {
  const safe = areaLabel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `self-check-${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

// Printable version. Reuses PRINTABLE_DOC_CSS and printHtmlInNewTab from the
// page, so the PDF is produced by the same print-to-tab path every other
// document in this app uses rather than a second generator.
export function buildSelfCheckHtml(opts: {
  areaLabel: string;
  areaDescription: string;
  counts: SelfCheckCounts;
  band: SelfCheckBand;
  rows: SelfCheckRow[];
  ranAt: string;
  view?: SelfCheckView;
  files?: SelfCheckFileRow[];
  bandWorking?: BandWorking;
  bandCoverage?: string;
  // How long the run took, already formatted, and whether both folder boxes
  // held one link. Both empty/false on a result that recorded neither.
  timing?: string;
  sameLink?: boolean;
  itemIds?: string[];
}): string {
  const { areaLabel, areaDescription, counts, band, rows, ranAt, view = "overview", files = [], bandWorking, bandCoverage, itemIds = [], timing = "", sameLink = false } = opts;
  const gaps = runNamedGaps(rows);
  const reviewRows = reviewShapedRows(rows);
  const legendHtml = `
    <h2>What each result means</h2>
    <table>
      <thead><tr><th>Result</th><th>What it means</th></tr></thead>
      <tbody>${VERDICT_LEGEND[view].map((l) => `<tr><td><b>${escapeHtml(l.icon)} ${escapeHtml(l.label)}</b></td><td>${escapeHtml(l.meaning)}</td></tr>`).join("")}</tbody>
    </table>`;
  // The two dimensions this check can defend, and the two it leaves alone. The
  // picture comes first because this document is what gets filed as working
  // paper and shown to people, so the graphic matters here more than on screen,
  // not less. Print palette, so a dark-mode browser can never send a dark chart
  // to a printer.
  const bandHtml = !bandWorking || view !== "overview" ? "" : `
    <h2>What this check assessed</h2>
    <div class="band-graphic">${bandGraphicSvg(bandGraphic(bandWorking), PRINT_BAND_PALETTE, { idSuffix: "Print" })}</div>
    ${bandCoverage ? `<p class="muted">${escapeHtml(bandCoverage)}</p>` : ""}
    <table>
      <thead><tr><th>Dimension</th><th>Band</th><th>Earned</th><th>Out of</th><th>Assessed by this check?</th><th>Official descriptor at that band</th><th>Where it came from</th></tr></thead>
      <tbody>${bandWorking.rows.map((d) => `<tr>
        <td>${escapeHtml(d.label)}</td>
        <td>${d.band === undefined ? "not scored" : `Band ${d.band}`}</td>
        <td>${d.assessedHere ? `${d.pct}%` : ""}</td><td>${bandWorking.maxPct}%</td>
        <td>${d.assessedHere ? "yes" : "<b>NO</b>"}</td>
        <td>${escapeHtml(d.descriptor)}</td>
        <td>${escapeHtml(d.assessedHere ? (d.reason || "assessed by this check") : "NOT assessed by this check")}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="muted">${escapeHtml(ROWS_DO_NOT_SUM_NOTE)}</p>
    <p class="muted">${escapeHtml(dimensionsNote(bandWorking))}</p>
    <p class="muted">${escapeHtml(INFERRED_THRESHOLDS_NOTE)}</p>
    <h2>What the full audit will look for</h2>
    <p>${escapeHtml(IMPROVE_HEADLINE)}</p>
    <p class="muted">${escapeHtml(IMPROVE_WHY)}</p>
    ${unassessedDimensions(itemIds).map((d) => `
      <h3>${escapeHtml(d.label)}</h3>
      <p class="muted">${escapeHtml(d.plainQuestion)}</p>
      <ul>${d.ladder.map((l) => `<li><b>Band ${l.band} ${escapeHtml(l.name)}:</b> ${escapeHtml(l.descriptor)}</li>`).join("")}</ul>
      ${d.officialEvidence.length > 0
        ? `<p class="muted"><b>On the official expected-evidence list for this requirement:</b></p><ul>${d.officialEvidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
        : `<p class="muted">${escapeHtml(d.noOfficialList)}</p>`}
      ${d.key !== "review" ? "" : `
        <h3>${escapeHtml(REVIEW_FINDINGS_HEADING)}</h3>
        <p class="muted">${escapeHtml(REVIEW_FINDINGS_INTRO)}</p>
        ${reviewRows.length === 0
          ? `<p class="muted">${escapeHtml(REVIEW_FINDINGS_NONE)}</p>`
          : `<ul>${reviewRows.map((r) => `<li><b>${escapeHtml(`${r.icon} ${r.label}`)}</b> ${escapeHtml(r.requirement)} <span class="muted">${escapeHtml(r.ref)}</span></li>`).join("")}</ul>`}`}
    `).join("")}
    ${gaps.length === 0 ? "" : `
      <h3>What this run already told you is missing</h3>
      ${reviewShapedGapNote(gaps) ? `<p class="muted">${escapeHtml(reviewShapedGapNote(gaps))}</p>` : ""}
      <ul>${gaps.map((g) => `<li><b>${escapeHtml(g.ref)}</b> ${escapeHtml(g.text)}</li>`).join("")}</ul>`}
    <h2>The official band scale</h2>
    <table>
      <thead><tr><th>Band</th><th>Approach</th><th>Processes</th><th>Systems &amp; Outcomes</th><th>Review</th></tr></thead>
      <tbody>${BAND_LADDER.map((b) => `<tr>
        <td>Band ${b.band} ${escapeHtml(b.name)}</td>
        <td>${escapeHtml(b.approach)}</td><td>${escapeHtml(b.processes)}</td><td>${escapeHtml(b.systemsOutcomes)}</td><td>${escapeHtml(b.review)}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  const fileCounts = countFileRows(files);
  const fileWarning = unreadableWarning(fileCounts);
  // Printed in black and white, so the unreadable rows carry a word rather than
  // only a colour.
  const OUTCOME_MARK: Record<SelfCheckFileRow["outcome"], string> = { read: "", check: "CHECK — ", unreadable: "NOT READ — " };
  const filesTable = files.length === 0 ? "" : `
    <h2>Every file this ${view === "overview" ? "check" : "tab"} read</h2>
    ${sameLink ? `<p><b>${escapeHtml(SAME_LINK_WARNING)}</b></p>` : ""}
    ${fileWarning ? `<p><b>${escapeHtml(fileWarning)}</b></p>` : ""}
    <p class="muted">${fileCounts.read} read · ${fileCounts.check} read but worth checking · ${fileCounts.unreadable} could not be read</p>
    <table>
      <thead><tr><th>Read?</th><th>File</th><th>Folder</th><th>Was it read?</th><th>What came out</th><th>What to do about it</th><th>Quoted</th></tr></thead>
      <tbody>
        ${files.map((f) => `<tr>
          <td><b>${escapeHtml(fileCheckMark(f).mark)}</b></td>
          <td>${escapeHtml(f.name)}</td>
          <td>${escapeHtml(f.bucket)}</td>
          <td>${escapeHtml(OUTCOME_MARK[f.outcome] + f.label)}</td>
          <td>${escapeHtml(f.detail)}</td>
          <td>${escapeHtml(f.action)}</td>
          <td>${f.cited ? "yes" : "no"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  // The working, rendered inside the existing cells rather than as extra
  // columns: a printed page at A4 cannot carry nine columns and stay readable.
  //
  // Four content types, four blocks. Nothing is collapsed and nothing is cut:
  // this document is the filed working paper, so every element the screen
  // hides behind a disclosure triangle is printed in full. The missing list is
  // a real <ul>, because on some lines it runs to fifteen elements and as one
  // run-on paragraph it was unreadable.
  const workingHtml = (r: SelfCheckRow) => {
    const w = r.working;
    const quotes = w?.citations ?? [];
    const citedOnly = quotes.length === 0 && (w?.citedFiles.length ?? 0) > 0 ? citedText(w) : "";
    const missing = w?.missing ?? [];
    // A line nothing could be decided for has a reason, not a missing element.
    const label = r.verdict === "Not assessed" ? "Why not" : "What is missing";
    const other = missing.length === 0 ? missingText(w) : "";
    return [
      quotes.length > 0
        ? `<div class="sc-quotes"><b>Quoted from your documents (${quotes.length})</b>${quotes.map((c) => `<blockquote>${escapeHtml(c.quote)}<span class="muted"> — ${escapeHtml(c.file)}</span></blockquote>`).join("")}</div>`
        : citedOnly ? `<div class="muted"><b>Quoted:</b> ${escapeHtml(citedOnly)}</div>` : "",
      missing.length > 0
        ? `<div><b>${label} (${missing.length})</b><ul class="sc-missing">${missing.map((m) => `<li>${escapeHtml(m.text)}<span class="muted"> — ${escapeHtml(m.why)}</span></li>`).join("")}</ul></div>`
        : other ? `<div class="muted"><b>${label}:</b> ${escapeHtml(other)}</div>` : "",
    ].join("");
  };
  const groups = expectedEvidenceGroups(rows);
  const expectedSection = groups.length === 0 ? "" : `
    <h2>What a passing record contains</h2>
    <p class="muted">The official EduTrust GD4 expected-evidence list, quoted as published. It is not a judgement on anything you hold.</p>
    ${groups.map((g) => `<p><b>Requirement ${escapeHtml(g.itemId)}</b><br>${g.items.map((i) => escapeHtml(i)).join("<br>")}</p>`).join("")}`;
  const words = VIEW_TALLY[view];
  // Which dimension THIS tab's verdicts feed, drawn on the two tabs that feed
  // one. The overall tab shows all four in full further down instead.
  const feeds = feedsFor(view);
  const tabFeedsHtml = !feeds || !bandWorking ? "" : `
    <h3>What this tab feeds</h3>
    <div class="band-graphic">${bandGraphicSvg(bandGraphic(bandWorking), PRINT_BAND_PALETTE, { idSuffix: "Feeds", feeds })}</div>
    <p class="muted">${escapeHtml(feeds.caption)}</p>`;
  const bandLine = view === "overview" ? bandLineOf(band, ownBandOf(bandWorking)) : VIEW_NOTE[view];
  // Same condition as the screen: a run with nothing unjudged must not carry a
  // paragraph explaining "Could not check", which reads as a warning about a
  // result that is not there.
  const unjudgedNote = counts.couldNotCheck === 0 ? "" : mostlyUnchecked(counts) ? MOSTLY_UNCHECKED_NOTE : COULD_NOT_CHECK_NOTE;
  return `
    <h1>Self-check: ${escapeHtml(areaLabel)}${view === "procedure-only" ? " (written procedure only)" : view === "overview" ? "" : ` — ${escapeHtml(VIEW_LABEL[view])}`}</h1>
    <p class="muted">${escapeHtml(areaDescription)}</p>
    <p class="muted">Checked on ${escapeHtml(ranAt)}${timing ? ` · took ${escapeHtml(timing)}` : ""} · ${escapeHtml(buildStamp())}</p>
    <p><b>${counts.complies} ${words.complies}${words.partly ? ` · ${counts.partly} ${words.partly}` : ""} · ${counts.doesNot} ${words.doesNot} · ${counts.couldNotCheck} could not check</b></p>
    <p>${escapeHtml(bandLine)}</p>
    ${unjudgedNote ? `<p class="muted">${escapeHtml(unjudgedNote)}</p>` : ""}
    ${/* The shape of the tab, before any row is read. Present on EVERY view,
         because the procedure and records tabs are where the reading time
         goes and they used to carry no picture at all. */ ""}
    <div class="band-graphic">${tallyBarSvg(tallySlices(counts, view), PRINT_BAND_PALETTE)}</div>
    ${tabFeedsHtml}
    ${legendHtml}
    <table>
      <thead><tr><th>Result</th><th>What the requirement asks</th><th>Why</th><th>What to fix</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="sc-verdict"><b>${escapeHtml(`${r.icon} ${r.label}`)}</b></td>
          <td>${escapeHtml(r.requirement)}<br><span class="muted">${escapeHtml(r.ref)}</span></td>
          <td>${r.summary ? `<div class="sc-summary"><b>${escapeHtml(SUMMARY_LABEL[r.summaryKind])}:</b> ${escapeHtml(r.summary)}</div>` : ""}<div>${escapeHtml(r.why)}</div>${r.cappedNote ? `<div class="sc-capped">${escapeHtml(r.cappedNote)}</div>` : ""}${workingHtml(r)}</td>
          <td>${escapeHtml(r.fix)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${bandHtml}
    ${expectedSection}
    ${filesTable}
    <p class="muted">${escapeHtml(SELF_CHECK_DISCLAIMER)}</p>
  `;
}

// Plain-English translation of the blockers a process owner can actually hit.
// Each maps to a real state the engine or the workspace is already in; none is
// invented, and none sends this person to a page written for an auditor.
export type SelfCheckBlock =
  | {
      title: string;
      detail: string;
      canRun: false;
      // Where whoever CAN clear this blocker has to go. The detail text is
      // written for a process owner and tells them to ask their audit lead, but
      // the audit lead hits the same wall themselves, with nothing to click.
      fixPath?: string;
      fixLabel?: string;
    }
  | { canRun: true };

export function describeBlock(opts: {
  cycleLocked: boolean;
  hasAuditor: boolean;
  aiOffline: string | null;
  driveConnected: boolean;
}): SelfCheckBlock {
  if (opts.cycleLocked) {
    return {
      canRun: false,
      title: "Checks are paused right now",
      detail: "Your audit lead has locked this audit while it is being submitted, so nothing can be run or changed until they reopen it. Ask them when it will be unlocked.",
      fixPath: "#/audit-cycle",
      fixLabel: "If you are the audit lead: open the audit cycle",
    };
  }
  if (!opts.hasAuditor) {
    return {
      canRun: false,
      title: "The workspace is not set up yet",
      detail: "Your audit lead needs to finish setting this workspace up before checks can run. Send them this page and ask them to add the audit team.",
      fixPath: "#/auditors",
      fixLabel: "If you are the audit lead: add an auditor",
    };
  }
  if (opts.aiOffline) {
    return {
      canRun: false,
      title: "The checking service is not switched on",
      detail: "Your audit lead needs to switch on the AI checking service before this can run. Ask them to do that, then come back.",
      fixPath: "#/settings",
      fixLabel: "If you are the audit lead: open Settings",
    };
  }
  if (!opts.driveConnected) {
    return {
      canRun: false,
      title: "Google Drive is not connected",
      detail: "This tool has to be connected to Google Drive before it can open your folder. Use the Connect button below, or ask your audit lead to connect it.",
    };
  }
  return { canRun: true };
}

// The engine's own failure strings are written for an auditor. These are the
// ones a process owner can actually cause, translated. Anything unrecognised
// is passed through rather than swallowed, so a real error is never hidden.
export function plainRunError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (/No Policy & Procedure files found/i.test(raw)) {
    return "I could not find any documents in that folder. Check the link points at the folder itself (not a single file), and that the folder is shared with the audit account.";
  }
  if (/No readable text could be extracted/i.test(raw)) {
    return "I opened your folder but could not read any text from the files in it. Scanned images and photos of documents often cause this. Try adding the original Word or PDF versions.";
  }
  if (/Drive|token|expired|reconnect/i.test(raw)) {
    return "The connection to Google Drive stopped working part-way through. Reconnect and run the check again.";
  }
  if (/AI is disabled|no API key/i.test(raw)) {
    return "The checking service is not switched on. Ask your audit lead to switch it on, then run the check again.";
  }
  // "PPD extraction window 1/2, batch 1/1 failed — OpenAI request timed out
  // after 90s" is the engine's own wording and means nothing to the person
  // reading it. Say what happened to their documents instead.
  if (/extraction (window|batch)[^]*?(failed|timed out)/i.test(raw) || /timed out/i.test(raw)) {
    const part = raw.match(/window (\d+)\/(\d+)/i);
    return `One of the passes over your documents did not finish${part ? ` (part ${part[1]} of ${part[2]})` : ""}, so part of what you uploaded was never read. Anything it would have found is missing from this result.`;
  }
  if (/returned no parseable|not valid JSON/i.test(raw)) {
    return "One of the passes over your documents came back unreadable, so part of what you uploaded was never judged.";
  }
  return raw;
}

// The verdict/comment consistency guard writes its warning INTO the comment
// (agentRuntime.ts, "⚠ Verdict/comment mismatch"), so it arrives on the row as
// a trailing paragraph of the reasoning. The result card lifts it out into its
// own banner, because a warning that the model contradicted itself is not
// supporting detail: it is the reason not to trust the row above it, and folded
// into the bottom of a closed disclosure nobody meets it. Nothing is dropped —
// the rest of the comment comes back as `why`.
export function splitMismatchWarning(why: string): { why: string; warning: string } {
  const at = why.indexOf("⚠ Verdict/comment mismatch");
  if (at < 0) return { why, warning: "" };
  return { why: why.slice(0, at).trim(), warning: why.slice(at).replace(/^⚠\s*/, "").trim() };
}
