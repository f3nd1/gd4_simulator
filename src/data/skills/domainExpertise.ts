// Criterion-specific auditor domain expertise.
//
// Each GD4 criterion demands a different specialist auditor: Criterion 1 needs
// corporate-finance/governance knowledge, Criterion 4 needs student-protection
// and fee-safeguarding regulation, Criterion 5 needs pedagogy and assessment
// QA, Criterion 7 needs statistics/data-integrity, and so on. A generalist
// prompt produces shallow findings; injecting the matching specialist skill
// makes the AI audit reason like an experienced domain auditor.
//
// The folder audit looks up the skill by the folder's criterion id (the first
// segment of the sub-criterion id, e.g. "4.2" -> "4") and injects it into the
// system prompt alongside the generic auditor skills.

import criterion1 from "./criterion-1-leadership-finance.md?raw";
import criterion2 from "./criterion-2-corporate-admin.md?raw";
import criterion3 from "./criterion-3-recruitment-agents.md?raw";
import criterion4 from "./criterion-4-student-protection.md?raw";
import criterion5 from "./criterion-5-academic.md?raw";
import criterion6 from "./criterion-6-quality-assurance.md?raw";
import criterion7 from "./criterion-7-outcomes.md?raw";
import ssgRefundRules from "./ssg-refund-and-withdrawal-rules.md?raw";
import standardStudentContract from "./standard-student-contract.md?raw";
import fpsRules from "./fps-rules.md?raw";

// Short human-readable label of the specialist persona per criterion, used in
// the UI so the auditor can see which expertise the audit applied.
export const DOMAIN_EXPERTISE_LABELS: Record<string, string> = {
  "1": "Corporate governance & finance specialist",
  "2": "HR, marketing-compliance & data-governance specialist",
  "3": "Third-party / agent due-diligence specialist",
  "4": "Student-protection & fee-safeguarding specialist",
  "5": "Curriculum, pedagogy & assessment-QA specialist",
  "6": "Quality-management-systems & continual-improvement specialist",
  "7": "Performance-measurement & data-integrity specialist",
};

// Criterion 4 (student protection) carries three regulatory supplements —
// refund/cooling-off rules, the Standard Student Contract checks, and FPS
// mechanics. These are the zero-tolerance areas where the AI previously had
// to "verify a table it had never seen"; appending them here reaches every
// C4 call (evidence passes, finding writer, panel) at zero cost to the other
// criteria.
const criterion4Full = [criterion4, ssgRefundRules, standardStudentContract, fpsRules].join("\n\n---\n\n");

const DOMAIN_EXPERTISE_SKILLS: Record<string, string> = {
  "1": criterion1,
  "2": criterion2,
  "3": criterion3,
  "4": criterion4Full,
  "5": criterion5,
  "6": criterion6,
  "7": criterion7,
};

// Normalises any item / sub-criterion / criterion id to its criterion number.
// "4.2.1" -> "4", "4.2" -> "4", "4" -> "4".
export function criterionIdOf(anyId: string | undefined | null): string | undefined {
  if (!anyId) return undefined;
  const first = String(anyId).split(".")[0].trim();
  return first in DOMAIN_EXPERTISE_SKILLS ? first : undefined;
}

// Returns the domain-expertise skill markdown for a given criterion / sub-
// criterion / item id, or undefined if the id doesn't map to a known criterion.
export function domainExpertiseFor(anyId: string | undefined | null): string | undefined {
  const cid = criterionIdOf(anyId);
  return cid ? DOMAIN_EXPERTISE_SKILLS[cid] : undefined;
}

// Returns the specialist persona label for a given id, or undefined.
export function domainExpertiseLabelFor(anyId: string | undefined | null): string | undefined {
  const cid = criterionIdOf(anyId);
  return cid ? DOMAIN_EXPERTISE_LABELS[cid] : undefined;
}
