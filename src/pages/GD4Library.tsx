import { useState } from "react";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import {
  GD4_REQUIREMENTS,
  SUBMISSION_FILE_TYPES,
  GENERAL_SUPPORTING_DOCS,
  SUPPORTING_DOCS_TEMPLATE_NOTE,
  SUBMISSION_PRIVACY_NOTE,
} from "../data/gd4Requirements";

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

        <div style={{ marginBottom: 10, border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", background: "#f8fafc" }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Files to submit — 3 types</span>
          <ol style={{ fontSize: 12.5, margin: "4px 0 8px", paddingLeft: 18 }}>
            {SUBMISSION_FILE_TYPES.map((t, i) => (
              <li key={t}>
                {t}
                {i === 2 && (
                  <ul style={{ margin: "3px 0 0", paddingLeft: 16, color: "#475569" }}>
                    {GENERAL_SUPPORTING_DOCS.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <div style={{ fontSize: 11, color: "#6b7280" }}>{SUPPORTING_DOCS_TEMPLATE_NOTE}</div>
          <div style={{ fontSize: 11, color: "#b23121", fontWeight: 600, marginTop: 2 }}>{SUBMISSION_PRIVACY_NOTE}</div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Expected evidence</span>
          <ul style={{ fontSize: 12.5, margin: "4px 0 0", paddingLeft: 18 }}>
            {req.expectedEvidence.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Band descriptors</span>
          {Object.entries(req.bandDescriptors).map(([band, desc]) => (
            <div key={band} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid #eef1f5" }}>
              <b>{band}:</b> {desc}
            </div>
          ))}
        </div>
        {req.scoringNotes && <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>{req.scoringNotes}</div>}
      </Card>
    </div>
  );
}
