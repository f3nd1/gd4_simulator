import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { needsJustification } from "../lib/scoring";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { TONE } from "../lib/theme";

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
  const clearReviewerOverride = useWorkspaceStore((s) => s.clearReviewerOverride);
  const scored = useScored();

  const overrides = scored.items.filter((it) => {
    const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
    return needsJustification(it.ais, revVal, it.gate);
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
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Items requiring override justification ({overrides.length})</h3>
          <Link to="/scorecard" style={{ fontSize: 12, marginLeft: "auto" }}>
            Edit scores &amp; justifications on the Criterion Scorecard →
          </Link>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          This is a read-only oversight view. Reviewer scores and their justifications are entered once, on the Criterion
          Scorecard; they surface here so a reviewer can see every override in one place.
        </p>
        {overrides.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No reviewer overrides currently exceed the justification threshold.</p>}
        {overrides.map((it) => {
          const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
          const j = justify[it.id]?.trim();
          return (
            <div key={it.id} style={{ borderTop: "1px solid #eef1f5", padding: "9px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b>{it.id}</b>
                <span style={{ fontSize: 12.5 }}>{it.title}</span>
                {it.gate && <Pill s="medium">gate</Pill>}
                <span style={{ fontSize: 12, color: "#6b7280", marginLeft: "auto" }}>
                  AI {it.ais} → Reviewer {revVal} {it.conf != null && <>· Confirmed {it.conf}</>}
                </span>
                <button
                  onClick={() => clearReviewerOverride(it.id)}
                  title="Reset reviewer score and justification back to the AI value"
                  style={{ fontSize: 11, color: "#94a3b8", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}
                >
                  Reset override
                </button>
              </div>
              <div style={{ marginTop: 5, fontSize: 12.5 }}>
                {j ? (
                  <span style={{ color: "#475569" }}>
                    <b style={{ color: "#1f7a4d" }}>Justification:</b> {j}
                  </span>
                ) : (
                  <span style={{ color: TONE.critical.fg }}>
                    No justification recorded yet — add one on the Criterion Scorecard.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
