import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { INK } from "../lib/theme";
import type { CycleStatus } from "../types";

const STATUSES: CycleStatus[] = ["Draft", "Under Review", "Returned for Amendment", "Ready for Management Review", "Finalised", "Locked"];

export function AuditCycle() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const updateCycle = useWorkspaceStore((s) => s.updateCycle);
  const duplicateCycle = useWorkspaceStore((s) => s.duplicateCycle);
  const locked = cycle.status === "Locked";

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Audit cycle setup</h3>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Name</span>
          <input disabled={locked} value={cycle.name} onChange={(e) => updateCycle({ name: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Audit type</span>
          <input disabled={locked} value={cycle.type} onChange={(e) => updateCycle({ type: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ display: "block", marginBottom: 10, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Period start</span>
            <input disabled={locked} type="date" value={cycle.periodStart} onChange={(e) => updateCycle({ periodStart: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
          </label>
          <label style={{ display: "block", marginBottom: 10, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Period end</span>
            <input disabled={locked} type="date" value={cycle.periodEnd} onChange={(e) => updateCycle({ periodEnd: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Evidence cut-off date</span>
          <input disabled={locked} type="date" value={cycle.evidenceCutOffDate} onChange={(e) => updateCycle({ evidenceCutOffDate: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Scope</span>
          <textarea disabled={locked} rows={2} value={cycle.scope} onChange={(e) => updateCycle({ scope: e.target.value })} style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Departments included</span>
          <input
            disabled={locked}
            value={cycle.departments.join(", ")}
            onChange={(e) => updateCycle({ departments: e.target.value.split(",").map((d) => d.trim()).filter(Boolean) })}
            style={{ ...inputStyle, marginTop: 3 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Audit owner</span>
          <input disabled={locked} value={cycle.owner} onChange={(e) => updateCycle({ owner: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Google Drive root folder URL</span>
          <input disabled={locked} value={cycle.driveRoot || ""} onChange={(e) => updateCycle({ driveRoot: e.target.value })} placeholder="https://drive.google.com/…" style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        {cycle.driveRoot && (
          <a href={cycle.driveRoot} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            Open Drive root folder
          </a>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Status &amp; lifecycle</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={locked && s !== "Locked"}
              onClick={() => updateCycle({ status: s })}
              style={{
                cursor: "pointer",
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 7,
                border: "1px solid #cbd5e1",
                background: cycle.status === s ? INK : "#fff",
                color: cycle.status === s ? "#fff" : "#1f2733",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#6b7280" }}>
          Version <b>{cycle.version}</b> · last saved {cycle.lastSavedAt}
        </p>
        <p style={{ fontSize: 12, color: "#6b7280" }}>
          Created {new Date(cycle.createdAt).toLocaleDateString()} · updated {new Date(cycle.updatedAt).toLocaleDateString()}
        </p>
        <button onClick={duplicateCycle} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
          Duplicate this cycle
        </button>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 14 }}>
          Use Draft Workspace to save progress and review version history. Locked cycles cannot be edited except by unlocking from the Finalisation Checklist screen.
        </div>
      </Card>
    </div>
  );
}
