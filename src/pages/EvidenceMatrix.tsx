import { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Bar } from "../components/ui/Bar";
import { Pill } from "../components/ui/Pill";
import { TONE, toneFor, BLUE } from "../lib/theme";
import type { EvidenceLevel, ItemEvidence } from "../types";

const LIMBS: [keyof ItemEvidence, string][] = [
  ["approach", "Approach"],
  ["processes", "Processes"],
  ["systemsOutcomes", "Systems & Outcomes"],
  ["review", "Review"],
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
        <div style={{ fontSize: 12, color: BLUE, background: "#eaeef6", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
          This is a quick four-limb rating used as a fast first draft. The <Link to="/sub-checklist">Sub-Criterion Checklist</Link> is
          the source of truth for scoring — once an item has checklist lines, its band comes from there and this rating no longer
          drives the score (those items are tagged <Pill s="progress">via Checklist</Pill> below).
        </div>
        <div style={{ maxHeight: 540, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Item</th><th>Approach</th><th>Processes</th><th>Sys/Outcomes</th><th>Review</th><th>AI</th></tr></thead>
            <tbody>
              {scored.items.map((it) => (
                <tr key={it.id} className="rowh" onClick={() => setSelItem(it.id)} style={{ cursor: "pointer", background: selItem === it.id ? "#f4f6f9" : "transparent" }}>
                  <td>
                    <b>{it.id}</b>
                    {it.gate && <span style={{ marginLeft: 4, fontSize: 10, color: TONE.medium.fg }}>gate</span>}
                    {it.checklistOverride && <span style={{ marginLeft: 4, fontSize: 10, color: TONE.progress.fg }}>via Checklist</span>}
                  </td>
                  {(["approach", "processes", "systemsOutcomes", "review"] as const).map((l) => {
                    const unverifiable = !it.checklistOverride && !it.ev.drive;
                    const fg = unverifiable ? TONE.critical.fg : TONE[toneFor(it.ev[l])].fg;
                    return (
                      <td key={l}>
                        <span title={unverifiable ? "No Drive evidence link — shown as failing regardless of the limb rating" : undefined} style={{ width: 9, height: 9, borderRadius: 99, display: "inline-block", background: fg }} />
                      </td>
                    );
                  })}
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
          AI suggested score: <b>{item.ais}</b>{item.ais > 0 && <> (Band {item.aiBand})</>}
        </div>
        {item.checklistOverride && (
          <div style={{ marginTop: 6, fontSize: 12, color: TONE.progress.fg, background: "#eaeef6", borderRadius: 8, padding: "7px 10px" }}>
            This item's scored band (Band {item.band}) comes from the <Link to="/sub-checklist">Sub-Criterion Checklist</Link>, not this matrix rating.
          </div>
        )}
        {!item.checklistOverride && !item.ev.drive && (
          <div style={{ marginTop: 6, fontSize: 12, color: TONE.critical.fg, background: "#fdecec", borderRadius: 8, padding: "7px 10px" }}>
            No Drive evidence link is attached, so this item's official score is capped at Band 1 regardless of the
            limb ratings above — limb selections alone are not evidence. Add a Drive link, or score this item
            properly through the <Link to="/sub-checklist">Sub-Criterion Checklist</Link>.
          </div>
        )}
      </Card>
    </div>
  );
}
