import { useState, useEffect } from "react";
import { useProfileOfPeiStore } from "../store/useProfileOfPeiStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { PeiStatusRow, ShareholderRow, PersonnelRow, AcademicExamBoardRow, PeiCourseRow } from "../types/profileOfPei";

const TABS = [
  "Background",
  "ERF & EduTrust Status",
  "Key Personnel",
  "Facilities",
  "Financial Health",
  "Courses Offered",
  "Student Profile",
  "Staff Profile",
] as const;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Tab 0 — Background
// ---------------------------------------------------------------------------
function BackgroundTab() {
  const backgroundMarkdown = useProfileOfPeiStore((s) => s.backgroundMarkdown);
  const setBackgroundMarkdown = useProfileOfPeiStore((s) => s.setBackgroundMarkdown);
  const setSchoolContextText = useWorkspaceStore((s) => s.setSchoolContextText);

  function handleChange(text: string) {
    setBackgroundMarkdown(text);
    setSchoolContextText(text);
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Free-text background about the institution. This is also used as the AI audit context — injected into every AI
        assessment as the auditor's briefing.
      </p>
      <textarea
        value={backgroundMarkdown}
        onChange={(e) => handleChange(e.target.value)}
        rows={22}
        style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5 }}
      />
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{backgroundMarkdown.length} characters</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — ERF & EduTrust Status
// ---------------------------------------------------------------------------
function ErfTab() {
  const rows = useProfileOfPeiStore((s) => s.erfEduTrustStatus);
  const setRows = useProfileOfPeiStore((s) => s.setErfEduTrustStatus);

  function update(id: string, patch: Partial<PeiStatusRow>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows([...rows, { id: uid(), type: "", status: "", expiryDate: "", remarks: "" }]);
  }
  function deleteRow(id: string) {
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            {["Type", "Status", "Expiry Date", "Remarks", ""].map((h) => (
              <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: "4px 6px" }}><input value={r.type} onChange={(e) => update(r.id, { type: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><input value={r.status} onChange={(e) => update(r.id, { status: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><input value={r.expiryDate} onChange={(e) => update(r.id, { expiryDate: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><input value={r.remarks} onChange={(e) => update(r.id, { remarks: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><button onClick={() => deleteRow(r.id)} style={{ fontSize: 11, cursor: "pointer", color: "#b91c1c", border: "none", background: "none" }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} style={{ marginTop: 8, fontSize: 11.5, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>+ Add row</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Key Personnel
// ---------------------------------------------------------------------------
function PersonnelTable({ label, rows, onUpdate, onAdd, onDelete }: {
  label: string;
  rows: PersonnelRow[];
  onUpdate: (id: string, patch: Partial<PersonnelRow>) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <b style={{ fontSize: 12.5 }}>{label}</b>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            {["Name", "Designation", ""].map((h) => (
              <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: "4px 6px" }}><input value={r.name} onChange={(e) => onUpdate(r.id, { name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><input value={r.designation} onChange={(e) => onUpdate(r.id, { designation: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
              <td style={{ padding: "4px 6px" }}><button onClick={() => onDelete(r.id)} style={{ fontSize: 11, cursor: "pointer", color: "#b91c1c", border: "none", background: "none" }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={onAdd} style={{ marginTop: 6, fontSize: 11.5, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>+ Add row</button>
    </div>
  );
}

function KeyPersonnelTab() {
  const kp = useProfileOfPeiStore((s) => s.keyPersonnel);
  const setShareholders = useProfileOfPeiStore((s) => s.setShareholders);
  const setBod = useProfileOfPeiStore((s) => s.setBoardOfDirectors);
  const setMgmt = useProfileOfPeiStore((s) => s.setManagementTeam);
  const setAcad = useProfileOfPeiStore((s) => s.setAcademicExamBoard);

  const totalPct = kp.shareholders.reduce((s, r) => s + (r.percentage || 0), 0);
  const pctWarning = kp.shareholders.length > 0 && Math.abs(totalPct - 100) > 0.01;

  function updateSh(id: string, patch: Partial<ShareholderRow>) {
    setShareholders(kp.shareholders.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      {/* Shareholders */}
      <div style={{ marginBottom: 20 }}>
        <b style={{ fontSize: 12.5 }}>Shareholders / Owners</b>
        {pctWarning && <span style={{ marginLeft: 8, fontSize: 11.5, color: "#b91c1c", fontWeight: 600 }}>Total {totalPct.toFixed(1)}% ≠ 100%</span>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              {["Name", "Shares", "Share Type", "% Ownership", ""].map((h) => (
                <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kp.shareholders.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "4px 6px" }}><input value={r.name} onChange={(e) => updateSh(r.id, { name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
                <td style={{ padding: "4px 6px" }}><input type="number" value={r.shares} onChange={(e) => updateSh(r.id, { shares: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} /></td>
                <td style={{ padding: "4px 6px" }}><input value={r.shareType} onChange={(e) => updateSh(r.id, { shareType: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></td>
                <td style={{ padding: "4px 6px" }}><input type="number" step="0.01" value={r.percentage} onChange={(e) => updateSh(r.id, { percentage: Number(e.target.value) })} style={{ ...inputStyle, width: 80 }} /></td>
                <td style={{ padding: "4px 6px" }}><button onClick={() => setShareholders(kp.shareholders.filter((x) => x.id !== r.id))} style={{ fontSize: 11, cursor: "pointer", color: "#b91c1c", border: "none", background: "none" }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setShareholders([...kp.shareholders, { id: uid(), name: "", shares: 0, shareType: "Ordinary", percentage: 0 }])} style={{ marginTop: 6, fontSize: 11.5, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>+ Add shareholder</button>
      </div>

      <PersonnelTable
        label="Board of Directors"
        rows={kp.boardOfDirectors}
        onUpdate={(id, p) => setBod(kp.boardOfDirectors.map((r) => (r.id === id ? { ...r, ...p } : r)))}
        onAdd={() => setBod([...kp.boardOfDirectors, { id: uid(), name: "", designation: "Director" }])}
        onDelete={(id) => setBod(kp.boardOfDirectors.filter((r) => r.id !== id))}
      />

      <PersonnelTable
        label="Management Team"
        rows={kp.managementTeam}
        onUpdate={(id, p) => setMgmt(kp.managementTeam.map((r) => (r.id === id ? { ...r, ...p } : r)))}
        onAdd={() => setMgmt([...kp.managementTeam, { id: uid(), name: "", designation: "" }])}
        onDelete={(id) => setMgmt(kp.managementTeam.filter((r) => r.id !== id))}
      />

      {/* Academic & Examination Board */}
      <div style={{ marginBottom: 20 }}>
        <b style={{ fontSize: 12.5 }}>Academic & Examination Board</b>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              {["Name", "Designation", "Membership", ""].map((h) => (
                <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kp.academicExamBoard.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "4px 6px" }}><input value={r.name} onChange={(e) => setAcad(kp.academicExamBoard.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} style={{ ...inputStyle, width: "100%" }} /></td>
                <td style={{ padding: "4px 6px" }}><input value={r.designation} onChange={(e) => setAcad(kp.academicExamBoard.map((x) => (x.id === r.id ? { ...x, designation: e.target.value } : x)))} style={{ ...inputStyle, width: "100%" }} /></td>
                <td style={{ padding: "4px 6px" }}><input value={r.membership} onChange={(e) => setAcad(kp.academicExamBoard.map((x) => (x.id === r.id ? { ...x, membership: e.target.value } : x)))} style={{ ...inputStyle, width: "100%" }} /></td>
                <td style={{ padding: "4px 6px" }}><button onClick={() => setAcad(kp.academicExamBoard.filter((x) => x.id !== r.id))} style={{ fontSize: 11, cursor: "pointer", color: "#b91c1c", border: "none", background: "none" }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setAcad([...kp.academicExamBoard, { id: uid(), name: "", designation: "", membership: "" }])} style={{ marginTop: 6, fontSize: 11.5, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>+ Add member</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Facilities
// ---------------------------------------------------------------------------
function FacilitiesTab() {
  const f = useProfileOfPeiStore((s) => s.facilities);
  const setFacilities = useProfileOfPeiStore((s) => s.setFacilities);

  function field(label: string, key: keyof typeof f) {
    return (
      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
        <input value={f[key]} onChange={(e) => setFacilities({ ...f, [key]: e.target.value })} style={{ ...inputStyle, display: "block", width: "100%", marginTop: 3 }} />
      </label>
    );
  }

  return (
    <div>
      {field("Main Premises Address", "mainPremisesAddress")}
      {field("Unit Number", "unitNumber")}
      {field("Postal Code", "postalCode")}
      {field("Shared Premises Status", "sharedPremisesStatus")}
      <label style={{ display: "block", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Facilities Summary</span>
        <textarea value={f.facilitiesSummary} onChange={(e) => setFacilities({ ...f, facilitiesSummary: e.target.value })} rows={4} style={{ ...inputStyle, display: "block", width: "100%", marginTop: 3, resize: "vertical" }} />
      </label>
      {field("Remarks", "remarks")}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — Financial Health
// ---------------------------------------------------------------------------
function FinancialHealthTab() {
  const text = useProfileOfPeiStore((s) => s.financialHealthMarkdown);
  const setText = useProfileOfPeiStore((s) => s.setFinancialHealthMarkdown);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>Markdown — paste or type the financial summary table here.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5 }} />
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{text.length} characters</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Courses Offered
// ---------------------------------------------------------------------------
function CoursesOfferedTab() {
  const courses = useProfileOfPeiStore((s) => s.coursesOffered);
  const setCoursesOffered = useProfileOfPeiStore((s) => s.setCoursesOffered);
  const updateCourse = useProfileOfPeiStore((s) => s.updateCourse);

  function addCourse() {
    setCoursesOffered([...courses, { id: uid(), courseName: "", department: "", abbreviation: "", ftContactHours: "", ptContactHours: "", ftMonths: "" }]);
  }
  function deleteCourse(id: string) {
    setCoursesOffered(courses.filter((c) => c.id !== id));
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            {["Course Name", "Department", "Abbrev.", "FT Contact Hours", "PT Contact Hours", "FT Months", ""].map((h) => (
              <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "3px 5px" }}><input value={c.courseName} onChange={(e) => updateCourse(c.id, { courseName: e.target.value })} style={{ ...inputStyle, width: 240, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><input value={c.department} onChange={(e) => updateCourse(c.id, { department: e.target.value })} style={{ ...inputStyle, width: 200, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><input value={c.abbreviation} onChange={(e) => updateCourse(c.id, { abbreviation: e.target.value })} style={{ ...inputStyle, width: 80, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><input value={c.ftContactHours} onChange={(e) => updateCourse(c.id, { ftContactHours: e.target.value })} style={{ ...inputStyle, width: 80, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><input value={c.ptContactHours} onChange={(e) => updateCourse(c.id, { ptContactHours: e.target.value })} style={{ ...inputStyle, width: 80, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><input value={c.ftMonths} onChange={(e) => updateCourse(c.id, { ftMonths: e.target.value })} style={{ ...inputStyle, width: 70, fontSize: 11.5 }} /></td>
              <td style={{ padding: "3px 5px" }}><button onClick={() => deleteCourse(c.id)} style={{ fontSize: 11, cursor: "pointer", color: "#b91c1c", border: "none", background: "none" }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addCourse} style={{ marginTop: 8, fontSize: 11.5, cursor: "pointer", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>+ Add course</button>
      <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 12 }}>{courses.length} courses</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Student Profile
// ---------------------------------------------------------------------------
function StudentProfileTab() {
  const text = useProfileOfPeiStore((s) => s.studentProfileMarkdown);
  const setText = useProfileOfPeiStore((s) => s.setStudentProfileMarkdown);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>Markdown — enrolment breakdown, nationality mix, study mode split, etc.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5 }} />
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{text.length} characters</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Staff Profile
// ---------------------------------------------------------------------------
function StaffProfileTab() {
  const text = useProfileOfPeiStore((s) => s.staffProfileMarkdown);
  const setText = useProfileOfPeiStore((s) => s.setStaffProfileMarkdown);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>Markdown — headcount, categories, key personnel notes, etc.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5 }} />
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{text.length} characters</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function ProfileOfPei() {
  const [tab, setTab] = useState(0);

  const providedDate = useProfileOfPeiStore((s) => s.providedDate);
  const setProvidedDate = useProfileOfPeiStore((s) => s.setProvidedDate);
  const backgroundMarkdown = useProfileOfPeiStore((s) => s.backgroundMarkdown);

  const injectionOn = useWorkspaceStore((s) => s.schoolContext.enabled !== false);
  const setSchoolContextEnabled = useWorkspaceStore((s) => s.setSchoolContextEnabled);
  const setSchoolContextText = useWorkspaceStore((s) => s.setSchoolContextText);

  // Sync background into schoolContext on mount so the context is always up to date
  useEffect(() => {
    setSchoolContextText(backgroundMarkdown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabContent = [
    <BackgroundTab />,
    <ErfTab />,
    <KeyPersonnelTab />,
    <FacilitiesTab />,
    <FinancialHealthTab />,
    <CoursesOfferedTab />,
    <StudentProfileTab />,
    <StaffProfileTab />,
  ];

  return (
    <div className="grid gap-3">
      {/* Header */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>PROFILE OF PEI</h2>
          <span style={{ fontSize: 12.5, color: "#6b7280" }}>
            The following information was provided by the PEI on{" "}
            <input
              value={providedDate}
              onChange={(e) => setProvidedDate(e.target.value)}
              style={{ ...inputStyle, display: "inline", width: 90, padding: "2px 5px", fontSize: 12.5 }}
            />
          </span>
        </div>

        {/* AI audit context strip */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            <input type="checkbox" checked={injectionOn} onChange={(e) => setSchoolContextEnabled(e.target.checked)} />
            Inject as AI audit context
          </label>
          <Pill s={injectionOn ? "good" : "medium"}>{injectionOn ? "On" : "Off"}</Pill>
          <span style={{ fontSize: 11.5, color: "#6b7280" }}>
            Background tab content is sent as auditor briefing — not primary GD4 evidence
          </span>
        </div>
      </Card>

      {/* Tab bar */}
      <Card>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 8 }}>
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              style={{
                cursor: "pointer",
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: 6,
                border: i === tab ? "1.5px solid #6366f1" : "1px solid #e2e8f0",
                background: i === tab ? "#eef2ff" : "#fff",
                color: i === tab ? "#4338ca" : "#374151",
                fontWeight: i === tab ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {tabContent[tab]}
      </Card>
    </div>
  );
}
