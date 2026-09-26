import { useState } from "react";
import { buildRunTimeline, formatMs } from "../../lib/runTimeline";
import type { EvidenceRunLogLine } from "../../types";

// Where a finished run's time actually went.
//
// The run's own activity log used to vanish when the run ended (the progress
// object it lives on is set to null by finish()), leaving durationMs for the
// whole pass and nothing else. This renders the log that is now kept, with
// the gap before each entry, so a slow run can be read rather than guessed at.
//
// Collapsed by default: it is a diagnostic, not part of the result.
export function RunTimelinePanel({ runLog, durationMs }: { runLog?: EvidenceRunLogLine[]; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const timeline = buildRunTimeline(runLog);
  if (timeline.steps.length === 0) {
    // A run from before the log was kept, or one that logged nothing. Say
    // which, rather than rendering an empty panel that reads as "instant".
    if (durationMs == null) return null;
    return (
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 8 }}>
        Took {formatMs(durationMs)} in total. No step-by-step timing was kept for this run.
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
      >
        {open ? "Hide where the time went ▲" : "Where did the time go? ▼"}
        {durationMs != null && <span style={{ fontWeight: 400, color: "#64748b" }}> · {formatMs(durationMs)} in total</span>}
      </button>
      {open && (
        <div style={{ marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc", padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
            Each line shows how long the step before it took. Work done before the first line
            (listing the folder) is not covered by these figures; the total above is.
          </div>
          {timeline.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 11.5, padding: "2px 0", color: s.tone === "bad" ? "#b91c1c" : s.tone === "warn" ? "#92600a" : "#334155" }}>
              <span style={{ width: 62, flexShrink: 0, textAlign: "right", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                +{formatMs(s.offsetMs)}
              </span>
              <span style={{ width: 62, flexShrink: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: s.slowest ? 800 : 400, color: s.slowest ? "#b45309" : "#64748b" }}>
                {i === 0 ? "" : formatMs(s.deltaMs)}
              </span>
              <span style={{ flex: 1 }}>
                {s.text}
                {s.slowest && <b style={{ color: "#b45309" }}> ← slowest step</b>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
