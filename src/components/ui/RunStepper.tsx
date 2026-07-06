// Shared run-progress stepper — the same Connect → Read files → Ask AI → Save →
// Complete flow the staged-audit progress modal shows, so the Option A PPD
// Review / Evidence tabs present a consistent, equally-informative view. Purely
// presentational: the caller maps its own progress to a step index.

export const RUN_STEPS = [
  { emoji: "🔌", label: "Connect" },
  { emoji: "📂", label: "Read files" },
  { emoji: "🤖", label: "Ask AI" },
  { emoji: "💾", label: "Save" },
  { emoji: "✅", label: "Complete" },
] as const;

export function RunStepper({ current, running, detail }: { current: number; running?: boolean; detail?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {RUN_STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const fg = done ? "#15803d" : active ? "#4338ca" : "#94a3b8";
          const bg = done ? "#dcfce7" : active ? "#eef2ff" : "#f1f5f9";
          const border = done ? "#86efac" : active ? "#c7d2fe" : "transparent";
          return (
            <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: bg, border: `1px solid ${border}`, color: fg, fontSize: 11, fontWeight: active ? 700 : 600, whiteSpace: "nowrap" }}>
                <span aria-hidden>{done ? "✓" : s.emoji}</span>
                <span>{s.label}</span>
                {active && running && <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>…</span>}
              </span>
              {i < RUN_STEPS.length - 1 && <span aria-hidden style={{ color: "#cbd5e1", fontSize: 11 }}>→</span>}
            </span>
          );
        })}
      </div>
      {detail && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 5 }}>{detail}</div>}
    </div>
  );
}

// Map an Option A PPD review's free-text progress detail to a step index. The
// PPD run has no structured stage, so infer from the detail string; when a run
// isn't in flight the step reflects whether a result already exists.
export function ppdRunStep(detail: string | undefined, running: boolean, hasResult: boolean): number {
  if (!running) return hasResult ? 4 : 0;
  const d = (detail || "").toLowerCase();
  if (/read|extract|listing|folder|file/.test(d)) return 1;
  if (/sav|writ|commit|final|summar|compil/.test(d)) return 3;
  return 2; // the dominant PPD phase is the AI pass
}

// Map an Option A evidence assessment's structured stage to a step index.
export function evidenceRunStep(stage: string | undefined, running: boolean, hasResult: boolean): number {
  if (!running) return hasResult ? 4 : 0;
  switch (stage) {
    case "reading": return 1;
    case "assessing":
    case "verifying":
    case "synthesising": return 2;
    case "done": return 4;
    default: return 2;
  }
}
