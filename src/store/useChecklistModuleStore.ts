import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SubCriterionChecklistEntry,
  GenericChecklistLine,
  SpecificChecklistLine,
  SpecificLineStatus,
  SubChecklistEvidenceItem,
  SamplingInfo,
  DraftFindingInfo,
  Finding,
} from "../types";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { buildGenericLines, buildSeedEntry, SEED_SPECIFIC_LINES } from "../data/checklistSeed";
import { simulateChecklistGeneration, applyAfiOverlay } from "../lib/ai/simulateAI";
import { runLiveChecklistGeneration } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useWorkspaceStore } from "./useWorkspaceStore";

let lineCounter = 0;
function newLineId(itemId: string) {
  lineCounter += 1;
  return `${itemId}-L${Date.now()}-${lineCounter}`;
}

function emptyEntry(itemId: string): SubCriterionChecklistEntry {
  return { gd4ItemId: itemId, generic: buildGenericLines(), specific: [], pendingGenerated: [] };
}

function defaultEntries(): Record<string, SubCriterionChecklistEntry> {
  const map: Record<string, SubCriterionChecklistEntry> = {};
  Object.keys(SEED_SPECIFIC_LINES).forEach((id) => {
    map[id] = buildSeedEntry(id);
  });
  return map;
}

export type ChecklistModuleState = {
  entries: Record<string, SubCriterionChecklistEntry>;
  busy: string | null;

  ensureEntry: (itemId: string) => void;
  // Replaces the whole entries map — used when restoring a saved version so
  // the checklist module is rolled back together with the workspace store.
  replaceAllEntries: (entries: Record<string, SubCriterionChecklistEntry>) => void;
  setGenericStatus: (itemId: string, lineId: GenericChecklistLine["id"], status: GenericChecklistLine["status"]) => void;

  generateSpecific: (itemId: string) => Promise<void>;
  updatePendingLine: (itemId: string, lineId: string, patch: Partial<SpecificChecklistLine>) => void;
  removePendingLine: (itemId: string, lineId: string) => void;
  addPendingLine: (itemId: string, text: string, clause?: string) => void;
  confirmGenerated: (itemId: string) => void;
  discardGenerated: (itemId: string) => void;

  addSpecificLine: (itemId: string, text: string, clause?: string) => void;
  updateSpecificLine: (itemId: string, lineId: string, patch: Partial<SpecificChecklistLine>) => void;
  removeSpecificLine: (itemId: string, lineId: string) => void;
  setSpecificStatus: (itemId: string, lineId: string, status: SpecificLineStatus) => void;

  addEvidence: (itemId: string, lineId: string, evidence: Omit<SubChecklistEvidenceItem, "id">) => void;
  updateEvidence: (itemId: string, lineId: string, evidenceId: string, patch: Partial<SubChecklistEvidenceItem>) => void;
  removeEvidence: (itemId: string, lineId: string, evidenceId: string) => void;
  reuseEvidence: (fromItemId: string, fromLineId: string, evidenceId: string, toItemId: string, toLineId: string) => void;

  setSampling: (itemId: string, lineId: string, sampling: SamplingInfo) => void;

  confirmDraftFinding: (itemId: string, lineId: string, draft: DraftFindingInfo) => void;
};

function mapEntry(
  s: ChecklistModuleState,
  itemId: string,
  fn: (e: SubCriterionChecklistEntry) => SubCriterionChecklistEntry
): Pick<ChecklistModuleState, "entries"> {
  const existing = s.entries[itemId] || emptyEntry(itemId);
  return { entries: { ...s.entries, [itemId]: fn(existing) } };
}

function mapLine(entry: SubCriterionChecklistEntry, lineId: string, fn: (l: SpecificChecklistLine) => SpecificChecklistLine): SubCriterionChecklistEntry {
  return { ...entry, specific: entry.specific.map((l) => (l.id === lineId ? fn(l) : l)) };
}

export const useChecklistModuleStore = create<ChecklistModuleState>()(
  persist(
    (set, get) => ({
      entries: defaultEntries(),
      busy: null,

      ensureEntry: (itemId) => set((s) => (s.entries[itemId] ? {} : mapEntry(s, itemId, (e) => e))),

      replaceAllEntries: (entries) => set({ entries }),

      setGenericStatus: (itemId, lineId, status) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, generic: e.generic.map((g) => (g.id === lineId ? { ...g, status } : g)) }))),

      // Tries a live OpenAI call (reusing the same chatComplete client every
      // other AI feature in this app uses) and falls back to the
      // deterministic offline decomposition on any failure or when AI is
      // disabled in Settings. Results land in pendingGenerated so the user
      // can edit/add/remove lines before confirming them into the checklist.
      generateSpecific: async (itemId) => {
        set({ busy: itemId });
        const req = GD4_REQUIREMENTS.find((r) => r.id === itemId)!;
        const aiSettings = useAISettingsStore.getState();
        let raw: { text: string; clause: string }[];
        let live = false;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            raw = await runLiveChecklistGeneration(req, aiSettings);
            if (!raw.length) raw = simulateChecklistGeneration(req);
            else live = true;
          } catch {
            raw = simulateChecklistGeneration(req);
          }
        } else {
          raw = simulateChecklistGeneration(req);
        }
        let lines: SpecificChecklistLine[] = raw.map((r, i) => ({
          id: `${itemId}-AI${Date.now()}-${i}`,
          text: r.text,
          clause: r.clause,
          status: "Not Started" as const,
          evidence: [],
          generatedBy: "ai" as const,
        }));
        lines = applyAfiOverlay(itemId, lines, useWorkspaceStore.getState().customFindings);
        // Log into the shared AI review log so the AI Agent Review screen truly
        // reflects every AI run, including checklist line generation.
        useWorkspaceStore.getState().pushAIReviewLog({
          agent: "Checklist Generator",
          reviewType: "Checklist",
          subjectId: itemId,
          verdict: `${lines.length} line${lines.length === 1 ? "" : "s"} drafted`,
          confidence: "Medium",
          keyConcerns: [`Proposed ${lines.length} specific testable line(s) for ${itemId}; pending reviewer confirmation.`],
          recommendedAction: "Review, edit and confirm the generated lines before they count toward the band.",
          live,
        });
        set((s) => ({
          ...mapEntry(s, itemId, (e) => ({ ...e, pendingGenerated: lines, generatedLive: live, generatedAt: new Date().toLocaleString() })),
          busy: null,
        }));
      },

      updatePendingLine: (itemId, lineId, patch) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, pendingGenerated: (e.pendingGenerated || []).map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }))),

      removePendingLine: (itemId, lineId) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, pendingGenerated: (e.pendingGenerated || []).filter((l) => l.id !== lineId) }))),

      addPendingLine: (itemId, text, clause) =>
        set((s) =>
          mapEntry(s, itemId, (e) => ({
            ...e,
            pendingGenerated: [...(e.pendingGenerated || []), { id: newLineId(itemId), text, clause, status: "Not Started", evidence: [], generatedBy: "manual" }],
          }))
        ),

      confirmGenerated: (itemId) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, specific: [...e.specific, ...(e.pendingGenerated || [])], pendingGenerated: [] }))),

      discardGenerated: (itemId) => set((s) => mapEntry(s, itemId, (e) => ({ ...e, pendingGenerated: [] }))),

      addSpecificLine: (itemId, text, clause) =>
        set((s) =>
          mapEntry(s, itemId, (e) => ({
            ...e,
            specific: [...e.specific, { id: newLineId(itemId), text, clause, status: "Not Started", evidence: [], generatedBy: "manual" }],
          }))
        ),

      updateSpecificLine: (itemId, lineId, patch) => set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, ...patch })))),

      removeSpecificLine: (itemId, lineId) => set((s) => mapEntry(s, itemId, (e) => ({ ...e, specific: e.specific.filter((l) => l.id !== lineId) }))),

      setSpecificStatus: (itemId, lineId, status) => set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, status })))),

      addEvidence: (itemId, lineId, evidence) =>
        set((s) =>
          mapEntry(s, itemId, (e) =>
            mapLine(e, lineId, (l) => ({ ...l, evidence: [...l.evidence, { ...evidence, id: `EV-${Date.now()}-${l.evidence.length}` }] }))
          )
        ),

      updateEvidence: (itemId, lineId, evidenceId, patch) =>
        set((s) =>
          mapEntry(s, itemId, (e) =>
            mapLine(e, lineId, (l) => ({ ...l, evidence: l.evidence.map((ev) => (ev.id === evidenceId ? { ...ev, ...patch } : ev)) }))
          )
        ),

      removeEvidence: (itemId, lineId, evidenceId) =>
        set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, evidence: l.evidence.filter((ev) => ev.id !== evidenceId) })))),

      // Copies an evidence item into another line's evidence folder (rather
      // than moving it), tagging the copy with where it came from so the UI
      // can render a "Shared from ..." badge per the spec.
      reuseEvidence: (fromItemId, fromLineId, evidenceId, toItemId, toLineId) => {
        const s = get();
        const fromLine = s.entries[fromItemId]?.specific.find((l) => l.id === fromLineId);
        const evidence = fromLine?.evidence.find((ev) => ev.id === evidenceId);
        if (!evidence) return;
        set((st) =>
          mapEntry(st, toItemId, (e) =>
            mapLine(e, toLineId, (l) => ({
              ...l,
              evidence: [...l.evidence, { ...evidence, id: `EV-${Date.now()}-${l.evidence.length}`, sharedFrom: `${fromItemId} — ${evidence.title}` }],
            }))
          )
        );
      },

      setSampling: (itemId, lineId, sampling) => set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, sampling })))),

      // The only place a draft finding is ever written to the Findings
      // module — only called from an explicit "Save to findings register"
      // button click, never automatically, per the spec's requirement.
      confirmDraftFinding: (itemId, lineId, draft) => {
        const s = get();
        const line = s.entries[itemId]?.specific.find((l) => l.id === lineId);
        if (!line || line.draftFinding?.savedFindingId) return;
        const finding: Finding = {
          id: `CKL-${Date.now()}`,
          auditCycleId: "cycle-1",
          gd4ItemId: draft.gd4ItemId,
          issue: draft.issue,
          type: "AFI",
          severity: draft.severity,
          owner: "SQ",
          dueDate: "",
          repeatFinding: false,
          overdue: false,
          managementDecisionNeeded: draft.severity === "Critical" || draft.severity === "High",
          status: "Open",
        };
        useWorkspaceStore.getState().addCustomFinding(finding);
        set((st) => mapEntry(st, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, draftFinding: { ...draft, savedFindingId: finding.id } }))));
      },
    }),
    { name: "ucc-gd4-checklist:v1" }
  )
);
