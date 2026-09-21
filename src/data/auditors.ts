import type { AuditorProfile } from "../types";

// UCC's real audit roster, replacing the five invented demo profiles
// (Rachel Tan, Marcus Lim, Priya Nair, Faizal Rahman, Jennifer Wong) that were
// being exported into real audit paperwork. Loaded by "Load preset auditors"
// on Auditor Creation and by the Dashboard's seeding.
//
// departmentId is DELIBERATELY UNSET on every row. It is the input to the
// independence check, so a guessed department would produce a confident,
// invented judgement about a real colleague. It is set once, from the
// dropdown on Auditor Creation, and independenceStatus() reports "cannot
// check" until it is.
//
// The old profiles also carried ids like "ALI / CM" and "AD / AN", which are
// not department acronyms and so could never match a folder owner: the
// independence check silently passed on every one of them. A test now pins
// that every seeded departmentId is either unset or a real acronym.
export const DEFAULT_AUDITORS: AuditorProfile[] = [
  { id: "AUD-FELIX",  auditCycleId: "cycle-1", name: "Felix",            type: "Internal", role: "Internal Auditor", strictness: 70, focusArea: "Governance, agents, quality assurance and outcomes", checklistTemplateId: "Audit Lead Checklist", reviewPerspective: "strict-auditor" },
  { id: "AUD-RENZO",  auditCycleId: "cycle-1", name: "Renzo",            type: "Internal", role: "Internal Auditor", strictness: 65, focusArea: "Data, information and knowledge management", checklistTemplateId: "GD4 Criterion Checklist", reviewPerspective: "risk-challenger" },
  { id: "AUD-IRENE",  auditCycleId: "cycle-1", name: "Irene",            type: "Internal", role: "Internal Auditor", strictness: 65, focusArea: "Human resource and feedback management", checklistTemplateId: "GD4 Criterion Checklist", reviewPerspective: "management-reviewer" },
  { id: "AUD-WENDY",  auditCycleId: "cycle-1", name: "Wendy",            type: "Internal", role: "Internal Auditor", strictness: 70, focusArea: "Student protection and support services", checklistTemplateId: "Student Protection Checklist", reviewPerspective: "academic-qa-guardian" },
  { id: "AUD-ZHENGLIN", auditCycleId: "cycle-1", name: "Zheng Lin",      type: "Internal", role: "Internal Auditor", strictness: 65, focusArea: "Communication and course delivery", checklistTemplateId: "GD4 Criterion Checklist", reviewPerspective: "optimistic-process-owner" },
  { id: "AUD-YASSER", auditCycleId: "cycle-1", name: "Dr Yasser Mattar", type: "Internal", role: "Internal Auditor", strictness: 75, focusArea: "Academic systems and processes", checklistTemplateId: "Academic Process Checklist", reviewPerspective: "strict-auditor" },
  // A process owner, not an auditor: named as PIC for 2.2 and on no audit
  // team. Held on the same roster because it is the only place this app
  // learns a person's department, which independence needs on both sides.
  { id: "AUD-JOBELLE", auditCycleId: "cycle-1", name: "Jobelle",         type: "Internal", role: "Process owner", strictness: 50, focusArea: "Internal and external communication", checklistTemplateId: "GD4 Criterion Checklist" },
];

