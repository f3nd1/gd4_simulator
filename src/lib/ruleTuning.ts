// Tunable rules layer — a SAFE, bounded set of editable assessment guidance
// injected into the AI prompts at a defined point. Only two fields are
// editable (Met/Partial/Not-met decision rules and per-criterion guidance);
// the core instructions, output schema, citation rules and safety rules stay
// fixed in agentRuntime and are never exposed here. Pure + store-free so the
// injection builder, the change summary and the score comparison are
// unit-tested; the store and the prompt call sites consume these.

export type RuleContent = {
  // Global Met/Partial/Not-met decision guidance (applies to every criterion).
  metPartial: string;
  // Optional per-criterion Met/Partial override (criterion id "1".."7").
  perCriterionMetPartial: Record<string, string>;
  // Free-text extra guidance per criterion, injected for that criterion's calls.
  perCriterionGuidance: Record<string, string>;
};

export type RuleVersion = {
  id: string;
  createdAt: string; // ISO
  label?: string;
  // Plain-English summary of what changed vs the previous active version.
  changeSummary?: string;
  content: RuleContent;
  isOriginal?: boolean;
  // Scores recorded from tests run WHILE this version was active — the
  // feedback loop. Null when a test type has not been run for this version.
  consistencyPct?: number | null;
  benchmarkCaught?: number | null;
  benchmarkTotal?: number | null;
};

export type RuleChangeEntry = {
  at: string; // ISO
  action: "save" | "revert" | "champion";
  versionId: string;
  detail: string;
};

// The original/default baseline injects NOTHING, so a fresh workspace behaves
// exactly as before this feature — tuning is purely additive.
export const DEFAULT_RULE_CONTENT: RuleContent = {
  metPartial: "",
  perCriterionMetPartial: {},
  perCriterionGuidance: {},
};

export const CRITERION_IDS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const CRITERION_LABELS: Record<string, string> = {
  "1": "C1 Governance & Finance", "2": "C2 Corporate Admin", "3": "C3 Recruitment & Agents",
  "4": "C4 Student Protection", "5": "C5 Academic", "6": "C6 Quality Assurance", "7": "C7 Outcomes & Data",
};

// Sub-criterion id ("6.2") or criterion id ("6") → criterion id ("6").
export function criterionOf(id: string): string {
  return String(id).split(".")[0];
}

// Builds the injectable block for one criterion. Clearly labelled with its
// scope and an explicit statement that core rules win on conflict. Returns ""
// when there is nothing to inject (so the original baseline is a no-op).
export function buildRuleInjection(content: RuleContent, criterionId?: string): string {
  const crit = criterionId ? criterionOf(criterionId) : undefined;
  const met = (crit && content.perCriterionMetPartial[crit]?.trim()) || content.metPartial.trim();
  const metScope = crit && content.perCriterionMetPartial[crit]?.trim() ? `Criterion ${crit}` : "all criteria";
  const guidance = crit ? (content.perCriterionGuidance[crit]?.trim() || "") : "";
  if (!met && !guidance) return "";

  const parts: string[] = [];
  parts.push(`=== TUNABLE ASSESSMENT RULES (added to the assessment prompt for ${crit ? `Criterion ${crit}` : "all criteria"}) ===`);
  parts.push(`These REFINE the Met/Partial/Not-met decision only. They do NOT override the core instructions, output schema, citation rules or safety rules above — on ANY conflict, the core rules win.`);
  if (met) parts.push(`Met/Partial/Not-met guidance (${metScope}):\n${met}`);
  if (guidance) parts.push(`Additional guidance for Criterion ${crit}:\n${guidance}`);
  parts.push(`=== END TUNABLE RULES ===`);
  return "\n\n" + parts.join("\n\n");
}

// Plain-English summary of what changed between two rule contents.
export function changeSummaryOf(prev: RuleContent, next: RuleContent): string {
  const bits: string[] = [];
  const stricterHint = (a: string, b: string): string => {
    // Heuristic: longer text with more "only/must/never" tends to be stricter.
    const cue = (s: string) => (s.match(/\b(only|must|never|exactly|all|every)\b/gi) || []).length;
    if (!a.trim() && b.trim()) return " (added)";
    if (a.trim() && !b.trim()) return " (cleared)";
    if (cue(b) > cue(a)) return " (stricter)";
    if (cue(b) < cue(a)) return " (looser)";
    return " (reworded)";
  };
  if (prev.metPartial.trim() !== next.metPartial.trim()) bits.push(`global Met/Partial rule${stricterHint(prev.metPartial, next.metPartial)}`);
  for (const c of CRITERION_IDS) {
    if ((prev.perCriterionMetPartial[c] || "").trim() !== (next.perCriterionMetPartial[c] || "").trim())
      bits.push(`C${c} Met/Partial rule${stricterHint(prev.perCriterionMetPartial[c] || "", next.perCriterionMetPartial[c] || "")}`);
    if ((prev.perCriterionGuidance[c] || "").trim() !== (next.perCriterionGuidance[c] || "").trim())
      bits.push(`C${c} guidance${stricterHint(prev.perCriterionGuidance[c] || "", next.perCriterionGuidance[c] || "")}`);
  }
  if (bits.length === 0) return "No changes.";
  return "Changed " + bits.join(", ") + ".";
}

// Plain comparison of a candidate version against a baseline (usually the
// previous version or the champion). Only compares dimensions BOTH have.
export function scoreCompareText(candidate: RuleVersion, baseline: RuleVersion): string {
  const bits: string[] = [];
  if (candidate.consistencyPct != null && baseline.consistencyPct != null) {
    const d = candidate.consistencyPct - baseline.consistencyPct;
    bits.push(`consistency ${d >= 0 ? "+" : ""}${d}%`);
  }
  if (candidate.benchmarkCaught != null && baseline.benchmarkCaught != null) {
    const d = candidate.benchmarkCaught - baseline.benchmarkCaught;
    bits.push(`accuracy ${d >= 0 ? "+" : ""}${d} caught`);
  }
  if (bits.length === 0) return "Not directly comparable — run the same test on both versions.";
  const consUp = candidate.consistencyPct != null && baseline.consistencyPct != null && candidate.consistencyPct > baseline.consistencyPct;
  const consDown = candidate.consistencyPct != null && baseline.consistencyPct != null && candidate.consistencyPct < baseline.consistencyPct;
  const accUp = candidate.benchmarkCaught != null && baseline.benchmarkCaught != null && candidate.benchmarkCaught > baseline.benchmarkCaught;
  const accDown = candidate.benchmarkCaught != null && baseline.benchmarkCaught != null && candidate.benchmarkCaught < baseline.benchmarkCaught;
  let verdict = "";
  if ((consUp || accUp) && !consDown && !accDown) verdict = " → better";
  else if ((consDown || accDown) && !consUp && !accUp) verdict = " → worse";
  else if ((consUp && accDown) || (consDown && accUp)) verdict = " → mixed (consistency and accuracy moved opposite ways — review)";
  return bits.join(", ") + verdict;
}

// True when the candidate scored WORSE than the champion on a dimension both
// have measured (used to warn before downgrading). Conservative: only warns
// when there IS comparable data showing a drop and no offsetting gain.
export function isWorseThanChampion(candidate: RuleVersion, champion: RuleVersion): boolean {
  const consComparable = candidate.consistencyPct != null && champion.consistencyPct != null;
  const accComparable = candidate.benchmarkCaught != null && champion.benchmarkCaught != null;
  if (!consComparable && !accComparable) return false;
  const consWorse = consComparable && candidate.consistencyPct! < champion.consistencyPct!;
  const accWorse = accComparable && candidate.benchmarkCaught! < champion.benchmarkCaught!;
  const consBetter = consComparable && candidate.consistencyPct! > champion.consistencyPct!;
  const accBetter = accComparable && candidate.benchmarkCaught! > champion.benchmarkCaught!;
  return (consWorse || accWorse) && !consBetter && !accBetter;
}

export const RULE_OVERFITTING_CAUTION =
  "When tuning against the benchmark, write rules that GENERALISE — describe the decision principle, never name or target specific benchmark findings. A rule that only helps the 54 known cases will not help real, unseen audits.";
