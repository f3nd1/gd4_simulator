export type PeiStatusRow = { id: string; type: string; status: string; expiryDate: string; remarks: string; };
export type ShareholderRow = { id: string; name: string; shares: number; shareType: string; percentage: number; };
export type PersonnelRow = { id: string; name: string; designation: string; };
export type AcademicExamBoardRow = { id: string; name: string; designation: string; membership: string; };
export type PeiCourseRow = {
  id: string;
  courseName: string;
  department: string;
  abbreviation: string;
  ftContactHours: string;
  ptContactHours: string;
  ftMonths: string;
};

export type ProfileOfPeiState = {
  providedDate: string;
  backgroundMarkdown: string;
  erfEduTrustStatus: PeiStatusRow[];
  keyPersonnel: {
    shareholders: ShareholderRow[];
    boardOfDirectors: PersonnelRow[];
    managementTeam: PersonnelRow[];
    academicExamBoard: AcademicExamBoardRow[];
  };
  facilities: {
    mainPremisesAddress: string;
    unitNumber: string;
    postalCode: string;
    sharedPremisesStatus: string;
    facilitiesSummary: string;
    remarks: string;
  };
  financialHealthMarkdown: string;
  coursesOffered: PeiCourseRow[];
  studentProfileMarkdown: string;
  staffProfileMarkdown: string;
};
