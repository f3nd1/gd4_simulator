import type { GD4Requirement } from "../types";

// Criterion-level point allocation. PLACEHOLDER VALUES — per the requirements
// guide (section 7.5 / section 11.4 caution #3), these must be replaced with
// UCC's official GD4 scoring table once available. Do not present as final.
export type GD4Criterion = { id: string; title: string; points: number };

export const GD4_CRITERIA: GD4Criterion[] = [
  { id: "1", title: "Leadership & Strategic Planning", points: 60 },
  { id: "2", title: "Corporate Administration", points: 100 },
  { id: "3", title: "External Recruitment Agents", points: 60 },
  { id: "4", title: "Student Protection & Support Services", points: 200 },
  { id: "5", title: "Academic Systems & Processes", points: 200 },
  { id: "6", title: "QA, Innovation & Continual Improvement", points: 50 },
  { id: "7", title: "Performance Outcomes", points: 330 },
];

type RawItem = [id: string, crit: string, title: string, gate: 0 | 1];

const RAW_ITEMS: RawItem[] = [
  ["1.1.1", "1", "Leadership & Corporate Governance", 0],
  ["1.2.1", "1", "Strategic Planning", 0],
  ["2.1.1", "2", "Staff Selection & Management", 0],
  ["2.3.1", "2", "Data & Information Management", 0],
  ["2.4.1", "2", "Feedback Management", 0],
  ["2.4.2", "2", "Student Satisfaction Survey", 0],
  ["2.4.3", "2", "Staff Satisfaction Survey", 0],
  ["3.1.1", "3", "Selection & Appointment of Agents", 0],
  ["3.2.1", "3", "Management & Evaluation of Agents", 0],
  ["4.1.1", "4", "Pre-Course Counselling, Selection & Admissions", 0],
  ["4.2.2", "4", "Fee Collection & Fee Protection Scheme", 1],
  ["4.4.1", "4", "Refund", 0],
  ["4.5.1", "4", "Student Support Services", 0],
  ["4.6.1", "4", "Student Conduct & Attendance", 1],
  ["5.1.1", "5", "Course Design & Development", 1],
  ["5.1.2", "5", "Course Review", 1],
  ["5.2.1", "5", "Course Planning", 1],
  ["5.2.2", "5", "Course Delivery", 1],
  ["5.4.1", "5", "Student Learning", 1],
  ["5.5.1", "5", "Student Assessment", 1],
  ["6.1.1", "6", "Internal Assessment", 0],
  ["6.2.1", "6", "Management Review", 0],
  ["6.3.1", "6", "Innovation & Continual Improvement", 0],
  ["7.1.1", "7", "Measurement of Outcomes", 0],
  ["7.2.1", "7", "Student & Graduate Outcomes", 0],
];

const EXPECTED_EVIDENCE: Record<string, string[]> = {
  "4.2.2": ["FPS-insured receipts", "Fee schedule", "Escrow/insurance certificate"],
  "4.6.1": ["Attendance records (sync & async)", "Conduct policy", "Intervention log"],
  "5.1.2": ["Course review minutes", "Trend/benchmark data", "Updated curriculum document"],
  "5.5.1": ["Assessment vetting records", "Grading criteria", "Moderation minutes"],
};

export const GD4_REQUIREMENTS: GD4Requirement[] = RAW_ITEMS.map(([id, crit, title, gate]) => {
  const criterion = GD4_CRITERIA.find((c) => c.id === crit)!;
  const itemCount = RAW_ITEMS.filter((r) => r[1] === crit).length;
  return {
    id,
    criterion: crit,
    area: criterion.title,
    itemNumber: id,
    requirement: title,
    intent: `Assessor checks whether ${title.toLowerCase()} is documented, implemented consistently, reviewed and shows outcome improvement.`,
    maxPoints: criterion.points,
    weightage: Math.round((1 / itemCount) * 1000) / 1000,
    gateSensitive: !!gate,
    expectedEvidence: EXPECTED_EVIDENCE[id] || ["Policy/procedure document", "Implementation record", "Review/monitoring record"],
    bandDescriptors: {
      "Band 1": "Missing or weak evidence, mostly policy only.",
      "Band 2": "Some implementation evidence, but inconsistent or weakly reviewed.",
      "Band 3": "Evidence exists and implementation is reasonably consistent.",
      "Band 4": "Evidence is systematic, reviewed and improved.",
      "Band 5": "Strong, mature, outcome-driven evidence with continual improvement.",
    },
    scoringNotes: "Internal placeholder rubric. Replace with official GD4 scoring table when issued by UCC.",
  };
});
