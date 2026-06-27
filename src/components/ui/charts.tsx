import { INK } from "../../lib/theme";

// Dependency-free, print-friendly chart primitives (inline SVG + divs).

export const BAND_COLOR: Record<number, string> = {
  0: "#cbd5e1",
  1: "#c0392b",
  2: "#d98c1f",
  3: "#5b6ea8",
  4: "#2f9e6e",
  5: "#1f7a4d",
};

// Donut gauge for a single value out of a max (e.g. score / 1000).
export function Gauge({ value, max, label, color = "#ce9e5d", size = 132 }: { value: number; max: number; label?: string; color?: string; size?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stroke = 12;
  const r = size / 2 - stroke;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} role="img" aria-label={`${value} of ${max}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e9edf2" strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${circ * pct} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize={22} fontWeight={800} fill={INK}>{value}</text>
      {label && <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10} fill="#94a3b8">{label}</text>}
    </svg>
  );
}

export type BarDatum = { label: string; value: number; color?: string };

// Horizontal labelled bars (per-criterion band, progress counts, etc.).
export function HBars({ data, max, fmt }: { data: BarDatum[]; max?: number; fmt?: (v: number) => string }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(70px,150px) 1fr auto", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>{d.label}</span>
          <div style={{ height: 12, background: "#eef1f5", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${m > 0 ? (d.value / m) * 100 : 0}%`, height: "100%", background: d.color || INK, borderRadius: 999 }} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#374151", minWidth: 28, textAlign: "right" }}>{fmt ? fmt(d.value) : d.value}</span>
        </div>
      ))}
    </div>
  );
}

// Vertical bars (e.g. item count per band).
export function VBars({ data, height = 130 }: { data: BarDatum[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{d.value}</span>
          <div style={{ width: "100%", maxWidth: 42, height: `${(d.value / max) * 100}%`, background: d.color || INK, borderRadius: "5px 5px 0 0", minHeight: d.value > 0 ? 4 : 0 }} />
          <span style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// Single stacked horizontal bar from segments (e.g. checklist Met/Partial/Not met).
export function StackedBar({ segments, height = 16 }: { segments: { label: string; value: number; color: string }[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: 999, overflow: "hidden", background: "#eef1f5" }}>
        {segments.map((s, i) => (
          <div key={i} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
        {segments.map((s, i) => (
          <span key={i} style={{ fontSize: 11, color: "#475569", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: "inline-block" }} /> {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
