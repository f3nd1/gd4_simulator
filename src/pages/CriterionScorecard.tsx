import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useScored } from "../hooks/useScored";
import { needsJustification } from "../lib/scoring";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone, BLUE } from "../lib/theme";
import { FeedbackModal } from "../components/ui/FeedbackModal";

export function CriterionScorecard() {
  const scored = useScored();
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const justify = useWorkspaceStore((s) => s.justify);
  const setReviewerScore = useWorkspaceStore((s) => s.setReviewerScore);
  const setJustify = useWorkspaceStore((s) => s.setJustify);
  const confirmScore = useWorkspaceStore((s) => s.confirmScore);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);

  const [feedbackTarget, setFeedbackTarget] = useState<{ id: string; aiOutput: string } | null>(null);

  // Sub-criteria worked through Option A (PPD Review / Evidence tab) whose
  // items carry NO checklist band override: scoring only reads checklist
  // entries, so that Option A work is invisible to the band/award below.
  // Surfacing this here stops the score silently ignoring assessed work.
  const optionAUnscored = useMemo(() => {
    const withResults = new Set<string>();
    for (const [subId, r] of Object.entries(ppdReviewResults)) if (r.rows.length > 0) withResults.add(subId);
    for (const [subId, r] of Object.entries(evidenceAssessments)) if (r.rows.length > 0) withResults.add(subId);
    return [...withResults]
      .filter((subId) => !scored.items.some((i) => i.subCriterionId === subId && i.checklistOverride))
      .sort();
  }, [ppdReviewResults, evidenceAssessments, scored.items]);

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
      {optionAUnscored.length > 0 && (
        <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>
          ⚠ <b>Option A results are not yet reflected in this score.</b> Sub-criteri{optionAUnscored.length === 1 ? "on" : "a"}{" "}
          <b>{optionAUnscored.join(", ")}</b> ha{optionAUnscored.length === 1 ? "s" : "ve"} PPD Review / Evidence-tab results but no staged-audit band feeding
          the scorecard — run the <Link to="/evidence-folder" style={{ color: "#92400e", fontWeight: 700 }}>staged audit</Link> on those folders (or work them
          through the Sub-Criterion Checklist) for that work to count toward the band and award.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Item</th><th>AI</th><th>Reviewer</th><th>Confirmed</th><th>Band</th><th></th></tr>
          </thead>
          <tbody>
            {scored.items.map((it) => {
              const revVal = reviewer[it.id] != null ? reviewer[it.id] : it.ais;
              const needJ = needsJustification(it.ais, revVal, it.gate);
              const justifyVal = justify[it.id] || "";
              return (
                <tr key={it.id}>
                  <td>
                    <b>{it.id}</b> {it.title}
                    {it.gate && <Pill s="medium">gate</Pill>}
                  </td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {it.ais}
                      <button onClick={() => { logHumanDecision({ module: "Item Scoring", subjectId: it.id, aiOutput: `AI band: ${it.ais}`, humanDecision: "Accepted", changed: false, decisionType: "Accepted", reason: "" }); }} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 13, padding: "0 1px", lineHeight: 1 }} title="Accept AI band">👍</button>
                      <button onClick={() => setFeedbackTarget({ id: it.id, aiOutput: `AI band recommendation: ${it.ais}` })} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 13, padding: "0 1px", lineHeight: 1 }} title="Reject AI band">👎</button>
                    </span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={revVal}
                      onChange={(e) => setReviewerScore(it.id, Number(e.target.value))}
                      style={{ ...inputStyle, width: 64, padding: "4px 6px" }}
                    />
                  </td>
                  <td>{it.conf != null ? <b>{it.conf}</b> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                  <td>
                    {it.started ? <Pill s={bandTone(it.band)}>Band {it.band}</Pill> : <span style={{ color: "#9ca3af" }}>—</span>}
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
            {c.started ? <Pill s={bandTone(c.band)}>Band {c.band}</Pill> : <span style={{ fontSize: 11, color: "#9ca3af" }}>Not started</span>}
            <div style={{ fontSize: 13, fontWeight: 700 }}>{c.scored}/{c.points}</div>
          </div>
        ))}
      </div>
      <FeedbackModal
        open={!!feedbackTarget}
        aiOutput={feedbackTarget?.aiOutput ?? ""}
        module="Item Scoring"
        onClose={() => setFeedbackTarget(null)}
        onSubmit={(fb) => {
          if (!feedbackTarget) return;
          const memId = !fb.correct ? addCalibrationMemory({ module: "Item Scoring", subjectId: feedbackTarget.id, context: feedbackTarget.aiOutput, aiOutput: feedbackTarget.aiOutput, staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: 0 }) : undefined;
          logHumanDecision({ module: "Item Scoring", subjectId: feedbackTarget.id, aiOutput: feedbackTarget.aiOutput, humanDecision: fb.correction || "Rejected", changed: true, decisionType: "Rejected" in fb ? "Overridden" : "Accepted", reason: fb.reason, memoryId: memId ?? undefined });
          setFeedbackTarget(null);
        }}
      />
    </Card>
  );
}
