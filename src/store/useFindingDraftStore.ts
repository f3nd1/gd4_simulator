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
import { findingDedupeKey, findingKeyOf } from "../lib/gd4Refs";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { groupWeakLines, buildEvidenceStatusSummary, synthesiseApsrFromGroup, isCoveredByExistingFinding, classifyGroup } from "../lib/findingGrouper";
import { simulateGroupedFindingWriter, runLiveGroupedFindingWriter } from "../lib/ai/findingWriter";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { criteriaQuotesRequirement } from "../lib/findingCriteriaCheck";
import { useAISettingsStore } from "./useAISettingsStore";
import { effectiveSettings } from "../lib/ai/aiClient";

function newDraftId(): string {
  return `GFD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Run-level abort for the active generation loop. cancelGeneration() aborts
// it, which propagates through runLiveGroupedFindingWriter into
// chatComplete → fetch (killing the in-flight request) and stops the loop
// before the next finding. One run at a time (busy flag), so a single
// module-level ref is sufficient.
let _genAbort: AbortController | null = null;

function apsrDimToFindingDim(dim: ChecklistLineGroup["primaryApsrDimension"]): FindingDimension {
  switch (dim) {
    case "Approach":          return "Procedure";
    case "Processes":         return "Evidence";
    case "Systems & Outcomes":return "Outcomes";
    case "Review":            return "Review";
  }
}

// Live progress of a grouped-finding generation run, so the UI can show a
// bar + percentage + what it is working on right now instead of a static
// "Generating…". null when no run is active.
export type GenerationProgress = {
  done: number;      // findings written so far
  total: number;     // total findings this run will attempt
  detail: string;    // human-readable "what it's doing now"
};

export type FindingDraftState = {
  // drafts keyed by subCriterionId, each value is an ordered array of drafts
  draftsBySubCriterion: Record<string, GroupedFindingDraft[]>;
  busy: boolean;
  generationProgress: GenerationProgress | null;

  // Generate grouped finding drafts for all (or a specific) sub-criterion.
  // Calls AI sequentially per group to avoid rate-limit spikes.
  generateFindingsFromChecklist: (opts?: {
    subCriterionId?: string;
    auditRunId?: string;
    live?: boolean;
  }) => Promise<{ created: number; skipped: number }>;

  // Cancel an in-progress generation run: aborts the in-flight AI call and
  // stops the loop before the next finding (the backend really stops — no
  // further paid calls are made after this returns).
  cancelGeneration: () => void;

  // Confirm a grouped draft — creates a Finding in the workspace register,
  // stamps savedFindingId on every contributing checklist line, and marks
  // the draft confirmed.
  confirmGroupedDraft: (subCriterionId: string, draftId: string) => void;

  // Discard a single draft.
  discardDraft: (subCriterionId: string, draftId: string) => void;

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

  // Downgrade only the draft(s) pointing at ONE deleted finding — used by
  // removeCustomFinding so a single deletion doesn't leave a dead
  // "View finding" link on its grouped draft.
  clearSavedFindingId: (findingId: string) => void;

  // Partial update for editing a draft's fields.
  updateDraftField: (
    subCriterionId: string,
    draftId: string,
    patch: Partial<Pick<GroupedFindingDraft, "title" | "observation" | "criteria" | "effect" | "rootCause" | "corrective" | "preventive" | "apsrBullets">>
  ) => void;

};

export const useFindingDraftStore = create<FindingDraftState>()(
  persist(
    (set, get) => ({
      draftsBySubCriterion: {},
      busy: false,
      generationProgress: null,

      cancelGeneration: () => {
        _genAbort?.abort();
      },

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

        // Build the full work list up front (applying the same skip rules) so
        // we know the TOTAL and can show an accurate progress bar / percentage.
        const existingFindings = workspaceState.customFindings;
        const worklist: Array<{ itemId: string; req: GD4Requirement; subId: string; group: ChecklistLineGroup }> = [];
        let skipped = 0;
        for (const itemId of targetIds) {
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          if (!req) continue;
          const entry = checklistState.entries[itemId];
          if (!entry) continue;
          const groups = groupWeakLines(entry.specific, itemId, req);
          if (groups.length === 0) continue;
          const subId = req.subCriterionId;
          const existingDrafts = get().draftsBySubCriterion[subId] ?? [];
          for (const group of groups) {
            if (isCoveredByExistingFinding(group, existingFindings)) { skipped++; continue; }
            const lineIds = new Set(group.lines.map((l) => l.id));
            const alreadyDrafted = existingDrafts.some(
              (d) => d.status !== "confirmed" && d.group.lines.some((l) => lineIds.has(l.id))
            );
            if (alreadyDrafted) { skipped++; continue; }
            worklist.push({ itemId, req, subId, group });
          }
        }

        if (worklist.length === 0) {
          return { created: 0, skipped };
        }

        const abort = new AbortController();
        _genAbort = abort;
        const total = worklist.length;
        set({ busy: true, generationProgress: { done: 0, total, detail: `Preparing ${total} finding${total !== 1 ? "s" : ""}…` } });
        let created = 0;

        for (let i = 0; i < worklist.length; i++) {
          if (abort.signal.aborted) break;
          const { itemId, req, subId, group } = worklist[i];
          const lineCount = group.lines.length;
          set({
            generationProgress: {
              done: i,
              total,
              detail: `Writing finding ${i + 1} of ${total} — GD4 ${itemId} · ${group.gapType} gap (${lineCount} line${lineCount !== 1 ? "s" : ""}${group.sourceRefs[0] ? `, ${group.sourceRefs[0]}` : ""})`,
            },
          });

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

          const dropPlaceholder = () =>
            set((s) => ({
              draftsBySubCriterion: {
                ...s.draftsBySubCriterion,
                [subId]: (s.draftsBySubCriterion[subId] ?? []).filter((d) => d.id !== draftId),
              },
            }));

          try {
            let result;
            const useLive = live && aiSettings.enabled && !!aiSettings.apiKey;
            if (useLive) {
              const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
              result = await runLiveGroupedFindingWriter(group, req, settings, { signal: abort.signal });
            } else {
              result = simulateGroupedFindingWriter(group, req);
            }

            // Cancelled while this finding was being written: discard its
            // half-made placeholder and stop — don't leave a stray draft.
            if (abort.signal.aborted) { dropPlaceholder(); break; }

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
                        // Deterministic check: does the AI-written criteria
                        // verbatim-quote the official GD4 text this group
                        // traces to? Only meaningful on the live path — the
                        // offline simulation builds criteria FROM the source
                        // texts, so it verifies by construction.
                        criteriaUnverified: result.criteria ? !criteriaQuotesRequirement(result.criteria, [...group.sourceTexts, req.requirement]) || undefined : undefined,
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
            set({ generationProgress: { done: i + 1, total, detail: `${i + 1} of ${total} written` } });
          } catch (err) {
            // A cancellation aborts cleanly: drop the placeholder and stop the
            // loop instead of recording an "error" draft.
            const msg = err instanceof Error ? err.message : String(err);
            if (abort.signal.aborted || /cancel/i.test(msg)) { dropPlaceholder(); break; }
            set((s) => ({
              draftsBySubCriterion: {
                ...s.draftsBySubCriterion,
                [subId]: (s.draftsBySubCriterion[subId] ?? []).map((d) =>
                  d.id === draftId ? { ...d, status: "error" as FindingDraftStatus, errorMessage: msg } : d
                ),
              },
            }));
            set({ generationProgress: { done: i + 1, total, detail: `${i + 1} of ${total} processed` } });
          }
        }

        if (_genAbort === abort) _genAbort = null;
        set({ busy: false, generationProgress: null });
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
        const { findingType, ncSeverity } = classifyGroup(draft.group, apsr);

        // Confirm-time dedupe: the same gap may ALREADY be in the register —
        // raiseAllUnmetFindings can fire (auto-raise, or the Findings page
        // "raise from gaps") between this draft's generation and its confirm.
        // Creating anyway would put two findings on the same gap. Instead,
        // RELINK the draft to the existing finding and stop.
        {
          const existingFindings = useWorkspaceStore.getState().customFindings;
          const draftKey = findingDedupeKey(draft.gd4ItemId, sourceRefs[0], findingType);
          // (a) a register finding with the same composite identity, or
          // (b) a CURRENT checklist line in this group already stamped with a
          //     savedFindingId (the group's line copies are generation-time
          //     snapshots, so read the live checklist), or
          // (c) line-id / source-ref overlap via isCoveredByExistingFinding.
          const entry = useChecklistModuleStore.getState().entries[draft.gd4ItemId];
          const lineIdSet = new Set(lineIds);
          const stampedId = entry?.specific.find((l) => lineIdSet.has(l.id) && l.draftFinding?.savedFindingId)?.draftFinding?.savedFindingId;
          const existing =
            existingFindings.find((f) => stampedId && f.id === stampedId) ??
            existingFindings.find((f) => draftKey != null && findingKeyOf(f) === draftKey) ??
            existingFindings.find((f) => isCoveredByExistingFinding(draft.group, [f]));
          if (existing) {
            set((s) => ({
              draftsBySubCriterion: {
                ...s.draftsBySubCriterion,
                [subCriterionId]: (s.draftsBySubCriterion[subCriterionId] ?? []).map((d) =>
                  d.id === draftId ? { ...d, status: "confirmed" as FindingDraftStatus, savedFindingId: existing.id } : d
                ),
              },
            }));
            return;
          }
        }

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
          criteriaUnverified: draft.criteriaUnverified,
          effect: draft.effect ?? "",
          riskCategory: draft.group.riskCategory,
          dimension: apsrDimToFindingDim(draft.group.primaryApsrDimension),
          // Header classification — without this, grouped findings keyed as
          // `item::ref::` (empty type) and could never dedupe against
          // auto-raised findings keyed `item::ref::NC`.
          findingType,
          ncSeverity,
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

      clearSavedFindingId: (findingId) =>
        set((s) => ({
          draftsBySubCriterion: Object.fromEntries(
            Object.entries(s.draftsBySubCriterion).map(([id, drafts]) => [
              id,
              drafts.map((d) =>
                d.savedFindingId === findingId ? { ...d, status: "draft" as FindingDraftStatus, savedFindingId: undefined } : d
              ),
            ])
          ),
        })),

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
              // A human editing the criteria takes ownership of its wording -
              // the "AI text failed the verbatim GD4 check" flag no longer
              // describes what is stored, so it clears (the human gate).
              d.id === draftId ? { ...d, ...patch, ...(patch.criteria !== undefined ? { criteriaUnverified: undefined } : {}) } : d
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
