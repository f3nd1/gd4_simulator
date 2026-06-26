import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone, BLUE } from "../lib/theme";

export function CriterionScorecard() {
  const scored = useScored();
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const justify = useWorkspaceStore((s) => s.justify);
  const setReviewerScore = useWorkspaceStore((s) => s.setReviewerScore);
  const setJustify = useWorkspaceStore((s) => s.setJustify);
  const confirmScore = useWorkspaceStore((s) => s.confirmScore);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Criterion scorecard — three score types</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        AI suggests, you may set a reviewer score, then confirm. Confirming a score that differs from AI by 5 or more, or upgrading a gate item, requires a justification.
      </p>
      <div style={{ fontSize: 12, color: BLUE, background: "#eaeef6", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>
        Items marked <Pill s="progress">via Checklist</Pill> take their band from the <Link to="/sub-checklist">Sub-Criterion Checklist</Link>,
        which is the source of truth for scoring. For those items the AI/reviewer/confirmed columns are kept for the record but do not change the band.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Item</th><th>AI</th><th>Reviewer</th><th>Confirmed</th><th>Band</th><th></th></tr>
          </thead>
          <tbody>
            {scored.items.map((it) => {
              const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
              const diff = Math.abs(revVal - it.ais);
              const needJ = diff >= 5 || (it.gate && revVal > it.ais);
              const justifyVal = justify[it.id] || "";
              return (
                <tr key={it.id}>
                  <td>
                    <b>{it.id}</b> {it.title}
                    {it.gate && <Pill s="medium">gate</Pill>}
                  </td>
                  <td>{it.ais}</td>
                  <td>
                    <input
                      type="number"
                      value={revVal}
                      onChange={(e) => setReviewerScore(it.id, Number(e.target.value))}
                      style={{ ...inputStyle, width: 64, padding: "4px 6px" }}
                    />
                  </td>
                  <td>{it.conf != null ? <b>{it.conf}</b> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                  <td>
                    <Pill s={bandTone(it.band)}>Band {it.band}</Pill>
                    {it.checklistOverride && <Pill s="progress">via Checklist</Pill>}
                  </td>
                  <td>
                    {needJ && it.conf == null && (
                      <input
                        placeholder="Justify…"
                        value={justifyVal}
                        onChange={(e) => setJustify(it.id, e.target.value)}
                        style={{ ...inputStyle, width: 130, padding: "4px 6px", marginBottom: 4 }}
                      />
                    )}
                    <button
                      onClick={() => {
                        if (needJ && it.conf == null && !justifyVal.trim()) return;
                        confirmScore(it.id);
                      }}
                      style={{
                        cursor: "pointer",
                        fontSize: 11.5,
                        padding: "5px 9px",
                        borderRadius: 6,
                        border: "1px solid #cbd5e1",
                        background: it.conf != null ? "#e3f3ea" : "#fff",
                        color: it.conf != null ? "#1f7a4d" : "#1f2733",
                      }}
                    >
                      {it.conf != null ? "Confirmed" : needJ && !justifyVal.trim() ? "Justify to confirm" : "Confirm"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
        {scored.crits.map((c) => (
          <div key={c.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>C{c.id} · {c.points} pts</div>
            <Pill s={bandTone(c.band)}>Band {c.band}</Pill>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{c.scored}/{c.points}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
