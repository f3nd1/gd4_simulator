import { useState, useEffect } from "react";
import { useProfileOfPeiStore } from "../store/useProfileOfPeiStore";
import { useWorkspaceStore, composeSchoolContext } from "../store/useWorkspaceStore";
import { CONTEXT_CHAR_CAP } from "../lib/ai/aiClient";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { PeiStatusRow, ShareholderRow, PersonnelRow, AcademicExamBoardRow, PeiCourseRow } from "../types/profileOfPei";

// Last N chars of the audit journal fed into every AI folder audit — display
// constant only (the injection cap lives with the audit code).
const JOURNAL_AI_CAP = 2000;

const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

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
// Extra AI-context Drive folder — moved from the retired School Context page.
// All values are read from the store at render time (zustand selectors), and
// writes go straight to the store on interaction — nothing is copied on mount,
// so opening this page can never clobber the link, cache or access status.
// ---------------------------------------------------------------------------
function ContextDriveCard() {
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const setSchoolContextLink = useWorkspaceStore((s) => s.setSchoolContextLink);
  const readSchoolContextFromDrive = useWorkspaceStore((s) => s.readSchoolContextFromDrive);
  const [reading, setReading] = useState(false);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Extra AI context from Drive</h3>
        {schoolContext.accessStatus && <Pill s={ACCESS_TONE[schoolContext.accessStatus]}>{schoolContext.accessStatus}</Pill>}
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 6px" }}>
        Link a folder of background documents (prospectus, org chart, institutional profile). "Read from Drive" caches
        its text and appends it to the Background briefing above. Requires Google Drive connected in Settings.
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          placeholder="https://drive.google.com/drive/folders/…"
          value={schoolContext.link || ""}
          onChange={(e) => setSchoolContextLink(e.target.value)}
          style={{ ...inputStyle, width: 300, padding: "4px 6px" }}
        />
        {schoolContext.link && <a href={schoolContext.link} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>Open</a>}
        <button
          disabled={reading}
          onClick={async () => {
            setReading(true);
            try { await readSchoolContextFromDrive(); } finally { setReading(false); }
          }}
          style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
        >
          {reading ? "Reading…" : "Read from Drive"}
        </button>
      </div>
      {schoolContext.accessNote && (
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 6 }}>
          {schoolContext.accessNote}
          {schoolContext.cachedAt && <span style={{ color: "#94a3b8" }}> — last read {new Date(schoolContext.cachedAt).toLocaleString()}</span>}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit Journal — moved verbatim from the retired School Context page. The
// journal store/state and its injection into AI audit prompts are untouched;
// only this viewer/clear UI moved. Values are read at render time — no
// copy-on-mount, so opening the page never wipes or overwrites the journal.
// ---------------------------------------------------------------------------
function AuditJournalCard() {
  const auditJournal = useWorkspaceStore((s) => s.auditJournal);
  const clearAuditJournal = useWorkspaceStore((s) => s.clearAuditJournal);
  const [journalExpanded, setJournalExpanded] = useState(false);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>Audit Journal — running findings log</h3>
          <p style={{ fontSize: 12.5, color: "#6b7280", margin: 0 }}>
            After each folder audit, a compact entry is added here (bands + gaps + APSR dimension). The last {JOURNAL_AI_CAP.toLocaleString()} characters are fed into every subsequent AI folder audit so it can flag <b>recurring cross-criterion gaps</b> (e.g. "Review not documented in 1.1, 2.3 and 4.4 — systemic gap"). Auto-updated; you can clear it to start fresh.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {auditJournal ? (
            <Pill s="good">{auditJournal.split("###").length - 1} sub-criteria logged</Pill>
          ) : (
            <Pill s="medium">Empty — no audits yet</Pill>
          )}
          <button
            onClick={() => setJournalExpanded((v) => !v)}
            style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            {journalExpanded ? "Hide" : "View journal"}
          </button>
          {auditJournal && (
            <button
              onClick={() => { if (confirm("Clear the audit journal? This only removes the AI's running notepad — your checklist verdicts and findings are unaffected.")) clearAuditJournal(); }}
              style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}
            >
              Clear journal
            </button>
          )}
        </div>
      </div>
      {auditJournal && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
        {auditJournal.length.toLocaleString()} chars total · last {Math.min(auditJournal.length, JOURNAL_AI_CAP).toLocaleString()} chars sent to AI per audit call
      </div>}
      {journalExpanded && (
        <pre style={{ margin: 0, padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 400, overflowY: "auto", color: auditJournal ? "#1e293b" : "#94a3b8" }}>
          {auditJournal || "Nothing yet. Run a folder audit to start building the journal."}
        </pre>
      )}
    </Card>
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
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);

  // One-time backfill ONLY when the AI context is still empty (fresh
  // workspace): seed it from the Background tab. Never overwrite an existing
  // context on page open — the old unconditional copy-on-mount clobbered the
  // stored context (and anything a restored version had) every time this page
  // was visited (#24). Ongoing sync happens on EDIT in BackgroundTab instead.
  useEffect(() => {
    if (!schoolContext.text.trim() && backgroundMarkdown.trim()) {
      setSchoolContextText(backgroundMarkdown);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live sent-size estimate for the injected context (briefing + Drive cache).
  const composed = composeSchoolContext({ ...schoolContext, enabled: true });
  const sentChars = Math.min(composed.length, CONTEXT_CHAR_CAP);
  const approxTokens = Math.ceil(sentChars / 4);
  const overCap = composed.length > CONTEXT_CHAR_CAP;

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
          <span style={{ fontSize: 11.5, color: overCap ? "#b23121" : "#6b7280", marginLeft: "auto" }}>
            Sends ~{sentChars.toLocaleString()} chars (~{approxTokens.toLocaleString()} tokens) per AI call
            {overCap && ` — TRUNCATED: only the first ${CONTEXT_CHAR_CAP.toLocaleString()} of ${composed.length.toLocaleString()} chars are sent`}
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

      {/* Moved from the retired School Context page */}
      <ContextDriveCard />
      <AuditJournalCard />
    </div>
  );
}
