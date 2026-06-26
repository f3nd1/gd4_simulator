import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { toneFor } from "../lib/theme";

export function VersionHistory() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const versions = useWorkspaceStore((s) => s.versions);
  const restoreVersion = useWorkspaceStore((s) => s.restoreVersion);

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Version history</h3>
        <Pill s={toneFor(cycle.status)}>{cycle.status}</Pill>
        <b style={{ fontSize: 13 }}>{cycle.version}</b>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Each row is a full snapshot of the workspace at the time it was saved. Restoring a version replaces the current working
        state with that snapshot — locked final versions should be unlocked from Draft Workspace before further edits.
      </p>
      {versions.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No saved versions yet.</p>}
      <table>
        <thead><tr><th>Name</th><th>Version</th><th>Date</th><th>Status</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="rowh">
              <td><b>{v.name}</b></td>
              <td>{v.version}</td>
              <td>{v.date}</td>
              <td><Pill s={toneFor(v.status)}>{v.status}</Pill></td>
              <td style={{ color: "#6b7280" }}>{v.note}</td>
              <td>
                <button
                  onClick={() => restoreVersion(v.id)}
                  style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
