// Review-panel helpers — pure, no AI/store imports, so the perspectives,
// gating, cost estimate and finding hash are unit-testable. The AI calls
// themselves live in agentRuntime.runAuditorPanel.

import type { AuditorProfile, Finding, PanelAuditorReview, PanelReviewMode, ReviewPerspective } from "../types";
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

// Cost estimate scaled to panel size and finding count. Best case (panellists
// agree) is one call per panellist plus one synthesis. Worst case (they
// disagree) adds a Round-2 rebuttal call per panellist, so ≈ 2×panel + 1.
export function panelCostEstimate(panelSize: number, findingCount: number): { perFinding: number; perFindingMax: number; total: number; totalMax: number; text: string } {
  const perFinding = panelSize + 1;
  const perFindingMax = panelSize * 2 + 1;
  const total = perFinding * findingCount;
  const totalMax = perFindingMax * findingCount;
  return {
    perFinding,
    perFindingMax,
    total,
    totalMax,
    text: `⚠ Each panel review runs one AI call per panel auditor plus one synthesis. If the panellists disagree, a rebuttal round adds one more call each. A ${panelSize}-auditor panel is ${perFinding} calls per finding (up to ${perFindingMax} when they disagree); ${findingCount} finding${findingCount === 1 ? "" : "s"} ≈ ${total}–${totalMax} calls. Use for final pre-audit passes.`,
  };
}

// Normalise a free-text position field to a comparable token. Maps common
// synonyms so "No issue" / "none" / "not a finding" collapse together and
// "Non-conformity" / "NC" collapse together.
function normClassification(s: string): string {
  const t = (s || "").toLowerCase().trim();
  if (!t) return "";
  // Check non-conformity BEFORE the "compliant/conform" none-pattern, since
  // "non-conformity" contains "conform".
  if (/(non-?conformity|non-?conformance|non-?compliance)/.test(t)) return "nc";
  if (/(no issue|no finding|not a finding|not an issue|none|compliant|conform|satisfactor|met\b)/.test(t)) return "none";
  if (/\bnc\b/.test(t)) return "nc";
  if (/\bcar\b/.test(t)) return "nc"; // corrective action request ≈ NC severity
  if (/ofi|opportunity/.test(t)) return "ofi";
  if (/obs|observation/.test(t)) return "observation";
  if (/improve/.test(t)) return "ofi";
  return t;
}
function normSeverity(s: string): string {
  const t = (s || "").toLowerCase().trim();
  if (!t) return "";
  if (/(major|high|critical|serious)/.test(t)) return "major";
  if (/(minor|low|slight)/.test(t)) return "minor";
  if (/(medium|moderate)/.test(t)) return "medium";
  if (/(none|nil|n\/a|not applicable)/.test(t)) return "none";
  return t;
}
function normRootDir(s: string): string {
  const t = (s || "").toLowerCase().trim();
  if (!t) return "";
  if (/(document|record|policy|procedure|written)/.test(t)) return "documentation";
  if (/(train|competen|awareness|skill)/.test(t)) return "training";
  if (/(data|record-keeping|collection|tracking)/.test(t)) return "data";
  if (/(review|monitor|oversight|audit|governance)/.test(t)) return "review";
  if (/(process|control|workflow|step|system)/.test(t)) return "process";
  if (/(none|no root|not applicable|n\/a)/.test(t)) return "none";
  return t;
}

// Do the panellists' Round-1 positions MATERIALLY disagree? True when they
// split on classification (some see a finding, others none, or NC vs OFI vs
// observation), on severity (major vs minor), or on root-cause direction
// (two clearly different named directions). Blank/failed positions are ignored.
// A disagreement means Round 2 (rebuttal) runs before synthesis.
export function detectPanelDisagreement(reviews: Pick<PanelAuditorReview, "position" | "failed">[]): {
  disagree: boolean;
  reasons: string[];
} {
  const positions = reviews.filter((r) => !r.failed && r.position).map((r) => r.position!);
  if (positions.length < 2) return { disagree: false, reasons: [] };
  const reasons: string[] = [];

  const classes = new Set(positions.map((p) => normClassification(p.classification)).filter(Boolean));
  if (classes.size > 1) reasons.push(`Classification split: ${[...classes].join(" vs ")}.`);

  const sevs = new Set(positions.map((p) => normSeverity(p.severity)).filter((s) => s && s !== "none"));
  if (sevs.has("major") && (sevs.has("minor") || sevs.has("medium"))) {
    reasons.push(`Severity split: ${[...sevs].join(" vs ")}.`);
  }

  const dirs = new Set(positions.map((p) => normRootDir(p.rootCauseDirection)).filter((d) => d && d !== "none"));
  if (dirs.size > 1) reasons.push(`Root-cause direction split: ${[...dirs].join(" vs ")}.`);

  return { disagree: reasons.length > 0, reasons };
}

// Stable, cheap hash of the finding text a review ran against, so the cache
// can tell when the finding has materially changed and offer a re-run.
export function findingReviewHash(f: Pick<Finding, "issue" | "observation" | "criteria" | "evidenceStatusSummary" | "findingType" | "ncSeverity">): string {
  const src = [f.issue, f.observation, f.criteria, f.evidenceStatusSummary, f.findingType, f.ncSeverity].filter(Boolean).join("¦");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
