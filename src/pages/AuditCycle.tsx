import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { GOLD, INK } from "../lib/theme";
import type { CycleStatus, Department } from "../types";

const STATUSES: CycleStatus[] = ["Draft", "Under Review", "Returned for Amendment", "Ready for Management Review", "Finalised", "Locked"];

const EMPTY_DEPT_FORM = { acronym: "", fullName: "", personInCharge: "" };

export function AuditCycle() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const updateCycle = useWorkspaceStore((s) => s.updateCycle);
  const duplicateCycle = useWorkspaceStore((s) => s.duplicateCycle);
  const departments = useWorkspaceStore((s) => s.departments);
  const addDepartment = useWorkspaceStore((s) => s.addDepartment);
  const updateDepartment = useWorkspaceStore((s) => s.updateDepartment);
  const removeDepartment = useWorkspaceStore((s) => s.removeDepartment);
  const locked = cycle.status === "Locked";

  const [deptForm, setDeptForm] = useState(EMPTY_DEPT_FORM);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);

  function submitDept() {
    if (!deptForm.acronym.trim()) return;
    if (editingDeptId) {
      updateDepartment(editingDeptId, deptForm);
      setEditingDeptId(null);
    } else {
      const d: Department = { id: deptForm.acronym.trim(), ...deptForm };
      addDepartment(d);
    }
    setDeptForm(EMPTY_DEPT_FORM);
  }

  function startEditDept(d: Department) {
    setEditingDeptId(d.id);
    setDeptForm({ acronym: d.acronym, fullName: d.fullName, personInCharge: d.personInCharge });
  }

  function cancelEditDept() {
    setEditingDeptId(null);
    setDeptForm(EMPTY_DEPT_FORM);
  }

  return (
    <div className="flex flex-col gap-3">
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

    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Departments</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        Shared department directory for this workspace. Auditor Creation, Auditor Checklist, Dashboard and the Export
        Centre all reference these records instead of free-typed department names.
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <input placeholder="Acronym (e.g. SQ)" value={deptForm.acronym} onChange={(e) => setDeptForm({ ...deptForm, acronym: e.target.value })} style={inputStyle} />
        <input placeholder="Full name" value={deptForm.fullName} onChange={(e) => setDeptForm({ ...deptForm, fullName: e.target.value })} style={inputStyle} />
        <input placeholder="Person in charge" value={deptForm.personInCharge} onChange={(e) => setDeptForm({ ...deptForm, personInCharge: e.target.value })} style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={submitDept} style={{ cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          {editingDeptId ? "Save changes" : "Add department"}
        </button>
        {editingDeptId && (
          <button onClick={cancelEditDept} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontWeight: 600, padding: "8px 14px", borderRadius: 8 }}>
            Cancel
          </button>
        )}
      </div>

      <table style={{ marginTop: 14 }}>
        <thead><tr><th>Acronym</th><th>Full name</th><th>Person in charge</th><th></th></tr></thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id} className="rowh">
              <td><b>{d.acronym}</b></td>
              <td>{d.fullName || "—"}</td>
              <td style={{ color: "#6b7280" }}>{d.personInCharge || "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => startEditDept(d)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 6 }}>
                  Edit
                </button>
                <button onClick={() => removeDepartment(d.id)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    </div>
  );
}
