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
  Finding,
  DriveAccessStatus,
  ApsrBreakdown,
} from "../types";
import { seedEvidence, blankEvidence } from "../data/seedEvidence";
import { seedFolders } from "../data/folders";
import { AGENTS } from "../data/agents";
import { buildDemoDataset } from "../data/demoDataset";
import { buildScored, aiScore, needsJustification } from "../lib/scoring";
import { auditEvidence, type EvidenceAuditFlag } from "../lib/evidenceAudit";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { simulateItemReview, simulateClosure, simulateFolderAudit, type FolderAuditLineVerdict } from "../lib/ai/simulateAI";
import { runLiveItemReview, runLiveClosureReview, runLiveClosureDraft, runLiveFolderAudit, runLiveFindingObservation, FOLDER_DOC_CAP } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useScoringConfigStore } from "./useScoringConfigStore";
import { useAgentMemoryStore } from "./useAgentMemoryStore";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useGoogleDriveStore } from "./useGoogleDriveStore";
import { parseFolderId, listFolderFilesRecursive, exportFileText, exportFileImageDataUrl, IMAGE_MIME_TYPES, DriveApiError } from "../lib/drive/driveClient";
import { describeImage, summariseText, effectiveSettings, addUsage, type AIUsage } from "../lib/ai/aiClient";
import { computeBand, lineApsr, findingDimension } from "../lib/checklistBanding";
import { apsrReason, apsrAuditNote } from "../lib/ai/simulateAI";

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
function classifyFileBucket(path: string): "policy" | "evidence" {
  const topSegment = path.split("/")[0]?.toLowerCase() || "";
  return /polic|procedure/.test(topSegment) ? "policy" : "evidence";
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
  { id: "SQ", acronym: "SQ", fullName: "Quality Assurance", personInCharge: "" },
  { id: "SGL", acronym: "SGL", fullName: "Leadership", personInCharge: "" },
  { id: "ALI / CM", acronym: "ALI / CM", fullName: "Academic", personInCharge: "" },
  { id: "AD / AN", acronym: "AD / AN", fullName: "Student Administration", personInCharge: "" },
  { id: "SSO", acronym: "SSO", fullName: "Student Support", personInCharge: "" },
  { id: "HR", acronym: "HR", fullName: "Human Resources", personInCharge: "" },
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
  // Persisted "Recheck all evidence" report so it survives navigation and
  // page refreshes. null means the report hasn't been run yet this session.
  evidenceAuditReport: { flags: EvidenceAuditFlag[]; generatedAt: string } | null;

  updateCycle: (patch: Partial<AuditCycle>) => void;
  // Clears a stranded busy/bulk state so a button stuck on "Auditing…" can be
  // released. Any in-flight network call still finishes in the background
  // (bounded by the AI client's request timeout) and harmlessly re-clears busy.
  cancelBusy: () => void;
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
  setClosureHuman: (afiId: string, value: "" | "Accepted") => void;

  addAuditor: (a: AuditorProfile) => void;
  updateAuditor: (id: string, patch: Partial<AuditorProfile>) => void;
  removeAuditor: (id: string) => void;

  addDepartment: (d: Department) => void;
  updateDepartment: (id: string, patch: Partial<Department>) => void;
  removeDepartment: (id: string) => void;

  setFolderField: <K extends keyof EvidenceFolder>(id: string, field: K, value: EvidenceFolder[K]) => void;
  checkFolderAccess: (id: string, tab?: "policy" | "evidence") => Promise<void>;
  // extraContext (optional): school-wide "Additional info" folder text, fed in
  // as labeled background — never primary evidence (the evidence-sufficiency
  // caps still gate the band).
  auditFolderContents: (id: string, extraContext?: string) => Promise<void>;
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
    runId?: string;
    usage?: AIUsage;
  }) => void;

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
      samples: [],
      interviewQuestions: [],
      managementReviewItems: [],
      exportLog: [],
      customFindings: [],
      seedFindingsLoaded: false,
      busy: null,
      bulkAuditStatus: null,
      additionalInfo: { link: "" },
      schoolContext: { text: "", link: "" },
      evidenceAuditReport: null,
      auditJournal: "",
      restoreLog: [],
      activeAuditorId: null,

      setActiveAuditor: (id) => set({ activeAuditorId: id }),

      updateCycle: (patch) => set((s) => ({ cycle: { ...s.cycle, ...patch, updatedAt: new Date().toISOString() } })),

      cancelBusy: () => set({ busy: null, bulkAuditStatus: null }),
      clearAuditJournal: () => set({ auditJournal: "" }),

      runEvidenceAudit: (flags: EvidenceAuditFlag[] | null) =>
        set({ evidenceAuditReport: flags === null ? null : { flags, generatedAt: new Date().toLocaleString() } }),

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
            aiReviewLog: s.aiReviewLog,
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            agentMemory: useAgentMemoryStore.getState().memory,
            auditJournal: s.auditJournal,
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
            aiReviewLog: s.aiReviewLog,
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            agentMemory: useAgentMemoryStore.getState().memory,
            auditJournal: s.auditJournal,
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
      // folder skeleton) survives. Demo data only returns if "Use demo
      // data" is clicked again afterward.
      createNewCycle: () => {
        useChecklistModuleStore.getState().replaceAllEntries({});
        set(() => ({
          cycle: { ...DEFAULT_CYCLE, id: `cycle-${Date.now()}`, name: "New Audit Cycle", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          evidence: blankEvidence(),
          reviewer: {},
          confirmed: {},
          justify: {},
          closures: {},
          auditors: [],
          departments: DEFAULT_DEPARTMENTS,
          versions: [],
          folders: seedFolders(),
          itemReviews: {},
          aiReviewLog: [],
          samples: [],
          interviewQuestions: [],
          managementReviewItems: [],
          exportLog: [],
          customFindings: [],
          seedFindingsLoaded: false,
          evidenceAuditReport: null,
          auditJournal: "",
        }));
      },

      setEvidenceField: (itemId, field, value) =>
        set((s) => ({ evidence: { ...s.evidence, [itemId]: { ...s.evidence[itemId], [field]: value } } })),

      // Editing the reviewer score after a confirm invalidates that
      // confirmation, so a stale "Confirmed" badge can never sit next to a
      // Reviewer input showing a different number — the reviewer must
      // explicitly re-confirm (and re-justify if still required) the new value.
      setReviewerScore: (itemId, value) =>
        set((s) => ({
          reviewer: { ...s.reviewer, [itemId]: value },
          confirmed: s.confirmed[itemId] != null ? { ...s.confirmed, [itemId]: null } : s.confirmed,
        })),

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

      setClosureField: (afiId, field, value) => set((s) => ({ closures: { ...s.closures, [afiId]: { ...(s.closures[afiId] || {}), [field]: value } } })),

      seedClosure: (afiId, seed) =>
        set((s) => {
          const c = s.closures[afiId] || {};
          return {
            closures: {
              ...s.closures,
              // Only fill blanks — never clobber the user's own text.
              [afiId]: { ...c, root: c.root || seed.root, corr: c.corr || seed.corr, prev: c.prev || seed.prev },
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
            verdict = await runLiveClosureReview(c, settings, memory);
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
          const draft = await runLiveClosureDraft({ issue, gd4ItemId }, settings, { standard, apsr: apsr ? apsrReason(apsr) : undefined });
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
            usage: draft.usage,
          });
          set((s) => {
            const c = s.closures[afiId] || {};
            return {
              closures: {
                ...s.closures,
                [afiId]: { ...c, root: c.root || draft.root, corr: c.corr || draft.corr, prev: c.prev || draft.prev },
              },
              busy: null,
            };
          });
        } catch (err) {
          set({ busy: null });
          throw err;
        }
      },

      setClosureHuman: (afiId, value) => set((s) => ({ closures: { ...s.closures, [afiId]: { ...(s.closures[afiId] || {}), human: value } } })),

      addAuditor: (a) => set((s) => ({ auditors: [...s.auditors, a] })),
      updateAuditor: (id, patch) => set((s) => ({ auditors: s.auditors.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      removeAuditor: (id) => set((s) => ({ auditors: s.auditors.filter((a) => a.id !== id) })),

      addDepartment: (d) => set((s) => ({ departments: [...s.departments, d] })),
      updateDepartment: (id, patch) => set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      removeDepartment: (id) => set((s) => ({ departments: s.departments.filter((d) => d.id !== id) })),

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
      auditFolderContents: async (id, extraContext) => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        set({ busy: "folderaudit" + id });

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
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: summary, lastAuditLive: live, lastAuditError: liveError, lastAuditNewestModified: newestModified ?? f.lastAuditNewestModified, lastAuditRunId: runId, lastAuditAuditor: auditorLabel } : f)),
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 200),
            busy: null,
          }));
        };

        const evidenceId = parseFolderId(folder.folderLink);
        const policyId = parseFolderId(folder.policyLink);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (!evidenceId && !policyId) {
          finish("No Drive folder linked. Add a Policy & Procedure and/or Actual Evidence folder link first.", false);
          return;
        }
        if (!token) {
          finish("Not connected to Google Drive. Connect your Google account in Settings, then run the audit again.", false);
          return;
        }

        const items = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === folder.subCriterionId);
        if (items.length === 0) {
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
        if (taggedFiles.length === 0 && listErrors.length) {
          finish(`Could not list the linked folder(s): ${listErrors.join("; ")}.`, false, listErrors.join("; "));
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
        type Part = { heading: string; body: string; isPolicy: boolean };
        const parts: Part[] = [];
        let policyCount = 0;
        let evidenceCount = 0;
        const fileKind = (mime: string) =>
          mime === "application/pdf" ? "PDF"
            : mime.includes("wordprocessingml") ? "Word"
            : mime.includes("google-apps.document") ? "Google Doc"
            : mime.includes("google-apps.spreadsheet") || mime === "text/csv" ? "spreadsheet/CSV"
            : mime.includes("google-apps.presentation") ? "Google Slides"
            : mime.startsWith("image/") ? "image"
            : "text";
        const pushPart = (path: string, body: string, bucket: TaggedFile["bucket"], kind: string) => {
          const isPolicy = bucket === "policy" || (bucket === "auto" && classifyFileBucket(path) === "policy");
          parts.push({ heading: `--- ${path} [${kind}] ---`, body, isPolicy });
          if (isPolicy) policyCount++;
          else evidenceCount++;
        };
        for (const file of taggedFiles) {
          try {
            const text = await exportFileText(file, token);
            if (text !== null) {
              scanned.push(file.path);
              pushPart(file.path, text, file.bucket, fileKind(file.mimeType));
              continue;
            }
            if (IMAGE_MIME_TYPES.has(file.mimeType) && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, token);
              const description = await describeImage(dataUrl, utilitySettings, { onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              scanned.push(file.path);
              pushPart(file.path, description, file.bucket, "image");
              continue;
            }
            skipped.push(file.path);
          } catch (err) {
            // Don't bury the cause — a PDF/.docx that throws here is a read
            // failure (worker missing, corrupt file, permission), NOT an
            // unsupported type, and the user needs to see which so they
            // don't go hunting for the wrong fix.
            failed.push({ path: file.path, reason: err instanceof Error ? err.message : String(err) });
          }
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

        let condensed = 0;
        const headingOverhead = parts.reduce((n, p) => n + p.heading.length + 2, 0);
        const fixedOverhead = headingOverhead + (resolvedContext?.length || 0) + journalBlock.length + 300; // 300 ≈ section markers
        const bodyBudgetTotal = Math.max(4000, FOLDER_DOC_CAP - fixedOverhead);
        const rawTotal = parts.reduce((n, p) => n + p.body.length, 0);
        if (rawTotal > bodyBudgetTotal && aiSettings.enabled && aiSettings.apiKey && parts.length) {
          const budget = Math.max(500, Math.floor(bodyBudgetTotal / parts.length));
          for (const p of parts) {
            if (p.body.length > budget) {
              try {
                p.body = await summariseText(p.heading, p.body, utilitySettings, budget, { onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
                condensed++;
              } catch {
                p.body = p.body.slice(0, budget);
              }
            }
          }
        }

        const sectionText = (isPolicy: boolean) => parts.filter((p) => p.isPolicy === isPolicy).map((p) => `${p.heading}\n${p.body}`).join("\n\n");
        const policyText = sectionText(true);
        const evidenceText = sectionText(false);
        const docText = [
          journalBlock,
          resolvedContext ? `=== SCHOOL-WIDE CONTEXT (general supporting documents — background only, not primary evidence for this sub-criterion) ===\n${resolvedContext}` : "",
          policyText ? `=== POLICY & PROCEDURE ===\n${policyText}` : "",
          evidenceText ? `=== ACTUAL EVIDENCE ===\n${evidenceText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        // The official GD4 standard for this sub-criterion, so the AI judges
        // each line against what is actually required, not just its wording.
        const standard = items
          .map((it) => `GD4 ${it.id} — ${it.requirement}\nIntent: ${it.intent}\nDescribe/Show:\n${it.describeShow.map((d) => `- ${d}`).join("\n")}${it.notes.length ? `\nNotes:\n${it.notes.map((n) => `- ${n}`).join("\n")}` : ""}\nExpected evidence: ${it.expectedEvidence.join("; ")}`)
          .join("\n\n");

        // The acting auditor's own strictness drives the audit; only when no
        // auditor exists do we fall back to the global AI strictness setting.
        const strictness = auditorStrictness || useScoringConfigStore.getState().aiStrictness;
        let verdicts: ReturnType<typeof simulateFolderAudit>;
        let live = false;
        let liveError: string | undefined;
        let challenged = false;
        let truncationNote: string | undefined;
        let parseWarnings: string[] = [];
        let folderWarnings: string[] = [];
        let auditUsage: AIUsage | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const result = await runLiveFolderAudit(lines, docText, analysisSettings, { strictness, standard });
            verdicts = result.verdicts;
            truncationNote = result.truncationNote;
            parseWarnings = result.parseWarnings;
            folderWarnings = result.folderWarnings;
            auditUsage = result.usage;
            // Strict mode runs a second "challenge" pass that re-examines every
            // Met/Partial and downgrades any not fully and explicitly evidenced.
            if (strictness === "Strict") {
              const toChallenge = verdicts.filter((v) => v.status !== "Not met").map((v) => ({ lineId: v.lineId, status: v.status }));
              if (toChallenge.length) {
                try {
                  const r2 = await runLiveFolderAudit(lines, docText, analysisSettings, { strictness, standard, challenge: toChallenge });
                  verdicts = r2.verdicts;
                  parseWarnings = [...parseWarnings, ...r2.parseWarnings];
                  folderWarnings = [...new Set([...folderWarnings, ...r2.folderWarnings])];
                  auditUsage = addUsage(auditUsage, r2.usage);
                  challenged = true;
                } catch {
                  // keep first-pass verdicts if the challenge call fails
                }
              }
            }
            live = true;
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            verdicts = simulateFolderAudit(lines, docText);
          }
        } else {
          verdicts = simulateFolderAudit(lines, docText);
        }

        // Guarded so an unexpected throw while writing verdicts can't strand
        // `busy` (which would leave this row's button stuck on "Auditing…"
        // forever) — finish() below always runs and clears it.
        const lineTextById = new Map(lines.map((l) => [l.id, l.text]));
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
            const sourceSuffix = v.sources && v.sources.length ? ` (source: ${v.sources.join("; ")})` : "";
            const provenance = ` — auto-filled by AI audit ${runId} on behalf of ${auditorName} (${live ? "Evidence Intake Assistant, live" : "offline keyword estimate"}); ${auditorName === "Unassigned (no auditor set up)" ? "set up an auditor and " : ""}review before relying on it.`;
            checklist.addEvidence(itemId, v.lineId, {
              title: `Drive audit ${runId} — ${folder.folderName}`,
              type: evidenceTypeFromApsr(v.apsr, lineTextById.get(v.lineId) || ""),
              drive: folder.folderLink || folder.policyLink,
              owner: folder.owner,
              date: new Date().toISOString().slice(0, 10),
              approved: false,
              reviewed: false,
              sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
              auditorNote: `${baseNote}${sourceSuffix}${provenance}`,
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
          autoRaised = useChecklistModuleStore.getState().raiseAllUnmetFindings();
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
            ? `Method: EduTrust APSR rubric vs the GD4 standard — Approach (documented policy) gates the result, then Processes (implementation), Systems & Outcomes, Review.${condensed ? ` ${condensed} large document${condensed === 1 ? "" : "s"} condensed so the whole folder was read.` : ""}${challenged ? " A strict second-pass challenge was applied." : ""}`
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

        // Post-audit multi-agent pipeline — fires asynchronously so the audit
        // result appears immediately and the finding enrichment arrives seconds
        // later. Only runs when AI is live (no point enriching offline drafts).
        if (live && autoRaised > 0) {
          const newFindings = get().customFindings.filter(
            (f) => !preRaiseFindingIds.has(f.id) && f.source === "Checklist"
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
                (f) => preRaiseFindingIds.has(f.id) === false && (f.riskCategory === "A" || f.riskCategory === "B")
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
                  get().seedClosure(finding.id, { root: draft.root, corr: draft.corr, prev: draft.prev });
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
        for (let i = 0; i < folders.length; i++) {
          const f = folders[i];
          set({ bulkAuditStatus: `Auditing ${i + 1}/${folders.length}: ${f.subCriterionId} ${f.folderName}` });
          await get().auditFolderContents(f.id, sharedContext);
        }
        set({ bulkAuditStatus: null });
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
          await get().auditFolderContents(f.id, sharedContext);
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
            createdAt: new Date().toISOString(),
            runId: entry.runId,
            model: entry.usage?.model,
            promptTokens: entry.usage?.promptTokens,
            completionTokens: entry.usage?.completionTokens,
            totalTokens: entry.usage?.totalTokens,
          };
          return { aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200) };
        }),

      setBusy: (id) => set({ busy: id }),
    }),
    // Bumped to v2 so existing sessions pick up the new blank-by-default
    // evidence baseline (previously seeded with sample ratings) instead of
    // silently keeping the old pre-filled state cached under v1.
    { name: "ucc-gd4-workspace:v3", storage: workspaceStorage }
  )
);
