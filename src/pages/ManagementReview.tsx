import { useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK, TONE } from "../lib/theme";
import { FINDINGS } from "../data/findings";

export function ManagementReview() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const closures = useWorkspaceStore((s) => s.closures);
  const managementReviewItems = useWorkspaceStore((s) => s.managementReviewItems);
  const addManagementReviewItem = useWorkspaceStore((s) => s.addManagementReviewItem);
  const setManagementDecision = useWorkspaceStore((s) => s.setManagementDecision);
  const scored = useScored();

  const [section, setSection] = useState("");
  const [content, setContent] = useState("");
  const [decisionNeeded, setDecisionNeeded] = useState(false);
  const [decisionDraft, setDecisionDraft] = useState<Record<string, string>>({});

  const openFindings = FINDINGS.filter((f) => (closures[f.id]?.human || "") !== "Accepted");
  const criticalOrHigh = openFindings.filter((f) => f.severity === "Critical" || f.severity === "High");

  function submitItem() {
    if (!section.trim() || !content.trim()) return;
    addManagementReviewItem({ id: `MR-${Date.now()}`, auditCycleId: cycle.id, section, content, decisionNeeded });
    setSection("");
    setContent("");
    setDecisionNeeded(false);
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Management review pack</h3>
        <p style={{ fontSize: 13 }}>
          {cycle.name} · {cycle.type} · Projected <b>{scored.total}/1000</b> — {scored.award}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Gate item risk</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: scored.gatePass ? TONE.good.fg : TONE.critical.fg }}>
              {scored.gatePass ? "Met" : scored.gateFail.map((g) => g.id).join(", ")}
            </div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Open findings</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{openFindings.length}</div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Critical / High open</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: criticalOrHigh.length ? TONE.critical.fg : TONE.good.fg }}>{criticalOrHigh.length}</div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Items below Band 3</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{scored.items.filter((i) => i.band < 3).length}</div>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Checklist gate</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: scored.checklistPass ? TONE.good.fg : TONE.critical.fg }}>
              {scored.checklistPass ? "Passed" : `${scored.checklistDone} done`}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Add review item</h3>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Section</span>
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Evidence Gaps" style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Content</span>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12.5 }}>
          <input type="checkbox" checked={decisionNeeded} onChange={(e) => setDecisionNeeded(e.target.checked)} />
          Requires management decision
        </label>
        <button onClick={submitItem} style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          Add to pack
        </button>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Review items ({managementReviewItems.length})</h3>
        {managementReviewItems.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No review items added yet.</p>}
        {managementReviewItems.map((m) => (
          <div key={m.id} style={{ borderTop: "1px solid #eef1f5", padding: "9px 0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontSize: 12.5 }}>{m.section}</b>
              {m.decisionNeeded && <Pill s="medium">decision needed</Pill>}
              {m.decision && <Pill s="good">decided</Pill>}
            </div>
            <div style={{ fontSize: 12.5, color: "#6b7280", margin: "3px 0" }}>{m.content}</div>
            {m.decision ? (
              <div style={{ fontSize: 11.5, color: "#6b7280" }}>
                Decision: <b>{m.decision}</b> — {m.decidedBy} ({m.decidedAt})
              </div>
            ) : m.decisionNeeded ? (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  placeholder="Decision…"
                  value={decisionDraft[m.id] || ""}
                  onChange={(e) => setDecisionDraft({ ...decisionDraft, [m.id]: e.target.value })}
                  style={{ ...inputStyle, padding: "4px 6px" }}
                />
                <button
                  onClick={() => decisionDraft[m.id]?.trim() && setManagementDecision(m.id, decisionDraft[m.id], cycle.owner)}
                  style={{ cursor: "pointer", fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                >
                  Record decision
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </Card>
    </div>
  );
}
