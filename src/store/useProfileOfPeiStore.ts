import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ProfileOfPeiState,
  PeiStatusRow,
  ShareholderRow,
  PersonnelRow,
  AcademicExamBoardRow,
  PeiCourseRow,
} from "../types/profileOfPei";

const DEPT = "Academic and Learning Innovation (ALI) - UCC";

const SEED_COURSES: PeiCourseRow[] = [
  { id: "c01", courseName: "Advanced Diploma in Applied Artificial Intelligence", department: DEPT, abbreviation: "ADAAI", ftContactHours: "144", ptContactHours: "144", ftMonths: "8" },
  { id: "c02", courseName: "Advanced Diploma in Business Administration", department: DEPT, abbreviation: "ADBA", ftContactHours: "216", ptContactHours: "216", ftMonths: "8" },
  { id: "c03", courseName: "Certificate in English Language", department: DEPT, abbreviation: "CEL", ftContactHours: "240", ptContactHours: "", ftMonths: "6" },
  { id: "c04", courseName: "Certificate in English Language 1", department: DEPT, abbreviation: "CEL1", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c05", courseName: "Certificate in English Language 2", department: DEPT, abbreviation: "CEL2", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c06", courseName: "Certificate in English Language 3", department: DEPT, abbreviation: "CEL3", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c07", courseName: "Certificate in Management", department: DEPT, abbreviation: "CM", ftContactHours: "160", ptContactHours: "96", ftMonths: "6" },
  { id: "c08", courseName: "Certificate in Management (Enhanced)", department: DEPT, abbreviation: "CME", ftContactHours: "", ptContactHours: "96", ftMonths: "" },
  { id: "c09", courseName: "Certificate in Management (Mandarin)", department: DEPT, abbreviation: "CM(M)", ftContactHours: "160", ptContactHours: "96", ftMonths: "6" },
  { id: "c10", courseName: "Certificate in Management (Enhanced) (Mandarin)", department: DEPT, abbreviation: "CME(M)", ftContactHours: "", ptContactHours: "96", ftMonths: "" },
  { id: "c11", courseName: "Diploma in Applied Artificial Intelligence", department: DEPT, abbreviation: "DAAI", ftContactHours: "216", ptContactHours: "216", ftMonths: "8" },
  { id: "c12", courseName: "Diploma in Business Management", department: DEPT, abbreviation: "DBM", ftContactHours: "320", ptContactHours: "192", ftMonths: "8" },
  { id: "c13", courseName: "Diploma in Business Management (Enhanced)", department: DEPT, abbreviation: "DBME", ftContactHours: "", ptContactHours: "192", ftMonths: "" },
  { id: "c14", courseName: "Diploma in Business Management (Mandarin)", department: DEPT, abbreviation: "DBM(M)", ftContactHours: "320", ptContactHours: "192", ftMonths: "8" },
  { id: "c15", courseName: "Diploma in Business Management (Enhanced) (Mandarin)", department: DEPT, abbreviation: "DBME(M)", ftContactHours: "", ptContactHours: "192", ftMonths: "" },
  { id: "c16", courseName: "Diploma in Tourism and Hospitality Management", department: DEPT, abbreviation: "DTHM", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c17", courseName: "Diploma in Tourism and Hospitality Management (Enhanced)", department: DEPT, abbreviation: "DTHME", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c18", courseName: "Diploma in Tourism and Hospitality Management (Mandarin)", department: DEPT, abbreviation: "DTHM(M)", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c19", courseName: "Diploma in Tourism and Hospitality Management (Enhanced) (Mandarin)", department: DEPT, abbreviation: "DTHME(M)", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c20", courseName: "Post Graduate Certificate", department: DEPT, abbreviation: "PGC", ftContactHours: "240", ptContactHours: "208", ftMonths: "4" },
  { id: "c21", courseName: "Post Graduate Certificate (Mandarin)", department: DEPT, abbreviation: "PGC(M)", ftContactHours: "240", ptContactHours: "208", ftMonths: "4" },
  { id: "c22", courseName: "Post Graduate Diploma", department: DEPT, abbreviation: "PGD", ftContactHours: "480", ptContactHours: "416", ftMonths: "8" },
  { id: "c23", courseName: "Post Graduate Diploma (Mandarin)", department: DEPT, abbreviation: "PGD(M)", ftContactHours: "480", ptContactHours: "416", ftMonths: "8" },
  { id: "c24", courseName: "AEIS Preparation (Primary 2)", department: DEPT, abbreviation: "AEIS P2", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c25", courseName: "AEIS Preparation (Primary 3)", department: DEPT, abbreviation: "AEIS P3", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c26", courseName: "AEIS Preparation (Primary 4)", department: DEPT, abbreviation: "AEIS P4", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c27", courseName: "AEIS Preparation (Primary 5)", department: DEPT, abbreviation: "AEIS P5", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c28", courseName: "AEIS Preparation (Primary 6)", department: DEPT, abbreviation: "AEIS P6", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c29", courseName: "AEIS Preparation (Secondary 1)", department: DEPT, abbreviation: "AEIS S1", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c30", courseName: "AEIS Preparation (Secondary 3)", department: DEPT, abbreviation: "AEIS S3", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c31", courseName: "IELTS Preparation", department: DEPT, abbreviation: "IELTS", ftContactHours: "240", ptContactHours: "NA", ftMonths: "6" },
  { id: "c32", courseName: "GCE A-Level", department: DEPT, abbreviation: "ALEVEL", ftContactHours: "2880", ptContactHours: "NA", ftMonths: "24" },
  { id: "c33", courseName: "GCE O-Level", department: DEPT, abbreviation: "OLEVEL", ftContactHours: "2880", ptContactHours: "NA", ftMonths: "24" },
];

const SEED_BACKGROUND = `## United Ceres College (UCC) — Background

United Ceres College (UCC) is a Private Education Institution (PEI) registered with the Committee for Private Education (CPE) in Singapore. UCC offers a range of academic programmes including certificates, diplomas, post-graduate qualifications, and preparatory courses for international examinations.

**Mission:** To provide quality, affordable and accessible education to domestic and international students in Singapore.

**Key facts:**
- Registered address: 51 Anson Road, #05-52 Anson Centre, Singapore 079904
- Programmes span business management, English language, tourism & hospitality, applied AI, and international exam preparation (AEIS, IELTS, GCE A/O Level)
- Student population is predominantly international (student pass holders)
- Staff complement: approximately 15–25 FTE including academic, administrative and management personnel
- Governance: Board of Directors, Management Representative (MR), Academic & Examination Board`;

const SEED_FINANCIAL = `### Financial Health

The financial statement for the latest three years is as follows:

| Financial Item | 2023 (FY End 30-Sep-23) | 2024 (FY End 30-Sep-24) | 2025 (FY End 30-Sep-25) |
|---|---|---|---|
| Annual Revenue — Permitted Courses | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| Annual Revenue — Short Courses | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| Annual Revenue — Other Revenue | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| **Total Revenue** | **S$XXX,XXX** | **S$XXX,XXX** | **S$XXX,XXX** |
| Total Expenditure | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| Top Expenditure — Salaries | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| Top Expenditure — Rental | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| Top Expenditure — Marketing | S$XXX,XXX | S$XXX,XXX | S$XXX,XXX |
| **Profit / (Loss)** | **(S$XXX,XXX)** | **S$XXX,XXX** | **S$XXX,XXX** |
| **Net Equity** | **S$XXX,XXX** | **S$XXX,XXX** | **S$XXX,XXX** |

*Replace placeholder values with actual audited/management accounts figures.*`;

const SEED_STUDENT_PROFILE = `### Student Profile

**Current enrolment (as at audit date):**

| S/N | Nationality | No. of Students | % of Students |
|---|---|---|---|
| 1 | Chinese | 11 | 84.62% |
| 2 | Burmese | 1 | 7.69% |
| 3 | Moroccan | 1 | 7.69% |
| **Total** | | **13** | **100%** |

**Study mode breakdown:**
- Full-time: XX students
- Part-time: XX students

**Student pass holders:** XX of XX students hold Student Passes issued by ICA.`;

const SEED_STAFF_PROFILE = `### Staff Profile

Operationally, the organisation has scaled from an initial team of three personnel to a current complement of approximately 15–25 FTE across academic, administrative and management functions.

**Staff breakdown by category:**

| Category | Headcount |
|---|---|
| Academic (full-time) | X |
| Academic (part-time / adjunct) | X |
| Management | X |
| Administrative / Support | X |
| **Total** | **X** |

**Key observations:**
- Academic staff hold relevant qualifications (degree or higher) in their teaching disciplines
- Management Representative (MR) is designated and trained
- Staff training records are maintained centrally`;

type ProfileOfPeiActions = {
  setProvidedDate: (date: string) => void;
  setBackgroundMarkdown: (text: string) => void;
  setErfEduTrustStatus: (rows: PeiStatusRow[]) => void;
  setShareholders: (rows: ShareholderRow[]) => void;
  setBoardOfDirectors: (rows: PersonnelRow[]) => void;
  setManagementTeam: (rows: PersonnelRow[]) => void;
  setAcademicExamBoard: (rows: AcademicExamBoardRow[]) => void;
  setFacilities: (f: ProfileOfPeiState["facilities"]) => void;
  setFinancialHealthMarkdown: (text: string) => void;
  setCoursesOffered: (rows: PeiCourseRow[]) => void;
  updateCourse: (id: string, patch: Partial<PeiCourseRow>) => void;
  setStudentProfileMarkdown: (text: string) => void;
  setStaffProfileMarkdown: (text: string) => void;
};

export const useProfileOfPeiStore = create<ProfileOfPeiState & ProfileOfPeiActions>()(
  persist(
    (set, get) => ({
      providedDate: "07/04/26",
      backgroundMarkdown: SEED_BACKGROUND,
      erfEduTrustStatus: [
        { id: "e1", type: "EduTrust Certification", status: "Certified", expiryDate: "", remarks: "" },
        { id: "e2", type: "ERF Registration", status: "Registered", expiryDate: "", remarks: "" },
      ],
      keyPersonnel: {
        shareholders: [
          { id: "sh1", name: "", shares: 0, shareType: "Ordinary", percentage: 0 },
        ],
        boardOfDirectors: [
          { id: "bd1", name: "", designation: "Director" },
        ],
        managementTeam: [
          { id: "mt1", name: "", designation: "Chief Executive Officer" },
          { id: "mt2", name: "", designation: "Management Representative" },
        ],
        academicExamBoard: [
          { id: "ab1", name: "", designation: "", membership: "" },
        ],
      },
      facilities: {
        mainPremisesAddress: "51 Anson Road, Anson Centre",
        unitNumber: "#05-52",
        postalCode: "079904",
        sharedPremisesStatus: "Sole occupier of rented unit",
        facilitiesSummary: "",
        remarks: "",
      },
      financialHealthMarkdown: SEED_FINANCIAL,
      coursesOffered: SEED_COURSES,
      studentProfileMarkdown: SEED_STUDENT_PROFILE,
      staffProfileMarkdown: SEED_STAFF_PROFILE,

      setProvidedDate: (date) => set({ providedDate: date }),
      setBackgroundMarkdown: (text) => set({ backgroundMarkdown: text }),
      setErfEduTrustStatus: (rows) => set({ erfEduTrustStatus: rows }),
      setShareholders: (rows) => set((s) => ({ keyPersonnel: { ...s.keyPersonnel, shareholders: rows } })),
      setBoardOfDirectors: (rows) => set((s) => ({ keyPersonnel: { ...s.keyPersonnel, boardOfDirectors: rows } })),
      setManagementTeam: (rows) => set((s) => ({ keyPersonnel: { ...s.keyPersonnel, managementTeam: rows } })),
      setAcademicExamBoard: (rows) => set((s) => ({ keyPersonnel: { ...s.keyPersonnel, academicExamBoard: rows } })),
      setFacilities: (f) => set({ facilities: f }),
      setFinancialHealthMarkdown: (text) => set({ financialHealthMarkdown: text }),
      setCoursesOffered: (rows) => set({ coursesOffered: rows }),
      updateCourse: (id, patch) =>
        set((s) => ({ coursesOffered: s.coursesOffered.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      setStudentProfileMarkdown: (text) => set({ studentProfileMarkdown: text }),
      setStaffProfileMarkdown: (text) => set({ staffProfileMarkdown: text }),
    }),
    { name: "profile-of-pei-v2" }
  )
);
