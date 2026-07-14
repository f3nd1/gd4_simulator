// Seed data for the Sub-Criterion Checklist module's specific lines:
// hand-seeded for three items so the module is usable without an AI call;
// every other item is decomposed on demand from its real describeShow/notes
// text (see lib/ai/simulateAI.ts's simulateChecklistGeneration). The seeded
// lines are atomic statements drawn directly from those items' real
// Describe/Show bullets in gd4Requirements.ts — nothing here is invented.
// AFI tags (B11, B13) reference the real findings in data/findings.ts for
// the same items.
import type { SpecificChecklistLine, SubCriterionChecklistEntry } from "../types";

function specLine(id: string, text: string, clause: string, afiTag?: string): SpecificChecklistLine {
  return { id, text, clause, status: "Not Started", afiTag, evidence: [], generatedBy: "seed" };
}

export const SEED_SPECIFIC_LINES: Record<string, SpecificChecklistLine[]> = {
  "4.2.1": [
    specLine("4.2.1-S1", "Each student contract is issued for admission into one course only, not bundled across courses.", "GD4 4.2.1"),
    specLine("4.2.1-S2", "Contract terms and conditions are explained to the student and understanding is acknowledged.", "GD4 4.2.1"),
    specLine("4.2.1-S3", "A cooling-off period of at least 7 working days is provided and recorded.", "GD4 4.2.1"),
    specLine("4.2.1-S4", "Any contract amendment is acknowledged in writing by both the PEI and the student.", "GD4 4.2.1"),
    specLine("4.2.1-S5", "A new contract or addendum is issued for module repeats, deferment or transfer.", "GD4 4.2.1"),
    specLine("4.2.1-S6", "The contract and marketing collaterals declare a full fee breakdown, including non-refundable fees, discounts/rebates and grants/funding.", "GD4 4.2.1"),
    specLine("4.2.1-S7", "The SSG-issued Standard Student Contract template is used for all students.", "GD4 4.2.1 · Notes"),
    specLine("4.2.1-S8", "A copy of the student contract is made available to prospective students before signing.", "GD4 4.2.1"),
  ],
  "4.6.1": [
    specLine("4.6.1-S1", "A disciplinary policy and procedure for students is documented and communicated to all students.", "GD4 4.6.1"),
    specLine("4.6.1-S2", "An attendance policy and procedure is documented and communicated to all students.", "GD4 4.6.1"),
    specLine("4.6.1-S3", "Attendance is taken and monitored for classroom-based learning.", "GD4 4.6.1"),
    specLine("4.6.1-S4", "Attendance is taken and monitored for synchronous e-learning.", "GD4 4.6.1", "B11"),
    specLine("4.6.1-S5", "Attendance is taken and monitored for asynchronous e-learning.", "GD4 4.6.1", "B11"),
    specLine("4.6.1-S6", "Timely intervention is implemented for students with poor conduct or attendance.", "GD4 4.6.1"),
    specLine("4.6.1-S7", "Intervention measures are evaluated for effectiveness and improvement.", "GD4 4.6.1", "B11"),
    specLine("4.6.1-S8", "The disciplinary/attendance policy and the attendance system are reviewed for continual improvement.", "GD4 4.6.1"),
  ],
  "5.1.2": [
    specLine("5.1.2-S1", "A course/module review process gathers input from stakeholders.", "GD4 5.1.2"),
    specLine("5.1.2-S2", "Module assessment results and student/staff feedback are analysed as part of the review.", "GD4 5.1.2"),
    specLine("5.1.2-S3", "Trend data and benchmarks on student and graduate performance are used in the review.", "GD4 5.1.2", "B13"),
    specLine("5.1.2-S4", "Course/module relevance, content, duration and admission requirements are reviewed in a timely manner.", "GD4 5.1.2", "B13"),
    specLine("5.1.2-S5", "Course delivery and the adequacy/effectiveness of academic resources are reviewed.", "GD4 5.1.2", "B13"),
    specLine("5.1.2-S6", "Student learning outcomes are refined based on the review.", "GD4 5.1.2"),
    specLine("5.1.2-S7", "The Academic Board is involved in the review and approves review outcomes.", "GD4 5.1.2"),
    specLine("5.1.2-S8", "The course/module review process itself is reviewed for continual improvement.", "GD4 5.1.2"),
  ],
};

export function buildSeedEntry(itemId: string): SubCriterionChecklistEntry {
  return {
    gd4ItemId: itemId,
    specific: (SEED_SPECIFIC_LINES[itemId] || []).map((l) => ({ ...l, evidence: [] })),
    pendingGenerated: [],
  };
}
