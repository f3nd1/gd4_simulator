// Review-panel helpers — pure, no AI/store imports, so the perspectives,
// gating, cost estimate and finding hash are unit-testable. The AI calls
// themselves live in agentRuntime.runAuditorPanel.

import type { AuditorProfile, Finding, PanelReviewMode, ReviewPerspective } from "../types";
import { resolveFindingType, resolveNcSeverity } from "./findingClassification";

export const REVIEW_PERSPECTIVES: Array<{ value: ReviewPerspective; label: string; guidance: string }> = [
  {
    value: "strict-auditor",
    label: "Strict Auditor",
    guidance:
      "Sceptical, evidence-based and clause-focused. Check whether the requirement is clearly defined, whether the evidence is sufficient, whether the gap is real, and whether the finding is valid. Separate fact from opinion and do not accept assertion in place of evidence.",
  },
  {
    value: "optimistic-process-owner",
    label: "Optimistic Process Owner",
    guidance:
      "Practical and improvement-focused. Consider what already works informally, whether this is mainly a documentation gap rather than a real practice failure, and whether the proposed action is realistic. Prevent overstatement of the finding.",
  },
  {
    value: "risk-challenger",
    label: "Risk Challenger",
    guidance:
      "Worst-case oriented. Test the impact, the recurrence risk, the compliance exposure, the control weakness, and the consequence if this is left unaddressed. Help decide the correct severity.",
  },
  {
    value: "academic-qa-guardian",
    label: "Academic / QA Guardian",
    guidance:
      "Focused on academic standards, student outcomes, assessment integrity, learning support and consistency. Check the impact on academic quality, student progression and fairness.",
  },
  {
    value: "management-reviewer",
    label: "Management Reviewer",
    guidance:
      "Focused on accountability, ownership, timeline, resources, KPI impact, governance and closure evidence. Judge whether management intervention is needed and whether the action is implementable and verifiable.",
  },
];

const BY_VALUE = new Map(REVIEW_PERSPECTIVES.map((p) => [p.value, p]));

export const DEFAULT_PERSPECTIVE: ReviewPerspective = "strict-auditor";

export function perspectiveOf(a: Pick<AuditorProfile, "reviewPerspective">): ReviewPerspective {
  return a.reviewPerspective ?? DEFAULT_PERSPECTIVE;
}
export function perspectiveLabel(p: ReviewPerspective): string {
  return BY_VALUE.get(p)?.label ?? p;
}
export function perspectiveGuidance(p: ReviewPerspective): string {
  return BY_VALUE.get(p)?.guidance ?? "";
}

// A valid panel is 2 to 5 selected auditor profiles. Returns the ordered
// subset (max 5) of auditors whose ids are selected.
export const MIN_PANEL = 2;
export const MAX_PANEL = 5;
export function assemblePanel(auditors: AuditorProfile[], panelIds: string[]): AuditorProfile[] {
  const set = new Set(panelIds);
  return auditors.filter((a) => set.has(a.id)).slice(0, MAX_PANEL);
}
export function isValidPanel(auditors: AuditorProfile[], panelIds: string[]): boolean {
  const n = assemblePanel(auditors, panelIds).length;
  return n >= MIN_PANEL && n <= MAX_PANEL;
}

// Whether the panel should run AUTOMATICALLY for this finding under the mode.
// "on-demand" and "off" never auto-run (off also blocks the manual button).
export function shouldAutoRunPanel(mode: PanelReviewMode, finding: Finding): boolean {
  if (mode === "all") return true;
  if (mode === "nc-major-auto") {
    return resolveFindingType(finding) === "NC" && resolveNcSeverity(finding) === "Major";
  }
  return false; // off, on-demand
}

// Cost estimate scaled to panel size and finding count: one call per
// panellist plus one synthesis per finding.
export function panelCostEstimate(panelSize: number, findingCount: number): { perFinding: number; total: number; text: string } {
  const perFinding = panelSize + 1;
  const total = perFinding * findingCount;
  return {
    perFinding,
    total,
    text: `⚠ Each panel review runs one AI call per panel auditor plus one synthesis. A ${panelSize}-auditor panel is ${perFinding} calls per finding; ${findingCount} finding${findingCount === 1 ? "" : "s"} ≈ ${total} calls. Use for final pre-audit passes.`,
  };
}

// Stable, cheap hash of the finding text a review ran against, so the cache
// can tell when the finding has materially changed and offer a re-run.
export function findingReviewHash(f: Pick<Finding, "issue" | "observation" | "criteria" | "evidenceStatusSummary" | "findingType" | "ncSeverity">): string {
  const src = [f.issue, f.observation, f.criteria, f.evidenceStatusSummary, f.findingType, f.ncSeverity].filter(Boolean).join("¦");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
