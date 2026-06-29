// Core status types
export type SampleStatus = "Proposed" | "Pending assessor confirmation" | "Confirmed" | "Rejected" | "Not required";
export type PFileStatus = "Not started" | "Preparing" | "Ready" | "Submitted" | "Not applicable";
export type InterviewStatus = "Pending time" | "Scheduled" | "Completed" | "Rescheduled" | "Cancelled";
export type AttendanceRisk = "Low" | "Medium" | "High";
export type RequestType = "Staff interview" | "Staff P-files" | "Student P-files" | "School background" | "PROFILE OF PEI" | "Additional document" | "Clarification" | "Correction" | "Sampling";
export type RequestStatus = "Open" | "Pending confirmation" | "Confirmed" | "Completed" | "Superseded";
export type ClarificationStatus = "Draft" | "Sent" | "Awaiting reply" | "Confirmed" | "Closed";
export type SampleType = "Assessor sample" | "Internal sample" | "Replacement sample" | "Full population request";

export type ErfEdutrustRow = { id: string; type: string; status: string; expiryDate: string; remarks: string; };
export type ShareholderRow = { id: string; name: string; shares: number; shareType: string; percentage: number; };
export type DirectorRow = { id: string; name: string; designation: string; };
export type ManagementRow = { id: string; name: string; designation: string; };
export type AcademicBoardRow = { id: string; name: string; designation: string; membership: string; };
export type FacilitiesInfo = { address: string; unitNumber: string; postalCode: string; sharedPremises: string; summary: string; remarks: string; };
export type FinancialRow = { id: string; item: string; y2023: string; y2024: string; y2025: string; };
export type NationalityRow = { id: string; nationality: string; count: number; percentage: number; };
export type ConsultantRow = { id: string; name: string; period: string; roleScope: string; remarks: string; };
export type HistoricalEnrolmentRow = { category: string; y2023: number; y2024: number; y2025: number; };

export type CourseRow = {
  id: string;
  courseTitle: string;
  awardingBody: string;
  activeStudentCount: number;
  courseType: string;
  recommendedStudentSampleSize: number;
  selectedStudentSampleCount: number;
  samplingRemarks: string;
};

export type StudentSample = {
  sampleId: string;
  studentName: string;
  nationality: string;
  courseId: string;
  courseEnrolledIn: string;
  courseType: string;
  studyMode: "Full-time" | "Part-time";
  cohortYear: number;
  enrolledSince: string;
  studentPassHolder: boolean;
  selectedForPFile: boolean;
  selectedForSampling: boolean;
  sampleReason: string;
  linkedGd4Refs: string[];
  linkedChecklistLineIds: string[];
  linkedEvidenceFiles: string[];
  linkedFindings: string[];
  pFileStatus: PFileStatus;
  sampleType: SampleType;
  assessorConfirmationStatus: SampleStatus;
  linkedAssessorRequestId: string;
  linkedClarificationId: string;
  missingItems: string[];
  readyForDay1: boolean;
  remarks: string;
};

export type StaffRecord = {
  staffId: string;
  fullName: string;
  displayName: string;
  role: string;
  department: string;
  staffCategory: "Academic" | "Non-Academic" | "Management" | "Support";
  employmentType: "Full-time" | "Part-time" | "Adjunct" | "Contract" | "Offshore";
  location: "Singapore" | "Philippines" | "Remote" | "Other";
  onsiteDuringAssessment: "Yes" | "No" | "Not applicable";
  selectedForInterview: boolean;
  selectedForPFile: boolean;
  selectedForSampling: boolean;
  sampleReason: string;
  linkedGd4Refs: string[];
  linkedChecklistLineIds: string[];
  linkedEvidenceFiles: string[];
  linkedFindings: string[];
  pFileStatus: PFileStatus;
  sampleType: SampleType;
  interviewRequired: boolean;
  interviewStatus: InterviewStatus;
  assessorConfirmationStatus: SampleStatus;
  linkedAssessorRequestId: string;
  linkedClarificationId: string;
  missingItems: string[];
  readyForDay1: boolean;
  remarks: string;
};

export type AssessorRequest = {
  requestId: string;
  requestDate: string;
  requestedBy: string;
  requestType: RequestType;
  requestSummary: string;
  requiredCount: number;
  selectedRecords: string[];
  linkedStudentSampleIds: string[];
  linkedStaffIds: string[];
  status: RequestStatus;
  responseDraft: string;
  finalResponse: string;
  dueDate: string;
  remarks: string;
};

export type InterviewRecord = {
  interviewId: string;
  staffId: string;
  staffName: string;
  role: string;
  employmentType: string;
  location: string;
  interviewDate: string;
  interviewTime: string;
  mode: "Onsite" | "Online" | "Phone";
  assessor: string;
  status: InterviewStatus;
  attendanceRisk: AttendanceRisk;
  remarks: string;
};

export type ClarificationRecord = {
  clarificationId: string;
  date: string;
  topic: string;
  question: string;
  proposedResponse: string;
  finalResponse: string;
  status: ClarificationStatus;
  relatedRequestId: string;
  relatedStaffIds: string[];
  relatedStudentSampleIds: string[];
  remarks: string;
};

export type ProfileOfPeiState = {
  backgroundText: string;
  erfRows: ErfEdutrustRow[];
  shareholders: ShareholderRow[];
  directors: DirectorRow[];
  managementTeam: ManagementRow[];
  academicBoard: AcademicBoardRow[];
  facilities: FacilitiesInfo;
  financialRows: FinancialRow[];
  courses: CourseRow[];
  historicalEnrolment: HistoricalEnrolmentRow[];
  studyModeProfile: { fullTime: number; partTime: number; };
  passStatusProfile: { sc: number; pr: number; studentPass: number; dependantPass: number; diplomaticPass: number; employmentPass: number; ltv: number; others: number; };
  nationalityBreakdown: NationalityRow[];
  studentSamples: StudentSample[];
  staffRecords: StaffRecord[];
  consultants: ConsultantRow[];
  assessorRequests: AssessorRequest[];
  interviews: InterviewRecord[];
  clarifications: ClarificationRecord[];
  aiBackgroundNotes: string;
};
