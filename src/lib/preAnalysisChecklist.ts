// Per-sub-criterion pre-analysis checklist — a non-blocking quality check that
// runs on the files a folder's pre-flight already read, BEFORE the AI audit.
//
// GROUNDED vs DRAFT: every item carries `verified`. `verified: true` means a
// human reviewed the exact source citation (currently only 4.2.2 and 6.2.1 —
// unchanged from the original build). `verified: false` marks a drafted
// starter item derived from the official GD4 expected-evidence list and/or a
// skill file, NOT yet human-reviewed — the UI must show this distinction
// unmissably (see the "Draft — not yet reviewed" badge in
// PreAnalysisChecklistPanel), never with the same visual confidence as a
// verified item.
//
// EDITABLE, ONE SOURCE OF TRUTH: item DEFINITIONS (this file's DEFAULT_
// CHECKLISTS) are just the seed. The live, editable copy lives in
// usePreCheckChecklistStore (persisted) — the Setup page's CRUD writes there,
// and the run-flow Pre-check step reads from there too. The functions below
// are pure and take the checklist data as a parameter so both the store and
// unit tests can exercise them without a Zustand dependency.
//
// UNIVERSAL vs PER-ITEM: most items are `scope` undefined — specific to the
// GD4 item(s) they're keyed under in ChecklistData/DEFAULT_CHECKLISTS, and
// only shown when that item has an entry. UNIVERSAL_CHECKLIST (below) is a
// SEPARATE, small array of `scope: "universal"` items that run for EVERY
// sub-criterion regardless of whether it has any per-item entries — see
// runPreAnalysisChecklist/hasChecklist, which always fold these in. Add a new
// universal check the same way as a per-item one: a detection function +
// DETECTION_REGISTRY entry + a ChecklistItemDef pushed onto the array.
//
// DETECTION REGISTRY: an item cannot persist a raw function reference (not
// serialisable), so auto items store a `detectionKey` naming one of a small,
// fixed set of detection functions; "none" means manual-only (no detection —
// the Setup page's "no automated detection" option for a new item). Detection
// itself stays HONEST about uncertainty: when a check can't be reliably
// automated for the files present, it returns "unknown" ("check manually")
// rather than asserting a false positive/negative.

export type ChecklistSourceKind = "regulatory" | "fps" | "contract" | "gd4" | "finding-pattern";
export type ChecklistMode = "auto" | "manual";
export type DetectionKey = "nric" | "date-sequencing" | "record-count" | "date-discrepancy" | "none";

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
  detectionKey: DetectionKey; // which registered detector to run; "none" for manual items
  // true = a human verified the exact source citation (4.2.2/6.2.1 only) OR
  // the Setup page's "Approve" action has since confirmed a drafted item.
  // false = a drafted starter item, not yet reviewed — must render as a
  // visibly distinct "Draft" badge everywhere, never with verified's confidence.
  verified: boolean;
  // "universal" = one of UNIVERSAL_CHECKLIST's items, applied to every
  // sub-criterion regardless of ChecklistData's per-item entries. Undefined
  // (the default) = a normal per-sub-criterion-item check.
  scope?: "universal";
};

export type ChecklistItemResult = ChecklistItemDef & { outcome?: DetectOutcome };
export type ChecklistData = Record<string, ChecklistItemDef[]>; // keyed by GD4 item id (e.g. "4.2.2")

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

// A document's OWN date — the date next to a dating/versioning/signing
// keyword, broader than findContractSignatureDate's contract-specific label
// set (adds version/effective/revised/reviewed/approved/published). Returns
// null when no such labelled date is found — never guesses from a random
// date mentioned in the body text (which could belong to something else the
// document merely refers to), so a caller can honestly say "couldn't
// determine" instead of comparing against a wrong date.
export function findDocumentDate(text: string): Date | null {
  const label = /(sign(?:ed|ature)?|executed|dated|date of (?:the )?(?:agreement|contract|issue)|agreement date|contract date|version(?:ed)?|effective(?:\s+from| date)?|revis(?:ed|ion)|review(?:ed)?(?:\s+on)?|approv(?:ed|al)(?:\s+on)?|publish(?:ed)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = label.exec(text))) {
    const ds = extractDates(text.slice(m.index, m.index + 60));
    if (ds.length) return ds[0];
  }
  return null;
}

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const withText = (files: DetectFile[]) => files.filter((f) => (f.text ?? "").trim().length > 0);
const NO_TEXT_MSG = "Waiting for files to be read — this will scan automatically once they are.";

// ── Detections (registered under a stable DetectionKey — see DETECTION_REGISTRY) ──

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

function detectDateSequencing(files: DetectFile[]): DetectOutcome {
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

function detectRecordCount(files: DetectFile[]): DetectOutcome {
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

// How close to "now" (whenever this check actually runs) counts as
// suspicious — evidence-timeliness.md's "created within 4 weeks of the audit
// submission deadline" red flag, applied at Pre-check time.
const AUDIT_PROXIMITY_DAYS = 28;

// Universal date/time discrepancy check — see UNIVERSAL_CHECKLIST below for
// why this runs for every sub-criterion. Two honest, independently-checkable
// red flags straight from evidence-timeliness.md:
//   1. A policy/procedure document dated AFTER an evidence-bucket document it
//      would logically govern (the policy may not have been in place yet).
//   2. Any document dated within AUDIT_PROXIMITY_DAYS of "now" — a sign it may
//      have been prepared for this review rather than reflecting ongoing
//      practice (on its own, neither proves nor disproves anything — it's a
//      prompt to look closer, same register as every other auto check here).
// `now` is injectable (defaults to the real clock) so this stays unit-testable
// without mocking global Date. A file whose own date can't be reliably
// identified (no dating/versioning keyword found near a date) is simply
// excluded from the comparison rather than guessed; if NONE can be
// identified, the whole check is honestly "unknown", never a false "clear".
export function detectDateTimeDiscrepancy(files: DetectFile[], now: Date = new Date()): DetectOutcome {
  const scannable = withText(files);
  if (scannable.length === 0) return { status: "unknown", message: NO_TEXT_MSG };

  const dated = scannable
    .map((f) => ({ file: f, date: findDocumentDate(f.text as string) }))
    .filter((d): d is { file: DetectFile; date: Date } => d.date !== null);

  if (dated.length === 0) {
    return { status: "unknown", message: "Couldn't reliably identify a version/signature date in any file's text — check dates manually." };
  }

  const flagMessages: string[] = [];
  const flaggedFiles = new Set<DetectFile>();
  const addFlag = (msg: string, ...fs: DetectFile[]) => {
    flagMessages.push(msg);
    fs.forEach((f) => flaggedFiles.add(f));
  };

  // Flag 1 — policy postdates evidence it would logically govern.
  const policyDated = dated.filter((d) => d.file.bucket === "policy");
  const evidenceDated = dated.filter((d) => d.file.bucket === "evidence");
  for (const p of policyDated) {
    for (const e of evidenceDated) {
      if (p.date.getTime() > e.date.getTime()) {
        addFlag(`"${p.file.name}" (dated ${fmt(p.date)}) postdates "${e.file.name}" (dated ${fmt(e.date)}) — the policy may not have been in place when this evidence was created.`, p.file, e.file);
      }
    }
  }

  // Flag 2 — a document dated suspiciously close to "now".
  for (const { file, date } of dated) {
    const diffDays = (now.getTime() - date.getTime()) / 86_400_000;
    if (diffDays >= 0 && diffDays <= AUDIT_PROXIMITY_DAYS) {
      addFlag(`"${file.name}" is dated ${fmt(date)}, only ${Math.round(diffDays)} day(s) before this check — it may have been prepared in anticipation of the review rather than reflecting ongoing practice.`, file);
    }
  }

  if (flagMessages.length > 0) {
    return {
      status: "flag",
      message: flagMessages.slice(0, 3).join(" ") + (flagMessages.length > 3 ? ` …and ${flagMessages.length - 3} more.` : ""),
      fileRefs: [...flaggedFiles].map((f) => ({ name: f.name, driveFileId: f.driveFileId })),
    };
  }
  return { status: "clear", message: `Checked ${dated.length} dated file(s) — no postdating or audit-proximity discrepancy found.` };
}

// Named registry so a persisted item can reference a detector by a stable
// string key instead of an unserialisable function reference. Add a new
// detector here (and a new DetectionKey) rather than inline in an item.
const DETECTION_REGISTRY: Partial<Record<DetectionKey, (files: DetectFile[]) => DetectOutcome>> = {
  "nric": detectNric,
  "date-sequencing": detectDateSequencing,
  "record-count": detectRecordCount,
  "date-discrepancy": (files) => detectDateTimeDiscrepancy(files),
};

// ── Pure query helpers — take the (store-held) checklist data as a parameter ──

// The checklist items for a folder = the union of definitions for the GD4 item
// ids it covers (only those with a definition). Empty when none defined yet.
export function checklistForItems(checklists: ChecklistData, itemIds: string[]): ChecklistItemDef[] {
  return itemIds.flatMap((id) => checklists[id] ?? []);
}

// Always true while UNIVERSAL_CHECKLIST is non-empty — the universal layer
// applies to every sub-criterion regardless of per-item entries. Kept as a
// real check (not a hardcoded `true`) so an empty UNIVERSAL_CHECKLIST falls
// back to the old per-item-only behaviour instead of silently lying.
export function hasChecklist(checklists: ChecklistData, itemIds: string[]): boolean {
  return UNIVERSAL_CHECKLIST.length > 0 || itemIds.some((id) => (checklists[id]?.length ?? 0) > 0);
}

// Run the checklist for a folder's items over its (already-read) files —
// UNIVERSAL_CHECKLIST's items ALWAYS run first, followed by whatever
// per-item entries this folder's GD4 items have defined (if any).
export function runPreAnalysisChecklist(checklists: ChecklistData, itemIds: string[], files: DetectFile[]): ChecklistItemResult[] {
  const all = [...UNIVERSAL_CHECKLIST, ...checklistForItems(checklists, itemIds)];
  return all.map((d) => {
    const detect = d.mode === "auto" ? DETECTION_REGISTRY[d.detectionKey] : undefined;
    return { ...d, outcome: detect ? detect(files) : undefined };
  });
}

// Which of this sub-criterion's items are currently "flagged" — an auto
// detection that returned "flag", or a manual item the auditor ticked via
// the Pre-check step's checkbox (PreAnalysisChecklistPanel's markKey scheme:
// `${subCriterionId}::${item.id}`). This is the SAME rule
// runEvidenceAssessment uses to decide what becomes a "Pre-check flags"
// prompt hint (advisory context, never a verdict override) — factored out
// here so any other caller (e.g. the Evidence tab's arrival action panel)
// reuses this single definition of "flagged" instead of re-deriving its own.
export type PreCheckFlagSummary = { flagsByItemId: Record<string, string[]>; totalCount: number };

export function computeFlaggedPreCheckItems(
  checklists: ChecklistData,
  preChecks: Record<string, boolean>,
  subCriterionId: string,
  itemIds: string[],
  files: DetectFile[]
): PreCheckFlagSummary {
  const flagsByItemId: Record<string, string[]> = {};
  let totalCount = 0;
  for (const itemId of new Set(itemIds)) {
    const results = runPreAnalysisChecklist(checklists, [itemId], files);
    const flagged = results.filter((item) =>
      item.mode === "auto" ? item.outcome?.status === "flag" : !!preChecks[`${subCriterionId}::${item.id}`]
    );
    if (flagged.length > 0) {
      flagsByItemId[itemId] = flagged.map((f) => `${f.title}: ${f.mode === "auto" ? (f.outcome?.message ?? f.description) : f.description}`);
      totalCount += flagged.length;
    }
  }
  return { flagsByItemId, totalCount };
}

// ── Universal checks — a SEPARATE layer from DEFAULT_CHECKLISTS/ChecklistData,
// applied to every sub-criterion regardless of whether it has any per-item
// entries (see runPreAnalysisChecklist/hasChecklist above). All items here are
// genuinely tested, general-purpose detection logic — not a per-sub-criterion
// draft guess — so they start `verified: true`. Add a new universal check the
// same way as a per-item one: a detection function + DETECTION_REGISTRY entry
// + a ChecklistItemDef pushed onto this array.
export const UNIVERSAL_CHECKLIST: ChecklistItemDef[] = [
  {
    id: "universal-date-discrepancy",
    title: "Date/time discrepancy check",
    description: "Scans this sub-criterion's files for two honest red flags: (1) a policy/procedure document dated AFTER evidence it would logically govern, and (2) any document dated suspiciously close to this review (within 4 weeks) — a sign it may have been prepared for the audit rather than reflecting ongoing practice. Runs on every sub-criterion, whether or not it has its own specific checks.",
    source: "evidence-timeliness.md — document-dating red flags (applied universally)",
    sourceKind: "finding-pattern",
    mode: "auto",
    detectionKey: "date-discrepancy",
    verified: true,
    scope: "universal",
  },
];

// ── Seed content — stage 1 (4.2.2, 6.2.1) verified; stage 2 drafts elsewhere ──
// Every item is grounded in something the app already knows (the GD4 expected-
// evidence list, the regulatory-references / fps-rules / standard-student-
// contract skills, or the real common-ssg-finding-patterns for this PEI) — see
// each item's `source`. Nothing here is invented. This is the SEED only —
// usePreCheckChecklistStore holds the live, user-editable copy.

export const DEFAULT_CHECKLISTS: ChecklistData = {
  "4.2.2": [
    {
      id: "4.2.2-nric",
      title: "NRIC/FIN redaction in receipts & records",
      description: "NRIC/FIN is personal data under the PDPA; unredacted NRIC/FIN in fee receipts or records is a data-protection exposure. This scans the extracted text for the Singapore NRIC/FIN format.",
      source: "PDPA (Personal Data Protection Act 2012) — GD4 regulatory references",
      sourceKind: "regulatory",
      mode: "auto",
      detectionKey: "nric",
      verified: true,
    },
    {
      id: "4.2.2-contract-seq",
      title: "Contract executed before fees collected",
      description: "No course/misc fees may be collected before the student contract is executed. The classic red flag is a receipt dated earlier than the contract signature date — this compares those dates when both are readable.",
      source: "Standard Student Contract — sequence rule (GD4 4.2)",
      sourceKind: "contract",
      mode: "auto",
      detectionKey: "date-sequencing",
      verified: true,
    },
    {
      id: "4.2.2-fps-coverage",
      title: "FPS certificate covers the fee-collection period",
      description: "FPS protection must be in place from the time the fee is collected; an FPS record dated after the receipt is a coverage gap for the interim period. Verify each per-student FPS certificate covers the amount and period of the fees collected — this needs the certificate read against the receipts.",
      source: "FPS Instruction Manual — FPS rules (GD4 4.2.2)",
      sourceKind: "fps",
      mode: "manual",
      detectionKey: "none",
      verified: true,
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
      detectionKey: "record-count",
      verified: true,
    },
    {
      id: "6.2.1-action-timeline",
      title: "Follow-up actions carry owners and timelines",
      description: "Approved follow-up actions must each have an owner and an execution timeline. This was a real repeat gap here (2026: 17 of 19 approved actions from Management Review 2025 had no timelines). Whether each action line carries a date and owner needs human judgement, so it's flagged for manual review.",
      source: "Known SSG finding pattern — 2026 assessment, Pattern 5",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: true,
    },
  ],

  // ── Stage 2 — DRAFT items for the remaining sub-criteria ──────────────────
  // Every item below is `verified: false`: drafted from the official GD4
  // describeShow/notes text (gd4Requirements.ts) and/or a skill file, but NOT
  // yet human-reviewed against a real audit finding the way 4.2.2/6.2.1 were.
  // The UI must render these with a visibly distinct "Draft" badge — never
  // with verified's confidence. 5.3.1 (Partnerships) is deliberately absent:
  // no numeric, dated, or named-finding hook exists for it in any source read
  // (describeShow/notes/9 skill files) — forcing an item there would be
  // inventing a rule with no basis, so it's left with no draft content.

  "1.1.1": [
    {
      id: "1.1.1-audit-cert",
      title: "Financial statements externally audited (ACRA)",
      description: "GD4 1.1.1 notes: annual financial statements should be certified by an independent external auditor per ACRA Companies Act guidelines. Confirm the certification is present, current, and the auditor is independent of the PEI's management/ownership.",
      source: "GD4 1.1.1 notes — ACRA external audit certification",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
    {
      id: "1.1.1-current-preceding",
      title: "Current + preceding year's financial statements present",
      description: "Monitoring financial statements \"regularly\" implies more than a single snapshot — confirm both the current and preceding year's certified statements are in the folder, not just the latest one.",
      source: "GD4 1.1.1 expected evidence — Annual financial statements / external audit certification",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "1.2.1": [
    {
      id: "1.2.1-current-preceding",
      title: "Current + preceding year's strategic plan present",
      description: "A strategic plan reviewed \"for continual improvement\" implies a cycle, not a one-off document. Confirm both the current and preceding year's strategic plan (and review records) are present — a plan dated just before the audit with no prior cycle in evidence is a red flag.",
      source: "GD4 1.2.1 expected evidence — Strategic plan review records",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.1.1": [
    {
      id: "2.1.1-appraisal-coverage",
      title: "Appraisal run for ALL staff, including academic staff",
      description: "A recurring finding pattern here is an appraisal system documented but not actually run for academic staff. Confirm appraisal records cover the full staff list (not a sample) and specifically include academic staff, not just non-academic/admin roles.",
      source: "common-ssg-finding-patterns.md — Pattern 2 (appraisal system documented but not run for academic staff)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.1.2": [
    {
      id: "2.1.2-pre-post-assessment",
      title: "Training effectiveness measured with pre/post assessment",
      description: "GD4 2.1.2 requires monitoring and analysing training \"adequacy and effectiveness ... transfer of learning to performance at work\" — not just attendance. Confirm at least one academic and one non-academic training record shows a pre/post assessment or on-the-job effectiveness check, not just a certificate of attendance.",
      source: "GD4 2.1.2 describeShow — training effectiveness/transfer of learning",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.2.1": [
    {
      id: "2.2.1-review-sample",
      title: "Internal communication reviewed with stakeholder samples",
      description: "GD4 2.2.1 requires a review of the internal communication process \"for continual improvement.\" Confirm the review draws on actual samples of communication sent to staff/students/stakeholders, not just a policy restated without evidence of what was actually communicated.",
      source: "GD4 2.2.1 describeShow — review of internal communication process",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.2.2": [
    {
      id: "2.2.2-approval-before-publication",
      title: "Advertisement approval dated BEFORE publication",
      description: "GD4 2.2.2 requires Management vetting and approval \"prior to publication.\" Check the approval date against the publication/posting date for each sampled advertisement — an approval dated after the ad already went live is a sequencing red flag, the same shape as the 4.2.2 contract-before-fee check.",
      source: "GD4 2.2.2 describeShow — vetting and approval by Management prior to publication",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.3.1": [
    {
      id: "2.3.1-pdpa-breach",
      title: "PDPA breach-notification timeline honoured",
      description: "GD4 2.3.1 requires compliance with the Personal Data Protection Act. Where a data-security incident or breach is on file, confirm PDPC was notified within the PDPA's statutory window and affected individuals were notified as required.",
      source: "PDPA (Personal Data Protection Act 2012) — GD4 2.3.1 notes",
      sourceKind: "regulatory",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.3.2": [
    {
      id: "2.3.2-version-control",
      title: "Policy manuals show real revision history, not v0",
      description: "A recurring finding pattern here was three policies still at version 0 — document control existed on paper but was never actually operated. Confirm sampled policy/operations manuals show an actual revision history (version number, date, approver) rather than a single unrevised draft.",
      source: "common-ssg-finding-patterns.md — named finding (three policies at V0)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.4.1": [
    {
      id: "2.4.1-sla-consistency",
      title: "Feedback/complaint resolution SLA is consistent across documents",
      description: "A recurring finding pattern here was a contradiction between stated feedback SLAs (e.g. \"5 working days\" in one document vs \"3 working days\" in another). Check the feedback/dispute-resolution policy, student handbook, and any published SLA all state the same resolution timeframe.",
      source: "common-ssg-finding-patterns.md — named finding (feedback SLA contradiction)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.4.2": [
    {
      id: "2.4.2-survey-coverage",
      title: "Survey covers all 9 required topic areas",
      description: "GD4 2.4.2 lists 9 specific topics the student satisfaction survey must cover (overall satisfaction, support services, facilities, communication, course counselling, teaching-learning resources, academic staff performance, pre-course counselling, assessment methods/frequency). Check the survey instrument against this list — a survey missing even one topic is a coverage gap, not just a minor omission.",
      source: "GD4 2.4.2 describeShow — 9-item survey coverage list",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "2.4.3": [
    {
      id: "2.4.3-part-time-coverage",
      title: "Part-time staff included in the staff satisfaction survey",
      description: "A recurring finding pattern here was part-time staff being excluded from the staff satisfaction survey, even though GD4 2.4.3 requires the survey to cover \"all staff.\" Confirm the survey distribution list/respondent count includes part-time as well as full-time staff.",
      source: "common-ssg-finding-patterns.md — named finding (part-time staff excluded from staff survey)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "3.1.1": [
    {
      id: "3.1.1-agent-list-vs-intake",
      title: "Published agent list matches actual student-intake records",
      description: "GD4 3.1.1 requires an up-to-date agent list published on the website, including agents no longer representing the PEI with an effective end date. Cross-check the published list against intake records — a student recruited through an agent not on the current list (or recruited after that agent's end date) is a direct compliance gap.",
      source: "GD4 3.1.1 describeShow — up-to-date published agent list",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "3.2.1": [
    {
      id: "3.2.1-eval-acted-on",
      title: "Agent evaluation findings actually acted on",
      description: "GD4 3.2.1 requires agents to be evaluated \"before contract renewal,\" but an evaluation that surfaces issues with no follow-up action is a closed-loop failure, not a compliant evaluation. Confirm at least one sampled agent evaluation with a negative finding shows a corresponding action (retraining, warning, non-renewal) rather than being filed with no consequence.",
      source: "GD4 3.2.1 describeShow — agent evaluation before contract renewal",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.1.1": [
    {
      id: "4.1.1-counselling-before-contract",
      title: "Pre-course counselling record predates the student contract",
      description: "Pre-course counselling is meant to inform a student's decision to enrol, so it should be dated on or before the student contract's signature date. A counselling record dated after the contract is signed suggests the counselling was a formality rather than genuinely informing the decision — the same sequencing check as the 4.2.2 contract-before-fee rule.",
      source: "GD4 4.1.1 describeShow — pre-course counselling prior to admission",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.2.1": [
    {
      id: "4.2.1-cooling-off",
      title: "Cooling-off period is at least 7 working days",
      description: "GD4 4.2.1 requires the student contract to stipulate a cooling-off period of at least 7 working days, and the Standard Student Contract must be used. Confirm the sampled contract's cooling-off clause states at least 7 working days and matches the SSG Standard Student Contract wording.",
      source: "GD4 4.2.1 describeShow/notes — 7 working-day cooling-off period; SSG Standard Student Contract",
      sourceKind: "contract",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
    {
      id: "4.2.1-transfer-deferment-addendum",
      title: "New contract/addendum issued on module repeat, transfer or deferment",
      description: "GD4 4.2.1 requires a new contract or addendum when a student repeats a module or has an approved transfer/deferment. Where a transfer/deferment/repeat record exists, confirm a corresponding new contract or addendum is on file, not just the original contract.",
      source: "GD4 4.2.1 describeShow — new contract/addendum on repeat, transfer or deferment",
      sourceKind: "contract",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.3.1": [
    {
      id: "4.3.1-4-week-deadline",
      title: "Transfer/deferment/withdrawal processed within 4 weeks",
      description: "GD4 4.3.1 sets a maximum processing time of not more than 4 weeks from the student's request to informing the student of the outcome in writing. Named 2025 AFIs here included a new Standard Student Contract not issued on transfer, and an FPS lapse during deferment — check both the 4-week deadline and that a new SSC/FPS coverage were actually put in place.",
      source: "GD4 4.3.1 describeShow — 4-week maximum processing time; 2025 AFI patterns",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.4.1": [
    {
      id: "4.4.1-7-day-refund",
      title: "Refund issued within 7 working days",
      description: "GD4 4.4.1 requires refunds to be issued within 7 working days of the withdrawal/refund request. This has been a repeat AFI here (2025 and 2026: Clause 3.8 cooling-off refund timeline mismatch). Check the request date against the refund-issued date for each sampled case against the 7-working-day ceiling.",
      source: "GD4 4.4.1 describeShow — 7 working-day refund deadline; repeat 2025/2026 AFI (Clause 3.8)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.5.1": [
    {
      id: "4.5.1-effectiveness-eval",
      title: "Student support services evaluated for effectiveness, not just offered",
      description: "A recurring blind spot here is student support services being listed and delivered but never actually evaluated for effectiveness. Confirm the review records show an actual evaluation (uptake, outcomes, student feedback) of the support services and programmes, not just a list of what's offered.",
      source: "GD4 4.5.1 describeShow — evaluate and review student support services",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "4.6.1": [
    {
      id: "4.6.1-attendance-threshold",
      title: "Attendance monitored against the Student's Pass 90% threshold",
      description: "Student's Pass holders are subject to a 90% attendance requirement, and any material drop in attendance for such a student must be reported to ICA within 3 working days. Confirm attendance records for Student's Pass holders are checked against the 90% floor and that any required ICA report was made within the 3-working-day window.",
      source: "regulatory-references.md — 90% Student's Pass attendance threshold; 3-working-day ICA reporting deadline",
      sourceKind: "regulatory",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.1.1": [
    {
      id: "5.1.1-academic-board-substance",
      title: "Academic Board approval shows substantive review, not rubber-stamping",
      description: "A recurring pattern here is an Academic Board that exists on paper but approves course design without substantive discussion (a \"rubber stamp\"). Check Academic Board minutes for evidence of actual discussion/challenge on the course's learning objectives, outcomes and assessment plan — not just a recorded approval vote.",
      source: "criterion-5-academic.md — Academic Board rubber-stamping pattern",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.1.2": [
    {
      id: "5.1.2-review-inputs-complete",
      title: "Course review uses ALL required inputs, not a subset",
      description: "GD4 5.1.2 lists specific inputs a course review must gather: stakeholder input, module assessment results, student AND academic staff feedback, trend data and benchmarks. A recurring blind spot is a review that covers some of these but quietly omits one (commonly: trend/benchmark data or academic-staff feedback). Check each named input is actually present in the review record.",
      source: "GD4 5.1.2 describeShow — enumerated course-review inputs",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.2.1": [
    {
      id: "5.2.1-staff-qualification-match",
      title: "Assigned academic staff qualified for the specific module",
      description: "GD4 5.2.1 requires course planning to provide \"qualified academic ... staff.\" Cross-check the staff assigned to a sampled course/module against their stated qualifications — an assignment outside a lecturer's qualified subject area is a planning gap, not just a resourcing note.",
      source: "GD4 5.2.1 describeShow — qualified academic staff for course planning",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.2.2": [
    {
      id: "5.2.2-underperformance-followup",
      title: "Under-performing academic staff have a documented intervention",
      description: "A recurring blind spot here is academic staff performance being evaluated (an appraisal on file) but no intervention trail for staff whose delivery/evaluation was weak. Where a sampled staff evaluation is below standard, confirm a corresponding intervention action (coaching, monitoring plan, re-training) is on file — not just the filed appraisal.",
      source: "common-ssg-finding-patterns.md — named blind spot (under-performing academic staff monitoring)",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.4.1": [
    {
      id: "5.4.1-intervention-effectiveness",
      title: "Learning-support intervention effectiveness is evaluated",
      description: "GD4 5.4.1 requires evaluating intervention measures \"for effectiveness and improvement\" — a recurring blind spot is intervention records existing with no evaluation step. Also check progress reports cover BOTH academic and non-academic achievement categories named in describeShow, not just one.",
      source: "GD4 5.4.1 describeShow — evaluate intervention measures for effectiveness",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "5.5.1": [
    {
      id: "5.5.1-appeal-window",
      title: "Assessment appeal window is at least 7 working days",
      description: "GD4 5.5.1 notes require at least 7 working days from the release of assessment results for a student to submit an appeal. Confirm the assessment policy/results notice states at least 7 working days, and check moderation records show every summative assessment was moderated (external moderation required above Level 3) and papers/results were approved by the Examination Board, not released by an administrator.",
      source: "GD4 5.5.1 notes — 7 working-day appeal window; regulatory-references.md moderation rule",
      sourceKind: "regulatory",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "6.1.1": [
    {
      id: "6.1.1-auditor-independence",
      title: "Internal assessors are independent of the area they assessed",
      description: "A named 2025 AFI here was internal assessment staffed by people not independent of the area being assessed. Cross-check who conducted each internal assessment against who owns/manages that area. Also treat a zero-finding internal assessment across the whole institution as a red flag suggesting a tick-box exercise rather than genuine assurance.",
      source: "common-ssg-finding-patterns.md — 2025 AFI (assessor independence); ISO 9001:2015 cl.9.2",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "6.3.1": [
    {
      id: "6.3.1-investment-and-outcome",
      title: "Innovation shows real investment AND a measured outcome",
      description: "A recurring blind spot here is an \"innovation\" section that lists intentions with no funding behind them, or funded initiatives with no evaluated outcome. Confirm current + preceding year's improvement-plan records show both actual resourcing (budget, technology, staff time) and an evaluation of the effectiveness of what was implemented.",
      source: "GD4 6.3.1 describeShow — invest in resources; evaluate effectiveness of innovation",
      sourceKind: "gd4",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
  "7.1.1": [
    {
      id: "7.1.1-denominator-stated",
      title: "Every outcome statistic states its sample size / response rate",
      description: "A headline outcome figure (e.g. satisfaction or employment rate) with no stated response rate or sample size cannot be verified as representative — a 95% figure on a 10% response rate is not the same as 95% on a full census. Check each outcome statistic in the folder states its denominator, and that at least 2-3 cycles of trend data are shown (a single year's figure cannot demonstrate improvement).",
      source: "criterion-7-outcomes.md — denominator/response-rate rule; 2-3 cycle trend minimum",
      sourceKind: "finding-pattern",
      mode: "manual",
      detectionKey: "none",
      verified: false,
    },
  ],
};
