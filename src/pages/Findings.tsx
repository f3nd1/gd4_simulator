import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import type { FindingType, Severity } from "../types";

const TYPES: (FindingType | "All")[] = ["All", "AFI", "Improvement Action", "Observation", "Quality Action", "Critical Readiness Risk"];
const SEVERITIES: (Severity | "All")[] = ["All", "Critical", "High", "Medium", "Low"];

function severityTone(sev: Severity) {
  return sev === "Critical" || sev === "High" ? "critical" : sev === "Medium" ? "medium" : "neutral";
}

export function Findings() {
  const closures = useWorkspaceStore((s) => s.closures);
  const scored = useScored();
  const allFindings = useAllFindings();
  const [typeFilter, setTypeFilter] = useState<FindingType | "All">("All");
  const [sevFilter, setSevFilter] = useState<Severity | "All">("All");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [subCritFilter, setSubCritFilter] = useState<string>("All");

  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );

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
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "nowrap", overflowX: "auto" }}>
        <select
          value={critFilter}
          onChange={(e) => {
            setCritFilter(e.target.value);
            setSubCritFilter("All");
          }}
          style={{ ...inputStyle, width: "auto", flex: "1 1 0" }}
        >
          <option value="All">All criteria</option>
          {GD4_CRITERIA.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} — {c.title}
            </option>
          ))}
        </select>
        <select value={subCritFilter} onChange={(e) => setSubCritFilter(e.target.value)} style={{ ...inputStyle, width: "auto", flex: "1 1 0" }}>
          <option value="All">All sub-criteria</option>
          {subCritOptions.map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.id} — {sc.title}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as FindingType | "All")} style={{ ...inputStyle, width: "auto", flex: "1 1 0" }}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value as Severity | "All")} style={{ ...inputStyle, width: "auto", flex: "1 1 0" }}>
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
        Carried over from the April 2026 internal mock audit. Open and manage closure for each finding on the Quality Action / AFI screen.
      </div>
    </Card>
  );
}
