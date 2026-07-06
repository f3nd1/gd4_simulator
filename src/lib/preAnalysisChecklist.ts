// Per-sub-criterion pre-analysis checklist — a non-blocking quality check that
// runs on the files a folder's pre-flight already read, BEFORE the AI audit.
//
// Every item is grounded in something the app already knows (the GD4 expected-
// evidence list, the regulatory-references / fps-rules / standard-student-
// contract skills, or the real common-ssg-finding-patterns for this PEI) — see
// each item's `source`. Nothing here is invented.
//
// STAGE ONE: real content for two items only — 4.2.2 (Fee/FPS) and 6.2.1
// (Management Review). The shape is a Record keyed by GD4 item id, so more items
// drop in incrementally without touching the detection engine or the UI.
//
// Detection is HONEST about uncertainty: when a check can't be reliably
// automated for the files present, it returns "unknown" ("check manually")
// rather than asserting a false positive/negative. Pure + dependency-free so it
// is unit-testable.

export type ChecklistSourceKind = "regulatory" | "fps" | "contract" | "gd4" | "finding-pattern";
export type ChecklistMode = "auto" | "manual";

// A file as seen by the checklist: identity + whatever extracted text the
// pre-flight warmed into the cache (null when not yet read / image / scanned).
export type DetectFile = { name: string; path: string; bucket: "policy" | "evidence" | "auto"; driveFileId?: string; text: string | null };

export type DetectStatus = "flag" | "clear" | "unknown";
export type DetectOutcome = { status: DetectStatus; message: string; fileRefs?: { name: string; driveFileId?: string }[] };

export type ChecklistItemDef = {
  id: string;
  title: string;
  description: string;
  source: string;            // citable label shown in the UI
  sourceKind: ChecklistSourceKind;
  mode: ChecklistMode;       // "auto" = the app scanned; "manual" = human judgement
  detect?: (files: DetectFile[]) => DetectOutcome; // auto items only
};

export type ChecklistItemResult = ChecklistItemDef & { outcome?: DetectOutcome };

// ── Detection helpers (pure) ────────────────────────────────────────────────

// Singapore NRIC/FIN: a letter S/T/F/G/M, seven digits, a checksum letter.
// A format match — no AI needed. Case-sensitive (real NRIC/FINs are upper-case)
// to keep false positives down.
const NRIC_RE = /\b[STFGM]\d{7}[A-Z]\b/g;
// Mask for display so we never surface a real NRIC/FIN in the UI.
function maskNric(v: string): string { return `${v[0]}${"x".repeat(v.length - 2)}${v[v.length - 1]}`; }

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Extract every parseable calendar date from text, in a few common SG formats:
// "14 March 2026", "March 14, 2026", "2026-03-14", "14/03/2026" (day-first).
export function extractDates(text: string): Date[] {
  const out: Date[] = [];
  const push = (y: number, mo: number, d: number) => {
    const dt = new Date(y, mo, d);
    if (!isNaN(dt.getTime()) && y >= 2000 && y <= 2100 && mo >= 0 && mo <= 11 && d >= 1 && d <= 31) out.push(dt);
  };
  let m: RegExpExecArray | null;
  const reDMonY = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g;
  while ((m = reDMonY.exec(text))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo != null) push(+m[3], mo, +m[1]); }
  const reMonDY = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
  while ((m = reMonDY.exec(text))) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo != null) push(+m[3], mo, +m[2]); }
  const reISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = reISO.exec(text))) push(+m[1], +m[2] - 1, +m[3]);
  const reDMY = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g; // day-first (SG convention)
  while ((m = reDMY.exec(text))) push(+m[3], +m[2] - 1, +m[1]);
  return out;
}

// The contract's signature/execution date: a date sitting next to a signing
// keyword. Returns null when none is clearly present — so the caller can say
// "couldn't determine" instead of guessing off an arbitrary date in the doc.
export function findContractSignatureDate(text: string): Date | null {
  const label = /(sign(?:ed|ature)?|executed|dated|date of (?:the )?(?:agreement|contract)|agreement date|contract date)/gi;
  let m: RegExpExecArray | null;
  while ((m = label.exec(text))) {
    const ds = extractDates(text.slice(m.index, m.index + 60));
    if (ds.length) return ds[0];
  }
  return null;
}

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const withText = (files: DetectFile[]) => files.filter((f) => (f.text ?? "").trim().length > 0);
const NO_TEXT_MSG = "No extractable text is available yet — run the folder pre-flight check (⋯ menu) first so this can scan automatically.";

// ── Detections ──────────────────────────────────────────────────────────────

function detectNric(files: DetectFile[]): DetectOutcome {
  const scannable = withText(files);
  if (scannable.length === 0) return { status: "unknown", message: NO_TEXT_MSG };
  const hits: { name: string; driveFileId?: string; sample: string }[] = [];
  for (const f of scannable) {
    const found = (f.text as string).match(NRIC_RE);
    if (found && found.length) hits.push({ name: f.name, driveFileId: f.driveFileId, sample: maskNric(found[0]) });
  }
  if (hits.length === 0) return { status: "clear", message: "No unredacted NRIC/FIN pattern found in the extracted text." };
  return {
    status: "flag",
    message: `Possible unredacted NRIC/FIN in ${hits.length} file(s) (e.g. ${hits[0].sample}). Confirm and redact before submission — NRIC/FIN is personal data under the PDPA.`,
    fileRefs: hits.map((h) => ({ name: h.name, driveFileId: h.driveFileId })),
  };
}

function detectContractSequence(files: DetectFile[]): DetectOutcome {
  const contracts = withText(files).filter((f) => /contract|agreement/i.test(f.name));
  const receipts = withText(files).filter((f) => /receipt|invoice|payment|proof of payment|official receipt/i.test(f.name));
  if (contracts.length === 0 || receipts.length === 0) {
    return { status: "unknown", message: "Couldn't identify both a student contract and a receipt to compare — check the contract-before-fee sequence manually." };
  }
  const sigDate = contracts.map((c) => findContractSignatureDate(c.text as string)).find(Boolean) ?? null;
  const receiptDates = receipts.flatMap((r) => extractDates(r.text as string));
  if (!sigDate || receiptDates.length === 0) {
    return { status: "unknown", message: "Couldn't reliably read a contract signature date and/or receipt date — check the contract-before-fee sequence manually." };
  }
  const earliestReceipt = receiptDates.reduce((a, b) => (b < a ? b : a));
  if (earliestReceipt < sigDate) {
    return {
      status: "flag",
      message: `A receipt is dated ${fmt(earliestReceipt)}, before the contract signature date ${fmt(sigDate)} — fees may have been collected before the contract was executed.`,
      fileRefs: [...contracts, ...receipts].map((f) => ({ name: f.name, driveFileId: f.driveFileId })),
    };
  }
  return { status: "clear", message: `Earliest receipt (${fmt(earliestReceipt)}) is on/after the contract signature date (${fmt(sigDate)}).` };
}

function detectManagementReviewCount(files: DetectFile[]): DetectOutcome {
  // File-name based — works from the pre-flight file list even before text is read.
  const mr = files.filter((f) => /management\s*review|mgmt\s*review|\bMR[-_ .]|review\s*minutes|minutes.*review|review.*minutes/i.test(f.name));
  if (mr.length >= 2) {
    return { status: "clear", message: `${mr.length} management-review records identified — meets the "current + preceding year" floor.`, fileRefs: mr.map((f) => ({ name: f.name, driveFileId: f.driveFileId })) };
  }
  return {
    status: "flag",
    message: mr.length === 1
      ? "Only 1 file was recognised as a management-review record — GD4 6.2.1 expects the current AND preceding year's records. Confirm the second is present."
      : "No files were recognised as management-review records by name — confirm the current and preceding year's records are in this folder.",
    fileRefs: mr.map((f) => ({ name: f.name, driveFileId: f.driveFileId })),
  };
}

// ── Definitions (keyed by GD4 item id) — extend by adding entries ────────────

const CHECKLISTS: Record<string, ChecklistItemDef[]> = {
  "4.2.2": [
    {
      id: "4.2.2-nric",
      title: "NRIC/FIN redaction in receipts & records",
      description: "NRIC/FIN is personal data under the PDPA; unredacted NRIC/FIN in fee receipts or records is a data-protection exposure. This scans the extracted text for the Singapore NRIC/FIN format.",
      source: "PDPA (Personal Data Protection Act 2012) — GD4 regulatory references",
      sourceKind: "regulatory",
      mode: "auto",
      detect: detectNric,
    },
    {
      id: "4.2.2-contract-seq",
      title: "Contract executed before fees collected",
      description: "No course/misc fees may be collected before the student contract is executed. The classic red flag is a receipt dated earlier than the contract signature date — this compares those dates when both are readable.",
      source: "Standard Student Contract — sequence rule (GD4 4.2)",
      sourceKind: "contract",
      mode: "auto",
      detect: detectContractSequence,
    },
    {
      id: "4.2.2-fps-coverage",
      title: "FPS certificate covers the fee-collection period",
      description: "FPS protection must be in place from the time the fee is collected; an FPS record dated after the receipt is a coverage gap for the interim period. Verify each per-student FPS certificate covers the amount and period of the fees collected — this needs the certificate read against the receipts.",
      source: "FPS Instruction Manual — FPS rules (GD4 4.2.2)",
      sourceKind: "fps",
      mode: "manual",
    },
  ],
  "6.2.1": [
    {
      id: "6.2.1-record-count",
      title: "Current + preceding year's review records present",
      description: "GD4 6.2.1 expects the current AND preceding year's management-review records — two annual records is the expected set. This counts files recognised as management-review records in the folder.",
      source: "GD4 Criterion 6 evidence floor (6.2.1)",
      sourceKind: "gd4",
      mode: "auto",
      detect: detectManagementReviewCount,
    },
    {
      id: "6.2.1-action-timeline",
      title: "Follow-up actions carry owners and timelines",
      description: "Approved follow-up actions must each have an owner and an execution timeline. This was a real repeat gap here (2026: 17 of 19 approved actions from Management Review 2025 had no timelines). Whether each action line carries a date and owner needs human judgement, so it's flagged for manual review.",
      source: "Known SSG finding pattern — 2026 assessment, Pattern 5",
      sourceKind: "finding-pattern",
      mode: "manual",
    },
  ],
};

// The checklist items for a folder = the union of definitions for the GD4 item
// ids it covers (only those with a definition). Empty when none defined yet.
export function checklistForItems(itemIds: string[]): ChecklistItemDef[] {
  return itemIds.flatMap((id) => CHECKLISTS[id] ?? []);
}

export function hasChecklist(itemIds: string[]): boolean {
  return itemIds.some((id) => !!CHECKLISTS[id]);
}

// Run the checklist for a folder's items over its (pre-flight-read) files.
export function runPreAnalysisChecklist(itemIds: string[], files: DetectFile[]): ChecklistItemResult[] {
  return checklistForItems(itemIds).map((d) => ({
    ...d,
    outcome: d.mode === "auto" && d.detect ? d.detect(files) : undefined,
  }));
}
