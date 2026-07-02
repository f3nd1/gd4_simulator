import type { Finding, FindingType, Severity } from "../types";

// SAMPLE findings register (fictitious) — loaded only when the user clicks
// "Use demo data". Illustrative of the kinds of findings a GD4 mock audit
// raises; not the results of any real audit. IDs (B1…C3) are cross-referenced
// by data/checklistSeed.ts and data/demoDataset.ts — keep them stable.
type RawAFI = [id: string, item: string, issue: string, type: FindingType, sev: Severity];

const RAW_AFIS: RawAFI[] = [
  ["B1", "2.3.1", "PPD does not document analysing and managing staff data for organisational learning.", "AFI", "Medium"],
  ["B2", "2.3.1", "PPD does not document how accuracy, reliability and accessibility of compiled data are ensured.", "AFI", "Medium"],
  ["B3", "2.4.2", "PPD does not document using student survey findings to review administrative processes.", "AFI", "Medium"],
  ["B4", "2.4.3", "PPD does not state the academic staff survey covers assessment methods and frequency.", "AFI", "Low"],
  ["B5", "3.1.1", "Agent contract omits code of conduct and non-collection-of-monies clause.", "AFI", "Medium"],
  ["B6", "4.1.1", "Counsellors not evidenced as adequately trained and monitored.", "AFI", "High"],
  ["B7", "4.1.1", "PPD does not document Student Pass info: SP requirements and MOM work-pass restriction.", "AFI", "Medium"],
  ["B8", "4.1.1", "PPD does not document monitoring of staff performing selection and admissions.", "AFI", "Medium"],
  ["B9", "4.4.1", "Refund PPD misaligned with the refund clause in the Student Contract; computation communication not documented.", "AFI", "High"],
  ["B10", "4.5.1", "PPD does not document evaluation and review of student support services.", "AFI", "Medium"],
  ["B11", "4.6.1", "PPD does not document e-learning attendance (sync/async) or intervention evaluation.", "AFI", "High"],
  ["B12", "5.1.1", "PPD does not document admission requirements and learning objectives/outcomes/delivery plans.", "AFI", "High"],
  ["B13", "5.1.2", "Curriculum review not documented; trend/benchmark use and delivery/resource review not implemented.", "AFI", "Critical"],
  ["B14", "5.2.1", "PPD does not document ratios per mode, qualified staff, resources, transition planning.", "AFI", "High"],
  ["B15", "5.2.2", "PPD does not document timely intervention for under-performing teachers.", "AFI", "Medium"],
  ["B16", "5.4.1", "PPD does not document non-academic progress reports, parent reporting for preparatory courses, intervention evaluation.", "AFI", "Medium"],
  ["B17", "5.5.1", "PPD does not document appointment of vetting personnel or assessment-plan review.", "AFI", "High"],
  ["B18", "5.5.1", "Grading criteria for a project/report-based assessment not established.", "AFI", "Critical"],
  ["B19", "6.2.1", "Most Management Review follow-up actions lack execution timelines.", "AFI", "High"],
  ["C1", "2.1.1", "Consider formalising contracts for all part-time teachers.", "Improvement Action", "Low"],
  ["C2", "2.4.1", "Define a fixed review cycle for feedback management.", "Improvement Action", "Low"],
  ["C3", "5.5.1", "State the specific minimum attendance for award criteria.", "Improvement Action", "Low"],
];

export const FINDINGS: Finding[] = RAW_AFIS.map(([id, item, issue, type, sev]) => ({
  id,
  auditCycleId: "cycle-1",
  gd4ItemId: item,
  issue,
  type,
  severity: sev,
  owner: "SQ",
  dueDate: "2027-03-31",
  repeatFinding: false,
  overdue: false,
  managementDecisionNeeded: sev === "Critical" || sev === "High",
  status: "Open",
}));
