import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { toneFor } from "../lib/theme";
import type { FolderStatus } from "../types";

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];

export function EvidenceFolder() {
  const folders = useWorkspaceStore((s) => s.folders);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence folder index</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        One evidence folder per GD4 sub-criterion, linked to its source system and owning department.
      </p>
      <table>
        <thead>
          <tr><th>Folder</th><th>Sub-criterion</th><th>Source</th><th>Owner</th><th>Status</th><th>Missing</th><th>Link</th><th>Last checked</th></tr>
        </thead>
        <tbody>
          {folders.map((f) => (
            <tr key={f.id} className="rowh">
              <td><b>{f.folderName}</b></td>
              <td>{f.subCriterionId}</td>
              <td>{f.sourceSystem}</td>
              <td>
                <input value={f.owner} onChange={(e) => setFolderField(f.id, "owner", e.target.value)} style={{ ...inputStyle, width: 90, padding: "4px 6px" }} />
              </td>
              <td>
                <select value={f.status} onChange={(e) => setFolderField(f.id, "status", e.target.value as FolderStatus)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
                <Pill s={toneFor(f.status)}>{f.status}</Pill>
              </td>
              <td>
                <input
                  type="number"
                  value={f.missingEvidenceCount}
                  onChange={(e) => setFolderField(f.id, "missingEvidenceCount", Number(e.target.value))}
                  style={{ ...inputStyle, width: 50, padding: "4px 6px" }}
                />
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
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
