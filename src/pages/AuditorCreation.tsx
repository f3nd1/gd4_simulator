import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Bar } from "../components/ui/Bar";
import { BLUE, GOLD, TONE } from "../lib/theme";
import type { AuditorProfile, AuditorType, ReviewPerspective } from "../types";
import { REVIEW_PERSPECTIVES, DEFAULT_PERSPECTIVE, perspectiveLabel, MIN_PANEL, MAX_PANEL, isValidPanel } from "../lib/reviewPanel";
import { Pill } from "../components/ui/Pill";

const TYPES: AuditorType[] = ["Internal", "External", "AI Agent"];
const TEMPLATES = ["Audit Lead Checklist", "GD4 Criterion Checklist", "Evidence Controller Checklist", "Student Protection Checklist", "Academic Process Checklist", "QA Closure Checklist", "Management Review Checklist"];

const EMPTY_FORM = { name: "", type: "Internal" as AuditorType, departmentId: "", role: "", strictness: 70, focusArea: "", checklistTemplateId: TEMPLATES[0], reviewPerspective: DEFAULT_PERSPECTIVE as ReviewPerspective };

export function AuditorCreation() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const addAuditor = useWorkspaceStore((s) => s.addAuditor);
  const updateAuditor = useWorkspaceStore((s) => s.updateAuditor);
  const removeAuditor = useWorkspaceStore((s) => s.removeAuditor);
  const departments = useWorkspaceStore((s) => s.departments);
  const agents = useWorkspaceStore((s) => s.agents);
  const setAgentStrictness = useWorkspaceStore((s) => s.setAgentStrictness);
  const reviewPanelAuditorIds = useWorkspaceStore((s) => s.reviewPanelAuditorIds);
  const setReviewPanelAuditorIds = useWorkspaceStore((s) => s.setReviewPanelAuditorIds);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  function submit() {
    if (!form.name.trim() || !form.role.trim()) return;
    if (editingId) {
      updateAuditor(editingId, form);
      setEditingId(null);
    } else {
      const a: AuditorProfile = { id: `AUD-${Date.now()}`, auditCycleId: cycle.id, ...form };
      addAuditor(a);
    }
    setForm(EMPTY_FORM);
  }

  function startEdit(a: AuditorProfile) {
    setEditingId(a.id);
    setForm({ name: a.name, type: a.type, departmentId: a.departmentId || "", role: a.role, strictness: a.strictness, focusArea: a.focusArea, checklistTemplateId: a.checklistTemplateId, reviewPerspective: a.reviewPerspective ?? DEFAULT_PERSPECTIVE });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>{editingId ? "Edit auditor" : "Create auditor"}</h3>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <input placeholder="Auditor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AuditorType })} style={inputStyle}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} style={inputStyle}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.acronym} — {d.fullName || d.acronym}</option>)}
          </select>
          <input placeholder="Role (e.g. Department Reviewer)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle} />
          <input placeholder="Focus area" value={form.focusArea} onChange={(e) => setForm({ ...form, focusArea: e.target.value })} style={inputStyle} />
          <select value={form.checklistTemplateId} onChange={(e) => setForm({ ...form, checklistTemplateId: e.target.value })} style={inputStyle}>
            {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select
            value={form.reviewPerspective}
            onChange={(e) => setForm({ ...form, reviewPerspective: e.target.value as ReviewPerspective })}
            title={REVIEW_PERSPECTIVES.find((r) => r.value === form.reviewPerspective)?.guidance}
            style={inputStyle}
          >
            {REVIEW_PERSPECTIVES.map((r) => <option key={r.value} value={r.value}>Perspective: {r.label}</option>)}
          </select>
        </div>
        <p style={{ fontSize: 11.5, color: "#6b7280", margin: "8px 0 0" }}>
          {REVIEW_PERSPECTIVES.find((r) => r.value === form.reviewPerspective)?.guidance}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>Strictness</span>
          <input type="range" min={20} max={95} value={form.strictness} onChange={(e) => setForm({ ...form, strictness: Number(e.target.value) })} style={{ flex: 1 }} />
          <b style={{ fontSize: 12 }}>{form.strictness}</b>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={submit} style={{ cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
            {editingId ? "Save changes" : "Create auditor"}
          </button>
          {editingId && (
            <button onClick={cancelEdit} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontWeight: 600, padding: "8px 14px", borderRadius: 8 }}>
              Cancel
            </button>
          )}
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Auditor profiles ({auditors.length})</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Department</th><th>Role</th><th>Focus</th><th>Perspective</th><th>Strictness</th><th></th></tr>
          </thead>
          <tbody>
            {auditors.map((a) => (
              <tr key={a.id} className="rowh">
                <td><b>{a.name}</b></td>
                <td>{a.type}</td>
                <td>{departments.find((d) => d.id === a.departmentId)?.acronym || "—"}</td>
                <td>{a.role}</td>
                <td style={{ color: "#6b7280" }}>{a.focusArea}</td>
                <td>
                  <select
                    value={a.reviewPerspective ?? DEFAULT_PERSPECTIVE}
                    onChange={(e) => updateAuditor(a.id, { reviewPerspective: e.target.value as ReviewPerspective })}
                    title={REVIEW_PERSPECTIVES.find((r) => r.value === (a.reviewPerspective ?? DEFAULT_PERSPECTIVE))?.guidance}
                    style={{ ...inputStyle, width: 170, padding: "3px 5px", fontSize: 11 }}
                  >
                    {REVIEW_PERSPECTIVES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <input
                    type="range"
                    min={20}
                    max={95}
                    value={a.strictness}
                    onChange={(e) => updateAuditor(a.id, { strictness: Number(e.target.value) })}
                    style={{ width: 70, verticalAlign: "middle" }}
                  />
                  <span style={{ marginLeft: 6 }}>{a.strictness}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => startEdit(a)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 6 }}>
                    Edit
                  </button>
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
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Review Panel</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          Pick {MIN_PANEL} to {MAX_PANEL} auditors to sit on the review panel. When a finding is reviewed, each panellist
          assesses it from their perspective, then their views are combined into one balanced conclusion. Turn the panel
          on and choose when it runs in <b>Settings, Auditor Review Panel</b>.
        </p>
        {auditors.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#94a3b8" }}>Create some auditor profiles above first, then select a panel here.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {auditors.map((a) => {
                const on = reviewPanelAuditorIds.includes(a.id);
                const atMax = !on && reviewPanelAuditorIds.length >= MAX_PANEL;
                return (
                  <button
                    key={a.id}
                    disabled={atMax}
                    onClick={() => setReviewPanelAuditorIds(on ? reviewPanelAuditorIds.filter((id) => id !== a.id) : [...reviewPanelAuditorIds, a.id])}
                    title={atMax ? `A panel is at most ${MAX_PANEL} auditors` : `${a.name} - ${perspectiveLabel(a.reviewPerspective ?? DEFAULT_PERSPECTIVE)}`}
                    style={{
                      cursor: atMax ? "not-allowed" : "pointer", textAlign: "left", borderRadius: 10, padding: "8px 11px", opacity: atMax ? 0.5 : 1,
                      border: `1.5px solid ${on ? "#7c3aed" : "#e2e8f0"}`, background: on ? "#faf5ff" : "#fff", minWidth: 180,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12.5, color: on ? "#5b21b6" : "#0f172a" }}>{on ? "\u2611" : "\u2610"} {a.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{perspectiveLabel(a.reviewPerspective ?? DEFAULT_PERSPECTIVE)}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5 }}>
              {isValidPanel(auditors, reviewPanelAuditorIds)
                ? <Pill s="good">Panel ready - {reviewPanelAuditorIds.length} auditors</Pill>
                : <Pill s="medium">Select {MIN_PANEL}-{MAX_PANEL} auditors ({reviewPanelAuditorIds.length} selected)</Pill>}
            </div>
          </>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Simulated AI agent roles</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          These four roles power the offline-simulated checks on Evidence Intelligence and AFI Closure. They challenge and recommend; they never finalise a score. See AI Agent Review for the full verdict log.
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
