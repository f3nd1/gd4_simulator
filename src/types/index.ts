// Data model per UCC EduTrust GD4 Audit Workspace Requirements Guide, section 8.
// Extended with a few records the guide describes in section 7 but does not
// give a TS shape for (folders, AI review log, management review items,
// version history, export log).

export type CycleStatus =
  | "Draft"
  | "Under Review"
  | "Returned for Amendment"
  | "Ready for Management Review"
  | "Finalised"
  | "Locked";

export type AuditCycle = {
  id: string;
  name: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  evidenceCutOffDate: string;
  scope: string;
  status: CycleStatus;
  owner: string;
  version: string;
  lastSavedAt: string;
  createdAt: string;
  updatedAt: string;
  driveRoot?: string;
};

// Workspace-wide department directory. Referenced by id from AuditorProfile
// and anywhere else a department needs to be selected rather than typed as
// free text.
export type Department = {
  id: string;
  acronym: string;
  fullName: string;
  personInCharge: string;
};

export type AuditorType = "Internal" | "External" | "AI Agent";

export type AuditorProfile = {
  id: string;
  auditCycleId: string;
  name: string;
  type: AuditorType;
  departmentId?: string;
  role: string;
  strictness: number;
  focusArea: string;
  checklistTemplateId: string;
};

export type GD4SubCriterion = {
  id: string;
  criterionId: string;
  title: string;
  description: string;
};

export type GD4Requirement = {
  id: string;
  criterion: string;
  area: string;
  subCriterionId: string;
  itemNumber: string;
  requirement: string;
  intent: string;
  describeShow: string[];
  notes: string[];
  maxPoints: number;
  weightage: number;
  gateSensitive: boolean;
  expectedEvidence: string[];
  bandDescriptors: Record<string, string>;
  scoringNotes?: string;
  flatAuditPoints?: FlatAuditPoint[];
};

export type SourceSystem = "SMS" | "ERPNext" | "Google Drive" | "Helpdesk" | "LMS" | "Manual";
export type ApprovalStatus = "Approved" | "Pending" | "Not Required" | "Missing";
export type ReviewStatus = "Reviewed" | "Pending" | "Not Reviewed";

export type EvidenceItem = {
  id: string;
  auditCycleId: string;
  gd4ItemId: string;
  title: string;
  evidenceType: string;
  sourceSystem: SourceSystem;
  link?: string;
  owner: string;
  evidenceDate: string;
  version?: string;
  approvalStatus: ApprovalStatus;
  reviewStatus: ReviewStatus;
  strengthScore: number;
  traceabilityScore: number;
};

export type EvidenceStatus = "Good" | "In Progress" | "Partial" | "Missing" | "Critical";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type EvidenceMapping = {
  id: string;
  auditCycleId: string;
  gd4ItemId: string;
  policyProcedure?: string;
  implementationEvidenceIds: string[];
  reviewEvidenceIds: string[];
  outcomeEvidenceIds: string[];
  evidenceStatus: EvidenceStatus;
  gap?: string;
  risk: RiskLevel;
  actionNeeded?: string;
};

export type Band = 1 | 2 | 3 | 4 | 5;
export type Confidence = "Low" | "Medium" | "High";

export type CriterionScore = {
  id: string;
  auditCycleId: string;
  gd4ItemId: string;
  maxPoints: number;
  aiSuggestedScore: number;
  reviewerDraftScore: number;
  confirmedScore?: number;
  officialScore?: number;
  band: Band;
  confidence: Confidence;
  justification: string;
  overrideJustification?: string;
};

export type FindingType = "Observation" | "Improvement Action" | "Quality Action" | "AFI" | "Critical Readiness Risk";
export type Severity = "Low" | "Medium" | "High" | "Critical";
export type FindingStatus = "Open" | "In Progress" | "Submitted for Review" | "Closed" | "Escalated";

// Checklist-line-status-driven classification (NC/OFI/OBS + Major/Minor).
// Deliberately named `findingType`/`ncSeverity` rather than reusing the
// existing `type`/`severity` fields above — those already carry unrelated,
// widely-used semantics (manual finding category; Low/Medium/High/Critical
// severity feeding Dashboard/reports/scoring displays), and giving them a
// second, incompatible meaning would either break TypeScript or silently
// corrupt every one of those existing call sites.
export type FindingTypeCode = "NC" | "OFI" | "OBS";
export type NcSeverity = "Major" | "Minor";

// Which side of the rubric a finding sits on, mapped from the APSR dimension
// that fell short: Approach → "Procedure" (the documented policy), Processes →
// "Evidence" (implementation records), Systems & Outcomes → "Outcomes", Review
// → "Review". "Unverified" is a line marked done with no evidence attached.
// Lets the Findings register show, at a glance, whether a gap is in the
// procedure documents or in the actual evidence of implementation.
export type FindingDimension = "Procedure" | "Evidence" | "Outcomes" | "Review" | "Unverified";

export type Finding = {
  id: string;
  auditCycleId: string;
  gd4ItemId: string;
  issue: string;
  type: FindingType;
  severity: Severity;
  owner: string;
  dueDate: string;
  repeatFinding: boolean;
  overdue: boolean;
  managementDecisionNeeded: boolean;
  evidenceReference?: string;
  aiComment?: string;
  humanComment?: string;
  status: FindingStatus;
  // Provenance + detailed report, populated when a finding is raised from a
  // checklist line / folder audit (undefined on a plain manual finding).
  source?: "Audit" | "Checklist" | "Manual" | "Seed" | "ai_audit" | "PPD Review";
  auditRunId?: string;  // e.g. "AR-6.3-3YVF" — set when auto-raised from a folder audit run
  dimension?: FindingDimension;
  // Risk category: A = regulatory breach (SSG mandatory requirement, can
  // trigger enforcement), B = Star-disqualifying (Criterion 7 or
  // gate-sensitive, blocks 4-Year Star), C = band-limiting (caps the band but
  // not a compliance breach), D = enhancement (improvement opportunity,
  // not blocking).
  riskCategory?: "A" | "B" | "C" | "D";
  clause?: string;
  // Structured finding body — populated automatically on audit-raised findings
  // and via AI draft / manual entry on the Findings form.
  observation?: string;  // what was found: WHO, WHAT, WHEN, HOW MANY
  criteria?: string;     // what the GD4 standard requires (cited to clause)
  effect?: string;       // regulatory / certification consequence
  rootCause?: string;
  corrective?: string;
  preventive?: string;
  apsr?: ApsrBreakdown;
  // Checklist-line-status classification — set automatically when a finding
  // is raised from a checklist line (see confirmDraftFinding). Optional so
  // findings raised before this existed, and non-checklist findings (manual
  // form, seed data, grouped AI writer), keep working unchanged; resolve with
  // resolveFindingType()/resolveNcSeverity() (lib/findingClassification.ts)
  // for a defaulted read — NC / Minor-if-NC / null-otherwise.
  findingType?: FindingTypeCode;
  ncSeverity?: NcSeverity | null;
  // Traceability to the checklist lines that generated this finding via the
  // grouped-finding path (absent on single-line / manual findings).
  linkedChecklistLineIds?: string[];
  linkedSourceRefs?: string[];
  linkedSourceTexts?: string[];
  evidenceStatusSummary?: string;
  groupedFindingId?: string;
  createdFromAuditRunId?: string;
  createdAt?: string;
};

// Two-layer sub-criterion checklist module: a generic 4-line maturity check
// (Layer 1, fixed per the four rubric lenses) plus AI-generated/seeded atomic
// testable statements (Layer 2) per GD4 item, used to compute a band that
// feeds back into the official scoring engine (see lib/checklistBanding.ts).
export type ChecklistLineStatus = "Met" | "Partial" | "Not met";
export type GenericLineStatus = ChecklistLineStatus | "Not Started";
export type SpecificLineStatus = ChecklistLineStatus | "Not Applicable" | "Not Started";
export type EvidenceSufficiency = "Present" | "Weak" | "Missing";

// APSR breakdown for one checklist line, produced by the folder audit, using
// the official EduTrust Scoring Rubric dimensions (GD4 section 23):
//   - Approach: documented policies and procedures (methods, tools, techniques)
//   - Processes: actual implementation of those policies and procedures
//   - Systems & Outcomes: desired outcomes derived from that implementation
//   - Review: evaluation of appropriateness, relevance and effectiveness for
//     continual improvement
// Persisted on the evidence item so a finding raised later can explain the
// ROOT CAUSE (which APSR dimension fell short) rather than just "not met".
// Status words echo the rubric band descriptors (Not evident → Excellent).
export type ApsrBreakdown = {
  approach: { status: "Meeting" | "Beginning" | "Not evident"; note: string; sourceChunkIds?: string[] };
  processes: { status: "Deployed" | "Weak" | "Not evident"; note: string; sourceChunkIds?: string[] };
  systemsOutcomes: { status: "Evident" | "Limited" | "Not evident"; note: string; sourceChunkIds?: string[] };
  review: { status: "Evident" | "Not evident"; note: string; sourceChunkIds?: string[] };
};

export type SubChecklistEvidenceItem = {
  id: string;
  title: string;
  type: string;
  drive?: string;
  owner: string;
  date: string;
  approved: boolean;
  reviewed: boolean;
  sufficiency: EvidenceSufficiency;
  // Set when this evidence item was copied here via "Reuse in another
  // sub-criterion" from a different line, so the UI can show its origin.
  sharedFrom?: string;
  // Free-text auditor note on this evidence item: justify the sufficiency
  // verdict, record strengths/weaknesses/gaps, or suggest how to close a gap.
  auditorNote?: string;
  // Structured APSR assessment (Approach, Processes, Systems & Outcomes,
  // Review) from the folder audit (when live), kept so a finding raised from
  // this line can name which rubric dimension fell short.
  apsr?: ApsrBreakdown;
  // Audit-run id (e.g. "AR-1.2-K9QZ") when this item was created by a folder
  // audit, so it can be traced to the matching result row, AI Review Log entry
  // and journal entry. Also records that an AI run produced it, not a human.
  runId?: string;
};

export type SamplingInfo = {
  population?: number;
  sampleSize?: number;
  sampleIds?: string;
};

export type DraftFindingInfo = {
  gd4ItemId: string;
  clause?: string;
  issue: string;
  severity: Severity;
  suggestedAction: string;
  savedFindingId?: string;
  // Structured finding body — same fields as on Finding, auto-populated from
  // the APSR breakdown and the GD4 requirement when a draft is built.
  observation?: string;
  criteria?: string;
  effect?: string;
  // In-depth analysis derived from the APSR dimension that fell short.
  rootCause?: string;
  corrective?: string;
  preventive?: string;
  dimension?: FindingDimension;
  // Risk category — same meaning as on Finding.
  riskCategory?: "A" | "B" | "C" | "D";
  auditRunId?: string;
  // NC/OFI/OBS classification — same meaning as on Finding, computed from the
  // checklist line's status when the draft is built (buildDraftFinding).
  findingType?: FindingTypeCode;
  ncSeverity?: NcSeverity | null;
};

// A set of related failing checklist lines from one GD4 item, grouped by
// the type of gap they share. Produced by findingGrouper.ts and consumed by
// useFindingDraftStore.ts. Not persisted directly — reconstructed each run.
export type ChecklistLineGroup = {
  gd4ItemId: string;
  subCriterionId: string;
  gapType:
    | "Documentation/Approach"
    | "Implementation/Process"
    | "Outcome/Data"
    | "Review/ContinualImprovement"
    | "EvidenceTraceability";
  primaryApsrDimension: "Approach" | "Processes" | "Systems & Outcomes" | "Review";
  lines: SpecificChecklistLine[];
  sourceRefs: string[];
  sourceTexts: string[];
  severity: Severity;
  riskCategory: "A" | "B" | "C" | "D";
};

export type FindingDraftStatus = "pending" | "writing" | "draft" | "confirmed" | "error";

// A grouped finding draft in the pipeline before it is confirmed into the
// formal findings register. Persisted only to localStorage (not Supabase).
export type GroupedFindingDraft = {
  id: string;
  gd4ItemId: string;
  subCriterionId: string;
  auditRunId?: string;
  group: ChecklistLineGroup;
  status: FindingDraftStatus;
  errorMessage?: string;
  savedFindingId?: string;
  title?: string;
  observation?: string;
  criteria?: string;
  effect?: string;
  rootCause?: string;
  corrective?: string;
  preventive?: string;
  apsrBullets?: {
    approach: string[];
    processes: string[];
    systemsOutcomes: string[];
    review: string[];
  };
  evidenceStatusSummary?: string;
  live?: boolean;
  // Snapshot of the original AI-generated text, captured at generation time so
  // the Human Decision Log can record what changed before confirm.
  aiSnapshot?: { title?: string; observation?: string; criteria?: string; effect?: string; rootCause?: string; corrective?: string; preventive?: string };
};

export type GenericChecklistLine = {
  id: "G1" | "G2" | "G3" | "G4";
  lens: "Approach" | "Processes" | "Systems & Outcomes" | "Review";
  text: string;
  status: GenericLineStatus;
};

// Which official GD4 field a generated line traces back to.
export type ChecklistSourceType = "requirement" | "intent" | "describeShow" | "note" | "expectedEvidence";

// A single testable audit point derived from the official GD4 requirement text.
// Flat points may come from a top-level Describe/Show bullet, a lettered
// sub-item within one, an Expected Evidence item, or a prescriptive Note.
// The ref uses the pattern "itemId.DS{n}" / "itemId.DS{n}.{letter}" / "itemId.EE{n}" / "itemId.N{n}".
export type FlatAuditPoint = {
  ref: string;
  gd4ItemId: string;
  sourceType: "describeShow" | "note" | "expectedEvidence";
  text: string;
  parentText?: string;
  sourceText: string;
  originalIndex: number | null;
};

// Structured output from runLiveChecklistGeneration / simulateChecklistGeneration:
// every line carries full provenance so it can be validated, displayed, and traced.
export type GeneratedChecklistLine = {
  text: string;
  clause: string;
  sourceType: ChecklistSourceType;
  sourceIndex: number | null;
  sourceText: string;
  apsrDimension: "Approach" | "Processes" | "Systems & Outcomes" | "Review";
  sourceRef?: string;
};

export type SpecificChecklistLine = {
  id: string;
  text: string;
  clause?: string;
  status: SpecificLineStatus;
  afiTag?: string;
  evidence: SubChecklistEvidenceItem[];
  sampling?: SamplingInfo;
  draftFinding?: DraftFindingInfo;
  generatedBy: "seed" | "ai" | "manual";
  // Traceability — present on AI-generated and deterministic-fallback lines,
  // absent on seed/manual lines.
  sourceType?: ChecklistSourceType;
  sourceIndex?: number | null;
  sourceText?: string;
  apsrDimension?: "Approach" | "Processes" | "Systems & Outcomes" | "Review";
  sourceRef?: string;
};

// Keyed by GD4 item id (the 35 testable requirements) rather than the 24
// sub-criteria, so every checklist line can cite a single, unambiguous
// clause. The sub-criterion/criterion grouping is reconstructed in the UI.
export type SubCriterionChecklistEntry = {
  gd4ItemId: string;
  generic: GenericChecklistLine[];
  specific: SpecificChecklistLine[];
  pendingGenerated?: SpecificChecklistLine[];
  generatedAt?: string;
  generatedLive?: boolean;
};

export type ClosureVerdict = "Acceptable" | "Partial" | "Maintain Finding" | "Escalate";
export type HumanVerdict = "Accepted" | "Returned" | "Escalated";

export type CorrectiveAction = {
  id: string;
  findingId: string;
  rootCause: string;
  correction: string;
  correctiveAction: string;
  preventiveAction: string;
  owner: string;
  dueDate: string;
  closureEvidenceIds: string[];
  closureEvidenceLink?: string;
  verificationMethod: string;
  aiVerdict?: ClosureVerdict;
  aiReason?: string;
  aiEvidenceNeeded?: string;
  aiLive?: boolean;
  humanVerdict?: HumanVerdict;
  reAuditRequired: boolean;
};

export type FolderStatus = "Good" | "In Progress" | "Partial" | "Missing";

// "Check access" is a real Drive API call (no AI involved) confirming
// whether the connected Google account can actually list the folder's
// files — "Connected" means it could, "Error" means Drive said no
// (permission/not-found/etc, see accessCheckNote), "Not Connected" means no
// Google Drive OAuth session exists yet (see Settings).
export type DriveAccessStatus = "Connected" | "Error" | "Not Connected";

export type EvidenceFolder = {
  id: string;
  auditCycleId: string;
  criterionId: string;
  subCriterionId: string;
  folderName: string;
  sourceSystem: SourceSystem;
  // folderLink is the "Actual Evidence" folder (kept under this name for
  // back-compat); policyLink is the "Policy & Procedure" folder. The Evidence
  // Folder module shows them as two tabs and the audit reads both, tagging
  // files from each into the matching bucket.
  folderLink?: string;
  policyLink?: string;
  owner: string;
  status: FolderStatus;
  lastCheckedDate?: string;
  // Access-check results are kept per tab: accessCheck* for the evidence
  // folder, policyAccess* for the policy folder.
  accessCheckStatus?: DriveAccessStatus;
  accessCheckNote?: string;
  accessCheckAt?: string;
  policyAccessStatus?: DriveAccessStatus;
  policyAccessNote?: string;
  policyAccessAt?: string;
  // "Run audit" results: real Drive file text was read and scored against
  // this sub-criterion's Sub-Criterion Checklist lines, which were updated
  // directly (Met/Partial/Not met) — see useWorkspaceStore.auditFolderContents.
  lastAuditAt?: string;
  lastAuditSummary?: string;
  // Whether the last audit's verdicts came from a live AI call (true) or the
  // offline keyword fallback (false), and the reason a live call fell back.
  lastAuditLive?: boolean;
  lastAuditError?: string;
  // Most-recent file modifiedTime (from Drive) seen at the last audit. Used by
  // "Re-audit only changed folders" to skip folders whose newest file has not
  // changed since this audit ran.
  lastAuditNewestModified?: string;
  // Which folders the last audit actually read — "policy" or "evidence" means
  // the OTHER side (and, for the staged path, the outcome/review pass) was
  // never assessed, so verdicts on lines outside that scope are stale from
  // whatever ran before. The Sub-Criterion Checklist warns when this isn't
  // "both" so a partial-mode run is never mistaken for a complete one.
  lastAuditScope?: AuditScope;
  // Short, human-readable id for the last audit run (e.g. "AR-1.2-K9QZ"),
  // stamped on the audit result row, every checklist evidence item it created,
  // the AI Review Log row and the audit journal entry — so one verdict can be
  // traced end-to-end.
  lastAuditRunId?: string;
  // The responsible auditor the last audit was run on behalf of (name +
  // derived strictness label), so the result is attributed to a person, not
  // just "AI".
  lastAuditAuditor?: string;
};

export type AIReviewType = "Evidence" | "Scoring" | "Closure" | "Checklist" | "Interview" | "Finalisation" | "Finding" | "CrossCriterion";

// Per-file record built during a folder audit — emitted to the progress modal
// so users can see exactly which files were read and what happened to each one.
export type AuditFileRecord = {
  path: string;
  name: string;
  mimeType: string;
  fileKind: string;
  bucket: "policy" | "evidence" | "auto";
  readStatus: "found" | "reading" | "read" | "condensed" | "skipped" | "failed";
  auditStatus: "pending" | "audited" | "cited" | "not_used";
  charCount?: number;
  failReason?: string;
  // Scanned PDF detection
  suspectedScannedPdf?: boolean;
  extractedTextQuality?: "none" | "low" | "medium" | "high";
  // Condensed document summary size
  summaryCharCount?: number;
  // Reason for skipping (type unsupported, image cap reached, etc.)
  skipReason?: string;
  // Chunk IDs assigned to this file's content in the evidence chunk array
  chunkIds?: string[];
  // Line IDs whose AI verdict cited a chunk from this file
  citedByLineIds?: string[];
  // Which APSR dimensions cited this file
  usedForDimensions?: { approach: boolean; processes: boolean; systemsOutcomes: boolean; review: boolean };
  // Drive file ID and last-modified timestamp — used to detect unchanged files
  // and reuse previously extracted text on repeat audits.
  driveFileId?: string;
  driveModifiedTime?: string;
  // Whether this file was newly read, re-read after a change, or reused from cache.
  processingMode?: "new" | "changed" | "reused";
};

// A discrete chunk of evidence extracted from one file, assigned a stable ID
// so the AI can cite specific sources and the audit trail can map citations
// back to the exact file and location that supported each verdict.
export type EvidenceChunk = {
  chunkId: string;       // e.g. "C001"
  filePath: string;
  fileName: string;
  bucket: "policy" | "evidence";
  fileKind: string;
  sheetName?: string;    // for spreadsheets
  rowRange?: string;     // e.g. "rows 1–50"
  text: string;
  charCount: number;
  evidenceType: "Policy/Procedure" | "Implementation Record" | "Outcome Data" | "Review Evidence" | "Other";
};

// --- Staged audit coverage matrices ---
// Each stage of the new staged folder audit produces a coverage matrix:
// Stage 2 → policyCoverageMatrix, Stage 3 → evidenceCoverageMatrix,
// Stage 4 → outcomeReviewMatrix. Each row maps to one FlatAuditPoint.ref.

export type StagedCoverageStatus = "Yes" | "Partial" | "No";

export type PolicyCoverageRow = {
  ref: string;
  pointText: string;
  covered: StagedCoverageStatus;
  note: string;
  chunkIds: string[];
  // True when the run stopped/was skipped before this point was ever put in
  // front of the AI. The covered value is then a placeholder, NOT a verdict —
  // consumers must not write checklist statuses or raise findings from it.
  notAssessed?: boolean;
};

export type EvidenceCoverageRow = {
  ref: string;
  pointText: string;
  covered: StagedCoverageStatus;
  note: string;
  chunkIds: string[];
  // See PolicyCoverageRow.notAssessed.
  notAssessed?: boolean;
};

export type OutcomeReviewRow = {
  ref: string;
  pointText: string;
  outcomeEvident: boolean;
  reviewEvident: boolean;
  note: string;
  chunkIds: string[];
  // See PolicyCoverageRow.notAssessed.
  notAssessed?: boolean;
};

// Live progress state emitted during an Evidence Folder audit. Updated
// frequently (per-file, per-batch) so the UI can show a polished step
// indicator and progress bar rather than a plain "Auditing…" label.
export type AuditProgressStage =
  | "listing"           // listing Drive folder contents
  | "reading"           // extracting text / describing images
  | "condensing"        // summarising large documents with the utility model
  | "auditing"          // running AI verdict batches (single-pass)
  | "policy_audit"      // Stage 2: AI policy adequacy check (staged flow)
  | "evidence_audit"    // Stage 3: AI evidence implementation check (staged flow)
  | "outcome_review"    // Stage 4: AI outcome & review check (staged flow)
  | "apsr_build"        // Stage 5: deterministic APSR verdict builder (staged flow)
  | "saving"            // writing verdicts to the checklist store
  | "findings_summary"  // Stage 7: findings summary (staged flow)
  | "complete"          // all done — results written
  | "error";            // terminated by an error

export type AuditProgressState = {
  folderId: string;
  folderName: string;
  subCriterionId: string;
  stage: AuditProgressStage;
  stageDetail?: string;
  filesRead?: number;
  filesTotal?: number;
  filesSkipped?: number;       // accumulated skip count (unreadable file types)
  currentFileName?: string;    // just the filename, set while reading each file
  currentFileBucket?: "policy" | "evidence"; // which source folder the file came from
  currentFileAction?: string;  // e.g. "Extracting PDF text", "Describing image with AI"
  batchCurrent?: number;
  batchTotal?: number;
  linesAssessed?: number;      // total checklist lines that received a verdict
  findingsDetected?: number;   // lines with status "Not met" (potential issues)
  // Set when the condensing step runs (not always needed — only for large folders).
  condensingTriggered?: boolean;
  // Non-null when stage === "error".
  errorMessage?: string;
  // Populated during "Audit All" so the modal can show "3 of 24".
  overallCurrent?: number;
  overallTotal?: number;
  // Full per-file list built after listing and updated during reading.
  filesFound?: AuditFileRecord[];
  // Drive connection info set when folder listing completes.
  connectInfo?: { foldersLinked: number; folderNames: string[] };
  // Whether the AI audit used a live model (true) or offline fallback (false).
  auditLive?: boolean;
  // Run status — allows the UI to distinguish running from complete/cancelled.
  status?: "running" | "cancelled" | "failed" | "completed";
  // Whether the user may cancel or skip the current file right now.
  canCancel?: boolean;
  canSkipCurrentFile?: boolean;
  // Wall-clock timestamp (Date.now()) updated at the start of every file
  // iteration — lets the UI detect a "stuck" file if it hasn't changed in >60s.
  lastHeartbeatAt?: number;
  // When the audit started (Date.now()).
  startedAt?: number;
  // Human-readable reason the audit was cancelled, if applicable.
  cancelReason?: string;
  // Which folders were in scope for this audit.
  scope?: AuditScope;
  // Analysis model used (available after first AI batch completes).
  aiModel?: string;
  // Total evidence chunks assembled for the AI call.
  chunksCount?: number;
  // Sliding window progress for staged audit passes.
  windowCurrent?: number;
  windowTotal?: number;
  // Per-line AI verdict summary — populated after the AI audit stage completes.
  verdictLines?: AuditAISummaryLine[];
  // Folder-level warnings returned by the AI (e.g. mis-filed documents).
  folderWarnings?: string[];
};

// Which source folders the audit reads.
export type AuditScope = "both" | "policy" | "evidence";

// ─── PPD Requirements Review ────────────────────────────────────────────────
// A read-only-of-policy pass: for each GD4 requirement LINE (one row per
// FlatAuditPoint, not per whole requirement item) in a sub-criterion, does
// the Policy & Procedure Document (PPD) actually document it? Distinct from
// the staged audit's policy stage (which only asks "Yes/Partial/No" per
// FlatAuditPoint for banding) — this produces a full human-readable comment
// and a suggested rewrite, shown inline. This single page IS Option A's
// complete output — no separate evidence-checklist step and no rewrite
// tracker; a Partial/Not documented row can be compiled straight into the
// Findings register (see useWorkspaceStore.compilePPDFindings).

// "Not assessed" is never returned by the AI — it marks a requirement line
// the run stopped/was skipped before reviewing. Neutral: excluded from the
// overall gap roll-up and shown as a grey chip.
export type PPDVerdict = "Adequate" | "Partial" | "Not documented" | "Not assessed";

// Sub-criterion-level roll-up of every requirement line's verdict:
// all Adequate -> "PPD Adequate"; any Partial (none missing) -> "PPD
// Partial"; any Not documented -> "PPD Gaps".
export type PPDOverallVerdict = "PPD Adequate" | "PPD Partial" | "PPD Gaps";

export type PPDReviewRow = {
  // FlatAuditPoint.ref — identifies this specific requirement line (e.g.
  // "1.2.1.DS1"), since a sub-criterion's items each carry several lines.
  ref: string;
  gd4ItemId: string;
  requirementText: string;
  verdict: PPDVerdict;
  shortComment: string;
  fullComment: string;
  // Only populated for Partial / Not documented rows.
  suggestedRewrite?: string;
  chunkIds: string[];
};

export type PPDReviewResult = {
  subCriterionId: string;
  rows: PPDReviewRow[];
  runAt: string;
  live: boolean;
  promptSent?: string;
  // chunkId -> source file name, so a row's chunkIds can be resolved back to
  // which PPD document a suggested rewrite applies to.
  chunkFileNames?: Record<string, string>;
  // Sub-criterion-level roll-up shown in the "Overall PPD assessment" panel
  // above the per-line table. Verdict/summary are derived deterministically
  // from the rows; narrative is an AI synthesis of the whole sub-criterion.
  overallVerdict?: PPDOverallVerdict;
  overallSummary?: string;
  overallNarrative?: string;
  // Non-fatal problems from the run (failed window/batch AI calls, stopped
  // early, unverified quotes) — shown as a warning banner so a partially
  // failed run can never present as a clean success.
  runWarnings?: string[];
};

// ─── Evidence Assessment (Option A, Evidence tab) ───────────────────────────
// The second tab of the PPD Requirements Review page. Reuses the already-
// assessed PPD verdict per requirement line (from PPDReviewResult — the
// policy is NOT re-read) and reads the Actual Evidence folder fresh, then
// gives a combined verdict per line: documented AND implemented = "Met";
// documented but not evidenced = "Partial"; neither = "Not met". This tab is
// where Option A findings are compiled.
// "Not assessed" is never returned by the AI — it marks a requirement line
// that no audit result could be matched to (deriveEvidenceAssessmentFromAudit).
// Such rows are neutral: excluded from the findings compile and shown as a
// grey chip prompting the user to run/re-run the evidence assessment.
export type EvidenceVerdict = "Met" | "Partial" | "Not met" | "Not assessed";

export type EvidenceFileRef = { name: string; url: string };

export type EvidenceAssessmentRow = {
  gdRef: string;              // FlatAuditPoint ref, e.g. "1.2.1.DS1"
  gd4ItemId: string;
  requirementText: string;
  // Reused verbatim from the PPD Review tab's result for this line — not
  // re-assessed here.
  ppdExtract: string;
  ppdVerdict: PPDVerdict;
  // Read fresh from the Actual Evidence folder.
  evidenceSummary: string;
  evidenceFiles: EvidenceFileRef[];
  evidenceChunkIds: string[];
  // Combined PPD-plus-evidence judgement.
  verdict: EvidenceVerdict;
  comment: string;
  // True when the AI call for this line failed/timed out — the row shows
  // "Assessment failed — retry" and is skipped by the findings compile.
  assessmentFailed?: boolean;
  savedFindingId?: string;
};

export type EvidenceAssessmentResult = {
  subCriterionId: string;
  rows: EvidenceAssessmentRow[];
  runAt: string;
  live: boolean;
  promptSent?: string;
  chunkFileNames?: Record<string, string>;
  // True when the rows were reused from the Evidence Folder staged audit's
  // stored per-line results (no fresh AI calls); false/undefined for a
  // fresh evidence-tab assessment run.
  derivedFromAudit?: boolean;
};

// Lightweight progress for the Evidence tab's fresh assessment run, so the
// user sees a bar + heartbeat instead of a static "Assessing…" button.
export type EvidenceAssessmentProgress = {
  subCriterionId: string;
  pct: number;      // 0–100
  detail: string;
};

// ─── Change Log ─────────────────────────────────────────────────────────────
// A running history of the git push/pull info the footer surfaces. The footer
// reads a build-time constant (__GIT_INFO__) that only ever holds the latest
// commit; the Change Log accumulates each distinct commit the app becomes
// aware of over time (deduped by commitHash) so the user can see what changed.
export type ChangeLogEntry = {
  id: string;
  timestamp: string;        // ISO datetime
  action: "push" | "pull";
  commitHash: string;       // short hash, e.g. "30b3994"
  branch: string;
  commitMessage: string;    // raw commit message
  summary: string;          // plain-English description of what changed
  filesChanged?: string[];
};

// One checklist line's AI verdict, stored in an AuditRunRecord for post-run
// inspection and CSV export.
export type AuditAISummaryLine = {
  lineId: string;
  lineText: string;
  sourceRef?: string;
  result: "Met" | "Partial" | "Not met";
  approachStatus: string;
  processesStatus: string;
  systemsOutcomesStatus: string;
  reviewStatus: string;
  citedChunkIds: string[];
  citedFileNames: string[];
  overallReason?: string;
  warning?: string;
};

// Persisted record of a completed, failed, or cancelled audit run — stored in
// the workspace so the user can reopen and inspect it after the modal closes,
// and so the CSV export functions have a self-contained data source.
export type AuditRunRecord = {
  runId: string;
  folderId: string;
  subCriterionId: string;
  subCriterionTitle: string;
  scope: AuditScope;
  status: "completed" | "failed" | "cancelled";
  startedAt: string;    // ISO 8601
  endedAt: string;      // ISO 8601
  auditorName?: string;
  auditLive: boolean;
  aiModel?: string;
  fileLedger: AuditFileRecord[];
  aiSummary: AuditAISummaryLine[];
  linesAssessed: number;
  findingsDetected: number;
  batchCount: number;
  chunkCount: number;
  errorMessage?: string;
  folderWarnings?: string[];
};

export type AIReviewLogEntry = {
  id: string;
  auditCycleId: string;
  agent: string;
  reviewType: AIReviewType;
  subjectId: string;
  verdict: string;
  confidence: Confidence;
  keyConcerns: string[];
  recommendedAction: string;
  evidenceNeeded?: string;
  suggestedScore?: number;
  suggestedBand?: Band;
  live: boolean;
  liveError?: string;
  generatedContent?: string;
  promptSent?: string;
  createdAt: string;
  // Short audit-run id shared with the folder result, checklist evidence and
  // journal entry from the same run, so a log row can be traced back to source.
  runId?: string;
  // Primary (analysis) model usage — the verdict / reasoning call.
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // Auxiliary (utility) model usage — image descriptions and document condensing
  // calls that run separately from the main verdict. Stored separately so the
  // cost calculator can use each model's actual price, not the analysis rate for
  // everything.
  auxModel?: string;
  auxPromptTokens?: number;
  auxCompletionTokens?: number;
  auxTotalTokens?: number;
};

export type HumanDecisionModule =
  | "AFI Closure"
  | "Grouped Finding"
  | "Line Status"
  | "Closure Drafting"
  | "Evidence Intake"
  | "Evidence Sufficiency"
  | "Item Scoring"
  | "Checklist Line Edit"
  | "Finding Observation"
  | "Cross-Criterion Analysis"
  | "Final Report"
  | "AI Review Log Feedback";

export type HumanDecisionType = "Accepted" | "Edited" | "Overridden" | "Dismissed";

export type HumanDecisionEntry = {
  id: string;
  timestamp: string;
  module: HumanDecisionModule;
  subjectId: string;
  aiRunId?: string;
  aiOutput: string;
  humanDecision: string;
  changed: boolean;
  decisionType: HumanDecisionType;
  reason: string;
  field?: string;
  memoryId?: string;
};

export type CalibrationExample = {
  id: string;
  timestamp: string;
  module: HumanDecisionModule;
  field?: string;
  aiInput: string;
  aiOutput: string;
  humanCorrection: string;
  reason: string;
  used: boolean;
  included: boolean;
};

export type CalibrationMemoryStatus = "active" | "pending_review" | "archived";

export type CalibrationMemory = {
  id: string;
  timestamp: string;
  module: HumanDecisionModule;
  subjectId: string;
  context: string;
  aiOutput: string;
  staffCorrection: string;
  keyLearning: string;
  status: CalibrationMemoryStatus;
  usageCount: number;
  effectivenessScore: number | null;
  tokenCount: number;
};

export type ManagementReviewItem = {
  id: string;
  auditCycleId: string;
  section: string;
  content: string;
  decisionNeeded: boolean;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
};

export type VersionHistoryEntry = {
  version: string;
  date: string;
  status: CycleStatus;
  note: string;
};

// Snapshot+restore versioning: each saved version carries a full copy of the
// working state so it can be restored later, not just a status label.
export type WorkspaceSnapshot = {
  cycle: AuditCycle;
  evidence: Record<string, ItemEvidence>;
  reviewer: Record<string, number>;
  confirmed: Record<string, number | null>;
  justify: Record<string, string>;
  closures: Record<string, unknown>;
  folders: EvidenceFolder[];
  samples: SampleRecord[];
  interviewQuestions: InterviewQuestion[];
  managementReviewItems: ManagementReviewItem[];
  // Added so a version captures the full scoring picture: the Sub-Criterion
  // Checklist now drives item bands, and findings raised from it live in
  // customFindings. Optional for backward-compatibility with snapshots saved
  // before this field existed.
  checklistEntries?: Record<string, SubCriterionChecklistEntry>;
  customFindings?: Finding[];
  seedFindingsLoaded?: boolean;
  // Added so a version captures the full picture and restore loses nothing:
  // the AI verdicts/log, the School Context briefing, the Additional-info
  // folder link, and per-agent memory. All optional for older snapshots.
  itemReviews?: Record<string, unknown>;
  aiReviewLog?: AIReviewLogEntry[];
  schoolContext?: { text: string; link: string; driveCache?: string; cachedAt?: string; accessStatus?: DriveAccessStatus; accessNote?: string; enabled?: boolean };
  additionalInfo?: { link: string; accessStatus?: DriveAccessStatus; accessNote?: string; accessAt?: string };
  agentMemory?: Record<string, AgentMemoryEntry[]>;
  auditJournal?: string;
  // Option A state + run history: captured so restoring a version can't
  // leave PPD-review / evidence-assessment rows whose savedFindingIds point
  // at findings that no longer exist after customFindings rolled back. On
  // restore, snapshots WITHOUT these fields (saved before they existed)
  // clear them rather than keeping current state — stale-but-cleared beats
  // dangling. Optional for backward compatibility.
  ppdReviewResults?: Record<string, PPDReviewResult>;
  evidenceAssessments?: Record<string, EvidenceAssessmentResult>;
  analysisPath?: Record<string, "A" | "B">;
  auditRunHistory?: Record<string, AuditRunRecord[]>;
};

export type VersionEntry = {
  id: string;
  name: string;
  version: string;
  date: string;
  status: CycleStatus;
  note: string;
  snapshot: WorkspaceSnapshot;
};

export type ExportFormat = "PDF" | "Excel" | "CSV" | "Markdown";

export type ExportLogEntry = {
  id: string;
  auditCycleId: string;
  exportName: string;
  format: ExportFormat;
  exportedAt: string;
  exportedBy: string;
};

export type AgentDefinition = {
  id: string;
  name: string;
  focus: string;
  strictness: number;
};

// Per-agent conversation memory, kept so a live LLM call can be given context
// from its own prior turns in this workspace.
export type AgentMemoryEntry = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type SampleRecordType = "Student" | "Staff" | "Academic" | "Financial" | "QA";

export type SampleRecord = {
  id: string;
  auditCycleId: string;
  gd4ItemId: string;
  recordType: SampleRecordType;
  reference: string;
  riskReason: string;
  selected: boolean;
  testedOutcome?: "Pass" | "Partial" | "Fail";
  notes?: string;
};

// Working evidence shape used by the Evidence Matrix / Intelligence /
// Scorecard screens: one record per GD4 item, scored across the four
// evidence limbs (policy, implementation, review, outcome).
export type EvidenceLevel = "good" | "Partial" | "Missing";

// Field names follow the four dimensions of the official EduTrust scoring
// rubric (GD4 section 23): Approach, Processes, Systems & Outcomes, Review.
export type ItemEvidence = {
  approach: EvidenceLevel;
  processes: EvidenceLevel;
  systemsOutcomes: EvidenceLevel;
  review: EvidenceLevel;
  owner: string;
  age: number;
  trace: number;
  drive?: string;
};

export type InterviewQuestion = {
  id: string;
  gd4ItemId: string;
  question: string;
  expectedAnswer: string;
  readiness?: "Strong" | "Adequate" | "Weak";
  notes?: string;
};

// Non-production AI settings, kept in their own persisted store (not the
// main workspace blob) so the key can be cleared independently. The key is
// never hardcoded and is only ever sent directly from the browser to OpenAI.
export type AISettings = {
  provider: "openai";
  apiKey: string;
  // The smart "analysis" model — audit verdicts, reviews, banding, checklist
  // generation. (`model` kept as the field name for back-compat.)
  model: string;
  // Cheaper "utility" model — image reading and link-metadata drafting, which
  // don't need the analysis model's reasoning.
  utilityModel: string;
  enabled: boolean;
  // Transient, merged in per call (never persisted in the settings store):
  // the School Context briefing injected as background into every AI call.
  context?: string;
};
