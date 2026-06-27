import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

const PLACEHOLDER = `# About this institution

- **Name / type:** e.g. United Ceres College — private education institution (PEI)
- **Mission & values:** …
- **Programmes offered:** …
- **Size:** staff headcount, student enrolment, number of campuses
- **Governance / structure:** board, management representative (MR), key departments
- **Context that helps an auditor judge evidence:** recent changes, known constraints, history with EduTrust, etc.

Markdown is fine. Keep it factual — this is the auditor's briefing, not evidence.`;

export function SchoolContext() {
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const setSchoolContextText = useWorkspaceStore((s) => s.setSchoolContextText);
  const setSchoolContextLink = useWorkspaceStore((s) => s.setSchoolContextLink);
  const readSchoolContextFromDrive = useWorkspaceStore((s) => s.readSchoolContextFromDrive);
  const [reading, setReading] = useState(false);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>School context — the auditor's briefing</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Background knowledge about this institution. It is <b>injected into every AI assessment</b> (folder audits, item
          reviews, checklist generation, closure reviews) as context, so the AI interprets evidence the way a briefed
          auditor would instead of starting blind each time. It is <b>not evidence</b> — it can't on its own satisfy any
          requirement. Saved with the workspace, so it persists across sessions.
        </p>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Context briefing (markdown)</span>
          <textarea
            value={schoolContext.text}
            onChange={(e) => setSchoolContextText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={16}
            style={{ ...inputStyle, marginTop: 3, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5 }}
          />
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{schoolContext.text.length} characters</span>
        </label>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px", background: "#f8fafc" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
            <b style={{ fontSize: 12, color: "#475569" }}>Optional: pull extra context from a Drive folder</b>
            {schoolContext.accessStatus && <Pill s={ACCESS_TONE[schoolContext.accessStatus]}>{schoolContext.accessStatus}</Pill>}
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", margin: "4px 0 6px" }}>
            Link a folder of background documents (prospectus, org chart, institutional profile). "Read from Drive" caches
            its text and appends it to the briefing above. Requires Google Drive connected in Settings.
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
        </div>
      </Card>
    </div>
  );
}
