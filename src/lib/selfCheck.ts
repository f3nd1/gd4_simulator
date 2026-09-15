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

export function plainWhy(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
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

export type SelfCheckRow = {
  ref: string;
  requirement: string;
  verdict: EvidenceVerdict;
  label: string;
  tone: string;
  why: string;
  fix: string;
};

export type SelfCheckCounts = { complies: number; partly: number; doesNot: number; couldNotCheck: number; total: number };

export function toSelfCheckRows(rows: EvidenceAssessmentRow[]): SelfCheckRow[] {
  return rows.map((r) => {
    const plain = PLAIN_VERDICT[r.verdict] ?? PLAIN_VERDICT["Not assessed"];
    return {
      ref: r.gdRef,
      requirement: r.requirementText,
      verdict: r.verdict,
      label: plain.label,
      tone: plain.tone,
      // The engine's own justification. A row whose AI call failed says so
      // rather than showing an empty cell that reads like "nothing to say".
      why: r.assessmentFailed
        ? "The checking service did not answer for this one, so nothing was judged. Run the check again."
        : plainWhy(r.comment || r.evidenceSummary || ""),
      // OFI, taken only from the engine's suggestedAction. Never written here,
      // and only ever present on a row the engine judged short.
      fix: (r.suggestedAction || "").trim(),
    };
  });
}

// The procedure pass's own rows, in the same shape, so the table, the CSV and
// the printable page are the existing ones rather than a second set.
export function toProcedureRows(rows: PPDReviewRow[]): SelfCheckRow[] {
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
    };
  });
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
  | { kind: "indicative"; band: Band; name: string; totalPct: number };

export const SELF_CHECK_HEADERS = [
  "Area", "GD4 reference", "What the requirement asks", "Result", "Why", "What to fix",
];

// One wording for the band, used by BOTH downloads so a CSV and a PDF of the
// same run can never describe the result differently.
export function bandLineOf(band: SelfCheckBand): string {
  return band.kind === "none"
    ? "No band yet for this area."
    : `${band.kind === "auditor" ? "Band set by your auditor" : "Indicative band, not yet confirmed by your auditor"}: Band ${band.band} of 5 — ${band.name} (${band.totalPct}%)`;
}

// The band and the disclaimer ride in the CSV too. A spreadsheet gets
// forwarded and printed on its own; without them it reads like a bare verdict
// list that somebody could mistake for an official outcome.
export function buildSelfCheckCsv(
  areaLabel: string, rows: SelfCheckRow[], band: SelfCheckBand, procedureOnly = false,
): string {
  const blank = ["", "", "", "", "", ""];
  const trailer = procedureOnly ? [PROCEDURE_ONLY_NOTE] : [bandLineOf(band)];
  return toCsv(SELF_CHECK_HEADERS, [
    ...rows.map((r) => [areaLabel, r.ref, r.requirement, r.label, r.why, r.fix]),
    blank,
    ...trailer.map((t) => [t, "", "", "", "", ""]),
    [SELF_CHECK_DISCLAIMER, "", "", "", "", ""],
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
  procedureOnly?: boolean;
}): string {
  const { areaLabel, areaDescription, counts, band, rows, ranAt, procedureOnly } = opts;
  const bandLine = procedureOnly ? PROCEDURE_ONLY_NOTE : bandLineOf(band);
  // Same condition as the screen: a run with nothing unjudged must not carry a
  // paragraph explaining "Could not check", which reads as a warning about a
  // result that is not there.
  const unjudgedNote = counts.couldNotCheck === 0 ? "" : mostlyUnchecked(counts) ? MOSTLY_UNCHECKED_NOTE : COULD_NOT_CHECK_NOTE;
  return `
    <h1>Self-check: ${escapeHtml(areaLabel)}${procedureOnly ? " (written procedure only)" : ""}</h1>
    <p class="muted">${escapeHtml(areaDescription)}</p>
    <p class="muted">Checked on ${escapeHtml(ranAt)}</p>
    <p><b>${counts.complies} ${procedureOnly ? "written down" : "complies"} · ${counts.partly} ${procedureOnly ? "partly written down" : "partly complies"} · ${counts.doesNot} ${procedureOnly ? "not written down" : "does not comply"} · ${counts.couldNotCheck} could not check</b></p>
    <p>${escapeHtml(bandLine)}</p>
    ${unjudgedNote ? `<p class="muted">${escapeHtml(unjudgedNote)}</p>` : ""}
    <table>
      <thead><tr><th>What the requirement asks</th><th>Result</th><th>Why</th><th>What to fix</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${escapeHtml(r.requirement)}<br><span class="muted">${escapeHtml(r.ref)}</span></td>
          <td>${escapeHtml(r.label)}</td>
          <td>${escapeHtml(r.why)}</td>
          <td>${escapeHtml(r.fix)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <p class="muted">${escapeHtml(SELF_CHECK_DISCLAIMER)}</p>
  `;
}

// Plain-English translation of the blockers a process owner can actually hit.
// Each maps to a real state the engine or the workspace is already in; none is
// invented, and none sends this person to a page written for an auditor.
export type SelfCheckBlock = { title: string; detail: string; canRun: false } | { canRun: true };

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
    };
  }
  if (!opts.hasAuditor) {
    return {
      canRun: false,
      title: "The workspace is not set up yet",
      detail: "Your audit lead needs to finish setting this workspace up before checks can run. Send them this page and ask them to add the audit team.",
    };
  }
  if (opts.aiOffline) {
    return {
      canRun: false,
      title: "The checking service is not switched on",
      detail: "Your audit lead needs to switch on the AI checking service before this can run. Ask them to do that, then come back.",
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
