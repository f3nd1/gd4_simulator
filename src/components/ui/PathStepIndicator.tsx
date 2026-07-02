import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

// Shown on PPD Review and Sub-Criterion Checklist when a sub-criterion is on
// Option A (PPD + Evidence, 2-step). Option B shows nothing — this component
// simply isn't rendered on that path.
export function PathStepIndicator({
  current,
  ppdHref,
  evidenceHref,
  evidenceEnabled,
}: {
  current: 1 | 2;
  ppdHref: string;
  evidenceHref: string;
  evidenceEnabled: boolean;
}) {
  const stepStyle = (active: boolean, reachable: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
    textDecoration: "none",
    background: active ? "#4338ca" : reachable ? "#eef2ff" : "#f1f5f9",
    color: active ? "#fff" : reachable ? "#4338ca" : "#94a3b8",
    cursor: reachable ? "pointer" : "default",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
      <Link to={ppdHref} style={stepStyle(current === 1, true)}>① Step 1 · PPD Review</Link>
      <span style={{ color: "#cbd5e1", fontSize: 13 }}>→</span>
      {evidenceEnabled ? (
        <Link to={evidenceHref} style={stepStyle(current === 2, true)}>② Step 2 · Evidence</Link>
      ) : (
        <span style={stepStyle(false, false)}>② Step 2 · Evidence</span>
      )}
    </div>
  );
}
