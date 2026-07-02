import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type {
  AuditCycle,
  AuditorProfile,
  Department,
  AgentDefinition,
  EvidenceFolder,
  ItemEvidence,
  VersionEntry,
  WorkspaceSnapshot,
  SampleRecord,
  InterviewQuestion,
  ManagementReviewItem,
  ExportLogEntry,
  AIReviewLogEntry,
  AIReviewType,
  Confidence,
  HumanDecisionEntry,
  CalibrationExample,
  CalibrationMemory,
  CalibrationMemoryStatus,
  Finding,
  DriveAccessStatus,
  ApsrBreakdown,
  AuditProgressState,
  AuditFileRecord,
  AuditScope,
  AuditRunRecord,
  AuditAISummaryLine,
  ChangeLogEntry,
} from "../types";
import { summariseCommitMessage } from "../lib/changeLogSummary";
import { seedEvidence, blankEvidence } from "../data/seedEvidence";
import { seedFolders } from "../data/folders";
import { AGENTS } from "../data/agents";
import { buildDemoDataset } from "../data/demoDataset";
import { buildScored, aiScore, needsJustification } from "../lib/scoring";
import { auditEvidence, type EvidenceAuditFlag } from "../lib/evidenceAudit";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { simulateItemReview, simulateClosure, simulateFolderAudit, deriveApsrStatus, type FolderAuditLineVerdict } from "../lib/ai/simulateAI";
import { runLiveItemReview, runLiveClosureReview, runLiveClosureDraft, runLiveFolderAudit, runLiveFindingObservation, FOLDER_DOC_CAP, runStagedPolicyAudit, runStagedEvidenceAudit, runStagedOutcomeReviewAudit, buildStagedApsr, simulateStagedPolicyAudit, simulateStagedEvidenceAudit, simulateStagedOutcomeReview, runPPDRequirementsReview, runEvidenceAssessment, type PPDRequirementInput, type EvidenceAssessmentInput } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useScoringConfigStore } from "./useScoringConfigStore";
import { useAgentMemoryStore } from "./useAgentMemoryStore";
// Static circular import (useFindingDraftStore also imports this store) —
// same pattern as useChecklistModuleStore; safe because all cross-store
// usage happens inside actions at runtime, never at module-init time.
import { useFindingDraftStore } from "./useFindingDraftStore";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useGoogleDriveStore } from "./useGoogleDriveStore";
import { parseFolderId, listFolderFilesRecursive, exportFileText, exportFileImageDataUrl, IMAGE_MIME_TYPES, DriveApiError, XLSX_MIME, XLS_MIME, classifyPdfTextQuality } from "../lib/drive/driveClient";
import type { EvidenceChunk, FlatAuditPoint, PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, PPDReviewResult, PPDReviewRow, PPDOverallVerdict, FindingTypeCode, NcSeverity, EvidenceAssessmentResult, EvidenceAssessmentRow, EvidenceFileRef, EvidenceAssessmentProgress, EvidenceVerdict, SpecificLineStatus } from "../types";
import { findingTypeForStatus } from "../lib/findingClassification";
import { describeImage, effectiveSettings, addUsage, type AIUsage } from "../lib/ai/aiClient";
import { computeBand, lineApsr, findingDimension } from "../lib/checklistBanding";
import { domainExpertiseLabelFor } from "../data/skills/domainExpertise";
import { apsrReason, apsrAuditNote } from "../lib/ai/simulateAI";

// Module-level ref for the currently active per-file abort. Set at the start
// of each file read; cleared when the file read completes (success, skip, or
// error). Allows cancelBusy() and skipCurrentFile() to abort the in-flight
// Drive download or AI call without waiting for the 30/45s timeout to fire.
// Only one folder audit runs at a time (the busy flag prevents concurrency),
// so a single module-level ref is sufficient.
let _currentFileAbort: (() => void) | null = null;

// Run-level AbortController for the active AI run (staged audit, PPD review,
// evidence assessment). cancelBusy() aborts it, which propagates through the
// audit functions into chatComplete → fetch, killing the IN-FLIGHT request
// immediately instead of letting it run to its 90s timeout (and letting the
// loop fire further paid calls in the meantime). One run at a time (busy
// flag), so a single module-level ref is sufficient.
let _currentRunAbort: AbortController | null = null;

// Best-effort evidence-type classification for audit-attached evidence, from
// the checklist line being satisfied (the folder audit reads many files into
// one verdict, so there's no single file type to copy). Keeps the Type column
// meaningful instead of every audited line reading "Other".
// Each sub-criterion's Drive folder is organised into two subfolders:
// "1. Policy & Procedure" and "2. Actual Evidence". Classify a scanned file
// by its top-level path segment so the audit can separate the documented
// approach (policy) from deployed evidence — a band needs both. Files not
// under a recognised policy subfolder default to evidence (preserves prior
// behaviour for folders that aren't split into subfolders yet).
// AI-drafted closure text (root cause / corrective / preventive) comes back
// as a single run-on paragraph. Break it onto one line per sentence so it
// reads as a scannable list in the Quality Action / AFI textarea instead of
// a wall of text. Only applied to what gets written into the closure record
// — the raw text is still logged verbatim to the AI Review Log.
function formatDraftedClosureText(text: string): string {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

function classifyFileBucket(path: string): "policy" | "evidence" {
  const topSegment = path.split("/")[0]?.toLowerCase() || "";
  return /polic|procedure/.test(topSegment) ? "policy" : "evidence";
}

// Canonical GD4 ref normalizer used at EVERY ref join point (staged-audit row
// matching, deriveEvidenceAssessmentFromAudit, …). Checklist lines' sourceRef
// is AI-echoed and can drift in format ("DS: 6.1.1.DS1.a", stray spaces,
// lower case) — both sides of any comparison must go through this same
// function or refs that match in one place silently miss in another.
function normalizeAuditRef(ref: string): string {
  return ref.trim().replace(/^(ref|source|gd4|ds|ee|n)\s*[:#]\s*/i, "").replace(/\s+/g, "").toUpperCase();
}

// promptSent holds the full AI prompt, which embeds large slices of the
// school's actual documents. It must never be PERSISTED in full (Supabase
// sits behind an open RLS policy; localStorage growth is quadratic via
// version snapshots) — persisted copies keep only this short preview. The
// in-memory value stays complete for the live session.
const PROMPT_PREVIEW_CHARS = 200;
function truncatePromptSent<T extends { promptSent?: string }>(entry: T): T {
  if (!entry.promptSent || entry.promptSent.length <= PROMPT_PREVIEW_CHARS) return entry;
  return {
    ...entry,
    promptSent: `${entry.promptSent.slice(0, PROMPT_PREVIEW_CHARS)}… [prompt truncated for storage — the full prompt is only kept in-memory during the session it was generated in]`,
  };
}

function mapRecordValues<T>(record: Record<string, T>, fn: (v: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fn(v)]));
}

// The full School Context string injected into AI calls: the typed markdown
// briefing plus whatever was last read from the linked Drive context. Returns
// "" when the user has switched injection off (cost control), so no context
// tokens are sent at all.
export function composeSchoolContext(sc: { text?: string; driveCache?: string; enabled?: boolean }): string {
  if (sc.enabled === false) return "";
  return [sc.text?.trim(), sc.driveCache?.trim()].filter(Boolean).join("\n\n");
}

// Reads a folder's text files (recursively) into one capped string, used for
// the school-wide "Additional info" context. Text-only on purpose — images
// are skipped here so the general-context folder can't quietly fan out into
// extra AI vision calls on every audit.
async function readFolderPlainText(folderId: string, token: string, maxChars = 12000): Promise<string> {
  const files = await listFolderFilesRecursive(folderId, token);
  const parts: string[] = [];
  let total = 0;
  for (const file of files) {
    if (total >= maxChars) break;
    try {
      const text = await exportFileText(file, token);
      if (text) {
        const piece = `--- ${file.path} ---\n${text}`;
        parts.push(piece);
        total += piece.length;
      }
    } catch {
      // skip unreadable files in the context folder
    }
  }
  return parts.join("\n\n").slice(0, maxChars);
}

function inferEvidenceType(lineText: string): string {
  const t = lineText.toLowerCase();
  if (/\b(minutes?|meeting)\b/.test(t)) return "Minutes";
  if (/\b(polic(y|ies)|procedure|manual|framework|plan|guideline|sop)\b/.test(t)) return "Policy/Procedure";
  if (/\b(survey|feedback|questionnaire)\b/.test(t)) return "Survey/Feedback";
  if (/\b(screenshot|system|dashboard|portal|software)\b/.test(t)) return "System screenshot";
  if (/\b(record|log|register|report|list|evidence|certificate|attendance)\b/.test(t)) return "Record/Log";
  return "Other";
}

// Picks a meaningful evidence Type for an audited line from its APSR result,
// so an audited policy reads "Policy/Procedure" and an audited record reads
// "Record/Log" instead of defaulting to "Other". Falls back to the line-text
// heuristic when there is no APSR (offline runs).
function evidenceTypeFromApsr(apsr: ApsrBreakdown | undefined, lineText: string): string {
  if (!apsr) return inferEvidenceType(lineText);
  if (apsr.processes.status === "Deployed" || apsr.processes.status === "Weak") return "Record/Log";
  if (apsr.approach.status === "Meeting" || apsr.approach.status === "Beginning") return "Policy/Procedure";
  return inferEvidenceType(lineText);
}

// Short, human-readable run id for a folder audit (e.g. "AR-1.2-K9QZ"). The
// base-36 suffix of the current time keeps it short while staying unique enough
// to tell two runs of the same sub-criterion apart.
function makeRunId(subCriterionId: string): string {
  return `AR-${subCriterionId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

// Maps an auditor's 20–95 strictness slider onto the three audit calibration
// levels the AI prompt understands, so the auditor's own setting (not a global
// one) controls how hard their audits judge.
function strictnessFromScore(n: number): "Lenient" | "Standard" | "Strict" {
  if (n >= 78) return "Strict";
  if (n <= 45) return "Lenient";
  return "Standard";
}

export type ClosureState = {
  root?: string;
  corr?: string;
  prev?: string;
  evid?: string;
  human?: "" | "Accepted";
  ai?: string;
  aiReason?: string;
  aiNeed?: string;
  live?: boolean;
};

export type ItemAIVerdict = {
  score: number;
  band: number;
  confidence: Confidence;
  justification: string;
  higherBand: string;
  by: string;
  live: boolean;
};

// A brand-new workspace's cycle has no audit content at all — only the
// workflow-structural fields (status/version/lastSavedAt/the real creation
// timestamp) are pre-filled, since those describe the cycle's actual current
// state rather than sample content. Name/type/period/scope/owner only get
// filled in by the user, or by loadDemoDataset() below via DEMO_CYCLE_FIELDS.
const DEFAULT_CYCLE: AuditCycle = {
  id: "cycle-1",
  name: "",
  type: "",
  periodStart: "",
  periodEnd: "",
  evidenceCutOffDate: "",
  scope: "",
  status: "Draft",
  owner: "",
  version: "v0.1 Draft",
  lastSavedAt: "Not saved",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  driveRoot: "",
};

const DEMO_CYCLE_FIELDS: Partial<AuditCycle> = {
  name: "EduTrust 2027 Readiness Review",
  type: "Internal GD4 Mock Audit",
  periodStart: "2026-07-01",
  periodEnd: "2027-06-30",
  evidenceCutOffDate: "2027-05-31",
  scope: "All EduTrust GD4 criteria across academic and corporate functions.",
  owner: "SQ",
};

const DEFAULT_AUDITORS: AuditorProfile[] = [
  { id: "AUD-1", auditCycleId: "cycle-1", name: "Rachel Tan", type: "Internal", departmentId: "SQ", role: "Audit Lead", strictness: 70, focusArea: "Overall audit setup and finalisation", checklistTemplateId: "Audit Lead Checklist" },
  { id: "AUD-2", auditCycleId: "cycle-1", name: "Marcus Lim", type: "Internal", departmentId: "SGL", role: "Department Reviewer", strictness: 60, focusArea: "Leadership and governance evidence", checklistTemplateId: "Management Review Checklist" },
  { id: "AUD-3", auditCycleId: "cycle-1", name: "Priya Nair", type: "Internal", departmentId: "ALI / CM", role: "Department Reviewer", strictness: 75, focusArea: "Academic process evidence", checklistTemplateId: "Academic Process Checklist" },
  { id: "AUD-4", auditCycleId: "cycle-1", name: "Faizal Rahman", type: "Internal", departmentId: "AD / AN", role: "Department Reviewer", strictness: 80, focusArea: "Student protection and contract evidence", checklistTemplateId: "Student Protection Checklist" },
  { id: "AUD-5", auditCycleId: "cycle-1", name: "Jennifer Wong", type: "External", departmentId: undefined, role: "External Reviewer", strictness: 85, focusArea: "Simulated SSG/EduTrust assessor view", checklistTemplateId: "GD4 Criterion Checklist" },
];

// Workspace-wide department directory, seeded from the acronyms and full
// names already implied by the auditor data above. Person-in-charge is left
// blank for the user to fill in via Audit Cycle.
const DEFAULT_DEPARTMENTS: Department[] = [
  { id: "ALI", acronym: "ALI", fullName: "Academic and Learning Innovation", personInCharge: "" },
  { id: "CM", acronym: "CM", fullName: "Course Management", personInCharge: "" },
  { id: "CD", acronym: "CD", fullName: "Curriculum Development", personInCharge: "" },
  { id: "GEP", acronym: "GEP", fullName: "Global Expansion and Partnerships", personInCharge: "" },
  { id: "IG", acronym: "IG", fullName: "International Growth and Alliances", personInCharge: "" },
  { id: "OEE", acronym: "OEE", fullName: "Operational Excellence", personInCharge: "" },
  { id: "AN", acronym: "AN", fullName: "Administration", personInCharge: "" },
  { id: "FN", acronym: "FN", fullName: "Finance", personInCharge: "" },
  { id: "HR", acronym: "HR", fullName: "Human Resources", personInCharge: "" },
  { id: "IT", acronym: "IT", fullName: "IT Services", personInCharge: "" },
  { id: "SES", acronym: "SES", fullName: "Sales Enablement and Strategy", personInCharge: "" },
  { id: "MG", acronym: "MG", fullName: "Marketing", personInCharge: "" },
  { id: "SL", acronym: "SL", fullName: "Sales", personInCharge: "" },
  { id: "SGL", acronym: "SGL", fullName: "Strategic Governance and Leadership", personInCharge: "" },
  { id: "CG", acronym: "CG", fullName: "Corporate Governance", personInCharge: "" },
  { id: "SQ", acronym: "SQ", fullName: "Strategic and Quality Management", personInCharge: "" },
  { id: "SSO", acronym: "SSO", fullName: "Student Success and Outreach", personInCharge: "" },
  { id: "AD", acronym: "AD", fullName: "Admissions", personInCharge: "" },
  { id: "SS", acronym: "SS", fullName: "Student Support", personInCharge: "" },
];

export type WorkspaceState = {
  cycle: AuditCycle;
  evidence: Record<string, ItemEvidence>;
  reviewer: Record<string, number>;
  confirmed: Record<string, number | null>;
  justify: Record<string, string>;
  closures: Record<string, ClosureState>;
  agents: AgentDefinition[];
  auditors: AuditorProfile[];
  departments: Department[];
  versions: VersionEntry[];
  folders: EvidenceFolder[];
  itemReviews: Record<string, ItemAIVerdict>;
  aiReviewLog: AIReviewLogEntry[];
  humanDecisionLog: HumanDecisionEntry[];
  calibrationExamples: CalibrationExample[];
  calibrationMemories: CalibrationMemory[];
  samples: SampleRecord[];
  interviewQuestions: InterviewQuestion[];
  managementReviewItems: ManagementReviewItem[];
  exportLog: ExportLogEntry[];
  customFindings: Finding[];
  // Gates the hard-coded sample findings register (data/findings.ts) so a
  // brand-new workspace's Findings/AFI Closure modules start truly empty —
  // those 22 sample findings only appear once "Use demo data" is clicked.
  seedFindingsLoaded: boolean;
  busy: string | null;
  // Monotonically-increasing counter used as a run-cancellation guard: each
  // audit captures it at start; cancelBusy() increments it; before writing
  // results the audit checks whether the current value still matches its
  // captured value — if not, it was cancelled and results are discarded.
  auditRunToken: number;
  // When true, the current staged AI pass should stop processing further windows
  // and return whatever results it has so far. Reset to false by the store after
  // each stage completes. Does NOT cancel the whole audit — just the current pass.
  auditSkipStageFlag: boolean;
  // Live progress state for the active folder audit — updated per-file and
  // per-batch so the UI can show a polished step indicator. Cleared by the
  // user (clearAuditProgress) so the result panel stays visible after completion.
  auditProgress: AuditProgressState | null;
  // Which folders to include in the next audit run.
  auditScope: AuditScope;
  setAuditScope: (scope: AuditScope) => void;
  // Completed/failed/cancelled audit run records, keyed by folderId.
  // Max 5 runs kept per folder; oldest dropped when the list is full.
  auditRunHistory: Record<string, AuditRunRecord[]>;
  // Most recent completed/failed run per folderId, for quick "View last run" access.
  lastAuditRuns: Record<string, AuditRunRecord>;
  // Extracted-text cache keyed by "fileId:modifiedTime". Allows unchanged Drive
  // files to skip the download step on repeat audits.
  fileTextCache: Record<string, { text: string | null; charCount: number; fileKind: string; fileName?: string; filePath?: string; cachedAt?: number; pdfQuality?: { suspectedScannedPdf: boolean; extractedTextQuality: "none" | "low" | "medium" | "high" } }>;
  // Persisted "Recheck all evidence" report so it survives navigation and
  // page refreshes. null means the report hasn't been run yet this session.
  evidenceAuditReport: { flags: EvidenceAuditFlag[]; generatedAt: string } | null;
  // PPD Requirements Review (Option A, "PPD Review" tab) — most recent run
  // per sub-criterion: one row per GD4 requirement line, policy only, with an
  // inline suggested rewrite. The verdict here feeds the Evidence tab's
  // combined assessment (below) without re-reading the policy.
  ppdReviewResults: Record<string, PPDReviewResult>;
  runPPDReview: (subCriterionId: string) => Promise<void>;
  // Evidence Assessment (Option A, "Evidence" tab) — per requirement line,
  // reuses the PPD verdict and reads the Actual Evidence folder fresh for a
  // combined Met/Partial/Not met verdict. compileEvidenceFindings raises a
  // Finding per row from that verdict — the single Option A findings compile.
  evidenceAssessments: Record<string, EvidenceAssessmentResult>;
  // Populates evidenceAssessments[sub] by REUSING the Evidence Folder staged
  // audit's stored per-checklist-line results (matched by GD4 requirement
  // ref) — no AI calls. Returns true if any audited line was found.
  deriveEvidenceAssessmentFromAudit: (subCriterionId: string) => boolean;
  runEvidenceAssessment: (subCriterionId: string) => Promise<void>;
  compileEvidenceFindings: (subCriterionId: string) => number;
  // Live progress for a fresh runEvidenceAssessment (bar + heartbeat on the
  // Evidence tab); null when no assessment is running.
  evidenceAssessmentProgress: EvidenceAssessmentProgress | null;
  // Which analysis path a sub-criterion uses: "A" (PPD Requirements Review —
  // default/recommended) or "B" (the existing checklist, unchanged).
  // Missing key means "A" — see ANALYSIS_PATH_DEFAULT.
  analysisPath: Record<string, "A" | "B">;
  setAnalysisPath: (subCriterionId: string, path: "A" | "B") => void;

  // Running history of the git push/pull info the footer surfaces (from the
  // build-time __GIT_INFO__ constant). recordChangeLogEntry dedupes by
  // commitHash so the same commit is never logged twice; the plain-English
  // summary is derived from the commit message when not supplied.
  changeLog: ChangeLogEntry[];
  recordChangeLogEntry: (entry: Omit<ChangeLogEntry, "id" | "summary"> & { summary?: string }) => void;

  updateCycle: (patch: Partial<AuditCycle>) => void;
  // Clears a stranded busy/bulk state so a button stuck on "Auditing…" can be
  // released. Also aborts the currently reading file so the loop exits promptly.
  cancelBusy: () => void;
  skipCurrentAuditStage: () => void;
  // Clears the extracted-text cache so the next audit re-downloads all files
  // from Drive. Use when files have been updated but Drive modifiedTime hasn't
  // changed (e.g. in-place Google Docs edits that don't bump the timestamp).
  clearFileTextCache: () => void;
  // Removes one cached file's entry (by its "fileId:modifiedTime" cache key)
  // without touching any other cached file — for re-downloading a single
  // stale/corrupt cache entry rather than clearing everything.
  removeFileTextCacheEntry: (key: string) => void;
  // Skips the file currently being read — aborts its Drive download and/or AI
  // description call and moves the loop to the next file. No-op if not reading.
  skipCurrentFile: () => void;
  // Dismisses the audit progress panel (does not cancel the audit itself).
  clearAuditProgress: () => void;
  runEvidenceAudit: (flags: EvidenceAuditFlag[] | null) => void;
  loadDemoDataset: () => void;
  saveAsNewVersion: (name: string, note?: string) => void;
  restoreVersion: (versionId: string) => void;
  lockCycle: () => void;
  unlockCycle: () => void;
  duplicateCycle: () => void;
  createNewCycle: () => void;

  setEvidenceField: <K extends keyof ItemEvidence>(itemId: string, field: K, value: ItemEvidence[K]) => void;
  setReviewerScore: (itemId: string, value: number) => void;
  setJustify: (itemId: string, value: string) => void;
  confirmScore: (itemId: string) => void;

  setAgentStrictness: (agentId: string, value: number) => void;
  runItemAI: (agentId: string, itemId: string) => Promise<void>;

  setClosureField: (afiId: string, field: keyof ClosureState, value: string) => void;
  // Pre-fills a finding's closure with a derived root cause / corrective /
  // preventive (from buildFindingAnalysis), WITHOUT overwriting anything the
  // user has already written. Used when findings are auto-raised so the AFI
  // Closure form and Final Report start deep instead of blank.
  seedClosure: (afiId: string, seed: { root?: string; corr?: string; prev?: string }) => void;
  runClosureAI: (afiId: string) => Promise<void>;
  draftClosureActions: (afiId: string, issue: string, gd4ItemId: string) => Promise<void>;
  setClosureHuman: (afiId: string, value: "" | "Accepted", reason?: string) => void;

  addAuditor: (a: AuditorProfile) => void;
  updateAuditor: (id: string, patch: Partial<AuditorProfile>) => void;
  removeAuditor: (id: string) => void;

  addDepartment: (d: Department) => void;
  updateDepartment: (id: string, patch: Partial<Department>) => void;
  removeDepartment: (id: string) => void;
  resetDepartments: () => void;

  setFolderField: <K extends keyof EvidenceFolder>(id: string, field: K, value: EvidenceFolder[K]) => void;
  checkFolderAccess: (id: string, tab?: "policy" | "evidence") => Promise<void>;
  // extraContext (optional): school-wide "Additional info" folder text, fed in
  // as labeled background — never primary evidence (the evidence-sufficiency
  // caps still gate the band).
  // overallProgress (optional): position within an "Audit All" run, used by
  // the progress panel to show "3 of 24".
  auditFolderContents: (id: string, extraContext?: string, overallProgress?: { current: number; total: number }) => Promise<void>;
  // Staged audit: three focused AI passes (policy → evidence → outcome/review)
  // with a deterministic APSR verdict builder. Mode controls which stages run.
  auditFolderStaged: (id: string, mode: "policy" | "evidence" | "all", extraContext?: string, overallProgress?: { current: number; total: number }) => Promise<void>;
  // One-click "audit every folder that has a link" used by the Dashboard.
  // bulkAuditStatus carries human-readable progress ("Auditing 3/24 …") while
  // it runs, and is null when idle.
  bulkAuditStatus: string | null;
  auditAllFolders: () => Promise<void>;
  // Like auditAllFolders, but skips any folder whose newest Drive file has not
  // changed since its last audit (compared via lastAuditNewestModified). Saves
  // time and AI cost on re-runs. Returns a short summary of what it did.
  auditChangedFolders: () => Promise<{ audited: number; skipped: number; unlinked: number }>;

  // School-wide "Additional info" folder — general supporting documents that
  // apply to every criterion (org chart, staff/student/partner listing, MR
  // declaration, awards), not tied to any one sub-criterion.
  additionalInfo: { link: string; accessStatus?: DriveAccessStatus; accessNote?: string; accessAt?: string };
  setAdditionalInfoLink: (link: string) => void;
  checkAdditionalInfoAccess: () => Promise<void>;

  // School Context — the auditor's "briefing": a persistent markdown profile
  // of the institution (+ optional Drive link to pull more), injected as
  // background into every AI assessment so it never starts blind.
  schoolContext: { text: string; link: string; driveCache?: string; cachedAt?: string; accessStatus?: DriveAccessStatus; accessNote?: string; enabled?: boolean };
  setSchoolContextText: (text: string) => void;
  setSchoolContextLink: (link: string) => void;
  setSchoolContextEnabled: (enabled: boolean) => void;
  readSchoolContextFromDrive: () => Promise<void>;

  setSamples: (samples: SampleRecord[]) => void;
  toggleSample: (id: string) => void;
  setSampleOutcome: (id: string, outcome: SampleRecord["testedOutcome"], notes?: string) => void;

  setInterviewQuestions: (qs: InterviewQuestion[]) => void;
  setQuestionReadiness: (id: string, readiness: InterviewQuestion["readiness"], notes?: string) => void;

  addManagementReviewItem: (item: ManagementReviewItem) => void;
  setManagementDecision: (id: string, decision: string, decidedBy: string) => void;

  addExportLogEntry: (e: ExportLogEntry) => void;

  addCustomFinding: (f: Finding) => void;
  updateCustomFinding: (id: string, patch: Partial<Finding>) => void;
  removeCustomFinding: (id: string) => void;
  clearAllFindings: () => void;
  clearAllClosures: () => void;

  clearAIReviewLog: () => void;
  clearHumanDecisionLog: () => void;
  clearReviewerOverride: (itemId: string) => void;

  // Lets other stores (e.g. the checklist module) record an AI run in the
  // shared review log without duplicating the id/timestamp boilerplate.
  pushAIReviewLog: (entry: {
    agent: string;
    reviewType: AIReviewType;
    subjectId: string;
    verdict: string;
    confidence: Confidence;
    keyConcerns: string[];
    recommendedAction: string;
    evidenceNeeded?: string;
    suggestedScore?: number;
    suggestedBand?: number;
    live: boolean;
    liveError?: string;
    generatedContent?: string;
    promptSent?: string;
    runId?: string;
    usage?: AIUsage;
  }) => void;

  logHumanDecision: (entry: Omit<HumanDecisionEntry, "id" | "timestamp">) => void;
  toggleCalibrationIncluded: (id: string) => void;
  markCalibrationUsed: (ids: string[]) => void;
  addCalibrationMemory: (memory: Omit<CalibrationMemory, "id" | "timestamp" | "usageCount" | "effectivenessScore">) => string;
  updateMemoryStatus: (id: string, status: CalibrationMemoryStatus) => void;
  incrementMemoryUsage: (id: string) => void;
  updateMemoryEffectiveness: (id: string, score: number) => void;

  setBusy: (id: string | null) => void;

  // Running markdown log of every folder audit in this workspace.
  // Auto-updated after each auditFolderContents call; fed into subsequent AI
  // calls so the model can flag recurring cross-criterion gaps.
  auditJournal: string;
  clearAuditJournal: () => void;

  // Immutable audit trail of every version restore. Entries are appended
  // whenever restoreVersion() is called; never deleted from the store.
  restoreLog: { restoredAt: string; fromVersion: string; fromNote: string }[];

  // The auditor a folder audit is run "on behalf of": the AI does the reading,
  // but a named human auditor owns the result and their strictness drives how
  // hard the AI judges. null → fall back to the Audit Lead, then the first
  // auditor, then the global AI strictness setting.
  activeAuditorId: string | null;
  setActiveAuditor: (id: string | null) => void;
};

// ---- Audit Journal helpers -----------------------------------------------

// Maps an APSR breakdown to its weakest-link dimension label for the journal.
function apsrDimLabel(apsr: ApsrBreakdown): string {
  if (apsr.approach.status !== "Meeting") return "Approach gap";
  if (apsr.processes.status !== "Deployed") return "Processes gap";
  if (apsr.systemsOutcomes.status !== "Evident") return "Outcomes gap";
  if (apsr.review.status !== "Evident") return "Review gap";
  return "";
}

// Builds a compact markdown entry for one sub-criterion's audit result.
function buildJournalEntry(
  subCriterionId: string,
  folderName: string,
  bandParts: string[],
  verdicts: FolderAuditLineVerdict[],
  lineTextById: Map<string, string>,
  runId: string,
): string {
  const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
  for (const v of verdicts) counts[v.status]++;
  const date = new Date().toLocaleDateString("en-GB");
  const header = `### ${subCriterionId} [${runId}] — ${folderName} (${date})`;
  const summary = `${bandParts.length ? `Band: ${bandParts.join(", ")}. ` : ""}${counts.Met} Met / ${counts.Partial} Partial / ${counts["Not met"]} Not met.`;
  const gaps = verdicts.filter((v) => v.status !== "Met").slice(0, 4);
  if (gaps.length === 0) return `${header}\n${summary}`;
  const gapLines = gaps.map((v) => {
    const text = (lineTextById.get(v.lineId) || v.lineId).slice(0, 70);
    const dim = v.apsr ? apsrDimLabel(v.apsr) : "";
    return `- ${text}${dim ? ` [${dim}]` : ""}`;
  });
  return `${header}\n${summary}\nGaps:\n${gapLines.join("\n")}`;
}

// Replaces any existing entry for subCriterionId in the journal and appends
// the new entry at the end (most-recent-last order).
function updateJournal(journal: string, subCriterionId: string, newEntry: string): string {
  // Match by sub-criterion id followed by a space (e.g. "### 1.2 ") so the
  // optional "[runId]" in the header doesn't break the replace-in-place.
  const prefix = `### ${subCriterionId} `;
  const lines = journal.split("\n");
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith(prefix)) { skip = true; continue; }
    if (skip && (line.startsWith("### ") || line.startsWith("⚠ Recurring"))) skip = false;
    // Drop any previously-appended trailing "Recurring patterns" summary lines
    // wherever they sit — exactly one fresh one is re-appended by the caller,
    // so they can never accumulate (the bug that showed the line 3×).
    if (line.startsWith("⚠ Recurring patterns")) continue;
    if (!skip) out.push(line);
  }
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return cleaned ? `${cleaned}\n\n${newEntry}` : newEntry;
}

// Scans the journal for dimensions that recur across 2+ sub-criteria and
// returns a trailing warning line, or "" if no recurring pattern found.
function patternNote(journal: string): string {
  const dims = [
    { key: "Approach gap", label: "Approach" },
    { key: "Processes gap", label: "Processes" },
    { key: "Outcomes gap", label: "Systems & Outcomes" },
    { key: "Review gap", label: "Review" },
  ];
  const recurring = dims.filter(({ key }) => (journal.match(new RegExp(`\\[${key}\\]`, "g")) || []).length >= 2);
  if (recurring.length === 0) return "";
  return `\n\n⚠ Recurring patterns: ${recurring.map(({ label, key }) => `${label} gap (${(journal.match(new RegExp(`\\[${key}\\]`, "g")) || []).length}×)`).join(", ")} — may indicate systemic gaps.`;
}

// ---- End audit journal helpers --------------------------------------------

let logCounter = 0;
function logAI(
  push: (e: AIReviewLogEntry) => void,
  cycleId: string,
  agent: string,
  reviewType: AIReviewType,
  subjectId: string,
  verdict: string,
  confidence: Confidence,
  keyConcerns: string[],
  recommendedAction: string,
  evidenceNeeded?: string,
  suggestedScore?: number,
  suggestedBand?: number
) {
  logCounter += 1;
  push({
    id: `LOG-${Date.now()}-${logCounter}`,
    auditCycleId: cycleId,
    agent,
    reviewType,
    subjectId,
    verdict,
    confidence,
    keyConcerns,
    recommendedAction,
    evidenceNeeded,
    suggestedScore,
    suggestedBand: suggestedBand as 1 | 2 | 3 | 4 | 5 | undefined,
    live: false,
    createdAt: new Date().toISOString(),
  });
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      cycle: DEFAULT_CYCLE,
      evidence: blankEvidence(),
      reviewer: {},
      confirmed: {},
      justify: {},
      closures: {},
      agents: AGENTS,
      auditors: [],
      departments: DEFAULT_DEPARTMENTS,
      versions: [],
      folders: seedFolders(),
      itemReviews: {},
      aiReviewLog: [],
      humanDecisionLog: [],
      calibrationExamples: [],
      calibrationMemories: [],
      samples: [],
      interviewQuestions: [],
      managementReviewItems: [],
      exportLog: [],
      customFindings: [],
      seedFindingsLoaded: false,
      busy: null,
      auditRunToken: 0,
      auditSkipStageFlag: false,
      auditProgress: null,
      auditScope: "both" as AuditScope,
      auditRunHistory: {},
      lastAuditRuns: {},
      fileTextCache: {},
      bulkAuditStatus: null,
      additionalInfo: { link: "" },
      schoolContext: { text: "", link: "" },
      evidenceAuditReport: null,
      ppdReviewResults: {},
      evidenceAssessments: {},
      evidenceAssessmentProgress: null,
      analysisPath: {},
      changeLog: [],
      auditJournal: "",
      restoreLog: [],
      activeAuditorId: null,

      setActiveAuditor: (id) => set({ activeAuditorId: id }),
      setAuditScope: (scope) => set({ auditScope: scope }),

      updateCycle: (patch) => set((s) => ({ cycle: { ...s.cycle, ...patch, updatedAt: new Date().toISOString() } })),

      cancelBusy: () => {
        // Abort the current file read immediately so the loop doesn't wait for
        // the per-file timeout to fire before releasing the busy state.
        _currentFileAbort?.();
        _currentFileAbort = null;
        // Abort the run-level controller so any IN-FLIGHT AI call dies now —
        // previously cancel only flipped flags checked between calls, so the
        // current request (and, in the staged audit, every remaining
        // window×batch call) kept running and billing after cancel.
        _currentRunAbort?.abort();
        _currentRunAbort = null;
        // Also clear the skip-stage flag — otherwise a stale `true` (set right
        // before cancel, with no chance for the in-flight stage's reset to run)
        // would silently cut short the very next audit's first stage.
        set((s) => ({ busy: null, bulkAuditStatus: null, auditRunToken: s.auditRunToken + 1, auditSkipStageFlag: false }));
      },

      skipCurrentAuditStage: () => set({ auditSkipStageFlag: true }),

      clearFileTextCache: () => set({ fileTextCache: {} }),
      removeFileTextCacheEntry: (key) =>
        set((s) => {
          const { [key]: _removed, ...rest } = s.fileTextCache;
          return { fileTextCache: rest };
        }),
      skipCurrentFile: () => {
        // Abort only the current file — loop continues to the next one.
        _currentFileAbort?.();
        // Note: _currentFileAbort is cleared by the loop itself after the catch.
      },
      clearAuditProgress: () => set({ auditProgress: null }),
      clearAuditJournal: () => set({ auditJournal: "" }),

      runEvidenceAudit: (flags: EvidenceAuditFlag[] | null) =>
        set({ evidenceAuditReport: flags === null ? null : { flags, generatedAt: new Date().toLocaleString() } }),

      // PPD Requirements Review: reads ONLY the Policy & Procedure Document(s)
      // linked to a sub-criterion's evidence folder, then asks the AI
      // (runPPDRequirementsReview in agentRuntime.ts) whether each GD4
      // requirement in that sub-criterion is actually documented in the PPD.
      // Deliberately much leaner than auditFolderStaged: no evidence-folder
      // reading, no checklist writing, no progress modal — this is a
      // standalone review, not part of the scored audit pipeline.
      runPPDReview: async (subCriterionId) => {
        const s = get();
        const folder = s.folders.find((f) => f.subCriterionId === subCriterionId);
        if (!folder) return;
        set({ busy: "ppdreview" + subCriterionId });
        const runId = `PPD-${subCriterionId}-${Date.now().toString(36).toUpperCase()}`;
        // Run-level abort — cancelBusy() kills the in-flight AI call.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;

        const finish = (rows: PPDReviewRow[] | null, live: boolean, liveError: string | undefined, promptSent?: string, usage?: AIUsage, chunkFileNames?: Record<string, string>, overallNarrative?: string, runWarnings?: string[]) => {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          // Sub-criterion roll-up, derived deterministically from the rows.
          // "Not assessed" lines (stopped/failed before review) are counted
          // separately and never counted as gaps.
          const adequate = rows ? rows.filter((r) => r.verdict === "Adequate").length : 0;
          const partial = rows ? rows.filter((r) => r.verdict === "Partial").length : 0;
          const notDocumented = rows ? rows.filter((r) => r.verdict === "Not documented").length : 0;
          const notAssessed = rows ? rows.filter((r) => r.verdict === "Not assessed").length : 0;
          const overallVerdict: PPDOverallVerdict | undefined = rows
            ? notDocumented > 0 ? "PPD Gaps" : partial > 0 ? "PPD Partial" : "PPD Adequate"
            : undefined;
          const overallSummary = rows
            ? (notDocumented === 0 && partial === 0 && notAssessed === 0
              ? `${adequate} of ${rows.length} requirement line${rows.length === 1 ? "" : "s"} adequately documented`
              : `${adequate} adequate · ${partial} partial · ${notDocumented} not documented${notAssessed > 0 ? ` · ${notAssessed} not assessed` : ""}`)
            : undefined;
          const summary = rows
            ? `PPD requirements review${runWarnings?.length ? " (WITH ERRORS — results may be incomplete)" : ""}: ${adequate} Adequate, ${partial} Partial, ${notDocumented} Not documented${notAssessed > 0 ? `, ${notAssessed} Not assessed` : ""} (of ${rows.length}).`
            : `PPD requirements review failed${liveError ? `: ${liveError}` : "."}`;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "PPD Requirements Reviewer",
            reviewType: "Evidence",
            subjectId: subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Review each Partial/Not documented requirement line's suggested rewrite, then compile findings straight from this page.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          };
          set((st) => ({
            ppdReviewResults: rows
              ? { ...st.ppdReviewResults, [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live, promptSent, chunkFileNames, overallVerdict, overallSummary, overallNarrative, runWarnings } }
              : st.ppdReviewResults,
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 200),
            busy: null,
          }));
        };

        try {
          // One row per GD4 requirement LINE (FlatAuditPoint), not per whole
          // requirement item — e.g. 1.2.1 Strategic Planning has 5
          // Describe/Show lines, so 5 rows. Notes/Expected Evidence bullets
          // are excluded; those aren't requirement lines an auditor tests.
          const requirements: PPDRequirementInput[] = GD4_REQUIREMENTS
            .filter((r) => r.subCriterionId === subCriterionId)
            .flatMap((r) =>
              (r.flatAuditPoints ?? [])
                .filter((p) => p.sourceType === "describeShow")
                .map((p) => ({ ref: p.ref, gd4ItemId: r.id, requirementText: p.text }))
            );
          if (requirements.length === 0) { finish(null, false, "No GD4 requirement lines map to this sub-criterion."); return; }

          const policyId = parseFolderId(folder.policyLink) || parseFolderId(folder.folderLink);
          const token = useGoogleDriveStore.getState().getValidToken();
          if (!policyId) { finish(null, false, "No Policy & Procedure folder linked."); return; }
          if (!token) { finish(null, false, "Not connected to Google Drive."); return; }

          const allFiles = await listFolderFilesRecursive(policyId, token);
          // If policyLink is a dedicated folder, every file in it is policy;
          // if it's the shared single-folder convention (folderLink doubling
          // as both), keep only files under the "Policy & Procedure" subfolder.
          const policyFiles = parseFolderId(folder.policyLink)
            ? allFiles
            : allFiles.filter((f) => classifyFileBucket(f.path) === "policy");
          if (policyFiles.length === 0) { finish(null, false, "No Policy & Procedure files found in the linked folder."); return; }

          const MAX_PART_CHARS = 24_000;
          const docParts: string[] = [];
          const chunkFileNames: Record<string, string> = {};
          let chunkCounter = 0;
          for (const file of policyFiles) {
            const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
            const cached = get().fileTextCache[cacheKey];
            let body: string | null;
            if (cached) {
              body = cached.text;
            } else {
              try {
                body = await exportFileText(file, token);
                // Only cache successful extractions — caching `text: null`
                // made a transient read failure stick until the Drive file's
                // modifiedTime changed, with no way to retry.
                if (body != null) {
                  const text = body;
                  set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: file.mimeType, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now() } } }));
                }
              } catch {
                body = null;
              }
            }
            if (!body) continue;
            const fileName = file.path.split("/").pop() || file.path;
            const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
            for (let pi = 0; pi < totalParts; pi++) {
              const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
              docParts.push(`[CHUNK:${chunkId}] --- ${file.path}${partLabel} ---\n${chunkBody}`);
              chunkFileNames[chunkId] = fileName;
            }
          }
          if (docParts.length === 0) { finish(null, false, "No readable text could be extracted from the Policy & Procedure files."); return; }
          const policyDocText = docParts.join("\n\n=== POLICY & PROCEDURE ===\n\n");

          const aiSettings = useAISettingsStore.getState();
          if (!aiSettings.enabled || !aiSettings.apiKey) { finish(null, false, "AI is disabled or no API key is configured in Settings."); return; }
          const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });

          const result = await runPPDRequirementsReview(requirements, policyDocText, analysisSettings, {
            criterionId: subCriterionId,
            // Cancel support: cancelBusy() clears busy and aborts the signal.
            shouldStop: () => get().busy !== "ppdreview" + subCriterionId,
            signal: runAbort.signal,
          });
          // Surface window errors / early stop instead of logging a clean
          // success — a revoked key mid-run used to yield all-"Not documented"
          // rows recorded as a successful review.
          const runWarnings: string[] = [
            ...(result.windowErrors ?? []),
            ...(result.stoppedEarly ? ["Run stopped before every requirement line was reviewed — unreviewed lines are marked Not assessed."] : []),
          ];
          const liveError = result.windowErrors?.length
            ? `${result.windowErrors.length} AI call(s) failed during the review — results may be incomplete. First error: ${result.windowErrors[0]}`
            : undefined;
          finish(result.rows, true, liveError, result.promptSent, result.usage, chunkFileNames, result.overallNarrative, runWarnings.length > 0 ? runWarnings : undefined);
        } catch (err) {
          finish(null, false, err instanceof Error ? err.message : String(err));
        }
      },

      // Reuse path: builds the Evidence tab from the Evidence Folder staged
      // audit's already-stored per-checklist-line results (no AI calls),
      // matched to each PPD requirement line by GD4 ref. Returns true when at
      // least one audited line was found and stored.
      deriveEvidenceAssessmentFromAudit: (subCriterionId) => {
        const s = get();
        const ppd = s.ppdReviewResults[subCriterionId];
        if (!ppd || ppd.rows.length === 0 || ppd.rows.some((r) => !r.ref)) return false;
        const folder = s.folders.find((f) => f.subCriterionId === subCriterionId);

        const entries = useChecklistModuleStore.getState().entries;
        // Index every audited (has a runId-tagged evidence item) checklist line
        // by its sourceRef, normalized with the SAME normalizeAuditRef the
        // staged audit uses — a weaker normalizer here previously let refs
        // that matched in the staged audit (e.g. "DS: 6.1.1.DS1.a") miss in
        // this derive, falsely marking assessed lines as unmatched.
        const lineByRef = new Map<string, { status: SpecificLineStatus; apsr?: ApsrBreakdown; note?: string }>();
        for (const req of GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId)) {
          const entry = entries[req.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            if (!line.sourceRef) continue;
            const auditEv = [...line.evidence].reverse().find((ev) => ev.runId);
            if (!auditEv) continue;
            lineByRef.set(normalizeAuditRef(line.sourceRef), { status: line.status, apsr: auditEv.apsr, note: auditEv.auditorNote });
          }
        }
        if (lineByRef.size === 0) return false;

        const statusToVerdict = (st: SpecificLineStatus): EvidenceVerdict | null =>
          st === "Met" ? "Met" : st === "Partial" ? "Partial" : st === "Not met" ? "Not met" : null;

        const folderUrl = folder?.folderLink || folder?.policyLink || "";
        let matched = 0;
        const rows: EvidenceAssessmentRow[] = ppd.rows.map((p) => {
          const hit = lineByRef.get(normalizeAuditRef(p.ref));
          const verdict = hit ? statusToVerdict(hit.status) : null;
          if (hit && verdict) {
            matched++;
            const apsr = hit.apsr;
            const chunkIds = apsr
              ? [...new Set([...(apsr.approach.sourceChunkIds ?? []), ...(apsr.processes.sourceChunkIds ?? []), ...(apsr.systemsOutcomes.sourceChunkIds ?? []), ...(apsr.review.sourceChunkIds ?? [])])]
              : [];
            const comment = apsr ? apsrAuditNote(apsr) : (hit.note || "");
            const evidenceSummary = apsr ? (apsr.processes.note || apsr.systemsOutcomes.note || "Assessed by the Evidence Folder staged audit.") : (hit.note || "Assessed by the Evidence Folder staged audit.");
            return {
              gdRef: p.ref, gd4ItemId: p.gd4ItemId, requirementText: p.requirementText,
              ppdExtract: p.fullComment || p.shortComment || "", ppdVerdict: p.verdict,
              evidenceSummary,
              evidenceFiles: folderUrl ? [{ name: "Actual Evidence folder", url: folderUrl }] : [],
              evidenceChunkIds: chunkIds,
              verdict, comment,
            };
          }
          // Line not covered by the staged audit — "Not assessed", a neutral
          // state excluded from the findings compile. Defaulting this to
          // "Not met" previously compiled false NC findings for requirement
          // lines that were never actually assessed.
          return {
            gdRef: p.ref, gd4ItemId: p.gd4ItemId, requirementText: p.requirementText,
            ppdExtract: p.fullComment || p.shortComment || "", ppdVerdict: p.verdict,
            evidenceSummary: "Not covered by the Evidence Folder staged audit.",
            evidenceFiles: [], evidenceChunkIds: [],
            verdict: "Not assessed", comment: "No audit result matched this line — run or re-run the evidence assessment.",
          };
        });
        if (matched === 0) return false;

        set((st) => ({
          evidenceAssessments: {
            ...st.evidenceAssessments,
            [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live: true, derivedFromAudit: true },
          },
        }));
        return true;
      },

      // Fresh path (only needed when no staged-audit result exists). Reuses the
      // already-decided PPD verdict per requirement line (no policy re-read),
      // reads the Actual Evidence folder, and produces a combined verdict per
      // line, with live progress and per-line failure isolation.
      runEvidenceAssessment: async (subCriterionId) => {
        const s = get();
        const folder = s.folders.find((f) => f.subCriterionId === subCriterionId);
        if (!folder) return;
        const ppd = s.ppdReviewResults[subCriterionId];
        set({ busy: "evidenceassess" + subCriterionId });
        const runId = `EV-${subCriterionId}-${Date.now().toString(36).toUpperCase()}`;
        // Run-level abort — cancelBusy() kills the in-flight AI call.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;

        const finish = (rows: EvidenceAssessmentRow[] | null, live: boolean, liveError: string | undefined, promptSent?: string, usage?: AIUsage, chunkFileNames?: Record<string, string>) => {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          const notAssessedCount = rows ? rows.filter((r) => r.verdict === "Not assessed").length : 0;
          const summary = rows
            ? `Evidence assessment${notAssessedCount > 0 ? " (PARTIAL — stopped early)" : ""}: ${rows.filter((r) => r.verdict === "Met").length} Met, ${rows.filter((r) => r.verdict === "Partial").length} Partial, ${rows.filter((r) => r.verdict === "Not met").length} Not met${notAssessedCount > 0 ? `, ${notAssessedCount} Not assessed` : ""} (of ${rows.length}).`
            : `Evidence assessment failed${liveError ? `: ${liveError}` : "."}`;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Evidence Assessor",
            reviewType: "Evidence",
            subjectId: subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Review each Partial/Not met line, then compile findings straight from the Evidence tab.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          };
          set((st) => ({
            evidenceAssessments: rows
              ? { ...st.evidenceAssessments, [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live, promptSent, chunkFileNames, derivedFromAudit: false } }
              : st.evidenceAssessments,
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 200),
            busy: null,
            evidenceAssessmentProgress: null,
          }));
        };
        const setEvProgress = (detail: string, pct: number) =>
          set({ evidenceAssessmentProgress: { subCriterionId, pct, detail } });

        try {
          if (!ppd || ppd.rows.length === 0) { finish(null, false, "Run the PPD review first — the Evidence tab reuses its per-line verdicts."); return; }

          const evidenceId = parseFolderId(folder.folderLink) || parseFolderId(folder.policyLink);
          const token = useGoogleDriveStore.getState().getValidToken();
          if (!evidenceId) { finish(null, false, "No Actual Evidence folder linked."); return; }
          if (!token) { finish(null, false, "Not connected to Google Drive."); return; }

          setEvProgress("Reading the Actual Evidence folder…", 3);
          const allFiles = await listFolderFilesRecursive(evidenceId, token);
          // Dedicated evidence folder -> all files are evidence; shared
          // single-folder convention -> keep only the "Actual Evidence" bucket.
          const evidenceFiles = parseFolderId(folder.folderLink)
            ? allFiles
            : allFiles.filter((f) => classifyFileBucket(f.path) === "evidence");

          const MAX_PART_CHARS = 24_000;
          const docParts: string[] = [];
          const chunkFileNames: Record<string, string> = {};
          const chunkFileRefs: Record<string, EvidenceFileRef> = {};
          let chunkCounter = 0;
          for (const file of evidenceFiles) {
            const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
            const cached = get().fileTextCache[cacheKey];
            let body: string | null;
            if (cached) {
              body = cached.text;
            } else {
              try {
                body = await exportFileText(file, token);
                // Only cache successful extractions — see runPPDReview.
                if (body != null) {
                  const text = body;
                  set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: file.mimeType, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now() } } }));
                }
              } catch {
                body = null;
              }
            }
            if (!body) continue;
            const fileName = file.path.split("/").pop() || file.path;
            const fileUrl = `https://drive.google.com/file/d/${file.id}/view`;
            const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
            for (let pi = 0; pi < totalParts; pi++) {
              const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
              docParts.push(`[CHUNK:${chunkId}] --- ${file.path}${partLabel} ---\n${chunkBody}`);
              chunkFileNames[chunkId] = fileName;
              chunkFileRefs[chunkId] = { name: fileName, url: fileUrl };
            }
          }
          const evidenceDocText = docParts.join("\n\n=== ACTUAL EVIDENCE ===\n\n");

          const aiSettings = useAISettingsStore.getState();
          if (!aiSettings.enabled || !aiSettings.apiKey) { finish(null, false, "AI is disabled or no API key is configured in Settings."); return; }
          const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });

          const inputs: EvidenceAssessmentInput[] = ppd.rows.map((r) => ({
            ref: r.ref,
            requirementText: r.requirementText,
            ppdVerdict: r.verdict,
            ppdExtract: r.fullComment || r.shortComment || "",
          }));
          const result = await runEvidenceAssessment(inputs, evidenceDocText, analysisSettings, {
            criterionId: subCriterionId,
            onProgress: (detail, pct) => setEvProgress(detail, typeof pct === "number" ? Math.max(3, Math.min(99, pct)) : 50),
            shouldStop: () => get().busy !== "evidenceassess" + subCriterionId,
            signal: runAbort.signal,
          });

          // Merge AI line results with the reused PPD data + resolved file refs.
          const byRef = new Map(result.rows.map((r) => [r.ref, r]));
          const rows: EvidenceAssessmentRow[] = ppd.rows.map((p) => {
            const ev = byRef.get(p.ref);
            const chunkIds = ev?.chunkIds ?? [];
            // Dedupe file refs by name across the row's cited chunks.
            const seen = new Set<string>();
            const evidenceFilesForRow: EvidenceFileRef[] = [];
            for (const cid of chunkIds) {
              const ref = chunkFileRefs[cid];
              if (ref && !seen.has(ref.name)) { seen.add(ref.name); evidenceFilesForRow.push(ref); }
            }
            return {
              gdRef: p.ref,
              gd4ItemId: p.gd4ItemId,
              requirementText: p.requirementText,
              ppdExtract: p.fullComment || p.shortComment || "",
              ppdVerdict: p.verdict,
              evidenceSummary: ev?.evidenceSummary || "No implementation evidence found for this requirement.",
              evidenceFiles: evidenceFilesForRow,
              evidenceChunkIds: chunkIds,
              verdict: ev?.verdict ?? "Not met",
              comment: ev?.comment || "",
              assessmentFailed: ev?.failed,
            };
          });
          finish(rows, true, undefined, result.promptSent, result.usage, chunkFileNames);
        } catch (err) {
          finish(null, false, err instanceof Error ? err.message : String(err));
        }
      },

      // Raises one Finding per Evidence-tab row not yet compiled, from the
      // combined verdict — Not met -> NC, Partial -> OFI, Met -> OBS (same
      // classification the checklist uses, see findingClassification.ts).
      // Feeds the same Findings register / QA-AFI pipeline as everything else.
      compileEvidenceFindings: (subCriterionId) => {
        const s = get();
        const result = s.evidenceAssessments[subCriterionId];
        if (!result) return 0;
        let raised = 0;
        const rows = result.rows.map((row) => {
          // "Not assessed" rows raise nothing — no audit result ever matched
          // this line, so there is no verdict to base a finding on.
          if (row.savedFindingId || row.assessmentFailed || row.verdict === "Not assessed") return row;
          const req = GD4_REQUIREMENTS.find((r) => r.id === row.gd4ItemId);
          const findingType: FindingTypeCode = findingTypeForStatus(row.verdict);
          const ncSeverity: NcSeverity | null = findingType === "NC" ? (req?.gateSensitive ? "Major" : "Minor") : null;
          const issue =
            row.verdict === "Met" ? `Requirement documented and evidenced: ${row.requirementText}`
            : row.verdict === "Partial" ? `Requirement only partly documented or evidenced: ${row.requirementText}`
            : `Requirement not documented or evidenced: ${row.requirementText}`;
          const finding: Finding = {
            id: `EV-${Date.now().toString(36).toUpperCase()}-${raised}`,
            auditCycleId: s.cycle.id,
            gd4ItemId: row.gd4ItemId,
            issue,
            type: findingType === "OBS" ? "Observation" : "AFI",
            severity: ncSeverity === "Major" ? "High" : findingType === "OFI" ? "Medium" : "Low",
            owner: "SQ",
            dueDate: "",
            repeatFinding: false,
            overdue: false,
            managementDecisionNeeded: ncSeverity === "Major",
            status: "Open",
            source: "PPD Review",
            createdAt: new Date().toISOString(),
            dimension: "Evidence",
            clause: row.gdRef,
            observation: row.comment || row.evidenceSummary,
            criteria: row.requirementText,
            findingType,
            ncSeverity,
          };
          get().addCustomFinding(finding);
          raised++;
          return { ...row, savedFindingId: finding.id };
        });
        if (raised > 0) {
          set((st) => ({ evidenceAssessments: { ...st.evidenceAssessments, [subCriterionId]: { ...result, rows } } }));
        }
        return raised;
      },

      setAnalysisPath: (subCriterionId, path) =>
        set((s) => ({ analysisPath: { ...s.analysisPath, [subCriterionId]: path } })),

      // Appends one git push/pull entry to the change log, deduped by
      // commitHash so re-visits / re-renders of the same build don't log the
      // same commit twice. Derives the plain-English summary from the commit
      // message when the caller doesn't supply one.
      recordChangeLogEntry: (entry) =>
        set((s) => {
          if (!entry.commitHash || entry.commitHash === "unknown") return {};
          if (s.changeLog.some((e) => e.commitHash === entry.commitHash && e.action === entry.action)) return {};
          const full: ChangeLogEntry = {
            id: `CL-${entry.commitHash}-${entry.action}`,
            summary: entry.summary?.trim() || summariseCommitMessage(entry.commitMessage),
            ...entry,
          };
          return { changeLog: [full, ...s.changeLog].slice(0, 500) };
        }),

      // Fills the workspace with realistic sample evidence ratings plus the
      // workflow-progress fields derived from them (reviewer drafts,
      // sign-offs, closures, samples, interview prep, management review
      // pack, export log, sample auditor roster). A brand-new workspace
      // starts fully blank (blankEvidence()/auditors:[] above) — this is the
      // only path that populates it.
      loadDemoDataset: () => {
        useChecklistModuleStore.getState().loadDemoChecklistData();
        set((s) => {
          const evidence = seedEvidence();
          return {
            evidence,
            auditors: DEFAULT_AUDITORS,
            seedFindingsLoaded: true,
            cycle: { ...s.cycle, ...DEMO_CYCLE_FIELDS },
            ...buildDemoDataset(evidence),
          };
        });
      },

      // Snapshot+restore versioning: every save captures a full copy of the
      // working state, so a version in the list can be restored exactly, not
      // just relabelled.
      saveAsNewVersion: (name, note) =>
        set((s) => {
          const m = s.cycle.version.match(/v0\.(\d+)/);
          const nv = m ? `v0.${Number(m[1]) + 1}` : "v0.2";
          const snapshot: WorkspaceSnapshot = {
            cycle: { ...s.cycle, version: nv, lastSavedAt: new Date().toLocaleString() },
            evidence: s.evidence,
            reviewer: s.reviewer,
            confirmed: s.confirmed,
            justify: s.justify,
            closures: s.closures,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            managementReviewItems: s.managementReviewItems,
            checklistEntries: useChecklistModuleStore.getState().entries,
            customFindings: s.customFindings,
            seedFindingsLoaded: s.seedFindingsLoaded,
            itemReviews: s.itemReviews,
            aiReviewLog: s.aiReviewLog.map(truncatePromptSent),
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            agentMemory: useAgentMemoryStore.getState().memory,
            auditJournal: s.auditJournal,
            // Option A state + run history (promptSent truncated — snapshots
            // are persisted, and full prompts embed school-document text).
            ppdReviewResults: mapRecordValues(s.ppdReviewResults, truncatePromptSent),
            evidenceAssessments: mapRecordValues(s.evidenceAssessments, truncatePromptSent),
            analysisPath: s.analysisPath,
            auditRunHistory: s.auditRunHistory,
          };
          const entry: VersionEntry = {
            id: `VER-${Date.now()}`,
            name: name.trim() || `${nv} Draft`,
            version: nv,
            date: new Date().toLocaleString(),
            status: s.cycle.status,
            note: note?.trim() || "Saved",
            snapshot,
          };
          const allVersions = [entry, ...s.versions];
          if (allVersions.length > 50) {
            console.warn(`Version history capped at 50 — oldest version "${allVersions[50].name}" was dropped.`);
          }
          return {
            cycle: snapshot.cycle,
            versions: allVersions.slice(0, 50),
          };
        }),

      restoreVersion: (versionId) =>
        set((s) => {
          const entry = s.versions.find((v) => v.id === versionId);
          if (!entry) return {};
          const snap = entry.snapshot;
          // Roll the checklist module back together with the workspace so the
          // restored bands match. Older snapshots may not carry it, in which
          // case the current checklist is left untouched.
          if (snap.checklistEntries) useChecklistModuleStore.getState().replaceAllEntries(snap.checklistEntries);
          if (snap.agentMemory) useAgentMemoryStore.getState().replaceAllMemory(snap.agentMemory);
          const logEntry = {
            restoredAt: new Date().toLocaleString(),
            fromVersion: entry.version,
            fromNote: entry.note || entry.name,
          };
          return {
            cycle: { ...snap.cycle, updatedAt: new Date().toISOString() },
            evidence: snap.evidence,
            reviewer: snap.reviewer,
            confirmed: snap.confirmed,
            justify: snap.justify,
            closures: snap.closures as WorkspaceState["closures"],
            folders: snap.folders,
            samples: snap.samples,
            interviewQuestions: snap.interviewQuestions,
            managementReviewItems: snap.managementReviewItems,
            customFindings: snap.customFindings ?? s.customFindings,
            seedFindingsLoaded: snap.seedFindingsLoaded ?? s.seedFindingsLoaded,
            // Restore the AI verdicts/log and context so nothing is silently
            // lost; fall back to current state for pre-existing snapshots.
            itemReviews: (snap.itemReviews as WorkspaceState["itemReviews"]) ?? s.itemReviews,
            aiReviewLog: snap.aiReviewLog ?? s.aiReviewLog,
            schoolContext: snap.schoolContext ?? s.schoolContext,
            additionalInfo: snap.additionalInfo ?? s.additionalInfo,
            auditJournal: (snap as WorkspaceSnapshot & { auditJournal?: string }).auditJournal ?? s.auditJournal,
            // Option A state + run history roll back WITH the findings they
            // reference. Unlike the fields above, snapshots that predate
            // these fields CLEAR them (?? {}) instead of keeping current
            // state — keeping it would leave PPD/evidence rows whose
            // savedFindingIds point at findings that no longer exist after
            // customFindings rolled back.
            ppdReviewResults: snap.ppdReviewResults ?? {},
            evidenceAssessments: snap.evidenceAssessments ?? {},
            analysisPath: snap.analysisPath ?? {},
            auditRunHistory: snap.auditRunHistory ?? {},
            // Derived from the restored history: latest run per folder.
            lastAuditRuns: Object.fromEntries(
              Object.entries(snap.auditRunHistory ?? {})
                .filter(([, runs]) => runs.length > 0)
                .map(([folderId, runs]) => [folderId, runs[0]])
            ),
            // Append to the immutable restore audit trail
            restoreLog: [...s.restoreLog, logEntry],
          };
        }),

      lockCycle: () =>
        set((s) => {
          const snapshot: WorkspaceSnapshot = {
            cycle: { ...s.cycle, status: "Locked" },
            evidence: s.evidence,
            reviewer: s.reviewer,
            confirmed: s.confirmed,
            justify: s.justify,
            closures: s.closures,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            managementReviewItems: s.managementReviewItems,
            checklistEntries: useChecklistModuleStore.getState().entries,
            customFindings: s.customFindings,
            seedFindingsLoaded: s.seedFindingsLoaded,
            itemReviews: s.itemReviews,
            aiReviewLog: s.aiReviewLog.map(truncatePromptSent),
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            agentMemory: useAgentMemoryStore.getState().memory,
            auditJournal: s.auditJournal,
            // Option A state + run history (promptSent truncated — snapshots
            // are persisted, and full prompts embed school-document text).
            ppdReviewResults: mapRecordValues(s.ppdReviewResults, truncatePromptSent),
            evidenceAssessments: mapRecordValues(s.evidenceAssessments, truncatePromptSent),
            analysisPath: s.analysisPath,
            auditRunHistory: s.auditRunHistory,
          };
          const entry: VersionEntry = {
            id: `VER-${Date.now()}`,
            name: `${s.cycle.version} Locked`,
            version: s.cycle.version,
            date: new Date().toLocaleString(),
            status: "Locked",
            note: "Final version locked",
            snapshot,
          };
          return { cycle: snapshot.cycle, versions: [entry, ...s.versions].slice(0, 50) };
        }),

      unlockCycle: () => set((s) => ({ cycle: { ...s.cycle, status: "Under Review" } })),

      duplicateCycle: () =>
        set((s) => ({
          cycle: { ...s.cycle, id: `cycle-${Date.now()}`, name: `${s.cycle.name} (Copy)`, status: "Draft", version: "v0.1 Draft", lastSavedAt: "Not saved", createdAt: new Date().toISOString() },
        })),

      // Unlike duplicateCycle (which keeps every bit of evidence, findings,
      // checklist data etc. as-is — a true copy), this wipes the workspace
      // back to the exact same blank slate as a fresh install: only the
      // structural/reference data (rubric, department directory, agents,
      // folder skeleton) AND the saved versions survive. The confirm dialogs
      // on Draft Workspace / Audit Cycle explicitly promise "saved versions
      // are not affected" — `versions` is therefore deliberately NOT reset
      // here (it previously was, silently breaking that promise). Demo data
      // only returns if "Use demo data" is clicked again afterward.
      createNewCycle: () => {
        useChecklistModuleStore.getState().replaceAllEntries({});
        // Sibling stores that must not leak the old cycle's context into the
        // new one: per-agent AI memory (old conversations otherwise keep
        // feeding new prompts) and grouped finding drafts (their
        // savedFindingIds point at findings wiped below).
        useAgentMemoryStore.getState().clearMemory();
        useFindingDraftStore.getState().resetAllDrafts();
        set(() => ({
          cycle: { ...DEFAULT_CYCLE, id: `cycle-${Date.now()}`, name: "New Audit Cycle", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          evidence: blankEvidence(),
          reviewer: {},
          confirmed: {},
          justify: {},
          closures: {},
          auditors: [],
          departments: DEFAULT_DEPARTMENTS,
          folders: seedFolders(),
          itemReviews: {},
          aiReviewLog: [],
          humanDecisionLog: [],
          calibrationExamples: [],
          calibrationMemories: [],
          samples: [],
          interviewQuestions: [],
          managementReviewItems: [],
          exportLog: [],
          customFindings: [],
          seedFindingsLoaded: false,
          evidenceAuditReport: null,
          ppdReviewResults: {},
          evidenceAssessments: {},
          evidenceAssessmentProgress: null,
          analysisPath: {},
          auditJournal: "",
          // Old cycle's school briefing and audit-run history must not carry
          // into a brand-new cycle's AI calls / folder panels.
          schoolContext: { text: "", link: "" },
          auditRunHistory: {},
          lastAuditRuns: {},
        }));
      },

      setEvidenceField: (itemId, field, value) =>
        set((s) => ({ evidence: { ...s.evidence, [itemId]: { ...s.evidence[itemId], [field]: value } } })),

      // Editing the reviewer score after a confirm invalidates that
      // confirmation, so a stale "Confirmed" badge can never sit next to a
      // Reviewer input showing a different number — the reviewer must
      // explicitly re-confirm (and re-justify if still required) the new value.
      setReviewerScore: (itemId, rawValue) => {
        // Scores are 0–100 by definition; an unclamped value (e.g. a 999
        // typo) previously flowed straight into eff and inflated the whole
        // criterion average and the award. Reject non-numeric input outright
        // and coerce out-of-range values to the nearest bound.
        if (!Number.isFinite(rawValue)) return;
        const value = Math.max(0, Math.min(100, rawValue));
        const s = get();
        const aiBand = aiScore(s.evidence[itemId]);
        if (aiBand !== value) {
          get().logHumanDecision({
            module: "Item Scoring",
            subjectId: itemId,
            aiOutput: `AI band: ${aiBand}`,
            humanDecision: `Reviewer band: ${value}`,
            changed: true,
            decisionType: "Overridden",
            reason: s.justify[itemId] || "",
            field: "band",
          });
        }
        set((s2) => ({
          reviewer: { ...s2.reviewer, [itemId]: value },
          confirmed: s2.confirmed[itemId] != null ? { ...s2.confirmed, [itemId]: null } : s2.confirmed,
        }));
      },

      setJustify: (itemId, value) => set((s) => ({ justify: { ...s.justify, [itemId]: value } })),

      // Enforces the justification requirement here, not just in the
      // Criterion Scorecard's button handler, so it can't be bypassed by any
      // other caller (e.g. Re-audit's reopen button reuses this action).
      confirmScore: (itemId) =>
        set((s) => {
          const already = s.confirmed[itemId] != null;
          if (already) return { confirmed: { ...s.confirmed, [itemId]: null } };
          const ev = s.evidence[itemId];
          const ais = aiScore(ev);
          const rev = s.reviewer[itemId] != null ? s.reviewer[itemId] : ais;
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          if (needsJustification(ais, rev, !!req?.gateSensitive) && !(s.justify[itemId] || "").trim()) return {};
          return { confirmed: { ...s.confirmed, [itemId]: rev } };
        }),

      setAgentStrictness: (agentId, value) => set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, strictness: value } : a)) })),

      // Tries a live OpenAI call (Settings page) when configured and enabled;
      // falls back to the deterministic offline simulation otherwise or on
      // any request failure. Either path only ever produces advisory
      // justification text — the score/band passed in is always the one
      // already computed by scoring.ts, never decided by the AI call.
      runItemAI: async (agentId, itemId) => {
        const s = get();
        set({ busy: itemId + agentId });
        const agent = s.agents.find((a) => a.id === agentId)!;
        const ev = s.evidence[itemId];
        const scored = buildScored(s);
        const item = scored.items.find((i) => i.id === itemId)!;

        const aiSettings = useAISettingsStore.getState();
        let verdict;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const memory = useAgentMemoryStore.getState().memory[agentId] || [];
            const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
            verdict = await runLiveItemReview(agent, item, ev, settings, memory);
            const bandLabels = ["", "Band 1 — no system", "Band 2 — awareness", "Band 3 — systematic", "Band 4 — integrated", "Band 5 — excellent"];
            const bandLabel = bandLabels[item.band] || `Band ${item.band}`;
            useAgentMemoryStore.getState().addMemory(agentId, { role: "user", content: `GD4 ${itemId}: requesting review. Evidence score ${item.eff}/100, band ${item.band}.`, createdAt: new Date().toISOString() });
            useAgentMemoryStore.getState().addMemory(agentId, { role: "assistant", content: `GD4 ${itemId} reviewed: Band ${verdict.band} (${bandLabel}). ${verdict.justification} Recommendation: ${verdict.higherBand}`, createdAt: new Date().toISOString() });
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            verdict = simulateItemReview(agent, item, ev);
          }
        } else {
          verdict = simulateItemReview(agent, item, ev);
        }

        const log: AIReviewLogEntry = {
          id: `LOG-${Date.now()}-${++logCounter}`,
          auditCycleId: s.cycle.id,
          agent: agent.name,
          reviewType: "Scoring",
          subjectId: itemId,
          verdict: verdict.band >= 4 ? "Acceptable" : verdict.band === 3 ? "Partial" : "Maintain Finding",
          confidence: verdict.confidence,
          keyConcerns: [verdict.justification],
          recommendedAction: verdict.higherBand,
          suggestedScore: verdict.score,
          suggestedBand: verdict.band as 1 | 2 | 3 | 4 | 5,
          live: verdict.live,
          liveError,
          generatedContent: verdict.justification,
          createdAt: new Date().toISOString(),
          model: (verdict as { usage?: AIUsage }).usage?.model,
          promptTokens: (verdict as { usage?: AIUsage }).usage?.promptTokens,
          completionTokens: (verdict as { usage?: AIUsage }).usage?.completionTokens,
          totalTokens: (verdict as { usage?: AIUsage }).usage?.totalTokens,
        };
        set({ itemReviews: { ...s.itemReviews, [itemId]: verdict }, aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200), busy: null });
      },

      setClosureField: (afiId, field, value) => {
        if (field === "root" || field === "corr" || field === "prev") {
          const c = get().closures[afiId] || {};
          const prev = (c[field] as string | undefined) ?? "";
          // Only log when there was prior AI-drafted content being changed
          if (prev && value !== prev) {
            get().logHumanDecision({
              module: "Closure Drafting",
              subjectId: afiId,
              aiOutput: prev,
              humanDecision: value,
              changed: true,
              decisionType: "Edited",
              reason: "",
              field,
            });
          }
        }
        set((s) => ({ closures: { ...s.closures, [afiId]: { ...(s.closures[afiId] || {}), [field]: value } } }));
      },

      seedClosure: (afiId, seed) =>
        set((s) => {
          const c = s.closures[afiId] || {};
          return {
            closures: {
              ...s.closures,
              // Only fill blanks — never clobber the user's own text.
              [afiId]: { ...c, root: c.root?.trim() || seed.root, corr: c.corr?.trim() || seed.corr, prev: c.prev?.trim() || seed.prev },
            },
          };
        }),

      runClosureAI: async (afiId) => {
        const s = get();
        set({ busy: "clx" + afiId });
        const c = s.closures[afiId] || {};

        const aiSettings = useAISettingsStore.getState();
        let verdict;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const memory = useAgentMemoryStore.getState().memory["closure-reviewer"] || [];
            const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
            const closureCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "AFI Closure").slice(0, 3);
            verdict = await runLiveClosureReview(c, settings, memory, closureCalibration);
            useAgentMemoryStore.getState().addMemory("closure-reviewer", { role: "user", content: `Reviewed closure for ${afiId}.`, createdAt: new Date().toISOString() });
            useAgentMemoryStore.getState().addMemory("closure-reviewer", { role: "assistant", content: verdict.reason, createdAt: new Date().toISOString() });
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            verdict = simulateClosure(c);
          }
        } else {
          verdict = simulateClosure(c);
        }

        const log: AIReviewLogEntry = {
          id: `LOG-${Date.now()}-${++logCounter}`,
          auditCycleId: s.cycle.id,
          agent: "Closure Reviewer",
          reviewType: "Closure",
          subjectId: afiId,
          verdict: verdict.verdict,
          confidence: "Medium",
          keyConcerns: [verdict.reason],
          recommendedAction: verdict.evidenceNeeded,
          evidenceNeeded: verdict.evidenceNeeded,
          live: verdict.live,
          liveError,
          generatedContent: verdict.reason,
          createdAt: new Date().toISOString(),
          model: (verdict as { usage?: AIUsage }).usage?.model,
          promptTokens: (verdict as { usage?: AIUsage }).usage?.promptTokens,
          completionTokens: (verdict as { usage?: AIUsage }).usage?.completionTokens,
          totalTokens: (verdict as { usage?: AIUsage }).usage?.totalTokens,
        };
        set({
          closures: { ...s.closures, [afiId]: { ...c, ai: verdict.verdict, aiReason: verdict.reason, aiNeed: verdict.evidenceNeeded, live: verdict.live } },
          aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200),
          busy: null,
        });
      },

      // Automation: AI first-draft of root/corrective/preventive for a finding,
      // written into the closure fields for the auditor to edit. Only fills a
      // field the auditor hasn't already written, so it never overwrites work.
      draftClosureActions: async (afiId, issue, gd4ItemId) => {
        const aiSettings = useAISettingsStore.getState();
        if (!aiSettings.enabled || !aiSettings.apiKey) return;
        set({ busy: "clxdraft" + afiId });
        try {
          const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
          // Give the AI the real GD4 requirement and (if the line was audited)
          // the APSR breakdown, so the draft is grounded in the standard and
          // names the rubric dimension that fell short — not a generic guess.
          const req = GD4_REQUIREMENTS.find((r) => r.id === gd4ItemId);
          const standard = req ? `${req.requirement}\nIntent: ${req.intent}\nExpected evidence: ${req.expectedEvidence.join("; ")}` : undefined;
          const entry = useChecklistModuleStore.getState().entries[gd4ItemId];
          const auditedLine = entry?.specific.find((l) => l.draftFinding?.savedFindingId === afiId);
          const apsr = auditedLine ? lineApsr(auditedLine) : undefined;
          const closureDraftCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "Closure Drafting").slice(0, 3);
          const draft = await runLiveClosureDraft({ issue, gd4ItemId }, settings, { standard, apsr: apsr ? apsrReason(apsr) : undefined, calibration: closureDraftCalibration });
          // Record this AI run so every AI use shows in the AI Review Log.
          get().pushAIReviewLog({
            agent: "Closure Drafter",
            reviewType: "Closure",
            subjectId: gd4ItemId,
            verdict: "Actions drafted",
            confidence: "Medium",
            keyConcerns: ["Root cause, corrective and preventive actions drafted for review"],
            recommendedAction: "Review and edit the drafted actions, then link closure evidence.",
            live: true,
            generatedContent: `ROOT CAUSE:\n${draft.root}\n\nCORRECTIVE:\n${draft.corr}\n\nPREVENTIVE:\n${draft.prev}`,
            promptSent: draft.promptSent,
            usage: draft.usage,
          });
          set((s) => {
            const c = s.closures[afiId] || {};
            return {
              closures: {
                ...s.closures,
                [afiId]: {
                  ...c,
                  root: c.root?.trim() || formatDraftedClosureText(draft.root),
                  corr: c.corr?.trim() || formatDraftedClosureText(draft.corr),
                  prev: c.prev?.trim() || formatDraftedClosureText(draft.prev),
                },
              },
              busy: null,
            };
          });
        } catch (err) {
          set({ busy: null });
          throw err;
        }
      },

      setClosureHuman: (afiId, value, reason = "") => {
        const s = get();
        const c = s.closures[afiId] || {};
        const aiVerdict = c.ai ?? "";
        const changed = value !== aiVerdict;
        get().logHumanDecision({
          module: "AFI Closure",
          subjectId: afiId,
          aiOutput: aiVerdict ? `AI verdict: ${aiVerdict}${c.aiReason ? ` — ${c.aiReason}` : ""}` : "No AI verdict yet",
          humanDecision: value || "(cleared)",
          changed,
          decisionType: !aiVerdict ? "Accepted" : changed ? "Overridden" : "Accepted",
          reason,
          field: "human",
        });
        set((s) => ({ closures: { ...s.closures, [afiId]: { ...(s.closures[afiId] || {}), human: value } } }));
      },

      addAuditor: (a) => set((s) => ({ auditors: [...s.auditors, a] })),
      updateAuditor: (id, patch) => set((s) => ({ auditors: s.auditors.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      removeAuditor: (id) => set((s) => ({ auditors: s.auditors.filter((a) => a.id !== id) })),

      addDepartment: (d) => set((s) => ({ departments: [...s.departments, d] })),
      updateDepartment: (id, patch) => set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      removeDepartment: (id) => set((s) => ({ departments: s.departments.filter((d) => d.id !== id) })),
      resetDepartments: () => set({ departments: DEFAULT_DEPARTMENTS }),

      setFolderField: (id, field, value) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, [field]: value } : f)) })),

      // "Check access" action on the Evidence Folder page: a real Drive API
      // call (files.list) confirming whether the connected Google account can
      // actually see this folder's files. No AI involved — this only answers
      // "can we read it", not "what's in it".
      checkFolderAccess: async (id, tab = "evidence") => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        set({ busy: `folderaccess:${tab}:` + id });

        const link = tab === "policy" ? folder.policyLink : folder.folderLink;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        const checkedAt = new Date().toISOString();
        const label = tab === "policy" ? "Policy & Procedure" : "Actual Evidence";

        let status: DriveAccessStatus;
        let note: string;
        if (!folderId) {
          status = "Error";
          note = `Could not find a Drive folder ID in the ${label} link. Paste a Google Drive folder link (e.g. https://drive.google.com/drive/folders/<id>).`;
        } else if (!token) {
          status = "Not Connected";
          note = "Not connected to Google Drive. Connect your Google account in Settings, then try again.";
        } else {
          try {
            const files = await listFolderFilesRecursive(folderId, token);
            status = "Connected";
            note = files.length
              ? `Connected — found ${files.length} file${files.length === 1 ? "" : "s"} in the ${label} folder (including subfolders).`
              : `Connected, but the ${label} folder (and its subfolders) appears to be empty.`;
          } catch (err) {
            status = "Error";
            if (err instanceof DriveApiError && err.status === 404) note = "Drive could not find this folder. Check the link and that it points to a folder, not a file.";
            else if (err instanceof DriveApiError && err.status === 403)
              note = `Drive denied access to this folder (${err.reason || "no further detail from Google"}). Confirm the connected Google account has at least viewer access — if this folder lives in a Shared Drive, also confirm the account is a member of that Shared Drive, not just shared the folder link.`;
            else note = err instanceof Error ? err.message : String(err);
          }
        }

        set((st) => ({
          folders: st.folders.map((f) =>
            f.id === id
              ? tab === "policy"
                ? { ...f, policyAccessStatus: status, policyAccessNote: note, policyAccessAt: checkedAt }
                : { ...f, accessCheckStatus: status, accessCheckNote: note, accessCheckAt: checkedAt }
              : f
          ),
          busy: null,
        }));
      },

      // "Run audit" action on the Evidence Folder page. Reads every
      // supported document in the folder via the real Drive API, judges the
      // checklist lines belonging to this sub-criterion against that real
      // text (live OpenAI call when configured, offline keyword heuristic
      // otherwise), and — per the user's explicit choice for this one
      // feature — writes the verdicts straight into the Sub-Criterion
      // Checklist rather than just advising. This is the only AI feature in
      // the app permitted to do that.
      auditFolderContents: async (id, extraContext, overallProgress) => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        set({ busy: "folderaudit" + id });
        // Capture the cancellation token at start — if cancelBusy() is called
        // while the AI call is in flight, this value will no longer match
        // get().auditRunToken and the results will be discarded without writing.
        const capturedToken = get().auditRunToken;
        const scope = get().auditScope;

        // Emits a progress update so the UI step-indicator and progress bar
        // reflect the current stage in real time. Merges into the existing
        // auditProgress so persistent fields (filesFound, connectInfo, etc.)
        // survive stage transitions without needing to be re-emitted each time.
        const setProgress = (stage: AuditProgressState["stage"], extra?: Partial<AuditProgressState>) => {
          set((st) => {
            const prev = st.auditProgress?.folderId === id ? st.auditProgress : {};
            return {
              auditProgress: {
                ...prev,
                folderId: id,
                folderName: folder.folderName,
                subCriterionId: folder.subCriterionId,
                overallCurrent: overallProgress?.current,
                overallTotal: overallProgress?.total,
                stage,
                // Reset per-file transient fields so they don't bleed across stages.
                currentFileName: undefined,
                currentFileBucket: undefined,
                currentFileAction: undefined,
                stageDetail: undefined,
                errorMessage: undefined,
                ...extra,
              } as AuditProgressState,
            };
          });
        };
        // Track whether this run ended in error so finish() can set the right
        // terminal stage (complete vs error) without needing an extra parameter.
        let auditHadError = false;
        const auditStartedAt = Date.now();
        setProgress("listing", {
          stageDetail: "Listing Drive folder files…",
          status: "running",
          canCancel: true,
          startedAt: auditStartedAt,
          lastHeartbeatAt: auditStartedAt,
        });

        // Safety net: any unexpected exception that escapes the inner
        // try/catches calls finish() with the error message so the button
        // never gets stuck on "Auditing…" indefinitely.
        try {
        // Newest file modifiedTime seen this run; recorded so a later
        // "re-audit only changed" pass can skip folders that haven't changed.
        let newestModified: string | undefined;

        // One short id for this whole run, stamped on the result row, the AI
        // Review Log entry, every checklist evidence item created, and the
        // journal entry — so any verdict can be traced back to its source run.
        const runId = makeRunId(folder.subCriterionId);

        // The auditor this run is on behalf of: the chosen "active" auditor,
        // else the Audit Lead, else the first auditor. Their strictness drives
        // the AI; their name is stamped on the result so it's attributed to a
        // person, not just "AI".
        const actingAuditor =
          s.auditors.find((a) => a.id === get().activeAuditorId) ||
          s.auditors.find((a) => a.role === "Audit Lead") ||
          s.auditors[0];
        const auditorName = actingAuditor?.name || "Unassigned (no auditor set up)";
        const auditorStrictness = actingAuditor ? strictnessFromScore(actingAuditor.strictness) : undefined;
        const auditorLabel = actingAuditor ? `${auditorName} (strictness: ${auditorStrictness})` : auditorName;

        const finish = (summary: string, live: boolean, liveError?: string, usage?: AIUsage, auxUsage?: AIUsage) => {
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Evidence Intake Assistant",
            reviewType: "Evidence",
            subjectId: folder.subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Spot-check the auto-set checklist lines against the source documents.",
            live,
            liveError,
            generatedContent: summary,
            createdAt: new Date().toISOString(),
            runId,
            // Analysis model (verdict call)
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: (usage?.totalTokens || 0) + (auxUsage?.totalTokens || 0) || undefined,
            // Utility model (image + condense calls) — stored separately so the
            // AI Review Log can price each model at its own rate.
            auxModel: auxUsage?.model,
            auxPromptTokens: auxUsage?.promptTokens,
            auxCompletionTokens: auxUsage?.completionTokens,
            auxTotalTokens: auxUsage?.totalTokens,
          };
          const terminalStage = (auditHadError || liveError) ? "error" : "complete";
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: summary, lastAuditLive: live, lastAuditError: liveError, lastAuditNewestModified: newestModified ?? f.lastAuditNewestModified, lastAuditRunId: runId, lastAuditAuditor: auditorLabel, lastAuditScope: scope } : f)),
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 200),
            busy: null,
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: terminalStage, stageDetail: undefined, errorMessage: liveError }
              : st.auditProgress,
          }));
        };

        const evidenceId = parseFolderId(folder.folderLink);
        const policyId = parseFolderId(folder.policyLink);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (!evidenceId && !policyId) {
          auditHadError = true;
          finish("No Drive folder linked. Add a Policy & Procedure and/or Actual Evidence folder link first.", false);
          return;
        }
        if (!token) {
          auditHadError = true;
          finish("Not connected to Google Drive. Connect your Google account in Settings, then run the audit again.", false);
          return;
        }

        const items = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === folder.subCriterionId);
        if (items.length === 0) {
          auditHadError = true;
          finish("No GD4 items map to this sub-criterion, so there is nothing to audit.", false);
          return;
        }

        // Auto-generate the checklist lines for any item that has none, so a
        // single "Run audit" covers generate → read → score without a separate
        // trip to the Sub-Criterion Checklist page. Generated lines are
        // confirmed straight in and stay fully editable there afterward.
        for (const item of items) {
          const existing = useChecklistModuleStore.getState().entries[item.id];
          if (!existing || existing.specific.length === 0) {
            try {
              await useChecklistModuleStore.getState().generateSpecific(item.id);
              useChecklistModuleStore.getState().confirmGenerated(item.id);
            } catch {
              // Generation failure (AI down, etc.) is non-fatal — the item
              // simply contributes no lines and is reported as such below.
            }
          }
        }

        const checklistEntries = useChecklistModuleStore.getState().entries;
        const lineOwners = new Map<string, string>(); // lineId -> itemId
        const lines: { id: string; text: string }[] = [];
        for (const item of items) {
          const entry = checklistEntries[item.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            lines.push({ id: line.id, text: line.text });
            lineOwners.set(line.id, item.id);
          }
        }
        if (lines.length === 0) {
          auditHadError = true;
          finish("Could not generate any checklist lines to audit against — check AI Settings, or add lines manually on the Sub-Criterion Checklist page.", false);
          return;
        }

        // Gather files from BOTH tab folders, tagging each with its bucket by
        // source folder. If only the evidence folder is linked (legacy / no
        // separate policy folder), fall back to the subfolder-name classifier
        // within it so the old single-folder convention still works.
        type TaggedFile = Awaited<ReturnType<typeof listFolderFilesRecursive>>[number] & { bucket: "policy" | "evidence" | "auto" };
        const taggedFiles: TaggedFile[] = [];
        const listErrors: string[] = [];
        // Setup warnings surfaced in the result summary (configuration problems
        // detected before the AI even runs, e.g. the same folder linked twice).
        const setupWarnings: string[] = [];
        const gather = async (fid: string | null, bucket: TaggedFile["bucket"], label: string) => {
          if (!fid) return;
          try {
            const fs = await listFolderFilesRecursive(fid, token);
            for (const f of fs) taggedFiles.push({ ...f, bucket });
          } catch (err) {
            listErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        // Strict two-folder model: the Policy tab and Evidence tab must point to
        // DIFFERENT folders. If the same folder is linked in both, reading it
        // twice would double the file count AND force the AI to grade the policy
        // document as if it were implementation evidence. So read it ONCE and
        // let the subfolder-name classifier decide policy-vs-evidence per file.
        const sameLink = !!policyId && !!evidenceId && policyId === evidenceId;
        if (sameLink) {
          await gather(evidenceId, "auto", "Folder");
          setupWarnings.push(
            "The Policy & Procedure tab and the Actual Evidence tab link the SAME Drive folder, so it was read once (not twice). For a proper audit, link two different folders — one of policies, one of actual records — or organise this folder into '1. Policy & Procedure' and '2. Actual Evidence' subfolders."
          );
        } else {
          await gather(policyId, "policy", "Policy & Procedure");
          await gather(evidenceId, "evidence", policyId ? "Actual Evidence" : "Evidence");
        }
        for (const f of taggedFiles) {
          if (f.modifiedTime && (!newestModified || f.modifiedTime > newestModified)) newestModified = f.modifiedTime;
        }
        // No separate policy folder → let the evidence folder's own subfolders
        // decide policy-vs-evidence (the previous behaviour). Same-link already
        // tagged "auto" above.
        if (!policyId && !sameLink) for (const f of taggedFiles) f.bucket = "auto";

        // Apply audit scope filter — must happen after bucket assignment so
        // the policy/evidence classification is already set on each file.
        if (scope !== "both") {
          const isPolicy = (f: TaggedFile) =>
            f.bucket === "policy" || (f.bucket === "auto" && classifyFileBucket(f.path) === "policy");
          const keep = scope === "policy" ? isPolicy : (f: TaggedFile) => !isPolicy(f);
          const removedCount = taggedFiles.filter((f) => !keep(f)).length;
          taggedFiles.splice(0, taggedFiles.length, ...taggedFiles.filter(keep));
          if (removedCount > 0)
            setupWarnings.push(`Scope "${scope === "policy" ? "Policy only" : "Evidence only"}" — ${removedCount} file${removedCount === 1 ? "" : "s"} from the other folder excluded from this run.`);
        }

        if (taggedFiles.length === 0) {
          auditHadError = true;
          if (listErrors.length) {
            finish(`Could not list the linked folder(s): ${listErrors.join("; ")}.`, false, listErrors.join("; "));
          } else {
            finish("The linked folder(s) contain no files. Add documents to the Drive folder and try again.", false, "Empty folder — no files found");
          }
          return;
        }

        // Resolve school-wide "Additional info" context: the bulk audit reads
        // it once and passes it in; a single Run audit reads it here (best
        // effort, text files only to control cost). undefined extraContext =
        // "read it yourself"; an explicit "" = "skip it".
        let resolvedContext = extraContext;
        if (resolvedContext === undefined) {
          const addId = parseFolderId(get().additionalInfo.link);
          if (addId) {
            try {
              resolvedContext = await readFolderPlainText(addId, token);
            } catch {
              resolvedContext = undefined;
            }
          }
        }

        const aiSettings = useAISettingsStore.getState();
        const schoolCtx = composeSchoolContext(get().schoolContext);
        const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: schoolCtx });
        const utilitySettings = effectiveSettings(aiSettings, { purpose: "utility", context: schoolCtx });
        const canDescribeImages = aiSettings.enabled && !!aiSettings.apiKey;
        // Each image costs one extra OpenAI vision call — capped separately
        // from the (unbounded) text-file count so a folder full of scanned
        // photos can't turn one "Run audit" click into dozens of API calls.
        const MAX_IMAGES = 10;
        let imagesDescribed = 0;
        // Tokens spent on the audit's helper AI calls (image descriptions and
        // document condensing) — folded into the audit's total so the log
        // reflects ALL AI used by this run, not just the verdict call.
        let auxUsage: AIUsage | undefined;

        const scanned: string[] = [];
        const skipped: string[] = []; // recognized type, but no text path for it (e.g. video)
        const failed: { path: string; reason: string }[] = []; // tried to read, threw
        // Each chunk keeps its heading (path + file type) so the AI knows a
        // photo from a policy PDF, and its body separately so a big folder can
        // be summarised rather than silently truncated.
        type Part = { heading: string; body: string; isPolicy: boolean; fileIndex: number };
        const parts: Part[] = [];
        let policyCount = 0;
        let evidenceCount = 0;
        const fileKind = (mime: string) =>
          mime === "application/pdf" ? "PDF"
            : mime.includes("wordprocessingml") ? "Word"
            : mime.includes("google-apps.document") ? "Google Doc"
            : mime.includes("google-apps.spreadsheet") ? "Google Sheet"
            : mime === XLSX_MIME ? "Excel"
            : mime === XLS_MIME ? "Excel"
            : mime === "text/csv" ? "CSV"
            : mime.includes("google-apps.presentation") ? "Google Slides"
            : mime.startsWith("image/") ? "image"
            : "text";
        // Evidence chunks are built here and used to:
        // 1. Prefix each document in the docText with a chunk ID so the AI can cite sources
        // 2. Map AI-cited chunk IDs back to file records after verdicts return
        const evidenceChunks: EvidenceChunk[] = [];
        let chunkCounter = 0;
        const inferEvidenceType = (kind: string, bucket: "policy" | "evidence", body: string): EvidenceChunk["evidenceType"] => {
          if (bucket === "policy") return "Policy/Procedure";
          const bodyLower = body.toLowerCase();
          if (kind === "Excel" || kind === "CSV" || kind === "Google Sheet") return "Implementation Record";
          const isOutcome = /outcome|result|trend|survey|feedback|kpi|dashboard|satisfaction/.test(bodyLower);
          const isReview = /review|minute|meeting|decision|improvement|action item|follow.up/.test(bodyLower);
          if (isOutcome) return "Outcome Data";
          if (isReview) return "Review Evidence";
          return "Other";
        };
        // Maximum chars per individual part/chunk. Files larger than this are
        // split into multiple parts (each with its own chunk ID) so no text is
        // lost. Kept well below BATCH_DOC_CAP so a single chunk never exceeds
        // one document window on its own.
        const MAX_PART_CHARS = 24_000;
        const pushPart = (path: string, body: string, bucket: TaggedFile["bucket"], kind: string, fileIndex: number) => {
          const isPolicy = bucket === "policy" || (bucket === "auto" && classifyFileBucket(path) === "policy");
          const resolvedBucket: "policy" | "evidence" = isPolicy ? "policy" : "evidence";
          // Split large files into sub-chunks so no text is ever summarised or dropped.
          const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
          for (let pi = 0; pi < totalParts; pi++) {
            const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
            const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
            const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
            const chunk: EvidenceChunk = {
              chunkId,
              filePath: path,
              fileName: path.split("/").pop() || path,
              bucket: resolvedBucket,
              fileKind: kind,
              text: chunkBody,
              charCount: chunkBody.length,
              evidenceType: inferEvidenceType(kind, resolvedBucket, chunkBody),
            };
            evidenceChunks.push(chunk);
            // Record chunk ID on file record so citations can be traced back
            const existing = fileRecords[fileIndex];
            fileRecords[fileIndex] = { ...existing, chunkIds: [...(existing.chunkIds || []), chunkId] };
            parts.push({ heading: `[CHUNK:${chunkId}] --- ${path}${partLabel} [${kind}] ---`, body: chunkBody, isPolicy, fileIndex });
          }
          if (isPolicy) policyCount++;
          else evidenceCount++;
        };
        const filesTotal = taggedFiles.length;
        // Per-file read timeouts: 30s for text/PDF/doc, 45s for images (includes AI call).
        const FILE_TEXT_TIMEOUT_MS = 30_000;
        const FILE_IMAGE_TIMEOUT_MS = 45_000;
        // Build initial file record list for the progress modal; status updated per-file during read.
        const fileRecords: AuditFileRecord[] = taggedFiles.map((file) => ({
          path: file.path,
          name: file.path.split("/").pop() || file.path,
          mimeType: file.mimeType,
          fileKind: fileKind(file.mimeType),
          bucket: file.bucket,
          readStatus: "found" as const,
          auditStatus: "pending" as const,
          driveFileId: file.id,
          driveModifiedTime: file.modifiedTime,
        }));
        const connectedFolderNames = [policyId ? "Policy & Procedure" : null, evidenceId ? "Actual Evidence" : null].filter(Boolean) as string[];
        setProgress("reading", {
          filesTotal,
          filesRead: 0,
          filesSkipped: 0,
          filesFound: [...fileRecords],
          connectInfo: { foldersLinked: connectedFolderNames.length, folderNames: connectedFolderNames },
          stageDetail: `Reading file 1 of ${filesTotal}…`,
          status: "running",
          canCancel: true,
          lastHeartbeatAt: Date.now(),
          scope,
        });
        for (let fi = 0; fi < taggedFiles.length; fi++) {
          const file = taggedFiles[fi];
          const fileActionHint =
            file.mimeType === "application/pdf" ? "Extracting PDF text" :
            file.mimeType.includes("wordprocessingml") ? "Extracting Word document" :
            file.mimeType.includes("google-apps.document") ? "Fetching Google Doc" :
            file.mimeType.includes("google-apps.spreadsheet") || file.mimeType === "text/csv" ? "Reading spreadsheet" :
            file.mimeType.includes("google-apps.presentation") ? "Reading presentation" :
            file.mimeType.startsWith("image/") ? "Describing image with AI" :
            "Reading document";
          const resolvedBucket: AuditProgressState["currentFileBucket"] =
            file.bucket === "policy" ? "policy" :
            file.bucket === "evidence" ? "evidence" :
            file.bucket === "auto" ? (classifyFileBucket(file.path) === "policy" ? "policy" : "evidence") :
            undefined;
          fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
          // Heartbeat: update per-file so the stuck-guard can detect hangs.
          const isImage = IMAGE_MIME_TYPES.has(file.mimeType);
          setProgress("reading", {
            filesTotal,
            filesRead: fi,
            filesSkipped: skipped.length,
            filesFound: [...fileRecords],
            currentFileName: file.path.split("/").pop() || file.path,
            currentFileBucket: resolvedBucket,
            currentFileAction: fileActionHint,
            stageDetail: `Reading file ${fi + 1} of ${filesTotal}: ${file.path.split("/").pop() || file.path}`,
            lastHeartbeatAt: Date.now(),
            canSkipCurrentFile: true,
          });

          // File caching: if we have previously extracted text for this exact
          // file+version, reuse it and skip the Drive download entirely.
          const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
          const cachedEntry = get().fileTextCache[cacheKey];
          if (cachedEntry) {
            fileRecords[fi] = {
              ...fileRecords[fi],
              readStatus: "read",
              charCount: cachedEntry.charCount,
              processingMode: "reused",
              ...(cachedEntry.pdfQuality ? {
                suspectedScannedPdf: cachedEntry.pdfQuality.suspectedScannedPdf,
                extractedTextQuality: cachedEntry.pdfQuality.extractedTextQuality,
              } : {}),
            };
            if (cachedEntry.text !== null) {
              pushPart(file.path, cachedEntry.text, file.bucket, cachedEntry.fileKind, fi);
              scanned.push(file.path);
            } else {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
            }
            setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
            continue;
          }

          // Per-file abort: allows skipCurrentFile() and cancelBusy() to break
          // out of the current Drive download or AI description call immediately.
          const fileAbort = new AbortController();
          const fileTimeoutMs = isImage ? FILE_IMAGE_TIMEOUT_MS : FILE_TEXT_TIMEOUT_MS;
          let fileTimeoutTimer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => {
            fileTimeoutTimer = setTimeout(() => {
              fileAbort.abort();
              reject(new Error("FILE_TIMEOUT"));
            }, fileTimeoutMs);
          });
          _currentFileAbort = () => { clearTimeout(fileTimeoutTimer); fileAbort.abort(); };

          type FileReadResult =
            | { kind: "text"; text: string; pdfQuality?: ReturnType<typeof classifyPdfTextQuality> }
            | { kind: "image"; description: string }
            | { kind: "skip" };

          const readPromise = (async (): Promise<FileReadResult> => {
            const text = await exportFileText(file, token, fileAbort.signal);
            if (text !== null) {
              let pdfQuality: ReturnType<typeof classifyPdfTextQuality> | undefined;
              if (file.mimeType === "application/pdf") pdfQuality = classifyPdfTextQuality(text);
              return { kind: "text", text, pdfQuality };
            }
            if (isImage && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, token, fileAbort.signal);
              const description = await describeImage(dataUrl, utilitySettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              return { kind: "image", description };
            }
            return { kind: "skip" };
          })();

          let fileResult: FileReadResult;
          try {
            fileResult = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
          } catch (err) {
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
            const wasAborted = fileAbort.signal.aborted;
            if (wasAborted || (err instanceof Error && err.message === "FILE_TIMEOUT")) {
              const skipReason = (err instanceof Error && err.message === "FILE_TIMEOUT")
                ? `Timed out after ${fileTimeoutMs / 1000}s`
                : "Skipped by user";
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason };
              continue;
            }
            // Genuine read error — mark failed but do not abort the whole audit.
            const failReason = err instanceof Error ? err.message : String(err);
            failed.push({ path: file.path, reason: failReason });
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "failed", failReason };
            continue;
          }

          // Apply the successful read result.
          switch (fileResult.kind) {
            case "text": {
              scanned.push(file.path);
              pushPart(file.path, fileResult.text, file.bucket, fileKind(file.mimeType), fi);
              fileRecords[fi] = {
                ...fileRecords[fi],
                readStatus: "read",
                charCount: fileResult.text.length,
                processingMode: "new",
                ...(fileResult.pdfQuality ? { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } : {}),
              };
              // Cache the extracted text so repeat audits can skip re-downloading unchanged files.
              set((st) => ({
                fileTextCache: {
                  ...st.fileTextCache,
                  [cacheKey]: {
                    text: fileResult.text,
                    charCount: fileResult.text.length,
                    fileKind: fileKind(file.mimeType),
                    fileName: file.path.split("/").pop() || file.path,
                    filePath: file.path,
                    cachedAt: Date.now(),
                    ...(fileResult.pdfQuality ? { pdfQuality: { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } } : {}),
                  },
                },
              }));
              break;
            }
            case "image":
              scanned.push(file.path);
              pushPart(file.path, fileResult.description, file.bucket, "image", fi);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: fileResult.description.length };
              break;
            case "skip":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
              break;
          }
        }
        // Reading stage complete: clear per-file controls.
        setProgress("reading", { canSkipCurrentFile: false, lastHeartbeatAt: Date.now() });

        // Pre-flight: if nothing was readable, tell the user clearly and skip the
        // AI call entirely — an empty prompt would waste tokens and return junk.
        if (scanned.length === 0) {
          auditHadError = true;
          const reason = failed.length
            ? `Could not read any files (${failed.length} file${failed.length === 1 ? "" : "s"} failed, e.g. ${failed[0].reason}). Check that the folder contains supported document types (PDF, Word, Google Docs).`
            : skipped.length
            ? `No readable document content found — ${skipped.length} file${skipped.length === 1 ? "" : "s"} are media or unsupported types. Add PDF, Word, or Google Docs files.`
            : "No readable files were found in the linked folder(s). Add documents and try again.";
          finish(reason, false, reason);
          return;
        }

        // School-wide context is background only — cap it so a large
        // Additional-info folder can't eat the whole audit budget (and push
        // the real evidence past the cap).
        const CONTEXT_CAP = 6000;
        if (resolvedContext && resolvedContext.length > CONTEXT_CAP) resolvedContext = resolvedContext.slice(0, CONTEXT_CAP);

        // Full-folder coverage: if the combined text would overflow the audit
        // cap, condense each document (utility model) instead of dropping
        // everything past the cap. The budget reserves room for each chunk's
        // heading, the section markers and the school-wide context so the
        // FINAL docText lands UNDER FOLDER_DOC_CAP — meaning the audit never has
        // to re-truncate, and no misleading "files may be missing" note fires
        // when in fact every document was read and condensed.
        // Audit journal: prior findings from this workspace, fed in so the AI
        // can spot cross-criterion recurring gaps (Review not documented in 1.1,
        // 2.1, 3.1 → systemic gap worth calling out). Capped so it doesn't eat
        // the document budget; excluded for this sub-criterion's own prior entry
        // (that's replaced at the end of this run anyway).
        const JOURNAL_AI_CAP = 2000;
        const priorJournal = get().auditJournal.trim();
        const journalBlock = priorJournal
          ? `=== PRIOR AUDIT FINDINGS (other sub-criteria already audited in this workspace — use for cross-criterion pattern awareness; judge THIS sub-criterion on its own evidence) ===\n${priorJournal.slice(-JOURNAL_AI_CAP)}`
          : "";

        // Build document windows instead of condensing. Each window contains
        // a subset of parts that fits within BATCH_DOC_CAP chars so no file
        // is ever summarised or dropped — the audit just runs more passes.
        // Parts are kept in order (policy first, evidence second) so each
        // window has the correct POLICY / ACTUAL EVIDENCE sections.
        const fixedPrefix = [
          journalBlock,
          resolvedContext ? `=== SCHOOL-WIDE CONTEXT (general supporting documents — background only, not primary evidence for this sub-criterion) ===\n${resolvedContext}` : "",
        ].filter(Boolean).join("\n\n");
        const fixedPrefixLen = fixedPrefix.length + (fixedPrefix ? 2 : 0);

        // Build windows: pack parts greedily by size so each window fits.
        const WINDOW_BODY_CAP = FOLDER_DOC_CAP - fixedPrefixLen - 200; // 200 ≈ section markers
        const docWindows: string[] = [];
        let winParts: typeof parts = [];
        let winSize = 0;
        const flushWindow = () => {
          if (winParts.length === 0) return;
          const winPolicyText = winParts.filter((p) => p.isPolicy).map((p) => `${p.heading}\n${p.body}`).join("\n\n");
          const winEvidText  = winParts.filter((p) => !p.isPolicy).map((p) => `${p.heading}\n${p.body}`).join("\n\n");
          const win = [
            fixedPrefix,
            winPolicyText ? `=== POLICY & PROCEDURE ===\n${winPolicyText}` : "",
            winEvidText   ? `=== ACTUAL EVIDENCE ===\n${winEvidText}`       : "",
          ].filter(Boolean).join("\n\n");
          docWindows.push(win);
          winParts = [];
          winSize = 0;
        };
        for (const p of parts) {
          const partSize = p.heading.length + p.body.length + 2;
          if (winParts.length > 0 && winSize + partSize > WINDOW_BODY_CAP) flushWindow();
          winParts.push(p);
          winSize += partSize;
        }
        flushWindow();
        // Fallback: if no parts at all, one empty window so the AI still runs
        // and returns "Not evident" for all lines (consistent with prior behaviour).
        if (docWindows.length === 0) docWindows.push(fixedPrefix || "");

        // The official GD4 standard for this sub-criterion, so the AI judges
        // each line against what is actually required, not just its wording.
        const standard = items
          .map((it) => `GD4 ${it.id} — ${it.requirement}\nIntent: ${it.intent}\nDescribe/Show:\n${it.describeShow.map((d) => `- ${d}`).join("\n")}${it.notes.length ? `\nNotes:\n${it.notes.map((n) => `- ${n}`).join("\n")}` : ""}\nExpected evidence: ${it.expectedEvidence.join("; ")}`)
          .join("\n\n");

        // The acting auditor's own strictness drives the audit; only when no
        // auditor exists do we fall back to the global AI strictness setting.
        const strictness = auditorStrictness || useScoringConfigStore.getState().aiStrictness;
        // Merges verdicts from multiple document windows per checklist line.
        // Takes the best APSR status across all windows (most favourable) and
        // unions sourceChunkIds + sources. Notes from different windows are
        // concatenated so the auditor sees analysis from every document pass.
        const mergeWindowVerdicts = (allWindows: ReturnType<typeof simulateFolderAudit>[]): ReturnType<typeof simulateFolderAudit> => {
          const byId = new Map<string, ReturnType<typeof simulateFolderAudit>[number]>();
          for (const window of allWindows) {
            for (const v of window) {
              const ex = byId.get(v.lineId);
              if (!ex) { byId.set(v.lineId, { ...v, apsr: v.apsr ? { ...v.apsr, approach: { ...v.apsr.approach }, processes: { ...v.apsr.processes }, systemsOutcomes: { ...v.apsr.systemsOutcomes }, review: { ...v.apsr.review } } : undefined }); continue; }
              if (!v.apsr || !ex.apsr) { byId.set(v.lineId, ex); continue; }
              const bestLeg = <T extends string>(a: { status: T; note: string; sourceChunkIds?: string[] }, b: { status: T; note: string; sourceChunkIds?: string[] }, order: T[]) => {
                const ai = order.indexOf(a.status), bi = order.indexOf(b.status);
                const winner = ai <= bi ? a : b, loser = ai <= bi ? b : a;
                const note = winner.note && loser.note && winner.note !== loser.note ? `${winner.note} | ${loser.note}` : winner.note || loser.note;
                return { status: winner.status, note, sourceChunkIds: [...new Set([...(a.sourceChunkIds ?? []), ...(b.sourceChunkIds ?? [])])] };
              };
              const merged = {
                ...ex,
                apsr: {
                  approach:       bestLeg(ex.apsr.approach,       v.apsr.approach,       ["Meeting", "Beginning", "Not evident"] as const),
                  processes:      bestLeg(ex.apsr.processes,      v.apsr.processes,      ["Deployed", "Weak", "Not evident"] as const),
                  systemsOutcomes:bestLeg(ex.apsr.systemsOutcomes,v.apsr.systemsOutcomes,["Evident", "Limited", "Not evident"] as const),
                  review:         bestLeg(ex.apsr.review,         v.apsr.review,         ["Evident", "Not evident"] as const),
                },
                sources: [...new Set([...(ex.sources ?? []), ...(v.sources ?? [])])],
              };
              merged.status = deriveApsrStatus(merged.apsr);
              merged.reason = apsrReason(merged.apsr);
              byId.set(v.lineId, merged);
            }
          }
          return Array.from(byId.values());
        };

        let verdicts: ReturnType<typeof simulateFolderAudit>;
        let live = false;
        let liveError: string | undefined;
        let challenged = false;
        let truncationNote: string | undefined;
        let parseWarnings: string[] = [];
        let folderWarnings: string[] = [];
        let auditUsage: AIUsage | undefined;
        let verdictLines: AuditAISummaryLine[] = [];
        let timedOutCount = 0;
        const windowCount = docWindows.length;
        const batchTotal = Math.ceil(lines.length / 4) * windowCount; // AUDIT_BATCH_SIZE = 4
        if (aiSettings.enabled && aiSettings.apiKey) {
          setProgress("auditing", { batchCurrent: 0, batchTotal, auditLive: true, filesFound: [...fileRecords], stageDetail: windowCount > 1 ? `Starting AI audit (${windowCount} document windows)…` : "Starting AI audit…" });
          try {
            // Run one full audit per document window, then merge best-of across windows.
            let globalBatchDone = 0;
            const auditCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "Line Status").slice(0, 3);
            const auditMemories = get().calibrationMemories.filter((m) => m.status === "active" && m.module === "Line Status").sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0)).slice(0, 5);
            const windowResults = await Promise.all(
              docWindows.map((docWindow, wi) =>
                runLiveFolderAudit(lines, docWindow, analysisSettings, {
                  strictness,
                  standard,
                  criterionId: folder.subCriterionId,
                  calibration: auditCalibration,
                  memories: auditMemories,
                  onBatchProgress: (current, total) => {
                    globalBatchDone++;
                    setProgress("auditing", {
                      batchCurrent: globalBatchDone,
                      batchTotal,
                      stageDetail: windowCount > 1
                        ? `AI audit window ${wi + 1}/${windowCount}, batch ${current}/${total}…`
                        : total > 1 ? `AI audit batch ${current} of ${total}…` : "Running AI audit…",
                    });
                  },
                })
              )
            );
            verdicts = mergeWindowVerdicts(windowResults.map((r) => r.verdicts));
            truncationNote = windowResults.find((r) => r.truncationNote)?.truncationNote;
            parseWarnings = windowResults.flatMap((r) => r.parseWarnings);
            folderWarnings = [...new Set(windowResults.flatMap((r) => r.folderWarnings))];
            auditUsage = windowResults.reduce<AIUsage | undefined>((acc, r) => addUsage(acc, r.usage), undefined);
            const timedOutIds = [...new Set(windowResults.flatMap((r) => r.timedOutLineIds ?? []))];
            timedOutCount = timedOutIds.length;
            if (timedOutCount > 0) {
              folderWarnings = [
                ...folderWarnings,
                `${timedOutCount} checklist line${timedOutCount === 1 ? "" : "s"} could not be audited — the AI call timed out after retrying. Those lines show "Not met" as a placeholder. Re-run the audit to try them again.`,
              ];
            }
            // Strict mode: challenge pass runs against the first (largest) window.
            if (strictness === "Strict") {
              const toChallenge = verdicts.filter((v) => v.status !== "Not met").map((v) => ({ lineId: v.lineId, status: v.status }));
              if (toChallenge.length) {
                setProgress("auditing", { stageDetail: "Running strict challenge pass…" });
                try {
                  const r2 = await runLiveFolderAudit(lines, docWindows[0], analysisSettings, { strictness, standard, criterionId: folder.subCriterionId, challenge: toChallenge, calibration: auditCalibration, memories: auditMemories });
                  verdicts = r2.verdicts;
                  parseWarnings = [...parseWarnings, ...r2.parseWarnings];
                  folderWarnings = [...new Set([...folderWarnings, ...r2.folderWarnings])];
                  auditUsage = addUsage(auditUsage, r2.usage);
                  if (r2.timedOutLineIds?.length) {
                    folderWarnings = [...new Set([...folderWarnings, `${r2.timedOutLineIds.length} line(s) timed out in the strict challenge pass — first-pass verdicts kept for those lines.`])];
                  }
                  challenged = true;
                } catch {
                  // keep multi-window merged verdicts if challenge call fails
                }
              }
            }
            live = true;
          } catch (err) {
            auditHadError = true;
            liveError = err instanceof Error ? err.message : String(err);
            // When a live AI call was attempted but failed, do NOT write
            // offline keyword-estimate verdicts to the checklist — they look
            // indistinguishable from real AI results and mislead the auditor.
            // Surface the error so the user can fix it and re-run.
            finish(
              `Live call failed: ${liveError}\n\nNo checklist entries were updated. Fix the issue above (e.g. check your API key, reduce the folder size) and run the audit again.`,
              false,
              liveError,
              auditUsage,
              auxUsage,
            );
            return;
          }
        } else {
          verdicts = simulateFolderAudit(lines, docWindows[0] ?? "");
        }

        // Cancel guard: if the user clicked "Cancel" while the AI call was in
        // flight, the token won't match — discard results without writing.
        if (get().auditRunToken !== capturedToken) {
          set((st) => ({
            busy: null,
            folders: st.folders.map((f) =>
              f.id === id
                ? { ...f, lastAuditSummary: "Audit was cancelled — no results were saved.", lastAuditAt: new Date().toISOString(), lastAuditLive: false }
                : f
            ),
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: "complete" as const, stageDetail: "Audit cancelled." }
              : st.auditProgress,
          }));
          return;
        }

        // Guarded so an unexpected throw while writing verdicts can't strand
        // `busy` (which would leave this row's button stuck on "Auditing…"
        // forever) — finish() below always runs and clears it.

        // Citation-gap downgrade: for each positive dimension that has no
        // sourceChunkIds, downgrade to "Not evident" and record a warning.
        // Only fires when live AI is used (offline fallback never returns chunk IDs).
        if (live) {
          const CITATION_DOWNGRADE_NOTE = "Downgraded: no source chunks cited to support this claim.";
          for (const v of verdicts) {
            if (!v.apsr) continue;
            const apsr = v.apsr;
            // Approach
            if ((apsr.approach.status === "Meeting" || apsr.approach.status === "Beginning") &&
                (!apsr.approach.sourceChunkIds || apsr.approach.sourceChunkIds.length === 0)) {
              apsr.approach = { ...apsr.approach, status: "Not evident", note: (apsr.approach.note ? apsr.approach.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — approach downgraded (no source chunks cited)`);
            }
            // Processes
            if ((apsr.processes.status === "Deployed" || apsr.processes.status === "Weak") &&
                (!apsr.processes.sourceChunkIds || apsr.processes.sourceChunkIds.length === 0)) {
              apsr.processes = { ...apsr.processes, status: "Not evident", note: (apsr.processes.note ? apsr.processes.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — processes downgraded (no source chunks cited)`);
            }
            // Systems & Outcomes
            if ((apsr.systemsOutcomes.status === "Evident" || apsr.systemsOutcomes.status === "Limited") &&
                (!apsr.systemsOutcomes.sourceChunkIds || apsr.systemsOutcomes.sourceChunkIds.length === 0)) {
              apsr.systemsOutcomes = { ...apsr.systemsOutcomes, status: "Not evident", note: (apsr.systemsOutcomes.note ? apsr.systemsOutcomes.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — systemsOutcomes downgraded (no source chunks cited)`);
            }
            // Review
            if (apsr.review.status === "Evident" &&
                (!apsr.review.sourceChunkIds || apsr.review.sourceChunkIds.length === 0)) {
              apsr.review = { ...apsr.review, status: "Not evident", note: (apsr.review.note ? apsr.review.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — review downgraded (no source chunks cited)`);
            }
          }
        }

        // Build a map from chunkId to file index for citation tracking
        const chunkToFileIndex = new Map<string, number>();
        for (const chunk of evidenceChunks) {
          const fileIdx = fileRecords.findIndex((r) => r.path === chunk.filePath);
          if (fileIdx >= 0) chunkToFileIndex.set(chunk.chunkId, fileIdx);
        }

        const notMetCount = verdicts.filter((v) => v.status === "Not met").length;

        // Map AI citations back to file records:
        // - Files cited by at least one verdict dimension → "cited"
        // - Files that were read but not cited → "not_used"
        for (const rec of fileRecords) {
          if (rec.readStatus === "read" || rec.readStatus === "condensed") {
            rec.auditStatus = "not_used"; // default; overridden below if cited
          }
        }

        // Process each verdict to map sourceChunkIds → file records
        for (const v of verdicts) {
          if (!v.apsr) continue;
          const dimMap: Array<[keyof typeof v.apsr, "approach" | "processes" | "systemsOutcomes" | "review"]> = [
            ["approach", "approach"],
            ["processes", "processes"],
            ["systemsOutcomes", "systemsOutcomes"],
            ["review", "review"],
          ];
          for (const [dimKey] of dimMap) {
            const dim = v.apsr[dimKey];
            if (!dim.sourceChunkIds) continue;
            for (const chunkId of dim.sourceChunkIds) {
              const fileIdx = chunkToFileIndex.get(chunkId);
              if (fileIdx === undefined) continue;
              const rec = fileRecords[fileIdx];
              fileRecords[fileIdx] = {
                ...rec,
                auditStatus: "cited",
                citedByLineIds: [...new Set([...(rec.citedByLineIds || []), v.lineId])],
                usedForDimensions: {
                  approach: (rec.usedForDimensions?.approach ?? false) || dimKey === "approach",
                  processes: (rec.usedForDimensions?.processes ?? false) || dimKey === "processes",
                  systemsOutcomes: (rec.usedForDimensions?.systemsOutcomes ?? false) || dimKey === "systemsOutcomes",
                  review: (rec.usedForDimensions?.review ?? false) || dimKey === "review",
                },
              };
            }
          }
        }
        const lineTextById = new Map(lines.map((l) => [l.id, l.text]));

        // Build per-line AI verdict summary for CSV export and the "Ask AI" step detail.
        verdictLines = verdicts.map((v) => {
          const allChunkIds: string[] = v.apsr ? [
            ...(v.apsr.approach.sourceChunkIds ?? []),
            ...(v.apsr.processes.sourceChunkIds ?? []),
            ...(v.apsr.systemsOutcomes.sourceChunkIds ?? []),
            ...(v.apsr.review.sourceChunkIds ?? []),
          ] : [];
          const uniqueChunkIds = [...new Set(allChunkIds)];
          const citedFileNames = uniqueChunkIds.map((cid) => {
            const chunk = evidenceChunks.find((c) => c.chunkId === cid);
            return chunk?.fileName ?? cid;
          });
          return {
            lineId: v.lineId,
            lineText: lineTextById.get(v.lineId) ?? v.lineId,
            result: v.status as "Met" | "Partial" | "Not met",
            approachStatus: v.apsr?.approach.status ?? "Not evident",
            processesStatus: v.apsr?.processes.status ?? "Not evident",
            systemsOutcomesStatus: v.apsr?.systemsOutcomes.status ?? "Not evident",
            reviewStatus: v.apsr?.review.status ?? "Not evident",
            citedChunkIds: uniqueChunkIds,
            citedFileNames,
            overallReason: v.reason ?? undefined,
            warning: undefined,
          } satisfies AuditAISummaryLine;
        });

        setProgress("saving", {
          filesFound: [...fileRecords],
          stageDetail: `Saving ${verdicts.length} verdict${verdicts.length === 1 ? "" : "s"}…`,
          linesAssessed: verdicts.length,
          findingsDetected: notMetCount,
          verdictLines,
          chunksCount: evidenceChunks.length,
          aiModel: auditUsage?.model,
          scope,
          folderWarnings: folderWarnings.length > 0 ? folderWarnings : undefined,
        });
        try {
          const checklist = useChecklistModuleStore.getState();
          for (const v of verdicts) {
            const itemId = lineOwners.get(v.lineId);
            if (!itemId) continue;
            checklist.setSpecificStatus(itemId, v.lineId, v.status);
            // Finding-style note (POLICY / EVIDENCE / OUTCOMES / REVIEW) instead
            // of a raw rubric dump, plus the cited source files and a "who/which
            // run produced this" trailer so the row is traceable and honest
            // about whether real evidence was actually submitted.
            const baseNote = v.apsr ? apsrAuditNote(v.apsr) : v.reason;
            const sourceLines = [
              `SOURCE TRACE`,
              v.sources && v.sources.length ? `File(s): ${v.sources.join("; ")}` : "File(s): not cited by model",
              `Run: ${runId} (${live ? "live AI" : "offline estimate"})`,
              `Auditor: ${auditorName}`,
              auditorName === "Unassigned (no auditor set up)" ? "Set up an auditor and review before relying on this verdict." : "Review before relying on this verdict.",
            ];
            // replaceAuditEvidence removes prior auto-audit evidence (identified
            // by having a runId) before adding the new one, so a re-audit never
            // accumulates stale "Not met" rows alongside the new verdicts.
            checklist.replaceAuditEvidence(itemId, v.lineId, {
              title: `Drive audit ${runId} — ${folder.folderName}`,
              type: evidenceTypeFromApsr(v.apsr, lineTextById.get(v.lineId) || ""),
              drive: folder.folderLink || folder.policyLink,
              owner: folder.owner,
              date: new Date().toISOString().slice(0, 10),
              approved: false,
              reviewed: false,
              sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
              auditorNote: `${baseNote}\n\n${sourceLines.join("\n")}`,
              // Persist the structured APSR so a finding raised from this line
              // can explain which rubric dimension (Approach/Processes/Systems &
              // Outcomes/Review) fell short.
              apsr: v.apsr,
              runId,
            });
          }
        } catch (err) {
          finish(`Audit read the folder but failed while writing checklist verdicts: ${err instanceof Error ? err.message : String(err)}`, live, liveError);
          return;
        }

        // Snapshot finding IDs before auto-raise so the post-audit pipeline
        // can identify exactly which findings are new (= need AI enrichment).
        const preRaiseFindingIds = new Set(get().customFindings.map((f) => f.id));

        // Auto-raise findings from the gaps this audit just set, so the
        // Findings register fills itself the moment an audit runs (instead of
        // staying empty until the user remembers to click "Raise findings").
        // Deduped, so re-auditing never double-raises; each carries its APSR
        // dimension (procedure vs evidence) and the detailed root-cause report.
        let autoRaised = 0;
        try {
          autoRaised = useChecklistModuleStore.getState().raiseAllUnmetFindings(runId);
        } catch {
          // Non-fatal: a finding-raise failure must not strand the audit.
        }

        const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
        for (const v of verdicts) counts[v.status]++;
        // Cap the file lists so a folder of dozens of files can't produce a
        // multi-thousand-character summary that floods the row and the AI log.
        const NAME_CAP = 8;
        const briefList = (names: string[]) => {
          const shown = names.slice(0, NAME_CAP).join(", ");
          return names.length > NAME_CAP ? `${shown}, +${names.length - NAME_CAP} more` : shown;
        };

        // Resulting band per item — same band computeChecklistOverrides feeds
        // into the overall score, shown here so it's visible at the point of audit.
        const freshEntries = useChecklistModuleStore.getState().entries;
        const bandParts = items
          .map((item) => {
            const e = freshEntries[item.id];
            if (!e || e.specific.length === 0) return null;
            return `${item.id} → Band ${computeBand(e.generic, e.specific, item.gateSensitive).finalBand}`;
          })
          .filter(Boolean);

        // Update the running audit journal with a compact entry for this
        // sub-criterion (bands + key gaps + APSR dimension labels). The updated
        // journal is then fed into the NEXT folder audit call so the AI can flag
        // recurring cross-criterion gaps — it won't help this call (already done)
        // but it improves every subsequent one in the same "Audit all" run.
        try {
          const entry = buildJournalEntry(folder.subCriterionId, folder.folderName, bandParts as string[], verdicts, lineTextById, runId);
          // updateJournal strips any old "⚠ Recurring patterns" lines, so we
          // re-append exactly one fresh one — it can never accumulate now.
          const updated = updateJournal(get().auditJournal, folder.subCriterionId, entry);
          set({ auditJournal: updated + patternNote(updated) });
        } catch {
          // Non-fatal — journal update failure must not affect the audit result.
        }

        // The summary is a structured, multi-line report (rendered with
        // white-space: pre-wrap) so a busy run reads as labelled sections
        // instead of one long run-on sentence.
        const lineParts: string[] = [];
        // 1. Headline — the verdict, first. Run id leads so it can be matched to
        // the AI Review Log, the checklist evidence, and the journal entry.
        lineParts.push(`Run ${runId} · Auditor: ${auditorLabel}.`);
        lineParts.push(`✓ ${counts.Met} Met · ◐ ${counts.Partial} Partial · ✗ ${counts["Not met"]} Not met (of ${verdicts.length} checklist line${verdicts.length === 1 ? "" : "s"}).`);
        if (bandParts.length) lineParts.push(`Band: ${bandParts.join(", ")}.`);
        if (autoRaised > 0) lineParts.push(`Raised ${autoRaised} new finding${autoRaised === 1 ? "" : "s"} from the gaps — see the Findings register.${live ? " AI agents are drafting finding bodies and closure actions in the background." : ""}`);
        // 2. Files read.
        lineParts.push(
          scanned.length
            ? `Files read: ${scanned.length} (${policyCount} policy · ${evidenceCount} evidence) — ${briefList(scanned)}.`
            : "Files read: none — no readable files were found in this folder."
        );
        if (skipped.length) lineParts.push(`Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"}: ${briefList(skipped)}.`);
        if (failed.length) {
          const reasons = [...new Set(failed.map((f) => f.reason))];
          const reasonText = reasons.length === 1 ? reasons[0] : `${reasons.length} distinct errors, e.g. ${reasons[0]}`;
          lineParts.push(`Could not read ${failed.length} file${failed.length === 1 ? "" : "s"} (${reasonText}): ${briefList(failed.map((f) => f.path))}.`);
        }
        // 3. Method.
        lineParts.push(
          live
            ? `Method: EduTrust APSR rubric vs the GD4 standard — Approach (documented policy) gates the result, then Processes (implementation), Systems & Outcomes, Review.${windowCount > 1 ? ` ${windowCount} document windows used — all files read in full with no condensing.` : ""}${challenged ? " A strict second-pass challenge was applied." : ""}`
            : "Method: offline keyword estimate — AI was not used (check AI Settings)."
        );
        // 4. Warnings, each on its own line so they stand out.
        if (truncationNote) lineParts.push(`⚠ ${truncationNote}`);
        if (parseWarnings.length) lineParts.push(`⚠ ${parseWarnings.length} APSR dimension(s) defaulted to "Not evident" due to unexpected model output — those verdicts may be overly harsh; spot-check them.`);
        if (folderWarnings.length > 0) lineParts.push(`⚠ Possible mis-filed documents (${folderWarnings.length}): ${folderWarnings.join(" | ")}`);
        for (const w of setupWarnings) lineParts.push(`⚠ ${w}`);
        const summary = lineParts.join("\n");
        // Pass analysis and utility usage separately so the log can price each
        // model at its own rate rather than applying the analysis rate to all.
        finish(summary, live, liveError, auditUsage, auxUsage);

        // Persist completed/failed run record so the user can reopen it and export CSVs.
        const runRecord: AuditRunRecord = {
          runId,
          folderId: id,
          subCriterionId: folder.subCriterionId,
          subCriterionTitle: folder.folderName,
          scope,
          status: auditHadError ? "failed" : "completed",
          startedAt: new Date(auditStartedAt).toISOString(),
          endedAt: new Date().toISOString(),
          auditorName,
          auditLive: live,
          aiModel: auditUsage?.model,
          fileLedger: [...fileRecords],
          aiSummary: verdictLines,
          linesAssessed: verdicts.length,
          findingsDetected: notMetCount,
          batchCount: batchTotal,
          chunkCount: evidenceChunks.length,
          errorMessage: liveError,
          folderWarnings: folderWarnings.length > 0 ? folderWarnings : undefined,
        };
        set((st) => {
          const prev = st.auditRunHistory[id] ?? [];
          return {
            auditRunHistory: { ...st.auditRunHistory, [id]: [runRecord, ...prev].slice(0, 5) },
            lastAuditRuns: { ...st.lastAuditRuns, [id]: runRecord },
          };
        });

        // Post-audit multi-agent pipeline — fires asynchronously so the audit
        // result appears immediately and the finding enrichment arrives seconds
        // later. Only runs when AI is live (no point enriching offline drafts).
        if (live && autoRaised > 0) {
          const currentSubCriterionId = folder.subCriterionId;
          const newFindings = get().customFindings.filter(
            (f) => !preRaiseFindingIds.has(f.id) && f.source === "Checklist" &&
              GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionId
          );
          if (newFindings.length > 0) {
            (async () => {
              const entries = useChecklistModuleStore.getState().entries;

              // Pass 1 — Finding Writer: parallel AI observation/criteria/effect
              // for every new finding. Each call gets the real APSR context that
              // the folder audit just produced, so the body is specific, not generic.
              const pass1 = newFindings.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  if (!req) return;
                  const entry = entries[finding.gd4ItemId];
                  // Match line by clause first, then by issue-text prefix.
                  const line = entry?.specific.find(
                    (l) => l.clause === finding.clause || finding.issue.startsWith(l.text.slice(0, 50))
                  );
                  if (!line) return;
                  const dim = findingDimension(line);
                  const apsr = lineApsr(line);
                  const result = await runLiveFindingObservation(
                    { id: req.id, requirement: req.requirement, describeShow: req.describeShow, expectedEvidence: req.expectedEvidence },
                    { text: line.text, status: line.status },
                    dim,
                    apsr,
                    analysisSettings
                  );
                  get().updateCustomFinding(finding.id, {
                    observation: result.observation,
                    criteria: result.criteria,
                    effect: result.effect,
                  });
                  get().pushAIReviewLog({
                    agent: "Finding Writer",
                    reviewType: "Finding",
                    subjectId: finding.gd4ItemId,
                    verdict: "Drafted",
                    confidence: "Medium",
                    keyConcerns: [dim],
                    recommendedAction: "Review and edit the drafted finding body before closing.",
                    live: true,
                    generatedContent: `OBSERVATION:\n${result.observation}\n\nCRITERIA:\n${result.criteria}\n\nEFFECT:\n${result.effect}`,
                    promptSent: result.promptSent,
                    runId,
                    usage: result.usage,
                  });
                } catch {
                  // Non-fatal — a failed finding draft never affects the audit result.
                }
              });
              await Promise.all(pass1);

              // Pass 2 — Closure Drafter: only for Cat A + B findings (the ones
              // that carry the highest regulatory / Star-disqualifying risk). Uses
              // the AI-enriched finding body from Pass 1 as input so the root cause
              // is specific to what the Folder Audit and Finding Writer actually found.
              const highPriority = get().customFindings.filter(
                (f) => preRaiseFindingIds.has(f.id) === false && (f.riskCategory === "A" || f.riskCategory === "B") &&
                  GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionId
              );
              const pass2 = highPriority.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  const enriched = get().customFindings.find((f) => f.id === finding.id);
                  const standard = req ? `${req.requirement}\n${req.describeShow.map((d) => `- ${d}`).join("\n")}` : "";
                  const apsr = enriched?.apsr ? apsrReason(enriched.apsr) : undefined;
                  const draft = await runLiveClosureDraft(
                    { issue: finding.issue, gd4ItemId: finding.gd4ItemId },
                    analysisSettings,
                    { standard, apsr }
                  );
                  // seedClosure only fills blanks — never overwrites user text.
                  get().seedClosure(finding.id, {
                    root: formatDraftedClosureText(draft.root),
                    corr: formatDraftedClosureText(draft.corr),
                    prev: formatDraftedClosureText(draft.prev),
                  });
                  get().pushAIReviewLog({
                    agent: "Closure Drafter",
                    reviewType: "Closure",
                    subjectId: finding.gd4ItemId,
                    verdict: "Drafted",
                    confidence: "Medium",
                    keyConcerns: [`Cat ${finding.riskCategory} finding — root cause, corrective and preventive actions drafted`],
                    recommendedAction: "Review the drafted actions in Quality Action / AFI, then link closure evidence.",
                    live: true,
                    generatedContent: `ROOT CAUSE:\n${draft.root}\n\nCORRECTIVE:\n${draft.corr}\n\nPREVENTIVE:\n${draft.prev}`,
                    promptSent: draft.promptSent,
                    runId,
                    usage: draft.usage,
                  });
                } catch {
                  // Non-fatal.
                }
              });
              await Promise.all(pass2);
            })();
          }
        }
        } catch (outerErr) {
          // Safety net: surface any unexpected exception that escaped all inner
          // try/catches so the button never gets stuck on "Auditing…" with no
          // visible error. Finish() clears busy and writes the error as the
          // audit summary so the auditor can see what went wrong.
          const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `Audit failed unexpectedly — ${msg}`, lastAuditLive: false, lastAuditError: msg } : f)),
            busy: null,
          }));
        }
      },

      auditFolderStaged: async (id, mode, extraContext, overallProgress) => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        // Defensive: a stale true left over from a previous run (e.g. the user
        // clicked "Skip pass" right as that run ended, or a bulk "Audit All"
        // sequence moved to the next folder before the reset fired) must never
        // leak into a fresh run and silently cut its first stage short.
        set({ busy: "folderaudit" + id, auditSkipStageFlag: false });
        const capturedToken = get().auditRunToken;
        // Run-level abort: cancelBusy() aborts this controller, which kills
        // the in-flight AI call inside whichever stage is running.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;
        const scope: AuditScope = mode === "policy" ? "policy" : mode === "evidence" ? "evidence" : "both";

        const setProgress = (stage: AuditProgressState["stage"], extra?: Partial<AuditProgressState>) => {
          set((st) => {
            const prev = st.auditProgress?.folderId === id ? st.auditProgress : {};
            return {
              auditProgress: {
                ...prev,
                folderId: id,
                folderName: folder.folderName,
                subCriterionId: folder.subCriterionId,
                overallCurrent: overallProgress?.current,
                overallTotal: overallProgress?.total,
                stage,
                currentFileName: undefined,
                currentFileBucket: undefined,
                currentFileAction: undefined,
                stageDetail: undefined,
                errorMessage: undefined,
                ...extra,
              } as AuditProgressState,
            };
          });
        };

        let auditHadError = false;
        const auditStartedAt = Date.now();
        setProgress("listing", { stageDetail: "Loading GD4 audit points…", status: "running", canCancel: true, startedAt: auditStartedAt, lastHeartbeatAt: auditStartedAt });

        try {
        const runId = makeRunId(folder.subCriterionId);
        let newestModified: string | undefined;

        const actingAuditor = s.auditors.find((a) => a.id === get().activeAuditorId) || s.auditors.find((a) => a.role === "Audit Lead") || s.auditors[0];
        const auditorName = actingAuditor?.name || "Unassigned";
        const auditorStrictness = actingAuditor ? strictnessFromScore(actingAuditor.strictness) : undefined;
        const auditorLabel = actingAuditor ? `${auditorName} (strictness: ${auditorStrictness})` : auditorName;

        const finish = (summary: string, live: boolean, liveError?: string, usage?: AIUsage, auxUsage?: AIUsage, promptSent?: string) => {
          // The run is over — release the run-level abort controller (only if
          // it is still ours; a cancel may already have replaced it).
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Staged Audit Assistant",
            reviewType: "Evidence",
            subjectId: folder.subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Spot-check the auto-set checklist lines against the source documents.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: (usage?.totalTokens || 0) + (auxUsage?.totalTokens || 0) || undefined,
          };
          const terminalStage = (auditHadError || liveError) ? "error" : "complete";
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `[Staged] ${summary}`, lastAuditLive: live, lastAuditError: liveError, lastAuditNewestModified: newestModified ?? f.lastAuditNewestModified, lastAuditRunId: runId, lastAuditAuditor: auditorLabel, lastAuditScope: scope } : f)),
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 200),
            busy: null,
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: terminalStage, stageDetail: undefined, errorMessage: liveError }
              : st.auditProgress,
          }));
        };

        const evidenceId = parseFolderId(folder.folderLink);
        const policyId = parseFolderId(folder.policyLink);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (!evidenceId && !policyId) { auditHadError = true; finish("No Drive folder linked.", false); return; }
        if (!token) { auditHadError = true; finish("Not connected to Google Drive.", false); return; }

        const items = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === folder.subCriterionId);
        if (items.length === 0) { auditHadError = true; finish("No GD4 items map to this sub-criterion.", false); return; }

        // Stage 1: Load FlatAuditPoints
        const allAuditPoints: FlatAuditPoint[] = items.flatMap((item) => item.flatAuditPoints ?? []);
        if (allAuditPoints.length === 0) {
          auditHadError = true;
          finish("No flat audit points found for this sub-criterion. Run validate:gd4 to check data integrity.", false);
          return;
        }

        // Auto-generate checklist lines if missing
        for (const item of items) {
          const existing = useChecklistModuleStore.getState().entries[item.id];
          if (!existing || existing.specific.length === 0) {
            try { await useChecklistModuleStore.getState().generateSpecific(item.id); useChecklistModuleStore.getState().confirmGenerated(item.id); } catch { /* non-fatal */ }
          }
        }
        const checklistEntries = useChecklistModuleStore.getState().entries;
        const lineOwners = new Map<string, string>();
        const lines: { id: string; text: string; sourceRef?: string }[] = [];
        for (const item of items) {
          const entry = checklistEntries[item.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            lines.push({ id: line.id, text: line.text, sourceRef: line.sourceRef });
            lineOwners.set(line.id, item.id);
          }
        }
        if (lines.length === 0) { auditHadError = true; finish("No checklist lines found.", false); return; }

        // Gather and read files (same file reading code as auditFolderContents)
        type TaggedFile = Awaited<ReturnType<typeof listFolderFilesRecursive>>[number] & { bucket: "policy" | "evidence" | "auto" };
        const taggedFiles: TaggedFile[] = [];
        const listErrors: string[] = [];
        const gather = async (fid: string | null, bucket: TaggedFile["bucket"], label: string) => {
          if (!fid) return;
          try { const fs = await listFolderFilesRecursive(fid, token); for (const f of fs) taggedFiles.push({ ...f, bucket }); }
          catch (err) { listErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }
        };
        const sameLink = !!policyId && !!evidenceId && policyId === evidenceId;
        if (sameLink) { await gather(evidenceId, "auto", "Folder"); }
        else {
          if (scope !== "evidence") await gather(policyId, "policy", "Policy & Procedure");
          if (scope !== "policy") await gather(evidenceId, "evidence", policyId ? "Actual Evidence" : "Evidence");
        }
        for (const f of taggedFiles) { if (f.modifiedTime && (!newestModified || f.modifiedTime > newestModified)) newestModified = f.modifiedTime; }
        if (!policyId && !sameLink) for (const f of taggedFiles) f.bucket = "auto";

        if (taggedFiles.length === 0) {
          auditHadError = true;
          finish(listErrors.length ? `Could not list folder(s): ${listErrors.join("; ")}.` : "No files found in the linked folder(s).", false);
          return;
        }

        let resolvedContext = extraContext;
        if (resolvedContext === undefined) {
          const addId = parseFolderId(get().additionalInfo.link);
          if (addId) { try { resolvedContext = await readFolderPlainText(addId, token); } catch { resolvedContext = undefined; } }
        }

        const aiSettings = useAISettingsStore.getState();
        const schoolCtx = composeSchoolContext(get().schoolContext);
        const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: schoolCtx });
        const utilitySettings = effectiveSettings(aiSettings, { purpose: "utility", context: schoolCtx });
        const canDescribeImages = aiSettings.enabled && !!aiSettings.apiKey;
        const MAX_IMAGES = 10;
        let imagesDescribed = 0;
        let auxUsage: AIUsage | undefined;
        const scanned: string[] = [];
        const skipped: string[] = [];
        const failed: { path: string; reason: string }[] = [];

        const fileKind = (mime: string) =>
          mime === "application/pdf" ? "PDF" : mime.includes("wordprocessingml") ? "Word" : mime.includes("google-apps.document") ? "Google Doc"
          : mime.includes("google-apps.spreadsheet") ? "Google Sheet" : mime === XLSX_MIME ? "Excel" : mime === XLS_MIME ? "Excel"
          : mime === "text/csv" ? "CSV" : mime.includes("google-apps.presentation") ? "Google Slides"
          : mime.startsWith("image/") ? "image" : "text";

        const evidenceChunks: EvidenceChunk[] = [];
        let chunkCounter = 0;
        const inferEvidenceType = (kind: string, bucket: "policy" | "evidence", body: string): EvidenceChunk["evidenceType"] => {
          if (bucket === "policy") return "Policy/Procedure";
          const bl = body.toLowerCase();
          if (/outcome|result|trend|survey|feedback|kpi|satisfaction/.test(bl)) return "Outcome Data";
          if (/review|minute|meeting|decision|improvement/.test(bl)) return "Review Evidence";
          if (kind === "Excel" || kind === "CSV" || kind === "Google Sheet") return "Implementation Record";
          return "Other";
        };

        const MAX_PART_CHARS = 24_000;
        let policyDocParts: string[] = [];
        let evidenceDocParts: string[] = [];
        const fileRecords: AuditFileRecord[] = taggedFiles.map((file) => ({
          path: file.path, name: file.path.split("/").pop() || file.path, mimeType: file.mimeType,
          fileKind: fileKind(file.mimeType), bucket: file.bucket, readStatus: "found" as const, auditStatus: "pending" as const,
          driveFileId: file.id, driveModifiedTime: file.modifiedTime,
        }));
        const filesTotal = taggedFiles.length;

        setProgress("reading", { filesTotal, filesRead: 0, filesSkipped: 0, filesFound: [...fileRecords], stageDetail: `Reading file 1 of ${filesTotal}…`, status: "running", canCancel: true, lastHeartbeatAt: Date.now() });

        const FILE_TEXT_TIMEOUT_MS = 30_000;
        const FILE_IMAGE_TIMEOUT_MS = 45_000;
        for (let fi = 0; fi < taggedFiles.length; fi++) {
          if (get().auditRunToken !== capturedToken) break;
          const file = taggedFiles[fi];
          const isImage = IMAGE_MIME_TYPES.has(file.mimeType);
          const isPolicy = file.bucket === "policy" || (file.bucket === "auto" && classifyFileBucket(file.path) === "policy");
          const resolvedBucket: "policy" | "evidence" = isPolicy ? "policy" : "evidence";
          fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
          setProgress("reading", { filesTotal, filesRead: fi, filesSkipped: skipped.length, filesFound: [...fileRecords], stageDetail: `Reading file ${fi + 1} of ${filesTotal}: ${file.path.split("/").pop() || file.path}`, lastHeartbeatAt: Date.now(), canSkipCurrentFile: true });

          const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
          const cachedEntry = get().fileTextCache[cacheKey];
          if (cachedEntry) {
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: cachedEntry.charCount, processingMode: "reused", ...(cachedEntry.pdfQuality ? { suspectedScannedPdf: cachedEntry.pdfQuality.suspectedScannedPdf, extractedTextQuality: cachedEntry.pdfQuality.extractedTextQuality } : {}) };
            if (cachedEntry.text !== null) {
              scanned.push(file.path);
              const body = cachedEntry.text;
              const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
              for (let pi = 0; pi < totalParts; pi++) {
                const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
                const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
                const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
                evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: cachedEntry.fileKind, text: chunkBody, charCount: chunkBody.length, evidenceType: inferEvidenceType(cachedEntry.fileKind, resolvedBucket, chunkBody) });
                fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
                const part = `[CHUNK:${chunkId}] --- ${file.path}${partLabel} [${cachedEntry.fileKind}] ---\n${chunkBody}`;
                if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              }
            } else {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
            }
            setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
            continue;
          }

          const fileAbort = new AbortController();
          const fileTimeoutMs = isImage ? FILE_IMAGE_TIMEOUT_MS : FILE_TEXT_TIMEOUT_MS;
          let fileTimeoutTimer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => { fileTimeoutTimer = setTimeout(() => { fileAbort.abort(); reject(new Error("FILE_TIMEOUT")); }, fileTimeoutMs); });
          _currentFileAbort = () => { clearTimeout(fileTimeoutTimer); fileAbort.abort(); };

          type FileReadResult = { kind: "text"; text: string; pdfQuality?: ReturnType<typeof classifyPdfTextQuality> } | { kind: "image"; description: string } | { kind: "skip" };
          const readPromise = (async (): Promise<FileReadResult> => {
            const text = await exportFileText(file, token, fileAbort.signal);
            if (text !== null) {
              let pdfQuality: ReturnType<typeof classifyPdfTextQuality> | undefined;
              if (file.mimeType === "application/pdf") pdfQuality = classifyPdfTextQuality(text);
              return { kind: "text", text, pdfQuality };
            }
            if (isImage && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, token, fileAbort.signal);
              const description = await describeImage(dataUrl, utilitySettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              return { kind: "image", description };
            }
            return { kind: "skip" };
          })();

          let fileResult: FileReadResult;
          try {
            fileResult = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
          } catch (err) {
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
            const wasAborted = fileAbort.signal.aborted;
            if (wasAborted || (err instanceof Error && err.message === "FILE_TIMEOUT")) {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: wasAborted ? "Skipped by user" : `Timed out after ${fileTimeoutMs / 1000}s` };
              setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length });
              continue;
            }
            if (err instanceof DriveApiError && err.status === 503) { skipped.push(file.path); fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: "Drive temporarily unavailable" }; setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length }); continue; }
            failed.push({ path: file.path, reason: err instanceof Error ? err.message : String(err) });
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "failed", failReason: err instanceof Error ? err.message : String(err) };
            setProgress("reading", { filesFound: [...fileRecords] });
            continue;
          }

          switch (fileResult.kind) {
            case "text": {
              const body = fileResult.text;
              scanned.push(file.path);
              const kind = fileKind(file.mimeType);
              set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text: body, charCount: body.length, fileKind: kind, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now(), ...(fileResult.kind === "text" && fileResult.pdfQuality ? { pdfQuality: { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } } : {}) } } }));
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: body.length, processingMode: "new", ...(fileResult.pdfQuality ? { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } : {}) };
              const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
              for (let pi = 0; pi < totalParts; pi++) {
                const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
                const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
                const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
                evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: kind, text: chunkBody, charCount: chunkBody.length, evidenceType: inferEvidenceType(kind, resolvedBucket, chunkBody) });
                fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
                const part = `[CHUNK:${chunkId}] --- ${file.path}${partLabel} [${kind}] ---\n${chunkBody}`;
                if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              }
              break;
            }
            case "image": {
              scanned.push(file.path);
              const desc = fileResult.description;
              set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text: desc, charCount: desc.length, fileKind: "image", fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now() } } }));
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: desc.length, processingMode: "new" };
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: "image", text: desc, charCount: desc.length, evidenceType: "Other" });
              fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
              const part = `[CHUNK:${chunkId}] --- ${file.path} [image] ---\n${desc}`;
              if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              break;
            }
            case "skip":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
              break;
          }
          setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
        }

        if (get().auditRunToken !== capturedToken) {
          set((st) => ({ busy: null, folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditSummary: "Audit was cancelled." } : f), auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete" } : st.auditProgress }));
          return;
        }

        const policyDocText = policyDocParts.join("\n\n=== POLICY & PROCEDURE ===\n\n") || "";
        const evidenceDocText = evidenceDocParts.join("\n\n=== ACTUAL EVIDENCE ===\n\n") || "";
        const allDocText = [policyDocText, evidenceDocText].filter(Boolean).join("\n\n");

        if (!allDocText.trim()) {
          auditHadError = true;
          finish("No readable content extracted from the linked folder(s). Check that the files are not empty or unsupported.", false);
          return;
        }

        // Detect dominant file type from chunks for skill injection
        const hasSpreadsheet = evidenceChunks.some((c) => c.fileKind === "Excel" || c.fileKind === "CSV");
        const hasScanned = evidenceChunks.some((c) => (c as { suspectedScannedPdf?: boolean }).suspectedScannedPdf === true);
        const detectedFileType: "spreadsheet" | "scanned" | null = hasSpreadsheet ? "spreadsheet" : hasScanned ? "scanned" : null;

        // Coverage matrices — populated by staged AI calls
        let policyRows: PolicyCoverageRow[] = [];
        let evidenceRows: EvidenceCoverageRow[] = [];
        let outcomeRows: OutcomeReviewRow[] = [];
        let live = false;
        let auditUsage: AIUsage | undefined;
        let stagedPromptSent: string | undefined;
        const truncationNotes: string[] = [];
        // Stages whose live AI call failed and fell back to offline keyword
        // simulation — the run must then be labelled OFFLINE FALLBACK, not
        // "Live AI", wherever the run source is shown.
        const fallbackStages: string[] = [];
        let totalWindowsProcessed = 0;
        let totalCharsAssessed = 0;
        let totalCharsAvailable = 0;
        let allWindowsFullCoverage = true;

        const criterionId = folder.subCriterionId;
        // Chunk ID → source file name, for the "#N [file · chunk]:" citation the
        // staged functions attach to each window's contributed note (evidence
        // file ledger lookup — this is a display concern, not audit logic).
        const chunkFileNames = new Map(evidenceChunks.map((c) => [c.chunkId, c.fileName]));
        const resolveChunkFile = (chunkId: string): string | undefined => chunkFileNames.get(chunkId);

        if (aiSettings.enabled && aiSettings.apiKey) {
          const stagedCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "Line Status").slice(0, 3);
          const stagedMemories = get().calibrationMemories.filter((m) => m.status === "active" && m.module === "Line Status").sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0)).slice(0, 5);
          // Stop when the user skips the stage, OR the run has been cancelled.
          // The token/abort checks matter: cancelBusy() RESETS the skip flag,
          // so the old flag-only check let a cancelled run's current stage
          // keep issuing every remaining window×batch AI call.
          const shouldStopStage = () =>
            get().auditSkipStageFlag || get().auditRunToken !== capturedToken || runAbort.signal.aborted;
          const resetSkipFlag = () => set({ auditSkipStageFlag: false });

          // Stage 2: Policy Adequacy Audit
          if (mode === "policy" || mode === "all") {
            setProgress("policy_audit", { stageDetail: `Checking policy coverage for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedPolicyAudit(allAuditPoints, policyDocText, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("policy_audit", { stageDetail: `Policy: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              policyRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Policy] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Policy] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Policy stage failed] ${msg}`);
              console.error("[StagedAudit] Policy stage threw:", msg);
              policyRows = simulateStagedPolicyAudit(allAuditPoints, policyDocText);
              fallbackStages.push("Policy");
              truncationNotes.push("[OFFLINE FALLBACK] Policy stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            // Mode = "evidence": skip policy stage, default all to "No" (unknown)
            policyRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as const, note: "Policy stage not run in evidence-only mode.", chunkIds: [] }));
          }

          // Stage 3: Evidence Implementation Audit
          if (mode === "evidence" || mode === "all") {
            setProgress("evidence_audit", { stageDetail: `Checking implementation evidence for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedEvidenceAudit(allAuditPoints, evidenceDocText, policyRows, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("evidence_audit", { stageDetail: `Evidence: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              evidenceRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (!stagedPromptSent && result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Evidence] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Evidence] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Evidence stage failed] ${msg}`);
              console.error("[StagedAudit] Evidence stage threw:", msg);
              evidenceRows = simulateStagedEvidenceAudit(allAuditPoints, evidenceDocText);
              fallbackStages.push("Evidence");
              truncationNotes.push("[OFFLINE FALLBACK] Evidence stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            evidenceRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as const, note: "Evidence stage not run in policy-only mode.", chunkIds: [] }));
          }

          // Stage 4: Outcome & Review Audit (full audit only)
          if (mode === "all") {
            setProgress("outcome_review", { stageDetail: `Checking outcome data and review records for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedOutcomeReviewAudit(allAuditPoints, allDocText, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("outcome_review", { stageDetail: `Outcomes: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              outcomeRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (!stagedPromptSent && result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Outcome/Review] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Outcome/Review] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Outcome/Review stage failed] ${msg}`);
              console.error("[StagedAudit] Outcome/Review stage threw:", msg);
              outcomeRows = simulateStagedOutcomeReview(allAuditPoints, allDocText);
              fallbackStages.push("Outcome/Review");
              truncationNotes.push("[OFFLINE FALLBACK] Outcome/Review stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            outcomeRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, outcomeEvident: false, reviewEvident: false, note: "Outcome/review stage not run in policy/evidence-only mode.", chunkIds: [] }));
          }
          // "Live AI" now means FULLY live: at least one stage consumed real
          // tokens AND no stage fell back to keyword simulation. A run where
          // a third of the APSR verdicts are keyword guesses must not present
          // as a live AI audit — the summary/truncation notes explain which
          // stage(s) fell back.
          live = auditUsage != null && fallbackStages.length === 0;
        } else {
          // Offline fallback
          policyRows = simulateStagedPolicyAudit(allAuditPoints, policyDocText);
          evidenceRows = simulateStagedEvidenceAudit(allAuditPoints, evidenceDocText);
          outcomeRows = simulateStagedOutcomeReview(allAuditPoints, allDocText);
        }

        if (get().auditRunToken !== capturedToken) {
          set((st) => ({ busy: null, auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete" } : st.auditProgress }));
          return;
        }

        // Stage 5: Deterministic APSR Verdict Builder
        setProgress("apsr_build", { stageDetail: "Building APSR verdicts from coverage matrices…" });
        // Checklist lines' sourceRef comes from an AI call (runLiveChecklistGeneration)
        // that is asked to echo the flatAuditPoint ref verbatim, but LLM output isn't
        // guaranteed byte-identical — a stray "DS:" prefix, extra whitespace, or a case
        // difference (e.g. "6.1.1.DS1.A" vs "6.1.1.DS1.a") makes an exact-string Map
        // lookup miss a ref that genuinely exists in the audit results, silently
        // dropping the line into the generic "overall coverage" fallback. Normalize
        // both sides via the shared module-level normalizeAuditRef so only a truly
        // nonexistent ref falls through.
        const policyByRef = new Map(policyRows.map((r) => [normalizeAuditRef(r.ref), r]));
        const evidenceByRef = new Map(evidenceRows.map((r) => [normalizeAuditRef(r.ref), r]));
        const outcomeByRef = new Map(outcomeRows.map((r) => [normalizeAuditRef(r.ref), r]));

        // Overall coverage for lines without sourceRef — computed over rows
        // that were actually assessed; not-assessed placeholders from a
        // stopped run carry no information and must not skew the fallback.
        const assessedPolicyRows = policyRows.filter((r) => !r.notAssessed);
        const assessedEvidenceRows = evidenceRows.filter((r) => !r.notAssessed);
        const assessedOutcomeRows = outcomeRows.filter((r) => !r.notAssessed);
        const policyOverall: "Yes" | "Partial" | "No" =
          assessedPolicyRows.length === 0 ? "No" :
          assessedPolicyRows.filter((r) => r.covered === "Yes").length >= assessedPolicyRows.length / 2 ? "Yes" :
          assessedPolicyRows.some((r) => r.covered !== "No") ? "Partial" : "No";
        const evidenceOverall: "Yes" | "Partial" | "No" =
          assessedEvidenceRows.length === 0 ? "No" :
          assessedEvidenceRows.filter((r) => r.covered === "Yes").length >= assessedEvidenceRows.length / 2 ? "Yes" :
          assessedEvidenceRows.some((r) => r.covered !== "No") ? "Partial" : "No";
        const outcomeOverall = assessedOutcomeRows.some((r) => r.outcomeEvident);
        const reviewOverall = assessedOutcomeRows.some((r) => r.reviewEvident);

        type StagedVerdict = { lineId: string; apsr: ApsrBreakdown; status: "Met" | "Partial" | "Not met" };
        // Lines whose backing audit rows were never assessed (run stopped or
        // stage skipped before reaching them) get NO verdict written at all —
        // their previous checklist status stays, no finding is raised, and
        // the count is reported so the partial run cannot pass as complete.
        let linesNotAssessed = 0;
        const stagedVerdicts: StagedVerdict[] = lines.flatMap((line) => {
          const normRef = line.sourceRef ? normalizeAuditRef(line.sourceRef) : undefined;
          const pRow = normRef ? policyByRef.get(normRef) : undefined;
          const eRow = normRef ? evidenceByRef.get(normRef) : undefined;
          const oRow = normRef ? outcomeByRef.get(normRef) : undefined;

          if (pRow?.notAssessed || eRow?.notAssessed || oRow?.notAssessed) {
            linesNotAssessed++;
            return [];
          }

          // This checklist line has no sourceRef matching a specific flatAuditPoint
          // ref, so there is no window-level note or chunk citation to inherit —
          // fall back to the folder-wide coverage overall. This is a genuinely
          // different case from "the AI didn't find anything for this ref": here
          // there was no ref to look up in the first place.
          const effectivePRow = pRow ?? { ref: "", pointText: "", covered: policyOverall, note: "No specific audit point maps to this checklist line — using overall policy coverage for the folder.", chunkIds: [] };
          const effectiveERow = eRow ?? { ref: "", pointText: "", covered: evidenceOverall, note: "No specific audit point maps to this checklist line — using overall evidence coverage for the folder.", chunkIds: [] };
          const effectiveORow = oRow ?? { ref: "", pointText: "", outcomeEvident: outcomeOverall, reviewEvident: reviewOverall, note: "No specific audit point maps to this checklist line — using overall outcome/review coverage for the folder.", chunkIds: [] };

          // requireCitations on live runs only: a positive dimension with no
          // cited chunks is downgraded one level. Offline keyword simulation
          // never cites chunks, so applying it there would zero every run.
          const apsr = buildStagedApsr(effectivePRow, effectiveERow, effectiveORow, { requireCitations: live });
          const status = deriveApsrStatus(apsr);
          return [{ lineId: line.id, apsr, status }];
        });
        if (linesNotAssessed > 0) {
          truncationNotes.push(`[PARTIAL RUN] ${linesNotAssessed} checklist line(s) were NOT assessed (run stopped/skipped before their audit points were reviewed) — their previous status was left unchanged and no findings were raised for them.`);
        }

        // Stage 6: Write to Sub-Criterion Checklist
        setProgress("saving", { stageDetail: `Saving ${stagedVerdicts.length} verdicts…`, linesAssessed: stagedVerdicts.length, findingsDetected: stagedVerdicts.filter((v) => v.status === "Not met").length });
        try {
          const checklist = useChecklistModuleStore.getState();
          for (const v of stagedVerdicts) {
            const itemId = lineOwners.get(v.lineId);
            if (!itemId) continue;
            checklist.setSpecificStatus(itemId, v.lineId, v.status);
            const baseNote = apsrAuditNote(v.apsr);
            const sourceLines = [`SOURCE TRACE`, `Run: ${runId} (staged audit, ${mode} mode, ${live ? "live AI" : "offline estimate"})`, `Auditor: ${auditorName}`];
            checklist.replaceAuditEvidence(itemId, v.lineId, {
              title: `Staged audit ${runId} — ${folder.folderName}`,
              type: evidenceTypeFromApsr(v.apsr, lines.find((l) => l.id === v.lineId)?.text || ""),
              drive: folder.folderLink || folder.policyLink,
              owner: folder.owner,
              date: new Date().toISOString().slice(0, 10),
              approved: false,
              reviewed: false,
              sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
              auditorNote: `${baseNote}\n\n${sourceLines.join("\n")}`,
              apsr: v.apsr,
              runId,
            });
          }
        } catch (err) {
          finish(`Staged audit failed while writing verdicts: ${err instanceof Error ? err.message : String(err)}`, live);
          return;
        }

        const preRaiseFindingIds = new Set(get().customFindings.map((f) => f.id));
        let autoRaised = 0;
        try { autoRaised = useChecklistModuleStore.getState().raiseAllUnmetFindings(runId); } catch { /* non-fatal */ }

        // Stage 7: Findings Summary
        setProgress("findings_summary", { stageDetail: `Found ${autoRaised} gap${autoRaised === 1 ? "" : "s"} — raising findings…` });
        await new Promise((r) => setTimeout(r, 300)); // brief pause so stage is visible

        const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
        for (const v of stagedVerdicts) counts[v.status]++;
        const stagesRun = mode === "all" ? "Policy ✓ → Evidence ✓ → Outcome/Review ✓ → APSR verdict" : mode === "policy" ? "Policy ✓ → Evidence — → APSR verdict (approach only)" : "Policy — → Evidence ✓ → APSR verdict (processes only)";
        const policyGaps = policyRows.filter((r) => r.covered === "No").length;
        const evidenceGaps = evidenceRows.filter((r) => r.covered === "No").length;

        // Helper to produce a short file list like the classic audit
        const briefListStaged = (names: string[]) => {
          const base = names.map((n) => n.split("/").pop() || n);
          if (base.length <= 3) return base.join(", ");
          return base.slice(0, 3).join(", ") + ` … +${base.length - 3} more`;
        };

        // Band per GD4 item (computed from fresh checklist state, same as classic audit)
        const freshEntriesStaged = useChecklistModuleStore.getState().entries;
        const req = GD4_REQUIREMENTS.find((r) => r.subCriterionId === folder.subCriterionId);
        const bandPartsStaged: string[] = [];
        if (req) {
          const e = freshEntriesStaged[req.id];
          if (e && e.specific.length > 0) {
            bandPartsStaged.push(`${req.id} → Band ${computeBand(e.generic, e.specific, req.gateSensitive).finalBand}`);
          }
        }

        // Compacts a note for the one-line-per-gap summary below. A note may now
        // be a multi-paragraph "#N [file · chunk]:\ntext" citation block (see
        // renderWindowNotes in agentRuntime.ts) — strip the "#N [...]:" label
        // and collapse it to a single line BEFORE truncating, so a blind
        // char-slice never chops a citation bracket in half or leaves a bare
        // "#1 [Some" hanging in the compact bullet list.
        const noteSummary = (note: string, maxLen: number): string =>
          note.replace(/#\d+\s*(\[[^\]]*\])?:\s*/g, "").replace(/\s*\n+\s*/g, " ").trim().slice(0, maxLen);

        // Per-line notes for Not met / Partial lines
        const gapNotes = stagedVerdicts
          .filter((v) => v.status !== "Met")
          .slice(0, 5)
          .map((v) => {
            const lineText = lines.find((l) => l.id === v.lineId)?.text ?? v.lineId;
            const dims: string[] = [];
            if (v.apsr.approach.status !== "Meeting") dims.push(`Approach${v.apsr.approach.note ? `: ${noteSummary(v.apsr.approach.note, 80)}` : ""}`);
            if (v.apsr.processes.status !== "Deployed") dims.push(`Processes${v.apsr.processes.note ? `: ${noteSummary(v.apsr.processes.note, 80)}` : ""}`);
            if (v.apsr.systemsOutcomes.status !== "Evident") dims.push(`Outcomes${v.apsr.systemsOutcomes.note ? `: ${noteSummary(v.apsr.systemsOutcomes.note, 80)}` : ""}`);
            if (v.apsr.review.status !== "Evident") dims.push(`Review${v.apsr.review.note ? `: ${noteSummary(v.apsr.review.note, 80)}` : ""}`);
            const dimStr = dims.length > 0 ? ` [${dims.join(" · ")}]` : "";
            return `  ${v.status === "Not met" ? "✗" : "◐"} ${lineText.slice(0, 100)}${dimStr}`;
          });
        if (stagedVerdicts.filter((v) => v.status !== "Met").length > 5) {
          gapNotes.push(`  … and ${stagedVerdicts.filter((v) => v.status !== "Met").length - 5} more gaps`);
        }

        // Specialist lens
        const specialistLabel = domainExpertiseLabelFor(folder.subCriterionId);

        const lineParts: string[] = [];
        // Fallback / partial-run banners lead the summary so they cannot be
        // missed under the detail lines.
        if (fallbackStages.length > 0) lineParts.push(`⚠ OFFLINE FALLBACK — ${fallbackStages.join(", ")} stage(s) failed live AI and used keyword simulation. This run is NOT a full live AI audit.`);
        if (linesNotAssessed > 0) lineParts.push(`⚠ PARTIAL RUN — ${linesNotAssessed} line(s) not assessed (run stopped/skipped early); their previous status was left unchanged.`);
        lineParts.push(`Run ${runId} · Staged audit (${mode} mode) · Auditor: ${auditorLabel}.`);
        if (specialistLabel) lineParts.push(`Specialist lens: ${specialistLabel}.`);
        lineParts.push(`✓ ${counts.Met} Met · ◐ ${counts.Partial} Partial · ✗ ${counts["Not met"]} Not met (of ${stagedVerdicts.length} assessed line${stagedVerdicts.length === 1 ? "" : "s"}${linesNotAssessed > 0 ? `; ${linesNotAssessed} not assessed` : ""}).`);
        if (bandPartsStaged.length) lineParts.push(`Band: ${bandPartsStaged.join(", ")}.`);
        if (autoRaised > 0) lineParts.push(`Raised ${autoRaised} new finding${autoRaised === 1 ? "" : "s"} from the gaps — see the Findings register.`);
        if (gapNotes.length > 0) lineParts.push(`Gap detail:\n${gapNotes.join("\n")}`);
        lineParts.push(`Stages: ${stagesRun}.`);
        if (mode !== "evidence") lineParts.push(`Policy coverage: ${policyRows.length - policyGaps}/${policyRows.length} audit points covered.`);
        if (mode !== "policy") lineParts.push(`Evidence coverage: ${evidenceRows.length - evidenceGaps}/${evidenceRows.length} audit points covered.`);
        // Split EVERY listed file (not just those that produced chunks) by the
        // same bucket rule the reading loop used, so both the "Files read" and
        // "Files assessed" lines count FILES consistently. Previously the
        // "Files read" parenthetical used policyDocParts/evidenceDocParts —
        // which are 24k-char CHUNK counts, not file counts — so one policy file
        // split into 3 chunks read as "policy: 3" here yet "Policy (1)" below.
        const nameOnly = (p: string) => p.split("/").pop() || p;
        const resolvedFileBucket = (rec: AuditFileRecord): "policy" | "evidence" =>
          rec.bucket === "policy" || (rec.bucket === "auto" && classifyFileBucket(rec.path) === "policy") ? "policy" : "evidence";
        const isReadRec = (rec: AuditFileRecord) => rec.readStatus === "read" || rec.readStatus === "condensed";
        const policyFiles = fileRecords.filter((r) => resolvedFileBucket(r) === "policy");
        const evidenceFiles = fileRecords.filter((r) => resolvedFileBucket(r) === "evidence");
        const policyReadCount = policyFiles.filter(isReadRec).length;
        const evidenceReadCount = evidenceFiles.filter(isReadRec).length;
        lineParts.push(
          scanned.length
            ? `Files read: ${scanned.length} of ${fileRecords.length} (policy: ${policyReadCount > 0 ? policyReadCount : "none"}, evidence: ${evidenceReadCount > 0 ? evidenceReadCount : "none"}) — ${briefListStaged(scanned)}.`
            : "Files read: none — no readable files were found in this folder."
        );
        if (fileRecords.length > 0) {
          // Lists ALL files the folder listing returned, each annotated with its
          // read outcome (read / skipped / failed / not read), regardless of
          // whether it produced any chunk — so the count reflects the folder's
          // true contents, not just what the AI ended up seeing.
          const describeFile = (rec: AuditFileRecord) =>
            isReadRec(rec) ? nameOnly(rec.path)
            : rec.readStatus === "skipped" ? `${nameOnly(rec.path)} (skipped${rec.skipReason ? `: ${rec.skipReason}` : ""})`
            : rec.readStatus === "failed" ? `${nameOnly(rec.path)} (failed${rec.failReason ? `: ${rec.failReason}` : ""})`
            : `${nameOnly(rec.path)} (not read)`;
          lineParts.push(
            `Files assessed:\n` +
            `  Policy (${policyFiles.length}): ${policyFiles.length > 0 ? policyFiles.map(describeFile).join(", ") : "none"}\n` +
            `  Evidence (${evidenceFiles.length}): ${evidenceFiles.length > 0 ? evidenceFiles.map(describeFile).join(", ") : "none"}`
          );
        }
        lineParts.push(live ? `Method: EduTrust APSR rubric vs GD4 standard — Approach gates the result, then Processes, Systems & Outcomes, Review (3 AI passes).` : "Method: offline keyword estimate — AI was not used (check AI Settings).");
        if (detectedFileType) lineParts.push(`File type skill injected: ${detectedFileType} (${detectedFileType === "spreadsheet" ? "spreadsheet-evidence.md" : "scanned-document-evidence.md"}).`);
        if (totalWindowsProcessed > 0 && totalCharsAvailable > 0) {
          const coveragePct = Math.round((totalCharsAssessed / totalCharsAvailable) * 100);
          const unassessed = totalCharsAvailable - totalCharsAssessed;
          lineParts.push(`Sliding window coverage: ${totalWindowsProcessed} window(s) processed · ${totalCharsAssessed.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} chars assessed (${coveragePct}%) · Full coverage: ${allWindowsFullCoverage ? "Yes" : `No — ${unassessed.toLocaleString()} chars unassessed`}.`);
        }
        if (truncationNotes.length > 0) lineParts.push(truncationNotes.join("\n"));
        const summary = lineParts.join("\n");

        finish(summary, live, undefined, auditUsage, auxUsage, stagedPromptSent);

        const runRecord: AuditRunRecord = {
          runId, folderId: id, subCriterionId: folder.subCriterionId, subCriterionTitle: folder.folderName,
          scope, status: auditHadError ? "failed" : "completed",
          startedAt: new Date(auditStartedAt).toISOString(), endedAt: new Date().toISOString(),
          auditorName, auditLive: live, aiModel: auditUsage?.model,
          fileLedger: [...fileRecords],
          aiSummary: stagedVerdicts.map((v) => ({
            lineId: v.lineId, lineText: lines.find((l) => l.id === v.lineId)?.text ?? v.lineId,
            result: v.status as "Met" | "Partial" | "Not met",
            approachStatus: v.apsr.approach.status, processesStatus: v.apsr.processes.status,
            systemsOutcomesStatus: v.apsr.systemsOutcomes.status, reviewStatus: v.apsr.review.status,
            citedChunkIds: [], citedFileNames: [],
          })),
          linesAssessed: stagedVerdicts.length, findingsDetected: counts["Not met"] as number,
          batchCount: 3, chunkCount: evidenceChunks.length,
        };
        set((st) => {
          const prev = st.auditRunHistory[id] ?? [];
          return { auditRunHistory: { ...st.auditRunHistory, [id]: [runRecord, ...prev].slice(0, 5) }, lastAuditRuns: { ...st.lastAuditRuns, [id]: runRecord } };
        });

        if (live && autoRaised > 0) {
          const currentSubCriterionIdStaged = folder.subCriterionId;
          const newFindings = get().customFindings.filter(
            (f) => !preRaiseFindingIds.has(f.id) && f.source === "Checklist" &&
              GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionIdStaged
          );
          if (newFindings.length > 0) {
            (async () => {
              const entries = useChecklistModuleStore.getState().entries;
              await Promise.all(newFindings.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  if (!req) return;
                  const entry = entries[finding.gd4ItemId];
                  const line = entry?.specific.find((l) => l.clause === finding.clause || finding.issue.startsWith(l.text.slice(0, 50)));
                  if (!line) return;
                  const dim = findingDimension(line);
                  const apsr = lineApsr(line);
                  const result = await runLiveFindingObservation(
                    { id: req.id, requirement: req.requirement, describeShow: req.describeShow, expectedEvidence: req.expectedEvidence },
                    { text: line.text, status: line.status }, dim, apsr, analysisSettings
                  );
                  get().updateCustomFinding(finding.id, { observation: result.observation, criteria: result.criteria, effect: result.effect });
                } catch { /* non-fatal */ }
              }));
            })();
          }
        }

        } catch (outerErr) {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          // A cancelled run's in-flight call throws "AI call cancelled." —
          // report it AS a cancellation, not as an unexpected failure.
          if (runAbort.signal.aborted || get().auditRunToken !== capturedToken) {
            set((st) => ({
              folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: "Staged audit cancelled — no results were saved.", lastAuditLive: false } : f),
              busy: null,
              auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete", stageDetail: "Cancelled" } : st.auditProgress,
            }));
            return;
          }
          const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
          set((st) => ({ folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `Staged audit failed — ${msg}`, lastAuditLive: false, lastAuditError: msg } : f), busy: null }));
        }
      },

      // Dashboard "Audit all folders": runs the full single-folder pipeline
      // (auto-generate → read evidence → set statuses → band/score) on every
      // folder that has a Drive link, in order, surfacing progress via
      // bulkAuditStatus. The component navigates to the Scorecard when it
      // resolves. Reuses auditFolderContents verbatim so behaviour can't drift.
      auditAllFolders: async () => {
        const folders = get().folders.filter((f) => parseFolderId(f.folderLink) || parseFolderId(f.policyLink));
        if (folders.length === 0) {
          set({ bulkAuditStatus: null });
          return;
        }
        // Read the school-wide Additional-info folder ONCE and reuse it for
        // every sub-criterion (vs re-reading it 24×). "" means "no context /
        // don't read again" to each auditFolderContents call.
        let sharedContext = "";
        const addId = parseFolderId(get().additionalInfo.link);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (addId && token) {
          set({ bulkAuditStatus: "Reading school-wide additional info…" });
          try {
            sharedContext = await readFolderPlainText(addId, token);
          } catch {
            sharedContext = "";
          }
        }
        let bulkSucceeded = 0;
        let bulkFailed = 0;
        for (let i = 0; i < folders.length; i++) {
          const f = folders[i];
          set({ bulkAuditStatus: `Auditing ${i + 1}/${folders.length}: ${f.subCriterionId} ${f.folderName}` });
          await get().auditFolderContents(f.id, sharedContext, { current: i + 1, total: folders.length });
          const updated = get().folders.find((x) => x.id === f.id);
          if (updated?.lastAuditError) bulkFailed++;
          else bulkSucceeded++;
        }
        const unlinked = get().folders.length - folders.length;
        const bulkSummary = [
          `Bulk audit complete — ${folders.length} folder${folders.length === 1 ? "" : "s"} processed.`,
          bulkSucceeded > 0 ? `✓ ${bulkSucceeded} succeeded` : "",
          bulkFailed > 0 ? `✗ ${bulkFailed} failed (see individual rows for errors)` : "",
          unlinked > 0 ? `${unlinked} unlinked (no Drive folder set)` : "",
        ].filter(Boolean).join(" · ");
        set({ bulkAuditStatus: bulkSummary });
        // Clear after 10 s so the status bar doesn't persist indefinitely.
        setTimeout(() => set((s) => (s.bulkAuditStatus === bulkSummary ? { bulkAuditStatus: null } : {})), 10_000);
      },

      auditChangedFolders: async () => {
        const token = useGoogleDriveStore.getState().getValidToken();
        const folders = get().folders;
        const linked = folders.filter((f) => parseFolderId(f.folderLink) || parseFolderId(f.policyLink));
        const unlinked = folders.length - linked.length;
        if (!token || linked.length === 0) {
          set({ bulkAuditStatus: null });
          return { audited: 0, skipped: 0, unlinked };
        }

        // Decide which folders changed by comparing each folder's newest file
        // modifiedTime against what we recorded at its last audit.
        const newestOf = async (f: (typeof linked)[number]): Promise<string | undefined> => {
          let newest: string | undefined;
          for (const fid of [parseFolderId(f.policyLink), parseFolderId(f.folderLink)]) {
            if (!fid) continue;
            try {
              const files = await listFolderFilesRecursive(fid, token);
              for (const file of files) {
                if (file.modifiedTime && (!newest || file.modifiedTime > newest)) newest = file.modifiedTime;
              }
            } catch {
              // a folder we can't list is treated as "changed" so it re-audits
              return new Date().toISOString();
            }
          }
          return newest;
        };

        const toAudit: typeof linked = [];
        let skipped = 0;
        for (let i = 0; i < linked.length; i++) {
          const f = linked[i];
          set({ bulkAuditStatus: `Checking ${i + 1}/${linked.length} for changes: ${f.subCriterionId}` });
          // Never audited before, or no recorded baseline → always audit.
          if (!f.lastAuditAt || !f.lastAuditNewestModified) {
            toAudit.push(f);
            continue;
          }
          const newest = await newestOf(f);
          if (newest && newest > f.lastAuditNewestModified) toAudit.push(f);
          else skipped += 1;
        }

        // Read school-wide Additional-info once, same as auditAllFolders.
        let sharedContext = "";
        const addId = parseFolderId(get().additionalInfo.link);
        if (addId) {
          try {
            sharedContext = await readFolderPlainText(addId, token);
          } catch {
            sharedContext = "";
          }
        }
        for (let i = 0; i < toAudit.length; i++) {
          const f = toAudit[i];
          set({ bulkAuditStatus: `Auditing changed ${i + 1}/${toAudit.length}: ${f.subCriterionId} ${f.folderName}` });
          await get().auditFolderContents(f.id, sharedContext, { current: i + 1, total: toAudit.length });
        }
        set({ bulkAuditStatus: null });
        return { audited: toAudit.length, skipped, unlinked };
      },

      setAdditionalInfoLink: (link) => set((s) => ({ additionalInfo: { ...s.additionalInfo, link } })),

      // Mirrors checkFolderAccess for the single school-wide folder.
      checkAdditionalInfoAccess: async () => {
        const link = get().additionalInfo.link;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        const checkedAt = new Date().toISOString();
        let status: DriveAccessStatus;
        let note: string;
        if (!folderId) {
          status = "Error";
          note = "Could not find a Drive folder ID in the link. Paste a Google Drive folder link.";
        } else if (!token) {
          status = "Not Connected";
          note = "Not connected to Google Drive. Connect your Google account in Settings, then try again.";
        } else {
          try {
            const files = await listFolderFilesRecursive(folderId, token);
            status = "Connected";
            note = files.length ? `Connected — found ${files.length} file${files.length === 1 ? "" : "s"} (including subfolders).` : "Connected, but this folder appears to be empty.";
          } catch (err) {
            status = "Error";
            if (err instanceof DriveApiError && err.status === 404) note = "Drive could not find this folder. Check the link points to a folder, not a file.";
            else if (err instanceof DriveApiError && err.status === 403)
              note = `Drive denied access (${err.reason || "no further detail from Google"}). Confirm the connected account has at least viewer access.`;
            else note = err instanceof Error ? err.message : String(err);
          }
        }
        set((st) => ({ additionalInfo: { ...st.additionalInfo, accessStatus: status, accessNote: note, accessAt: checkedAt } }));
      },

      setSchoolContextText: (text) => set((s) => ({ schoolContext: { ...s.schoolContext, text } })),
      setSchoolContextLink: (link) => set((s) => ({ schoolContext: { ...s.schoolContext, link } })),
      setSchoolContextEnabled: (enabled) => set((s) => ({ schoolContext: { ...s.schoolContext, enabled } })),

      // Reads the linked Drive context folder/doc into driveCache so it can be
      // injected alongside the typed briefing. Best-effort; surfaces an access
      // status like the folder checks do.
      readSchoolContextFromDrive: async () => {
        const link = get().schoolContext.link;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (!folderId) {
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Error", accessNote: "Could not find a Drive folder ID in the link." } }));
          return;
        }
        if (!token) {
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Not Connected", accessNote: "Not connected to Google Drive. Connect in Settings, then try again." } }));
          return;
        }
        try {
          const text = await readFolderPlainText(folderId, token);
          set((s) => ({
            schoolContext: {
              ...s.schoolContext,
              driveCache: text,
              cachedAt: new Date().toISOString(),
              accessStatus: "Connected",
              accessNote: text ? `Read ${text.length} characters of context from Drive.` : "Connected, but no readable text was found in this folder.",
            },
          }));
        } catch (err) {
          const msg = err instanceof DriveApiError ? err.reason || err.message : err instanceof Error ? err.message : String(err);
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Error", accessNote: `Could not read the context folder: ${msg}` } }));
        }
      },

      setSamples: (samples) => set({ samples }),
      toggleSample: (id) => set((s) => ({ samples: s.samples.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)) })),
      setSampleOutcome: (id, outcome, notes) => set((s) => ({ samples: s.samples.map((r) => (r.id === id ? { ...r, testedOutcome: outcome, notes: notes ?? r.notes } : r)) })),

      setInterviewQuestions: (qs) => set({ interviewQuestions: qs }),
      setQuestionReadiness: (id, readiness, notes) =>
        set((s) => ({ interviewQuestions: s.interviewQuestions.map((q) => (q.id === id ? { ...q, readiness, notes: notes ?? q.notes } : q)) })),

      addManagementReviewItem: (item) => set((s) => ({ managementReviewItems: [...s.managementReviewItems, item] })),
      setManagementDecision: (id, decision, decidedBy) =>
        set((s) => ({
          managementReviewItems: s.managementReviewItems.map((m) => (m.id === id ? { ...m, decision, decidedBy, decidedAt: new Date().toLocaleString() } : m)),
        })),

      addExportLogEntry: (e) => set((s) => ({ exportLog: [e, ...s.exportLog].slice(0, 100) })),

      addCustomFinding: (f) => set((s) => ({ customFindings: [...s.customFindings, f] })),

      updateCustomFinding: (id, patch) =>
        set((s) => ({ customFindings: s.customFindings.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),

      removeCustomFinding: (id) => {
        // Remove the finding and its closure entry, then unblock any checklist
        // line that was locked to this finding so it can be re-raised later.
        set((s) => {
          const { [id]: _dropped, ...remainingClosures } = s.closures;
          return { customFindings: s.customFindings.filter((f) => f.id !== id), closures: remainingClosures };
        });
        useChecklistModuleStore.getState().clearSavedFindingId(id);
      },

      clearAllFindings: () => {
        const ids = get().customFindings.map((f) => f.id);
        set({ customFindings: [], closures: {}, seedFindingsLoaded: false });
        const cs = useChecklistModuleStore.getState();
        ids.forEach((id) => cs.clearSavedFindingId(id));
        // Confirmed grouped drafts pointed at the findings just wiped —
        // downgrade them back to editable drafts (keeping their bodies)
        // instead of leaving them dangling with dead savedFindingIds.
        useFindingDraftStore.getState().downgradeConfirmedDrafts();
      },

      clearAllClosures: () => set({ closures: {} }),

      clearReviewerOverride: (itemId) =>
        set((s) => {
          const { [itemId]: _r, ...reviewer } = s.reviewer;
          const { [itemId]: _j, ...justify } = s.justify;
          const { [itemId]: _c, ...confirmed } = s.confirmed;
          return { reviewer, justify, confirmed };
        }),

      pushAIReviewLog: (entry) =>
        set((s) => {
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: entry.agent,
            reviewType: entry.reviewType,
            subjectId: entry.subjectId,
            verdict: entry.verdict,
            confidence: entry.confidence,
            keyConcerns: entry.keyConcerns,
            recommendedAction: entry.recommendedAction,
            evidenceNeeded: entry.evidenceNeeded,
            suggestedScore: entry.suggestedScore,
            suggestedBand: entry.suggestedBand as 1 | 2 | 3 | 4 | 5 | undefined,
            live: entry.live,
            liveError: entry.liveError,
            generatedContent: entry.generatedContent,
            promptSent: entry.promptSent,
            createdAt: new Date().toISOString(),
            runId: entry.runId,
            model: entry.usage?.model,
            promptTokens: entry.usage?.promptTokens,
            completionTokens: entry.usage?.completionTokens,
            totalTokens: entry.usage?.totalTokens,
          };
          return { aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200) };
        }),

      logHumanDecision: (entry) =>
        set((s) => {
          const id = `HDL-${Date.now()}-${++logCounter}`;
          const ts = new Date().toISOString();
          const log: HumanDecisionEntry = { id, timestamp: ts, ...entry };
          const next: ReturnType<typeof Object.assign> = { humanDecisionLog: [log, ...s.humanDecisionLog].slice(0, 500) };
          // Auto-promote to calibration library when there is a reason and a change
          if (entry.changed && entry.reason.trim()) {
            const cal: CalibrationExample = {
              id: `CAL-${Date.now()}-${++logCounter}`,
              timestamp: ts,
              module: entry.module,
              field: entry.field,
              aiInput: "",
              aiOutput: entry.aiOutput,
              humanCorrection: entry.humanDecision,
              reason: entry.reason,
              used: false,
              included: true,
            };
            next.calibrationExamples = [cal, ...s.calibrationExamples].slice(0, 200);
          }
          return next;
        }),

      clearAIReviewLog: () => set({ aiReviewLog: [] }),
      clearHumanDecisionLog: () => set({ humanDecisionLog: [] }),

      toggleCalibrationIncluded: (id) =>
        set((s) => ({
          calibrationExamples: s.calibrationExamples.map((c) =>
            c.id === id ? { ...c, included: !c.included } : c
          ),
        })),

      markCalibrationUsed: (ids) =>
        set((s) => ({
          calibrationExamples: s.calibrationExamples.map((c) =>
            ids.includes(c.id) ? { ...c, used: true } : c
          ),
        })),

      addCalibrationMemory: (memory) => {
        const id = `MEM-${Date.now()}-${++logCounter}`;
        const mem: CalibrationMemory = {
          ...memory,
          id,
          timestamp: new Date().toISOString(),
          usageCount: 0,
          effectivenessScore: null,
        };
        set((s) => ({ calibrationMemories: [mem, ...s.calibrationMemories].slice(0, 500) }));
        return id;
      },

      updateMemoryStatus: (id, status) =>
        set((s) => ({ calibrationMemories: s.calibrationMemories.map((m) => m.id === id ? { ...m, status } : m) })),

      incrementMemoryUsage: (id) =>
        set((s) => ({ calibrationMemories: s.calibrationMemories.map((m) => m.id === id ? { ...m, usageCount: m.usageCount + 1 } : m) })),

      updateMemoryEffectiveness: (id, score) =>
        set((s) => ({ calibrationMemories: s.calibrationMemories.map((m) => m.id === id ? { ...m, effectivenessScore: score } : m) })),

      setBusy: (id) => set({ busy: id }),
    }),
    // Bumped to v2 so existing sessions pick up the new blank-by-default
    // evidence baseline (previously seeded with sample ratings) instead of
    // silently keeping the old pre-filled state cached under v1.
    //
    // partialize — two exclusions, both privacy/quota-driven:
    //  • fileTextCache: full extracted text of every Drive file ever read —
    //    persisting it can blow the localStorage quota and take ALL
    //    persistence down with it. Performance cache, in-memory only.
    //  • promptSent (AI Review Log entries, PPD review results, evidence
    //    assessments, and the log copies inside version snapshots): full AI
    //    prompts embed up to ~24k chars of the school's actual documents
    //    each. The Supabase table sits behind the open RLS policy Settings
    //    tells users to create, so persisting them leaks institutional
    //    document text — only a short preview is stored; the full prompt
    //    stays available in-memory for the live session.
    {
      name: "ucc-gd4-workspace:v3",
      storage: workspaceStorage,
      partialize: (s) => ({
        ...s,
        fileTextCache: {},
        aiReviewLog: s.aiReviewLog.map(truncatePromptSent),
        ppdReviewResults: mapRecordValues(s.ppdReviewResults, truncatePromptSent),
        evidenceAssessments: mapRecordValues(s.evidenceAssessments, truncatePromptSent),
        versions: s.versions.map((v) => ({
          ...v,
          snapshot: { ...v.snapshot, aiReviewLog: v.snapshot.aiReviewLog?.map(truncatePromptSent) },
        })),
      }),
    }
  )
);
