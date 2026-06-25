import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

const RULES: [string, string][] = [
  ["Reviewer score differs from AI score by 5 or more", "Require justification"],
  ["Reviewer upgrades a Critical or gate-sensitive item", "Require evidence link"],
  ["Reviewer marks a finding as closed", "Require closure evidence and verification"],
  ["Reviewer changes band upward", "Require explanation"],
  ["Reviewer finalises despite unresolved risk", "Require management approval"],
];

export function HumanReview() {
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const justify = useWorkspaceStore((s) => s.justify);
  const setJustify = useWorkspaceStore((s) => s.setJustify);
  const scored = useScored();

  const overrides = scored.items.filter((it) => {
    const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
    const diff = Math.abs(revVal - it.ais);
    return diff >= 5 || (it.gate && revVal > it.ais);
  });

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Override rules</h3>
        <table>
          <thead><tr><th>Condition</th><th>Required system behaviour</th></tr></thead>
          <tbody>
            {RULES.map(([cond, req]) => (
              <tr key={cond}>
                <td style={{ fontSize: 12.5 }}>{cond}</td>
                <td style={{ fontSize: 12.5, color: "#6b7280" }}>{req}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Items requiring override justification ({overrides.length})</h3>
        {overrides.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No reviewer overrides currently exceed the justification threshold.</p>}
        {overrides.map((it) => {
          const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
          return (
            <div key={it.id} style={{ borderTop: "1px solid #eef1f5", padding: "9px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b>{it.id}</b>
                <span style={{ fontSize: 12.5 }}>{it.title}</span>
                {it.gate && <Pill s="medium">gate</Pill>}
                <span style={{ fontSize: 12, color: "#6b7280", marginLeft: "auto" }}>
                  AI {it.ais} → Reviewer {revVal} {it.conf != null && <>· Confirmed {it.conf}</>}
                </span>
              </div>
              <input
                placeholder="Justify this override…"
                value={justify[it.id] || ""}
                onChange={(e) => setJustify(it.id, e.target.value)}
                style={{ ...inputStyle, marginTop: 5 }}
              />
            </div>
          );
        })}
      </Card>
    </div>
  );
}
