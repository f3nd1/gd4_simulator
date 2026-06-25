import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { toneFor } from "../lib/theme";

export function VersionHistory() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const history = useWorkspaceStore((s) => s.history);

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Version history</h3>
        <Pill s={toneFor(cycle.status)}>{cycle.status}</Pill>
        <b style={{ fontSize: 13 }}>{cycle.version}</b>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Draft and final versions are kept separate. Locked final versions should not be edited directly — unlock from Draft Workspace first.
      </p>
      {history.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No saved versions yet.</p>}
      <table>
        <thead><tr><th>Version</th><th>Date</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={i} className="rowh">
              <td><b>{h.version}</b></td>
              <td>{h.date}</td>
              <td><Pill s={toneFor(h.status)}>{h.status}</Pill></td>
              <td style={{ color: "#6b7280" }}>{h.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
