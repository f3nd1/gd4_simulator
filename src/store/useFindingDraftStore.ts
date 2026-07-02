// Zustand store managing grouped finding drafts — the intermediate state
// between "checklist has failing lines" and "confirmed finding in the register".
// Persisted to localStorage ONLY (not Supabase) — drafts are transient
// working state that does not need cross-device sync.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ChecklistLineGroup,
  GroupedFindingDraft,
  FindingDraftStatus,
  GD4Requirement,
  Finding,
  FindingDimension,
  ApsrBreakdown,
} from "../types";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { groupWeakLines, buildEvidenceStatusSummary, synthesiseApsrFromGroup } from "../lib/findingGrouper";
import { simulateGroupedFindingWriter, runLiveGroupedFindingWriter } from "../lib/ai/findingWriter";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useAISettingsStore } from "./useAISettingsStore";
import { effectiveSettings, type AIUsage } from "../lib/ai/aiClient";

function newDraftId(): string {
  return `GFD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function apsrDimToFindingDim(dim: ChecklistLineGroup["primaryApsrDimension"]): FindingDimension {
  switch (dim) {
    case "Approach":          return "Procedure";
    case "Processes":         return "Evidence";
    case "Systems & Outcomes":return "Outcomes";
    case "Review":            return "Review";
  }
}

// Whether a candidate group is already covered by an existing confirmed finding.
// A group is considered covered when an existing finding shares the same gd4ItemId
// AND has at least 1 overlapping linkedChecklistLineId.
function isCoveredByExistingFinding(group: ChecklistLineGroup, existingFindings: Finding[]): boolean {
  const lineIds = new Set(group.lines.map((l) => l.id));
  return existingFindings.some(
    (f) =>
      f.gd4ItemId === group.gd4ItemId &&
      Array.isArray(f.linkedChecklistLineIds) &&
      f.linkedChecklistLineIds.some((id) => lineIds.has(id))
  );
}

export type FindingDraftState = {
  // drafts keyed by subCriterionId, each value is an ordered array of drafts
  draftsBySubCriterion: Record<string, GroupedFindingDraft[]>;
  busy: boolean;

  // Generate grouped finding drafts for all (or a specific) sub-criterion.
  // Calls AI sequentially per group to avoid rate-limit spikes.
  generateFindingsFromChecklist: (opts?: {
    subCriterionId?: string;
    auditRunId?: string;
    live?: boolean;
  }) => Promise<{ created: number; skipped: number }>;

  // Confirm a grouped draft — creates a Finding in the workspace register,
  // stamps savedFindingId on every contributing checklist line, and marks
  // the draft confirmed.
  confirmGroupedDraft: (subCriterionId: string, draftId: string) => void;

  // Discard a single draft.
  discardDraft: (subCriterionId: string, draftId: string) => void;

  // Discard all pending/error drafts for a sub-criterion.
  discardDrafts: (subCriterionId: string) => void;

  // Discard all pending/error drafts across all sub-criteria.
  discardAllDrafts: () => void;

  // Remove EVERY draft, including confirmed ones — used by createNewCycle,
  // where the findings the confirmed drafts point at are wiped too.
  resetAllDrafts: () => void;

  // Downgrade every confirmed draft back to "draft" and drop its
  // savedFindingId — used by clearAllFindings so drafts don't dangle against
  // findings that no longer exist; the drafted bodies survive and can be
  // re-confirmed into the register.
  downgradeConfirmedDrafts: () => void;

  // Partial update for editing a draft's fields.
  updateDraftField: (
    subCriterionId: string,
    draftId: string,
    patch: Partial<Pick<GroupedFindingDraft, "title" | "observation" | "criteria" | "effect" | "rootCause" | "corrective" | "preventive" | "apsrBullets">>
  ) => void;

  getDrafts: (subCriterionId: string) => GroupedFindingDraft[];
};

export const useFindingDraftStore = create<FindingDraftState>()(
  persist(
    (set, get) => ({
      draftsBySubCriterion: {},
      busy: false,

      getDrafts: (subCriterionId) => get().draftsBySubCriterion[subCriterionId] ?? [],

      generateFindingsFromChecklist: async (opts = {}) => {
        const { subCriterionId, auditRunId, live = false } = opts;
        const checklistState = useChecklistModuleStore.getState();
        const workspaceState = useWorkspaceStore.getState();
        const aiSettings = useAISettingsStore.getState();

        // Determine which sub-criteria to process
        const allEntryIds = Object.keys(checklistState.entries);
        const targetIds = subCriterionId
          ? allEntryIds.filter((id) => {
              const req = GD4_REQUIREMENTS.find((r) => r.id === id);
              return req?.subCriterionId === subCriterionId || id === subCriterionId;
            })
          : allEntryIds;

        if (targetIds.length === 0) return { created: 0, skipped: 0 };

        set({ busy: true });
        let created = 0;
        let skipped = 0;

        for (const itemId of targetIds) {
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          if (!req) continue;

          const entry = checklistState.entries[itemId];
          if (!entry) continue;

          const groups = groupWeakLines(entry.specific, itemId, req);
          if (groups.length === 0) continue;

          const existingFindings = workspaceState.customFindings;
          const subId = req.subCriterionId;

          for (const group of groups) {
            // Skip if already covered by a confirmed finding
            if (isCoveredByExistingFinding(group, existingFindings)) {
              skipped++;
              continue;
            }

            // Skip if a non-discarded draft already exists for these lines
            const existingDrafts = get().draftsBySubCriterion[subId] ?? [];
            const lineIds = new Set(group.lines.map((l) => l.id));
            const alreadyDrafted = existingDrafts.some(
              (d) =>
                d.status !== "confirmed" &&
                d.group.lines.some((l) => lineIds.has(l.id))
            );
            if (alreadyDrafted) {
              skipped++;
              continue;
            }

            const draftId = newDraftId();
            // Insert a "writing" placeholder immediately so the UI can show progress
            const placeholder: GroupedFindingDraft = {
              id: draftId,
              gd4ItemId: itemId,
              subCriterionId: subId,
              auditRunId,
              group,
              status: "writing",
              evidenceStatusSummary: buildEvidenceStatusSummary(group.lines),
            };
            set((s) => ({
              draftsBySubCriterion: {
                ...s.draftsBySubCriterion,
                [subId]: [...(s.draftsBySubCriterion[subId] ?? []), placeholder],
              },
            }));

            try {
              let result;
              const useLive = live && aiSettings.enabled && !!aiSettings.apiKey;
              if (useLive) {
                const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
                result = await runLiveGroupedFindingWriter(group, req, settings);
              } else {
                result = simulateGroupedFindingWriter(group, req);
              }

              set((s) => ({
                draftsBySubCriterion: {
                  ...s.draftsBySubCriterion,
                  [subId]: (s.draftsBySubCriterion[subId] ?? []).map((d) =>
                    d.id === draftId
                      ? {
                          ...d,
                          status: "draft" as FindingDraftStatus,
                          title: result.title,
                          observation: result.observation,
                          criteria: result.criteria,
                          effect: result.effect,
                          rootCause: result.rootCause,
                          corrective: result.corrective,
                          preventive: result.preventive,
                          apsrBullets: result.apsrBullets,
                          evidenceStatusSummary: result.evidenceStatusSummary,
                          live: result.live,
                          aiSnapshot: {
                            title: result.title,
                            observation: result.observation,
                            criteria: result.criteria,
                            effect: result.effect,
                            rootCause: result.rootCause,
                            corrective: result.corrective,
                            preventive: result.preventive,
                          },
                        }
                      : d
                  ),
                },
              }));
              created++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              set((s) => ({
                draftsBySubCriterion: {
                  ...s.draftsBySubCriterion,
                  [subId]: (s.draftsBySubCriterion[subId] ?? []).map((d) =>
                    d.id === draftId ? { ...d, status: "error" as FindingDraftStatus, errorMessage: msg } : d
                  ),
                },
              }));
            }
          }
        }

        set({ busy: false });
        return { created, skipped };
      },

      confirmGroupedDraft: (subCriterionId, draftId) => {
        const drafts = get().draftsBySubCriterion[subCriterionId] ?? [];
        const draft = drafts.find((d) => d.id === draftId);
        if (!draft || draft.status === "confirmed") return;

        const lineIds = draft.group.lines.map((l) => l.id);
        const sourceRefs = draft.group.sourceRefs;
        const sourceTexts = draft.group.sourceTexts;
        const evidenceStatusSummary = draft.evidenceStatusSummary ?? buildEvidenceStatusSummary(draft.group.lines);
        const apsr: ApsrBreakdown | undefined = synthesiseApsrFromGroup(draft.group, draft.apsrBullets);

        const finding: Finding = {
          id: `GF-${Date.now()}`,
          auditCycleId: "cycle-1",
          gd4ItemId: draft.gd4ItemId,
          issue: draft.title ?? `GD4 ${draft.gd4ItemId} — ${draft.group.gapType} gap`,
          type: "Improvement Action",
          severity: draft.group.severity,
          owner: "",
          dueDate: "",
          repeatFinding: false,
          overdue: false,
          managementDecisionNeeded: false,
          status: "Open",
          observation: draft.observation ?? "",
          criteria: draft.criteria ?? "",
          effect: draft.effect ?? "",
          riskCategory: draft.group.riskCategory,
          dimension: apsrDimToFindingDim(draft.group.primaryApsrDimension),
          source: draft.auditRunId ? "ai_audit" : "Checklist",
          rootCause: draft.rootCause,
          corrective: draft.corrective,
          preventive: draft.preventive,
          apsr,
          // Traceability fields
          linkedChecklistLineIds: lineIds,
          linkedSourceRefs: sourceRefs,
          linkedSourceTexts: sourceTexts,
          evidenceStatusSummary,
          groupedFindingId: draftId,
          createdFromAuditRunId: draft.auditRunId,
        };

        // Log human decision: compare confirmed text against AI snapshot
        if (draft.aiSnapshot) {
          const snap = draft.aiSnapshot;
          const changedFields: string[] = [];
          const fields = ["title", "observation", "criteria", "effect", "rootCause", "corrective", "preventive"] as const;
          for (const f of fields) {
            const ai = snap[f] ?? "";
            const human = (draft[f] ?? "") as string;
            if (ai && human !== ai) changedFields.push(f);
          }
          const changed = changedFields.length > 0;
          useWorkspaceStore.getState().logHumanDecision({
            module: "Grouped Finding",
            subjectId: draft.gd4ItemId,
            aiRunId: draft.auditRunId,
            aiOutput: [snap.title, snap.observation].filter(Boolean).join(" · ").slice(0, 300),
            humanDecision: [draft.title, draft.observation].filter(Boolean).join(" · ").slice(0, 300),
            changed,
            decisionType: changed ? "Edited" : "Accepted",
            reason: "",
            field: changed ? changedFields.join(", ") : undefined,
          });
        }

        useWorkspaceStore.getState().addCustomFinding(finding);

        // Stamp savedFindingId on every contributing checklist line
        const checklistStore = useChecklistModuleStore.getState();
        for (const line of draft.group.lines) {
          checklistStore.setLineSavedFindingId(draft.gd4ItemId, line.id, finding.id);
        }

        set((s) => ({
          draftsBySubCriterion: {
            ...s.draftsBySubCriterion,
            [subCriterionId]: (s.draftsBySubCriterion[subCriterionId] ?? []).map((d) =>
              d.id === draftId ? { ...d, status: "confirmed" as FindingDraftStatus, savedFindingId: finding.id } : d
            ),
          },
        }));
      },

      discardDraft: (subCriterionId, draftId) =>
        set((s) => ({
          draftsBySubCriterion: {
            ...s.draftsBySubCriterion,
            [subCriterionId]: (s.draftsBySubCriterion[subCriterionId] ?? []).filter((d) => d.id !== draftId),
          },
        })),

      discardDrafts: (subCriterionId) =>
        set((s) => ({
          draftsBySubCriterion: {
            ...s.draftsBySubCriterion,
            [subCriterionId]: (s.draftsBySubCriterion[subCriterionId] ?? []).filter(
              (d) => d.status === "confirmed"
            ),
          },
        })),

      discardAllDrafts: () =>
        set((s) => ({
          draftsBySubCriterion: Object.fromEntries(
            Object.entries(s.draftsBySubCriterion).map(([id, drafts]) => [
              id,
              drafts.filter((d) => d.status === "confirmed"),
            ])
          ),
        })),

      resetAllDrafts: () => set({ draftsBySubCriterion: {} }),

      downgradeConfirmedDrafts: () =>
        set((s) => ({
          draftsBySubCriterion: Object.fromEntries(
            Object.entries(s.draftsBySubCriterion).map(([id, drafts]) => [
              id,
              drafts.map((d) =>
                d.status === "confirmed" ? { ...d, status: "draft" as FindingDraftStatus, savedFindingId: undefined } : d
              ),
            ])
          ),
        })),

      updateDraftField: (subCriterionId, draftId, patch) =>
        set((s) => ({
          draftsBySubCriterion: {
            ...s.draftsBySubCriterion,
            [subCriterionId]: (s.draftsBySubCriterion[subCriterionId] ?? []).map((d) =>
              d.id === draftId ? { ...d, ...patch } : d
            ),
          },
        })),
    }),
    {
      name: "ucc-gd4-finding-drafts:v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
