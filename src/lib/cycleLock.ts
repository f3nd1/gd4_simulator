// Write barrier for a Locked cycle.
//
// lockCycle() used to be a status label plus a snapshot, never a barrier: of
// the 111 workspace actions, zero read cycle.status, and the only enforcement
// anywhere was `disabled={locked}` on ten widgets across the three pages
// written at the same time as lockCycle. Every page authored since simply
// never learned the concept existed, so a locked cycle could still have its
// findings deleted, its checklist verdicts rewritten and its folders
// re-audited, while the header kept reading "Locked" and the Final Report
// exported the new numbers under the locked version label.
//
// The fix is one interception point per store rather than a rule each new page
// has to remember. Blocking is by explicit NAME so it stays reviewable, and
// the lists deliberately hold only actions that change audit substance and
// return nothing: export, restore, duplicate, unlock, save-as-version and
// every pure UI-state action stay open, and no caller can be handed an
// `undefined` where it expected a count.

export const LOCKED_CYCLE_MESSAGE =
  "This cycle is Locked, so the audit record cannot be changed. Open Draft Workspace and use \"Unlock (admin)\" if you genuinely need to reopen it.";

export const LOCKED_WORKSPACE_ACTIONS = [
  // Cycle + dataset level
  "updateCycle", "loadDemoDataset", "clearSampleData", "createNewCycle",
  // Scores, justifications, confirmations
  "setReviewerScore", "setJustify", "confirmScore", "clearReviewerOverride", "setAgentStrictness", "runItemAI",
  // Closures / corrective action
  "setClosureField", "toggleClosureFramework", "seedClosure", "runClosureAI", "draftClosureActions",
  "setClosureHuman", "confirmClosureEffectiveness", "clearAllClosures",
  // Team
  "addAuditor", "updateAuditor", "removeAuditor", "loadPresetAuditors",
  "addDepartment", "updateDepartment", "removeDepartment", "resetDepartments",
  // Evidence folders and every audit entry point
  "setFolderField", "probeFolder", "auditFolderContents", "auditFolderStaged",
  "auditAllFolders", "auditChangedFolders", "runFullAudit", "runHybridItemDraft",
  "runPPDReview", "runEvidenceAssessment", "runOutcomeReviewPass",
  "runFindingPanelReview", "applyPanelConclusion", "runClarificationRound", "clearClarificationRounds",
  "resolvePendingItem", "acceptAllPending", "discardPendingRun",
  // School-wide context fed into every prompt
  "setAdditionalInfoLink", "setSchoolContextText", "setSchoolContextLink",
  "setSchoolContextEnabled", "readSchoolContextFromDrive", "togglePreAnalysisCheck",
  // Sampling and interviews
  "setSamples", "toggleSample", "setSampleOutcome", "setInterviewQuestions", "setQuestionReadiness",
  // Findings
  "addCustomFinding", "updateCustomFinding", "setNcSeverity", "removeCustomFinding",
  "recheckFinding", "clearAllFindings", "clearFindingsForSubCriterion",
  // Report narrative written into the record
  "writeReportNarratives", "setReportAiSuggestions", "setReportConciseFindings", "setReportDimensionNarratives",
  // Audit trail — a locked cycle's logs are the record itself
  "clearAIReviewLog", "clearHumanDecisionLog", "clearAuditJournal", "removeRunLogEntry", "clearRunLog",
  // Calibration memories reach every future prompt
  "addCalibrationMemory", "updateMemoryStatus", "toggleCalibrationIncluded",
] as const;

export const LOCKED_CHECKLIST_ACTIONS = [
  "ensureEntry", "replaceAllEntries", "loadDemoChecklistData",
  "setHolisticBand", "clearHolisticBand", "clearApsrMatrix", "setApsrMatrix",
  "generateSpecific", "updatePendingLine", "removePendingLine", "addPendingLine",
  "confirmGenerated", "discardGenerated",
  "addSpecificLine", "removeSpecificLine", "clearSpecificLines", "setSpecificStatus",
  "setLineApsrDimension", "applyLineDimensionTags",
  "addEvidence", "replaceAuditEvidence", "updateEvidence", "removeEvidence", "reuseEvidence",
  "setSampling", "confirmDraftFinding", "setLineSavedFindingId",
] as const;

export const LOCKED_FINDING_DRAFT_ACTIONS = [
  "generateFindingsFromChecklist", "confirmGroupedDraft", "discardDraft",
  "discardAllDrafts", "resetAllDrafts", "downgradeConfirmedDrafts", "updateDraftField",
] as const;

type StoreApi<T> = { getState: () => T; setState: (patch: Partial<T>) => void };

// Replaces the named actions in a store's state with versions that no-op while
// `locked()` is true. Functions are not persisted, so patching them in once at
// module load is safe; `onBlocked` surfaces the reason (never silent).
export function installCycleLock<T extends object>(
  api: StoreApi<T>,
  names: readonly string[],
  locked: () => boolean,
  onBlocked: () => void,
): void {
  const state = api.getState() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const name of names) {
    const original = state[name];
    if (typeof original !== "function") continue;
    patch[name] = (...args: unknown[]) => {
      if (locked()) { onBlocked(); return undefined; }
      return (original as (...a: unknown[]) => unknown)(...args);
    };
  }
  api.setState(patch as Partial<T>);
}
