import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Bar } from "../components/ui/Bar";
import { BLUE, GOLD, TONE } from "../lib/theme";
import type { AuditorProfile, AuditorType } from "../types";

const TYPES: AuditorType[] = ["Internal", "External", "AI Agent"];
const TEMPLATES = ["Audit Lead Checklist", "GD4 Criterion Checklist", "Evidence Controller Checklist", "Student Protection Checklist", "Academic Process Checklist", "QA Closure Checklist", "Management Review Checklist"];

export function AuditorCreation() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const addAuditor = useWorkspaceStore((s) => s.addAuditor);
  const removeAuditor = useWorkspaceStore((s) => s.removeAuditor);
  const agents = useWorkspaceStore((s) => s.agents);
  const setAgentStrictness = useWorkspaceStore((s) => s.setAgentStrictness);

  const [form, setForm] = useState({ name: "", type: "Internal" as AuditorType, department: "", role: "", strictness: 70, focusArea: "", checklistTemplateId: TEMPLATES[0] });

  function submit() {
    if (!form.name.trim() || !form.role.trim()) return;
    const a: AuditorProfile = { id: `AUD-${Date.now()}`, auditCycleId: cycle.id, ...form };
    addAuditor(a);
    setForm({ name: "", type: "Internal", department: "", role: "", strictness: 70, focusArea: "", checklistTemplateId: TEMPLATES[0] });
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Create auditor</h3>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <input placeholder="Auditor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AuditorType })} style={inputStyle}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} style={inputStyle} />
          <input placeholder="Role (e.g. Department Reviewer)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle} />
          <input placeholder="Focus area" value={form.focusArea} onChange={(e) => setForm({ ...form, focusArea: e.target.value })} style={inputStyle} />
          <select value={form.checklistTemplateId} onChange={(e) => setForm({ ...form, checklistTemplateId: e.target.value })} style={inputStyle}>
            {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>Strictness</span>
          <input type="range" min={20} max={95} value={form.strictness} onChange={(e) => setForm({ ...form, strictness: Number(e.target.value) })} style={{ flex: 1 }} />
          <b style={{ fontSize: 12 }}>{form.strictness}</b>
        </div>
        <button onClick={submit} style={{ marginTop: 10, cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          Create auditor
        </button>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Auditor profiles ({auditors.length})</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Department</th><th>Role</th><th>Focus</th><th>Checklist template</th><th>Strictness</th><th></th></tr>
          </thead>
          <tbody>
            {auditors.map((a) => (
              <tr key={a.id} className="rowh">
                <td><b>{a.name}</b></td>
                <td>{a.type}</td>
                <td>{a.department || "—"}</td>
                <td>{a.role}</td>
                <td style={{ color: "#6b7280" }}>{a.focusArea}</td>
                <td style={{ color: "#6b7280" }}>{a.checklistTemplateId}</td>
                <td>{a.strictness}</td>
                <td>
                  <button onClick={() => removeAuditor(a.id)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Simulated AI agent roles</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          These four roles power the offline-simulated checks on Evidence Intelligence, Auditor Checklist and AFI Closure. They challenge and recommend; they never finalise a score. See AI Agent Review for the full verdict log.
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {agents.map((a) => (
            <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {a.name} <span style={{ fontSize: 11, color: BLUE }}>AI agent</span>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", minHeight: 32 }}>{a.focus}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                <span>Strictness</span>
                <b>{a.strictness}</b>
              </div>
              <Bar v={a.strictness} c={a.strictness > 70 ? TONE.critical.fg : GOLD} />
              <input type="range" min={20} max={95} value={a.strictness} onChange={(e) => setAgentStrictness(a.id, Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
