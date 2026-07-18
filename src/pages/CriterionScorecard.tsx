import { useState } from "react";
import { CloseoutStepper } from "../components/ui/CloseoutStepper";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScored } from "../hooks/useScored";
import { useAllFindings } from "../hooks/useAllFindings";
import { needsJustification } from "../lib/scoring";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { bandTone, BLUE } from "../lib/theme";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { buildProvenance, provenanceLine } from "../lib/provenance";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";

export function CriterionScorecard() {
  const scored = useScored();
  const findings = useAllFindings();
  const closures = useWorkspaceStore((s) => s.closures);
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const folders = useWorkspaceStore((s) => s.folders);
  const aiReviewLog = useWorkspaceStore((s) => s.aiReviewLog);
  // Folder audit stamp per sub-criterion, so each row can say when (and how)
  // its item was last audited instead of presenting an unqualified band.
  const folderBySubCrit = new Map(folders.map((f) => [f.subCriterionId, f]));
  // "AI-scored, not yet reviewed" marker: driven by the saved band's own
  // source field; clears only when a human re-saves the band.
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const isAiAutoBand = (itemId: string) => checklistEntries[itemId]?.holisticBand?.source === "ai-auto";
  const stampFor = (itemId: string) => {
    // Resolve the item's sub-criterion via the requirement, not a fixed
    // two-segment string slice: split sub-criteria (e.g. 2.1.1) carry a
    // three-segment id equal to the item id, so slicing to two segments
    // ("2.1") would miss their folder.
    const sub = GD4_REQUIREMENTS.find((r) => r.id === itemId)?.subCriterionId ?? itemId.split(".").slice(0, 2).join(".");
    const f = folderBySubCrit.get(sub);
    if (!f?.lastAuditAt) return null;
    const when = new Date(f.lastAuditAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return `${when}${f.lastAuditLive === false ? " · offline estimate" : ""}`;
  };
  const justify = useWorkspaceStore((s) => s.justify);
  const setReviewerScore = useWorkspaceStore((s) => s.setReviewerScore);
  const setJustify = useWorkspaceStore((s) => s.setJustify);
  const confirmScore = useWorkspaceStore((s) => s.confirmScore);
  const clearReviewerOverride = useWorkspaceStore((s) => s.clearReviewerOverride);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const [feedbackTarget, setFeedbackTarget] = useState<{ id: string; aiOutput: string } | null>(null);

  // Re-check candidates (relocated from the retired "Re-audit and Re-score"
  // page): items whose corrective action was accepted so their band should be
  // re-checked rather than left on its old confirmed score, and items still
  // below Band 3. The re-score action is the SAME confirmScore toggle the main
  // table uses (clicking a confirmed item reopens it), so nothing new is wired.
  const closedFindings = findings.filter((f) => closures[f.id]?.human === "Accepted");
  const belowBand3 = scored.items.filter((it) => it.band < 3);

  return (
    <>
    <CloseoutStepper />
    {(closedFindings.length > 0 || belowBand3.length > 0) && (
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Re-check candidates</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
          After corrective action is accepted, the linked GD4 item should be re-checked and rescored rather than left on its old
          confirmed score. Items still below Band 3 are also listed. Use <b>Reopen for re-score</b> to clear the confirmation, then
          re-confirm in the table below.
        </p>
        {closedFindings.length > 0 && (
          <div style={{ marginBottom: belowBand3.length > 0 ? 12 : 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Closed findings — item should be re-scored ({closedFindings.length})</div>
            {closedFindings.map((f) => {
              const item = scored.items.find((it) => it.id === f.gd4ItemId);
              return (
                <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #eef1f5", padding: "8px 0", flexWrap: "wrap" }}>
                  <b style={{ color: "#ce9e5d" }}>{f.id}</b>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, color: "#6b7280" }}>{f.gd4ItemId}</span>
                  <span style={{ fontSize: 12.5, flex: "1 1 240px" }}>{f.issue}</span>
                  {item && <Pill s={bandTone(item.band)}>Band {item.band}</Pill>}
                  {item && item.conf != null ? (
                    <button
                      onClick={() => confirmScore(item.id)}
                      style={{ cursor: "pointer", fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                    >
                      Reopen for re-score
                    </button>
                  ) : item ? (
                    <Pill s="medium">Open for re-score</Pill>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {belowBand3.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>Items still below Band 3 ({belowBand3.length})</div>
            <table>
              <thead><tr><th>Item</th><th>Band</th><th>Effective score</th></tr></thead>
              <tbody>
                {belowBand3.map((it) => (
                  <tr key={it.id} className="rowh">
                    <td><b>{it.id}</b> {it.title}{it.gate && <Pill s="medium">gate</Pill>}</td>
                    <td>{it.started ? <Pill s={bandTone(it.band)}>Band {it.band}</Pill> : <span style={{ color: "#9ca3af" }}>—</span>}{isAiAutoBand(it.id) && <Pill s="medium">AI-scored — not yet reviewed</Pill>}</td>
                    <td>{it.eff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    )}
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Criterion scorecard — three score types</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        AI suggests, you may set a reviewer score, then confirm. Confirming a score that differs from AI by 5 or more, or upgrading a gate item, requires a justification.
      </p>
      {/* Provenance strip — the screenshot-able answer to "what was assessed,
          when, by which model": coverage, audit-date range, offline count. */}
      <div style={{ fontSize: 11.5, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
        <b>Coverage:</b> {provenanceLine(buildProvenance(scored.items, folders, aiReviewLog.map((e) => e.model)))}
      </div>
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
                    {reviewer[it.id] != null && (
                      <button
                        onClick={() => clearReviewerOverride(it.id)}
                        title="Reset reviewer score and justification back to the AI value"
                        style={{ display: "block", marginTop: 4, fontSize: 10.5, color: "#94a3b8", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}
                      >
                        Reset override
                      </button>
                    )}
                  </td>
                  <td>{it.conf != null ? <b>{it.conf}</b> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                  <td>
                    {it.started ? <Pill s={bandTone(it.band)}>Band {it.band}</Pill> : <span style={{ color: "#9ca3af" }}>—</span>}
                    {it.checklistOverride && <Pill s="progress">via Checklist</Pill>}
                    {isAiAutoBand(it.id) && <Pill s="medium">AI-scored — not yet reviewed</Pill>}
                    {stampFor(it.id) && (
                      <div style={{ fontSize: 10, color: stampFor(it.id)!.includes("offline") ? "#b45309" : "#94a3b8", marginTop: 2, whiteSpace: "nowrap" }}>
                        audited {stampFor(it.id)}
                      </div>
                    )}
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
        onClose={() => setFeedbackTarget(null)}
        onSubmit={(fb) => {
          if (!feedbackTarget) return;
          const memId = !fb.correct ? addCalibrationMemory({ module: "Item Scoring", subjectId: feedbackTarget.id, context: feedbackTarget.aiOutput, aiOutput: feedbackTarget.aiOutput, staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: 0 }) : undefined;
          logHumanDecision({ module: "Item Scoring", subjectId: feedbackTarget.id, aiOutput: feedbackTarget.aiOutput, humanDecision: fb.correct ? "Accepted" : (fb.correction || "Rejected"), changed: !fb.correct, decisionType: fb.correct ? "Accepted" : "Overridden", reason: fb.reason, memoryId: memId ?? undefined });
          setFeedbackTarget(null);
        }}
      />
    </Card>
    </>
  );
}
