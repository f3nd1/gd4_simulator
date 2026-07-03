// Animated "Watch the debate" view of a finding's panel review — a purely
// decorative alternative to the text cards in PanelReviewSection. It renders
// the SAME data runAuditorPanel already produced (reviews, positions,
// rebuttals, synthesis) as chibi figures around a table, stepping through a
// script built by buildDebateScript(). No AI calls, no store writes.

import { useEffect, useMemo, useState } from "react";
import type { PanelReviewResult } from "../../types";
import { buildDebateScript, chibiColorsFor } from "../../lib/reviewPanel";

const STEP_MS = 1600; // readable pace per speaker

// Seat positions around the table for 2-5 auditors, starting at the top and
// going clockwise. Percentages of the stage box.
function seatsFor(n: number): { left: number; top: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
    return { left: 50 + 39 * Math.cos(a), top: 46 + 30 * Math.sin(a) };
  });
}

export function PanelChibiDebate({ review, gd4Ref }: { review: PanelReviewResult; gd4Ref: string }) {
  const usable = useMemo(() => review.reviews.filter((r) => !r.failed && r.analysis), [review]);
  const steps = useMemo(() => buildDebateScript(review), [review]);
  const colors = useMemo(() => chibiColorsFor(usable.map((r) => r.auditorId)), [usable]);
  const seats = seatsFor(usable.length);

  // step -1 = idle (nothing played yet); last step = synthesis.
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= steps.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, step, steps.length]);

  // Reset playback if a re-run replaces the review data mid-view.
  useEffect(() => { setStep(-1); setPlaying(false); }, [review]);

  if (usable.length < 2) {
    return <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>Not enough panellist reviews to stage a debate — see the text view.</div>;
  }

  const cur = step >= 0 ? steps[step] : undefined;
  const speakerIdx = cur && cur.kind !== "synthesis" ? cur.speakerIndex : -1;
  const caption = cur
    ? cur.caption
    : `Press Play to watch the ${usable.length}-auditor panel debate this finding${review.discussionTriggered ? " (they disagreed — a rebuttal round follows)" : ""}.`;

  return (
    <div style={{ marginTop: 8 }}>
      {/* Nod animation + reduced-motion opt-out. Class names are namespaced so
          this style block cannot leak into the rest of the app. */}
      <style>{`
        @keyframes chibiNod { 0%,100%{ transform: rotate(0deg);} 30%{ transform: rotate(-6deg);} 70%{ transform: rotate(5deg);} }
        .chibi-head-nod { animation: chibiNod 0.9s ease-in-out infinite; transform-origin: bottom center; }
        @media (prefers-reduced-motion: reduce) { .chibi-head-nod { animation: none; } }
      `}</style>

      <div style={{ position: "relative", height: 260, borderRadius: 10, border: "1px solid #e9e5f8", background: "linear-gradient(180deg,#fbfaff,#f3f0fb)", overflow: "hidden" }}>
        {/* Table */}
        <div style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%,-50%)", width: "38%", height: "24%", borderRadius: "50%", background: "#ece6f9", border: "1px solid #ddd6fe", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 2px 6px rgba(124,58,237,.08)" }}>
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, fontWeight: 700, color: "#7c3aed", letterSpacing: 0.5 }}>GD4 {gd4Ref}</span>
        </div>

        {/* Synthesis bubble over the table */}
        {cur?.kind === "synthesis" && (
          <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", maxWidth: "62%", background: "#fff", border: "1.5px solid #7c3aed", borderRadius: 10, padding: "7px 10px", fontSize: 12, color: "#1e293b", lineHeight: 1.4, boxShadow: "0 4px 14px rgba(124,58,237,.15)", zIndex: 4 }}>
            <b style={{ color: "#7c3aed", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}>Chair — final classification</b>
            {cur.bubble || "Synthesis available in the text view."}
          </div>
        )}

        {/* Seated chibis */}
        {usable.map((r, i) => {
          const seat = seats[i];
          const speaking = i === speakerIdx;
          const dimmed = speakerIdx >= 0 && !speaking;
          const bubbleBelow = seat.top < 40; // top seats speak downwards so the bubble stays on-stage
          const anchor: React.CSSProperties = seat.left < 28 ? { left: 0 } : seat.left > 72 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
          return (
            <div key={r.auditorId} style={{ position: "absolute", left: `${seat.left}%`, top: `${seat.top}%`, transform: `translate(-50%,-50%) scale(${speaking ? 1.15 : 1})`, opacity: dimmed ? 0.45 : 1, transition: "transform .3s, opacity .3s", width: 86, display: "flex", flexDirection: "column", alignItems: "center", zIndex: speaking ? 3 : 2 }}>
              {/* Speech bubble */}
              {speaking && cur && (
                <div style={{ position: "absolute", ...(bubbleBelow ? { top: "100%", marginTop: 6 } : { bottom: "100%", marginBottom: 6 }), ...anchor, width: 195, background: "#fff", border: `1.5px solid ${colors[i]}`, borderRadius: 10, padding: "6px 9px", fontSize: 11.5, color: "#1e293b", lineHeight: 1.4, boxShadow: "0 4px 12px rgba(0,0,0,.12)", zIndex: 5 }}>
                  {cur.positionPill && (
                    <span style={{ display: "inline-block", fontSize: 9.5, fontWeight: 800, color: "#fff", background: colors[i], borderRadius: 5, padding: "1px 6px", marginBottom: 3 }}>{cur.positionPill}</span>
                  )}
                  <div>{cur.bubble}</div>
                </div>
              )}
              {/* Figure: head + body from plain shapes */}
              <div className={speaking ? "chibi-head-nod" : undefined} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", background: "#f6cfa4", border: "2px solid #3b2a1c", zIndex: 1 }}>
                <span style={{ position: "absolute", top: 11, left: 7, width: 4, height: 5, borderRadius: "50%", background: "#2a1b14" }} />
                <span style={{ position: "absolute", top: 11, right: 7, width: 4, height: 5, borderRadius: "50%", background: "#2a1b14" }} />
                <span style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", width: speaking ? 7 : 8, height: speaking ? 6 : 3, borderRadius: speaking ? "50%" : "0 0 8px 8px", background: speaking ? "#8a4433" : "transparent", borderBottom: speaking ? "none" : "2px solid #2a1b14" }} />
              </div>
              <div style={{ width: 40, height: 22, marginTop: -4, borderRadius: "12px 12px 8px 8px", background: colors[i], border: "2px solid #3b2a1c" }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: "#1e293b", marginTop: 3, whiteSpace: "nowrap" }}>{r.auditorName}</div>
              <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: colors[i], whiteSpace: "nowrap" }}>{r.perspectiveLabel}</div>
            </div>
          );
        })}
      </div>

      {/* Caption + transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => { setStep(0); setPlaying(true); }}
          disabled={playing}
          style={{ cursor: playing ? "default" : "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 12px", borderRadius: 7, border: "1px solid #7c3aed", background: playing ? "#ede9fe" : "#7c3aed", color: playing ? "#7c3aed" : "#fff" }}
        >
          {playing ? "Playing…" : step >= steps.length - 1 && step >= 0 ? "▶ Replay" : "▶ Play debate"}
        </button>
        <button
          onClick={() => { setPlaying(false); setStep(-1); }}
          style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 7, border: "1px solid #ddd6fe", background: "#fff", color: "#5b21b6" }}
        >
          ↺ Reset
        </button>
        <span style={{ fontSize: 11.5, color: "#5b21b6", fontStyle: "italic", flex: 1, minWidth: 200 }}>{caption}</span>
      </div>
    </div>
  );
}
