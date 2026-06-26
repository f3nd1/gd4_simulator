import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { BLUE, TONE } from "../lib/theme";
import { FINDINGS } from "../data/findings";

export function AFIClosure() {
  const closures = useWorkspaceStore((s) => s.closures);
  const setClosureField = useWorkspaceStore((s) => s.setClosureField);
  const runClosureAI = useWorkspaceStore((s) => s.runClosureAI);
  const setClosureHuman = useWorkspaceStore((s) => s.setClosureHuman);
  const busy = useWorkspaceStore((s) => s.busy);
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const scored = useScored();
  const [selFinding, setSelFinding] = useState<string | null>(null);

  const allFindings = [...FINDINGS, ...customFindings];

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10 }}>
        Real findings from the April 2026 assessment. {scored.openAFIs} of {allFindings.length} still open.
      </div>
      {allFindings.map((f) => {
        const c = closures[f.id] || {};
        const open = selFinding === f.id;
        return (
          <Card key={f.id} style={{ marginBottom: 9, padding: 0, overflow: "hidden" }}>
            <button
              className="rowh"
              onClick={() => setSelFinding(open ? null : f.id)}
              style={{ width: "100%", cursor: "pointer", border: "none", background: "transparent", font: "inherit", padding: "11px 14px", display: "flex", gap: 10, alignItems: "center", textAlign: "left" }}
            >
              <b style={{ color: "#ce9e5d", minWidth: 30 }}>{f.id}</b>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#6b7280", minWidth: 38 }}>{f.gd4ItemId}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{f.issue}</span>
              <Pill s={f.severity === "Critical" || f.severity === "High" ? "critical" : f.severity === "Medium" ? "medium" : "neutral"}>{f.severity}</Pill>
              {c.human === "Accepted" ? (
                <Pill s="good">closed</Pill>
              ) : (
                c.ai && <Pill s={c.ai === "Acceptable" ? "good" : c.ai === "Partial" ? "medium" : "critical"}>{c.ai}</Pill>
              )}
            </button>
            {open && (
              <div style={{ padding: "0 14px 14px", background: "#fbfcfe" }}>
                {([
                  ["root", "Root cause (yours)"],
                  ["corr", "Corrective action"],
                  ["prev", "Preventive action"],
                  ["evid", "Closure evidence (Drive link / record)"],
                ] as const).map(([field, label]) => (
                  <label key={field} style={{ display: "block", marginBottom: 7 }}>
                    <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
                    <textarea
                      rows={2}
                      value={c[field] || ""}
                      onChange={(e) => setClosureField(f.id, field, e.target.value)}
                      style={{ ...inputStyle, resize: "vertical", marginTop: 3 }}
                    />
                  </label>
                ))}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => runClosureAI(f.id)}
                    disabled={busy === "clx" + f.id}
                    style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: `1px solid ${BLUE}`, background: TONE.progress.bg, color: TONE.progress.fg }}
                  >
                    {busy === "clx" + f.id ? "Reviewing…" : "AI closure review"}
                  </button>
                  <button
                    onClick={() => setClosureHuman(f.id, c.human === "Accepted" ? "" : "Accepted")}
                    style={{
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "7px 12px",
                      borderRadius: 8,
                      border: `1px solid ${TONE.good.fg}55`,
                      background: c.human === "Accepted" ? TONE.good.bg : "#fff",
                      color: TONE.good.fg,
                    }}
                  >
                    {c.human === "Accepted" ? "Closed ✓" : "Accept closure"}
                  </button>
                </div>
                {c.ai && (
                  <div
                    style={{
                      marginTop: 8,
                      background: c.ai === "Acceptable" ? TONE.good.bg : c.ai === "Partial" ? TONE.medium.bg : TONE.critical.bg,
                      borderRadius: 8,
                      padding: "8px 11px",
                      fontSize: 12.5,
                    }}
                  >
                    <b>Closure Reviewer · {c.ai}{c.live ? "" : " (simulated)"}:</b> {c.aiReason} {c.aiNeed && <i>Still needed: {c.aiNeed}</i>}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
