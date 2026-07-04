// Read-only SVG/flex charts for the AI Calibration page — same lightweight,
// dependency-free style as charts.tsx (the app has no recharts/chart.js).
// Every chart: theme verdict colours (green/amber/red), a title, a one-line
// "what to read" caption, and a clean empty state. Charts SUMMARISE data
// already computed; they never change test logic or scoring.

import type { ConsistencyTestResult, ABTestResult } from "../../lib/calibrationTesting";
import type { CalibrationRunRecord } from "../../store/useCalibrationStore";

// Verdict colours, consistent with STATUS_COLOR on the tabs and the rest of
// the app (good/medium/critical tones).
const C = { caught: "#15803d", partial: "#b45309", missed: "#b91c1c", unassessed: "#94a3b8" };
const VERDICT_COLOR: Record<string, string> = { Met: "#15803d", Partial: "#b45309", "Not met": "#b91c1c", "Not assessed": "#cbd5e1" };

function ChartFrame({ title, caption, empty, children }: { title: string; caption: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10, lineHeight: 1.4 }}>{caption}</div>
      {empty
        ? <div style={{ fontSize: 12, color: "#94a3b8", padding: "18px 0", textAlign: "center", background: "#f8fafc", borderRadius: 8 }}>Run a test to see this chart.</div>
        : children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#475569" }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}

// One horizontal caught/partial/missed stacked bar per group (year or pattern).
function StackedRow({ label, caught, partial, missed }: { label: string; caught: number; partial: number; missed: number }) {
  const total = caught + partial + missed || 1;
  const seg = (v: number, color: string) => v > 0 ? <div style={{ width: `${(v / total) * 100}%`, background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 700 }}>{v}</div> : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,190px) 1fr", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 11.5, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</span>
      <div style={{ display: "flex", height: 18, borderRadius: 5, overflow: "hidden", background: "#eef1f5" }}>
        {seg(caught, C.caught)}{seg(partial, C.partial)}{seg(missed, C.missed)}
      </div>
    </div>
  );
}

type Totals = { caught: number; partial: number; missed: number; unassessed: number };

// Chart 1 — Benchmark: caught/partial/missed by year and by pattern.
export function BenchmarkBreakdownChart({ byYear, byPattern }: { byYear: Record<string, Totals>; byPattern: Record<string, Totals> }) {
  const years = Object.entries(byYear);
  const patterns = Object.entries(byPattern).filter(([, c]) => c.caught + c.partial + c.missed > 0);
  const empty = years.length === 0 && patterns.length === 0;
  return (
    <ChartFrame title="Caught / Partial / Missed breakdown" caption="Which report years and which finding patterns you catch well (green) vs miss (red). Longer red = a weak pattern to strengthen." empty={empty}>
      <Legend items={[{ label: "Caught", color: C.caught }, { label: "Partial", color: C.partial }, { label: "Missed", color: C.missed }]} />
      {years.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", margin: "2px 0 5px" }}>By report year</div>}
      <div style={{ display: "grid", gap: 5 }}>{years.map(([y, c]) => <StackedRow key={y} label={`Report ${y}`} caught={c.caught} partial={c.partial} missed={c.missed} />)}</div>
      {patterns.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", margin: "10px 0 5px" }}>By finding pattern</div>}
      <div style={{ display: "grid", gap: 5 }}>{patterns.map(([p, c]) => <StackedRow key={p} label={p} caught={c.caught} partial={c.partial} missed={c.missed} />)}</div>
    </ChartFrame>
  );
}

// Chart 2 — Benchmark: caught count across dated match-analysis runs (the
// proof-of-improvement line). Oldest → newest left to right.
export function ImprovementChart({ history }: { history: CalibrationRunRecord[] }) {
  const runs = [...history].reverse(); // store is newest-first
  const empty = runs.length === 0;
  const W = 460, H = 150, padL = 30, padB = 22, padT = 10, padR = 10;
  const maxY = Math.max(1, ...runs.map((r) => r.caught + r.partial + r.missed + r.unassessed), ...runs.map((r) => r.caught));
  const x = (i: number) => runs.length <= 1 ? padL : padL + (i / (runs.length - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxY) * (H - padB - padT);
  const pts = runs.map((r, i) => ({ cx: x(i), cy: y(r.caught), r }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const first = runs[0]?.caught ?? 0, last = runs[runs.length - 1]?.caught ?? 0;
  return (
    <ChartFrame title="Improvement over time" caption={`Benchmark findings CAUGHT per dated match-analysis run. As you tune temperature, prompts and skills and re-run, this line should climb.${runs.length > 1 ? ` So far: ${first} → ${last}.` : ""}`} empty={empty}>
      <div style={{ overflowX: "auto" }}>
        <svg width={W} height={H} style={{ maxWidth: "100%" }} role="img" aria-label="Caught findings over time">
          {[0, 0.5, 1].map((f) => { const gy = y(maxY * f); return <g key={f}><line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#eef1f5" /><text x={4} y={gy + 3} fontSize={9} fill="#94a3b8">{Math.round(maxY * f)}</text></g>; })}
          {runs.length > 1 && <path d={path} fill="none" stroke={C.caught} strokeWidth={2} />}
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.cx} cy={p.cy} r={3.5} fill={C.caught} />
              <text x={p.cx} y={H - 8} fontSize={8.5} fill="#94a3b8" textAnchor="middle">{new Date(p.r.runAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</text>
            </g>
          ))}
          {runs.length === 1 && <text x={W / 2} y={H / 2} fontSize={11} fill="#94a3b8" textAnchor="middle">One run so far — re-run after tuning to see the trend.</text>}
        </svg>
      </div>
    </ChartFrame>
  );
}

// Chart 3 — Consistency: per-line verdict grid (rows = lines, cols = runs),
// coloured by verdict + a per-line agreement bar. Flip-flopping lines pop out.
export function ConsistencyHeatChart({ result }: { result: ConsistencyTestResult }) {
  const lineAgreement = (verdicts: (string | null)[]) => {
    const vs = verdicts.filter((v): v is string => v != null);
    if (vs.length < 2) return null;
    const top = Math.max(...Object.values(vs.reduce<Record<string, number>>((m, v) => { m[v] = (m[v] ?? 0) + 1; return m; }, {})));
    return Math.round((top / vs.length) * 100);
  };
  return (
    <ChartFrame title="Per-line verdict agreement" caption="Each row is a requirement line; each cell a run, coloured by verdict. A single-colour row is stable; a mixed row is flip-flopping. The bar shows each line's agreement %.">
      <Legend items={[{ label: "Met", color: VERDICT_COLOR.Met }, { label: "Partial", color: VERDICT_COLOR.Partial }, { label: "Not met", color: VERDICT_COLOR["Not met"] }, { label: "no result", color: VERDICT_COLOR["Not assessed"] }]} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {result.lines.map((l) => {
          const agr = lineAgreement(l.verdicts);
          return (
            <div key={l.ref} style={{ display: "grid", gridTemplateColumns: "minmax(120px,200px) auto 70px", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${l.ref} ${l.text}`}><span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#94a3b8" }}>{l.ref}</span> {l.text}</span>
              <div style={{ display: "flex", gap: 2 }}>
                {l.verdicts.map((v, i) => <div key={i} title={`Run ${i + 1}: ${v ?? "no result"}`} style={{ width: 20, height: 16, borderRadius: 3, background: v ? VERDICT_COLOR[v] ?? "#cbd5e1" : VERDICT_COLOR["Not assessed"] }} />)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ flex: 1, height: 6, background: "#eef1f5", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${agr ?? 0}%`, height: "100%", background: agr != null && agr < 100 ? C.partial : C.caught, borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: 10, color: "#64748b", minWidth: 26, textAlign: "right" }}>{agr != null ? `${agr}%` : "–"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

function GroupedBars({ groups, aColor = "#5b6ea8", bColor = "#ce9e5d" }: { groups: { label: string; a: number; b: number }[]; aColor?: string; bColor?: string }) {
  const max = Math.max(1, ...groups.flatMap((g) => [g.a, g.b]));
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-end", height: 120, padding: "0 4px" }}>
      {groups.map((g) => (
        <div key={g.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: "100%", width: "100%", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#374151" }}>{g.a}</span>
              <div style={{ width: 22, height: `${(g.a / max) * 100}%`, background: aColor, borderRadius: "4px 4px 0 0", minHeight: g.a > 0 ? 3 : 0 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#374151" }}>{g.b}</span>
              <div style={{ width: 22, height: `${(g.b / max) * 100}%`, background: bColor, borderRadius: "4px 4px 0 0", minHeight: g.b > 0 ? 3 : 0 }} />
            </div>
          </div>
          <span style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>{g.label}</span>
        </div>
      ))}
    </div>
  );
}

const A_COLOR = "#5b6ea8", B_COLOR = "#ce9e5d";

// Chart 4 — A vs B: accuracy (caught/missed vs truth) and raw output, A beside B.
export function ABHeadToHeadChart({ result }: { result: ABTestResult }) {
  const hasTruth = result.benchmarkCount > 0 && result.a.judged && result.b.judged;
  return (
    <ChartFrame title="A vs B — head to head" caption={hasTruth ? "Left: how many REAL findings each path caught vs missed (accuracy — the primary measure). Right: raw findings raised by type." : "No benchmark truth for this sub-criterion — raw output only (cannot decide accuracy)."}>
      <Legend items={[{ label: "Option A", color: A_COLOR }, { label: "Option B", color: B_COLOR }]} />
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: hasTruth ? "1fr 1fr" : "1fr" }}>
        {hasTruth && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Accuracy vs truth</div>
            <GroupedBars groups={[{ label: "Caught", a: result.a.caught, b: result.b.caught }, { label: "Missed", a: result.a.missed, b: result.b.missed }]} aColor={A_COLOR} bColor={B_COLOR} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>Raw findings raised</div>
          <GroupedBars groups={[{ label: "NC", a: result.a.byType.NC, b: result.b.byType.NC }, { label: "OFI", a: result.a.byType.OFI, b: result.b.byType.OFI }, { label: "Met", a: result.a.byType.OBS, b: result.b.byType.OBS }]} aColor={A_COLOR} bColor={B_COLOR} />
        </div>
      </div>
    </ChartFrame>
  );
}

// Chart 5 — A vs B overall: which path won, per sub-criterion.
export function ABWinPatternChart({ tests }: { tests: ABTestResult[] }) {
  const decided = tests.filter((t) => t.winner === "A" || t.winner === "B");
  return (
    <ChartFrame title="Win pattern across sub-criteria" caption="Which path won on accuracy per tested sub-criterion. A cluster of one colour on similar sub-criteria tells you where to default that path." empty={decided.length === 0}>
      <Legend items={[{ label: "Option A won", color: A_COLOR }, { label: "Option B won", color: B_COLOR }]} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {decided.map((t) => (
          <div key={t.subCriterionId} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#334155" }}>{t.subCriterionId}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 5, background: t.winner === "A" ? A_COLOR : B_COLOR, color: "#fff", fontSize: 11, fontWeight: 700 }}>Option {t.winner}</span>
              <span style={{ fontSize: 10.5, color: "#94a3b8" }}>{t.patterns.join(", ") || "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}
