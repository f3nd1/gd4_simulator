// Central system-prompt injection architecture.
//
// Two-layer model:
//   BASE   — always injected for every AI call in this app.
//   MODULE — injected per action type, keeping prompts focused and token-efficient.
//
// Usage:
//   import { buildSystemPrompt } from "./skills";
//   const sys = `You are an auditor.` + buildSystemPrompt("findingWriter");
//   const sys = `You are an auditor.` + buildSystemPrompt("evidenceReview", "spreadsheet");
//
// regulatoryReferences is always injected UNCAPPED because it contains clause
// tables — truncating mid-table causes the AI to cite wrong act/section numbers.
// All other skills are capped at SKILL_CAP chars each to control token spend.

// ─── Raw imports ────────────────────────────────────────────────────────────

import externalAuditorSkill        from "../../data/skills/external-auditor.md?raw";
import evidenceStandardsSkill      from "../../data/skills/evidence-standards.md?raw";
import apsrRubricSkill             from "../../data/skills/apsr-rubric.md?raw";

import benchmarkingSkill           from "../../data/skills/benchmarking-and-good-practice.md?raw";
import bandCalibrationSkill        from "../../data/skills/band-calibration.md?raw";

import evidenceRetrievalSkill      from "../../data/skills/evidence-retrieval.md?raw";
import sourceCitationSkill         from "../../data/skills/source-citation-verification.md?raw";
import evidenceTimelinessSkill     from "../../data/skills/evidence-timeliness.md?raw";

import findingSpecificitySkill     from "../../data/skills/finding-specificity.md?raw";
import findingWritingSkill         from "../../data/skills/finding-writing.md?raw";
import regulatoryReferencesSkill   from "../../data/skills/regulatory-references.md?raw";

import rootCauseMethodologySkill   from "../../data/skills/root-cause-methodology.md?raw";
import evidenceLedgerSkill         from "../../data/skills/evidence-ledger.md?raw";

import interviewFieldworkSkill     from "../../data/skills/interview-and-fieldwork.md?raw";
import sampleTestingSkill          from "../../data/skills/sample-testing-methodology.md?raw";

import scannedDocumentSkill        from "../../data/skills/scanned-document-evidence.md?raw";
import spreadsheetEvidenceSkill    from "../../data/skills/spreadsheet-evidence.md?raw";

import sgPeiContextSkill           from "../../data/skills/sg-pei-context.md?raw";
import consultantInsightsSkill     from "../../data/skills/consultant-insights.md?raw";
import riskRemediationSkill        from "../../data/skills/risk-and-remediation.md?raw";

// ─── Named exports (use these when you need an individual skill) ─────────────

export {
  externalAuditorSkill,
  evidenceStandardsSkill,
  apsrRubricSkill,
  benchmarkingSkill,
  bandCalibrationSkill,
  evidenceRetrievalSkill,
  sourceCitationSkill,
  evidenceTimelinessSkill,
  findingSpecificitySkill,
  findingWritingSkill,
  regulatoryReferencesSkill,
  rootCauseMethodologySkill,
  evidenceLedgerSkill,
  interviewFieldworkSkill,
  sampleTestingSkill,
  scannedDocumentSkill,
  spreadsheetEvidenceSkill,
  sgPeiContextSkill,
  consultantInsightsSkill,
  riskRemediationSkill,
};

// ─── Module map ─────────────────────────────────────────────────────────────

// Each module key maps to the skills injected for that action type.
// "uncapped" skills are joined without the per-skill char limit.
type SkillModule =
  | "checklistScoring"
  | "evidenceReview"
  | "findingWriter"
  | "afiClosure"
  | "bandRecommend"
  | "evidenceTracking"
  | "interviewFieldwork";

type FileType = "scanned" | "spreadsheet";

const MODULE_SKILLS: Record<SkillModule, { capped: string[]; uncapped: string[] }> = {
  checklistScoring: {
    capped:   [benchmarkingSkill],
    uncapped: [],
  },
  evidenceReview: {
    capped:   [evidenceRetrievalSkill, sourceCitationSkill, evidenceTimelinessSkill],
    uncapped: [],
  },
  findingWriter: {
    capped:   [findingSpecificitySkill, findingWritingSkill],
    uncapped: [regulatoryReferencesSkill],
  },
  afiClosure: {
    capped:   [rootCauseMethodologySkill, findingWritingSkill],
    uncapped: [],
  },
  bandRecommend: {
    capped:   [benchmarkingSkill],
    uncapped: [regulatoryReferencesSkill],
  },
  evidenceTracking: {
    capped:   [evidenceLedgerSkill],
    uncapped: [],
  },
  interviewFieldwork: {
    capped:   [interviewFieldworkSkill, sampleTestingSkill],
    uncapped: [],
  },
};

// ─── Constants ───────────────────────────────────────────────────────────────

// BASE layer — injected for every call.
const BASE_SKILLS: string[] = [externalAuditorSkill, evidenceStandardsSkill, apsrRubricSkill];

// Per-skill character cap — keeps total token spend predictable.
// regulatoryReferences is exempt (uncapped) — see note at top of file.
const SKILL_CAP = 3000;

const SEP = "\n\n---\n\n";

// Maps raw skill content → its source filename so buildSystemPrompt() can
// wrap each block with a labelled header and footer for traceability.
const SKILL_NAMES = new Map<string, string>([
  [externalAuditorSkill,        "external-auditor.md"],
  [evidenceStandardsSkill,      "evidence-standards.md"],
  [apsrRubricSkill,             "apsr-rubric.md"],
  [benchmarkingSkill,           "benchmarking-and-good-practice.md"],
  [bandCalibrationSkill,        "band-calibration.md"],
  [evidenceRetrievalSkill,      "evidence-retrieval.md"],
  [sourceCitationSkill,         "source-citation-verification.md"],
  [evidenceTimelinessSkill,     "evidence-timeliness.md"],
  [findingSpecificitySkill,     "finding-specificity.md"],
  [findingWritingSkill,         "finding-writing.md"],
  [regulatoryReferencesSkill,   "regulatory-references.md"],
  [rootCauseMethodologySkill,   "root-cause-methodology.md"],
  [evidenceLedgerSkill,         "evidence-ledger.md"],
  [interviewFieldworkSkill,     "interview-and-fieldwork.md"],
  [sampleTestingSkill,          "sample-testing-methodology.md"],
  [scannedDocumentSkill,        "scanned-document-evidence.md"],
  [spreadsheetEvidenceSkill,    "spreadsheet-evidence.md"],
  [sgPeiContextSkill,           "sg-pei-context.md"],
  [consultantInsightsSkill,     "consultant-insights.md"],
  [riskRemediationSkill,        "risk-and-remediation.md"],
]);

function labelSkill(raw: string, content: string): string {
  const name = SKILL_NAMES.get(raw) ?? "unknown.md";
  return `=== SKILL: ${name} ===\n${content}\n=== END: ${name} ===`;
}

// ─── buildSystemPrompt ───────────────────────────────────────────────────────

/**
 * Combines BASE + MODULE skills into a single block to append to a system prompt.
 *
 * @param module   Which action type is being performed (determines MODULE skills).
 * @param fileType Optional: "scanned" or "spreadsheet" — adds the matching
 *                 file-type skill on top of the module set.
 * @param fnName   Optional: calling function name — written to the AI Debug Log in DEV.
 * @returns        A string starting with "\n\n## Auditor knowledge base…" or ""
 *                 if no skills apply.
 *
 * @example
 *   const sys = `You are a GD4 auditor.` + buildSystemPrompt("findingWriter");
 *   const sys = `You are a GD4 auditor.` + buildSystemPrompt("evidenceReview", "spreadsheet");
 */
export function buildSystemPrompt(module: SkillModule, fileType?: FileType | null, fnName?: string): string {
  const moduleSkills = MODULE_SKILLS[module];

  // Capped skills: BASE + module capped skills, each truncated to SKILL_CAP chars.
  const cappedDocs = [...BASE_SKILLS, ...moduleSkills.capped]
    .map((d) => labelSkill(d, d.trim().slice(0, SKILL_CAP)));

  // File-type bonus skills — also capped.
  if (fileType === "scanned")     cappedDocs.push(labelSkill(scannedDocumentSkill, scannedDocumentSkill.trim().slice(0, SKILL_CAP)));
  if (fileType === "spreadsheet") cappedDocs.push(labelSkill(spreadsheetEvidenceSkill, spreadsheetEvidenceSkill.trim().slice(0, SKILL_CAP)));

  // Uncapped skills appended after (regulatory references must not be truncated).
  const uncappedDocs = moduleSkills.uncapped.map((d) => labelSkill(d, d.trim()));

  const allDocs = [...cappedDocs, ...uncappedDocs].filter(Boolean);
  if (allDocs.length === 0) return "";

  const result = `\n\n## Auditor knowledge base (apply this expertise to your assessment)\n\n${allDocs.join(SEP)}`;

  // Dev-only: log each buildSystemPrompt() call to the AI Debug Log page.
  if (import.meta.env.DEV && fnName) {
    // Lazy import to avoid pulling Zustand into non-React contexts in production.
    import("../../store/useAIDebugLogStore").then(({ useAIDebugLogStore }) => {
      useAIDebugLogStore.getState().addEntry(fnName, module, result);
    });
  }

  return result;
}

// ─── Convenience: inject a one-off domain expertise block ────────────────────
// The criterion-specific skills (criterion-{1..7}-*.md) are looked up dynamically
// via domainExpertise.ts and injected as a SEPARATE block so they are never
// mixed into or capped by the BASE+MODULE pool.
//
//   import { domainExpertiseFor } from "../../data/skills/domainExpertise";
//   const domainBlock = buildDomainBlock(domainExpertiseFor(subCriterionId));
//
export function buildDomainBlock(skill: string | undefined | null): string {
  if (!skill?.trim()) return "";
  return `\n\n## Specialist domain expertise for this criterion\n\nWrite this finding with the precision of the specialist below — use its specific cross-checks, regulatory points and red flags so the observation, root cause and corrective/preventive actions are concrete and domain-accurate, not generic.\n\n${skill.trim()}`;
}
