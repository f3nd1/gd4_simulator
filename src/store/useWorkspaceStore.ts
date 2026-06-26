import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AuditCycle,
  AuditorProfile,
  Department,
  AgentDefinition,
  ChecklistStatus,
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
} from "../types";
import { seedEvidence } from "../data/seedEvidence";
import { seedFolders } from "../data/folders";
import { AGENTS } from "../data/agents";
import { buildDemoDataset } from "../data/demoDataset";
import { buildScored, aiScore } from "../lib/scoring";
import { simulateItemReview, simulateChecklist, simulateClosure } from "../lib/ai/simulateAI";
import { runLiveItemReview, runLiveClosureReview } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useAgentMemoryStore } from "./useAgentMemoryStore";
import { CHECKLIST_LIB } from "../data/agents";

export type ChecklistCellState = {
  status?: ChecklistStatus;
  drive?: string;
  ai?: ChecklistStatus;
  aiReason?: string;
  live?: boolean;
};

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

const DEFAULT_CYCLE: AuditCycle = {
  id: "cycle-1",
  name: "EduTrust 2027 Readiness Review",
  type: "Internal GD4 Mock Audit",
  periodStart: "2026-07-01",
  periodEnd: "2027-06-30",
  evidenceCutOffDate: "2027-05-31",
  scope: "All EduTrust GD4 criteria across academic and corporate functions.",
  status: "Draft",
  owner: "SQ",
  version: "v0.1 Draft",
  lastSavedAt: "Not saved",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  driveRoot: "",
};

const DEFAULT_AUDITORS: AuditorProfile[] = [
  { id: "AUD-1", auditCycleId: "cycle-1", name: "SQ Lead Auditor", type: "Internal", departmentId: "SQ", role: "Audit Lead", strictness: 70, focusArea: "Overall audit setup and finalisation", checklistTemplateId: "Audit Lead Checklist" },
  { id: "AUD-2", auditCycleId: "cycle-1", name: "SGL Governance Reviewer", type: "Internal", departmentId: "SGL", role: "Department Reviewer", strictness: 60, focusArea: "Leadership and governance evidence", checklistTemplateId: "Management Review Checklist" },
  { id: "AUD-3", auditCycleId: "cycle-1", name: "ALI / CM Academic Reviewer", type: "Internal", departmentId: "ALI / CM", role: "Department Reviewer", strictness: 75, focusArea: "Academic process evidence", checklistTemplateId: "Academic Process Checklist" },
  { id: "AUD-4", auditCycleId: "cycle-1", name: "AD / AN Student Protection Reviewer", type: "Internal", departmentId: "AD / AN", role: "Department Reviewer", strictness: 80, focusArea: "Student protection and contract evidence", checklistTemplateId: "Student Protection Checklist" },
  { id: "AUD-5", auditCycleId: "cycle-1", name: "External EduTrust Consultant", type: "External", departmentId: undefined, role: "External Reviewer", strictness: 85, focusArea: "Simulated SSG/EduTrust assessor view", checklistTemplateId: "GD4 Criterion Checklist" },
];

// Workspace-wide department directory, seeded from the acronyms and full
// names already implied by the auditor and checklist-group data above.
// Person-in-charge is left blank for the user to fill in via Audit Cycle.
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
  checklist: Record<string, ChecklistCellState>;
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
  busy: string | null;

  updateCycle: (patch: Partial<AuditCycle>) => void;
  loadDemoDataset: () => void;
  saveAsNewVersion: (name: string, note?: string) => void;
  restoreVersion: (versionId: string) => void;
  lockCycle: () => void;
  unlockCycle: () => void;
  duplicateCycle: () => void;

  setEvidenceField: <K extends keyof ItemEvidence>(itemId: string, field: K, value: ItemEvidence[K]) => void;
  setReviewerScore: (itemId: string, value: number) => void;
  setJustify: (itemId: string, value: string) => void;
  confirmScore: (itemId: string) => void;

  setChecklistField: <K extends keyof ChecklistCellState>(id: string, field: K, value: ChecklistCellState[K]) => void;
  runChecklistAI: (dept: string) => void;

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

  setSamples: (samples: SampleRecord[]) => void;
  toggleSample: (id: string) => void;
  setSampleOutcome: (id: string, outcome: SampleRecord["testedOutcome"], notes?: string) => void;

  setInterviewQuestions: (qs: InterviewQuestion[]) => void;
  setQuestionReadiness: (id: string, readiness: InterviewQuestion["readiness"], notes?: string) => void;

  addManagementReviewItem: (item: ManagementReviewItem) => void;
  setManagementDecision: (id: string, decision: string, decidedBy: string) => void;

  addExportLogEntry: (e: ExportLogEntry) => void;

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
      evidence: seedEvidence(),
      reviewer: {},
      confirmed: {},
      justify: {},
      closures: {},
      checklist: {},
      agents: AGENTS,
      auditors: DEFAULT_AUDITORS,
      departments: DEFAULT_DEPARTMENTS,
      versions: [],
      folders: seedFolders(),
      itemReviews: {},
      aiReviewLog: [],
      samples: [],
      interviewQuestions: [],
      managementReviewItems: [],
      exportLog: [],
      busy: null,

      updateCycle: (patch) => set((s) => ({ cycle: { ...s.cycle, ...patch, updatedAt: new Date().toISOString() } })),

      // Populates the workflow-progress fields that start empty (reviewer
      // drafts, sign-offs, closures, checklist results, samples, interview
      // prep, management review pack, export log) with realistic values
      // derived from the existing real GD4 items, findings and checklist
      // library, so the workspace can be demoed fully populated.
      loadDemoDataset: () => set((s) => buildDemoDataset(s.evidence)),

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
            checklist: s.checklist,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            managementReviewItems: s.managementReviewItems,
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
          return {
            cycle: { ...snap.cycle, updatedAt: new Date().toISOString() },
            evidence: snap.evidence,
            reviewer: snap.reviewer,
            confirmed: snap.confirmed,
            justify: snap.justify,
            closures: snap.closures as WorkspaceState["closures"],
            checklist: snap.checklist as WorkspaceState["checklist"],
            folders: snap.folders,
            samples: snap.samples,
            interviewQuestions: snap.interviewQuestions,
            managementReviewItems: snap.managementReviewItems,
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
            checklist: s.checklist,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            managementReviewItems: s.managementReviewItems,
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

      setEvidenceField: (itemId, field, value) =>
        set((s) => ({ evidence: { ...s.evidence, [itemId]: { ...s.evidence[itemId], [field]: value } } })),

      setReviewerScore: (itemId, value) => set((s) => ({ reviewer: { ...s.reviewer, [itemId]: value } })),

      setJustify: (itemId, value) => set((s) => ({ justify: { ...s.justify, [itemId]: value } })),

      confirmScore: (itemId) =>
        set((s) => {
          const ev = s.evidence[itemId];
          const ais = aiScore(ev);
          const rev = s.reviewer[itemId] != null ? s.reviewer[itemId] : ais;
          const already = s.confirmed[itemId] != null;
          return { confirmed: { ...s.confirmed, [itemId]: already ? null : rev } };
        }),

      setChecklistField: (id, field, value) => set((s) => ({ checklist: { ...s.checklist, [id]: { ...(s.checklist[id] || {}), [field]: value } } })),

      runChecklistAI: (dept) => {
        const s = get();
        set({ busy: "cl-" + dept });
        const items = CHECKLIST_LIB.filter((c) => c.dept === dept);
        const scored = buildScored(s);
        const results = simulateChecklist(items, (gd4Id) => scored.items.find((i) => i.id === gd4Id));
        const nextChecklist = { ...s.checklist };
        const log: AIReviewLogEntry[] = [...s.aiReviewLog];
        results.forEach((r) => {
          nextChecklist[r.id] = { ...(nextChecklist[r.id] || {}), ai: r.status, aiReason: r.reason, live: false };
          logCounter += 1;
          log.unshift({
            id: `LOG-${Date.now()}-${logCounter}`,
            auditCycleId: s.cycle.id,
            agent: `${dept} Agent`,
            reviewType: "Checklist",
            subjectId: r.id,
            verdict: r.status,
            confidence: "Medium",
            keyConcerns: [r.reason],
            recommendedAction: r.status === "Pass" ? "No action needed." : "Review and provide evidence.",
            live: false,
            createdAt: new Date().toISOString(),
          });
        });
        set({ checklist: nextChecklist, aiReviewLog: log.slice(0, 200), busy: null });
      },

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
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const memory = useAgentMemoryStore.getState().memory[agentId] || [];
            verdict = await runLiveItemReview(agent, item, ev, aiSettings, memory);
            useAgentMemoryStore.getState().addMemory(agentId, { role: "user", content: `Reviewed item ${itemId}.`, createdAt: new Date().toISOString() });
            useAgentMemoryStore.getState().addMemory(agentId, { role: "assistant", content: verdict.justification, createdAt: new Date().toISOString() });
          } catch {
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
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const memory = useAgentMemoryStore.getState().memory["closure-reviewer"] || [];
            verdict = await runLiveClosureReview(c, aiSettings, memory);
            useAgentMemoryStore.getState().addMemory("closure-reviewer", { role: "user", content: `Reviewed closure for ${afiId}.`, createdAt: new Date().toISOString() });
            useAgentMemoryStore.getState().addMemory("closure-reviewer", { role: "assistant", content: verdict.reason, createdAt: new Date().toISOString() });
          } catch {
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

      setBusy: (id) => set({ busy: id }),
    }),
    { name: "ucc-gd4-workspace:v1" }
  )
);
