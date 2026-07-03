// Renders a finding's auditor-panel review: the synthesised conclusion by
// default, an expandable "View panel discussion" with each panellist's
// analysis, and a "Panel review" button when it has not run (and the mode is
// not Off). Used in the Findings register detail and the Quality Action / AFI
// page — all wiring goes through the workspace store.

import { useState } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { Pill } from "./Pill";
import { PanelChibiDebate } from "./PanelChibiDebate";
import { assemblePanel, isValidPanel, findingReviewHash, MIN_PANEL } from "../../lib/reviewPanel";
import type { Finding } from "../../types";

export function PanelReviewSection({ finding }: { finding: Finding }) {
  const mode = useWorkspaceStore((s) => s.reviewPanelMode);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const panelIds = useWorkspaceStore((s) => s.reviewPanelAuditorIds);
  const busy = useWorkspaceStore((s) => s.busy);
  const runFindingPanelReview = useWorkspaceStore((s) => s.runFindingPanelReview);
  // Read the live finding so a just-completed review re-renders here.
  const live = useWorkspaceStore((s) => s.customFindings.find((f) => f.id === finding.id)) ?? finding;
  const [showDiscussion, setShowDiscussion] = useState(false);
  // Presentation-only toggle: "text" is the default and the complete source of
  // truth; "chibi" animates the same panel data as a staged debate.
  const [view, setView] = useState<"text" | "chibi">("text");

  if (mode === "off") return null;

  const running = busy === "panel:" + live.id;
  const review = live.panelReview;
  const panelValid = isValidPanel(auditors, panelIds);
  const panelSize = assemblePanel(auditors, panelIds).length;
  const stale = review && review.findingHash !== findingReviewHash(live);

  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.4 };
  const field = (title: string, value?: string) =>
    value ? (
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-line" }}>{value}</div>
      </div>
    ) : null;

  return (
    <div style={{ marginTop: 12, border: "1px solid #ddd6fe", borderRadius: 10, background: "#faf5ff", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={label}>Auditor review panel</span>
        {review && !stale && <Pill s="good">Reviewed by {review.reviews.length}</Pill>}
        {review?.discussionTriggered && <Pill s="medium">Discussion held</Pill>}
        {stale && <Pill s="medium">Finding changed since review</Pill>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(!review || stale || review) && (
            <button
              disabled={running || !panelValid}
              onClick={() => runFindingPanelReview(live.id, { force: true })}
              title={panelValid ? `Runs ${panelSize} auditor reviews plus one synthesis` : `Select ${MIN_PANEL}+ panel auditors on Auditor Creation first`}
              style={{ cursor: running || !panelValid ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "1px solid #7c3aed", background: running ? "#ede9fe" : "#7c3aed", color: running ? "#7c3aed" : "#fff" }}
            >
              {running ? "Panel reviewing…" : review ? "Re-run panel" : "Panel review"}
            </button>
          )}
        </span>
      </div>

      {!panelValid && (
        <div style={{ fontSize: 11.5, color: "#92400e" }}>
          No valid panel yet — select {MIN_PANEL} or more auditors on Auditor Creation, then run the panel here.
        </div>
      )}

      {running && !review && (
        <div style={{ fontSize: 12, color: "#6d28d9" }}>The panel is reviewing this finding — one call per auditor, then a synthesis…</div>
      )}

      {review && (
        <>
          {review.runWarnings && review.runWarnings.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 9px", marginBottom: 8 }}>
              {review.runWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {/* View toggle — text stays the default/complete view; the chibi
              debate is a decorative replay of the same data. */}
          {review.reviews.filter((r) => !r.failed && r.analysis).length >= 2 && (
            <div style={{ display: "inline-flex", border: "1px solid #ddd6fe", borderRadius: 7, overflow: "hidden", marginBottom: 8 }}>
              {([["text", "Text view"], ["chibi", "Watch the debate"]] as const).map(([v, lbl]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 11px", border: "none", background: view === v ? "#7c3aed" : "#fff", color: view === v ? "#fff" : "#5b21b6" }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}

          {view === "chibi" ? (
            <PanelChibiDebate review={review} gd4Ref={live.gd4ItemId} />
          ) : (
          <>
          {/* Synthesised conclusion — shown by default */}
          {field("Balanced finding summary", review.synthesis.summary)}
          {field("Risk / impact", review.synthesis.riskImpact)}
          {field("Root cause", review.synthesis.rootCause)}
          {field("Immediate correction", review.synthesis.immediateCorrection)}
          {field("Corrective action", review.synthesis.correctiveAction)}
          {field("Evidence required for closure", review.synthesis.evidenceForClosure)}
          {field("Final classification", review.synthesis.finalClassification)}

          <button
            onClick={() => setShowDiscussion((v) => !v)}
            style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#5b21b6", border: "1px solid #ddd6fe", background: "#fff", borderRadius: 6, padding: "4px 10px", marginTop: 4 }}
          >
            {showDiscussion ? "Hide panel discussion ▲" : `View panel discussion (${review.reviews.length}) ▼`}
          </button>
          {showDiscussion && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {review.discussionTriggered && (
                <div style={{ fontSize: 11.5, color: "#5b21b6", fontStyle: "italic" }}>
                  The panellists disagreed after their independent reviews, so a rebuttal round was held. Each auditor's response to the panel is shown below their first view.
                </div>
              )}
              {review.reviews.map((r, i) => (
                <div key={i} style={{ background: "#fff", border: "1px solid #e9e5f8", borderRadius: 8, padding: "8px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{r.auditorName}</span>
                    <Pill s="neutral">{r.perspectiveLabel}</Pill>
                    {r.position?.classification && <Pill s="neutral">{r.position.classification}{r.position.severity && r.position.severity.toLowerCase() !== "none" ? ` · ${r.position.severity}` : ""}</Pill>}
                    {r.failed && <Pill s="critical">call failed</Pill>}
                  </div>
                  <div style={{ fontSize: 12.5, color: r.failed ? "#b91c1c" : "#374151", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                    {r.failed ? `Review unavailable — ${r.error}` : r.analysis}
                  </div>
                  {r.rebuttal && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e9e5f8" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 }}>After discussion</div>
                      <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-line" }}>{r.rebuttal}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}
