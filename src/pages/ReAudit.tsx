import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone } from "../lib/theme";
import { FINDINGS } from "../data/findings";

export function ReAudit() {
  const closures = useWorkspaceStore((s) => s.closures);
  const confirmScore = useWorkspaceStore((s) => s.confirmScore);
  const scored = useScored();

  const closedFindings = FINDINGS.filter((f) => closures[f.id]?.human === "Accepted");
  const belowBand3 = scored.items.filter((it) => it.band < 3);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Closed findings — candidates for re-audit</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          After corrective action is accepted, the linked GD4 item should be re-checked and rescored rather than left on its old confirmed score.
        </p>
        {closedFindings.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No findings have been closed yet.</p>}
        {closedFindings.map((f) => {
          const item = scored.items.find((it) => it.id === f.gd4ItemId);
          return (
            <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #eef1f5", padding: "9px 0", flexWrap: "wrap" }}>
              <b style={{ color: "#ce9e5d" }}>{f.id}</b>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, color: "#6b7280" }}>{f.gd4ItemId}</span>
              <span style={{ fontSize: 12.5, flex: "1 1 260px" }}>{f.issue}</span>
              {item && <Pill s={bandTone(item.band)}>Band {item.band}</Pill>}
              {item && item.conf != null && (
                <button
                  onClick={() => confirmScore(item.id)}
                  style={{ cursor: "pointer", fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  Reopen for re-score
                </button>
              )}
              {item && item.conf == null && <Pill s="medium">Open for re-score</Pill>}
            </div>
          );
        })}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Items still below Band 3 ({belowBand3.length})</h3>
        <table>
          <thead><tr><th>Item</th><th>Band</th><th>Effective score</th></tr></thead>
          <tbody>
            {belowBand3.map((it) => (
              <tr key={it.id} className="rowh">
                <td><b>{it.id}</b> {it.title}{it.gate && <Pill s="medium">gate</Pill>}</td>
                <td><Pill s={bandTone(it.band)}>Band {it.band}</Pill></td>
                <td>{it.eff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
