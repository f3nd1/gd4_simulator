import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type {
  SubCriterionChecklistEntry,
  GeneratedChecklistLine,
  SpecificChecklistLine,
  SpecificLineStatus,
  SubChecklistEvidenceItem,
  SamplingInfo,
  DraftFindingInfo,
  Finding,
  ChecklistLineWrite,
  HolisticBandRecord,
  ApsrDimensionScore,
  ApsrMatrixScores,
} from "../types";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { buildDraftFinding, lineSufficiency, lineApsr, apsrMatrixResult } from "../lib/checklistBanding";
import { findingDedupeKey, findingKeyOf, normalizeAuditRef, migrateDs1Ref } from "../lib/gd4Refs";
import { findOpenFindingForGap, classificationReviewNote, CLASSIFICATION_REVIEW_MARKER } from "../lib/cycleCarryover";
import { resolveFindingType } from "../lib/findingClassification";
import { buildSeedEntry, SEED_SPECIFIC_LINES } from "../data/checklistSeed";
import { simulateChecklistGeneration, applyAfiOverlay, simulateEvidenceFill, type EvidenceFillDraft } from "../lib/ai/simulateAI";
import { runLiveChecklistGeneration, runLiveEvidenceFill, runHolisticBandSuggestion, type HolisticBandSuggestionResult } from "../lib/ai/agentRuntime";
import { effectiveSettings, type AIUsage } from "../lib/ai/aiClient";
import type { OutcomeReviewLegUpdate } from "../lib/outcomeReviewApply";
import { useAISettingsStore } from "./useAISettingsStore";
import { useScoringConfigStore } from "./useScoringConfigStore";
import { useWorkspaceStore, composeSchoolContext } from "./useWorkspaceStore";

let lineCounter = 0;
function newLineId(itemId: string) {
  lineCounter += 1;
  return `${itemId}-L${Date.now()}-${lineCounter}`;
}

// Monotonic suffix for finding IDs: raiseAllUnmetFindings calls
// confirmDraftFinding in a synchronous loop, so a bare Date.now() collides
// within the same millisecond — colliding IDs then corrupt update/delete/
// closure traceability across unrelated findings.
let findingCounter = 0;
function newFindingId() {
  findingCounter += 1;
  return `CKL-${Date.now()}-${findingCounter}`;
}

function emptyEntry(itemId: string): SubCriterionChecklistEntry {
  return { gd4ItemId: itemId, specific: [], pendingGenerated: [] };
}

// A brand-new workspace starts with no checklist entries at all — the three
// hand-seeded items (4.2.1, 4.6.1, 5.1.2) only get their specific lines
// populated via loadDemoChecklistData(), mirroring useWorkspaceStore's
// blankEvidence()/seedEvidence() split for the "Use demo data" action.
function defaultEntries(): Record<string, SubCriterionChecklistEntry> {
  return {};
}

export type ChecklistModuleState = {
  entries: Record<string, SubCriterionChecklistEntry>;
  busy: string | null;

  ensureEntry: (itemId: string) => void;
  // Replaces the whole entries map — used when restoring a saved version so
  // the checklist module is rolled back together with the workspace store.
  replaceAllEntries: (entries: Record<string, SubCriterionChecklistEntry>) => void;
  // Populates the three hand-seeded items' specific lines with sample data.
  // Only ever called from the Dashboard's "Use demo data" button, alongside
  // useWorkspaceStore.loadDemoDataset.
  loadDemoChecklistData: () => void;
  // Save the item's official band from the APSR percentage matrix. Computes
  // the band + total% from the four dimension scores (apsrMatrixResult) — the
  // caller passes matrixScores + rationale + source, NOT a band. HARD GATES
  // (mirrored in the UI, enforced here for every caller, like setClosureHuman):
  //   1. all four dimensions must be scored (0 or a band) — an incomplete
  //      matrix cannot produce a defensible total.
  //   2. rationale is REQUIRED — a band with no stated reason is rejected.
  // source "human"/"ai-accepted" = a human clicked Save/Accept (unchanged).
  // source "ai-auto" = an automatic run saving the AI suggestion with no
  // human in the loop — permitted ONLY when the opt-in autoScoreBands
  // setting is on (docs/auto-scoring-setting.md); logged as decisionType
  // "Automatic", never as a human act. Gates 1 and 2 apply identically to
  // every source — the AI's generated rationale satisfies Gate 2, it is
  // never bypassed.
  setHolisticBand: (itemId: string, input: { matrixScores: ApsrMatrixScores; rationale: string; source: "human" | "ai-accepted" | "ai-auto" }) => void;
  // One-click "I reviewed this" for a "Draft (AI) · Confirm to finalise" band
  // (2026-07-19): reuses setHolisticBand EXACTLY, with the matrixScores/
  // rationale already on record and only source flipped to "human" — the
  // SAME clearing mechanism a manual re-save on the Sub-Criterion Checklist
  // already triggers (identical gates, identical Human Decision Log entry).
  // A no-op when the item has no ai-auto band — nothing to confirm.
  confirmAiAutoBand: (itemId: string) => void;
  clearHolisticBand: (itemId: string) => void;
  // Wipe the whole working matrix (all four dimensions) back to un-set, to undo
  // an AI-first-pass suggestion that filled it without a band being saved.
  clearApsrMatrix: (itemId: string) => void;
  // One dimension's matrix score (0 = 0%/not-evident, 1-5 = band). This is the
  // OFFICIAL input now. Pass undefined to un-set a dimension.
  setApsrMatrix: (itemId: string, dim: keyof ApsrMatrixScores, value: ApsrDimensionScore | undefined) => void;
  // AI first pass for the HOLISTIC band: one judgment call across all four
  // official §23 dimension descriptors, returning a suggestion + rationale.
  // Never commits — the caller shows it and the human accepts via
  // setHolisticBand. Returns null when AI is unavailable or the call fails
  // (the failure is recorded in the AI Review Log; no simulated fallback —
  // a fabricated band judgment would be worse than none).
  suggestBand: (itemId: string) => Promise<HolisticBandSuggestionResult | null>;

  generateSpecific: (itemId: string) => Promise<void>;
  updatePendingLine: (itemId: string, lineId: string, patch: Partial<SpecificChecklistLine>) => void;
  removePendingLine: (itemId: string, lineId: string) => void;
  addPendingLine: (itemId: string, text: string, clause?: string) => void;
  confirmGenerated: (itemId: string) => void;
  discardGenerated: (itemId: string) => void;

  addSpecificLine: (itemId: string, text: string, clause?: string) => void;
  removeSpecificLine: (itemId: string, lineId: string) => void;
  clearSpecificLines: (itemId: string) => void;
  setSpecificStatus: (itemId: string, lineId: string, status: SpecificLineStatus) => void;
  // Tags (or re-tags) an EXISTING, already-confirmed line's APSR dimension
  // directly — reuses the same field/enum generateSpecific already writes on
  // freshly-generated lines, without regenerating or duplicating any content.
  // A human classification, not an AI call: manual/seed lines never get this
  // field any other way (fix (b), 2026-07-14).
  setLineApsrDimension: (itemId: string, lineId: string, dim: SpecificChecklistLine["apsrDimension"]) => void;
  // Batched, AI-suggestion-driven counterpart to setLineApsrDimension: applies
  // the tags accepting an AI band suggestion produced (already matched to
  // real, currently-untagged lines by matchLineDimensionTags — see
  // runBandSuggestion's accept flow in SubCriterionChecklist.tsx). Re-checks
  // "currently untagged" against live state at write time too, so a human
  // tag applied between suggestion and accept always wins.
  applyLineDimensionTags: (itemId: string, tags: { lineId: string; dimension: NonNullable<SpecificChecklistLine["apsrDimension"]> }[]) => void;

  addEvidence: (itemId: string, lineId: string, evidence: Omit<SubChecklistEvidenceItem, "id">) => void;
  // Replaces all auto-generated audit evidence (items that have a runId, i.e.
  // produced by a Drive audit) with a fresh one, while leaving manually-added
  // evidence intact. Prevents stale "Not met" rows from accumulating when the
  // same folder is re-audited after fixes.
  replaceAuditEvidence: (itemId: string, lineId: string, evidence: Omit<SubChecklistEvidenceItem, "id">) => void;
  fillEvidenceFromLink: (itemId: string, lineId: string, link: string) => Promise<EvidenceFillDraft>;
  updateEvidence: (itemId: string, lineId: string, evidenceId: string, patch: Partial<SubChecklistEvidenceItem>) => void;
  removeEvidence: (itemId: string, lineId: string, evidenceId: string) => void;
  reuseEvidence: (fromItemId: string, fromLineId: string, evidenceId: string, toItemId: string, toLineId: string) => void;

  setSampling: (itemId: string, lineId: string, sampling: SamplingInfo) => void;

  // Writes Option A (PPD + Evidence) verdicts into the checklist — the same
  // status + audit-evidence fields the staged audit (Option B) writes, so
  // Option A results persist with the checklist and feed scoring the same
  // way. Matched lines are UPDATED (idempotent re-runs, prior runId evidence
  // replaced); unmatched refs create a new line. Returns lines written.
  applyOptionAWrites: (writes: ChecklistLineWrite[]) => number;

  // Writes ONLY the Systems & Outcomes and Review APSR legs onto each line's
  // audited evidence item (the first carrying an apsr snapshot — the same
  // item lineApsr reads), replacing Option A's hardcoded "not assessed"
  // placeholders with the on-demand Outcomes & Review pass result after the
  // human's explicit Apply click. Never touches status, sufficiency or
  // verdicts, so scoring inputs are unchanged. Returns lines updated.
  applyOutcomeReviewLegs: (updates: OutcomeReviewLegUpdate[]) => number;

  confirmDraftFinding: (itemId: string, lineId: string, draft: DraftFindingInfo, auditRunId?: string) => void;
  // Scans checklist lines and raises a draft finding for each one that is
  // Not met, or marked Met/Partial but with no real evidence attached
  // (the "capped" case). Skips lines that already produced a finding. Returns
  // the number of NEW findings raised so the caller can confirm to the user.
  // `opts.subCriterionId` scopes the sweep to that sub-criterion's item(s) —
  // a folder audit passes its own sub-criterion so it never raises findings
  // for OTHER sub-criteria left unmet by an earlier run (which used to make a
  // 6.3 audit surface findings under 7.1). Omitting it sweeps every item
  // (the manual "Raise all unmet" button).
  raiseAllUnmetFindings: (auditRunId?: string, opts?: { subCriterionId?: string }) => number;
  // Called when a finding is deleted — clears the savedFindingId lock on any
  // checklist line that pointed to it, so the line can be re-raised later.
  clearSavedFindingId: (findingId: string) => void;
  // Stamps a savedFindingId on a specific line directly by ID — used by
  // useFindingDraftStore when a grouped draft is confirmed into the findings
  // register, so each contributing line is marked as already-saved.
  setLineSavedFindingId: (itemId: string, lineId: string, findingId: string) => void;
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

      loadDemoChecklistData: () =>
        set((s) => {
          const seeded: Record<string, SubCriterionChecklistEntry> = {};
          Object.keys(SEED_SPECIFIC_LINES).forEach((id) => {
            seeded[id] = buildSeedEntry(id);
          });
          return { entries: { ...s.entries, ...seeded } };
        }),

      setHolisticBand: (itemId, input) => {
        const prev = get().entries[itemId]?.holisticBand;
        // Gate 1: every dimension must be scored — an incomplete matrix has no
        // defensible total. Snapshot band/total under the CURRENT scale (the
        // scorecard re-derives live from matrixScores, but the saved record
        // keeps a coherent snapshot of what was shown at save time).
        const result = apsrMatrixResult(input.matrixScores, useScoringConfigStore.getState().apsrScale);
        if (!result.complete) {
          console.warn("[setHolisticBand] rejected: all four APSR dimensions must be scored (0% or a band) before the band can be saved.");
          return;
        }
        // Gate 2: a band without a written justification is not usable.
        if (!input.rationale?.trim()) {
          console.warn("[setHolisticBand] rejected: a written justification citing the four APSR dimensions is required.");
          return;
        }
        get().ensureEntry(itemId);
        const full: HolisticBandRecord = {
          band: result.band,
          matrixScores: { ...input.matrixScores },
          totalPct: result.total,
          rationale: input.rationale.trim(),
          source: input.source,
          decidedAt: new Date().toISOString(),
        };
        // Also seed the working copy (apsrMatrix) the editable grid reads from,
        // so it mirrors the saved record for EVERY caller — not just the human
        // runBandSuggestion+saveBand flow that happens to co-populate it. Without
        // this, an ai-auto (or any future) save leaves apsrMatrix empty and the
        // grid shows dashes though a real band exists (2026-07-18 display bug).
        // Purely fills the field; it does not itself trigger another band save.
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, holisticBand: full, apsrMatrix: { ...input.matrixScores } })));
        // Band selection is a scoring decision — always on the record. An
        // "ai-auto" save is logged as decisionType "Automatic" with wording
        // that can never read as a human act; the two human sources keep
        // their exact pre-existing entries.
        useWorkspaceStore.getState().logHumanDecision(
          input.source === "ai-auto"
            ? {
                module: "Holistic Band",
                subjectId: itemId,
                field: "band",
                aiOutput: `AI set Band ${result.band} (APSR total ${result.total}%) automatically — auto-score setting on`,
                humanDecision: "No human decision yet — pending review",
                changed: prev?.band !== result.band,
                decisionType: "Automatic",
                reason: full.rationale ?? "",
              }
            : {
                module: "Holistic Band",
                subjectId: itemId,
                field: "band",
                aiOutput: input.source === "ai-accepted" ? `AI-suggested APSR scores → Band ${result.band}` : prev ? `Previous: Band ${prev.band}` : "No prior band",
                humanDecision: `Band ${result.band} (APSR total ${result.total}%) — ${full.rationale}`,
                changed: prev?.band !== result.band,
                decisionType: input.source === "ai-accepted" ? "Accepted" : prev && prev.band !== result.band ? "Overridden" : "Accepted",
                reason: full.rationale ?? "",
              }
        );
      },

      confirmAiAutoBand: (itemId) => {
        const hb = get().entries[itemId]?.holisticBand;
        // Gate 2 in setHolisticBand already requires a non-empty rationale, so
        // every REAL ai-auto save has one — this only guards the rationale
        // field's optional type (kept for older pre-rationale records).
        if (!hb || hb.source !== "ai-auto" || !hb.rationale) return;
        get().setHolisticBand(itemId, { matrixScores: hb.matrixScores, rationale: hb.rationale, source: "human" });
      },

      clearHolisticBand: (itemId) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, holisticBand: undefined }))),

      // Undo an "AI first pass (suggest scores)" that only populated the working
      // matrix (apsrMatrix) without saving a band. The matrix selector can set a
      // dimension but never unset it, so an accidental suggest click otherwise
      // leaves the four scores stuck on screen with no removal path (2026-07-18).
      // Touches only the working copy — never holisticBand, lines or findings.
      clearApsrMatrix: (itemId) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, apsrMatrix: undefined }))),

      setApsrMatrix: (itemId, dim, value) => {
        get().ensureEntry(itemId);
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, apsrMatrix: { ...(e.apsrMatrix ?? {}), [dim]: value } })));
      },

      suggestBand: async (itemId) => {
        const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
        const aiSettings = useAISettingsStore.getState();
        if (!req || !(aiSettings.enabled && aiSettings.apiKey)) return null;
        set({ busy: "band:" + itemId });
        const ws = useWorkspaceStore.getState();
        // Learning loop (read side): active Holistic Band corrections ride
        // into the prompt; 👎 feedback on suggestions writes them (page-side
        // FeedbackModal with module "Holistic Band").
        const memories = ws.calibrationMemories
          .filter((m) => m.status === "active" && m.module === "Holistic Band")
          .sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0))
          .slice(0, 5);
        memories.forEach((m) => ws.incrementMemoryUsage(m.id));
        let usage: AIUsage | undefined;
        try {
          const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(ws.schoolContext) });
          const result = await runHolisticBandSuggestion(req, get().entries[itemId]?.specific ?? [], settings, { memories, onUsage: (u) => { usage = u; } });
          ws.pushAIReviewLog({
            agent: "Holistic Band Assessor",
            reviewType: "Checklist",
            subjectId: itemId,
            verdict: `Suggested Band ${result.band}`,
            confidence: "Medium",
            keyConcerns: [result.rationale],
            recommendedAction: "Compare against the official §23 descriptors on the rubric table and accept or choose differently — the suggestion never commits itself.",
            live: true,
            generatedContent: `Suggested Band ${result.band}\n\n${result.rationale}`,
            promptSent: result.promptSent,
            usage,
          });
          return result;
        } catch (err) {
          const liveError = err instanceof Error ? err.message : String(err);
          ws.pushAIReviewLog({
            agent: "Holistic Band Assessor",
            reviewType: "Checklist",
            subjectId: itemId,
            verdict: "Suggestion failed",
            confidence: "Low",
            keyConcerns: [liveError],
            recommendedAction: "Retry, or judge the band manually against the official rubric table.",
            live: false,
            liveError,
            usage,
          });
          return null;
        } finally {
          set({ busy: null });
        }
      },

      // Tries a live OpenAI call (reusing the same chatComplete client every
      // other AI feature in this app uses) and falls back to the
      // deterministic offline decomposition on any failure or when AI is
      // disabled in Settings. Results land in pendingGenerated so the user
      // can edit/add/remove lines before confirming them into the checklist.
      generateSpecific: async (itemId) => {
        set({ busy: itemId });
        const req = GD4_REQUIREMENTS.find((r) => r.id === itemId)!;
        const aiSettings = useAISettingsStore.getState();
        let raw: GeneratedChecklistLine[];
        let rejectedCount = 0;
        let live = false;
        let liveError: string | undefined;
        let genUsage: AIUsage | undefined;
        let genPromptSent: string | undefined;
        let genRejectedIdeas: { text: string; reason: string }[] | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(useWorkspaceStore.getState().schoolContext) });
            const result = await runLiveChecklistGeneration(req, settings, (u) => { genUsage = u; });
            raw = result.lines;
            rejectedCount = result.rejectedCount;
            genRejectedIdeas = result.rejectedIdeas;
            genPromptSent = result.promptSent;
            if (!raw.length) raw = simulateChecklistGeneration(req);
            else live = true;
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            raw = simulateChecklistGeneration(req);
          }
        } else {
          raw = simulateChecklistGeneration(req);
        }
        let lines: SpecificChecklistLine[] = raw.map((r, i) => ({
          id: `${itemId}-AI${Date.now()}-${i}`,
          text: r.text,
          clause: r.clause,
          sourceType: r.sourceType,
          sourceIndex: r.sourceIndex,
          sourceText: r.sourceText,
          apsrDimension: r.apsrDimension,
          sourceRef: r.sourceRef,
          status: "Not Started" as const,
          evidence: [],
          generatedBy: "ai" as const,
        }));
        lines = applyAfiOverlay(itemId, lines, useWorkspaceStore.getState().customFindings);
        // Log into the shared AI review log so the AI Agent Review screen truly
        // reflects every AI run, including checklist line generation.
        const rejectionNote = rejectedCount > 0
          ? `${rejectedCount} AI-proposed line(s) were rejected — they lacked a traceable official GD4 source and were not added.`
          : undefined;
        useWorkspaceStore.getState().pushAIReviewLog({
          agent: "Checklist Generator",
          reviewType: "Checklist",
          subjectId: itemId,
          verdict: `${lines.length} line${lines.length === 1 ? "" : "s"} drafted`,
          confidence: "Medium",
          keyConcerns: [
            `Proposed ${lines.length} specific testable line(s) for ${itemId}; pending reviewer confirmation.`,
            ...(rejectionNote ? [rejectionNote] : []),
          ],
          recommendedAction: "Review, edit and confirm the generated lines before they count toward the band.",
          live,
          liveError,
          generatedContent: [
            lines.map((l) => `[${l.clause || "—"}] ${l.sourceRef ? `(${l.sourceRef}) ` : ""}${l.text}`).join("\n"),
            genRejectedIdeas && genRejectedIdeas.length > 0
              ? `\n\nREJECTED IDEAS (${genRejectedIdeas.length}):\n${genRejectedIdeas.map((r) => `- ${r.text}\n  Reason: ${r.reason}`).join("\n")}`
              : "",
          ].join(""),
          promptSent: genPromptSent,
          usage: genUsage,
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

      confirmGenerated: (itemId) => {
        const pending = get().entries[itemId]?.pendingGenerated || [];
        const existing = get().entries[itemId]?.specific || [];
        const aiLines = pending.filter((l) => l.generatedBy === "ai");
        if (aiLines.length > 0) {
          const confirmedIds = new Set(pending.map((l) => l.id));
          const removedCount = aiLines.filter((l) => !confirmedIds.has(l.id)).length;
          useWorkspaceStore.getState().logHumanDecision({
            module: "Checklist Line Edit",
            subjectId: itemId,
            aiOutput: `AI generated ${aiLines.length} line(s): ${aiLines.map((l) => l.text.slice(0, 60)).join("; ")}`,
            humanDecision: `Confirmed ${pending.length} line(s)${removedCount > 0 ? `, removed ${removedCount} AI line(s)` : ""}`,
            changed: removedCount > 0 || pending.some((l, i) => l.text !== aiLines[i]?.text),
            decisionType: removedCount > 0 ? "Edited" : "Accepted",
            reason: "",
            field: itemId,
          });
        }
        const allIds = new Set(existing.map((l) => l.id));
        const deduped = pending.filter((l) => !allIds.has(l.id));
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, specific: [...e.specific, ...deduped], pendingGenerated: [] })));
      },

      discardGenerated: (itemId) => set((s) => mapEntry(s, itemId, (e) => ({ ...e, pendingGenerated: [] }))),

      addSpecificLine: (itemId, text, clause) => {
        const trimmed = text.trim();
        if (trimmed.length < 5) return; // ignore blank / near-blank lines
        return set((s) =>
          mapEntry(s, itemId, (e) => ({
            ...e,
            specific: [...e.specific, { id: newLineId(itemId), text: trimmed, clause, status: "Not Started", evidence: [], generatedBy: "manual" }],
          }))
        );
      },

      removeSpecificLine: (itemId, lineId) => set((s) => mapEntry(s, itemId, (e) => ({ ...e, specific: e.specific.filter((l) => l.id !== lineId) }))),

      // Wipe all Layer 2 lines for an item (e.g. to regenerate from scratch).
      // Also clears any unconfirmed pending lines, the saved band record, and
      // the live (unsaved) matrix working state, so the item genuinely resets
      // to "unassessed" rather than leaving a stale band/percentages behind
      // with zero lines to support them (a band with no evidence backing it
      // is meaningless, and computeChecklistOverrides would otherwise keep
      // feeding that stale band into the certification score — a real bug
      // found 2026-07-15).
      clearSpecificLines: (itemId) =>
        set((s) => mapEntry(s, itemId, (e) => ({ ...e, specific: [], pendingGenerated: [], holisticBand: undefined, apsrMatrix: undefined }))),

      setSpecificStatus: (itemId, lineId, status) => {
        const line = get().entries[itemId]?.specific.find((l) => l.id === lineId);
        if (line && line.generatedBy === "ai" && line.status !== status && line.status !== "Not Started") {
          useWorkspaceStore.getState().logHumanDecision({
            module: "Line Status",
            subjectId: itemId,
            aiOutput: `AI set: ${line.status}`,
            humanDecision: status,
            changed: true,
            decisionType: "Overridden",
            reason: "",
            field: lineId,
          });
        }
        set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, status }))));
      },

      setLineApsrDimension: (itemId, lineId, dim) => {
        const line = get().entries[itemId]?.specific.find((l) => l.id === lineId);
        if (line && line.apsrDimension !== dim) {
          useWorkspaceStore.getState().logHumanDecision({
            module: "Checklist Line Edit",
            subjectId: itemId,
            aiOutput: line.apsrDimension ?? "(untagged)",
            humanDecision: dim ?? "(untagged)",
            changed: true,
            decisionType: line.generatedBy === "ai" && line.apsrDimension ? "Overridden" : "Edited",
            reason: "",
            field: lineId,
          });
        }
        set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, apsrDimension: dim }))));
      },

      applyLineDimensionTags: (itemId, tags) => {
        if (tags.length === 0) return;
        const byLineId = new Map(tags.map((t) => [t.lineId, t.dimension]));
        set((s) => mapEntry(s, itemId, (e) => ({
          ...e,
          specific: e.specific.map((l) => (!l.apsrDimension && byLineId.has(l.id) ? { ...l, apsrDimension: byLineId.get(l.id) } : l)),
        })));
      },

      // Drafts evidence metadata (title/type/date/sufficiency/auditorNote)
      // from a pasted link alone, so the human only has to supply the key
      // evidence link — the result lands back in the caller's local draft
      // state and is never written to the entry until "Add evidence" is
      // clicked. Logged to the shared AI review log like every other AI run.
      fillEvidenceFromLink: async (itemId, lineId, link) => {
        set({ busy: `${itemId}:${lineId}:evfill` });
        const lineText = get().entries[itemId]?.specific.find((l) => l.id === lineId)?.text || "";
        const aiSettings = useAISettingsStore.getState();
        let draft: EvidenceFillDraft;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const settings = effectiveSettings(aiSettings, { purpose: "utility", context: composeSchoolContext(useWorkspaceStore.getState().schoolContext) });
            draft = await runLiveEvidenceFill(link, lineText, settings);
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            draft = simulateEvidenceFill(link, lineText);
          }
        } else {
          draft = simulateEvidenceFill(link, lineText);
        }
        useWorkspaceStore.getState().pushAIReviewLog({
          agent: "Evidence Intake Assistant",
          reviewType: "Evidence",
          subjectId: itemId,
          verdict: `Drafted fields for "${draft.title}"`,
          confidence: "Low",
          keyConcerns: [draft.auditorNote],
          recommendedAction: "Review every drafted field before clicking Add evidence — the linked document itself was not read.",
          live: draft.live,
          liveError,
          generatedContent: `Title: ${draft.title}\nType: ${draft.type}\nDate: ${draft.date}\nSufficiency: ${draft.sufficiency}\nAuditor note: ${draft.auditorNote}`,
          promptSent: (draft as { usage?: AIUsage; promptSent?: string }).promptSent,
          usage: (draft as { usage?: AIUsage }).usage,
        });
        set({ busy: null });
        return draft;
      },

      addEvidence: (itemId, lineId, evidence) =>
        set((s) =>
          mapEntry(s, itemId, (e) =>
            mapLine(e, lineId, (l) => ({ ...l, evidence: [...l.evidence, { ...evidence, id: `EV-${Date.now()}-${l.evidence.length}` }] }))
          )
        ),

      replaceAuditEvidence: (itemId, lineId, evidence) =>
        set((s) =>
          mapEntry(s, itemId, (e) =>
            mapLine(e, lineId, (l) => ({
              ...l,
              // Keep manual evidence (no runId); discard prior auto-audit items.
              evidence: [
                ...l.evidence.filter((ev) => !ev.runId),
                { ...evidence, id: `EV-${Date.now()}-${l.evidence.filter((ev) => !ev.runId).length}` },
              ],
            }))
          )
        ),

      applyOutcomeReviewLegs: (updates) => {
        let applied = 0;
        set((s) => {
          let entries = s.entries;
          for (const u of updates) {
            const entry = entries[u.itemId];
            const line = entry?.specific.find((l) => l.id === u.lineId);
            if (!entry || !line) continue;
            const evIdx = line.evidence.findIndex((ev) => ev.apsr);
            if (evIdx < 0) continue; // never-audited line: no APSR snapshot to update
            applied++;
            const specific = entry.specific.map((l) =>
              l.id !== u.lineId
                ? l
                : {
                    ...l,
                    evidence: l.evidence.map((ev, i) =>
                      i === evIdx && ev.apsr
                        ? { ...ev, apsr: { ...ev.apsr, systemsOutcomes: u.systemsOutcomes, review: u.review } }
                        : ev
                    ),
                  }
            );
            entries = { ...entries, [u.itemId]: { ...entry, specific } };
          }
          return { entries };
        });
        return applied;
      },

      updateEvidence: (itemId, lineId, evidenceId, patch) => {
        if ("sufficiency" in patch) {
          const ev = get().entries[itemId]?.specific.find((l) => l.id === lineId)?.evidence.find((e) => e.id === evidenceId);
          if (ev && ev.sufficiency !== patch.sufficiency) {
            useWorkspaceStore.getState().logHumanDecision({
              module: "Evidence Sufficiency",
              subjectId: itemId,
              aiOutput: `AI assessed: ${ev.sufficiency ?? "unset"}`,
              humanDecision: patch.sufficiency as string,
              changed: true,
              decisionType: "Overridden",
              reason: "",
              field: lineId,
            });
          }
        }
        set((s) =>
          mapEntry(s, itemId, (e) =>
            mapLine(e, lineId, (l) => ({ ...l, evidence: l.evidence.map((ev) => (ev.id === evidenceId ? { ...ev, ...patch } : ev)) }))
          )
        );
      },

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

      applyOptionAWrites: (writes) => {
        let written = 0;
        set((s) => {
          const entries = { ...s.entries };
          for (const w of writes) {
            const entry = entries[w.gd4ItemId] ?? emptyEntry(w.gd4ItemId);
            // A newLine write can race a line created AFTER it was built — a
            // hybrid write queued at the gate, then a line for the same ref
            // landing first (compile, a manual add). Blindly appending then
            // duplicated the line on accept, so match by the same normalized
            // sourceRef-or-clause rule buildOptionALineWrites uses and update
            // the existing line instead.
            const newRef = w.newLine ? normalizeAuditRef(w.newLine.sourceRef ?? w.newLine.clause ?? "") : "";
            const targetLineId =
              w.existingLineId ??
              (newRef
                ? entry.specific.find(
                    (l) => (l.sourceRef && normalizeAuditRef(l.sourceRef) === newRef) || (l.clause && normalizeAuditRef(l.clause) === newRef)
                  )?.id
                : undefined);
            if (targetLineId) {
              const specific = entry.specific.map((l) =>
                l.id === targetLineId
                  ? {
                      ...l,
                      status: w.status,
                      // Same rule as replaceAuditEvidence: keep manual
                      // evidence (no runId), replace prior audit items.
                      evidence: [
                        ...l.evidence.filter((ev) => !ev.runId),
                        { ...w.evidence, id: `EV-${Date.now()}-${written}-${l.evidence.filter((ev) => !ev.runId).length}` },
                      ],
                    }
                  : l
              );
              entries[w.gd4ItemId] = { ...entry, specific };
            } else if (w.newLine) {
              const line: SpecificChecklistLine = {
                id: newLineId(w.gd4ItemId),
                text: w.newLine.text,
                clause: w.newLine.clause,
                sourceRef: w.newLine.sourceRef,
                generatedBy: w.newLine.generatedBy,
                status: w.status,
                evidence: [{ ...w.evidence, id: `EV-${Date.now()}-${written}-0` }],
              };
              entries[w.gd4ItemId] = { ...entry, specific: [...entry.specific, line] };
            } else {
              continue;
            }
            written++;
          }
          return { entries };
        });
        return written;
      },

      // The only place a draft finding is ever written to the Findings
      // module — only called from an explicit "Save to findings register"
      // button click, never automatically, per the spec's requirement.
      confirmDraftFinding: (itemId, lineId, draft, auditRunId?) => {
        const s = get();
        const line = s.entries[itemId]?.specific.find((l) => l.id === lineId);
        if (!line || line.draftFinding?.savedFindingId) return;
        // Composite-key dedupe (gd4ItemId + normalized ref + finding type):
        // if the register already holds a finding for this exact requirement
        // gap — whichever pipeline raised it — link the line to it instead of
        // creating a double.
        const dedupeKey = findingDedupeKey(draft.gd4ItemId, line.sourceRef ?? draft.clause, draft.findingType);
        if (dedupeKey) {
          const existing = useWorkspaceStore.getState().customFindings.find((f) => findingKeyOf(f) === dedupeKey);
          if (existing) {
            set((st) => mapEntry(st, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, draftFinding: { ...draft, savedFindingId: existing.id } }))));
            return;
          }
        }
        // Type-blind second pass (R9 fix, 2026-07-16): the typed key above
        // treats an NC and an OFI on the same requirement point as different
        // findings, so a verdict-class change between audit passes raised a
        // sibling finding for the same gap. If an OPEN NC/OFI already covers
        // this exact gap (item + normalised ref, via carryoverKey), do NOT
        // create a second finding: relink the line and flag the existing
        // finding for human review. Never auto-relabel or auto-close; the
        // human decides. OBS never suppresses (findOpenFindingForGap).
        const sameGap = findOpenFindingForGap(useWorkspaceStore.getState().customFindings, draft.gd4ItemId, line.sourceRef ?? draft.clause);
        if (sameGap) {
          if (!(sameGap.observation ?? "").includes(CLASSIFICATION_REVIEW_MARKER)) {
            const note = classificationReviewNote(resolveFindingType(sameGap), draft.findingType);
            useWorkspaceStore.getState().updateCustomFinding(sameGap.id, { observation: sameGap.observation ? `${note}\n\n${sameGap.observation}` : note });
          }
          set((st) => mapEntry(st, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, draftFinding: { ...draft, savedFindingId: sameGap.id } }))));
          return;
        }
        const finding: Finding = {
          id: newFindingId(),
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
          source: "Checklist",
          createdAt: new Date().toISOString(),
          auditRunId: auditRunId ?? draft.auditRunId,
          dimension: draft.dimension,
          riskCategory: draft.riskCategory,
          clause: draft.clause,
          observation: draft.observation,
          criteria: draft.criteria,
          effect: draft.effect,
          rootCause: draft.rootCause,
          corrective: draft.corrective,
          preventive: draft.preventive,
          apsr: lineApsr(line),
          findingType: draft.findingType,
          ncSeverity: draft.ncSeverity,
          // Stamp the source ref so the register-wide composite dedupe key
          // (see lib/gd4Refs.ts) can identify this finding from either
          // pipeline; clause is the fallback for ref-less manual lines.
          linkedSourceRefs: line.sourceRef ? [line.sourceRef] : undefined,
        };
        useWorkspaceStore.getState().addCustomFinding(finding);
        set((st) => mapEntry(st, itemId, (e) => mapLine(e, lineId, (l) => ({ ...l, draftFinding: { ...draft, savedFindingId: finding.id } }))));
      },

      // Automation: turn every unresolved checklist line into a draft AFI in
      // one click. A line warrants a finding when it is Not met, or when it is
      // marked Met/Partial but no real evidence backs it (sufficiency Missing —
      // the "false pass" the audit caps to Band 1). Reuses confirmDraftFinding
      // so each finding is deduped and traceable exactly like a manual one.
      raiseAllUnmetFindings: (auditRunId?, opts?) => {
        const entries = get().entries;
        let raised = 0;
        // Scope: when a folder audit passes its sub-criterion, only that
        // sub-criterion's items are swept — so auditing 6.3 never raises a
        // leftover-unmet 7.1 line and attributes it to the 6.3 run.
        const scopeSubId = opts?.subCriterionId;
        const inScope = (itemId: string) => {
          if (!scopeSubId) return true;
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          return req?.subCriterionId === scopeSubId;
        };
        // Composite keys (gd4ItemId + normalized ref + finding type) of every
        // finding already in the register — a requirement gap the other
        // pipeline already raised is skipped, not doubled. The old
        // "gd4ItemId:issue-prefix" text key is kept only as the fallback for
        // ref-less manual lines, where no stable composite key exists.
        const existingKeys = new Set<string>();
        for (const f of useWorkspaceStore.getState().customFindings) {
          const k = findingKeyOf(f);
          if (k) existingKeys.add(k);
          existingKeys.add(`${f.gd4ItemId}:${f.issue.slice(0, 60)}`);
        }
        for (const itemId of Object.keys(entries)) {
          if (!inScope(itemId)) continue;
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          if (!req) continue;
          for (const line of entries[itemId].specific) {
            if (line.draftFinding?.savedFindingId) continue;
            const markedDone = line.status === "Met" || line.status === "Partial";
            const warrants = line.status === "Not met" || (markedDone && lineSufficiency(line) === "Missing");
            if (!warrants) continue;
            const draft = buildDraftFinding(req, line);
            const dupKey =
              findingDedupeKey(itemId, line.sourceRef ?? draft.clause, draft.findingType) ??
              `${itemId}:${draft.issue.slice(0, 60)}`;
            if (existingKeys.has(dupKey)) continue; // already raised — skip, don't double
            existingKeys.add(dupKey);
            const before = useWorkspaceStore.getState().customFindings.length;
            get().confirmDraftFinding(itemId, line.id, draft, auditRunId);
            // confirmDraftFinding stamps the new finding id onto the line — use
            // it to pre-fill the closure with the derived root cause / corrective
            // / preventive, so the AFI reads deep from the moment it is raised.
            // Seed + count ONLY when a finding was actually created: the
            // type-blind dedupe (R9 fix) can relink to an existing finding
            // instead, and seeding that one's closure would overwrite its
            // draft (same created-gate the Option A compile already uses).
            const savedId = get().entries[itemId]?.specific.find((l) => l.id === line.id)?.draftFinding?.savedFindingId;
            if (savedId && useWorkspaceStore.getState().customFindings.length > before) {
              useWorkspaceStore.getState().seedClosure(savedId, { root: draft.rootCause, corr: draft.corrective, prev: draft.preventive });
              raised += 1;
            }
          }
        }
        return raised;
      },

      clearSavedFindingId: (findingId) =>
        set((s) => {
          const entries = { ...s.entries };
          for (const itemId of Object.keys(entries)) {
            const specific = entries[itemId].specific.map((l) =>
              l.draftFinding?.savedFindingId === findingId
                ? { ...l, draftFinding: { ...l.draftFinding, savedFindingId: undefined } }
                : l
            );
            if (specific !== entries[itemId].specific) entries[itemId] = { ...entries[itemId], specific };
          }
          return { entries };
        }),

      setLineSavedFindingId: (itemId, lineId, findingId) =>
        set((s) => mapEntry(s, itemId, (e) => mapLine(e, lineId, (l) => ({
          ...l,
          draftFinding: {
            gd4ItemId: itemId,
            issue: "",
            severity: "Medium" as const,
            suggestedAction: "",
            ...(l.draftFinding ?? {}),
            savedFindingId: findingId,
          },
        })))),
    }),
    {
      name: "ucc-gd4-checklist:v2",
      storage: workspaceStorage,
      // v1: the GD4 sub-criterion re-align removed/renamed items (7.2.x →
      // 7.1.2–7.1.5, then collapsed into 7.1.1). This store is keyed by
      // gd4ItemId; entries for an item id that no longer exists are parentless
      // dead storage (never rendered — the UI iterates GD4_REQUIREMENTS — but
      // worth clearing). Drop any entry whose id is not a current item.
      version: 2,
      migrate: (persisted, fromVersion) => {
        let s = persisted as ChecklistModuleState;
        if (!s || !s.entries) return s;
        // v0 -> v1: drop entries whose id is not a current GD4 item.
        if (fromVersion < 1) {
          const validItem = new Set(GD4_REQUIREMENTS.map((r) => r.id));
          s = { ...s, entries: Object.fromEntries(Object.entries(s.entries).filter(([id]) => validItem.has(id))) };
        }
        // v1 -> v2: carry every stored line ref over the 6.1.1.DS1.c split
        // (see migrateDs1Ref) so a line keyed to the old DS1.d/e/f follows its
        // content to the new e/f/g instead of resolving to the wrong point.
        if (fromVersion < 2) {
          const migLine = (l: SpecificChecklistLine): SpecificChecklistLine => ({
            ...l,
            ...(l.clause ? { clause: migrateDs1Ref(l.clause) } : {}),
            ...(l.sourceRef ? { sourceRef: migrateDs1Ref(l.sourceRef) } : {}),
          });
          s = {
            ...s,
            entries: Object.fromEntries(Object.entries(s.entries).map(([id, e]) => [id, {
              ...e,
              specific: (e.specific ?? []).map(migLine),
              pendingGenerated: (e.pendingGenerated ?? []).map(migLine),
            }])),
          };
        }
        return s;
      },
    }
  )
);
