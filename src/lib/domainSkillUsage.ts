// Which AI calls actually receive a criterion's domain-expertise checklist.
//
// Shown on the Audit Checklist Library page so the answer to "if I edit this,
// what changes?" is visible rather than folklore. The `fn` list is NOT
// hand-maintained trivia: __tests__/domainSkillUsage.test.ts re-derives it by
// scanning the real call sites of domainExpertiseFor() in the engine and fails
// if this list drifts, so adding a 15th consumer breaks the build until it is
// listed here.
//
// `surface` is the one thing a grep cannot know (which button a user presses),
// so it is annotation — but it can only ever be attached to a call site that
// genuinely exists.

export type DomainSkillConsumer = {
  fn: string;
  file: string;
  surface: string;
};

export const DOMAIN_SKILL_CONSUMERS: DomainSkillConsumer[] = [
  { fn: "runPPDRequirementsReview", file: "src/lib/ai/agentRuntime.ts", surface: "PPD + Evidence Review → PPD Review tab (Option A policy pass)" },
  { fn: "runEvidenceAssessment", file: "src/lib/ai/agentRuntime.ts", surface: "PPD + Evidence Review → Evidence tab (Option A evidence pass)" },
  { fn: "runStagedPolicyAudit", file: "src/lib/ai/agentRuntime.ts", surface: "Evidence Folder → Run audit (Option B, policy pass)" },
  { fn: "runStagedEvidenceAudit", file: "src/lib/ai/agentRuntime.ts", surface: "Evidence Folder → Run audit (Option B, evidence pass)" },
  { fn: "runStagedOutcomeReviewAudit", file: "src/lib/ai/agentRuntime.ts", surface: "Evidence Folder → Run audit (Option B, outcome/review pass)" },
  { fn: "runLiveFolderAuditBatch", file: "src/lib/ai/agentRuntime.ts", surface: "Evidence Folder → full folder audit batch" },
  { fn: "runLiveChecklistGeneration", file: "src/lib/ai/agentRuntime.ts", surface: "Sub-Criterion Checklist → Suggest checklist lines" },
  { fn: "runHolisticBandSuggestion", file: "src/lib/ai/agentRuntime.ts", surface: "Sub-Criterion Checklist → Suggest APSR scores" },
  { fn: "runLiveFindingObservation", file: "src/lib/ai/agentRuntime.ts", surface: "Findings → AI draft finding body" },
  { fn: "runLiveGroupedFindingWriter", file: "src/lib/ai/findingWriter.ts", surface: "Findings → Generate grouped findings" },
  { fn: "runLiveClosureDraft", file: "src/lib/ai/agentRuntime.ts", surface: "Quality Action / AFI → Suggest actions (AI)" },
  { fn: "runLiveClosureReview", file: "src/lib/ai/agentRuntime.ts", surface: "Quality Action / AFI → AI closure review" },
  { fn: "runLiveItemReview", file: "src/lib/ai/agentRuntime.ts", surface: "Evidence Intelligence → per-agent run AI" },
  { fn: "runAuditorPanel", file: "src/lib/ai/agentRuntime.ts", surface: "Auditor Review Panel" },
];

// The files the test scans. Kept here so the constant and its guard cannot
// disagree about where to look.
export const DOMAIN_SKILL_SOURCE_FILES = ["src/lib/ai/agentRuntime.ts", "src/lib/ai/findingWriter.ts"];
