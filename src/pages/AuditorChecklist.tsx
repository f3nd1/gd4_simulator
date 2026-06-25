import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { BLUE, TONE, gateTone } from "../lib/theme";
import { DEPTS, CHECKLIST_LIB } from "../data/agents";
import type { ChecklistStatus } from "../types";

const STATUSES: ChecklistStatus[] = ["Not Started", "Pass", "Partial", "Fail", "Not Applicable"];

export function AuditorChecklist() {
  const checklist = useWorkspaceStore((s) => s.checklist);
  const setChecklistField = useWorkspaceStore((s) => s.setChecklistField);
  const runChecklistAI = useWorkspaceStore((s) => s.runChecklistAI);
  const busy = useWorkspaceStore((s) => s.busy);
  const scored = useScored();

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 10 }}>
        Reusable checklist library, split by role. Each department's simulated agent fills a first pass from linked evidence; a human reviewer confirms each item. This checklist is a separate readiness gate and does not change the band score.
      </div>
      {DEPTS.map((d) => {
        const items = CHECKLIST_LIB.filter((c) => c.dept === d.dept);
        const g = scored.deptGates.find((x) => x.dept === d.dept)!;
        return (
          <Card key={d.dept} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>{d.dept}</h3>
              <span style={{ fontSize: 11.5, color: "#6b7280" }}>{d.role}</span>
              <Pill s={gateTone(g.gate)}>gate {g.gate}</Pill>
              <button
                onClick={() => runChecklistAI(d.dept)}
                disabled={busy === "cl-" + d.dept}
                style={{ marginLeft: "auto", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 8, border: `1px solid ${BLUE}`, background: TONE.progress.bg, color: TONE.progress.fg }}
              >
                {busy === "cl-" + d.dept ? "Filling…" : "AI first pass"}
              </button>
            </div>
            {items.map((c) => {
              const cs = checklist[c.id] || {};
              return (
                <div key={c.id} style={{ borderTop: "1px solid #eef1f5", padding: "9px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 240px", fontSize: 12.5 }}>
                      {c.text}
                      {c.link && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#9ca3af" }}> · GD4 {c.link}</span>}
                    </span>
                    {cs.ai && <Pill s={cs.ai === "Pass" ? "good" : cs.ai === "Partial" ? "medium" : "critical"}>AI: {cs.ai}{cs.live ? "" : " (simulated)"}</Pill>}
                    <select value={cs.status || "Not Started"} onChange={(e) => setChecklistField(c.id, "status", e.target.value as ChecklistStatus)} style={{ ...inputStyle, width: 130 }}>
                      {STATUSES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                    {cs.ai && (cs.status || "Not Started") === "Not Started" && (
                      <button onClick={() => setChecklistField(c.id, "status", cs.ai!)} style={{ cursor: "pointer", fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>
                        Accept AI
                      </button>
                    )}
                  </div>
                  {cs.aiReason && <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 3 }}>{cs.aiReason}</div>}
                  <input
                    placeholder="Google Drive evidence link"
                    value={cs.drive || ""}
                    onChange={(e) => setChecklistField(c.id, "drive", e.target.value)}
                    style={{ ...inputStyle, marginTop: 5, fontSize: 12 }}
                  />
                  {cs.drive && (
                    <a href={cs.drive} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>
                      Open evidence
                    </a>
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}
