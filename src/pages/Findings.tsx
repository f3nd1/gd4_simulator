import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, filterSelectStyle, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { GOLD, INK } from "../lib/theme";
import type { Finding, FindingType, Severity } from "../types";

const TYPES: (FindingType | "All")[] = ["All", "AFI", "Improvement Action", "Observation", "Quality Action", "Critical Readiness Risk"];
const SEVERITIES: (Severity | "All")[] = ["All", "Critical", "High", "Medium", "Low"];
const RAISABLE_TYPES: FindingType[] = ["AFI", "Improvement Action", "Observation", "Quality Action", "Critical Readiness Risk"];

function severityTone(sev: Severity) {
  return sev === "Critical" || sev === "High" ? "critical" : sev === "Medium" ? "medium" : "neutral";
}

const EMPTY_FORM = {
  gd4ItemId: GD4_REQUIREMENTS[0]?.id || "",
  issue: "",
  type: "AFI" as FindingType,
  severity: "Medium" as Severity,
  owner: "",
  dueDate: "",
  repeatFinding: false,
};

export function Findings() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const closures = useWorkspaceStore((s) => s.closures);
  const addCustomFinding = useWorkspaceStore((s) => s.addCustomFinding);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  const scored = useScored();
  const allFindings = useAllFindings();
  const [typeFilter, setTypeFilter] = useState<FindingType | "All">("All");
  const [sevFilter, setSevFilter] = useState<Severity | "All">("All");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [subCritFilter, setSubCritFilter] = useState<string>("All");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );

  function submitFinding() {
    if (!form.issue.trim() || !form.gd4ItemId) return;
    const finding: Finding = {
      id: `FIND-${Date.now()}`,
      auditCycleId: cycle.id,
      gd4ItemId: form.gd4ItemId,
      issue: form.issue.trim(),
      type: form.type,
      severity: form.severity,
      owner: form.owner.trim(),
      dueDate: form.dueDate,
      repeatFinding: form.repeatFinding,
      overdue: false,
      managementDecisionNeeded: form.severity === "Critical" || form.severity === "High",
      status: "Open",
    };
    addCustomFinding(finding);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  const rows = allFindings.filter((f) => {
    if (typeFilter !== "All" && f.type !== typeFilter) return false;
    if (sevFilter !== "All" && f.severity !== sevFilter) return false;
    const req = GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId);
    if (critFilter !== "All" && req?.criterion !== critFilter) return false;
    if (subCritFilter !== "All" && req?.subCriterionId !== subCritFilter) return false;
    return true;
  });

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Findings register</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {scored.openAFIs} of {allFindings.length} still open
        </span>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "6px 12px", borderRadius: 8, fontSize: 12 }}
        >
          {showForm ? "Cancel" : "Raise finding"}
        </button>
      </div>

      {showForm && (
        <Card style={{ background: "#f8fafc", marginBottom: 12 }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>GD4 item</span>
              <select value={form.gd4ItemId} onChange={(e) => setForm({ ...form, gd4ItemId: e.target.value })} style={{ ...inputStyle, marginTop: 3 }}>
                {GD4_REQUIREMENTS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} — {r.requirement.slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FindingType })} style={{ ...inputStyle, marginTop: 3 }}>
                {RAISABLE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Severity</span>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })} style={{ ...inputStyle, marginTop: 3 }}>
                {(["Critical", "High", "Medium", "Low"] as Severity[]).map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Owner</span>
              <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="Department acronym" style={{ ...inputStyle, marginTop: 3 }} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Due date</span>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input type="checkbox" checked={form.repeatFinding} onChange={(e) => setForm({ ...form, repeatFinding: e.target.checked })} />
              <span style={{ fontSize: 12.5 }}>Repeat finding</span>
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Issue</span>
              <textarea
                value={form.issue}
                onChange={(e) => setForm({ ...form, issue: e.target.value })}
                placeholder="Describe the issue found"
                rows={2}
                style={{ ...inputStyle, marginTop: 3, resize: "vertical" }}
              />
            </label>
          </div>
          <button
            onClick={submitFinding}
            disabled={!form.issue.trim()}
            style={{ marginTop: 10, cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 14px", borderRadius: 8, fontSize: 12.5 }}
          >
            Save finding
          </button>
        </Card>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <select
          value={critFilter}
          onChange={(e) => {
            setCritFilter(e.target.value);
            setSubCritFilter("All");
          }}
          style={filterSelectStyle}
        >
          <option value="All">All criteria</option>
          {GD4_CRITERIA.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} — {c.title}
            </option>
          ))}
        </select>
        <select value={subCritFilter} onChange={(e) => setSubCritFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All sub-criteria</option>
          {subCritOptions.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.id} — {sc.title}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as FindingType | "All")} style={filterSelectStyle}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as Severity | "All")} style={filterSelectStyle}>
          {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr><th>ID</th><th>GD4 item</th><th>Issue</th><th>Type</th><th>Severity</th><th>Owner</th><th>Due</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const closed = (closures[f.id]?.human || "") === "Accepted";
            return (
              <tr key={f.id} className="rowh">
                <td><b style={{ color: "#ce9e5d" }}>{f.id}</b></td>
                <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, color: "#6b7280" }}>{f.gd4ItemId}</td>
                <td style={{ fontSize: 12.5 }}>{f.issue}</td>
                <td>{f.type}</td>
                <td><Pill s={severityTone(f.severity)}>{f.severity}</Pill></td>
                <td>{f.owner}</td>
                <td style={{ color: "#6b7280" }}>{f.dueDate}</td>
                <td><Pill s={closed ? "good" : "critical"}>{closed ? "Closed" : "Open"}</Pill></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 10 }}>
        {seedFindingsLoaded && "Includes findings carried over from the loaded demo dataset. "}
        Open and manage closure for each finding on the Quality Action / AFI screen.
      </div>
    </Card>
  );
}
