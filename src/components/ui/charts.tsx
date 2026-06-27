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

// EduTrust attainment tiers (by total /1000). Thresholds come from the
// configurable scoring config (passed in); these are just the fallback.
const DEFAULT_THRESHOLDS = { provisional: 500, fourYear: 600, star: 750 };
function tiersFrom(t: { provisional: number; fourYear: number; star: number }) {
  return [
    { key: "Fail", label: "Not certified", min: 0, color: "#c0392b" },
    { key: "Provisional", label: "Provisional (1-Year)", min: t.provisional, color: "#d97706" },
    { key: "4-Year", label: "EduTrust (4-Year)", min: t.fourYear, color: "#5b6ea8" },
    { key: "Star", label: "EduTrust Star", min: t.star, color: "#1f7a4d" },
  ];
}

// Derive the achieved tier index from the scoring engine's award string so it
// can't diverge from the actual score logic.
export function attainmentFromAward(award: string): { index: number; capped: boolean } {
  if (award.startsWith("Capped")) return { index: 2, capped: true }; // gate-capped at/above 4-Year band
  if (award.includes("Star")) return { index: 3, capped: false };
  if (award.includes("4-Year")) return { index: 2, capped: false };
  if (award.includes("Provisional")) return { index: 1, capped: false };
  return { index: 0, capped: false };
}

// Horizontal ladder of the 4 EduTrust tiers with the achieved one highlighted.
export function AttainmentLadder({ total, award, thresholds = DEFAULT_THRESHOLDS }: { total: number; award: string; thresholds?: { provisional: number; fourYear: number; star: number } }) {
  const tiers = tiersFrom(thresholds);
  const { index, capped } = attainmentFromAward(award);
  const achieved = tiers[index];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>EduTrust attainment</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: capped ? "#c0392b" : achieved.color }}>
          {capped ? "Capped — critical gate not met" : achieved.label}
        </span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>· {total}/1000</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {tiers.map((t, i) => {
          const on = !capped && i === index;
          const reached = !capped && i <= index;
          return (
            <div key={t.key} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 10, background: reached ? t.color : "#e9edf2", borderRadius: 999, border: on ? `2px solid ${INK}` : "2px solid transparent" }} />
              <div style={{ fontSize: 10.5, fontWeight: on ? 800 : 500, color: on ? INK : "#94a3b8", marginTop: 3 }}>{t.label}</div>
              <div style={{ fontSize: 9.5, color: "#cbd5e1" }}>{t.min === 0 ? "<500" : `${t.min}+`}</div>
            </div>
          );
        })}
      </div>
      {capped && (
        <div style={{ fontSize: 11.5, color: "#b23121", marginTop: 6 }}>
          Score qualifies for a higher tier, but a critical gate (Sub-criterion 4.2 / 4.6 / Criterion 5 at Band 3+) is not met, so the award is capped until that gate is cleared.
        </div>
      )}
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
