import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Bar } from "../components/ui/Bar";
import { TONE, toneFor } from "../lib/theme";
import type { EvidenceLevel, ItemEvidence } from "../types";

const LIMBS: [keyof ItemEvidence, string][] = [
  ["ppd", "PPD / Approach"],
  ["impl", "Implementation"],
  ["review", "Review limb"],
  ["outcome", "Outcome / KPI"],
];

export function EvidenceMatrix() {
  const scored = useScored();
  const setEvidenceField = useWorkspaceStore((s) => s.setEvidenceField);
  const [selItem, setSelItem] = useState(scored.items[0]?.id);
  const item = scored.items.find((i) => i.id === selItem) || scored.items[0];

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence matrix</h3>
        <div style={{ maxHeight: 540, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Item</th><th>PPD</th><th>Impl</th><th>Review</th><th>Outcome</th><th>AI</th></tr></thead>
            <tbody>
              {scored.items.map((it) => (
                <tr key={it.id} className="rowh" onClick={() => setSelItem(it.id)} style={{ cursor: "pointer", background: selItem === it.id ? "#f4f6f9" : "transparent" }}>
                  <td>
                    <b>{it.id}</b>
                    {it.gate && <span style={{ marginLeft: 4, fontSize: 10, color: TONE.medium.fg }}>gate</span>}
                  </td>
                  {(["ppd", "impl", "review", "outcome"] as const).map((l) => (
                    <td key={l}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, display: "inline-block", background: TONE[toneFor(it.ev[l])].fg }} />
                    </td>
                  ))}
                  <td><b>{it.ais}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>
          {item.id} {item.title}
        </h3>
        {LIMBS.map(([l, lab]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{ flex: 1, fontSize: 12.5 }}>{lab}</span>
            <select
              value={item.ev[l]}
              onChange={(e) => setEvidenceField(item.id, l, e.target.value as EvidenceLevel)}
              style={{ ...inputStyle, width: 120 }}
            >
              <option>good</option>
              <option>Partial</option>
              <option>Missing</option>
            </select>
          </div>
        ))}
        <label style={{ display: "block", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Google Drive evidence folder</span>
          <input value={item.ev.drive || ""} onChange={(e) => setEvidenceField(item.id, "drive", e.target.value)} placeholder="https://drive.google.com/…" style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        {item.ev.drive && (
          <a href={item.ev.drive} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            Open evidence folder
          </a>
        )}
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
          Traceability {item.ev.trace}% · age {item.ev.age} days · owner {item.ev.owner}
        </div>
        <Bar v={item.ev.trace} c={item.ev.trace >= 75 ? TONE.good.fg : TONE.medium.fg} />
        <div style={{ marginTop: 6, fontSize: 13 }}>
          AI suggested score: <b>{item.ais}</b> (Band {item.aiBand})
        </div>
      </Card>
    </div>
  );
}
