import { Fragment } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { FolderStatus } from "../types";

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];
const CONFIDENCE_TONE = { Low: "critical", Medium: "medium", High: "good" } as const;

export function EvidenceFolder() {
  const folders = useWorkspaceStore((s) => s.folders);
  const departments = useWorkspaceStore((s) => s.departments);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const checkFolderContent = useWorkspaceStore((s) => s.checkFolderContent);
  const busy = useWorkspaceStore((s) => s.busy);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence folder index</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        One evidence folder per GD4 sub-criterion. All folders live in Google Drive — the owning department is set up on the Audit Cycle page.
      </p>
      <table>
        <thead>
          <tr><th>Sub-criterion</th><th>Owner</th><th>Status</th><th>Link</th><th>Last checked</th><th>Action</th></tr>
        </thead>
        <tbody>
          {folders.map((f) => (
            <Fragment key={f.id}>
              <tr className="rowh">
                <td><b>{f.folderName}</b></td>
                <td>
                  <select value={f.owner} onChange={(e) => setFolderField(f.id, "owner", e.target.value)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                    <option value="">(unassigned)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.acronym}>
                        {d.acronym}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={f.status} onChange={(e) => setFolderField(f.id, "status", e.target.value as FolderStatus)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    placeholder="https://drive.google.com/…"
                    value={f.folderLink || ""}
                    onChange={(e) => setFolderField(f.id, "folderLink", e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: "4px 6px" }}
                  />
                  {f.folderLink && (
                    <a href={f.folderLink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, marginLeft: 4 }}>
                      Open
                    </a>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    value={f.lastCheckedDate || ""}
                    onChange={(e) => setFolderField(f.id, "lastCheckedDate", e.target.value)}
                    style={{ ...inputStyle, width: 130, padding: "4px 6px" }}
                  />
                </td>
                <td>
                  <button
                    disabled={busy === "folderchk" + f.id}
                    onClick={() => checkFolderContent(f.id)}
                    style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
                  >
                    {busy === "folderchk" + f.id ? "Checking…" : "Check with AI"}
                  </button>
                </td>
              </tr>
              {f.aiCheckNote && (
                <tr>
                  <td colSpan={6} style={{ background: "#f8fafc", fontSize: 12, padding: "6px 10px" }}>
                    <Pill s={CONFIDENCE_TONE[f.aiCheckConfidence || "Low"]}>{f.aiCheckConfidence || "Low"} confidence</Pill>{" "}
                    {f.aiCheckNote} <span style={{ color: "#94a3b8" }}>— checked {f.aiCheckAt}</span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
