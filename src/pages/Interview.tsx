import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import type { InterviewQuestion, ItemEvidence } from "../types";

// Adaptive question bank, keyed by APSR dimension. Each question probes the
// specific rubric dimension that fell short rather than asking a generic
// "walk me through" question that can be deflected with a high-level summary.
const DIM_Q: Record<
  string,
  (id: string, title: string) => { question: string; expectedAnswer: string }
> = {
  approach: (id, title) => ({
    question: `[Approach] Show me the documented policy or procedure for "${title}" (${id}). Who approved it and when was it last reviewed?`,
    expectedAnswer: `Staff should produce the signed policy/procedure, confirm the approving authority and date, and reference the last scheduled review for ${id}.`,
  }),
  processes: (id, title) => ({
    question: `[Processes] Walk me through how "${title}" (${id}) is actually carried out day-to-day. What records prove it is happening?`,
    expectedAnswer: `Staff should describe the operational steps, name the records generated (logs, registers, screenshots), and show a recent sample for ${id}.`,
  }),
  systemsOutcomes: (id, title) => ({
    question: `[Outcomes] What measurable outcome does your "${title}" (${id}) process produce? How is this tracked?`,
    expectedAnswer: `Staff should quote a metric or trend (e.g. pass rate, complaint count, retention rate) linked to ${id} and explain the tracking system.`,
  }),
  review: (id, title) => ({
    question: `[Review] When was "${title}" (${id}) last formally reviewed? Who attended and what improvement action followed?`,
    expectedAnswer: `Staff should cite a dated review meeting or report, name the attendees, and describe at least one specific action or change that resulted from the review of ${id}.`,
  }),
};

function worstDimension(ev: ItemEvidence): string {
  // Order: check for Missing first (most urgent), then Partial
  const dims = [
    { k: "approach" as keyof ItemEvidence, key: "approach" },
    { k: "processes" as keyof ItemEvidence, key: "processes" },
    { k: "systemsOutcomes" as keyof ItemEvidence, key: "systemsOutcomes" },
    { k: "review" as keyof ItemEvidence, key: "review" },
  ];
  for (const d of dims) if (ev[d.k] === "Missing") return d.key;
  for (const d of dims) if (ev[d.k] === "Partial") return d.key;
  return "processes"; // default: implementation evidence
}

function generateQuestions(items: { id: string; title: string; ev: ItemEvidence }[]): InterviewQuestion[] {
  const weak = items.filter((i) => i.ev.review !== "good" || i.ev.systemsOutcomes !== "good" || i.ev.processes !== "good" || i.ev.approach !== "good");
  return weak.map((it) => {
    const dim = worstDimension(it.ev);
    const { question, expectedAnswer } = DIM_Q[dim](it.id, it.title);
    return { id: `IQ-${it.id}`, gd4ItemId: it.id, question, expectedAnswer };
  });
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
          onClick={() => {
            // Regenerating replaces the whole array — including any readiness
            // ratings/notes already recorded against the current questions.
            if (interviewQuestions.length > 0 && !confirm("This will replace your recorded interview outcomes. Continue?")) return;
            setInterviewQuestions(generateQuestions(scored.items));
          }}
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
