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
  { id: "c01", courseName: "Advanced Diploma in Applied Artificial Intelligence (AI)", department: DEPT, abbreviation: "ADAAI", ftContactHours: "144", ptContactHours: "144", ftMonths: "8" },
  { id: "c02", courseName: "Advanced Diploma in Business Administration", department: DEPT, abbreviation: "ADBA", ftContactHours: "216", ptContactHours: "216", ftMonths: "8" },
  { id: "c03", courseName: "Certificate in English Language", department: DEPT, abbreviation: "CEL", ftContactHours: "240", ptContactHours: "", ftMonths: "6" },
  { id: "c04", courseName: "Certificate in English Level 1", department: DEPT, abbreviation: "CEL1", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c05", courseName: "Certificate in English Level 2", department: DEPT, abbreviation: "CEL2", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c06", courseName: "Certificate in English Level 3", department: DEPT, abbreviation: "CEL3", ftContactHours: "120", ptContactHours: "72", ftMonths: "3" },
  { id: "c07", courseName: "Certificate in General Management", department: DEPT, abbreviation: "CGM", ftContactHours: "160", ptContactHours: "96", ftMonths: "6" },
  { id: "c08", courseName: "Certificate in General Management (E-Learning)", department: DEPT, abbreviation: "CGM-E", ftContactHours: "", ptContactHours: "96", ftMonths: "" },
  { id: "c09", courseName: "Certificate in General Management (Mandarin)", department: DEPT, abbreviation: "CGM(M)", ftContactHours: "160", ptContactHours: "96", ftMonths: "6" },
  { id: "c10", courseName: "Certificate in General Management (Mandarin) (E-Learning)", department: DEPT, abbreviation: "CGM(M)-E", ftContactHours: "", ptContactHours: "96", ftMonths: "" },
  { id: "c11", courseName: "Diploma in Applied Artificial Intelligence (AI)", department: DEPT, abbreviation: "DAAI", ftContactHours: "216", ptContactHours: "216", ftMonths: "8" },
  { id: "c12", courseName: "Diploma in Business Management", department: DEPT, abbreviation: "DBM", ftContactHours: "320", ptContactHours: "192", ftMonths: "8" },
  { id: "c13", courseName: "Diploma in Business Management (E-Learning)", department: DEPT, abbreviation: "DBM-E", ftContactHours: "", ptContactHours: "192", ftMonths: "" },
  { id: "c14", courseName: "Diploma in Business Management (Mandarin)", department: DEPT, abbreviation: "DBM(M)", ftContactHours: "320", ptContactHours: "192", ftMonths: "8" },
  { id: "c15", courseName: "Diploma in Business Management (Mandarin) (E-Learning)", department: DEPT, abbreviation: "DBM(M)-E", ftContactHours: "", ptContactHours: "192", ftMonths: "" },
  { id: "c16", courseName: "Diploma in Tourism and Hospitality Management", department: DEPT, abbreviation: "DTHM", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c17", courseName: "Diploma in Tourism and Hospitality Management (E-Learning)", department: DEPT, abbreviation: "DTHM-E", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c18", courseName: "Diploma in Tourism and Hospitality Management (Mandarin)", department: DEPT, abbreviation: "DTHM(M)", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c19", courseName: "Diploma in Tourism and Hospitality Management (Mandarin) (E-Learning)", department: DEPT, abbreviation: "DTHM(M)-E", ftContactHours: "", ptContactHours: "144", ftMonths: "" },
  { id: "c20", courseName: "Postgraduate Certificate in Business Administration", department: DEPT, abbreviation: "PGC", ftContactHours: "240", ptContactHours: "208", ftMonths: "4" },
  { id: "c21", courseName: "Postgraduate Certificate in Business Administration (Mandarin)", department: DEPT, abbreviation: "PGC(M)", ftContactHours: "240", ptContactHours: "208", ftMonths: "4" },
  { id: "c22", courseName: "Postgraduate Diploma in Business Administration", department: DEPT, abbreviation: "PGD", ftContactHours: "480", ptContactHours: "416", ftMonths: "8" },
  { id: "c23", courseName: "Postgraduate Diploma in Business Administration (Mandarin)", department: DEPT, abbreviation: "PGD(M)", ftContactHours: "480", ptContactHours: "416", ftMonths: "8" },
  { id: "c24", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Primary 2", department: DEPT, abbreviation: "AEIS-P2", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c25", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Primary 3", department: DEPT, abbreviation: "AEIS-P3", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c26", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Primary 4", department: DEPT, abbreviation: "AEIS-P4", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c27", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Primary 5", department: DEPT, abbreviation: "AEIS-P5", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c28", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Secondary 1", department: DEPT, abbreviation: "AEIS-S1", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c29", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Secondary 2", department: DEPT, abbreviation: "AEIS-S2", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c30", courseName: "Preparatory Course for Admission Exercise for International Students (AEIS) - Secondary 3", department: DEPT, abbreviation: "AEIS-S3", ftContactHours: "720", ptContactHours: "NA", ftMonths: "6" },
  { id: "c31", courseName: "Preparatory Course for International English Language Testing System (IELTS)", department: DEPT, abbreviation: "IELTS", ftContactHours: "240", ptContactHours: "NA", ftMonths: "6" },
  { id: "c32", courseName: "Preparatory Course for Singapore-Cambridge General Certificate of Education Advanced Level (GCE A-Level)", department: DEPT, abbreviation: "GCE-AL", ftContactHours: "2880", ptContactHours: "NA", ftMonths: "24" },
  { id: "c33", courseName: "Preparatory Course for Singapore-Cambridge General Certificate of Education Ordinary Level (GCE O-Level)", department: DEPT, abbreviation: "GCE-OL", ftContactHours: "2880", ptContactHours: "NA", ftMonths: "24" },
];

const SEED_BACKGROUND = `United Ceres College (UCC) was established and registered with ACRA on 7 October 2019 by Liu Shanshan and Zhang Pengxuan, who served as founding shareholders and directors on a part-time basis. During its initial phase, the institution operated with a lean structure, with Felix overseeing key functions including academic development, regulatory compliance, system implementation, and daily operations.

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

const SEED_FINANCIAL = `The financial statement for the latest three years is as follows:

| | 2023 (FY End 30-Sep-23) | 2024 (FY End 30-Sep-24) | 2025 (FY End 30-Sep-25) |
|---|---|---|---|
| Annual Revenue S$ | 47,964 | 109,483 | 134,724 |
| Revenue from Permitted Courses S$ | 46,570.40 | 16,922.50 | 2,457.50 |
| % Revenue from Permitted Courses over Annual Revenue | 97% | 15% | 1.82% |
| Revenue from Short Courses S$ | 1,393.60 | 92,560.50 | 132,266.50 |
| % Revenue from Short Courses over Annual Revenue | 3% | 85% | 98.18% |
| Other Revenue S$ | — | 7,298 (Govt grant) | — |
| % Other Revenue over Annual Revenue | — | — | — |
| **Total Expenditure S$** | **95,770** | **387,024** | **790,139.76** |
| Top Expenditure Items | 1. Operating Expenses 2. Salary / Trainer Fee | 1. Director – Wages & Salaries 2. Professional Lecturer Fee (Academic) 3. Wages & Salaries 4. Freelancer / IT Support | 1. Salary – Permanent Staff (Academic & Non-Academic) 2. Professional Lecturer Fee (Academic) 3. Directors' Salary 4. Professional Fees (Non-Academic) 5. IT Support Expenses |
| **Profit / (Loss) after tax S$** | **(47,406)** | **(270,244)** | **(653,415.61)** |
| **Net Equity S$** | **17,891** | **(252,354)** | **231,133.57** |`;

const SEED_STUDENT_PROFILE = `**Historical enrolment (permitted and short courses):**

| | 2023 | 2024 | 2025 |
|---|---|---|---|
| No. of students enrolled in permitted courses | 10 | 2 | 4 |
| No. of students enrolled in short courses | 5 | 89 | 103 |
| **Total number of students** | **15** | **91** | **107** |

---

**Current active students in SSG-permitted courses:**

| Full-time | Part-time | Total |
|---|---|---|
| 12 | 1 | 13 |

| SC | PR | Student's Pass Holders | Dependent Pass | Diplomatic Pass | Employment Pass | Long Term Visit Pass | Total |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 10 | 0 | 0 | 0 | 1 | 13 |

**Nationality breakdown:**

| S/N | Nationality | No. of Students | % of Students |
|---|---|---|---|
| 1 | Chinese | 11 | 84.62% |
| 2 | Burmese | 1 | 7.69% |
| 3 | Moroccan | 1 | 7.69% |
| **Total** | | **13** | **100%** |

**Course enrolment (current):**

| S/N | Course | No. of Students | % of Students |
|---|---|---|---|
| 12 | Diploma in Business Management | 7 | 53.85% |
| 31 | Preparatory Course for IELTS | 6 | 46.15% |
| — | All other permitted courses | 0 | 0% |
| | **Total** | **13** | **100%** |`;

const SEED_STAFF_PROFILE = `Operationally, the organisation has scaled from an initial team of three personnel to a structured workforce comprising five staff members based in Singapore and ten offshore personnel in the Philippines, including four full-time staff and six part-time personnel. The Singapore team focuses on student-facing and academic functions, while the Philippines team supports backend administration and system development.

**Singapore-based staff (5):**

| Name | Designation | Employment Type |
|---|---|---|
| Felix Oking | Principal | Full-time |
| Dr. Yasser Mattar | Academic Director | Full-time |
| Renzo Demie V Delenio | IT Manager | Full-time |
| | | |
| | | |

**Philippines-based staff (10):**

| Role | Full-time | Part-time |
|---|---|---|
| Backend Administration | | |
| System Development | | |
| **Total** | **4** | **6** |

**Management Representative (MR):** Felix Oking (Principal)

**Third-party consultants / advisors for EduTrust assessment:** N.A.`;

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
        { id: "e1", type: "ERF", status: "4-YEAR REGISTRATION*", expiryDate: "8 December 2026", remarks: "Reg No. 201933634H (valid from 9/12/2022)" },
        { id: "e2", type: "EduTrust", status: "EDUTRUST PROVISIONAL*", expiryDate: "17 July 2026", remarks: "*Delete inapplicable option accordingly" },
      ],
      keyPersonnel: {
        shareholders: [
          { id: "sh1", name: "Peixin International Pte. Ltd.", shares: 17647, shareType: "Ordinary", percentage: 15 },
          { id: "sh2", name: "Feng Xiaocong", shares: 30000, shareType: "Ordinary", percentage: 25.5 },
          { id: "sh3", name: "Liu Shanshan", shares: 35000, shareType: "Ordinary", percentage: 29.75 },
          { id: "sh4", name: "Zhang Pengxuan", shares: 35000, shareType: "Ordinary", percentage: 29.75 },
        ],
        boardOfDirectors: [
          { id: "bd1", name: "Felix Oking", designation: "Principal" },
          { id: "bd2", name: "", designation: "" },
        ],
        managementTeam: [
          { id: "mt1", name: "Felix Oking", designation: "Principal" },
          { id: "mt2", name: "Dr. Yasser Mattar", designation: "Academic Director" },
          { id: "mt3", name: "Renzo Demie V Delenio", designation: "IT Manager" },
        ],
        academicExamBoard: [
          { id: "ab1", name: "Felix Oking", designation: "Chairman", membership: "AB and EB" },
          { id: "ab2", name: "Liu Shanshan", designation: "Member", membership: "AB and EB" },
          { id: "ab3", name: "Dr Yasser Mattar", designation: "Member", membership: "AB and EB" },
          { id: "ab4", name: "Wei Ruixue", designation: "Member", membership: "AB and EB" },
          { id: "ab5", name: "", designation: "", membership: "" },
          { id: "ab6", name: "", designation: "", membership: "" },
        ],
      },
      facilities: {
        mainPremisesAddress: "37 Middle Road, UWEEI Building",
        unitNumber: "#05-00",
        postalCode: "188946",
        sharedPremisesStatus: "Sole occupier of rented floor within commercial building",
        facilitiesSummary: "Strategically located near the CBD, directly across from the Singapore National Library. Teaching rooms: Room 1 (30.50 m², 20 seats), Room 2 (22.50 m², 20 seats), Room 4 (37.83 m², 25 seats). Other spaces: Student Lounge, Hallway. Each classroom has teaching equipment and is configured for effective learning. Tel: (65) 8699 3609 | Email: enquiry@unitedceres.edu.sg",
        remarks: "Certifications: ISO 9001:2015, BizSAFE Level 3, Cyber Essentials; implementing ISO/IEC 27001:2022; DPTM application pending IMDA review",
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
