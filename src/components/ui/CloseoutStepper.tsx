import { Link, useLocation } from "react-router-dom";

// This strip sits at the top of each closeout page, shows where you are in the
// chain, and links every other step — so "what do I do after the Scorecard?"
// is answered on the page itself. Management sign-off was removed (it happens
// outside the app), leaving four steps; numbers and the "Next →" link are
// derived from this array, so they renumber automatically.
export const CLOSEOUT_STEPS = [
  { path: "/scorecard", label: "Scorecard" },
  { path: "/final-report", label: "Final Report" },
  { path: "/finalisation", label: "Finalise" },
  { path: "/export", label: "Export" },
] as const;

export function CloseoutStepper() {
  const { pathname } = useLocation();
  const currentIdx = CLOSEOUT_STEPS.findIndex((s) => s.path === pathname);
  const next = currentIdx >= 0 && currentIdx < CLOSEOUT_STEPS.length - 1 ? CLOSEOUT_STEPS[currentIdx + 1] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10, padding: "7px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginRight: 2 }}>Close out</span>
      {CLOSEOUT_STEPS.map((s, i) => {
        const active = i === currentIdx;
        const done = currentIdx >= 0 && i < currentIdx;
        return (
          <span key={s.path} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: "#cbd5e1", fontSize: 12 }}>→</span>}
            <Link
              to={s.path}
              style={{
                fontSize: 12, fontWeight: active ? 700 : 600, textDecoration: "none",
                padding: "3px 9px", borderRadius: 6,
                color: active ? "#fff" : done ? "#15803d" : "#4f46e5",
                background: active ? "#4f46e5" : done ? "#f0fdf4" : "#eef2ff",
                border: `1px solid ${active ? "#4f46e5" : done ? "#bbf7d0" : "#c7d2fe"}`,
              }}
            >
              {i + 1}. {s.label}
            </Link>
          </span>
        );
      })}
      {next && (
        <Link to={next.path} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#4f46e5", textDecoration: "none", whiteSpace: "nowrap" }}>
          Next: {next.label} →
        </Link>
      )}
    </div>
  );
}
