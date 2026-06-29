import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ProfileOfPeiState,
  ErfEdutrustRow,
  ShareholderRow,
  DirectorRow,
  ManagementRow,
  AcademicBoardRow,
  FacilitiesInfo,
  FinancialRow,
  CourseRow,
  NationalityRow,
  ConsultantRow,
  HistoricalEnrolmentRow,
  StudentSample,
  StaffRecord,
  AssessorRequest,
  InterviewRecord,
  ClarificationRecord,
} from "../types/profileOfPei";

// ---------------------------------------------------------------------------
// Pure helper functions (exported for tests)
// ---------------------------------------------------------------------------

export function computeRecommendedSampleSize(activeStudentCount: number): number {
  if (activeStudentCount === 0) return 0;
  if (activeStudentCount <= 2) return activeStudentCount;
  return 3;
}

export function computeCourseSamplingStatus(course: CourseRow): string {
  if (course.activeStudentCount === 0) return "Not applicable — no active students";
  if (course.activeStudentCount <= 2) return "Insufficient population";
  if (course.selectedStudentSampleCount <= 0) return "Pending selection";
  if (course.selectedStudentSampleCount < course.recommendedStudentSampleSize) return "Pending selection";
  return "Selected";
}

export function computeFinancialWarnings(rows: FinancialRow[]): string[] {
  const warnings: string[] = [];

  function parseValue(val: string): number {
    const trimmed = val.trim();
    if (!trimmed || trimmed === "-" || trimmed === "N/A" || trimmed === "") return NaN;
    const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
    const cleaned = trimmed.replace(/^\(/, "").replace(/\)$/, "").replace(/S\$/g, "").replace(/,/g, "").replace(/\s/g, "");
    const num = parseFloat(cleaned);
    if (isNaN(num)) return NaN;
    return negative ? -num : num;
  }

  function findRow(keyword: string): FinancialRow | undefined {
    return rows.find(r => r.item.toLowerCase().includes(keyword.toLowerCase()));
  }

  const annualRevenueRow = findRow("Annual Revenue");
  const shortCourseRow = rows.find(r => r.item.includes("% Revenue from Short Course") || r.item.includes("% Revenue From Short Course"));
  const permittedCourseRow = rows.find(r => r.item.includes("% Revenue from Permitted Course") || r.item.includes("% Revenue From Permitted Course"));
  const netEquityRow = findRow("Net Equity");
  const profitLossRow = rows.find(r => r.item.includes("Profit") || r.item.includes("Loss after tax") || r.item.includes("Profit/Loss"));

  const years: Array<{ label: string; key: "y2023" | "y2024" | "y2025" }> = [
    { label: "2023", key: "y2023" },
    { label: "2024", key: "y2024" },
    { label: "2025", key: "y2025" },
  ];

  for (const { label, key } of years) {
    // Short course revenue > 50% of annual revenue
    if (shortCourseRow) {
      const pct = parseValue(shortCourseRow[key]);
      if (!isNaN(pct) && pct > 50) {
        warnings.push(`${label}: Short course revenue is ${pct.toFixed(2)}% of annual revenue (above 50% threshold)`);
      }
    } else if (annualRevenueRow) {
      const shortRow = findRow("Revenue from Short Course");
      if (shortRow) {
        const rev = parseValue(annualRevenueRow[key]);
        const sc = parseValue(shortRow[key]);
        if (!isNaN(rev) && !isNaN(sc) && rev !== 0) {
          const pct = (sc / rev) * 100;
          if (pct > 50) {
            warnings.push(`${label}: Short course revenue is ${pct.toFixed(2)}% of annual revenue (above 50% threshold)`);
          }
        }
      }
    }

    // Permitted course revenue < 10% of annual revenue
    if (permittedCourseRow) {
      const pct = parseValue(permittedCourseRow[key]);
      if (!isNaN(pct) && pct < 10) {
        warnings.push(`${label}: Permitted course revenue is ${pct.toFixed(2)}% of annual revenue (below 10% threshold)`);
      }
    } else if (annualRevenueRow) {
      const pcRow = findRow("Revenue from Permitted Course");
      if (pcRow) {
        const rev = parseValue(annualRevenueRow[key]);
        const pc = parseValue(pcRow[key]);
        if (!isNaN(rev) && !isNaN(pc) && rev !== 0) {
          const pct = (pc / rev) * 100;
          if (pct < 10) {
            warnings.push(`${label}: Permitted course revenue is ${pct.toFixed(2)}% of annual revenue (below 10% threshold)`);
          }
        }
      }
    }

    // Net equity negative
    if (netEquityRow) {
      const val = parseValue(netEquityRow[key]);
      if (!isNaN(val) && val < 0) {
        warnings.push(`${label}: Net equity is negative (${netEquityRow[key]})`);
      }
    }

    // Profit/Loss negative
    if (profitLossRow) {
      const val = parseValue(profitLossRow[key]);
      if (!isNaN(val) && val < 0) {
        warnings.push(`${label}: Profit/Loss after tax is negative (${profitLossRow[key]})`);
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const BACKGROUND_TEXT = `United Ceres College (UCC) was established and registered with ACRA on 7 October 2019 by Liu Shanshan and Zhang Pengxuan, who served as founding shareholders and directors on a part-time basis. During its initial phase, the institution operated with a lean structure, with Felix overseeing key functions including academic development, regulatory compliance, system implementation, and daily operations.

In Q2 2023, Feng Xiaocong joined as a shareholder and investor, strengthening the institution's capital base and supporting its transition towards sustainable operations. Subsequently, Liu Shanshan and Zhang Pengxuan stepped down from their director roles, and leadership was consolidated under Felix, who assumed a full-time role and was formally appointed as Principal. This marked a transition from a founder-led structure to a more stable and professionally managed organisation.

UCC attained its first EduTrust certification on 18 July 2025, marking a key milestone in strengthening its governance, academic quality, and regulatory compliance framework.

Following this, Peixin International Pte. Ltd. was admitted as a shareholder on 16 October 2025, holding a 15% stake. Peixin International is linked to an established education group in Tianjin, China, with operations across preschool to senior secondary levels. This partnership supports UCC's access to international networks and enhances its ability to support student recruitment and academic pathway development.

UCC's main business focuses on the delivery of preparatory and diploma-level programmes. Core offerings include preparatory courses for IELTS and academic pathways such as AEIS and GCE, as well as diploma programmes in Business and related disciplines. These programmes are designed to support progression into further education while equipping learners with relevant applied skills.

The institution adopts a structured product pathway approach, enabling students to progress from preparatory programmes into certificate and diploma-level qualifications. This pathway supports different entry points and learning needs, providing a clear progression route from foundational English and academic preparation to higher-level qualifications and further education opportunities. The integration of multiple programme levels allows UCC to build continuity in student development while supporting long-term academic and career outcomes.

Key milestones include the implementation of a fully digitalised operational environment through internally developed School Management Systems, supporting automation, data integrity, and a single source of truth (SSOT) across academic, administrative, and compliance functions. UCC has attained ISO 9001:2015 certification and has achieved BizSAFE Level 3 and Cyber Essentials. The institution is currently implementing ISO/IEC 27001:2022 and has applied for the Data Protection Trustmark (DPTM), pending review by IMDA.

Since the last assessment, UCC has undergone several key changes. Programme delivery has resumed with new intakes commencing in December, and enrolment has shown steady and controlled growth. The programme portfolio has been expanded to include additional offerings aligned with market demand.

Operationally, the organisation has scaled from an initial team of three personnel to a structured workforce comprising five staff members based in Singapore and ten offshore personnel in the Philippines, including four full-time staff and six part-time personnel. The Singapore team focuses on student-facing and academic functions, while the Philippines team supports backend administration and system development.

UCC has also strengthened its student recruitment capabilities, with an increase in enrolment size supported by expanded recruitment channels, including agents and strategic partners. The addition of Peixin International further enhances access to the PRC market, contributing to a more stable pipeline of students across preparatory and diploma programmes. Moving forward, UCC is focused on scaling its operations through structured partnerships, system-driven processes, and digital infrastructure, ensuring that growth remains sustainable while maintaining quality and compliance standards.

UCC continues to strengthen its operational capabilities through ongoing system enhancements, automation, and process optimisation. These efforts ensure consistency, traceability, and compliance across all functions, positioning the institution for sustainable growth while maintaining alignment with regulatory requirements and quality assurance standards.`;

const SEED_ERF_ROWS: ErfEdutrustRow[] = [
  { id: "erf-1", type: "ERF", status: "4-YEAR REGISTRATION", expiryDate: "8 December 2026", remarks: "" },
  { id: "erf-2", type: "EduTrust", status: "EDUTRUST PROVISIONAL", expiryDate: "17 July 2026", remarks: "" },
];

const SEED_SHAREHOLDERS: ShareholderRow[] = [
  { id: "sh-1", name: "Peixin International Pte. Ltd.", shares: 17647, shareType: "Ordinary", percentage: 15 },
  { id: "sh-2", name: "Feng Xiaocong", shares: 30000, shareType: "Ordinary", percentage: 25.5 },
  { id: "sh-3", name: "Liu Shanshan", shares: 35000, shareType: "Ordinary", percentage: 29.75 },
  { id: "sh-4", name: "Zhang Pengxuan", shares: 35000, shareType: "Ordinary", percentage: 29.75 },
];

const SEED_DIRECTORS: DirectorRow[] = [
  { id: "dir-1", name: "Felix Oking", designation: "Principal" },
];

const SEED_MANAGEMENT: ManagementRow[] = [
  { id: "mgmt-1", name: "Felix Oking", designation: "Principal" },
  { id: "mgmt-2", name: "Dr. Yasser Mattar", designation: "Academic Director" },
  { id: "mgmt-3", name: "Renzo Demie V Delenio", designation: "IT Manager" },
];

const SEED_ACADEMIC_BOARD: AcademicBoardRow[] = [
  { id: "ab-1", name: "Felix Oking", designation: "Chairman", membership: "AB and EB" },
  { id: "ab-2", name: "Liu Shanshan", designation: "Member", membership: "AB and EB" },
  { id: "ab-3", name: "Dr Yasser Mattar", designation: "Member", membership: "AB and EB" },
  { id: "ab-4", name: "Wei Ruixue", designation: "Member", membership: "AB and EB" },
];

const SEED_FACILITIES: FacilitiesInfo = {
  address: "37 Middle Road, UWEEI Building, #05-00, Singapore 188946",
  unitNumber: "#05-00",
  postalCode: "188946",
  sharedPremises: "Shared premises arrangement, if applicable",
  summary: "",
  remarks: "",
};

const SEED_FINANCIAL_ROWS: FinancialRow[] = [
  { id: "fin-1", item: "Annual Revenue", y2023: "S$54,013", y2024: "S$48,320", y2025: "S$51,717" },
  { id: "fin-2", item: "Revenue from Permitted Courses", y2023: "S$30,000", y2024: "S$0", y2025: "S$650" },
  { id: "fin-3", item: "% Revenue from Permitted Courses", y2023: "55.54%", y2024: "0%", y2025: "1.26%" },
  { id: "fin-4", item: "Revenue from Short Courses", y2023: "S$24,013", y2024: "S$48,320", y2025: "S$50,767" },
  { id: "fin-5", item: "% Revenue from Short Courses", y2023: "44.46%", y2024: "100%", y2025: "98.17%" },
  { id: "fin-6", item: "Other Revenue", y2023: "S$0", y2024: "S$0", y2025: "S$300" },
  { id: "fin-7", item: "% Revenue from Other Revenue", y2023: "0%", y2024: "0%", y2025: "0.58%" },
  { id: "fin-8", item: "Total Expenditure", y2023: "S$190,765", y2024: "S$228,469", y2025: "S$221,861" },
  { id: "fin-9", item: "Top expenditure items", y2023: "Salaries, Rent, System", y2024: "Salaries, Rent, System", y2025: "Salaries, Rent, System" },
  { id: "fin-10", item: "Profit/Loss after tax", y2023: "(S$136,752)", y2024: "(S$180,149)", y2025: "(S$170,144)" },
  { id: "fin-11", item: "Net Equity", y2023: "(S$36,752)", y2024: "(S$216,901)", y2025: "(S$387,045)" },
];

function makeCourse(
  id: string,
  courseTitle: string,
  awardingBody: string,
  activeStudentCount: number,
  courseType: string,
  selectedStudentSampleCount = 0,
  samplingRemarks = "",
): CourseRow {
  return {
    id,
    courseTitle,
    awardingBody,
    activeStudentCount,
    courseType,
    recommendedStudentSampleSize: computeRecommendedSampleSize(activeStudentCount),
    selectedStudentSampleCount,
    samplingRemarks,
  };
}

const SEED_COURSES: CourseRow[] = [
  makeCourse("course-1", "Diploma in Business Management", "UCC", 7, "Diploma", 3),
  makeCourse("course-2", "Diploma in Early Childhood Care and Education", "UCC", 0, "Diploma"),
  makeCourse("course-3", "Diploma in Human Resource Management", "UCC", 0, "Diploma"),
  makeCourse("course-4", "Diploma in Logistics and Supply Chain Management", "UCC", 0, "Diploma"),
  makeCourse("course-5", "Diploma in Marketing", "UCC", 0, "Diploma"),
  makeCourse("course-6", "Diploma in Retail Management", "UCC", 0, "Diploma"),
  makeCourse("course-7", "Advanced Diploma in Business Management", "UCC", 0, "Advanced Diploma"),
  makeCourse("course-8", "Advanced Diploma in Human Resource Management", "UCC", 0, "Advanced Diploma"),
  makeCourse("course-9", "Advanced Diploma in Marketing", "UCC", 0, "Advanced Diploma"),
  makeCourse("course-10", "Certificate in Business Management", "UCC", 0, "Certificate"),
  makeCourse("course-11", "Certificate in Early Childhood Care and Education", "UCC", 0, "Certificate"),
  makeCourse("course-12", "Certificate in Human Resource Management", "UCC", 0, "Certificate"),
  makeCourse("course-13", "Certificate in Logistics and Supply Chain Management", "UCC", 0, "Certificate"),
  makeCourse("course-14", "Certificate in Marketing", "UCC", 0, "Certificate"),
  makeCourse("course-15", "Certificate in Retail Management", "UCC", 0, "Certificate"),
  makeCourse("course-16", "Postgraduate Certificate in Business Administration", "UCC", 0, "Postgraduate Certificate/Diploma"),
  makeCourse("course-17", "Postgraduate Diploma in Business Administration", "UCC", 0, "Postgraduate Certificate/Diploma"),
  makeCourse("course-18", "Preparatory Course for International English Language Testing System (IELTS)", "UCC", 6, "Preparatory", 0),
  makeCourse("course-19", "Preparatory Course for General Certificate of Education (GCE) O-Level", "UCC", 0, "Preparatory"),
  makeCourse("course-20", "Preparatory Course for General Certificate of Education (GCE) A-Level", "UCC", 0, "Preparatory"),
  makeCourse("course-21", "Preparatory Course for Admissions Exercise for International Students (AEIS)", "UCC", 0, "Preparatory"),
  makeCourse("course-22", "Preparatory Course for Supplementary Admissions Exercise (S-AEIS)", "UCC", 0, "Preparatory"),
  makeCourse("course-23", "Preparatory Course for TOEFL", "UCC", 0, "Preparatory"),
  makeCourse("course-24", "Preparatory Course for SAT", "UCC", 0, "Preparatory"),
  makeCourse("course-25", "Preparatory Course for Cambridge English Qualifications", "UCC", 0, "Preparatory"),
  makeCourse("course-26", "Certificate in Digital Marketing", "UCC", 0, "Certificate"),
  makeCourse("course-27", "Certificate in Project Management", "UCC", 0, "Certificate"),
  makeCourse("course-28", "Certificate in Data Analytics", "UCC", 0, "Certificate"),
  makeCourse("course-29", "Diploma in Digital Business", "UCC", 0, "Diploma"),
  makeCourse("course-30", "Diploma in Information Technology", "UCC", 0, "Diploma"),
  makeCourse("course-31", "Advanced Diploma in Data Analytics", "UCC", 0, "Advanced Diploma"),
  makeCourse("course-32", "Postgraduate Certificate in Education Management", "UCC", 0, "Postgraduate Certificate/Diploma"),
  makeCourse("course-33", "Postgraduate Diploma in Education Management", "UCC", 0, "Postgraduate Certificate/Diploma"),
];

const SEED_HISTORICAL_ENROLMENT: HistoricalEnrolmentRow[] = [
  { category: "Permitted Courses", y2023: 10, y2024: 2, y2025: 4 },
  { category: "Short Courses", y2023: 5, y2024: 89, y2025: 103 },
  { category: "Total", y2023: 15, y2024: 91, y2025: 107 },
];

const SEED_NATIONALITY_BREAKDOWN: NationalityRow[] = [
  { id: "nat-1", nationality: "Chinese", count: 11, percentage: 84.62 },
  { id: "nat-2", nationality: "Burmese", count: 1, percentage: 7.69 },
  { id: "nat-3", nationality: "Moroccan", count: 1, percentage: 7.69 },
];

const SEED_CONSULTANTS: ConsultantRow[] = [
  { id: "cons-1", name: "N.A.", period: "N.A.", roleScope: "N.A.", remarks: "" },
];

const SEED_STUDENT_SAMPLES: StudentSample[] = [
  {
    sampleId: "ss-1",
    studentName: "XU, WEIJIA",
    nationality: "China",
    courseId: "course-1",
    courseEnrolledIn: "Diploma in Business Management",
    courseType: "Diploma",
    studyMode: "Full-time",
    cohortYear: 2026,
    enrolledSince: "Apr-26",
    studentPassHolder: true,
    selectedForPFile: true,
    selectedForSampling: true,
    sampleReason: "Replacement sample",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not started",
    sampleType: "Replacement sample",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-3",
    linkedClarificationId: "clar-2",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    sampleId: "ss-2",
    studentName: "HUANG, CHUHAN",
    nationality: "China",
    courseId: "course-1",
    courseEnrolledIn: "Diploma in Business Management",
    courseType: "Diploma",
    studyMode: "Full-time",
    cohortYear: 2026,
    enrolledSince: "Apr-26",
    studentPassHolder: true,
    selectedForPFile: true,
    selectedForSampling: true,
    sampleReason: "Replacement sample",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not started",
    sampleType: "Replacement sample",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-3",
    linkedClarificationId: "clar-2",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    sampleId: "ss-3",
    studentName: "JIN, WEIXIANG",
    nationality: "China",
    courseId: "course-1",
    courseEnrolledIn: "Diploma in Business Management",
    courseType: "Diploma",
    studyMode: "Full-time",
    cohortYear: 2026,
    enrolledSince: "Apr-26",
    studentPassHolder: true,
    selectedForPFile: true,
    selectedForSampling: true,
    sampleReason: "Replacement sample",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not started",
    sampleType: "Replacement sample",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-3",
    linkedClarificationId: "clar-2",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
];

const SEED_STAFF_RECORDS: StaffRecord[] = [
  {
    staffId: "staff-1",
    fullName: "Irene Sismundo",
    displayName: "Irene",
    role: "HR and Finance Officer",
    department: "Operations",
    staffCategory: "Non-Academic",
    employmentType: "Full-time",
    location: "Singapore",
    onsiteDuringAssessment: "Yes",
    selectedForInterview: true,
    selectedForPFile: false,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not applicable",
    sampleType: "Internal sample",
    interviewRequired: true,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-1",
    linkedClarificationId: "",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    staffId: "staff-2",
    fullName: "Lee Zheng Lin",
    displayName: "Lee Zheng Lin",
    role: "Admissions Officer",
    department: "Admissions",
    staffCategory: "Non-Academic",
    employmentType: "Full-time",
    location: "Singapore",
    onsiteDuringAssessment: "Yes",
    selectedForInterview: true,
    selectedForPFile: false,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not applicable",
    sampleType: "Internal sample",
    interviewRequired: true,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-1",
    linkedClarificationId: "",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    staffId: "staff-3",
    fullName: "Jennie Zhang Shuhan",
    displayName: "Jennie",
    role: "Academic Executive",
    department: "Academic",
    staffCategory: "Academic",
    employmentType: "Full-time",
    location: "Singapore",
    onsiteDuringAssessment: "Yes",
    selectedForInterview: true,
    selectedForPFile: true,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not started",
    sampleType: "Internal sample",
    interviewRequired: true,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-1",
    linkedClarificationId: "",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    staffId: "staff-4",
    fullName: "Leow Boon Peng",
    displayName: "Leow Boon Peng",
    role: "Adjunct Lecturer",
    department: "Academic",
    staffCategory: "Academic",
    employmentType: "Adjunct",
    location: "Singapore",
    onsiteDuringAssessment: "Not applicable",
    selectedForInterview: true,
    selectedForPFile: false,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not applicable",
    sampleType: "Internal sample",
    interviewRequired: true,
    interviewStatus: "Pending time",
    assessorConfirmationStatus: "Pending assessor confirmation",
    linkedAssessorRequestId: "req-1",
    linkedClarificationId: "clar-1",
    missingItems: [],
    readyForDay1: false,
    remarks: "Adjunct lecturer. Interview time must be confirmed so attendance can be arranged.",
  },
  {
    staffId: "staff-5",
    fullName: "Yasser Rounin Mattar",
    displayName: "Dr. Yasser Mattar",
    role: "Academic Director",
    department: "Academic",
    staffCategory: "Management",
    employmentType: "Full-time",
    location: "Singapore",
    onsiteDuringAssessment: "Yes",
    selectedForInterview: false,
    selectedForPFile: true,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not started",
    sampleType: "Internal sample",
    interviewRequired: false,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Not required",
    linkedAssessorRequestId: "",
    linkedClarificationId: "",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
  {
    staffId: "staff-6",
    fullName: "Reda Jabbary",
    displayName: "Reda Jabbary",
    role: "Lecturer",
    department: "Academic",
    staffCategory: "Academic",
    employmentType: "Part-time",
    location: "Singapore",
    onsiteDuringAssessment: "Yes",
    selectedForInterview: false,
    selectedForPFile: false,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not applicable",
    sampleType: "Internal sample",
    interviewRequired: false,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Not required",
    linkedAssessorRequestId: "req-4",
    linkedClarificationId: "clar-3",
    missingItems: [],
    readyForDay1: false,
    remarks: "Correction: listed as part-time, not full-time.",
  },
  {
    staffId: "staff-7",
    fullName: "Renzo Demie V Delenio",
    displayName: "Renzo",
    role: "IT Manager",
    department: "IT",
    staffCategory: "Non-Academic",
    employmentType: "Full-time",
    location: "Philippines",
    onsiteDuringAssessment: "No",
    selectedForInterview: false,
    selectedForPFile: false,
    selectedForSampling: false,
    sampleReason: "",
    linkedGd4Refs: [],
    linkedChecklistLineIds: [],
    linkedEvidenceFiles: [],
    linkedFindings: [],
    pFileStatus: "Not applicable",
    sampleType: "Internal sample",
    interviewRequired: false,
    interviewStatus: "Scheduled",
    assessorConfirmationStatus: "Not required",
    linkedAssessorRequestId: "",
    linkedClarificationId: "",
    missingItems: [],
    readyForDay1: false,
    remarks: "",
  },
];

const SEED_ASSESSOR_REQUESTS: AssessorRequest[] = [
  {
    requestId: "req-1",
    requestDate: "2026-06-28",
    requestedBy: "Assessor",
    requestType: "Staff interview",
    requestSummary: "Assessor has requested interviews with four staff members: Irene Sismundo (HR and Finance Officer), Lee Zheng Lin (Admissions Officer), Jennie Zhang Shuhan (Academic Executive), and Leow Boon Peng (Adjunct Lecturer). Irene, Lee Zheng Lin, and Jennie are confirmed onsite. Leow Boon Peng is an adjunct lecturer whose attendance must be separately arranged.",
    requiredCount: 4,
    selectedRecords: ["staff-1", "staff-2", "staff-3", "staff-4"],
    linkedStudentSampleIds: [],
    linkedStaffIds: ["staff-1", "staff-2", "staff-3", "staff-4"],
    status: "Pending confirmation",
    responseDraft: "We confirm the availability of Irene Sismundo, Lee Zheng Lin, and Jennie Zhang Shuhan for interview on the assessment day. For Leow Boon Peng (Adjunct Lecturer), please confirm the exact interview time so we may arrange his attendance accordingly.",
    finalResponse: "",
    dueDate: "",
    remarks: "Pending confirmation of Leow Boon Peng's interview time.",
  },
  {
    requestId: "req-2",
    requestDate: "2026-06-28",
    requestedBy: "Assessor",
    requestType: "Staff P-files",
    requestSummary: "Assessor has requested P-files for all staff. UCC has prepared P-files for 10 staff members (7 non-academic + 3 academic) for Day 1 review. Files include employment contracts, qualifications, and relevant HR documentation.",
    requiredCount: 10,
    selectedRecords: ["staff-1", "staff-2", "staff-3", "staff-4", "staff-5", "staff-6", "staff-7"],
    linkedStudentSampleIds: [],
    linkedStaffIds: ["staff-1", "staff-2", "staff-3", "staff-4", "staff-5", "staff-6", "staff-7"],
    status: "Open",
    responseDraft: "",
    finalResponse: "",
    dueDate: "",
    remarks: "",
  },
  {
    requestId: "req-3",
    requestDate: "2026-06-28",
    requestedBy: "Assessor",
    requestType: "Student P-files",
    requestSummary: "Assessor has requested student P-files. As the 2025 cohort P-files are not available, UCC proposes to provide 2026 student files for XU WEIJIA, HUANG CHUHAN, and JIN WEIXIANG (Diploma in Business Management, 2026 cohort) as replacement samples. Awaiting assessor confirmation that 2026 files are acceptable.",
    requiredCount: 3,
    selectedRecords: ["ss-1", "ss-2", "ss-3"],
    linkedStudentSampleIds: ["ss-1", "ss-2", "ss-3"],
    linkedStaffIds: [],
    status: "Pending confirmation",
    responseDraft: "We propose to provide student P-files for the following 2026 cohort students enrolled in the Diploma in Business Management: XU WEIJIA, HUANG CHUHAN, and JIN WEIXIANG. These are offered as replacement samples given that 2025 cohort files are unavailable. Please confirm whether 2026 student files are acceptable for assessment purposes.",
    finalResponse: "",
    dueDate: "",
    remarks: "Awaiting assessor confirmation per clarification clar-2.",
  },
  {
    requestId: "req-4",
    requestDate: "2026-06-28",
    requestedBy: "UCC",
    requestType: "Correction",
    requestSummary: "Correction notice: Reda Jabbary has been incorrectly listed as a full-time staff member. The correct employment type is part-time. UCC requests that the assessor's records be updated accordingly.",
    requiredCount: 0,
    selectedRecords: ["staff-6"],
    linkedStudentSampleIds: [],
    linkedStaffIds: ["staff-6"],
    status: "Open",
    responseDraft: "Please note that Reda Jabbary is a part-time lecturer, not full-time. We request that this correction be reflected in the assessment records.",
    finalResponse: "",
    dueDate: "",
    remarks: "",
  },
];

const SEED_INTERVIEWS: InterviewRecord[] = [
  {
    interviewId: "int-1",
    staffId: "staff-1",
    staffName: "Irene Sismundo",
    role: "HR and Finance Officer",
    employmentType: "Full-time",
    location: "Singapore",
    interviewDate: "",
    interviewTime: "",
    mode: "Onsite",
    assessor: "",
    status: "Scheduled",
    attendanceRisk: "Low",
    remarks: "",
  },
  {
    interviewId: "int-2",
    staffId: "staff-2",
    staffName: "Lee Zheng Lin",
    role: "Admissions Officer",
    employmentType: "Full-time",
    location: "Singapore",
    interviewDate: "",
    interviewTime: "",
    mode: "Onsite",
    assessor: "",
    status: "Scheduled",
    attendanceRisk: "Low",
    remarks: "",
  },
  {
    interviewId: "int-3",
    staffId: "staff-3",
    staffName: "Jennie Zhang Shuhan",
    role: "Academic Executive",
    employmentType: "Full-time",
    location: "Singapore",
    interviewDate: "",
    interviewTime: "",
    mode: "Onsite",
    assessor: "",
    status: "Scheduled",
    attendanceRisk: "Low",
    remarks: "",
  },
  {
    interviewId: "int-4",
    staffId: "staff-4",
    staffName: "Leow Boon Peng",
    role: "Adjunct Lecturer",
    employmentType: "Adjunct",
    location: "Singapore",
    interviewDate: "",
    interviewTime: "",
    mode: "Onsite",
    assessor: "",
    status: "Pending time",
    attendanceRisk: "High",
    remarks: "Adjunct lecturer. Interview time must be confirmed so attendance can be arranged.",
  },
];

const SEED_CLARIFICATIONS: ClarificationRecord[] = [
  {
    clarificationId: "clar-1",
    date: "2026-06-28",
    topic: "Staff interview time for Leow Boon Peng",
    question: "Please confirm the exact time for staff interviews so Mr Leow Boon Peng's attendance can be arranged. As an adjunct lecturer, he is not regularly onsite and will need advance notice to attend.",
    proposedResponse: "",
    finalResponse: "",
    status: "Awaiting reply",
    relatedRequestId: "req-1",
    relatedStaffIds: ["staff-4"],
    relatedStudentSampleIds: [],
    remarks: "",
  },
  {
    clarificationId: "clar-2",
    date: "2026-06-28",
    topic: "2026 student P-files acceptability",
    question: "Please confirm whether 2026 student files are acceptable as replacement samples for the assessment, given that the 2025 cohort P-files are unavailable. The proposed students are XU WEIJIA, HUANG CHUHAN, and JIN WEIXIANG, all enrolled in the Diploma in Business Management from April 2026.",
    proposedResponse: "",
    finalResponse: "",
    status: "Awaiting reply",
    relatedRequestId: "req-3",
    relatedStaffIds: [],
    relatedStudentSampleIds: ["ss-1", "ss-2", "ss-3"],
    remarks: "",
  },
  {
    clarificationId: "clar-3",
    date: "2026-06-28",
    topic: "Reda Jabbary employment type correction",
    question: "Reda Jabbary should be listed as part-time, not full-time. Please update the assessment records to reflect this correction.",
    proposedResponse: "",
    finalResponse: "",
    status: "Draft",
    relatedRequestId: "req-4",
    relatedStaffIds: ["staff-6"],
    relatedStudentSampleIds: [],
    remarks: "",
  },
];

// ---------------------------------------------------------------------------
// Store type
// ---------------------------------------------------------------------------

type ProfileOfPeiActions = {
  setBackgroundText: (text: string) => void;
  setAiBackgroundNotes: (text: string) => void;
  setErfRows: (rows: ErfEdutrustRow[]) => void;
  setShareholders: (rows: ShareholderRow[]) => void;
  setDirectors: (rows: DirectorRow[]) => void;
  setManagementTeam: (rows: ManagementRow[]) => void;
  setAcademicBoard: (rows: AcademicBoardRow[]) => void;
  setFacilities: (f: FacilitiesInfo) => void;
  setFinancialRows: (rows: FinancialRow[]) => void;
  setCourses: (rows: CourseRow[]) => void;
  updateCourse: (id: string, patch: Partial<CourseRow>) => void;
  setStudentSamples: (samples: StudentSample[]) => void;
  updateStudentSample: (sampleId: string, patch: Partial<StudentSample>) => void;
  setStaffRecords: (records: StaffRecord[]) => void;
  updateStaffRecord: (staffId: string, patch: Partial<StaffRecord>) => void;
  setConsultants: (rows: ConsultantRow[]) => void;
  setAssessorRequests: (reqs: AssessorRequest[]) => void;
  updateAssessorRequest: (requestId: string, patch: Partial<AssessorRequest>) => void;
  setInterviews: (records: InterviewRecord[]) => void;
  setClarifications: (records: ClarificationRecord[]) => void;
  setNationalityBreakdown: (rows: NationalityRow[]) => void;
  setStudyModeProfile: (p: { fullTime: number; partTime: number }) => void;
  setPassStatusProfile: (p: ProfileOfPeiState["passStatusProfile"]) => void;
  setHistoricalEnrolment: (rows: HistoricalEnrolmentRow[]) => void;
};

type ProfileOfPeiStore = ProfileOfPeiState & ProfileOfPeiActions;

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const DEFAULT_STATE: ProfileOfPeiState = {
  backgroundText: BACKGROUND_TEXT,
  erfRows: SEED_ERF_ROWS,
  shareholders: SEED_SHAREHOLDERS,
  directors: SEED_DIRECTORS,
  managementTeam: SEED_MANAGEMENT,
  academicBoard: SEED_ACADEMIC_BOARD,
  facilities: SEED_FACILITIES,
  financialRows: SEED_FINANCIAL_ROWS,
  courses: SEED_COURSES,
  historicalEnrolment: SEED_HISTORICAL_ENROLMENT,
  studyModeProfile: { fullTime: 12, partTime: 1 },
  passStatusProfile: {
    sc: 1,
    pr: 1,
    studentPass: 10,
    dependantPass: 0,
    diplomaticPass: 0,
    employmentPass: 0,
    ltv: 1,
    others: 0,
  },
  nationalityBreakdown: SEED_NATIONALITY_BREAKDOWN,
  studentSamples: SEED_STUDENT_SAMPLES,
  staffRecords: SEED_STAFF_RECORDS,
  consultants: SEED_CONSULTANTS,
  assessorRequests: SEED_ASSESSOR_REQUESTS,
  interviews: SEED_INTERVIEWS,
  clarifications: SEED_CLARIFICATIONS,
  aiBackgroundNotes: "",
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const useProfileOfPeiStore = create<ProfileOfPeiStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setBackgroundText: (text) => set({ backgroundText: text }),
      setAiBackgroundNotes: (text) => set({ aiBackgroundNotes: text }),
      setErfRows: (rows) => set({ erfRows: rows }),
      setShareholders: (rows) => set({ shareholders: rows }),
      setDirectors: (rows) => set({ directors: rows }),
      setManagementTeam: (rows) => set({ managementTeam: rows }),
      setAcademicBoard: (rows) => set({ academicBoard: rows }),
      setFacilities: (f) => set({ facilities: f }),
      setFinancialRows: (rows) => set({ financialRows: rows }),
      setCourses: (rows) => set({ courses: rows }),
      updateCourse: (id, patch) =>
        set((state) => ({
          courses: state.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      setStudentSamples: (samples) => set({ studentSamples: samples }),
      updateStudentSample: (sampleId, patch) =>
        set((state) => ({
          studentSamples: state.studentSamples.map((s) =>
            s.sampleId === sampleId ? { ...s, ...patch } : s,
          ),
        })),
      setStaffRecords: (records) => set({ staffRecords: records }),
      updateStaffRecord: (staffId, patch) =>
        set((state) => ({
          staffRecords: state.staffRecords.map((r) =>
            r.staffId === staffId ? { ...r, ...patch } : r,
          ),
        })),
      setConsultants: (rows) => set({ consultants: rows }),
      setAssessorRequests: (reqs) => set({ assessorRequests: reqs }),
      updateAssessorRequest: (requestId, patch) =>
        set((state) => ({
          assessorRequests: state.assessorRequests.map((r) =>
            r.requestId === requestId ? { ...r, ...patch } : r,
          ),
        })),
      setInterviews: (records) => set({ interviews: records }),
      setClarifications: (records) => set({ clarifications: records }),
      setNationalityBreakdown: (rows) => set({ nationalityBreakdown: rows }),
      setStudyModeProfile: (p) => set({ studyModeProfile: p }),
      setPassStatusProfile: (p) => set({ passStatusProfile: p }),
      setHistoricalEnrolment: (rows) => set({ historicalEnrolment: rows }),
    }),
    { name: "profile-of-pei-v1" },
  ),
);

export default useProfileOfPeiStore;
