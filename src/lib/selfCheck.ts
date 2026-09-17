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
import { escapeHtml } from "./printableDoc";
import { unjudgedBothSides } from "./unjudgedRows";
import { buildWorking, expectedEvidenceFor, unreadableWarning, countFileRows, qualifyForUnreadable, type SelfCheckWorking, type SelfCheckFileRow } from "./selfCheckEvidence";
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
export type PlainVerdict = { label: string; tone: string; isGap: boolean };

export const PLAIN_VERDICT: Record<EvidenceVerdict, PlainVerdict> = {
  Met: { label: "Complies", tone: "good", isGap: false },
  Partial: { label: "Partly complies", tone: "medium", isGap: true },
  "Not met": { label: "Does not comply", tone: "critical", isGap: true },
  // Neutral tone on purpose. Grey, never red: the documents did not say either
  // way, which is a gap in what was supplied, not a judgement on the area.
  "Not assessed": { label: "Could not check", tone: "neutral", isGap: false },
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
export const PPD_PLAIN_VERDICT: Record<PPDVerdict, PlainVerdict> = {
  Adequate: { label: "Written down", tone: "good", isGap: false },
  Partial: { label: "Partly written down", tone: "medium", isGap: true },
  "Not documented": { label: "Not written down", tone: "critical", isGap: true },
  "Not assessed": { label: "Could not check", tone: "neutral", isGap: false },
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
  why: string;
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
  chunkFileNames?: Record<string, string>;
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

export type SelfCheckCounts = { complies: number; partly: number; doesNot: number; couldNotCheck: number; total: number };

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
      // The engine's own justification. A row whose AI call failed says so
      // rather than showing an empty cell that reads like "nothing to say".
      why: r.assessmentFailed
        ? "The checking service did not answer for this one, so nothing was judged. Run the check again."
        : unjudgedBothSides(r)
          ? UNJUDGED_BOTH_SIDES_WHY
          // Applied to every row, not only the gaps: a "Could not check" row
          // carried the same "every document was read" claim, and it is just
          // as wrong there.
          : qualifyForUnreadable(plainWhy(r.comment || r.evidenceSummary || ""), ctx.unreadableFiles ?? 0),
      // OFI, taken only from the engine's suggestedAction. Never written here,
      // and only ever present on a row the engine judged short.
      fix: fixFor(r, plain.isGap),
      working: buildWorking(r, ppdByRef.get(r.gdRef), ctx.chunkFileNames),
      expected: expectedEvidenceFor(r.gd4ItemId),
    };
  });
}

// The procedure pass's own rows, in the same shape, so the table, the CSV and
// the printable page are the existing ones rather than a second set.
export function toProcedureRows(rows: PPDReviewRow[], ctx: SelfCheckContext = {}): SelfCheckRow[] {
  const fileOf = (cid: string) => ctx.chunkFileNames?.[cid] || "";
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
      why: plainWhy(r.fullComment || r.shortComment || ""),
      // The procedure pass's OFI is its suggested rewrite. Copied, never written.
      fix: (r.suggestedRewrite || "").trim(),
      working: {
        lookedFor: r.requirementText,
        // Only a quote the pass verified as a real substring of the document.
        citations: r.supportQuote ? [{ file: fileOf(r.chunkIds?.[0] ?? "") || "your written procedure", quote: r.supportQuote }] : [],
        citedFiles: [...new Set((r.chunkIds ?? []).map(fileOf))].filter(Boolean),
        missing: (r.subClauses ?? []).filter((sc) => sc.verdict === "not documented").map((sc) => ({ text: sc.text, why: "Your written procedure does not cover this part." })),
        notCheckedReason: r.verdict === "Not assessed" && r.extractionStats && r.extractionStats.raw > 0
          ? "The tool found passages that may be relevant but could not match them word for word against your procedure, so it did not judge this line. That is a tool limit, not a finding about your area."
          : "",
        noBreakdown: (r.verdict === "Partial" || r.verdict === "Not documented") && (r.subClauses ?? []).filter((sc) => sc.verdict === "not documented").length === 0,
      },
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
  found: { label: "Records found", tone: "good", isGap: false },
  none: { label: "Nothing found", tone: "critical", isGap: true },
  unknown: { label: "Could not check", tone: "neutral", isGap: false },
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
      why: r.assessmentFailed
        ? "The checking service did not answer for this one, so your records were not checked. Run the check again."
        : cited
          ? (r.evidenceSummary || "").trim() || "A record covering this was found in your folder."
          : qualifyForUnreadable("Every document in your records folder was read, and none of them mentioned this requirement.", ctx.unreadableFiles ?? 0),
      fix: fixFor(r, plain.isGap),
      working: buildWorking(r, ppdByRef.get(r.gdRef), ctx.chunkFileNames),
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

export const VIEW_LABEL: Record<SelfCheckView, string> = {
  overview: "Overall",
  procedure: "Your written procedure",
  records: "Your records",
  "procedure-only": "Your written procedure",
};

// Each view counts in its own vocabulary. A records view has no "partly":
// either a record covering the requirement was found or it was not, and
// inventing a middle state would be a judgement this pass never made.
export const VIEW_TALLY: Record<SelfCheckView, { complies: string; partly: string | null; doesNot: string }> = {
  overview: { complies: "complies", partly: "partly complies", doesNot: "does not comply" },
  procedure: { complies: "written down", partly: "partly written down", doesNot: "not written down" },
  "procedure-only": { complies: "written down", partly: "partly written down", doesNot: "not written down" },
  records: { complies: "records found", partly: null, doesNot: "nothing found" },
};

export const VIEW_NOTE: Record<SelfCheckView, string> = {
  overview: "",
  "procedure-only": PROCEDURE_ONLY_NOTE,
  procedure: "This is what your written procedure says it will do. It does not say whether any of it actually happened. Your records answer that, on the other tab.",
  records: "This is what your records show actually happened. It does not say whether your written procedure covers it. Your written procedure answers that, on the other tab.",
};

// The four combinations a process owner has to be able to see, and the fifth
// honest state. Read off the row itself: ppdVerdict is what the procedure pass
// decided, and a cited chunk is the records pass having found something. A
// missing judgement on either side is reported as unknown rather than folded
// into one of the four.
export type Combination = "both" | "written-only" | "records-only" | "neither" | "unknown";

export const COMBINATION_LABEL: Record<Combination, string> = {
  both: "written down and evidenced",
  "written-only": "written down, no records",
  "records-only": "records only, not written down",
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

export type SelfCheckBand =
  | { kind: "none" }
  | { kind: "auditor"; band: Band; name: string; totalPct: number }
  | { kind: "indicative"; band: Band; name: string; totalPct: number }
  // An earlier check being downloaded before it is replaced. The band it was
  // shown with came from suggestBand(), which never commits and stores nothing
  // with the result, so it is genuinely gone. Recomputing it would need a live
  // AI call and would produce a DIFFERENT band from the one the user saw, so
  // the document says so outright rather than leaving the field blank.
  | { kind: "not-recorded" };

export const SELF_CHECK_HEADERS = [
  "Area", "GD4 reference", "What the requirement asks", "Result", "Why", "What to fix",
  // The working an auditor files alongside the verdict. Three more columns
  // rather than a prose blob, so a spreadsheet can be sorted and filtered on
  // them the way working paper actually gets used.
  "Evidence quoted", "What is missing", "Official expected evidence",
];

export const SELF_CHECK_FILE_HEADERS = ["File", "Folder", "Was it read?", "Detail", "What to do about it", "Quoted in a result"];

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
export const SCORE_NOT_RECORDED =
  "Score not recorded for this earlier check. The band shown at the time was worked out live and was not saved with the result. Run the check again to get a current one.";

export function bandLineOf(band: SelfCheckBand): string {
  if (band.kind === "none") return "No band yet for this area.";
  if (band.kind === "not-recorded") return SCORE_NOT_RECORDED;
  return `${band.kind === "auditor" ? "Band set by your auditor" : "Indicative band, not yet confirmed by your auditor"}: Band ${band.band} of 5 — ${band.name} (${band.totalPct}%)`;
}

// The band and the disclaimer ride in the CSV too. A spreadsheet gets
// forwarded and printed on its own; without them it reads like a bare verdict
// list that somebody could mistake for an official outcome.
export function buildSelfCheckCsv(
  areaLabel: string, rows: SelfCheckRow[], band: SelfCheckBand, view: SelfCheckView = "overview",
  files: SelfCheckFileRow[] = [],
): string {
  const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, SELF_CHECK_HEADERS.length - cells.length)).fill("")];
  const blank = pad([]);
  // Only the overall view carries a band: one pass on its own was never banded,
  // and printing the area's band on top of half the answer would read as though
  // that half produced it.
  const trailer = view === "overview" ? [bandLineOf(band)] : [VIEW_NOTE[view]];
  const counts = countFileRows(files);
  const warning = unreadableWarning(counts);
  // The file list rides in the same spreadsheet, below the verdicts: a verdict
  // filed without the record of what was actually read is not defensible, and
  // two separate downloads get separated.
  const fileBlock = files.length === 0 ? [] : [
    blank,
    pad([`What was read (${counts.total} file${counts.total === 1 ? "" : "s"}: ${counts.read} read, ${counts.check} to check, ${counts.unreadable} unreadable)`]),
    ...(warning ? [pad([warning])] : []),
    pad(SELF_CHECK_FILE_HEADERS),
    ...files.map((f) => pad([f.name, f.bucket, f.label, f.detail, f.action, f.cited ? "yes" : "no"])),
  ];
  return toCsv(SELF_CHECK_HEADERS, [
    ...rows.map((r) => pad([areaLabel, r.ref, r.requirement, r.label, r.why, r.fix, citedText(r.working), missingText(r.working), (r.expected ?? []).join("; ")])),
    blank,
    ...trailer.map((t) => pad([t])),
    pad([SELF_CHECK_DISCLAIMER]),
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
}): string {
  const { areaLabel, areaDescription, counts, band, rows, ranAt, view = "overview", files = [] } = opts;
  const fileCounts = countFileRows(files);
  const fileWarning = unreadableWarning(fileCounts);
  // Printed in black and white, so the unreadable rows carry a word rather than
  // only a colour.
  const OUTCOME_MARK: Record<SelfCheckFileRow["outcome"], string> = { read: "", check: "CHECK — ", unreadable: "NOT READ — " };
  const filesTable = files.length === 0 ? "" : `
    <h2>What was read</h2>
    ${fileWarning ? `<p><b>${escapeHtml(fileWarning)}</b></p>` : ""}
    <p class="muted">${fileCounts.read} read · ${fileCounts.check} read but worth checking · ${fileCounts.unreadable} could not be read</p>
    <table>
      <thead><tr><th>File</th><th>Folder</th><th>Was it read?</th><th>Detail</th><th>What to do about it</th><th>Quoted</th></tr></thead>
      <tbody>
        ${files.map((f) => `<tr>
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
  const workingHtml = (r: SelfCheckRow) => {
    const cited = citedText(r.working);
    const missing = missingText(r.working);
    // A line nothing could be decided for has a reason, not a missing element.
    const label = r.verdict === "Not assessed" ? "Why not:" : "Missing:";
    return `${cited ? `<div class="muted"><b>Quoted:</b> ${escapeHtml(cited)}</div>` : ""}${missing ? `<div class="muted"><b>${label}</b> ${escapeHtml(missing)}</div>` : ""}`;
  };
  const groups = expectedEvidenceGroups(rows);
  const expectedSection = groups.length === 0 ? "" : `
    <h2>What a passing record contains</h2>
    <p class="muted">The official EduTrust GD4 expected-evidence list, quoted as published. It is not a judgement on anything you hold.</p>
    ${groups.map((g) => `<p><b>Requirement ${escapeHtml(g.itemId)}</b><br>${g.items.map((i) => escapeHtml(i)).join("<br>")}</p>`).join("")}`;
  const words = VIEW_TALLY[view];
  const bandLine = view === "overview" ? bandLineOf(band) : VIEW_NOTE[view];
  // Same condition as the screen: a run with nothing unjudged must not carry a
  // paragraph explaining "Could not check", which reads as a warning about a
  // result that is not there.
  const unjudgedNote = counts.couldNotCheck === 0 ? "" : mostlyUnchecked(counts) ? MOSTLY_UNCHECKED_NOTE : COULD_NOT_CHECK_NOTE;
  return `
    <h1>Self-check: ${escapeHtml(areaLabel)}${view === "procedure-only" ? " (written procedure only)" : view === "overview" ? "" : ` — ${escapeHtml(VIEW_LABEL[view])}`}</h1>
    <p class="muted">${escapeHtml(areaDescription)}</p>
    <p class="muted">Checked on ${escapeHtml(ranAt)}</p>
    <p><b>${counts.complies} ${words.complies}${words.partly ? ` · ${counts.partly} ${words.partly}` : ""} · ${counts.doesNot} ${words.doesNot} · ${counts.couldNotCheck} could not check</b></p>
    <p>${escapeHtml(bandLine)}</p>
    ${unjudgedNote ? `<p class="muted">${escapeHtml(unjudgedNote)}</p>` : ""}
    <table>
      <thead><tr><th>What the requirement asks</th><th>Result</th><th>Why</th><th>What to fix</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${escapeHtml(r.requirement)}<br><span class="muted">${escapeHtml(r.ref)}</span></td>
          <td>${escapeHtml(r.label)}</td>
          <td>${escapeHtml(r.why)}${workingHtml(r)}</td>
          <td>${escapeHtml(r.fix)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
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
  return raw;
}
