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
};

// Two-layer sub-criterion checklist module: a generic 4-line maturity check
// (Layer 1, fixed per the four rubric lenses) plus AI-generated/seeded atomic
// testable statements (Layer 2) per GD4 item, used to compute a band that
// feeds back into the official scoring engine (see lib/checklistBanding.ts).
export type ChecklistLineStatus = "Met" | "Partial" | "Not met";
export type GenericLineStatus = ChecklistLineStatus | "Not Started";
export type SpecificLineStatus = ChecklistLineStatus | "Not Applicable" | "Not Started";
export type EvidenceSufficiency = "Present" | "Weak" | "Missing";

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
};

export type GenericChecklistLine = {
  id: "G1" | "G2" | "G3" | "G4";
  lens: "Approach" | "Processes" | "Systems & Outcomes" | "Review";
  text: string;
  status: GenericLineStatus;
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

export type EvidenceFolder = {
  id: string;
  auditCycleId: string;
  criterionId: string;
  subCriterionId: string;
  folderName: string;
  sourceSystem: SourceSystem;
  folderLink?: string;
  owner: string;
  status: FolderStatus;
  missingEvidenceCount: number;
  lastCheckedDate?: string;
};

export type AIReviewType = "Evidence" | "Scoring" | "Closure" | "Checklist" | "Interview" | "Finalisation";

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
  createdAt: string;
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
  model: string;
  enabled: boolean;
};
