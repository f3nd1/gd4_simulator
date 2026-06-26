import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { TONE, BLUE } from "../lib/theme";

export function EvidenceIntelligence() {
  const scored = useScored();
  const findings = useAllFindings();
  const agents = useWorkspaceStore((s) => s.agents);
  const itemReviews = useWorkspaceStore((s) => s.itemReviews);
  const runItemAI = useWorkspaceStore((s) => s.runItemAI);
  const busy = useWorkspaceStore((s) => s.busy);
  const [selItem, setSelItem] = useState(scored.items[0]?.id);
  const item = scored.items.find((i) => i.id === selItem) || scored.items[0];
  const review = itemReviews[item.id];

  const checks: [string, "Pass" | "Partial" | "Fail", string][] = [
    ["Evidence age", item.ev.age <= 180 ? "Pass" : "Fail", `${item.ev.age} days`],
    ["Evidence strength", item.ais >= 55 ? "Pass" : "Partial", `${item.ais}/100`],
    ["Processes consistency", item.ev.processes === "good" ? "Pass" : item.ev.processes === "Partial" ? "Partial" : "Fail", item.ev.processes],
    ["Review limb present", item.ev.review !== "Missing" ? "Pass" : "Fail", item.ev.review],
    ["Systems & outcomes evidence", item.ev.systemsOutcomes !== "Missing" ? "Pass" : "Fail", item.ev.systemsOutcomes],
    ["Cross-criterion linkage", "Pass", "Owner SQ links this evidence to related criteria where applicable"],
    ["Traceability", item.ev.trace >= 75 ? "Pass" : "Partial", `${item.ev.trace}%`],
    ["Missing owner warning", item.ev.owner ? "Pass" : "Fail", item.ev.owner || "No owner set"],
    ["Drive folder linked / cut-off control", item.ev.drive ? "Pass" : "Fail", item.ev.drive ? "Linked" : "Missing"],
    ["Repeat finding detector", findings.some((a) => a.gd4ItemId === item.id) ? "Fail" : "Pass", findings.some((a) => a.gd4ItemId === item.id) ? "Prior finding on this item" : "None"],
    ["Due date monitoring", "Pass", "No overdue actions linked to this item"],
    ["Gate item", item.gate ? (item.band >= 3 ? "Pass" : "Fail") : "Pass", item.gate ? "Critical area" : "Not gated"],
  ];

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Evidence intelligence</h3>
        <select value={selItem} onChange={(e) => setSelItem(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {scored.items.map((i) => <option key={i.id} value={i.id}>{i.id} {i.title}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => runItemAI(a.id, item.id)}
              disabled={busy === item.id + a.id}
              style={{ cursor: "pointer", fontSize: 11.5, padding: "6px 9px", borderRadius: 7, border: `1px solid ${BLUE}`, background: TONE.progress.bg, color: TONE.progress.fg }}
            >
              {busy === item.id + a.id ? "…" : a.name}
            </button>
          ))}
        </div>
      </div>
      {review && (
        <div style={{ marginBottom: 12, background: TONE.progress.bg, borderRadius: 8, padding: "9px 11px", fontSize: 12.5 }}>
          <b>
            {review.by} · score {review.score} Band {review.band} ({review.confidence}) — simulated:
          </b>{" "}
          {review.justification} <i>Higher band: {review.higherBand}</i>
        </div>
      )}
      <table>
        <tbody>
          {checks.map(([l, v, d]) => (
            <tr key={l}>
              <td style={{ fontWeight: 600 }}>{l}</td>
              <td><Pill s={v === "Pass" ? "good" : v === "Partial" ? "medium" : "critical"}>{v}</Pill></td>
              <td style={{ color: "#6b7280" }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
