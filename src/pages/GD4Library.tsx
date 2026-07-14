import { useState } from "react";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { EdutrustBandTable } from "../components/ui/EdutrustBandTable";

export function GD4Library() {
  const [selId, setSelId] = useState(GD4_REQUIREMENTS[0]?.id);
  const req = GD4_REQUIREMENTS.find((r) => r.id === selId) || GD4_REQUIREMENTS[0];

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1.3fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>GD4 library</h3>
        <div style={{ maxHeight: 560, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Item</th><th>Area</th></tr></thead>
            <tbody>
              {GD4_REQUIREMENTS.map((r) => (
                <tr key={r.id} className="rowh" onClick={() => setSelId(r.id)} style={{ cursor: "pointer", background: selId === r.id ? "#f4f6f9" : "transparent" }}>
                  <td>
                    <b>{r.itemNumber}</b>
                    {r.gateSensitive && <span style={{ marginLeft: 4, fontSize: 10, color: "#9a6b15" }}>gate</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.requirement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>
          {req.itemNumber} {req.requirement}
        </h3>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
          Criterion C{req.criterion} · {req.area} · weightage {req.weightage} · {req.maxPoints} pts max
          {req.gateSensitive && <Pill s="medium">Gate sensitive</Pill>}
        </div>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Intent</span>
          <textarea readOnly rows={5} value={req.intent} style={{ ...inputStyle, marginTop: 3, resize: "vertical", minHeight: 96 }} />
        </label>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Expected evidence</span>
          <ul style={{ fontSize: 12.5, margin: "4px 0 0", paddingLeft: 18 }}>
            {req.expectedEvidence.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Official band rubric (para. 23 — same table for every item)</span>
          <div style={{ marginTop: 6 }}>
            <EdutrustBandTable />
          </div>
        </div>
        {req.scoringNotes && <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>{req.scoringNotes}</div>}
      </Card>
    </div>
  );
}
