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

// One fix per REASON the file could not be read, because they are different
// problems. "Run OCR on it" is nonsense advice for an .mp4 and useless advice
// for a PDF that simply took too long, and an auditor who follows it wastes
// their afternoon.
//
// The scan route is Google Drive's own OCR, which is the only text-extraction
// tool a non-technical user already has and is licensed for: opening a PDF or
// an image with Google Docs converts it and keeps the recognised text. It is
// imperfect on poor scans, which the wording says rather than promising.
const RESCAN =
  "This is a picture of a document, so there is no text in it to read. In Google Drive, right-click the file, choose Open with, then Google Docs: Drive reads the text off the picture and makes a new document. Check it came out readable, save it into this folder, then run the check again.";
const NO_TEXT_LAYER =
  "Nothing could be read out of this file. If it is a scan or a photo, open it in Drive with Google Docs to convert it to text. If it should already be text, open it and check you can select the words, then re-save it as a Word file or a text PDF.";
const REOPEN =
  "Check the file opens for you in Google Drive and that the folder is shared with the audit account, then run the check again.";
// A file the reader gave up on. Nothing is wrong with its text; it was too big
// or too complex to finish inside the cap.
const TOO_SLOW =
  "This file took too long to read and was dropped so the rest of the check could finish. It is usually a very large or very complex PDF. Split it into smaller files, or export just the pages that matter, then run the check again.";
// Audio and video carry no text and never will. OCR cannot help, and saying so
// stops an auditor chasing a fix that does not exist.
const NO_TEXT_EVER =
  "This is a video or audio file, so it has no text for this check to read, and no conversion will change that. If it is evidence, add the written record that goes with it: minutes, a signed note, a log entry or a transcript.";

// Media has no text layer to recover, whatever the read outcome was.
function isTimeBasedMedia(rec: Pick<AuditFileRecord, "mimeType" | "name">): boolean {
  return /^(video|audio)\//i.test(rec.mimeType || "") || /\.(mp4|mov|avi|mkv|wmv|mp3|wav|m4a|aac)$/i.test(rec.name || "");
}

// A picture rather than a document: a scanned PDF, or an image file.
function isPicture(rec: Pick<AuditFileRecord, "mimeType" | "name" | "suspectedScannedPdf" | "extractedTextQuality">): boolean {
  return !!rec.suspectedScannedPdf || rec.extractedTextQuality === "none"
    || /^image\//i.test(rec.mimeType || "") || /\.(png|jpe?g|tiff?|heic|bmp|gif)$/i.test(rec.name || "");
}

// The reader gave up rather than finding nothing.
function wasTooSlow(skipReason: string | undefined): boolean {
  return /hung|auto-skipped|too long|timed? ?out/i.test(skipReason || "");
}

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
    const media = isTimeBasedMedia(rec);
    const slow = wasTooSlow(rec.skipReason);
    return {
      ...base,
      outcome: "unreadable",
      label: media ? "No text to read" : slow ? "Took too long, dropped" : "No text could be read from it",
      detail: rec.skipReason || "No extractable text.",
      action: media ? NO_TEXT_EVER : slow ? TOO_SLOW : isPicture(rec) ? RESCAN : NO_TEXT_LAYER,
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

// ── 4. The quote that arrives twice ──────────────────────────────────────
//
// Both judge prompts require the reasoning field to END with a verbatim quoted
// excerpt and its chunk id, AND to return that same passage separately:
//
//   procedure pass (agentRuntime.ts:2560-2561): fullComment is "(1) the
//     justification … then (2) a verbatim quoted excerpt in double quotes with
//     its chunk ID", and supportQuote is "the single given passage that most
//     directly documents the line, copied exactly".
//   records pass (agentRuntime.ts:3152, :3160): every negative MUST cite "a
//     given passage (quoted, with its chunk ID)" inside comment, and
//     evidenceQuote is "the single given passage that most directly proves
//     implementation for this line, copied exactly".
//
// So the duplication is real and structural, not an accident of one run. The
// page printed the prose with its trailing quote and then printed the quote
// again under "Quoted:". The engine is not being changed, so the fix is here:
// lift the TRAILING excerpt out of the prose and merge it with the explicit
// quote when they are the same passage.
//
// Only the trailing excerpt is lifted. A quote in the middle of a sentence
// ("Example: the sheet says "four attended" but the roster names six") is
// load-bearing prose, and pulling it out would leave a gap in the reasoning.

// A quoted excerpt at the very end, optionally followed by its chunk ids.
// 15 characters minimum so a two-word phrase in quotes is left in the prose.
const TRAILING_EXCERPT = /[“"]([^”"]{15,}?)[”"]\s*(?:\(\s*(C\d+(?:\s*,\s*C\d+)*)\s*\))?\s*[.;]?\s*$/;

export type SplitProse = { prose: string; quotes: { quote: string; chunkId: string }[]; cap: string };

// The engine appends its OWN deterministic block to the comment when a line is
// held below Met by a hard gate (agentRuntime.ts:3441 and :3472), separated by
// a blank line and wrapped in square brackets. It is not model prose: it is a
// different content type, it states the one thing nothing else on the row does
// (why the verdict could not be higher), and on a line with fifteen unmet
// promises it re-lists all fifteen inline — the run-on paragraph again, in a
// second place. Split off so it can be labelled and folded away.
//
// It also sat AFTER the verbatim excerpt, so the excerpt was no longer at the
// end of the string and the trailing-quote lift missed it. That is why one row
// still showed its quote twice after the first fix.
const ENGINE_CAP = /\n*\s*(\[Capped at [\s\S]*\])\s*$/;

export function splitTrailingQuotes(raw: string): SplitProse {
  let prose = (raw || "").trim();
  const capMatch = ENGINE_CAP.exec(prose);
  const cap = capMatch ? capMatch[1].trim() : "";
  if (capMatch) prose = prose.slice(0, capMatch.index).trim();
  const quotes: { quote: string; chunkId: string }[] = [];
  // A loop, because a line can end with more than one excerpt.
  for (let i = 0; i < 4; i++) {
    const m = TRAILING_EXCERPT.exec(prose);
    if (!m) break;
    quotes.unshift({ quote: m[1].trim(), chunkId: (m[2] || "").split(",")[0]?.trim() || "" });
    prose = prose.slice(0, m.index).trim();
  }
  // Never leave the cell empty: prose that is NOTHING but a quote is the whole
  // reason for the row, so it stays where it was.
  if (!prose && quotes.length > 0) return { prose: capMatch ? raw.trim().slice(0, capMatch.index).trim() : raw.trim(), quotes: [], cap };
  return { prose, quotes, cap };
}

// Same passage, decided by exact containment after normalising the things that
// legitimately differ between the two fields: curly quotes, the elision marks
// the prose excerpt uses ("…independent of the area…") and trailing
// punctuation. Deliberately NOT fuzzy similarity: a false "same passage" would
// silently drop a second, genuinely different citation, and a missed match
// only costs a repeated line an auditor can see for themselves.
const MIN_CONTAINMENT = 24;

export function normalisePassage(s: string): string {
  return (s || "")
    .replace(/[“”„]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\.{3}|…/g, " ")
    .replace(/[\s]+/g, " ")
    .replace(/^[\s"'.,;:-]+|[\s"'.,;:-]+$/g, "")
    .toLowerCase();
}

export function samePassage(a: string, b: string): boolean {
  const x = normalisePassage(a), y = normalisePassage(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  return shorter.length >= MIN_CONTAINMENT && longer.includes(shorter);
}

// The quotes a row should show, once each. The explicit citation wins on a
// duplicate because it carries the file name and is the verified-verbatim one;
// the prose excerpt is elided by the model.
export function mergeQuotes(citations: Citation[], fromProse: { quote: string; chunkId: string }[], fallbackFile: string): Citation[] {
  const out = [...citations];
  for (const p of fromProse) {
    if (out.some((c) => samePassage(c.quote, p.quote))) continue;
    out.push({ file: fallbackFile, quote: p.quote });
  }
  return out;
}

// ── 5. What ONE pass read, per tab ───────────────────────────────────────
//
// toFileRows above deliberately MERGES the two ledgers into one list, because
// the overall tab answers "what did this check read" and a file listed twice
// made the run look like it had read twice as many documents as it did.
//
// A per-tab table asks a different question: "did the procedure pass read
// everything in my procedure folder". Merging there would be the same class of
// error as merging the two passes' chunk maps — a file the records pass read
// would appear as proof the procedure pass read it. So this never merges, and
// the two functions stay separate on purpose.
//
// `cited` here means quoted in a result ON THIS TAB, taken from the run's own
// auditStatus, which each pass sets to "cited" for the chunks its verdicts
// relied on.
export function passFileRows(ledger: AuditFileRecord[] | undefined): SelfCheckFileRow[] {
  return (ledger ?? []).map(toFileRow);
}

// The tick column. Three states rather than two, because "read but nothing in
// it was quoted" is not a failure and must not read as one: plenty of files
// are in a folder without bearing on the requirement lines being checked.
export type FileCheckMark = { mark: string; label: string; tone: FileOutcome };

export function fileCheckMark(row: SelfCheckFileRow): FileCheckMark {
  if (row.outcome === "unreadable") return { mark: "✗", label: "Not read", tone: "unreadable" };
  if (row.outcome === "check") return { mark: "!", label: "Check this one", tone: "check" };
  return { mark: "✓", label: "Read", tone: "read" };
}

// ── 6. The same folder pasted into both fields ───────────────────────────
//
// Established live on 2026-09-17, not inferred: with one link in both fields
// and a folder holding the documented "1. Policy & Procedure" and "2. Actual
// Evidence" subfolders, BOTH passes take every file.
//
// The subfolder split is skipped because each pass only applies
// classifyFileBucket when its OWN link is empty and it fell back to the other
// (useWorkspaceStore.ts:1547 and :2054). Fill both and both links are
// "dedicated", so the procedure pass reads the evidence report as procedure
// and the records pass reads the procedure as a record. Every line then came
// back "documented AND evidenced", satisfied by the policy quoting itself.
//
// Display-only warning: the bucketing lives in the engine and is not changed
// here. It is not a count problem, so it is not solved by counting.
export const SAME_LINK_WARNING =
  "Both boxes above hold the SAME folder link, so every document in it was treated as your written procedure AND as your records. A requirement can then look evidenced because your procedure says it happens, not because a record shows it happening. Put your policy documents in one folder and your records in another, paste the two different links, and run the check again before relying on this result.";

// The SAME regex driveClient.parseFolderId uses, inlined rather than imported:
// driveClient instantiates a pdfjs Worker at module load and cannot be pulled
// into a Vitest file, and every consumer of this module is tested. Comparing
// folder IDs rather than strings is the point — two links to one folder differ
// by ?usp=sharing, a trailing slash or a /view suffix and are still one folder,
// and comparing normalised URLs got "different folder" wrong the first time.
function folderIdOf(link: string | undefined): string {
  const m = (link || "").match(/\/folders\/([a-zA-Z0-9_-]+)/) || (link || "").match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

export function sameFolderLink(policyLink: string | undefined, evidenceLink: string | undefined): boolean {
  const a = folderIdOf(policyLink), b = folderIdOf(evidenceLink);
  return !!a && a === b;
}

// "2 minutes 14 seconds", and honestly nothing at all when the run predates
// the field. A stored 0 would read as an instant run rather than as no record.
export function runDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  // A real run takes minutes. A sub-second one is a cached or stubbed pass, and
  // rounding it to "0 seconds" reads as a broken clock rather than as a fast
  // run, so it says what it is.
  if (ms < 1000) return "under a second";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60), sec = total % 60;
  if (m === 0) return `${sec} second${sec === 1 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"} ${sec} second${sec === 1 ? "" : "s"}`;
}
