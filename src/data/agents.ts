import type { AgentDefinition, DepartmentDefinition, ChecklistLibraryItem } from "../types";

export const AGENTS: AgentDefinition[] = [
  { id: "gd4", name: "GD4 Specialist", focus: "Requirement coverage and banding", strictness: 70 },
  { id: "evid", name: "Evidence Controller", focus: "Currency, approval, traceability", strictness: 75 },
  { id: "challenge", name: "Challenge Panel", focus: "Pushes back on weak claims", strictness: 88 },
  { id: "rubric", name: "Rubric Scoring", focus: "Score and band against rubric", strictness: 65 },
];

// Reusable checklist library, split by department/role, linked to GD4 items.
export const DEPTS: DepartmentDefinition[] = [
  { dept: "Audit Lead", role: "SQ", strict: 70 },
  { dept: "Evidence Controller", role: "SQ", strict: 78 },
  { dept: "Governance", role: "SGL", strict: 60 },
  { dept: "Student Protection", role: "AD / AN", strict: 80 },
  { dept: "Academic Process", role: "ALI / CM", strict: 75 },
  { dept: "Student Support", role: "SSO", strict: 60 },
  { dept: "QA Closure", role: "SQ", strict: 82 },
];

export const CHECKLIST_LIB: ChecklistLibraryItem[] = [
  { id: "CL1", dept: "Audit Lead", text: "Scope, period and evidence cut-off confirmed", link: null },
  { id: "CL2", dept: "Audit Lead", text: "Gate-sensitive items (4.2, 4.6, Criterion 5) identified", link: null },
  { id: "CL3", dept: "Evidence Controller", text: "Every GD4 item has a linked Google Drive evidence folder", link: null },
  { id: "CL4", dept: "Evidence Controller", text: "Evidence is within the cut-off period", link: null },
  { id: "CL5", dept: "Governance", text: "Strategic plan documented, approved and current", link: "1.2.1" },
  { id: "CL6", dept: "Governance", text: "Management Review actions carry owner and timeline", link: "6.2.1" },
  { id: "CL7", dept: "Student Protection", text: "Refund PPD aligned to Student Contract clause 3.8", link: "4.4.1" },
  { id: "CL8", dept: "Student Protection", text: "E-learning attendance recorded for sync and async modes", link: "4.6.1" },
  { id: "CL9", dept: "Student Protection", text: "Pre-course counselling covers Student Pass and MOM info", link: "4.1.1" },
  { id: "CL10", dept: "Academic Process", text: "Course design documents admission requirements and outcomes", link: "5.1.1" },
  { id: "CL11", dept: "Academic Process", text: "Curriculum review uses trend and benchmark data", link: "5.1.2" },
  { id: "CL12", dept: "Academic Process", text: "Vetting personnel for test instruments appointed", link: "5.5.1" },
  { id: "CL13", dept: "Academic Process", text: "Grading criteria established for all assessments", link: "5.5.1" },
  { id: "CL14", dept: "Student Support", text: "Student support services reviewed for continual improvement", link: "4.5.1" },
  { id: "CL15", dept: "Student Support", text: "Survey findings used to review administrative processes", link: "2.4.2" },
  { id: "CL16", dept: "QA Closure", text: "Each finding has root cause and corrective action", link: "6.1.1" },
  { id: "CL17", dept: "QA Closure", text: "Closure evidence proves implementation", link: "6.1.1" },
];
