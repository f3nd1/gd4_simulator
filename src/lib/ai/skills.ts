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

// ─── Criterion file name lookup (for debug log only) ────────────────────────

const CRITERION_FILENAMES: Record<string, string> = {
  "1": "criterion-1-leadership-finance.md",
  "2": "criterion-2-corporate-admin.md",
  "3": "criterion-3-recruitment-agents.md",
  "4": "criterion-4-student-protection.md",
  "5": "criterion-5-academic.md",
  "6": "criterion-6-quality-assurance.md",
  "7": "criterion-7-outcomes.md",
};

function criterionFilenameFor(anyId: string | undefined | null): string | undefined {
  if (!anyId) return undefined;
  const seg = anyId.trim().split(".")[0];
  return CRITERION_FILENAMES[seg];
}

// ─── Calibration example type (mirrors CalibrationExample in types/index.ts) ─
// Defined locally here so skills.ts does not import from the store layer.

export type SkillCalibrationExample = {
  module: string;
  field?: string;
  aiOutput: string;
  humanCorrection: string;
  reason: string;
};

export type SkillCalibrationMemory = {
  module: string;
  subjectId: string;
  context: string;
  aiOutput: string;
  staffCorrection: string;
  keyLearning: string;
};

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
import commonFindingPatternsSkill  from "../../data/skills/common-ssg-finding-patterns.md?raw";

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
  commonFindingPatternsSkill,
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
    capped:   [benchmarkingSkill, bandCalibrationSkill],
    uncapped: [],
  },
  evidenceReview: {
    // regulatory-references was previously injected only for finding-writing
    // and band-recommendation — the evidence passes that actually DECIDE
    // Met/Not met never saw the clause tables (PDPA timelines, cooling-off,
    // ICA thresholds). Uncapped for the same mid-table-truncation reason.
    // common-ssg-finding-patterns primes the verdict passes with the gap
    // patterns real assessors raised at this PEI.
    capped:   [evidenceRetrievalSkill, sourceCitationSkill, evidenceTimelinessSkill, commonFindingPatternsSkill],
    uncapped: [regulatoryReferencesSkill],
  },
  findingWriter: {
    capped:   [findingSpecificitySkill, findingWritingSkill, riskRemediationSkill, commonFindingPatternsSkill],
    uncapped: [regulatoryReferencesSkill],
  },
  afiClosure: {
    capped:   [rootCauseMethodologySkill, findingWritingSkill, riskRemediationSkill],
    uncapped: [],
  },
  bandRecommend: {
    capped:   [benchmarkingSkill, bandCalibrationSkill, consultantInsightsSkill],
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

// BASE layer — injected for every call. sg-pei-context.md carries the SSG
// hard requirements (FPS, contracts, mandatory refund table) — regulatory
// context every assessment needs, so it lives in BASE, not a module.
const BASE_SKILLS: string[] = [externalAuditorSkill, evidenceStandardsSkill, apsrRubricSkill, sgPeiContextSkill];

// Per-skill character cap — keeps total token spend predictable.
// regulatoryReferences is exempt (uncapped) — see note at top of file.
// Raised from 3000: at 3000 the base apsr-rubric.md (~4.5k chars) was cut
// mid-document, so the Systems & Outcomes and Review calibration sections —
// exactly where over-rating happens — never reached the model. 7000 fits
// every current skill file uncut (largest is finding-specificity.md at ~6k).
const SKILL_CAP = 7000;

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
  [commonFindingPatternsSkill,  "common-ssg-finding-patterns.md"],
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
export function buildSystemPrompt(module: SkillModule, fileType?: FileType | null, fnName?: string, criterionId?: string, criterionSkillContent?: string, calibrationExamples?: SkillCalibrationExample[], memories?: SkillCalibrationMemory[], ruleInjection?: string): string {
  const moduleSkills = MODULE_SKILLS[module];

  // Capped skills: BASE + module capped skills, each truncated to SKILL_CAP chars.
  const cappedDocs = [...BASE_SKILLS, ...moduleSkills.capped]
    .map((d) => labelSkill(d, d.trim().slice(0, SKILL_CAP)));

  // File-type bonus skills — also capped.
  if (fileType === "scanned")     cappedDocs.push(labelSkill(scannedDocumentSkill, scannedDocumentSkill.trim().slice(0, SKILL_CAP)));
  if (fileType === "spreadsheet") cappedDocs.push(labelSkill(spreadsheetEvidenceSkill, spreadsheetEvidenceSkill.trim().slice(0, SKILL_CAP)));

  // Uncapped skills appended after (regulatory references must not be truncated).
  const uncappedDocs = moduleSkills.uncapped.map((d) => labelSkill(d, d.trim()));

  const rulesBlock = ruleInjection?.trim() ? ruleInjection : "";
  const allDocs = [...cappedDocs, ...uncappedDocs].filter(Boolean);
  if (allDocs.length === 0 && (!calibrationExamples || calibrationExamples.length === 0) && (!memories || memories.length === 0) && !rulesBlock) return rulesBlock;

  const skillsBlock = allDocs.length > 0
    ? `\n\n## Auditor knowledge base (apply this expertise to your assessment)\n\n${allDocs.join(SEP)}`
    : "";

  // Calibration block: examples of how this auditor has previously corrected AI outputs.
  // Injected so the model can self-calibrate toward this auditor's standards.
  let calibrationBlock = "";
  if (calibrationExamples && calibrationExamples.length > 0) {
    const lines = calibrationExamples.map((ex) => {
      const fieldPart = ex.field ? `\nField: ${ex.field}` : "";
      return `---\nModule: ${ex.module}${fieldPart}\nAI said: ${ex.aiOutput.slice(0, 300)}\nAuditor changed to: ${ex.humanCorrection.slice(0, 300)}\nReason: ${ex.reason}`;
    }).join("\n");
    calibrationBlock = `\n\n=== CALIBRATION: How this auditor has corrected similar AI outputs ===\n${lines}\n===`;
  }

  let memoriesBlock = "";
  if (memories && memories.length > 0) {
    const lines = memories.map((m) =>
      `[Module: ${m.module} · Subject: ${m.subjectId}]\nContext: ${m.context}\nAI previously said: ${m.aiOutput.slice(0, 300)}\nStaff corrected to: ${m.staffCorrection.slice(0, 300)}\nKey learning: ${m.keyLearning}`
    ).join("\n\n");
    memoriesBlock = `\n\n=== LEARNED CORRECTIONS — apply these to your assessment ===\n${lines}\n===`;
  }

  // Tunable rules appended LAST so they sit closest to the task, but they are
  // explicitly subordinate to the core rules (see buildRuleInjection).
  const result = skillsBlock + calibrationBlock + memoriesBlock + rulesBlock;

  // Log each buildSystemPrompt() call to the AI Debug Log page (all builds —
  // the team uses it for development even on deployed builds; the log is
  // in-memory only and never persisted).
  if (fnName) {
    // Lazy import to avoid pulling Zustand into non-React contexts in production.
    const criterionSkill = criterionFilenameFor(criterionId);
    const criterionBlock = criterionSkillContent?.trim()
      ? `\n\n=== CRITERION SKILL: ${criterionSkill ?? "unknown"} ===\n${criterionSkillContent.trim()}\n=== END CRITERION SKILL ===`
      : "";
    import("../../store/useAIDebugLogStore").then(({ useAIDebugLogStore }) => {
      useAIDebugLogStore.getState().addEntry(fnName, module, result + criterionBlock, criterionSkill);
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
