import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";

function verdictTone(v: string) {
  return v === "Acceptable" ? "good" : v === "Partial" || v === "At risk" ? "medium" : v === "Pass" ? "good" : "critical";
}

export function AIReview() {
  const log = useWorkspaceStore((s) => s.aiReviewLog);

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>AI agent review log</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Every AI agent run from Evidence Intelligence, Auditor Checklist and AFI Closure is logged here. Agents assist, challenge and recommend; they never
        finalise a result. All verdicts in this build are offline simulations.
      </p>
      {log.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No AI reviews run yet.</p>}
      <table>
        <thead>
          <tr><th>Agent</th><th>Type</th><th>Subject</th><th>Verdict</th><th>Confidence</th><th>Concerns</th><th>Recommended action</th><th>When</th></tr>
        </thead>
        <tbody>
          {log.map((e) => (
            <tr key={e.id} className="rowh">
              <td><b>{e.agent}</b>{!e.live && <div style={{ fontSize: 10, color: "#9ca3af" }}>simulated</div>}</td>
              <td>{e.reviewType}</td>
              <td style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>{e.subjectId}</td>
              <td><Pill s={verdictTone(e.verdict)}>{e.verdict}</Pill></td>
              <td>{e.confidence}</td>
              <td style={{ fontSize: 12, color: "#6b7280" }}>{e.keyConcerns.join("; ")}</td>
              <td style={{ fontSize: 12, color: "#6b7280" }}>{e.recommendedAction}</td>
              <td style={{ fontSize: 11.5, color: "#9ca3af" }}>{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
