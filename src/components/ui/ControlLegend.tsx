import type { CSSProperties } from "react";

// A tiny shared explainer for two (or more) adjacent controls a user could
// confuse — one plain-English line per control saying what it actually does.
// Reused wherever similar-looking buttons/toggles sit side by side; keep each
// `text` to roughly one line. Purely presentational.
export function ControlLegend({ items, style }: {
  items: { label: string; text: string }[];
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 11.5, color: "#64748b", lineHeight: 1.5,
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "7px 10px", display: "grid", gap: 2, ...style,
      }}
    >
      {items.map((it) => (
        <div key={it.label}>
          <b style={{ color: "#334155" }}>{it.label}</b> — {it.text}
        </div>
      ))}
    </div>
  );
}
