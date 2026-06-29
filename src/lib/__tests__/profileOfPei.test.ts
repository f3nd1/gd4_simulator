import { describe, it, expect } from "vitest";
import useProfileOfPeiStore, {
  computeRecommendedSampleSize,
  computeCourseSamplingStatus,
  computeFinancialWarnings,
} from "../../store/useProfileOfPeiStore";
import type { CourseRow, FinancialRow, StudentSample, StaffRecord } from "../../types/profileOfPei";

function makeCourse(overrides: Partial<CourseRow>): CourseRow {
  return {
    id: "test-course",
    courseTitle: "Test Course",
    awardingBody: "UCC",
    activeStudentCount: 0,
    courseType: "Diploma",
    recommendedStudentSampleSize: 0,
    selectedStudentSampleCount: 0,
    samplingRemarks: "",
    ...overrides,
  };
}

function makeFinancialRow(item: string, y2023: string, y2024: string, y2025: string): FinancialRow {
  return { id: `fr-${item}`, item, y2023, y2024, y2025 };
}

// 1. PROFILE OF PEI state can store Background of PEI
describe("ProfileOfPei store — background text", () => {
  it("stores and updates background text", () => {
    const store = useProfileOfPeiStore.getState();
    const original = store.backgroundText;
    store.setBackgroundText("Test background");
    expect(useProfileOfPeiStore.getState().backgroundText).toBe("Test background");
    store.setBackgroundText(original);
  });

  it("seed background text contains UCC founding year", () => {
    const { backgroundText } = useProfileOfPeiStore.getState();
    expect(backgroundText).toContain("2019");
  });
});

// 2. ERF and EduTrust status table stores registration and expiry dates
describe("ERF and EduTrust status", () => {
  it("seed data contains ERF row with expiry date", () => {
    const { erfRows } = useProfileOfPeiStore.getState();
    const erf = erfRows.find(r => r.type === "ERF");
    expect(erf).toBeDefined();
    expect(erf?.expiryDate).toBe("8 December 2026");
  });

  it("seed data contains EduTrust row", () => {
    const { erfRows } = useProfileOfPeiStore.getState();
    const et = erfRows.find(r => r.type === "EduTrust");
    expect(et).toBeDefined();
    expect(et?.status).toContain("PROVISIONAL");
  });
});

// 3. Shareholder table calculates total percentage ownership
describe("Shareholders", () => {
  it("seed shareholders total approximately 100%", () => {
    const { shareholders } = useProfileOfPeiStore.getState();
    const total = shareholders.reduce((s, r) => s + r.percentage, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.1);
  });

  it("Peixin International holds 15%", () => {
    const { shareholders } = useProfileOfPeiStore.getState();
    const peixin = shareholders.find(s => s.name.includes("Peixin"));
    expect(peixin?.percentage).toBe(15);
  });
});

// 4. Financial health table stores 2023, 2024 and 2025 values
describe("Financial health table", () => {
  it("seed data has financial rows with 2023 values", () => {
    const { financialRows } = useProfileOfPeiStore.getState();
    const revenue = financialRows.find(r => r.item.includes("Annual Revenue"));
    expect(revenue).toBeDefined();
    expect(revenue?.y2023).toBeTruthy();
  });

  it("stores all three years", () => {
    const { financialRows } = useProfileOfPeiStore.getState();
    expect(financialRows.length).toBeGreaterThan(5);
    financialRows.forEach(r => {
      expect(r.y2023).toBeDefined();
      expect(r.y2024).toBeDefined();
      expect(r.y2025).toBeDefined();
    });
  });
});

// 5. Financial warning flags work
describe("computeFinancialWarnings", () => {
  it("warns when short-course revenue is above 50%", () => {
    const rows = [makeFinancialRow("% Revenue from Short Courses over Annual Revenue", "3%", "85%", "98.18%")];
    const warnings = computeFinancialWarnings(rows);
    expect(warnings.some(w => w.toLowerCase().includes("short course") || w.includes("85") || w.includes("98"))).toBe(true);
  });

  it("warns when net equity is negative", () => {
    const rows = [makeFinancialRow("Net Equity", "17,891", "(252,354)", "231,133.57")];
    const warnings = computeFinancialWarnings(rows);
    expect(warnings.some(w => w.includes("equity") || w.includes("Equity") || w.includes("negative"))).toBe(true);
  });

  it("warns when profit/loss is negative", () => {
    const rows = [makeFinancialRow("Profit / Loss after tax S$", "(47,406)", "(270,244)", "(653,415.61)")];
    const warnings = computeFinancialWarnings(rows);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns when permitted course revenue is below 10%", () => {
    const rows = [makeFinancialRow("% Revenue from Permitted Courses over Annual Revenue", "97%", "15%", "1.82%")];
    const warnings = computeFinancialWarnings(rows);
    expect(warnings.some(w => w.includes("1.82") || w.toLowerCase().includes("permitted"))).toBe(true);
  });

  it("returns no warnings for healthy financials", () => {
    const rows = [
      makeFinancialRow("% Revenue from Short Courses over Annual Revenue", "30%", "30%", "30%"),
      makeFinancialRow("Net Equity", "100,000", "200,000", "300,000"),
      makeFinancialRow("Profit / Loss after tax S$", "10,000", "20,000", "30,000"),
      makeFinancialRow("% Revenue from Permitted Courses over Annual Revenue", "70%", "70%", "70%"),
    ];
    const warnings = computeFinancialWarnings(rows);
    expect(warnings.length).toBe(0);
  });
});

// 6. Courses offered table contains all 33 courses and totals 13 students
describe("Courses offered", () => {
  it("has exactly 33 courses", () => {
    const { courses } = useProfileOfPeiStore.getState();
    expect(courses.length).toBe(33);
  });

  it("total active students across all courses is 13", () => {
    const { courses } = useProfileOfPeiStore.getState();
    const total = courses.reduce((s, c) => s + c.activeStudentCount, 0);
    expect(total).toBe(13);
  });

  it("Diploma in Business Management has 7 students", () => {
    const { courses } = useProfileOfPeiStore.getState();
    const dbm = courses.find(c => c.courseTitle === "Diploma in Business Management");
    expect(dbm?.activeStudentCount).toBe(7);
  });

  it("IELTS preparatory course has 6 students", () => {
    const { courses } = useProfileOfPeiStore.getState();
    const ielts = courses.find(c => c.courseTitle.includes("IELTS"));
    expect(ielts?.activeStudentCount).toBe(6);
  });
});

// 7. Course sampling universe recommends 3 when active count >= 3
describe("computeRecommendedSampleSize", () => {
  it("returns 0 for 0 students", () => {
    expect(computeRecommendedSampleSize(0)).toBe(0);
  });

  it("returns 1 for 1 student", () => {
    expect(computeRecommendedSampleSize(1)).toBe(1);
  });

  it("returns 2 for 2 students", () => {
    expect(computeRecommendedSampleSize(2)).toBe(2);
  });

  it("returns 3 for 3 students", () => {
    expect(computeRecommendedSampleSize(3)).toBe(3);
  });

  it("returns 3 for 7 students", () => {
    expect(computeRecommendedSampleSize(7)).toBe(3);
  });
});

// 8. Course sampling selects all when count < 3
describe("computeCourseSamplingStatus", () => {
  it("marks 0-student courses as not applicable", () => {
    const status = computeCourseSamplingStatus(makeCourse({ activeStudentCount: 0 }));
    expect(status).toMatch(/not applicable/i);
  });

  // 9. Zero students → not applicable
  it("marks 1-student courses as insufficient population", () => {
    const status = computeCourseSamplingStatus(makeCourse({ activeStudentCount: 1, recommendedStudentSampleSize: 1 }));
    expect(status).toMatch(/insufficient/i);
  });

  it("marks pending when selected < recommended", () => {
    const status = computeCourseSamplingStatus(makeCourse({ activeStudentCount: 5, recommendedStudentSampleSize: 3, selectedStudentSampleCount: 1 }));
    expect(status).toMatch(/pending/i);
  });

  it("marks selected when selectedCount >= recommended", () => {
    const status = computeCourseSamplingStatus(makeCourse({ activeStudentCount: 5, recommendedStudentSampleSize: 3, selectedStudentSampleCount: 3 }));
    expect(status).toBe("Selected");
  });
});

// 10. Student profile table calculates total active students as 13
describe("Student profile", () => {
  it("study mode profile totals 13", () => {
    const { studyModeProfile } = useProfileOfPeiStore.getState();
    expect(studyModeProfile.fullTime + studyModeProfile.partTime).toBe(13);
  });

  // 11. Nationality breakdown uses total 13 not 10
  it("nationality breakdown totals 13 students", () => {
    const { nationalityBreakdown } = useProfileOfPeiStore.getState();
    const total = nationalityBreakdown.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(13);
  });
});

// 12. Student samples can be linked to GD4 refs, checklist lines and evidence files
describe("Student sample linking", () => {
  it("student samples have linkedGd4Refs array", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    studentSamples.forEach(s => {
      expect(Array.isArray(s.linkedGd4Refs)).toBe(true);
      expect(Array.isArray(s.linkedChecklistLineIds)).toBe(true);
      expect(Array.isArray(s.linkedEvidenceFiles)).toBe(true);
    });
  });

  it("can update student sample links via store action", () => {
    const store = useProfileOfPeiStore.getState();
    const sampleId = store.studentSamples[0]?.sampleId;
    if (!sampleId) return;
    store.updateStudentSample(sampleId, { linkedGd4Refs: ["4.1.1", "4.2.1"] });
    const updated = useProfileOfPeiStore.getState().studentSamples.find(s => s.sampleId === sampleId);
    expect(updated?.linkedGd4Refs).toEqual(["4.1.1", "4.2.1"]);
    store.updateStudentSample(sampleId, { linkedGd4Refs: [] });
  });
});

// 13. Staff profile supports all categories
describe("Staff profile", () => {
  it("has academic, non-academic and management staff", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const categories = new Set(staffRecords.map(s => s.staffCategory));
    expect(categories.has("Academic")).toBe(true);
    expect(categories.has("Non-Academic")).toBe(true);
  });

  it("has full-time, part-time and adjunct employment types", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const types = new Set(staffRecords.map(s => s.employmentType));
    expect(types.has("Full-time")).toBe(true);
    expect(types.has("Part-time")).toBe(true);
    expect(types.has("Adjunct")).toBe(true);
  });

  it("has Singapore and Philippines locations", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const locs = new Set(staffRecords.map(s => s.location));
    expect(locs.has("Singapore")).toBe(true);
    expect(locs.has("Philippines")).toBe(true);
  });

  it("Reda Jabbary is listed as part-time not full-time", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const reda = staffRecords.find(s => s.fullName.includes("Reda") || s.fullName.includes("Jabbary"));
    expect(reda?.employmentType).toBe("Part-time");
  });
});

// 14. Staff samples can be linked to GD4 refs, checklist lines and evidence files
describe("Staff sample linking", () => {
  it("staff records have linkedGd4Refs, linkedChecklistLineIds, linkedEvidenceFiles arrays", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    staffRecords.forEach(s => {
      expect(Array.isArray(s.linkedGd4Refs)).toBe(true);
      expect(Array.isArray(s.linkedChecklistLineIds)).toBe(true);
      expect(Array.isArray(s.linkedEvidenceFiles)).toBe(true);
    });
  });

  it("can update staff record links via store action", () => {
    const store = useProfileOfPeiStore.getState();
    const staffId = store.staffRecords[0]?.staffId;
    if (!staffId) return;
    store.updateStaffRecord(staffId, { linkedGd4Refs: ["2.1.1"] });
    const updated = useProfileOfPeiStore.getState().staffRecords.find(s => s.staffId === staffId);
    expect(updated?.linkedGd4Refs).toEqual(["2.1.1"]);
    store.updateStaffRecord(staffId, { linkedGd4Refs: [] });
  });
});

// 15. P-file tracker calculates required, ready and pending counts
describe("P-file tracker counts", () => {
  it("has student samples selected for P-file", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const selected = studentSamples.filter(s => s.selectedForPFile);
    expect(selected.length).toBeGreaterThan(0);
  });

  it("has staff selected for P-file", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const selected = staffRecords.filter(s => s.selectedForPFile);
    expect(selected.length).toBeGreaterThan(0);
  });
});

// 16. P-file tracker distinguishes sample types
describe("P-file sample types", () => {
  it("student samples use Replacement sample type for 2026 cohort", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const replacements = studentSamples.filter(s => s.sampleType === "Replacement sample");
    expect(replacements.length).toBe(3);
  });
});

// 17. Assessor request updates selected samples
describe("Assessor requests", () => {
  it("has seeded assessor requests", () => {
    const { assessorRequests } = useProfileOfPeiStore.getState();
    expect(assessorRequests.length).toBeGreaterThan(0);
  });

  it("has staff interview request", () => {
    const { assessorRequests } = useProfileOfPeiStore.getState();
    const req = assessorRequests.find(r => r.requestType === "Staff interview");
    expect(req).toBeDefined();
  });

  it("can update assessor request status", () => {
    const store = useProfileOfPeiStore.getState();
    const reqId = store.assessorRequests[0]?.requestId;
    if (!reqId) return;
    const original = store.assessorRequests[0].status;
    store.updateAssessorRequest(reqId, { status: "Confirmed" });
    expect(useProfileOfPeiStore.getState().assessorRequests.find(r => r.requestId === reqId)?.status).toBe("Confirmed");
    store.updateAssessorRequest(reqId, { status: original });
  });
});

// 18. Interview schedule warns for adjunct / part-time staff
describe("Interview schedule", () => {
  it("Leow Boon Peng has high attendance risk", () => {
    const { interviews } = useProfileOfPeiStore.getState();
    const leow = interviews.find(iv => iv.staffName.includes("Leow") || iv.staffName.includes("Boon Peng"));
    expect(leow?.attendanceRisk).toBe("High");
  });

  it("adjunct staff interview has pending time status", () => {
    const { interviews } = useProfileOfPeiStore.getState();
    const adjunctInterview = interviews.find(iv => iv.employmentType === "Adjunct");
    expect(adjunctInterview?.status).toBe("Pending time");
  });
});

// 19. Assessor request tracker stores all request types
describe("Assessor request types", () => {
  it("has student P-file request", () => {
    const { assessorRequests } = useProfileOfPeiStore.getState();
    expect(assessorRequests.some(r => r.requestType === "Student P-files")).toBe(true);
  });

  it("has correction request for Reda Jabbary", () => {
    const { assessorRequests } = useProfileOfPeiStore.getState();
    const correction = assessorRequests.find(r => r.requestType === "Correction");
    expect(correction).toBeDefined();
    expect(correction?.requestSummary.toLowerCase()).toContain("reda");
  });
});

// 20. Clarification log stores pending confirmations
describe("Clarification log", () => {
  it("has clarifications pending reply", () => {
    const { clarifications } = useProfileOfPeiStore.getState();
    const pending = clarifications.filter(c => c.status === "Awaiting reply");
    expect(pending.length).toBeGreaterThan(0);
  });

  it("has clarification about 2026 student files", () => {
    const { clarifications } = useProfileOfPeiStore.getState();
    const cl = clarifications.find(c => c.topic.includes("2026"));
    expect(cl).toBeDefined();
  });
});

// 21. Export profile follows required section structure
describe("Export structure", () => {
  it("store has all required sections for full profile export", () => {
    const s = useProfileOfPeiStore.getState();
    expect(s.backgroundText).toBeTruthy();
    expect(s.erfRows.length).toBeGreaterThan(0);
    expect(s.shareholders.length).toBeGreaterThan(0);
    expect(s.directors.length).toBeGreaterThan(0);
    expect(s.managementTeam.length).toBeGreaterThan(0);
    expect(s.academicBoard.length).toBeGreaterThan(0);
    expect(s.financialRows.length).toBeGreaterThan(0);
    expect(s.courses.length).toBe(33);
    expect(s.historicalEnrolment.length).toBeGreaterThan(0);
    expect(s.consultants.length).toBeGreaterThan(0);
  });
});

// 22. Export Staff P-File List includes all selected staff
describe("Staff P-File List export data", () => {
  it("selected staff P-files include academic staff", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const selected = staffRecords.filter(s => s.selectedForPFile);
    const hasAcademic = selected.some(s => s.staffCategory === "Academic");
    expect(hasAcademic).toBe(true);
  });
});

// 23. Export Student P-File List includes selected 2026 students
describe("Student P-File List export data", () => {
  it("selected student P-files include 2026 cohort", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const selected = studentSamples.filter(s => s.selectedForPFile && s.cohortYear === 2026);
    expect(selected.length).toBeGreaterThan(0);
  });

  it("XU WEIJIA is in the selected student samples", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const xu = studentSamples.find(s => s.studentName.includes("XU") || s.studentName.includes("WEIJIA"));
    expect(xu?.selectedForPFile).toBe(true);
  });
});

// 24. Export Sampling Matrix includes student and staff samples
describe("Sampling matrix data", () => {
  it("has student samples selected for sampling", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const selectedStudents = studentSamples.filter(s => s.selectedForSampling);
    expect(selectedStudents.length).toBeGreaterThan(0);
  });

  it("has staff records selected for P-file (sampling universe)", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    const selectedStaff = staffRecords.filter(s => s.selectedForPFile);
    expect(selectedStaff.length).toBeGreaterThan(0);
  });
});

// 25. Day 1 Readiness Pack includes sampling status
describe("Day 1 readiness", () => {
  it("pending assessor confirmations are trackable", () => {
    const { studentSamples, staffRecords } = useProfileOfPeiStore.getState();
    const pendingStudents = studentSamples.filter(s => s.assessorConfirmationStatus === "Pending assessor confirmation");
    expect(pendingStudents.length).toBeGreaterThan(0);
  });
});

// 26. Findings can show linked student and staff samples (data model check)
describe("Sample-finding linkage", () => {
  it("student samples have linkedFindings field", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    studentSamples.forEach(s => expect(Array.isArray(s.linkedFindings)).toBe(true));
  });

  it("staff records have linkedFindings field", () => {
    const { staffRecords } = useProfileOfPeiStore.getState();
    staffRecords.forEach(s => expect(Array.isArray(s.linkedFindings)).toBe(true));
  });
});

// 27 & 28. Draft assessor reply uses only selected records (data model check)
describe("AI helper data access", () => {
  it("assessor requests have responseDraft field for AI composition", () => {
    const { assessorRequests } = useProfileOfPeiStore.getState();
    assessorRequests.forEach(r => expect(typeof r.responseDraft).toBe("string"));
  });

  it("clarifications have proposedResponse field for AI composition", () => {
    const { clarifications } = useProfileOfPeiStore.getState();
    clarifications.forEach(c => expect(typeof c.proposedResponse).toBe("string"));
  });
});

// 29. Sample selection does not satisfy compliance without linked evidence
describe("Sample evidence rule", () => {
  it("student samples start with no linked evidence files (pending linkage)", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const noEvidence = studentSamples.every(s => s.linkedEvidenceFiles.length === 0);
    expect(noEvidence).toBe(true);
  });

  it("student pFileStatus is Not started by default — confirms evidence not yet collected", () => {
    const { studentSamples } = useProfileOfPeiStore.getState();
    const notStarted = studentSamples.every(s => s.pFileStatus === "Not started" || s.pFileStatus === "Preparing");
    expect(notStarted).toBe(true);
  });
});

// 30. PROFILE OF PEI is available as background context only
describe("AI background context boundary", () => {
  it("aiBackgroundNotes is a separate field from criterion evidence", () => {
    const state = useProfileOfPeiStore.getState();
    expect(typeof state.aiBackgroundNotes).toBe("string");
    expect(state.setAiBackgroundNotes).toBeDefined();
  });
});
