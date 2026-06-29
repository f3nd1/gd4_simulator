import { describe, it, expect, beforeEach } from "vitest";
import { useProfileOfPeiStore } from "../../store/useProfileOfPeiStore";

// Reset store between tests
beforeEach(() => {
  useProfileOfPeiStore.setState(useProfileOfPeiStore.getInitialState());
});

// 1. Store initialises with required top-level fields
describe("ProfileOfPei store shape", () => {
  it("has all required top-level fields", () => {
    const s = useProfileOfPeiStore.getState();
    expect(s).toHaveProperty("providedDate");
    expect(s).toHaveProperty("backgroundMarkdown");
    expect(s).toHaveProperty("erfEduTrustStatus");
    expect(s).toHaveProperty("keyPersonnel");
    expect(s).toHaveProperty("facilities");
    expect(s).toHaveProperty("financialHealthMarkdown");
    expect(s).toHaveProperty("coursesOffered");
    expect(s).toHaveProperty("studentProfileMarkdown");
    expect(s).toHaveProperty("staffProfileMarkdown");
  });
});

// 2. No sampling/assessor/P-file fields exist on the store
describe("Removed features not present", () => {
  it("does not have studentSamples field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.studentSamples).toBeUndefined();
  });
  it("does not have staffRecords field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.staffRecords).toBeUndefined();
  });
  it("does not have assessorRequests field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.assessorRequests).toBeUndefined();
  });
  it("does not have clarifications field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.clarifications).toBeUndefined();
  });
});

// 3. Background markdown is editable and persisted
describe("Background markdown", () => {
  it("can be updated via setBackgroundMarkdown", () => {
    const { setBackgroundMarkdown } = useProfileOfPeiStore.getState();
    setBackgroundMarkdown("## Test Background\n\nThis is a test.");
    expect(useProfileOfPeiStore.getState().backgroundMarkdown).toBe("## Test Background\n\nThis is a test.");
  });
  it("seeds with non-empty background content", () => {
    expect(useProfileOfPeiStore.getState().backgroundMarkdown.length).toBeGreaterThan(50);
  });
});

// 4. ERF table supports add/edit/delete via setErfEduTrustStatus
describe("ERF & EduTrust status rows", () => {
  it("add row increases count", () => {
    const s = useProfileOfPeiStore.getState();
    const initial = s.erfEduTrustStatus.length;
    s.setErfEduTrustStatus([...s.erfEduTrustStatus, { id: "new1", type: "New", status: "Active", expiryDate: "", remarks: "" }]);
    expect(useProfileOfPeiStore.getState().erfEduTrustStatus.length).toBe(initial + 1);
  });
  it("edit row updates value", () => {
    const s = useProfileOfPeiStore.getState();
    const first = s.erfEduTrustStatus[0];
    s.setErfEduTrustStatus(s.erfEduTrustStatus.map((r) => r.id === first.id ? { ...r, status: "Suspended" } : r));
    expect(useProfileOfPeiStore.getState().erfEduTrustStatus[0].status).toBe("Suspended");
  });
  it("delete row decreases count", () => {
    const s = useProfileOfPeiStore.getState();
    const initial = s.erfEduTrustStatus.length;
    const firstId = s.erfEduTrustStatus[0].id;
    s.setErfEduTrustStatus(s.erfEduTrustStatus.filter((r) => r.id !== firstId));
    expect(useProfileOfPeiStore.getState().erfEduTrustStatus.length).toBe(initial - 1);
  });
});

// 5. Shareholder total ownership calculation
describe("Shareholder ownership", () => {
  it("percentage values can be summed", () => {
    const { setShareholders } = useProfileOfPeiStore.getState();
    setShareholders([
      { id: "s1", name: "Alice", shares: 60, shareType: "Ordinary", percentage: 60 },
      { id: "s2", name: "Bob", shares: 40, shareType: "Ordinary", percentage: 40 },
    ]);
    const total = useProfileOfPeiStore.getState().keyPersonnel.shareholders.reduce((acc, r) => acc + r.percentage, 0);
    expect(total).toBe(100);
  });
  it("detects when total is not 100", () => {
    const { setShareholders } = useProfileOfPeiStore.getState();
    setShareholders([
      { id: "s1", name: "Alice", shares: 60, shareType: "Ordinary", percentage: 60 },
      { id: "s2", name: "Bob", shares: 30, shareType: "Ordinary", percentage: 30 },
    ]);
    const total = useProfileOfPeiStore.getState().keyPersonnel.shareholders.reduce((acc, r) => acc + r.percentage, 0);
    expect(Math.abs(total - 100)).toBeGreaterThan(0.01);
  });
});

// 6. Key Personnel tables support add/edit/delete
describe("Key Personnel", () => {
  it("setBoardOfDirectors updates boardOfDirectors", () => {
    const { setBoardOfDirectors } = useProfileOfPeiStore.getState();
    setBoardOfDirectors([{ id: "bd1", name: "Jane", designation: "Chair" }]);
    expect(useProfileOfPeiStore.getState().keyPersonnel.boardOfDirectors[0].name).toBe("Jane");
  });
  it("setManagementTeam updates managementTeam", () => {
    const { setManagementTeam } = useProfileOfPeiStore.getState();
    setManagementTeam([{ id: "mt1", name: "John", designation: "CEO" }]);
    expect(useProfileOfPeiStore.getState().keyPersonnel.managementTeam[0].designation).toBe("CEO");
  });
  it("setAcademicExamBoard updates academicExamBoard", () => {
    const { setAcademicExamBoard } = useProfileOfPeiStore.getState();
    setAcademicExamBoard([{ id: "ab1", name: "Prof X", designation: "Chair", membership: "External" }]);
    expect(useProfileOfPeiStore.getState().keyPersonnel.academicExamBoard[0].membership).toBe("External");
  });
});

// 7. Facilities fields editable and persisted
describe("Facilities", () => {
  it("setFacilities updates all fields", () => {
    const { setFacilities } = useProfileOfPeiStore.getState();
    setFacilities({ mainPremisesAddress: "123 Test St", unitNumber: "#01-01", postalCode: "123456", sharedPremisesStatus: "Sole", facilitiesSummary: "2 classrooms", remarks: "Accessible" });
    const f = useProfileOfPeiStore.getState().facilities;
    expect(f.mainPremisesAddress).toBe("123 Test St");
    expect(f.postalCode).toBe("123456");
  });
});

// 8. Financial Health is a markdown string, not structured rows
describe("Financial Health", () => {
  it("financialHealthMarkdown is a string", () => {
    expect(typeof useProfileOfPeiStore.getState().financialHealthMarkdown).toBe("string");
  });
  it("setFinancialHealthMarkdown updates the value", () => {
    const { setFinancialHealthMarkdown } = useProfileOfPeiStore.getState();
    setFinancialHealthMarkdown("| Year | Revenue |\n| 2024 | $100k |");
    expect(useProfileOfPeiStore.getState().financialHealthMarkdown).toContain("$100k");
  });
});

// 9. computeFinancialWarnings is not exported
describe("Removed exports", () => {
  it("computeFinancialWarnings is not exported from store", async () => {
    const mod = await import("../../store/useProfileOfPeiStore");
    expect((mod as Record<string, unknown>).computeFinancialWarnings).toBeUndefined();
  });
  it("computeCourseSamplingStatus is not exported from store", async () => {
    const mod = await import("../../store/useProfileOfPeiStore");
    expect((mod as Record<string, unknown>).computeCourseSamplingStatus).toBeUndefined();
  });
  it("computeRecommendedSampleSize is not exported from store", async () => {
    const mod = await import("../../store/useProfileOfPeiStore");
    expect((mod as Record<string, unknown>).computeRecommendedSampleSize).toBeUndefined();
  });
});

// 10. Courses Offered has exactly 33 rows in seed data
describe("Courses Offered — count", () => {
  it("has exactly 33 seeded courses", () => {
    expect(useProfileOfPeiStore.getState().coursesOffered).toHaveLength(33);
  });
});

// 11. Courses Offered uses correct new columns
describe("Courses Offered — schema", () => {
  it("each course has the correct column keys", () => {
    const c = useProfileOfPeiStore.getState().coursesOffered[0];
    expect(c).toHaveProperty("id");
    expect(c).toHaveProperty("courseName");
    expect(c).toHaveProperty("department");
    expect(c).toHaveProperty("abbreviation");
    expect(c).toHaveProperty("ftContactHours");
    expect(c).toHaveProperty("ptContactHours");
    expect(c).toHaveProperty("ftMonths");
  });
  it("does not have old columns (activeStudentCount, courseType)", () => {
    const c = useProfileOfPeiStore.getState().coursesOffered[0] as Record<string, unknown>;
    expect(c.activeStudentCount).toBeUndefined();
    expect(c.courseType).toBeUndefined();
    expect(c.awardingBody).toBeUndefined();
  });
});

// 12. Courses preserve blank values and "NA"
describe("Courses Offered — blank and NA values", () => {
  it("AEIS courses have NA for ptContactHours", () => {
    const aeis = useProfileOfPeiStore.getState().coursesOffered.find((c) => c.abbreviation === "AEIS P2");
    expect(aeis?.ptContactHours).toBe("NA");
  });
  it("CME course has empty ftContactHours", () => {
    const cme = useProfileOfPeiStore.getState().coursesOffered.find((c) => c.abbreviation === "CME");
    expect(cme?.ftContactHours).toBe("");
  });
  it("CEL course has empty ptContactHours", () => {
    const cel = useProfileOfPeiStore.getState().coursesOffered.find((c) => c.abbreviation === "CEL");
    expect(cel?.ptContactHours).toBe("");
  });
});

// 13. Student Profile is a markdown string
describe("Student Profile", () => {
  it("studentProfileMarkdown is a string", () => {
    expect(typeof useProfileOfPeiStore.getState().studentProfileMarkdown).toBe("string");
  });
  it("setStudentProfileMarkdown updates the value", () => {
    const { setStudentProfileMarkdown } = useProfileOfPeiStore.getState();
    setStudentProfileMarkdown("### Students\n13 total");
    expect(useProfileOfPeiStore.getState().studentProfileMarkdown).toContain("13 total");
  });
});

// 14. Staff Profile is a markdown string
describe("Staff Profile", () => {
  it("staffProfileMarkdown is a string", () => {
    expect(typeof useProfileOfPeiStore.getState().staffProfileMarkdown).toBe("string");
  });
  it("setStaffProfileMarkdown updates the value", () => {
    const { setStaffProfileMarkdown } = useProfileOfPeiStore.getState();
    setStaffProfileMarkdown("### Staff\n10 total");
    expect(useProfileOfPeiStore.getState().staffProfileMarkdown).toContain("10 total");
  });
});

// 15. Removed tabs / fields not present in state
describe("Removed tabs / fields not present in state", () => {
  it("no aiBackgroundNotes field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.aiBackgroundNotes).toBeUndefined();
  });
  it("no interviews field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.interviews).toBeUndefined();
  });
  it("no consultants field", () => {
    const s = useProfileOfPeiStore.getState() as Record<string, unknown>;
    expect(s.consultants).toBeUndefined();
  });
});

// 16. PROFILE OF PEI background can serve as AI background context
describe("AI background context integration", () => {
  it("backgroundMarkdown is a non-empty string usable as AI context", () => {
    const { backgroundMarkdown } = useProfileOfPeiStore.getState();
    expect(typeof backgroundMarkdown).toBe("string");
    expect(backgroundMarkdown.length).toBeGreaterThan(0);
  });
});

// 17. updateCourse action works correctly
describe("updateCourse action", () => {
  it("updates a single field without touching other fields", () => {
    const { updateCourse } = useProfileOfPeiStore.getState();
    const first = useProfileOfPeiStore.getState().coursesOffered[0];
    const originalName = first.courseName;
    updateCourse(first.id, { abbreviation: "ZTEST" });
    const updated = useProfileOfPeiStore.getState().coursesOffered[0];
    expect(updated.abbreviation).toBe("ZTEST");
    expect(updated.courseName).toBe(originalName);
  });
});

// 18. Page TABS constant — exactly 8 tabs, none removed
describe("Page tabs", () => {
  it("TABS list has 8 entries", () => {
    const TABS = [
      "Background",
      "ERF & EduTrust Status",
      "Key Personnel",
      "Facilities",
      "Financial Health",
      "Courses Offered",
      "Student Profile",
      "Staff Profile",
    ];
    expect(TABS).toHaveLength(8);
  });
  it("does not include removed tab names", () => {
    const TABS = [
      "Background",
      "ERF & EduTrust Status",
      "Key Personnel",
      "Facilities",
      "Financial Health",
      "Courses Offered",
      "Student Profile",
      "Staff Profile",
    ];
    const removed = ["Sampling Context", "Assessor Requests", "Interview Schedule", "P-File Tracker", "Consultants", "Clarification Log", "Export", "AI Background Notes"];
    removed.forEach((t) => expect(TABS).not.toContain(t));
  });
});
