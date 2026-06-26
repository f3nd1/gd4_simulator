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
  departments: string[];
  status: CycleStatus;
  owner: string;
  version: string;
  lastSavedAt: string;
  createdAt: string;
  updatedAt: string;
  driveRoot?: string;
};

export type AuditorType = "Internal" | "External" | "AI Agent";

export type AuditorProfile = {
  id: string;
  auditCycleId: string;
  name: string;
  type: AuditorType;
  department?: string;
  role: string;
  strictness: number;
  focusArea: string;
  checklistTemplateId: string;
};

export type ChecklistStatus = "Not Started" | "Pass" | "Partial" | "Fail" | "Not Applicable";

export type AuditorChecklistItem = {
  id: string;
  auditCycleId: string;
  auditorId?: string;
  checklistType: string;
  gd4ItemId?: string;
  item: string;
  status: ChecklistStatus;
  comment?: string;
  evidenceId?: string;
  evidenceLink?: string;
  followUpRequired?: boolean;
  owner?: string;
  dueDate?: string;
  aiStatus?: ChecklistStatus;
  aiReason?: string;
  aiLive?: boolean;
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
  checklist: Record<string, unknown>;
  folders: EvidenceFolder[];
  samples: SampleRecord[];
  interviewQuestions: InterviewQuestion[];
  managementReviewItems: ManagementReviewItem[];
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

export type DepartmentDefinition = {
  dept: string;
  role: string;
  strict: number;
};

export type ChecklistLibraryItem = {
  id: string;
  dept: string;
  text: string;
  link: string | null;
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
