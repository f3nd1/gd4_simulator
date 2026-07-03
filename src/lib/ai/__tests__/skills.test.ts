import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../skills";

// Batch 6 Group C: the four previously-orphaned skill files must actually
// reach the model. BASE skills appear in EVERY module's prompt; the other
// three appear in their assigned modules.
describe("skill injection", () => {
  it("sg-pei-context.md (SSG hard requirements) is in the BASE layer — present in every built prompt", () => {
    for (const module of ["checklistScoring", "evidenceReview", "findingWriter", "afiClosure", "bandRecommend", "evidenceTracking", "interviewFieldwork"] as const) {
      const prompt = buildSystemPrompt(module);
      expect(prompt, `module ${module}`).toContain("=== SKILL: sg-pei-context.md ===");
      expect(prompt, `module ${module}`).toContain("Fee Protection Scheme");
    }
  });

  it("band-calibration.md reaches checklistScoring and bandRecommend", () => {
    expect(buildSystemPrompt("checklistScoring")).toContain("=== SKILL: band-calibration.md ===");
    expect(buildSystemPrompt("bandRecommend")).toContain("=== SKILL: band-calibration.md ===");
  });

  it("risk-and-remediation.md reaches findingWriter and afiClosure", () => {
    expect(buildSystemPrompt("findingWriter")).toContain("=== SKILL: risk-and-remediation.md ===");
    expect(buildSystemPrompt("afiClosure")).toContain("=== SKILL: risk-and-remediation.md ===");
  });

  it("consultant-insights.md reaches bandRecommend", () => {
    expect(buildSystemPrompt("bandRecommend")).toContain("=== SKILL: consultant-insights.md ===");
  });
});
