import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";

export function DraftWorkspace() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const history = useWorkspaceStore((s) => s.history);
  const saveDraft = useWorkspaceStore((s) => s.saveDraft);
  const lockCycle = useWorkspaceStore((s) => s.lockCycle);
  const unlockCycle = useWorkspaceStore((s) => s.unlockCycle);
  const duplicateCycle = useWorkspaceStore((s) => s.duplicateCycle);
  const locked = cycle.status === "Locked";

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Draft workspace</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          This is a long-running workspace, not a one-time checklist. Save progress, duplicate prior cycles, and lock a version once finalised.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <Pill s={locked ? "critical" : "progress"}>{cycle.status}</Pill>
          <b style={{ fontSize: 13 }}>{cycle.version}</b>
        </div>
        <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 12 }}>
          Last saved: {cycle.lastSavedAt}
          <br />
          Created {new Date(cycle.createdAt).toLocaleDateString()} · updated {new Date(cycle.updatedAt).toLocaleDateString()}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={saveDraft}
            disabled={locked}
            style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Save draft
          </button>
          <button onClick={duplicateCycle} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
            Duplicate cycle
          </button>
          {locked ? (
            <button onClick={unlockCycle} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
              Unlock (admin)
            </button>
          ) : (
            <button onClick={lockCycle} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
              Lock final version
            </button>
          )}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Version history</h3>
        {history.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No saved versions yet. Use Save draft.</p>}
        {history.map((h, i) => (
          <div key={i} style={{ fontSize: 12.5, padding: "7px 0", borderBottom: "1px solid #eef1f5" }}>
            <b>{h.version}</b> · {h.date}
            <br />
            <span style={{ color: "#6b7280" }}>{h.status} — {h.note}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
