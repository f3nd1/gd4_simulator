import { useState, useCallback } from "react";
import useProfileOfPeiStore, {
  computeCourseSamplingStatus,
  computeFinancialWarnings,
} from "../store/useProfileOfPeiStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type {
  CourseRow,
  StudentSample,
  StaffRecord,
  AssessorRequest,
  ClarificationRecord,
  ErfEdutrustRow,
  ShareholderRow,
  DirectorRow,
  ManagementRow,
  AcademicBoardRow,
  FinancialRow,
  ConsultantRow,
  InterviewRecord,
} from "../types/profileOfPei";

const TABS = [
  "Background of PEI",
  "ERF & EduTrust Status",
  "Key Personnel",
  "Facilities",
  "Financial Health",
  "Courses Offered",
  "Student Profile",
  "Staff Profile",
  "Sampling Context",
  "Assessor Requests",
  "Interview Schedule",
  "P-File Tracker",
  "Consultants",
  "Clarification Log",
  "Export / Submission Pack",
  "AI Background Notes",
] as const;

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  background: "#f1f5f9",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 11,
  textTransform: "uppercase",
  color: "#64748b",
};

const TD_STYLE: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const WARN_BOX: React.CSSProperties = {
  background: "#fefce8",
  border: "1px solid #fde047",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12.5,
  color: "#713f12",
};

const SUCCESS_BOX: React.CSSProperties = {
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12.5,
  color: "#166534",
};

const STAT_CARD: React.CSSProperties = {
  padding: "10px 14px",
  background: "#f8fafc",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  textAlign: "center",
};

function sectionLabel(text: string) {
  return (
    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", margin: "16px 0 8px" }}>
      {text}
    </h3>
  );
}

function cellInput(
  value: string | number,
  onChange: (v: string) => void,
  type: "text" | "number" = "text",
) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, minWidth: 60 }}
    />
  );
}

function addBtn(onClick: () => void, label = "Add row") {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 8,
        padding: "5px 12px",
        borderRadius: 6,
        border: "1px solid #cbd5e1",
        background: "#f8fafc",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function removeBtn(onClick: () => void) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 8px",
        borderRadius: 4,
        border: "1px solid #fca5a5",
        background: "#fff1f2",
        color: "#b91c1c",
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      ✕
    </button>
  );
}

function pillForStatus(status: string) {
  if (status === "Selected" || status === "Confirmed") return <Pill s="good">{status}</Pill>;
  if (status === "Pending selection" || status === "Insufficient population" || status === "Pending confirmation" || status === "Pending assessor confirmation") return <Pill s="medium">{status}</Pill>;
  if (status === "Proposed") return <Pill s="progress">{status}</Pill>;
  if (status === "Rejected" || status === "High") return <Pill s="critical">{status}</Pill>;
  if (status === "Open" || status === "Sent") return <Pill s="progress">{status}</Pill>;
  if (status === "Awaiting reply") return <Pill s="medium">{status}</Pill>;
  return <Pill s="neutral">{status}</Pill>;
}

function downloadFile(filename: string, content: string, mimeType = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ProfileOfPei() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>PROFILE OF PEI</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
          The following information was provided by the PEI on 07/04/26.
        </p>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setActiveTab(i)}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              border: "1px solid",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: activeTab === i ? 600 : 400,
              background: activeTab === i ? "#1e40af" : "#fff",
              color: activeTab === i ? "#fff" : "#374151",
              borderColor: activeTab === i ? "#1e40af" : "#d1d5db",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {activeTab === 0 && <BackgroundTab />}
      {activeTab === 1 && <ErfTab />}
      {activeTab === 2 && <KeyPersonnelTab />}
      {activeTab === 3 && <FacilitiesTab />}
      {activeTab === 4 && <FinancialHealthTab />}
      {activeTab === 5 && <CoursesTab />}
      {activeTab === 6 && <StudentProfileTab />}
      {activeTab === 7 && <StaffProfileTab />}
      {activeTab === 8 && <SamplingContextTab />}
      {activeTab === 9 && <AssessorRequestsTab />}
      {activeTab === 10 && <InterviewScheduleTab />}
      {activeTab === 11 && <PFileTrackerTab />}
      {activeTab === 12 && <ConsultantsTab />}
      {activeTab === 13 && <ClarificationLogTab />}
      {activeTab === 14 && <ExportTab />}
      {activeTab === 15 && <AINotesTab />}
    </div>
  );
}

function BackgroundTab() {
  const { backgroundText, setBackgroundText } = useProfileOfPeiStore();
  return (
    <Card>
      <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
        Background of PEI — editable narrative
      </label>
      <textarea
        value={backgroundText}
        onChange={(e) => setBackgroundText(e.target.value)}
        rows={20}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
        {backgroundText.length} characters
      </div>
    </Card>
  );
}

function ErfTab() {
  const { erfRows, setErfRows } = useProfileOfPeiStore();

  function update(id: string, field: keyof ErfEdutrustRow, value: string) {
    setErfRows(erfRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setErfRows([
      ...erfRows,
      { id: `erf-${Date.now()}`, type: "", status: "", expiryDate: "", remarks: "" },
    ]);
  }

  function removeRow(id: string) {
    setErfRows(erfRows.filter((r) => r.id !== id));
  }

  return (
    <Card>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {["Type", "Status / Registration Type", "Expiry Date", "Remarks", ""].map((h) => (
              <th key={h} style={TH_STYLE}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {erfRows.map((row) => (
            <tr key={row.id}>
              <td style={TD_STYLE}>{cellInput(row.type, (v) => update(row.id, "type", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.status, (v) => update(row.id, "status", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.expiryDate, (v) => update(row.id, "expiryDate", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.remarks, (v) => update(row.id, "remarks", v))}</td>
              <td style={TD_STYLE}>{removeBtn(() => removeRow(row.id))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {addBtn(addRow)}
    </Card>
  );
}

function KeyPersonnelTab() {
  const {
    shareholders, setShareholders,
    directors, setDirectors,
    managementTeam, setManagementTeam,
    academicBoard, setAcademicBoard,
  } = useProfileOfPeiStore();

  const totalOwnership = shareholders.reduce((s, r) => s + (r.percentage || 0), 0);

  function updateShareholder(id: string, field: keyof ShareholderRow, value: string | number) {
    setShareholders(shareholders.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addShareholder() {
    setShareholders([
      ...shareholders,
      { id: `sh-${Date.now()}`, name: "", shares: 0, shareType: "Ordinary", percentage: 0 },
    ]);
  }

  function updateDirector(id: string, field: keyof DirectorRow, value: string) {
    setDirectors(directors.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addDirector() {
    setDirectors([...directors, { id: `dir-${Date.now()}`, name: "", designation: "" }]);
  }

  function updateManagement(id: string, field: keyof ManagementRow, value: string) {
    setManagementTeam(managementTeam.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addManagement() {
    setManagementTeam([...managementTeam, { id: `mgmt-${Date.now()}`, name: "", designation: "" }]);
  }

  function updateAcademic(id: string, field: keyof AcademicBoardRow, value: string) {
    setAcademicBoard(academicBoard.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addAcademic() {
    setAcademicBoard([
      ...academicBoard,
      { id: `ab-${Date.now()}`, name: "", designation: "", membership: "" },
    ]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        {sectionLabel("A. Shareholders")}
        {Math.abs(totalOwnership - 100) > 0.01 && (
          <div style={{ ...WARN_BOX, marginBottom: 10 }}>
            Warning: total ownership is {totalOwnership.toFixed(2)}% — should equal 100%
          </div>
        )}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["S/N", "Name", "Shares", "Share Type", "% Ownership", ""].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shareholders.map((row, i) => (
              <tr key={row.id}>
                <td style={TD_STYLE}>{i + 1}</td>
                <td style={TD_STYLE}>{cellInput(row.name, (v) => updateShareholder(row.id, "name", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.shares, (v) => updateShareholder(row.id, "shares", parseFloat(v) || 0), "number")}</td>
                <td style={TD_STYLE}>{cellInput(row.shareType, (v) => updateShareholder(row.id, "shareType", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.percentage, (v) => updateShareholder(row.id, "percentage", parseFloat(v) || 0), "number")}</td>
                <td style={TD_STYLE}>{removeBtn(() => setShareholders(shareholders.filter((r) => r.id !== row.id)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          Total ownership: <strong>{totalOwnership.toFixed(2)}%</strong>
        </div>
        {addBtn(addShareholder)}
      </Card>

      <Card>
        {sectionLabel("B. Board of Directors")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["S/N", "Name", "Designation", ""].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {directors.map((row, i) => (
              <tr key={row.id}>
                <td style={TD_STYLE}>{i + 1}</td>
                <td style={TD_STYLE}>{cellInput(row.name, (v) => updateDirector(row.id, "name", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.designation, (v) => updateDirector(row.id, "designation", v))}</td>
                <td style={TD_STYLE}>{removeBtn(() => setDirectors(directors.filter((r) => r.id !== row.id)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {addBtn(addDirector)}
      </Card>

      <Card>
        {sectionLabel("C. Management Team")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["S/N", "Name", "Designation", ""].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {managementTeam.map((row, i) => (
              <tr key={row.id}>
                <td style={TD_STYLE}>{i + 1}</td>
                <td style={TD_STYLE}>{cellInput(row.name, (v) => updateManagement(row.id, "name", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.designation, (v) => updateManagement(row.id, "designation", v))}</td>
                <td style={TD_STYLE}>{removeBtn(() => setManagementTeam(managementTeam.filter((r) => r.id !== row.id)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {addBtn(addManagement)}
      </Card>

      <Card>
        {sectionLabel("D. Academic & Examination Board")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["S/N", "Name", "Designation", "AB / EB", ""].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {academicBoard.map((row, i) => (
              <tr key={row.id}>
                <td style={TD_STYLE}>{i + 1}</td>
                <td style={TD_STYLE}>{cellInput(row.name, (v) => updateAcademic(row.id, "name", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.designation, (v) => updateAcademic(row.id, "designation", v))}</td>
                <td style={TD_STYLE}>{cellInput(row.membership, (v) => updateAcademic(row.id, "membership", v))}</td>
                <td style={TD_STYLE}>{removeBtn(() => setAcademicBoard(academicBoard.filter((r) => r.id !== row.id)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {addBtn(addAcademic)}
      </Card>
    </div>
  );
}

function FacilitiesTab() {
  const { facilities, setFacilities } = useProfileOfPeiStore();

  function upd(field: keyof typeof facilities, value: string) {
    setFacilities({ ...facilities, [field]: value });
  }

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(
          [
            { label: "Main premises address", field: "address" as const, type: "text" as const },
            { label: "Unit number", field: "unitNumber" as const, type: "text" as const },
            { label: "Postal code", field: "postalCode" as const, type: "text" as const },
            { label: "Shared premises status", field: "sharedPremises" as const, type: "text" as const },
          ] as const
        ).map(({ label, field, type }) => (
          <div key={field}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4, color: "#374151" }}>
              {label}
            </label>
            <input
              type={type}
              value={facilities[field]}
              onChange={(e) => upd(field, e.target.value)}
              style={inputStyle}
            />
          </div>
        ))}
        {(["summary", "remarks"] as const).map((field) => (
          <div key={field}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4, color: "#374151" }}>
              {field === "summary" ? "Classrooms / facilities summary" : "Remarks"}
            </label>
            <textarea
              value={facilities[field]}
              onChange={(e) => upd(field, e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function FinancialHealthTab() {
  const { financialRows, setFinancialRows } = useProfileOfPeiStore();

  function update(id: string, field: keyof FinancialRow, value: string) {
    setFinancialRows(financialRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setFinancialRows([
      ...financialRows,
      { id: `fin-${Date.now()}`, item: "", y2023: "", y2024: "", y2025: "" },
    ]);
  }

  const warnings = computeFinancialWarnings(financialRows);

  return (
    <Card>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {["Financial Item", "2023", "2024", "2025", ""].map((h) => (
              <th key={h} style={TH_STYLE}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {financialRows.map((row) => (
            <tr key={row.id}>
              <td style={TD_STYLE}>{cellInput(row.item, (v) => update(row.id, "item", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.y2023, (v) => update(row.id, "y2023", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.y2024, (v) => update(row.id, "y2024", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.y2025, (v) => update(row.id, "y2025", v))}</td>
              <td style={TD_STYLE}>{removeBtn(() => setFinancialRows(financialRows.filter((r) => r.id !== row.id)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {addBtn(addRow)}
      <div style={{ marginTop: 16 }}>
        {warnings.length === 0 ? (
          <div style={SUCCESS_BOX}>No financial warnings detected.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {warnings.map((w, i) => (
              <div key={i} style={WARN_BOX}>{w}</div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function CoursesTab() {
  const { courses, updateCourse } = useProfileOfPeiStore();

  const totalActive = courses.reduce((s, c) => s + c.activeStudentCount, 0);
  const activeCourses = courses.filter((c) => c.activeStudentCount > 0);
  const zeroCourses = courses.filter((c) => c.activeStudentCount === 0);

  function samplingPillTone(status: string): string {
    if (status === "Selected") return "good";
    if (status === "Not applicable — no active students") return "neutral";
    return "medium";
  }

  function CourseRow({ course, sn }: { course: CourseRow; sn: number }) {
    const status = computeCourseSamplingStatus(course);
    const pct = totalActive > 0 ? ((course.activeStudentCount / totalActive) * 100).toFixed(1) : "0.0";
    const muted = course.activeStudentCount === 0;
    return (
      <tr style={{ opacity: muted ? 0.55 : 1 }}>
        <td style={TD_STYLE}>{sn}</td>
        <td style={TD_STYLE}>{course.courseTitle}</td>
        <td style={TD_STYLE}>{course.awardingBody}</td>
        <td style={TD_STYLE}>{course.activeStudentCount}</td>
        <td style={TD_STYLE}>{pct}%</td>
        <td style={TD_STYLE}>{course.courseType}</td>
        <td style={TD_STYLE}>{course.recommendedStudentSampleSize || "—"}</td>
        <td style={TD_STYLE}>
          {muted ? (
            "—"
          ) : (
            <input
              type="number"
              value={course.selectedStudentSampleCount}
              onChange={(e) =>
                updateCourse(course.id, { selectedStudentSampleCount: parseInt(e.target.value) || 0 })
              }
              style={{ ...inputStyle, width: 60 }}
            />
          )}
        </td>
        <td style={TD_STYLE}>
          {muted ? (
            <Pill s="neutral">Not applicable</Pill>
          ) : (
            <Pill s={samplingPillTone(status)}>{status}</Pill>
          )}
        </td>
        <td style={TD_STYLE}>
          <input
            type="text"
            value={course.samplingRemarks}
            onChange={(e) => updateCourse(course.id, { samplingRemarks: e.target.value })}
            style={{ ...inputStyle, minWidth: 80 }}
          />
        </td>
      </tr>
    );
  }

  const headers = [
    "S/N", "Course Title", "Awarding Body", "Active Students", "% of Total",
    "Course Type", "Recommended Sample", "Selected Sample", "Sampling Status", "Remarks",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
          <div style={STAT_CARD}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{totalActive}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Total active students</div>
          </div>
          <div style={STAT_CARD}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{activeCourses.length}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Active courses</div>
          </div>
        </div>
        {sectionLabel("Active Courses")}
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>{headers.map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {activeCourses.map((c, i) => (
                <CourseRow key={c.id} course={c} sn={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
        {sectionLabel("Zero-enrolment Courses")}
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>{headers.map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {zeroCourses.map((c, i) => (
                <CourseRow key={c.id} course={c} sn={activeCourses.length + i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StudentProfileTab() {
  const {
    historicalEnrolment,
    studyModeProfile,
    passStatusProfile,
    nationalityBreakdown,
    studentSamples,
  } = useProfileOfPeiStore();

  const totalNat = nationalityBreakdown.reduce((s, r) => s + r.count, 0);

  function confirmPill(status: string) {
    if (status === "Confirmed") return <Pill s="good">{status}</Pill>;
    if (status === "Pending assessor confirmation") return <Pill s="medium">{status}</Pill>;
    if (status === "Proposed") return <Pill s="progress">{status}</Pill>;
    if (status === "Rejected") return <Pill s="critical">{status}</Pill>;
    return <Pill s="neutral">{status}</Pill>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        {sectionLabel("A. Historical Enrolment")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["Category", "2023", "2024", "2025"].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {historicalEnrolment.map((row) => (
              <tr key={row.category}>
                <td style={TD_STYLE}>{row.category}</td>
                <td style={TD_STYLE}>{row.y2023}</td>
                <td style={TD_STYLE}>{row.y2024}</td>
                <td style={TD_STYLE}>{row.y2025}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        {sectionLabel("B. Study Mode")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["Full-time", "Part-time", "Total"].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={TD_STYLE}>{studyModeProfile.fullTime}</td>
              <td style={TD_STYLE}>{studyModeProfile.partTime}</td>
              <td style={TD_STYLE}>{studyModeProfile.fullTime + studyModeProfile.partTime}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        {sectionLabel("C. Pass Status")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["SC", "PR", "Student's Pass", "Dependant Pass", "Diplomatic Pass", "Employment Pass", "LTVP", "Others", "Total"].map(
                (h) => <th key={h} style={TH_STYLE}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={TD_STYLE}>{passStatusProfile.sc}</td>
              <td style={TD_STYLE}>{passStatusProfile.pr}</td>
              <td style={TD_STYLE}>{passStatusProfile.studentPass}</td>
              <td style={TD_STYLE}>{passStatusProfile.dependantPass}</td>
              <td style={TD_STYLE}>{passStatusProfile.diplomaticPass}</td>
              <td style={TD_STYLE}>{passStatusProfile.employmentPass}</td>
              <td style={TD_STYLE}>{passStatusProfile.ltv}</td>
              <td style={TD_STYLE}>{passStatusProfile.others}</td>
              <td style={TD_STYLE}>
                {Object.values(passStatusProfile).reduce((a, b) => a + b, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        {sectionLabel("D. Nationality Breakdown")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["S/N", "Nationality", "No. of Students", "% of Students"].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {nationalityBreakdown.map((row, i) => (
              <tr key={row.id}>
                <td style={TD_STYLE}>{i + 1}</td>
                <td style={TD_STYLE}>{row.nationality}</td>
                <td style={TD_STYLE}>{row.count}</td>
                <td style={TD_STYLE}>{row.percentage.toFixed(2)}%</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600, background: "#f8fafc" }}>
              <td style={TD_STYLE} colSpan={2}>Total</td>
              <td style={TD_STYLE}>{totalNat}</td>
              <td style={TD_STYLE}>100%</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
          Total active permitted-course students: 13
        </div>
      </Card>

      <Card>
        {sectionLabel("E. Student Sample Selection")}
        <div style={{ overflowX: "auto" }}>
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                {[
                  "S/N", "Student Name", "Nationality", "Course", "Study Mode", "Cohort",
                  "Enrolled Since", "SP Holder", "P-File", "Sampling", "Sample Type",
                  "Assessor Status", "Remarks",
                ].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {studentSamples.map((s, i) => (
                <tr key={s.sampleId}>
                  <td style={TD_STYLE}>{i + 1}</td>
                  <td style={TD_STYLE}>{s.studentName}</td>
                  <td style={TD_STYLE}>{s.nationality}</td>
                  <td style={TD_STYLE}>{s.courseEnrolledIn}</td>
                  <td style={TD_STYLE}>{s.studyMode}</td>
                  <td style={TD_STYLE}>{s.cohortYear}</td>
                  <td style={TD_STYLE}>{s.enrolledSince}</td>
                  <td style={TD_STYLE}>{s.studentPassHolder ? "Yes" : "No"}</td>
                  <td style={TD_STYLE}>{s.selectedForPFile ? "Yes" : "No"}</td>
                  <td style={TD_STYLE}>{s.selectedForSampling ? "Yes" : "No"}</td>
                  <td style={TD_STYLE}>{s.sampleType}</td>
                  <td style={TD_STYLE}>{confirmPill(s.assessorConfirmationStatus)}</td>
                  <td style={TD_STYLE}>{s.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StaffProfileTab() {
  const { staffRecords, updateStaffRecord } = useProfileOfPeiStore();

  const stats = {
    total: staffRecords.length,
    singapore: staffRecords.filter((r) => r.location === "Singapore").length,
    philippines: staffRecords.filter((r) => r.location === "Philippines").length,
    academic: staffRecords.filter((r) => r.staffCategory === "Academic").length,
    nonAcademic: staffRecords.filter((r) => r.staffCategory === "Non-Academic").length,
    fullTime: staffRecords.filter((r) => r.employmentType === "Full-time").length,
    partTime: staffRecords.filter((r) => r.employmentType === "Part-time").length,
    adjunct: staffRecords.filter((r) => r.employmentType === "Adjunct").length,
    interview: staffRecords.filter((r) => r.selectedForInterview).length,
    pFile: staffRecords.filter((r) => r.selectedForPFile).length,
    pFileReady: staffRecords.filter((r) => r.pFileStatus === "Ready").length,
    pFilePending: staffRecords.filter(
      (r) => r.selectedForPFile && r.pFileStatus !== "Ready" && r.pFileStatus !== "Not applicable",
    ).length,
  };

  const statCards: Array<{ label: string; value: number }> = [
    { label: "Total staff", value: stats.total },
    { label: "Singapore", value: stats.singapore },
    { label: "Philippines", value: stats.philippines },
    { label: "Academic", value: stats.academic },
    { label: "Non-Academic", value: stats.nonAcademic },
    { label: "Full-time", value: stats.fullTime },
    { label: "Part-time", value: stats.partTime },
    { label: "Adjunct", value: stats.adjunct },
    { label: "For interview", value: stats.interview },
    { label: "P-file selected", value: stats.pFile },
    { label: "P-files ready", value: stats.pFileReady },
    { label: "P-files pending", value: stats.pFilePending },
  ];

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {statCards.map(({ label, value }) => (
          <div key={label} style={STAT_CARD}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {[
                "S/N", "Name", "Role", "Category", "Employment", "Location",
                "Onsite", "Interview", "P-File", "P-File Status", "Remarks",
              ].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {staffRecords.map((r, i) => {
              const adjunctInterviewWarn =
                (r.employmentType === "Adjunct" || r.employmentType === "Part-time") &&
                r.selectedForInterview;
              return (
                <tr key={r.staffId}>
                  <td style={TD_STYLE}>{i + 1}</td>
                  <td style={TD_STYLE}>{r.fullName}</td>
                  <td style={TD_STYLE}>{r.role}</td>
                  <td style={TD_STYLE}>{r.staffCategory}</td>
                  <td style={TD_STYLE}>{r.employmentType}</td>
                  <td style={TD_STYLE}>{r.location}</td>
                  <td style={TD_STYLE}>
                    {adjunctInterviewWarn ? (
                      <Pill s="medium">Confirm time</Pill>
                    ) : (
                      r.onsiteDuringAssessment
                    )}
                  </td>
                  <td style={TD_STYLE}>{r.selectedForInterview ? "Yes" : "No"}</td>
                  <td style={TD_STYLE}>{r.selectedForPFile ? "Yes" : "No"}</td>
                  <td style={TD_STYLE}>{r.pFileStatus}</td>
                  <td style={TD_STYLE}>
                    <input
                      type="text"
                      value={r.remarks}
                      onChange={(e) => updateStaffRecord(r.staffId, { remarks: e.target.value })}
                      style={{ ...inputStyle, minWidth: 80 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SamplingContextTab() {
  const { courses, studentSamples, staffRecords } = useProfileOfPeiStore();

  const activeCourses = courses.filter((c) => c.activeStudentCount > 0);
  const sampledStaff = staffRecords.filter((r) => r.selectedForSampling);

  const academicStaff = sampledStaff.filter((r) => r.staffCategory === "Academic");
  const nonAcademicStaff = sampledStaff.filter((r) => r.staffCategory === "Non-Academic");

  const pendingStudentConf = studentSamples.filter(
    (s) => s.assessorConfirmationStatus === "Pending assessor confirmation",
  ).length;
  const pendingStaffConf = staffRecords.filter(
    (r) => r.assessorConfirmationStatus === "Pending assessor confirmation",
  ).length;

  const studentPFilesRequired = studentSamples.filter((s) => s.selectedForPFile).length;
  const staffPFilesRequired = staffRecords.filter((r) => r.selectedForPFile).length;
  const studentPFilesReady = studentSamples.filter((s) => s.pFileStatus === "Ready").length;
  const staffPFilesReady = staffRecords.filter((r) => r.pFileStatus === "Ready").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <p style={{ fontStyle: "italic", color: "#64748b", fontSize: 13, margin: 0 }}>
          In EduTrust assessment, assessors do not usually check every student file or every staff
          file. They select samples based on the PEI&apos;s size, course mix, staff profile and risk
          areas. Sample selected does not mean compliant. Sample selected only tells the auditor
          which P-file or evidence record to inspect.
        </p>
      </Card>

      <Card>
        {sectionLabel("Course Sampling Universe")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {["Course", "Active Students", "Recommended Sample", "Selected", "Status"].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeCourses.map((c) => {
              const status = computeCourseSamplingStatus(c);
              return (
                <tr key={c.id}>
                  <td style={TD_STYLE}>{c.courseTitle}</td>
                  <td style={TD_STYLE}>{c.activeStudentCount}</td>
                  <td style={TD_STYLE}>{c.recommendedStudentSampleSize}</td>
                  <td style={TD_STYLE}>{c.selectedStudentSampleCount}</td>
                  <td style={TD_STYLE}>{pillForStatus(status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card>
        {sectionLabel("Student Samples")}
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
          Pending assessor confirmation: <strong>{pendingStudentConf}</strong>
        </div>
        {(["Confirmed", "Pending assessor confirmation", "Proposed", "Rejected"] as const).map((status) => {
          const group = studentSamples.filter((s) => s.assessorConfirmationStatus === status);
          if (group.length === 0) return null;
          return (
            <div key={status} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {status} ({group.length})
              </div>
              {group.map((s) => (
                <div key={s.sampleId} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
                  {s.studentName} — {s.courseEnrolledIn}
                </div>
              ))}
            </div>
          );
        })}
      </Card>

      <Card>
        {sectionLabel("Staff Samples")}
        {academicStaff.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Academic ({academicStaff.length})</div>
            {academicStaff.map((r) => (
              <div key={r.staffId} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
                {r.fullName} — {r.role}
              </div>
            ))}
          </>
        )}
        {nonAcademicStaff.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, margin: "8px 0 4px" }}>Non-Academic ({nonAcademicStaff.length})</div>
            {nonAcademicStaff.map((r) => (
              <div key={r.staffId} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
                {r.fullName} — {r.role}
              </div>
            ))}
          </>
        )}
        {sampledStaff.length === 0 && (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>No staff marked for sampling.</div>
        )}
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Pending assessor confirmation: <strong>{pendingStaffConf}</strong>
        </div>
      </Card>

      <Card>
        {sectionLabel("P-File Summary")}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { label: "Student P-files required", value: studentPFilesRequired },
            { label: "Staff P-files required", value: staffPFilesRequired },
            { label: "Student P-files ready", value: studentPFilesReady },
            { label: "Staff P-files ready", value: staffPFilesReady },
            { label: "Pending confirmation (students)", value: pendingStudentConf },
            { label: "Pending confirmation (staff)", value: pendingStaffConf },
          ].map(({ label, value }) => (
            <div key={label} style={STAT_CARD}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AssessorRequestsTab() {
  const { assessorRequests, updateAssessorRequest, setAssessorRequests } = useProfileOfPeiStore();

  function addRequest() {
    const newReq: AssessorRequest = {
      requestId: `req-${Date.now()}`,
      requestDate: new Date().toISOString().slice(0, 10),
      requestedBy: "Assessor",
      requestType: "Clarification",
      requestSummary: "",
      requiredCount: 0,
      selectedRecords: [],
      linkedStudentSampleIds: [],
      linkedStaffIds: [],
      status: "Open",
      responseDraft: "",
      finalResponse: "",
      dueDate: "",
      remarks: "",
    };
    setAssessorRequests([...assessorRequests, newReq]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {assessorRequests.map((req) => (
        <Card key={req.requestId}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{req.requestType}</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{req.requestDate}</span>
            {pillForStatus(req.status)}
            <select
              value={req.status}
              onChange={(e) =>
                updateAssessorRequest(req.requestId, { status: e.target.value as AssessorRequest["status"] })
              }
              style={{ ...inputStyle, width: "auto", fontSize: 12 }}
            >
              {(["Open", "Pending confirmation", "Confirmed", "Completed", "Superseded"] as const).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 13, color: "#374151", margin: "0 0 8px" }}>{req.requestSummary}</p>
          {req.selectedRecords.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, color: "#475569" }}>
              {req.selectedRecords.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Response Draft
          </label>
          <textarea
            value={req.responseDraft}
            onChange={(e) => updateAssessorRequest(req.requestId, { responseDraft: e.target.value })}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Card>
      ))}
      {addBtn(addRequest, "Add request")}
    </div>
  );
}

function InterviewScheduleTab() {
  const { interviews, setInterviews } = useProfileOfPeiStore();

  function update(id: string, field: keyof InterviewRecord, value: string) {
    setInterviews(interviews.map((r) => (r.interviewId === id ? { ...r, [field]: value } : r)));
  }

  return (
    <Card>
      <div style={{ overflowX: "auto" }}>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {[
                "Staff Name", "Role", "Employment Type", "Interview Date", "Time",
                "Mode", "Status", "Risk", "Remarks",
              ].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {interviews.map((iv) => {
              const isAdjunctPending =
                (iv.employmentType === "Adjunct" || iv.employmentType === "Part-time") &&
                iv.status === "Pending time";
              return (
                <tr
                  key={iv.interviewId}
                  style={{ background: isAdjunctPending ? "#fefce8" : undefined }}
                >
                  <td style={TD_STYLE}>{iv.staffName}</td>
                  <td style={TD_STYLE}>{iv.role}</td>
                  <td style={TD_STYLE}>{iv.employmentType}</td>
                  <td style={TD_STYLE}>
                    <input
                      type="date"
                      value={iv.interviewDate}
                      onChange={(e) => update(iv.interviewId, "interviewDate", e.target.value)}
                      style={{ ...inputStyle, minWidth: 120 }}
                    />
                  </td>
                  <td style={TD_STYLE}>
                    <input
                      type="time"
                      value={iv.interviewTime}
                      onChange={(e) => update(iv.interviewId, "interviewTime", e.target.value)}
                      style={{ ...inputStyle, minWidth: 90 }}
                    />
                  </td>
                  <td style={TD_STYLE}>
                    <select
                      value={iv.mode}
                      onChange={(e) => update(iv.interviewId, "mode", e.target.value)}
                      style={{ ...inputStyle, width: "auto" }}
                    >
                      {["Onsite", "Online", "Phone"].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </td>
                  <td style={TD_STYLE}>{pillForStatus(iv.status)}</td>
                  <td style={TD_STYLE}>
                    {iv.attendanceRisk === "High" ? (
                      <Pill s="critical">High</Pill>
                    ) : (
                      iv.attendanceRisk
                    )}
                  </td>
                  <td style={TD_STYLE}>
                    {isAdjunctPending ? (
                      <div>
                        <div style={{ ...WARN_BOX, marginBottom: 4, padding: "4px 8px", fontSize: 11 }}>
                          Confirm interview time early — this staff member may not be onsite full-time.
                        </div>
                        <input
                          type="text"
                          value={iv.remarks}
                          onChange={(e) => update(iv.interviewId, "remarks", e.target.value)}
                          style={{ ...inputStyle, minWidth: 100 }}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={iv.remarks}
                        onChange={(e) => update(iv.interviewId, "remarks", e.target.value)}
                        style={{ ...inputStyle, minWidth: 100 }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PFileTrackerTab() {
  const { staffRecords, studentSamples } = useProfileOfPeiStore();

  const staffPFiles = staffRecords.filter((r) => r.selectedForPFile);
  const studentPFiles = studentSamples.filter((s) => s.selectedForPFile);
  const staffReady = staffPFiles.filter((r) => r.pFileStatus === "Ready").length;
  const studentReady = studentPFiles.filter((s) => s.pFileStatus === "Ready").length;
  const totalRequired = staffPFiles.length + studentPFiles.length;
  const totalReady = staffReady + studentReady;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Day 1 Readiness: {totalReady} of {totalRequired} P-files ready
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Staff required", value: staffPFiles.length },
            { label: "Staff ready", value: staffReady },
            { label: "Staff pending", value: staffPFiles.length - staffReady },
            { label: "Student required", value: studentPFiles.length },
            { label: "Student ready", value: studentReady },
            { label: "Student pending", value: studentPFiles.length - studentReady },
          ].map(({ label, value }) => (
            <div key={label} style={STAT_CARD}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        {sectionLabel("Staff P-Files")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {[
                "Staff Name", "Role", "Category", "Employment",
                "P-File Status", "Sample Type", "Assessor Status", "Ready for Day 1?",
              ].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {staffPFiles.map((r) => (
              <tr key={r.staffId}>
                <td style={TD_STYLE}>{r.fullName}</td>
                <td style={TD_STYLE}>{r.role}</td>
                <td style={TD_STYLE}>{r.staffCategory}</td>
                <td style={TD_STYLE}>{r.employmentType}</td>
                <td style={TD_STYLE}>{r.pFileStatus}</td>
                <td style={TD_STYLE}>{r.sampleType}</td>
                <td style={TD_STYLE}>{pillForStatus(r.assessorConfirmationStatus)}</td>
                <td style={TD_STYLE}>{r.readyForDay1 ? <Pill s="good">Yes</Pill> : <Pill s="neutral">No</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        {sectionLabel("Student P-Files")}
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              {[
                "Student Name", "Nationality", "Course", "Cohort",
                "P-File Status", "Sample Type", "Assessor Status", "Ready for Day 1?",
              ].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {studentPFiles.map((s) => (
              <tr key={s.sampleId}>
                <td style={TD_STYLE}>{s.studentName}</td>
                <td style={TD_STYLE}>{s.nationality}</td>
                <td style={TD_STYLE}>{s.courseEnrolledIn}</td>
                <td style={TD_STYLE}>{s.cohortYear}</td>
                <td style={TD_STYLE}>{s.pFileStatus}</td>
                <td style={TD_STYLE}>{s.sampleType}</td>
                <td style={TD_STYLE}>{pillForStatus(s.assessorConfirmationStatus)}</td>
                <td style={TD_STYLE}>{s.readyForDay1 ? <Pill s="good">Yes</Pill> : <Pill s="neutral">No</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ConsultantsTab() {
  const { consultants, setConsultants } = useProfileOfPeiStore();

  function update(id: string, field: keyof ConsultantRow, value: string) {
    setConsultants(consultants.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setConsultants([
      ...consultants,
      { id: `cons-${Date.now()}`, name: "", period: "", roleScope: "", remarks: "" },
    ]);
  }

  return (
    <Card>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {["S/N", "Company / Personnel", "Period", "Role / Scope", "Remarks", ""].map((h) => (
              <th key={h} style={TH_STYLE}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {consultants.map((row, i) => (
            <tr key={row.id}>
              <td style={TD_STYLE}>{i + 1}</td>
              <td style={TD_STYLE}>{cellInput(row.name, (v) => update(row.id, "name", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.period, (v) => update(row.id, "period", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.roleScope, (v) => update(row.id, "roleScope", v))}</td>
              <td style={TD_STYLE}>{cellInput(row.remarks, (v) => update(row.id, "remarks", v))}</td>
              <td style={TD_STYLE}>{removeBtn(() => setConsultants(consultants.filter((r) => r.id !== row.id)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {addBtn(addRow)}
    </Card>
  );
}

function ClarificationLogTab() {
  const { clarifications, setClarifications } = useProfileOfPeiStore();

  function update(id: string, patch: Partial<ClarificationRecord>) {
    setClarifications(clarifications.map((r) => (r.clarificationId === id ? { ...r, ...patch } : r)));
  }

  function addClarification() {
    const newClar: ClarificationRecord = {
      clarificationId: `clar-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      topic: "",
      question: "",
      proposedResponse: "",
      finalResponse: "",
      status: "Draft",
      relatedRequestId: "",
      relatedStaffIds: [],
      relatedStudentSampleIds: [],
      remarks: "",
    };
    setClarifications([...clarifications, newClar]);
  }

  function statusPill(status: string) {
    if (status === "Confirmed") return <Pill s="good">{status}</Pill>;
    if (status === "Awaiting reply") return <Pill s="medium">{status}</Pill>;
    if (status === "Sent") return <Pill s="progress">{status}</Pill>;
    return <Pill s="neutral">{status}</Pill>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {clarifications.map((clar) => (
        <Card key={clar.clarificationId}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{clar.topic || "(No topic)"}</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{clar.date}</span>
            {statusPill(clar.status)}
            <select
              value={clar.status}
              onChange={(e) => update(clar.clarificationId, { status: e.target.value as ClarificationRecord["status"] })}
              style={{ ...inputStyle, width: "auto", fontSize: 12 }}
            >
              {(["Draft", "Sent", "Awaiting reply", "Confirmed", "Closed"] as const).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Topic</label>
              <input
                type="text"
                value={clar.topic}
                onChange={(e) => update(clar.clarificationId, { topic: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Question</label>
              <textarea
                value={clar.question}
                onChange={(e) => update(clar.clarificationId, { question: e.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Proposed Response</label>
              <textarea
                value={clar.proposedResponse}
                onChange={(e) => update(clar.clarificationId, { proposedResponse: e.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
            {(clar.status === "Confirmed" || clar.status === "Closed") && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Final Response</label>
                <textarea
                  value={clar.finalResponse}
                  onChange={(e) => update(clar.clarificationId, { finalResponse: e.target.value })}
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
            )}
          </div>
        </Card>
      ))}
      {addBtn(addClarification, "Add clarification")}
    </div>
  );
}

function ExportTab() {
  const store = useProfileOfPeiStore();

  function exportProfileOfPei() {
    const {
      backgroundText, erfRows, shareholders, directors, managementTeam, academicBoard,
      facilities, financialRows, courses, studentSamples, staffRecords,
      historicalEnrolment, studyModeProfile, nationalityBreakdown, consultants,
    } = store;

    const activeCourses = courses.filter((c) => c.activeStudentCount > 0);
    const totalActive = courses.reduce((s, c) => s + c.activeStudentCount, 0);

    let md = `# PROFILE OF PEI\n\nThe following information was provided by the PEI on 07/04/26.\n\n`;
    md += `## Background of PEI\n\n${backgroundText}\n\n`;

    md += `## ERF and EduTrust Status\n\n`;
    md += `| Type | Status | Expiry Date | Remarks |\n|---|---|---|---|\n`;
    erfRows.forEach((r) => { md += `| ${r.type} | ${r.status} | ${r.expiryDate} | ${r.remarks} |\n`; });

    md += `\n## Key Personnel\n\n### Shareholders\n\n`;
    md += `| Name | Shares | Share Type | % Ownership |\n|---|---|---|---|\n`;
    shareholders.forEach((r) => { md += `| ${r.name} | ${r.shares} | ${r.shareType} | ${r.percentage}% |\n`; });

    md += `\n### Board of Directors\n\n| Name | Designation |\n|---|---|\n`;
    directors.forEach((r) => { md += `| ${r.name} | ${r.designation} |\n`; });

    md += `\n### Management Team\n\n| Name | Designation |\n|---|---|\n`;
    managementTeam.forEach((r) => { md += `| ${r.name} | ${r.designation} |\n`; });

    md += `\n### Academic & Examination Board\n\n| Name | Designation | Membership |\n|---|---|---|\n`;
    academicBoard.forEach((r) => { md += `| ${r.name} | ${r.designation} | ${r.membership} |\n`; });

    md += `\n## Facilities\n\n`;
    md += `- Address: ${facilities.address}\n- Unit: ${facilities.unitNumber}\n- Postal Code: ${facilities.postalCode}\n`;
    md += `- Shared Premises: ${facilities.sharedPremises}\n- Summary: ${facilities.summary}\n- Remarks: ${facilities.remarks}\n`;

    md += `\n## Financial Health\n\n| Item | 2023 | 2024 | 2025 |\n|---|---|---|---|\n`;
    financialRows.forEach((r) => { md += `| ${r.item} | ${r.y2023} | ${r.y2024} | ${r.y2025} |\n`; });

    md += `\n## Courses Offered\n\nTotal active students: ${totalActive}\n\n`;
    md += `| Course | Type | Active Students | % of Total | Recommended Sample | Selected Sample |\n|---|---|---|---|---|---|\n`;
    activeCourses.forEach((c) => {
      const pct = totalActive > 0 ? ((c.activeStudentCount / totalActive) * 100).toFixed(1) : "0.0";
      md += `| ${c.courseTitle} | ${c.courseType} | ${c.activeStudentCount} | ${pct}% | ${c.recommendedStudentSampleSize} | ${c.selectedStudentSampleCount} |\n`;
    });

    md += `\n## Student Profile\n\n### Historical Enrolment\n\n| Category | 2023 | 2024 | 2025 |\n|---|---|---|---|\n`;
    historicalEnrolment.forEach((r) => { md += `| ${r.category} | ${r.y2023} | ${r.y2024} | ${r.y2025} |\n`; });

    md += `\n### Study Mode\n\n| Full-time | Part-time | Total |\n|---|---|---|\n`;
    md += `| ${studyModeProfile.fullTime} | ${studyModeProfile.partTime} | ${studyModeProfile.fullTime + studyModeProfile.partTime} |\n`;

    md += `\n### Nationality Breakdown\n\n| Nationality | Students | % |\n|---|---|---|\n`;
    nationalityBreakdown.forEach((r) => { md += `| ${r.nationality} | ${r.count} | ${r.percentage.toFixed(2)}% |\n`; });

    md += `\n## Sampling Context\n\n### Student Samples\n\n`;
    studentSamples.forEach((s) => { md += `- ${s.studentName} (${s.courseEnrolledIn}) — ${s.assessorConfirmationStatus}\n`; });

    md += `\n### Staff Selected for Interview\n\n`;
    staffRecords.filter((r) => r.selectedForInterview).forEach((r) => { md += `- ${r.fullName} (${r.role})\n`; });

    md += `\n## Consultants\n\n| Company / Personnel | Period | Role / Scope | Remarks |\n|---|---|---|---|\n`;
    consultants.forEach((r) => { md += `| ${r.name} | ${r.period} | ${r.roleScope} | ${r.remarks} |\n`; });

    downloadFile("profile-of-pei.md", md);
  }

  function exportDay1ReadinessPack() {
    const { erfRows, interviews, staffRecords, studentSamples, courses, assessorRequests } = store;

    const activeCourses = courses.filter((c) => c.activeStudentCount > 0);
    const staffPFiles = staffRecords.filter((r) => r.selectedForPFile);
    const studentPFiles = studentSamples.filter((s) => s.selectedForPFile);
    const pendingConf = [
      ...studentSamples.filter((s) => s.assessorConfirmationStatus === "Pending assessor confirmation"),
      ...staffRecords.filter((r) => r.assessorConfirmationStatus === "Pending assessor confirmation"),
    ];
    const notReadyStudents = studentPFiles.filter((s) => s.pFileStatus !== "Ready");
    const notReadyStaff = staffPFiles.filter((r) => r.pFileStatus !== "Ready");
    const pendingAssessorConf = assessorRequests.filter(
      (r) => r.status === "Pending confirmation" || r.status === "Open",
    );

    let md = `# DAY 1 READINESS PACK\n\n`;
    md += `## Institution Profile Summary\n\n`;
    erfRows.forEach((r) => { md += `- ${r.type}: ${r.status} (Expiry: ${r.expiryDate})\n`; });

    md += `\n## Staff Interview List\n\n`;
    interviews
      .filter((iv) => iv.status !== ("Not required" as string))
      .forEach((iv) => {
        md += `- ${iv.staffName} (${iv.role}) — ${iv.status}${iv.attendanceRisk === "High" ? " [HIGH RISK]" : ""}\n`;
      });

    md += `\n## Staff P-Files Selected\n\n`;
    staffPFiles.forEach((r) => { md += `- ${r.fullName} (${r.role}) — ${r.pFileStatus}\n`; });

    md += `\n## Student P-Files Selected\n\n`;
    studentPFiles.forEach((s) => { md += `- ${s.studentName} (${s.courseEnrolledIn}) — ${s.pFileStatus}\n`; });

    md += `\n## Course Sampling Coverage\n\n`;
    activeCourses.forEach((c) => { md += `- ${c.courseTitle}: ${c.selectedStudentSampleCount} of ${c.recommendedStudentSampleSize} selected\n`; });

    md += `\n## Samples Pending Assessor Confirmation\n\n`;
    pendingConf.forEach((item) => {
      if ("studentName" in item) {
        md += `- [Student] ${item.studentName}\n`;
      } else {
        md += `- [Staff] ${item.fullName}\n`;
      }
    });

    md += `\n## Missing / Not Ready P-Files\n\n`;
    notReadyStudents.forEach((s) => { md += `- [Student] ${s.studentName} — ${s.pFileStatus}\n`; });
    notReadyStaff.forEach((r) => { md += `- [Staff] ${r.fullName} — ${r.pFileStatus}\n`; });

    md += `\n## Pending Assessor Confirmations\n\n`;
    pendingAssessorConf.forEach((r) => { md += `- [${r.requestType}] ${r.requestSummary}\n`; });

    downloadFile("day1-readiness-pack.md", md);
  }

  function exportSamplingMatrix() {
    const { studentSamples, staffRecords } = store;
    const rows: string[] = [
      "Sample Type,Name,Course/Department,Role,Nationality,Study Mode,Employment Type,Sample Reason,GD4 Refs,Evidence Files,P-File Status,Assessor Status,Remarks",
    ];
    studentSamples.forEach((s) => {
      rows.push(
        [
          s.sampleType, s.studentName, s.courseEnrolledIn, "",
          s.nationality, s.studyMode, "",
          s.sampleReason, s.linkedGd4Refs.join(";"), s.linkedEvidenceFiles.join(";"),
          s.pFileStatus, s.assessorConfirmationStatus, s.remarks,
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
      );
    });
    staffRecords.forEach((r) => {
      rows.push(
        [
          r.sampleType, r.fullName, r.department, r.role,
          "", "", r.employmentType,
          r.sampleReason, r.linkedGd4Refs.join(";"), r.linkedEvidenceFiles.join(";"),
          r.pFileStatus, r.assessorConfirmationStatus, r.remarks,
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
      );
    });
    downloadFile("sampling-matrix.csv", rows.join("\n"), "text/csv");
  }

  function exportStaffPFileList() {
    const { staffRecords } = store;
    const selected = staffRecords.filter((r) => r.selectedForPFile);
    const rows = [
      "Staff Name,Role,Category,Employment,P-File Status,Sample Type,Assessor Status,Ready for Day 1",
      ...selected.map((r) =>
        [r.fullName, r.role, r.staffCategory, r.employmentType, r.pFileStatus, r.sampleType, r.assessorConfirmationStatus, r.readyForDay1 ? "Yes" : "No"]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      ),
    ];
    downloadFile("staff-pfile-list.csv", rows.join("\n"), "text/csv");
  }

  function exportStudentPFileList() {
    const { studentSamples } = store;
    const selected = studentSamples.filter((s) => s.selectedForPFile);
    const rows = [
      "Student Name,Nationality,Course,Cohort,Study Mode,P-File Status,Sample Type,Assessor Status,Ready for Day 1",
      ...selected.map((s) =>
        [s.studentName, s.nationality, s.courseEnrolledIn, s.cohortYear, s.studyMode, s.pFileStatus, s.sampleType, s.assessorConfirmationStatus, s.readyForDay1 ? "Yes" : "No"]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      ),
    ];
    downloadFile("student-pfile-list.csv", rows.join("\n"), "text/csv");
  }

  function exportStaffInterviewList() {
    const { interviews } = store;
    let md = `# STAFF INTERVIEW LIST\n\n`;
    md += `| Staff Name | Role | Employment Type | Interview Date | Time | Mode | Status | Risk |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    interviews.forEach((iv) => {
      md += `| ${iv.staffName} | ${iv.role} | ${iv.employmentType} | ${iv.interviewDate || "TBC"} | ${iv.interviewTime || "TBC"} | ${iv.mode} | ${iv.status} | ${iv.attendanceRisk} |\n`;
    });
    downloadFile("staff-interview-list.md", md);
  }

  function exportAssessorRequestTracker() {
    const { assessorRequests } = store;
    let md = `# ASSESSOR REQUEST TRACKER\n\n`;
    assessorRequests.forEach((r) => {
      md += `## [${r.status}] ${r.requestType} — ${r.requestDate}\n\n`;
      md += `**Requested by:** ${r.requestedBy}\n\n`;
      md += `**Summary:** ${r.requestSummary}\n\n`;
      if (r.selectedRecords.length > 0) {
        md += `**Records:** ${r.selectedRecords.join(", ")}\n\n`;
      }
      if (r.responseDraft) {
        md += `**Response Draft:**\n${r.responseDraft}\n\n`;
      }
      if (r.finalResponse) {
        md += `**Final Response:**\n${r.finalResponse}\n\n`;
      }
      md += `---\n\n`;
    });
    downloadFile("assessor-request-tracker.md", md);
  }

  const btnStyle: React.CSSProperties = {
    padding: "10px 18px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
  };

  return (
    <Card>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>Export / Submission Pack</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <button style={btnStyle} onClick={exportProfileOfPei}>Profile of PEI (.md)</button>
        <button style={btnStyle} onClick={exportDay1ReadinessPack}>Day 1 Readiness Pack (.md)</button>
        <button style={btnStyle} onClick={exportSamplingMatrix}>Sampling Matrix (.csv)</button>
        <button style={btnStyle} onClick={exportStaffPFileList}>Staff P-File List (.csv)</button>
        <button style={btnStyle} onClick={exportStudentPFileList}>Student P-File List (.csv)</button>
        <button style={btnStyle} onClick={exportStaffInterviewList}>Staff Interview List (.md)</button>
        <button style={btnStyle} onClick={exportAssessorRequestTracker}>Assessor Request Tracker (.md)</button>
      </div>
    </Card>
  );
}

function AINotesTab() {
  const { aiBackgroundNotes, setAiBackgroundNotes, assessorRequests, clarifications } = useProfileOfPeiStore();
  const [showModal, setShowModal] = useState(false);
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [selectedClarifications, setSelectedClarifications] = useState<Set<string>>(new Set());
  const [generatedText, setGeneratedText] = useState("");
  const [copied, setCopied] = useState(false);

  function generateReply() {
    const parts: string[] = ["Dear Assessor,", "", "Thank you for your queries. Please find our responses below.", ""];

    assessorRequests
      .filter((r) => selectedRequests.has(r.requestId))
      .forEach((r) => {
        parts.push(`**Re: ${r.requestType}**`);
        if (r.responseDraft) {
          parts.push(r.responseDraft);
        } else {
          parts.push(r.requestSummary);
        }
        parts.push("");
      });

    clarifications
      .filter((c) => selectedClarifications.has(c.clarificationId))
      .forEach((c) => {
        parts.push(`**Re: ${c.topic}**`);
        if (c.proposedResponse) {
          parts.push(c.proposedResponse);
        } else if (c.question) {
          parts.push(`[Pending response to: ${c.question}]`);
        }
        parts.push("");
      });

    parts.push("We remain available should you require further information.", "", "Regards,", "United Ceres College");
    setGeneratedText(parts.join("\n"));
  }

  const toggleRequest = useCallback((id: string) => {
    setSelectedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleClarification = useCallback((id: string) => {
    setSelectedClarifications((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  function copyToClipboard() {
    navigator.clipboard.writeText(generatedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
          AI Background Notes
        </label>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 8px" }}>
          This text is injected as background context into AI audits. It is not treated as primary evidence.
        </p>
        <textarea
          value={aiBackgroundNotes}
          onChange={(e) => setAiBackgroundNotes(e.target.value)}
          rows={12}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          {aiBackgroundNotes.length} characters
        </div>
      </Card>

      <Card>
        <button
          onClick={() => { setShowModal(true); setGeneratedText(""); }}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #1e40af",
            background: "#1e40af",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Draft Assessor Reply
        </button>
      </Card>

      {showModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            style={{
              background: "#fff", borderRadius: 14, padding: 24, width: "min(90vw, 680px)",
              maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Draft Assessor Reply</h3>
            {sectionLabel("Assessor Requests to include")}
            {assessorRequests.map((r) => (
              <label key={r.requestId} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedRequests.has(r.requestId)}
                  onChange={() => toggleRequest(r.requestId)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>{r.requestType}</strong> — {r.requestSummary.slice(0, 80)}
                  {r.requestSummary.length > 80 ? "…" : ""}
                </span>
              </label>
            ))}
            {sectionLabel("Clarifications to include")}
            {clarifications.map((c) => (
              <label key={c.clarificationId} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedClarifications.has(c.clarificationId)}
                  onChange={() => toggleClarification(c.clarificationId)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>{c.topic}</strong> — {c.question.slice(0, 80)}{c.question.length > 80 ? "…" : ""}
                </span>
              </label>
            ))}
            <button
              onClick={generateReply}
              disabled={selectedRequests.size === 0 && selectedClarifications.size === 0}
              style={{
                marginTop: 12, padding: "8px 16px", borderRadius: 8,
                border: "1px solid #1e40af", background: "#1e40af", color: "#fff",
                fontSize: 13, cursor: "pointer", opacity: (selectedRequests.size === 0 && selectedClarifications.size === 0) ? 0.5 : 1,
              }}
            >
              Generate
            </button>
            {generatedText && (
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>Generated Reply</label>
                <textarea
                  value={generatedText}
                  onChange={(e) => setGeneratedText(e.target.value)}
                  rows={14}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
                <button
                  onClick={copyToClipboard}
                  style={{
                    marginTop: 8, padding: "6px 14px", borderRadius: 6,
                    border: "1px solid #cbd5e1", background: copied ? "#f0fdf4" : "#f8fafc",
                    fontSize: 12, cursor: "pointer", color: copied ? "#166534" : "#374151",
                  }}
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
            )}
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: "1px solid #cbd5e1",
                  background: "#fff", fontSize: 12, cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
