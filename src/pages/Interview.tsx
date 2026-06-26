import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import type { InterviewQuestion } from "../types";

function generateQuestions(items: { id: string; title: string; ev: { approach: string; processes: string; review: string; systemsOutcomes: string } }[]): InterviewQuestion[] {
  const weak = items.filter((i) => i.ev.review !== "good" || i.ev.systemsOutcomes !== "good" || i.ev.processes !== "good");
  return weak.map((it) => ({
    id: `IQ-${it.id}`,
    gd4ItemId: it.id,
    question: `Walk me through how ${it.title.toLowerCase()} is implemented, reviewed and how the outcome is measured.`,
    expectedAnswer: `Staff should describe the documented process, point to a recent review record, and quote an outcome metric or trend for ${it.id}.`,
  }));
}

export function Interview() {
  const interviewQuestions = useWorkspaceStore((s) => s.interviewQuestions);
  const setInterviewQuestions = useWorkspaceStore((s) => s.setInterviewQuestions);
  const setQuestionReadiness = useWorkspaceStore((s) => s.setQuestionReadiness);
  const scored = useScored();

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Interview simulator</h3>
        <button
          onClick={() => setInterviewQuestions(generateQuestions(scored.items))}
          style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
        >
          Generate likely auditor questions
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Auto-generated from items with weak implementation, review or outcome evidence. Rate staff readiness after a practice run.
      </p>
      {interviewQuestions.length === 0 && <p style={{ fontSize: 12.5, color: "#6b7280" }}>No questions yet. Generate from current evidence above.</p>}
      {interviewQuestions.map((q) => (
        <div key={q.id} style={{ borderTop: "1px solid #eef1f5", padding: "10px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#6b7280", minWidth: 70 }}>{q.gd4ItemId}</span>
            <span style={{ flex: "1 1 320px", fontSize: 12.5 }}>{q.question}</span>
            <select
              value={q.readiness || ""}
              onChange={(e) => setQuestionReadiness(q.id, (e.target.value || undefined) as InterviewQuestion["readiness"], q.notes)}
              style={{ ...inputStyle, width: 110 }}
            >
              <option value="">Not rated</option>
              <option>Strong</option>
              <option>Adequate</option>
              <option>Weak</option>
            </select>
            {q.readiness && <Pill s={q.readiness === "Strong" ? "good" : q.readiness === "Adequate" ? "medium" : "critical"}>{q.readiness}</Pill>}
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 3 }}>Expected: {q.expectedAnswer}</div>
          <input
            placeholder="Notes from practice interview"
            value={q.notes || ""}
            onChange={(e) => setQuestionReadiness(q.id, q.readiness, e.target.value)}
            style={{ ...inputStyle, marginTop: 5, fontSize: 12 }}
          />
        </div>
      ))}
    </Card>
  );
}
