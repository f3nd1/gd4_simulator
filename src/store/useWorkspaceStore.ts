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
} from "../types";
import { seedEvidence, blankEvidence } from "../data/seedEvidence";
import { seedFolders } from "../data/folders";
import { AGENTS } from "../data/agents";
import { buildDemoDataset } from "../data/demoDataset";
import { buildScored, aiScore, needsJustification } from "../lib/scoring";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { simulateItemReview, simulateClosure, simulateFolderAudit } from "../lib/ai/simulateAI";
import { runLiveItemReview, runLiveClosureReview, runLiveFolderAudit } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useAgentMemoryStore } from "./useAgentMemoryStore";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useGoogleDriveStore } from "./useGoogleDriveStore";
import { parseFolderId, listFolderFilesRecursive, exportFileText, exportFileImageDataUrl, IMAGE_MIME_TYPES, DriveApiError } from "../lib/drive/driveClient";
import { describeImage, effectiveSettings } from "../lib/ai/aiClient";
import { computeBand } from "../lib/checklistBanding";

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

  updateCycle: (patch: Partial<AuditCycle>) => void;
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
  runClosureAI: (afiId: string) => Promise<void>;
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
  }) => void;

  setBusy: (id: string | null) => void;
};

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

      updateCycle: (patch) => set((s) => ({ cycle: { ...s.cycle, ...patch, updatedAt: new Date().toISOString() } })),

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
          return {
            cycle: snapshot.cycle,
            versions: [entry, ...s.versions].slice(0, 50),
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
            useAgentMemoryStore.getState().addMemory(agentId, { role: "user", content: `Reviewed item ${itemId}.`, createdAt: new Date().toISOString() });
            useAgentMemoryStore.getState().addMemory(agentId, { role: "assistant", content: verdict.justification, createdAt: new Date().toISOString() });
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
        };
        set({ itemReviews: { ...s.itemReviews, [itemId]: verdict }, aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200), busy: null });
      },

      setClosureField: (afiId, field, value) => set((s) => ({ closures: { ...s.closures, [afiId]: { ...(s.closures[afiId] || {}), [field]: value } } })),

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
        };
        set({
          closures: { ...s.closures, [afiId]: { ...c, ai: verdict.verdict, aiReason: verdict.reason, aiNeed: verdict.evidenceNeeded, live: verdict.live } },
          aiReviewLog: [log, ...s.aiReviewLog].slice(0, 200),
          busy: null,
        });
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

        const finish = (summary: string, live: boolean, liveError?: string) => {
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
          };
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: summary } : f)),
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
        const gather = async (fid: string | null, bucket: TaggedFile["bucket"], label: string) => {
          if (!fid) return;
          try {
            const fs = await listFolderFilesRecursive(fid, token);
            for (const f of fs) taggedFiles.push({ ...f, bucket });
          } catch (err) {
            listErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        await gather(policyId, "policy", "Policy & Procedure");
        await gather(evidenceId, "evidence", policyId ? "Actual Evidence" : "Evidence");
        // No separate policy folder → let the evidence folder's own subfolders
        // decide policy-vs-evidence (the previous behaviour).
        if (!policyId) for (const f of taggedFiles) f.bucket = "auto";
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

        const scanned: string[] = [];
        const skipped: string[] = []; // recognized type, but no text path for it (e.g. video)
        const failed: { path: string; reason: string }[] = []; // tried to read, threw
        // Split by the two-subfolder convention so policy docs and deployed
        // evidence reach the AI as clearly-labeled sections.
        const policyParts: string[] = [];
        const evidenceParts: string[] = [];
        let policyCount = 0;
        let evidenceCount = 0;
        const addPart = (path: string, body: string, bucket: TaggedFile["bucket"]) => {
          const isPolicy = bucket === "policy" || (bucket === "auto" && classifyFileBucket(path) === "policy");
          if (isPolicy) {
            policyParts.push(`--- ${path} ---\n${body}`);
            policyCount++;
          } else {
            evidenceParts.push(`--- ${path} ---\n${body}`);
            evidenceCount++;
          }
        };
        for (const file of taggedFiles) {
          try {
            const text = await exportFileText(file, token);
            if (text !== null) {
              scanned.push(file.path);
              addPart(file.path, text, file.bucket);
              continue;
            }
            if (IMAGE_MIME_TYPES.has(file.mimeType) && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, token);
              const description = await describeImage(dataUrl, utilitySettings);
              scanned.push(file.path);
              addPart(`${file.path} (image)`, description, file.bucket);
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
        const docText = [
          resolvedContext
            ? `=== SCHOOL-WIDE CONTEXT (general supporting documents — background only, not primary evidence for this sub-criterion) ===\n${resolvedContext}`
            : "",
          policyParts.length ? `=== POLICY & PROCEDURE ===\n${policyParts.join("\n\n")}` : "",
          evidenceParts.length ? `=== ACTUAL EVIDENCE ===\n${evidenceParts.join("\n\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        let verdicts;
        let live = false;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            verdicts = await runLiveFolderAudit(lines, docText, analysisSettings);
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
            checklist.addEvidence(itemId, v.lineId, {
              title: `Drive audit: ${folder.folderName}`,
              type: inferEvidenceType(lineTextById.get(v.lineId) || ""),
              drive: folder.folderLink || folder.policyLink,
              owner: folder.owner,
              date: new Date().toISOString().slice(0, 10),
              approved: false,
              reviewed: false,
              sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
              auditorNote: v.reason,
            });
          }
        } catch (err) {
          finish(`Audit read the folder but failed while writing checklist verdicts: ${err instanceof Error ? err.message : String(err)}`, live, liveError);
          return;
        }

        const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
        for (const v of verdicts) counts[v.status]++;
        // Cap the file lists so a folder of dozens of files can't produce a
        // multi-thousand-character summary that floods the row and the AI log.
        const NAME_CAP = 6;
        const briefList = (names: string[]) => {
          const shown = names.slice(0, NAME_CAP).join(", ");
          return names.length > NAME_CAP ? `${shown}, +${names.length - NAME_CAP} more` : shown;
        };
        const fileSummary = scanned.length
          ? `Scanned ${scanned.length} file${scanned.length === 1 ? "" : "s"} — Policy & Procedure: ${policyCount}, Actual Evidence: ${evidenceCount} (${briefList(scanned)}).`
          : "No readable files were found in this folder.";
        const skipSummary = skipped.length ? ` Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"} (${briefList(skipped)}).` : "";
        // Collapse identical failure reasons (e.g. every PDF hitting the same
        // worker error) to one line instead of repeating it per file.
        const failSummary = (() => {
          if (!failed.length) return "";
          const reasons = [...new Set(failed.map((f) => f.reason))];
          const reasonText = reasons.length === 1 ? reasons[0] : `${reasons.length} distinct errors, e.g. ${reasons[0]}`;
          return ` Could not read ${failed.length} file${failed.length === 1 ? "" : "s"} (${reasonText}): ${briefList(failed.map((f) => f.path))}.`;
        })();

        // Resulting band per item, shown right here so the score is visible at
        // the point of audit instead of only on the Scorecard — this is the
        // same band computeChecklistOverrides feeds into the overall score.
        const freshEntries = useChecklistModuleStore.getState().entries;
        const bandParts = items
          .map((item) => {
            const e = freshEntries[item.id];
            if (!e || e.specific.length === 0) return null;
            return `${item.id} → Band ${computeBand(e.generic, e.specific, item.gateSensitive).finalBand}`;
          })
          .filter(Boolean);
        const bandSummary = bandParts.length ? ` Resulting band: ${bandParts.join(", ")}.` : "";

        const summary = `${fileSummary}${skipSummary}${failSummary} Set ${verdicts.length} checklist line${verdicts.length === 1 ? "" : "s"}: ${counts.Met} Met, ${counts.Partial} Partial, ${counts["Not met"]} Not met.${bandSummary}`;
        finish(summary, live, liveError);
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
