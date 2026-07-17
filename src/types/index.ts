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

// One of five fixed review lenses an auditor profile can carry, injected on
// top of their strictness + specialist focus when they sit on a review panel.
export type ReviewPerspective =
  | "strict-auditor"
  | "optimistic-process-owner"
  | "risk-challenger"
  | "academic-qa-guardian"
  | "management-reviewer";

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
  // The lens this auditor brings to a panel review (default strict-auditor).
  reviewPerspective?: ReviewPerspective;
};

// How the review panel is triggered (cycle-level, Settings).
export type PanelReviewMode = "off" | "on-demand" | "nc-major-auto" | "all";

// A panellist's structured Round-1 position, used to detect material
// disagreement (which triggers the Round-2 rebuttal round).
export type PanelReviewPosition = {
  // Short classification the panellist would assign, e.g. "NC" | "OFI" |
  // "Observation" | "No issue". Free text but compared case-insensitively.
  classification: string;
  // Severity direction, e.g. "Major" | "Minor" | "None".
  severity: string;
  // One short phrase naming the root-cause direction (process / documentation /
  // training / data / review / none), so contradictory directions are visible.
  rootCauseDirection: string;
};

// One panellist's individual review of a finding.
export type PanelAuditorReview = {
  auditorId: string;
  auditorName: string;
  perspective: ReviewPerspective;
  perspectiveLabel: string;
  analysis: string;              // Round-1 independent analysis
  position?: PanelReviewPosition; // Round-1 structured stance (for disagreement check)
  rebuttal?: string;             // Round-2 response to the other panellists (only when discussion ran)
  failed?: boolean;
  error?: string;
};

// One AI call the panel made, captured so the AI Review Log can show its REAL
// input prompt and output separately — per-auditor Round 1, each rebuttal, and
// the chair synthesis. `kind` labels the sub-call for grouping.
export type PanelCallLog = {
  kind: "round1" | "rebuttal" | "synthesis";
  label: string;      // e.g. "Panel · Rachel Tan · Strict Auditor · Round 1"
  promptSent: string; // the actual model input: SYSTEM + USER
  output: string;     // the model's raw response
  verdict: string;    // short summary for the log row (classification / "rebuttal" / final)
  failed?: boolean;
  // Real token usage the API reported for THIS sub-call, so each panel log
  // entry shows its actual model + tokens + cost instead of "live · —".
  usage?: { model: string; promptTokens: number; completionTokens: number; totalTokens: number };
};

// The synthesised conclusion combining all panellists, structured to fill the
// existing Quality Action / AFI closure scaffold.
export type PanelSynthesis = {
  summary: string;              // Balanced Finding Summary
  riskImpact: string;           // Risk / Impact
  rootCause: string;            // system/process cause (not "human error")
  immediateCorrection: string;  // Immediate Correction
  correctiveAction: string;     // Corrective Action
  evidenceForClosure: string;   // Evidence Required for Closure
  finalClassification: string;  // NC/Observation/OFI/CAR/improvement + justification
};

export type PanelReviewResult = {
  reviews: PanelAuditorReview[];
  synthesis: PanelSynthesis;
  runAt: string;
  live: boolean;
  // Non-fatal issues (a panellist call failed, quote flags) so a partial
  // panel never presents as a clean run.
  runWarnings?: string[];
  // Stable hash of the finding text this review ran against — lets the UI
  // offer a re-run when the finding has since changed.
  findingHash: string;
  // True when Round-1 positions materially disagreed and a Round-2 rebuttal
  // round was run before synthesis.
  discussionTriggered?: boolean;
  // Every AI sub-call this run made, with its real input prompt + output, so
  // each is inspectable in the AI Review Log (not just the synthesis).
  callLog?: PanelCallLog[];
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
  // Band descriptors live in the ONE official table (data/edutrustRubric.ts)
  // — the per-item bandDescriptors field was removed with the app-invented
  // descriptor sets it carried.
  scoringNotes?: string;
  flatAuditPoints?: FlatAuditPoint[];
};

export type SourceSystem = "Google Drive" | "Manual";

export type Band = 1 | 2 | 3 | 4 | 5;
export type Confidence = "Low" | "Medium" | "High";

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
  // True when the AI-written `criteria` failed the deterministic verbatim
  // check against the official GD4 text it traces to (findingCriteriaCheck)
  // — flagged in the register like an unverified quote, never silently
  // accepted. Cleared when a human edits the criteria. undefined on findings
  // from before this field, and on human-authored criteria.
  criteriaUnverified?: boolean;
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
  // Cached multi-auditor panel review (Part 3) — synthesised conclusion +
  // each panellist's individual analysis. Re-run only on change or explicit
  // request (compare panelReview.findingHash).
  panelReview?: PanelReviewResult;
  // True once the header classification (findingType/ncSeverity) has been set
  // by a human, so a later panel run defers to it instead of overwriting.
  classificationManual?: boolean;
  // Set when the latest panel run reached a different conclusion than fields
  // the user had manually edited — the finding shows a "review / apply panel
  // conclusion" notice instead of silently overwriting. Cleared once applied
  // or once a panel run reconciles cleanly.
  panelConflict?: { fields: string[] };
};

// Sub-criterion checklist module: AI-generated/seeded atomic testable
// statements per GD4 item (evidence context), plus the item's ONE holistic
// band (HolisticBandRecord below) judged against the official §23 rubric —
// the band feeds the scoring engine (see lib/checklistBanding.ts).
export type ChecklistLineStatus = "Met" | "Partial" | "Not met";
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
  // The PPD (policy-only) verdict this evidence item's write ORIGINATED
  // from — set only by Option A (buildOptionALineWrites), which is the only
  // path that assesses policy separately from combined evidence. Absent on
  // Option B, manual, and seed lines: there is no policy-only pass to report
  // for them, so the Sub-Criterion Checklist card shows an honest empty
  // state rather than deriving one from apsr.approach.status (a different,
  // lossier vocabulary — see optionAChecklistWrite.ts).
  ppdVerdict?: PPDVerdict;
  // Option A run snapshots for the checklist card's PPD/Evidence tabs — same
  // additive pattern as ppdVerdict above: real fields written at commit time,
  // never parsed back out of the auditorNote free text. evidenceVerdict is
  // what the RUN concluded, preserved even after a human later edits the
  // line's status (the editable field that drives the band); the comments are
  // each half's reasoning verbatim; promiseChecks is the per-promise ✓/○
  // detail. All absent on Option B, manual, seed, and pre-existing lines —
  // the tabs degrade to the apsr notes (older runs) or render nothing.
  evidenceVerdict?: "Met" | "Partial" | "Not met";
  ppdComment?: string;
  evidenceComment?: string;
  promiseChecks?: PromiseCheck[];
  // The Evidence judge's own "what would make this Met" text, verbatim —
  // same field as EvidenceAssessmentRow.suggestedAction (see that type for
  // the honesty rule: concrete and grounded, or absent, never generic).
  // Absent on Option B, manual, seed and pre-existing lines — Option B's
  // staged audit has no equivalent field to snapshot.
  suggestedAction?: string;
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
  // Same semantics as Finding.criteriaUnverified: the AI-written criteria
  // failed the deterministic verbatim check against the group's official GD4
  // source texts. Cleared when a human edits the criteria on the draft.
  criteriaUnverified?: boolean;
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

// Which official GD4 field a generated line traces back to.
// ─── Audit modes ─────────────────────────────────────────────────────────────
// ONE cycle-level choice of how much the AI does, made upfront on the Start
// Audit page (changeable mid-cycle): full-auto runs and commits everything,
// hybrid stops at every verdict/finding gate for approval, manual commits
// nothing automatically. Orthogonal to the per-row Option A/B path (WHAT gets
// assessed). Modes control WHEN results are committed and whether the human
// is prompted; the assessment engines themselves are identical across modes.
export type AuditMode = "full-auto" | "hybrid" | "manual";
// Alias kept for the pending-commit machinery that predates the rename.
export type RunMode = AuditMode;

// One deferred checklist-line commit: the exact write the engine WOULD have
// made (same shape applyOptionAWrites consumes), held for human review under
// the gated modes. `reason` says why it was queued (confidence gating).
export type PendingCommitItem = {
  id: string;
  write: ChecklistLineWrite;
  lineText: string;
  reason?: string;
};

// A run whose commits are awaiting review (confidence / review / hybrid).
export type PendingRun = {
  subCriterionId: string;
  path: "A" | "B";
  runMode: RunMode;
  runId: string;
  createdAt: string;
  items: PendingCommitItem[];
};

// The universal checklist-line write both engines produce: line status plus
// one audit evidence item. Applied by useChecklistModuleStore.applyOptionAWrites
// (matched line updated, or a new line created when none matches the ref).
export type ChecklistLineWrite = {
  gd4ItemId: string;
  existingLineId?: string;
  newLine?: Pick<SpecificChecklistLine, "text" | "clause" | "sourceRef" | "generatedBy">;
  status: "Met" | "Partial" | "Not met";
  evidence: Omit<SubChecklistEvidenceItem, "id">;
  // Confidence-gating signal computed where the write is built: true when the
  // AI is low-confidence (no/weak evidence, no citations, unverified quotes,
  // contradicted promises), so the "confidence" mode queues it for a human.
  lowConfidence?: boolean;
  confidenceReason?: string;
};

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

// Keyed by GD4 item id (the testable requirements) rather than the
// sub-criteria, so every checklist line can cite a single, unambiguous
// clause. The sub-criterion/criterion grouping is reconstructed in the UI.
// APSR PERCENTAGE-MATRIX scoring model (2026-07-14) — the OFFICIAL band
// mechanism, per an SSG auditor's direct clarification that A/P/S/R are scored
// SEPARATELY and SUMMED (superseding the "one holistic pick" model, which took
// the Guidance Document's literal "a band" wording at face value). Each
// dimension scores a band (1–5 → 5–25%) or 0% ("not evident", below Band 1);
// the four percentages sum to a total that maps to the final band. See
// lib/checklistBanding.ts (apsrMatrixResult) and docs/edutrust-band-scoring.md
// for the reconstructed formula and the parts still awaiting auditor
// confirmation (exact cut-offs, the 0% question). 0 = 0%, 1–5 = that band.
export type ApsrDimensionScore = 0 | Band;
export type ApsrMatrixScores = {
  approach?: ApsrDimensionScore;
  processes?: ApsrDimensionScore;
  systemsOutcomes?: ApsrDimensionScore;
  review?: ApsrDimensionScore;
};
// Deprecated alias — the AI suggestion still types its per-dimension bands as
// this shape (values 1–5); assignable into ApsrMatrixScores.
export type ApsrWorkingScores = ApsrMatrixScores;

export type HolisticBandRecord = {
  // The CALCULATED final band — sum of the four dimension percentages mapped
  // through the inferred thresholds (apsrMatrixResult). Not a free pick.
  band: Band;
  // The four per-dimension scores this band was calculated from, and the
  // summed percentage — stored so the arithmetic is auditable after the fact.
  matrixScores: ApsrMatrixScores;
  totalPct: number;
  // Why these scores fit, citing the four APSR dimensions — REQUIRED on every
  // save (enforced in setHolisticBand + the UI). The accepted AI rationale
  // satisfies it when the human accepts the AI's own scores. Optional in the
  // type solely for older records.
  rationale?: string;
  source: "human" | "ai-accepted";
  decidedAt: string;
  decidedBy?: string;
};

export type SubCriterionChecklistEntry = {
  gd4ItemId: string;
  specific: SpecificChecklistLine[];
  // Absent, OR present without matrixScores (an older ladder/holistic record),
  // means "needs re-assessment under the confirmed APSR percentage method" —
  // neither old model's band is ever carried forward as a matrix band.
  holisticBand?: HolisticBandRecord;
  // Live per-dimension matrix scores (persist as the user fills them in) —
  // snapshotted onto holisticBand at save time. This is now the OFFICIAL input
  // (the "your own working / not official" framing is retired).
  apsrMatrix?: ApsrMatrixScores;
  pendingGenerated?: SpecificChecklistLine[];
  generatedAt?: string;
  generatedLive?: boolean;
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

export type AIReviewType = "Evidence" | "Scoring" | "Closure" | "Checklist" | "Interview" | "Finalisation" | "Finding" | "CrossCriterion" | "Calibration";

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
  // How the content was extracted: "text" = direct text extraction (PDF/DOCX/
  // spreadsheet/etc.); "vision" = image or scanned-PDF transcription by the
  // vision model. Surfaced in the File Ledger so a bad read can be diagnosed.
  readMethod?: "text" | "vision";
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
  // Automation mode this run is under, so the progress UI always shows how
  // much will happen automatically.
  runMode?: RunMode;
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
  // Populated during "Audit All" so the modal can show progress like "3 of N".
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

// One constituent obligation of a GD4 requirement line — the "(a) code of
// conduct; (b) non-collection of monies" parts a real SSG assessor checks
// individually. The line verdict is DERIVED from these: all documented →
// Adequate, some → Partial, none → Not documented.
export type PPDSubClause = {
  text: string;
  verdict: "documented" | "not documented";
  // Exact verbatim excerpt from the PPD that documents THIS specific
  // sub-clause — stored only when it verifies as a real substring of the
  // source; absent means "no single exact quote identified for this
  // sub-part" (never a fabricated one, and never the whole line's quote).
  // Undefined for "not documented" sub-clauses. Used to highlight the
  // relevant excerpt per sub-part in the lineage diagram's expanded view.
  quote?: string;
  // Named section reference of the SOURCE PPD document where this sub-clause
  // is documented (e.g. "4.2 Competency-Based Recruitment and Selection
  // Strategy, Step 1: Manpower Planning and Deployment"). Stored ONLY when it
  // (or its leading heading segment) verifies as a real substring of the
  // source — an invented/tidied reference is dropped to undefined, so the
  // lineage map shows an honest em-dash rather than a clause an assessor
  // would chase and never find. Absent on runs from before this field existed.
  clause?: string;
  // One short auditor-register sentence on WHY this sub-clause is / is not
  // documented, distinct from the quote. Undefined when the model could not
  // state a reason beyond the quote itself (never padded). Not verified
  // against source (it is reasoning, like shortComment, not a quotation).
  rationale?: string;
  // The single chunk ID (e.g. "C001") the quote came from, for DIRECT file
  // attribution in the lineage map (chunk → file), instead of searching every
  // cited file's text for the quote. Undefined on older runs → the map falls
  // back to quote-search attribution.
  chunkId?: string;
  // When this sub-clause is documented but no SINGLE sentence captures it
  // (support is spread across several statements), the actual verbatim
  // passages found — each independently verified against source the same way
  // `quote` is (a passage that fails verification is dropped, never shown).
  // Lets the lineage map show real evidence for a "spread across the
  // document" verdict instead of only asserting it. Undefined/empty means
  // either a single `quote` was found (this field doesn't apply) or genuinely
  // no cleanly extractable passage exists at all — the true diffuse-mention
  // fallback the UI keeps as an italic note.
  spreadQuotes?: { quote: string; chunkId?: string }[];
  // True when the model DID cite a supporting quote (or spread passages) for
  // this documented sub-clause but NONE of it verified as a real verbatim
  // excerpt of the source — a materially different state from "no single
  // passage exists" (empty quote AND empty spreadQuotes from the model
  // itself). The UI renders an honest "cited passage could not be verified"
  // note instead of the "spread across the document" claim, which nothing
  // supports in this case. Optional/additive — undefined on older runs and
  // whenever something real verified.
  quoteUnverified?: boolean;
};

// A specific, verifiable commitment the PPD makes for a requirement line
// (named mechanism, frequency, scope, role, record). Extracted during the
// PPD review; verified against Actual Evidence in the evidence assessment
// ("not implemented in accordance with its documented PPD" findings).
export type PPDPromise = { promiseText: string; sourceQuote: string; chunkId: string };

// The PPD stating two inconsistent values/timelines/responsibilities for the
// same thing (e.g. "within 5 working days" vs "within 3 working days").
// Reported sub-criterion-wide with both quoted passages.
export type PPDContradiction = {
  description: string;
  quoteA: string;
  chunkA: string;
  quoteB: string;
  chunkB: string;
  // Set once compiled into the Findings register (same back-pointer pattern
  // as EvidenceAssessmentRow.savedFindingId).
  savedFindingId?: string;
};

// Per-promise verification verdict from the evidence assessment pass.
export type PromiseCheck = {
  promiseText: string;
  verdict: "evidenced" | "not evidenced" | "contradicted";
  evidence: string;
  chunkIds: string[];
  // Exact verbatim excerpt from the cited evidence that proves/contradicts
  // THIS specific promise — stored only when it verifies as a real substring
  // of the evidence text; absent means "no single exact quote identified for
  // this sub-part". Distinct from `evidence` above, which may be a citation
  // label/description rather than a verified verbatim excerpt. Used to
  // highlight the relevant excerpt per sub-part in the lineage diagram.
  quote?: string;
  // One short auditor-register sentence on WHY this promise is evidenced /
  // not evidenced / contradicted, distinct from the quote. Undefined when the
  // model could not state a reason beyond the quote (never padded). Not
  // verified against source (reasoning, like the line comment, not a quotation).
  rationale?: string;
  // The single primary chunk ID the quote came from, for DIRECT file
  // attribution in the lineage map. Undefined on older runs → the map falls
  // back to chunkIds[0] / quote-search attribution.
  chunkId?: string;
};

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
  // Assessor-grade decomposition: per-sub-clause documented/not verdicts.
  subClauses?: PPDSubClause[];
  // Specific commitments the PPD makes for this line, verified downstream.
  promises?: PPDPromise[];
  // Exact verbatim excerpt from the cited PPD text that documents this line —
  // stored only when it verifies as a real substring of the source; absent
  // means "no single exact quote identified" (never a fabricated one). Used to
  // highlight the supporting sentence in the lineage diagram's expanded view.
  supportQuote?: string;
  // Pass 1 (extraction) visibility: how many candidate passages the model
  // RETURNED for this line vs how many survived verbatim verification.
  // Distinguishes "0 raw" (genuinely nothing found — deterministic negative
  // verdict is legitimate) from "N raw → 0 verified" (extraction defect —
  // the line is Not assessed, never a fabricated gap). undefined on rows
  // from before this field existed.
  extractionStats?: { raw: number; verified: number };
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
  // Internal contradictions found while reading the PPD (two inconsistent
  // values/timelines/procedures for the same thing) — flagged sub-criterion-
  // wide and compiled into findings alongside the per-line gaps.
  contradictions?: PPDContradiction[];
  // Temperature ACTUALLY in effect for this run's verdict calls: the tuned
  // value when the model honours a temperature parameter, null when it
  // doesn't (gpt-5/o-series). undefined on runs from before this field.
  effectiveTemperature?: number | null;
  // Per-file read ledger for the policy files this run read, so the PPD Review
  // tab can show the same clickable/inspectable file list (extracted text) the
  // staged audit shows. Metadata only — the extracted text lives in fileTextCache.
  fileLedger?: AuditFileRecord[];
  // AI model used for this run's verdict calls — carried onto the result so a
  // history entry (ppdReviewHistory) still shows which model produced it after
  // a later run overwrites the live AIReviewLog entry it came from. Undefined
  // on runs from before this field existed.
  model?: string;
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
  // Named checks: each PPD promise for this line, verified against the
  // Actual Evidence (evidenced / not evidenced / contradicted).
  promiseChecks?: PromiseCheck[];
  // Exact verbatim excerpt from the cited evidence that proves implementation —
  // stored only when it verifies as a real substring; absent means "no exact
  // quote identified". Highlights the supporting sentence in the lineage view.
  evidenceQuote?: string;
  // "What would make this Met" — one or two sentences grounded in the SAME
  // gap `comment`/`promiseChecks` already identified (named record, count,
  // document), never a generic template. Only ever populated for Partial/Not
  // met; undefined on Met rows and on any run from before this field existed
  // (optional/additive — old stored runs render with no suggestion shown,
  // never a crash). Captured here on the row so a future "add to Findings"
  // action can pull it in as the proposed corrective step without needing a
  // new field.
  suggestedAction?: string;
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
  // Short audit-run id, shared with the AI Review Log entry from this run.
  runId?: string;
  // Temperature ACTUALLY in effect for this run's verdict calls: the tuned
  // value when the model honours a temperature parameter, null when it
  // doesn't (gpt-5/o-series). undefined on runs from before this field.
  effectiveTemperature?: number | null;
  // Per-file ledger for this Option A evidence run, in the same AuditFileRecord
  // shape the staged path uses, so the two paths' file-ledger CSVs line up.
  // Undefined when the rows were derived from a prior staged audit (no fresh
  // read happened here).
  fileLedger?: AuditFileRecord[];
  // AI model used for this run's verdict calls — see PPDReviewResult.model.
  // Undefined when derivedFromAudit (no fresh AI call happened here) or on
  // runs from before this field existed.
  model?: string;
};

// ─── Outcomes & Review pass (Option A, on-demand) ───────────────────────────
// Result of the on-demand "Also assess Outcomes & Review" button: Option B's
// staged third pass (runStagedOutcomeReviewAudit) run in isolation over the
// documents an Option A run already read, so Option A rows can get real
// Systems & Outcomes / Review legs instead of the hardcoded "not assessed"
// placeholders. ADVISORY until the human clicks "Apply to checklist" — the
// rows are stored here first and only written onto the checklist lines by
// that explicit click (all modes, including full-auto). Never feeds the band:
// the band still flows solely from holisticBand.matrixScores.
export type OutcomeReviewPassResult = {
  subCriterionId: string;
  rows: OutcomeReviewRow[];
  runAt: string;
  runId: string;
  promptSent?: string;
  chunkFileNames?: Record<string, string>;
  // Coverage/read problems from the run (files missing from the session text
  // cache, window errors, truncation) — shown as a warning banner so a
  // partial pass can never present as a clean success.
  runWarnings?: string[];
  model?: string;
  // Stamped by the explicit "Apply to checklist" click.
  appliedAt?: string;
  appliedLineCount?: number;
};

// One AI-generated improvement suggestion on the Final Report, persisted per
// item-dimension (key "itemId::dimensionKey" in
// useWorkspaceStore.reportAiSuggestions). Generate-once-and-save: written
// only by the explicit per-item Generate button, so the report never re-rolls
// (or re-bills) per render and the on-screen text matches the printed PDF.
// A deliberate, user-approved exception to the no-fabrication rule: AI-written
// prose, always rendered under an explicit "AI suggestion" label, never
// replacing the real recorded diagnosis or the verbatim rubric target.
export type ReportAiSuggestion = {
  text: string;
  generatedAt: string;
  model?: string;
};

// Result of comparing the Actual Evidence folder's CURRENT Drive listing
// (file id + modifiedTime) against a stored EvidenceAssessmentResult's
// fileLedger — lets the Evidence tab tell the user their existing result may
// be stale before they act on it. "error" covers every case where the
// comparison itself couldn't be made (no ledger to compare against, no
// folder linked, Drive not connected, the listing call failed/timed out) —
// deliberately distinct from "unchanged", never asserted as a false negative.
export type EvidenceDriftCheck = {
  status: "unchanged" | "changed" | "error";
  added: string[];
  removed: string[];
  modified: string[];
  errorMessage?: string;
};

// Lightweight progress for the Evidence tab's fresh assessment run, so the
// user sees a bar + heartbeat instead of a static "Assessing…" button.
// Per-line live state during an evidence assessment run.
export type EvidenceLineRunStatus = "waiting" | "assessing" | "done";

// One entry in the live activity log surfaced in the detailed progress panel.
export type EvidenceRunLogLine = { at: number; text: string; tone?: "info" | "good" | "warn" | "bad" };

// The most recent thing that went wrong during a live PPD/Evidence run —
// surfaced alongside the "no activity Ns" stall message so a stall reads as
// "still working" (genuinely no issue yet), "a call errored" (kind:
// call-error, the real exception/timeout/malformed-response message), or "a
// file read failed" (kind: file-read-error) instead of one generic message
// for all three. Never cleared mid-run (kept as the latest-known issue, not
// asserted as necessarily the CURRENT stall's cause) so it survives even if
// the run then moves on to a new window before finishing.
export type EvidenceRunIssue = { at: number; kind: "call-error" | "file-read-error"; message: string };

export type EvidenceAssessmentProgress = {
  subCriterionId: string;
  pct: number;      // 0–100
  detail: string;
  // ── Detailed live-activity fields (optional; populated as the run proceeds).
  // Surfaced by the PPD/Evidence detailed progress panel — NOT part of the
  // assessment logic, just a live view of the backend activity it already does.
  stage?: "reading" | "assessing" | "verifying" | "synthesising" | "done";
  startedAt?: number;      // Date.now() at run start — drives the elapsed timer
  heartbeatAt?: number;    // Date.now() bumped on every event — freeze detection
  window?: { current: number; total: number };
  filesTotal?: number;
  // Files read so far, in order — name + Drive id so the live list can link
  // each row out to the exact file in Google Drive (same as the ledger rows).
  filesRead?: { name: string; driveFileId?: string }[];
  // Every file in this run's evidence scope, populated upfront (all "found"/
  // pending) before the read loop starts and updated live per file — same
  // AuditFileRecord shape and FileLedger component the staged/full-audit
  // paths use, so this run's live view isn't a second, simpler vocabulary.
  filesFound?: AuditFileRecord[];
  // True while a specific file is mid-read, so the UI can offer a manual
  // Skip control instead of only the automatic per-file timeout.
  canSkipCurrentFile?: boolean;
  currentFile?: string;    // file being read right now
  // Source file names the CURRENT in-flight assessment AI call's window
  // covers (resolved from its chunk IDs), so the live view can show WHICH
  // evidence file(s) — not just which requirement lines — the active call is
  // using. Set at "assessing" stage only; undefined while reading.
  currentWindowFiles?: string[];
  lineRefs?: string[];     // all requirement-line refs, in order
  lineStatus?: Record<string, EvidenceLineRunStatus>;
  lineVerdict?: Record<string, string>; // ref → last verdict once assessed
  log?: EvidenceRunLogLine[];           // running activity log, newest last
  ai?: { calls: number; model?: string; totalTokens: number }; // live AI usage
  lastIssue?: EvidenceRunIssue; // most recent call/file-read failure, if any
};

// Task 1a: the blocking choice runEvidenceAssessment presents ONCE, after its
// read loop has attempted every evidence file, if one or more files couldn't
// be read because the run's vision-image budget ran out — instead of
// silently skipping each one (the old, honesty-guard-violating behaviour).
// Bulk, not per-file: every budget-blocked file is collected first, then a
// single prompt covers all of them, so the user isn't asked once per file.
// Ephemeral UI state only — never persisted.
export type VisionBudgetPrompt = {
  subCriterionId: string;
  fileNames: string[];      // every file that hit the budget, in read order
  budgetMax: number;        // the run's current image cap
  estimatedExtraImages: number; // "up to N more images" needed to cover every blocked file
  estimatedCostUSD: number; // ballpark spend for estimatedExtraImages, same $ convention as the AI Review Log
};

// Same shape and intent as EvidenceAssessmentProgress, for the PPD tab's live
// run — reuses EvidenceLineRunStatus/EvidenceRunLogLine rather than a second
// set of near-identical types, so both tabs' live-run panels can share one
// rendering component (RunDetailColumns in PPDReview.tsx).
export type PPDReviewProgress = {
  subCriterionId: string;
  detail: string;
  pct?: number;
  stage?: "reading" | "assessing" | "done";
  startedAt?: number;
  heartbeatAt?: number;
  window?: { current: number; total: number };
  filesTotal?: number;
  filesFound?: AuditFileRecord[];
  canSkipCurrentFile?: boolean;
  currentFile?: string;
  currentWindowFiles?: string[];
  lineRefs?: string[];
  lineStatus?: Record<string, EvidenceLineRunStatus>;
  lineVerdict?: Record<string, string>;
  log?: EvidenceRunLogLine[];
  ai?: { calls: number; model?: string; totalTokens: number };
  lastIssue?: EvidenceRunIssue;
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
  // Temperature ACTUALLY in effect for this run's verdict calls (null = the
  // model ignores the temperature parameter). undefined on older records.
  effectiveTemperature?: number | null;
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
  | "AI Review Log Feedback"
  | "Panel Conclusion"
  | "Prompt Review"
  | "Run mode gate"
  | "Holistic Band"
  | "NC Severity";

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

// ── Prompt Review feature ────────────────────────────────────────────────────
// A PARALLEL, user-authored "reviewable prompt" object and a connected
// review → revise → log loop. Deliberately does NOT touch the app's real
// code-based AI prompts (agentRuntime.ts / skills.ts) — it operates only on
// these user-authored ReviewablePrompt objects. See usePromptReviewStore.ts.

// The user-authored prompt object being rated/revised (never a code prompt).
export type ReviewablePrompt = {
  id: string;
  name: string;
  // Plain label for the intended use, e.g. "Quality Action", "Audit Findings".
  purpose: string;
  // The current OPERATIONAL text — only replaced when a reviewer explicitly
  // promotes a drafted revision (the champion-vs-active gate).
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptRatingLevel = "Strong" | "Adequate" | "Weak";
export type ComplianceRiskLevel = "Low" | "Medium" | "High";

export type PromptReviewRatings = {
  accuracy: PromptRatingLevel;
  completeness: PromptRatingLevel;
  relevance: PromptRatingLevel;
  tone: PromptRatingLevel;
  complianceRisk: ComplianceRiskLevel;
};

// reviewed_ok    — no poor rating; output accepted, no revision needed.
// needs_revision — a poor rating fired the correction flow; feedback captured,
//                  revision not yet drafted.
// revision_drafted — an AI-drafted revised prompt exists, awaiting human confirm.
// revision_live  — the reviewer promoted the revised prompt to operational.
export type PromptReviewStatus = "reviewed_ok" | "needs_revision" | "revision_drafted" | "revision_live";

// The ONE connected record (requirement: tie original → revised together, which
// neither AIReviewLogEntry nor HumanDecisionEntry does). Reuses
// HumanDecisionEntry's reason / decisionType / timestamp shape as its base and
// adds the pieces those logs never capture: originalPrompt, ratings, the free
// text notes, the AI-drafted revisedPrompt, and a reviewer identity.
export type PromptReviewRecord = {
  id: string;
  promptId: string;
  promptName: string;
  originalPrompt: string;   // the ReviewablePrompt text at review time
  output: string;           // the AI output under review
  ratings: PromptReviewRatings;
  missingInfo: string;      // free text (optional)
  suggestedImprovement: string; // free text (optional)
  // Captured from the reused FeedbackModal, only when a poor rating triggered it.
  correction: string;       // "what is the correct answer"
  reason: string;           // "why was the AI wrong" — reuses HumanDecisionEntry.reason
  revisedPrompt: string | null; // AI-drafted revision; null until drafted
  reviewer: string;         // NEW identity field (resolved from the active auditor)
  timestamp: string;        // reuses HumanDecisionEntry.timestamp shape
  decisionType: HumanDecisionType; // reused: "Accepted" (ok) | "Overridden" (revised)
  status: PromptReviewStatus;
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
  // Added so a version captures the full scoring picture: the Sub-Criterion
  // Checklist now drives item bands, and findings raised from it live in
  // customFindings. Optional for backward-compatibility with snapshots saved
  // before this field existed.
  checklistEntries?: Record<string, SubCriterionChecklistEntry>;
  customFindings?: Finding[];
  seedFindingsLoaded?: boolean;
  // Whether the snapshot was taken while the SAMPLE dataset was loaded, so a
  // restore keeps the SAMPLE banner in sync with the restored seed findings.
  sampleDataActive?: boolean;
  // Added so a version captures the full picture and restore loses nothing:
  // the AI verdicts/log, the School Context briefing and the Additional-info
  // folder link. All optional for older snapshots.
  itemReviews?: Record<string, unknown>;
  aiReviewLog?: AIReviewLogEntry[];
  schoolContext?: { text: string; link: string; driveCache?: string; cachedAt?: string; accessStatus?: DriveAccessStatus; accessNote?: string; enabled?: boolean };
  additionalInfo?: { link: string; accessStatus?: DriveAccessStatus; accessNote?: string; accessAt?: string };
  auditJournal?: string;
  // Option A state + run history: captured so restoring a version can't
  // leave PPD-review / evidence-assessment rows whose savedFindingIds point
  // at findings that no longer exist after customFindings rolled back. On
  // restore, snapshots WITHOUT these fields (saved before they existed)
  // clear them rather than keeping current state — stale-but-cleared beats
  // dangling. Optional for backward compatibility.
  ppdReviewResults?: Record<string, PPDReviewResult>;
  ppdReviewHistory?: Record<string, PPDReviewResult[]>;
  evidenceAssessments?: Record<string, EvidenceAssessmentResult>;
  evidenceAssessmentHistory?: Record<string, EvidenceAssessmentResult[]>;
  analysisPath?: Record<string, "A" | "B">;
  auditMode?: AuditMode;
  reviewPanelAuditorIds?: string[];
  reviewPanelMode?: PanelReviewMode;
  auditRunHistory?: Record<string, AuditRunRecord[]>;
  // Roster + departments: captured so restoring a version can't leave the
  // review panel (reviewPanelAuditorIds, restored above) pointing at auditor
  // IDs that don't exist in the current roster. Optional for older snapshots,
  // which keep the current roster on restore.
  auditors?: AuditorProfile[];
  departments?: Department[];
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
  // Cheaper "utility" model — link-metadata drafting and other light text work
  // that doesn't need the analysis model's reasoning.
  utilityModel: string;
  // Vision model used to transcribe evidence images and scanned/image-only PDFs
  // (the PDF vision fallback). Must be a multimodal model. Optional so
  // pre-existing persisted settings fall back to the utility model — preserving
  // the prior behaviour where image reading ran on the utility model.
  visionModel?: string;
  enabled: boolean;
  // Temperature for VERDICT-DECIDING calls (staged audit passes, PPD review,
  // evidence assessment, auditor-panel classification). Lower = the same input
  // yields the same verdicts (reproducibility); default 0.1. Generative calls
  // (closure/finding prose, roll-up narrative) keep their own fixed higher
  // temperature and ignore this. Optional so pre-existing persisted settings
  // fall back to the default.
  verdictTemperature?: number;
  // Transient, merged in per call (never persisted in the settings store):
  // the School Context briefing injected as background into every AI call.
  context?: string;
};
