// The working behind a self-check result: what was actually read, what each
// verdict rests on, and what a passing record contains.
//
// Audience here is an internal auditor who has to DEFEND a verdict to an
// external assessor, not just receive it. Everything below is read off data the
// run already stored — the two passes' file ledgers (AuditFileRecord), the
// row's own citations and promise checks, and the official GD4 expected-evidence
// list. Nothing is inferred, and nothing is written when the source is absent.

import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import type { AuditFileRecord, EvidenceAssessmentRow, PPDReviewRow } from "../types";

// ── 1. What was actually read ────────────────────────────────────────────
//
// The single most important distinction on this page: "you genuinely have no
// evidence for this" and "your evidence exists but the file could not be read"
// demand completely different actions and used to render identically.

export type FileOutcome = "read" | "check" | "unreadable";

export type FileBucketLabel = "Written procedure" | "Records" | "Both folders";

export type SelfCheckFileRow = {
  name: string;
  bucket: FileBucketLabel;
  outcome: FileOutcome;
  label: string;
  // How much came out and by what route. Empty when the file was never read.
  detail: string;
  // What to do about it. Empty when there is nothing to do.
  action: string;
  cited: boolean;
};

const RESCAN =
  "This looks like a scan or a photo rather than a text document. Run OCR on it, or re-save it as a text PDF or a Word file, then run the check again.";
const REOPEN =
  "Check the file opens for you in Google Drive and that the folder is shared with the audit account, then run the check again.";
const NO_TEXT =
  "Open the file and check you can select text in it. A scan or a photo needs OCR, or re-save it as a text PDF or a Word file, then run the check again.";

function charDetail(n: number | undefined): string {
  if (!n) return "";
  return `${n.toLocaleString("en-SG")} characters of text`;
}

// A scan the engine transcribed with the vision model. Read, but by a route
// that can miss text, so it is flagged rather than reported as a clean read.
function readDetail(rec: AuditFileRecord): string {
  const parts = [charDetail(rec.charCount)];
  if (rec.readMethod === "vision") parts.push("transcribed from page images");
  else if (rec.suspectedScannedPdf) parts.push("looks like a scanned PDF");
  if (rec.extractedTextQuality && rec.extractedTextQuality !== "high") parts.push(`text quality ${rec.extractedTextQuality}`);
  if (rec.processingMode === "reused") parts.push("reused from an earlier read");
  return parts.filter(Boolean).join(" · ");
}

export function toFileRow(rec: AuditFileRecord): SelfCheckFileRow {
  const bucket: FileBucketLabel = rec.bucket === "policy" ? "Written procedure" : "Records";
  const cited = rec.auditStatus === "cited";
  const base = { name: rec.name, bucket, cited };
  if (rec.readStatus === "failed") {
    return { ...base, outcome: "unreadable", label: "Could not be opened", detail: rec.failReason || "The file could not be opened.", action: REOPEN };
  }
  if (rec.readStatus === "skipped") {
    return {
      ...base, outcome: "unreadable", label: "No text could be read from it",
      detail: rec.skipReason || "No extractable text.",
      action: rec.suspectedScannedPdf || rec.extractedTextQuality === "none" ? RESCAN : NO_TEXT,
    };
  }
  // Listed but never reached: the run ended first. Not a clean read and not a
  // file problem, so it says which.
  if (rec.readStatus === "found" || rec.readStatus === "reading") {
    return { ...base, outcome: "unreadable", label: "Not read", detail: "The check finished or stopped before this file was read.", action: "Run the check again so this file is included." };
  }
  if (rec.readStatus === "condensed") {
    return { ...base, outcome: "check", label: "Read, then shortened", detail: [charDetail(rec.charCount), rec.summaryCharCount ? `shortened to ${rec.summaryCharCount.toLocaleString("en-SG")} characters to fit` : ""].filter(Boolean).join(" · "), action: "Only the shortened version was assessed. Split the document if something in it is missing from the result." };
  }
  const needsCheck = rec.readMethod === "vision" || rec.suspectedScannedPdf || rec.extractedTextQuality === "low" || rec.extractedTextQuality === "none";
  return {
    ...base,
    outcome: needsCheck ? "check" : "read",
    label: needsCheck ? "Read from images" : "Read",
    detail: readDetail(rec),
    action: needsCheck ? "Transcription from images can miss text. If a result looks wrong for this file, add a text version of it and run the check again." : "",
  };
}

// The two passes each keep their own ledger, and one file often appears in
// both — pasting the same folder into both fields is the documented way to use
// this page. It is listed ONCE, as "Both folders": reporting one file twice
// made the run look like it had read, and failed on, twice as many documents
// as it did, which is not something an auditor could defend.
//
// When the two passes disagree about it (read for one, unreadable for the
// other) the worse outcome wins, because that is the one with an action.
const WORSE: Record<FileOutcome, number> = { read: 0, check: 1, unreadable: 2 };

export function toFileRows(policyLedger: AuditFileRecord[] | undefined, evidenceLedger: AuditFileRecord[] | undefined): SelfCheckFileRow[] {
  const byKey = new Map<string, SelfCheckFileRow>();
  const order: string[] = [];
  for (const rec of [...(policyLedger ?? []), ...(evidenceLedger ?? [])]) {
    const key = rec.driveFileId || rec.path || rec.name;
    const row = toFileRow(rec);
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); order.push(key); continue; }
    byKey.set(key, {
      ...(WORSE[row.outcome] > WORSE[prev.outcome] ? row : prev),
      bucket: prev.bucket === row.bucket ? prev.bucket : "Both folders",
      cited: prev.cited || row.cited,
    });
  }
  return order.map((k) => byKey.get(k)!);
}

export type FileCounts = { total: number; read: number; check: number; unreadable: number; unreadableNames: string[] };

export function countFileRows(rows: SelfCheckFileRow[]): FileCounts {
  return {
    total: rows.length,
    read: rows.filter((r) => r.outcome === "read").length,
    check: rows.filter((r) => r.outcome === "check").length,
    unreadable: rows.filter((r) => r.outcome === "unreadable").length,
    unreadableNames: rows.filter((r) => r.outcome === "unreadable").map((r) => r.name),
  };
}

// Printed above the results whenever a file could not be read: every gap below
// it is then a possible read failure rather than a real absence, and an auditor
// must not file it as a gap without checking.
export function unreadableWarning(c: FileCounts): string {
  if (c.unreadable === 0) return "";
  const names = c.unreadableNames.slice(0, 4).join(", ");
  // Position-neutral wording: this sentence prints above the verdicts on screen
  // and below them in the spreadsheet.
  return `${c.unreadable} file${c.unreadable === 1 ? "" : "s"} could not be read: ${names}${c.unreadableNames.length > 4 ? ", and others" : ""}. Anything this check reports as missing may be inside ${c.unreadable === 1 ? "it" : "one of them"}. Fix them and run the check again before treating a gap as real.`;
}

// ── 2. The working behind one verdict ────────────────────────────────────

export type Citation = { file: string; quote: string };
export type MissingElement = { text: string; why: string };

export type SelfCheckWorking = {
  // The exact requirement wording that was searched for.
  lookedFor: string;
  // Verbatim excerpts that satisfied it, with the file each came from. Only
  // quotes the engine verified as real substrings are stored, so an empty list
  // on a pass is itself worth showing.
  citations: Citation[];
  // Files cited with no verified excerpt — a weaker, but real, citation.
  citedFiles: string[];
  // Named elements the records did not show. Only ever the engine's own
  // promise checks or sub-clauses, never a category invented here.
  missing: MissingElement[];
  // Why nothing could be decided, when that is the verdict.
  notCheckedReason: string;
  // True when the run produced no breakdown at all for a shortfall, so the page
  // can say that rather than implying there was nothing to break down.
  noBreakdown: boolean;
};

// No sentence on the page may claim every document was read when some could
// not be. Rewrites ONLY the sentence that makes that claim, so it can be
// applied to any row without appending a caveat where nothing was claimed.
const READ_EVERYTHING_CLAIM = /Every document in your records folder was read, and none of them mentioned (it|this requirement)\.?/i;

export function qualifyForUnreadable(why: string, unreadable: number): string {
  if (unreadable <= 0 || !why || !READ_EVERYTHING_CLAIM.test(why)) return why;
  const cleaned = why.replace(READ_EVERYTHING_CLAIM, "").trim();
  return `${cleaned ? `${cleaned} ` : ""}Every document that COULD be read was checked and none of them mentioned it, but ${unreadable} file${unreadable === 1 ? "" : "s"} could not be read, so what is missing here may be inside ${unreadable === 1 ? "it" : "one of them"}. See "What was read" above.`;
}

// The four genuinely different reasons a line can be undecided. Each has a
// different fix, and they used to render identically.
export function notCheckedReason(row: Pick<EvidenceAssessmentRow, "comment" | "assessmentFailed" | "evidenceSummary">): string {
  if (row.assessmentFailed) return "The checking service did not answer for this line. Nothing about your documents caused it. Run the check again.";
  const t = `${row.comment || ""} ${row.evidenceSummary || ""}`;
  if (/run was stopped/i.test(t)) return "The check was stopped before it reached this line. Run it again to include it.";
  if (/nothing was judged on either side|no verdict for this line/i.test(t)) return "Neither pass reached a judgement: the procedure pass returned no verdict for this line, and no passage in the records was found for it.";
  if (/none could be verified|extraction defect|could not be verified as an exact excerpt/i.test(t)) return "The tool found passages that may be relevant but could not match them word for word against the source, so it did not judge the line. That is a tool limit, not a finding about the area.";
  return "";
}

export function buildWorking(
  row: EvidenceAssessmentRow,
  ppdRow: PPDReviewRow | undefined,
  chunkFileNames: Record<string, string> | undefined,
): SelfCheckWorking {
  const fileOf = (cid: string) => chunkFileNames?.[cid] || "";
  const citations: Citation[] = [];
  if (row.evidenceQuote) {
    citations.push({ file: row.evidenceFiles?.[0]?.name || fileOf(row.evidenceChunkIds?.[0] ?? "") || "a document in your records", quote: row.evidenceQuote });
  }
  for (const pc of row.promiseChecks ?? []) {
    if (pc.verdict === "evidenced" && pc.quote) citations.push({ file: fileOf(pc.chunkId || pc.chunkIds?.[0] || "") || "a document in your records", quote: pc.quote });
  }
  const citedFiles = [...new Set([
    ...(row.evidenceFiles ?? []).map((f) => f.name),
    ...(row.evidenceChunkIds ?? []).map(fileOf),
  ])].filter(Boolean);

  const missing: MissingElement[] = [];
  for (const pc of row.promiseChecks ?? []) {
    if (pc.verdict === "evidenced") continue;
    missing.push({
      text: pc.promiseText,
      why: pc.verdict === "contradicted"
        ? `The records contradict this. ${pc.rationale || pc.evidence || ""}`.trim()
        : (pc.rationale || pc.evidence || "No record of this was found.").trim(),
    });
  }
  // The procedure side's own decomposition, used when the records side offered
  // none. Sub-clauses are what the PPD pass judged clause by clause.
  if (missing.length === 0) {
    for (const sc of ppdRow?.subClauses ?? []) {
      if (sc.verdict === "not documented") missing.push({ text: sc.text, why: "Your written procedure does not cover this part." });
    }
  }

  const isGap = row.verdict === "Partial" || row.verdict === "Not met";
  return {
    lookedFor: row.requirementText,
    citations,
    citedFiles,
    missing,
    notCheckedReason: row.verdict === "Not assessed" ? notCheckedReason(row) : "",
    noBreakdown: isGap && missing.length === 0,
  };
}

// ── 3. What a passing record contains ────────────────────────────────────
//
// The official EduTrust GD4 "expected evidence" list for the requirement ITEM
// this line belongs to, verbatim from the shipped requirement data. It is not
// line-specific and is never presented as if it were: the label says it is the
// official list for the requirement. Empty list -> the page shows nothing,
// which is the point. Nothing here is generated.
export function expectedEvidenceFor(gd4ItemId: string): string[] {
  const req = GD4_REQUIREMENTS.find((r) => r.id === gd4ItemId);
  if (!req) return [];
  const points = (req.flatAuditPoints ?? []).filter((p) => p.sourceType === "expectedEvidence").map((p) => p.text);
  return points.length > 0 ? points : (req.expectedEvidence ?? []);
}
