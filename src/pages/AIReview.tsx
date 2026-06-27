import { Fragment, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

function verdictTone(v: string) {
  return v === "Acceptable" ? "good" : v === "Partial" || v === "At risk" ? "medium" : v === "Pass" ? "good" : "critical";
}

export function AIReview() {
  const log = useWorkspaceStore((s) => s.aiReviewLog);
  const [expanded, setExpanded] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = log.length;
    const live = log.filter((e) => e.live).length;
    const failed = log.filter((e) => e.liveError).length;
    const byAgent: Record<string, number> = {};
    log.forEach((e) => {
      byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
    });
    return { total, live, simulated: total - live, failed, byAgent };
  }, [log]);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>AI agent review log</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Every AI agent run is logged here — Evidence Intelligence scoring, Sub-Criterion Checklist line generation, and AFI
        closure reviews. Agents assist, challenge and recommend; they never finalise a result. Runs are tagged
        <i> simulated</i> when produced by the offline rule-based engine and <i>live</i> when produced by a configured AI call.
        Click a row to see the full text the agent generated.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Pill s="neutral">{stats.total} total run{stats.total === 1 ? "" : "s"}</Pill>
        <Pill s="good">{stats.live} live call{stats.live === 1 ? "" : "s"}</Pill>
        <Pill s="medium">{stats.simulated} simulated</Pill>
        {stats.failed > 0 && <Pill s="critical">{stats.failed} live call{stats.failed === 1 ? "" : "s"} failed and fell back to simulation</Pill>}
      </div>
      {stats.total > 0 && (
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 14 }}>
          By agent: {Object.entries(stats.byAgent).map(([a, n]) => `${a} (${n})`).join(" · ")}
        </div>
      )}

      {log.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No AI reviews run yet.</p>}
      <table>
        <thead>
          <tr><th>Agent</th><th>Type</th><th>Subject</th><th>Verdict</th><th>Confidence</th><th>Concerns</th><th>Recommended action</th><th>When</th></tr>
        </thead>
        <tbody>
          {log.map((e) => {
            const open = expanded === e.id;
            return (
              <Fragment key={e.id}>
                <tr className="rowh" onClick={() => setExpanded(open ? null : e.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <b>{e.agent}</b>
                    {!e.live && <div style={{ fontSize: 10, color: e.liveError ? "#b23121" : "#9ca3af" }}>{e.liveError ? "live call failed — simulated" : "simulated"}</div>}
                  </td>
                  <td>{e.reviewType}</td>
                  <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>{e.subjectId}</td>
                  <td title={e.verdict}><Pill s={verdictTone(e.verdict)}>{e.verdict.length > 40 ? e.verdict.slice(0, 40) + "…" : e.verdict}</Pill></td>
                  <td>{e.confidence}</td>
                  <td style={{ fontSize: 12, color: "#6b7280" }} title={e.keyConcerns.join("; ")}>{e.keyConcerns.join("; ").slice(0, 60)}{e.keyConcerns.join("; ").length > 60 ? "…" : ""}</td>
                  <td style={{ fontSize: 12, color: "#6b7280" }} title={e.recommendedAction}>{e.recommendedAction.length > 60 ? e.recommendedAction.slice(0, 60) + "…" : e.recommendedAction}</td>
                  <td style={{ fontSize: 11.5, color: "#9ca3af" }}>{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={8} style={{ background: "#fbfcfe", padding: "10px 14px", fontSize: 12.5 }}>
                      {e.liveError && (
                        <div style={{ color: "#b23121", marginBottom: 8 }}>
                          <b>Live call failed:</b> {e.liveError}
                          <div style={{ color: "#6b7280", fontWeight: 400 }}>Fell back to the offline simulation engine for this run — check your API key/model in Settings.</div>
                        </div>
                      )}
                      <div style={{ color: "#6b7280", marginBottom: 4 }}>Full generated content:</div>
                      <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>
                        {e.generatedContent || e.keyConcerns.join("\n")}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
