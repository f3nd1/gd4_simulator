// AI Calibration — measures the app's AI assessments against UCC's real SSG
// EduTrust assessment reports (src/data/benchmarkAFIs.ts). A MEASUREMENT
// tool only: it never tunes prompts or changes audit results.

import { useMemo, useState } from "react";
import { useWorkspaceStore, composeSchoolContext } from "../store/useWorkspaceStore";
import { useCalibrationStore, type MatchStatus } from "../store/useCalibrationStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { BENCHMARK_AFIS, benchmarkSubCriteria, type BenchmarkAFI, type BenchmarkFindingPattern } from "../data/benchmarkAFIs";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { chatComplete, effectiveSettings } from "../lib/ai/aiClient";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { ConsistencyTab, AvsBTab, RecommendationsPanel } from "./CalibrationLab";
import { recommendFromBenchmark } from "../lib/tuningAdvisor";
import { BenchmarkBreakdownChart, ImprovementChart } from "../components/ui/calibrationCharts";
import { RuleTuningTab } from "./RuleTuningTab";
import type { Finding } from "../types";

const PATTERNS: BenchmarkFindingPattern[] = [
  "not documented in PPD",
  "not implemented per PPD",
  "internal contradiction",
  "cross-document mismatch",
  "no timeline/monitoring",
  "other",
];

const STATUS_TONE: Record<MatchStatus, "good" | "medium" | "critical" | "neutral"> = {
  caught: "good",
  partial: "medium",
  missed: "critical",
  unassessed: "neutral",
};

function itemIdsOf(subCriterionId: string): string[] {
  return GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId).map((r) => r.id);
}

// Everything the app's AI currently says about one sub-criterion, digestible
// both on screen and inside the match-analysis prompt.
function useAppResults(subCriterionId: string) {
  const ppd = useWorkspaceStore((s) => s.ppdReviewResults[subCriterionId]);
  const ev = useWorkspaceStore((s) => s.evidenceAssessments[subCriterionId]);
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const findings = useMemo(() => {
    const ids = new Set(itemIdsOf(subCriterionId));
    return customFindings.filter((f) => ids.has(f.gd4ItemId));
  }, [customFindings, subCriterionId]);
  return { ppd, ev, findings };
}

function appResultsDigest(subCriterionId: string, ppd: ReturnType<typeof useAppResults>["ppd"], ev: ReturnType<typeof useAppResults>["ev"], findings: Finding[]): string {
  const parts: string[] = [];
  if (ppd) {
    parts.push(`PPD review verdicts:\n${ppd.rows.map((r) => `  [${r.ref}] ${r.verdict}: ${r.shortComment}`).join("\n")}`);
    if (ppd.contradictions?.length) parts.push(`PPD contradictions flagged:\n${ppd.contradictions.map((c) => `  - ${c.description}`).join("\n")}`);
  } else parts.push("PPD review: not run.");
  if (ev) parts.push(`Evidence assessment verdicts:\n${ev.rows.map((r) => `  [${r.gdRef}] ${r.verdict}: ${(r.comment || r.evidenceSummary).slice(0, 200)}`).join("\n")}`);
  else parts.push("Evidence assessment: not run.");
  if (findings.length > 0) parts.push(`Compiled findings:\n${findings.map((f) => `  [${f.id}] ${f.findingType ?? f.type}: ${f.issue}${f.observation ? ` — ${f.observation.slice(0, 200)}` : ""}`).join("\n")}`);
  else parts.push("Compiled findings: none.");
  return parts.join("\n\n");
}

// Whether the app's verdicts for a sub-criterion are uniformly positive —
// the over-rating check compares this against the real AFI count.
function isAllPositive(ppd: ReturnType<typeof useAppResults>["ppd"], ev: ReturnType<typeof useAppResults>["ev"], findings: Finding[]): boolean {
  const ppdAssessed = ppd?.rows.filter((r) => r.verdict !== "Not assessed") ?? [];
  const evAssessed = ev?.rows.filter((r) => r.verdict !== "Not assessed" && !r.assessmentFailed) ?? [];
  if (ppdAssessed.length === 0 && evAssessed.length === 0) return false; // nothing run — not an over-rating case
  const ppdAllAdequate = ppdAssessed.every((r) => r.verdict === "Adequate") && !(ppd?.contradictions?.length);
  const evAllMet = evAssessed.every((r) => r.verdict === "Met");
  const negativeFindings = findings.filter((f) => (f.findingType ?? "NC") !== "OBS" && f.riskCategory !== "D");
  return ppdAllAdequate && evAllMet && negativeFindings.length === 0;
}

function csvCell(v: string | number | boolean): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

// "04 Jul 2026, 14:30" / "04 Jul" — every timestamp on this page goes through
// these so the format is consistent.
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Tab shell: Benchmark (the original calibration content, unchanged) plus
// the two measurement tabs (Consistency, A vs B) from CalibrationLab.tsx.
export function AICalibration() {
  const [tab, setTab] = useState<"benchmark" | "consistency" | "ab" | "rules">("benchmark");
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e2e8f0" }}>
          {([["benchmark", "Benchmark"], ["consistency", "Consistency"], ["ab", "A vs B"], ["rules", "Rule Tuning"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "7px 16px", border: "none",
                borderBottom: `2px solid ${tab === id ? "#4338ca" : "transparent"}`,
                background: "transparent", color: tab === id ? "#4338ca" : "#64748b", marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
      {tab === "benchmark" && <BenchmarkTab />}
      {tab === "consistency" && <ConsistencyTab />}
      {tab === "ab" && <AvsBTab />}
      {tab === "rules" && <RuleTuningTab />}
    </div>
  );
}

function BenchmarkTab() {
  const subCriteria = benchmarkSubCriteria();
  const [selected, setSelected] = useState<string>("all");
  const matches = useCalibrationStore((s) => s.matches);
  const setMatch = useCalibrationStore((s) => s.setMatch);
  const setAiMatch = useCalibrationStore((s) => s.setAiMatch);
  const recordRun = useCalibrationStore((s) => s.recordRun);
  const lastRunAt = useCalibrationStore((s) => s.lastRunAt);
  const runHistory = useCalibrationStore((s) => s.runHistory);
  const aiSettings = useAISettingsStore((s) => s);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const schoolContext = useWorkspaceStore((s) => s.schoolContext);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const visibleAFIs = useMemo(
    () => BENCHMARK_AFIS.filter((a) => selected === "all" || a.subCriterion === selected),
    [selected]
  );
  const gapAFIs = visibleAFIs.filter((a) => a.kind === "AFI");

  const statusOf = (a: BenchmarkAFI): MatchStatus => matches[a.id]?.status ?? "unassessed";

  // Scoreboard: totals + by year + by pattern (gap AFIs only).
  const scoreboard = useMemo(() => {
    const empty = () => ({ caught: 0, partial: 0, missed: 0, unassessed: 0 });
    const total = empty();
    const byYear: Record<string, ReturnType<typeof empty>> = {};
    const byPattern: Record<string, ReturnType<typeof empty>> = {};
    for (const a of gapAFIs) {
      const st = statusOf(a);
      total[st]++;
      (byYear[a.year] ??= empty())[st]++;
      (byPattern[a.findingPattern] ??= empty())[st]++;
    }
    return { total, byYear, byPattern };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapAFIs, matches]);

  // Over-rating sweep: benchmark sub-criteria where the app says all-positive
  // but real assessors raised AFIs.
  const overRated = useMemo(() => {
    return benchmarkSubCriteria()
      .map((sc) => {
        const realAFIs = BENCHMARK_AFIS.filter((a) => a.subCriterion === sc && a.kind === "AFI");
        if (realAFIs.length === 0) return null;
        const ids = new Set(itemIdsOf(sc));
        const findings = customFindings.filter((f) => ids.has(f.gd4ItemId));
        return isAllPositive(ppdReviewResults[sc], evidenceAssessments[sc], findings) ? { subCriterion: sc, count: realAFIs.length } : null;
      })
      .filter((x): x is { subCriterion: string; count: number } => x !== null);
  }, [customFindings, ppdReviewResults, evidenceAssessments]);

  async function runMatchAnalysis() {
    setRunError(null);
    if (!aiSettings.enabled || !aiSettings.apiKey) { setRunError("AI is disabled or no API key is configured in Settings."); return; }
    const targets = [...new Set(gapAFIs.map((a) => a.subCriterion))];
    if (targets.length === 0) { setRunError("No benchmark AFIs to analyse — paste the real report AFIs into src/data/benchmarkAFIs.ts first."); return; }
    setRunning(true);
    try {
      const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(schoolContext) });
      for (const sc of targets) {
        const afis = gapAFIs.filter((a) => a.subCriterion === sc);
        const ids = new Set(itemIdsOf(sc));
        const findings = customFindings.filter((f) => ids.has(f.gd4ItemId));
        const digest = appResultsDigest(sc, ppdReviewResults[sc], evidenceAssessments[sc], findings);
        const system = `You are judging whether an internal AI audit tool caught the same gaps a real SSG EduTrust assessor raised. For each REAL finding, compare it against the tool's results and verdict exactly one of:
"caught" — the tool raised a finding or negative verdict covering the SAME gap (same obligation, same failure mode).
"partial" — the tool flagged the same area (same requirement/topic) but missed the specific gap the assessor named.
"missed" — the tool rated the area Adequate/Met or did not flag it at all.
Give a one-line justification naming what matched or what was missed. Respond with JSON only: {"results": [{"id": string, "status": "caught"|"partial"|"missed", "justification": string}]}`;
        const user = `REAL assessor findings for sub-criterion ${sc}:\n${afis.map((a) => `[${a.id}] (${a.findingPattern}) ${a.findingText}`).join("\n\n")}\n\nThe tool's current results for sub-criterion ${sc}:\n${digest}`;
        const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], settings, { temperature: 0.1 });
        let parsed: unknown;
        try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { parsed = null; }
        const results = parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)
          ? ((parsed as { results: Array<Record<string, unknown>> }).results)
          : [];
        for (const r of results) {
          const id = String(r.id ?? "");
          const status = r.status === "caught" || r.status === "partial" || r.status === "missed" ? r.status : null;
          if (id && status && afis.some((a) => a.id === id)) setAiMatch(id, status, String(r.justification ?? ""));
        }
      }
      // Stamp the completed sweep with its scoreboard totals (always across
      // ALL benchmark gap AFIs, regardless of the page filter, so the trend
      // compares like with like). Read fresh store state — the component's
      // `matches` snapshot predates the setAiMatch calls above.
      const fresh = useCalibrationStore.getState().matches;
      const totals = { caught: 0, partial: 0, missed: 0, unassessed: 0 };
      for (const a of BENCHMARK_AFIS.filter((x) => x.kind === "AFI")) totals[fresh[a.id]?.status ?? "unassessed"]++;
      recordRun(totals);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    const header = ["AFI ID", "Year", "Sub-criterion", "GD4 ref", "Pattern", "Has named example", "Real finding text", "Match status", "Human override", "Justification", "Verdict assessed at", "Match analysis last run"];
    const rows = gapAFIs.map((a) => {
      const m = matches[a.id];
      return [a.id, a.year, a.subCriterion, a.gd4Ref ?? "", a.findingPattern, a.hasNamedExample, a.findingText, m?.status ?? "unassessed", m?.humanOverride ?? false, m?.justification ?? "", m?.assessedAt ?? "", lastRunAt ?? ""];
    });
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gd4-ai-calibration-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (BENCHMARK_AFIS.length === 0) {
    return (
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>AI Calibration — benchmark against real SSG reports</h3>
        <div style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
          <b>No benchmark data yet.</b> The harness is ready, but the real AFI text from the July 2025 and June 2026
          SSG assessment reports has not been pasted into <code>src/data/benchmarkAFIs.ts</code>. Add one entry per AFI
          (a template is in that file) — this page activates automatically once entries exist. Real SSG finding text is
          never invented by the app.
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>AI Calibration — benchmark against real SSG reports</h3>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ ...inputStyle, width: 180, padding: "4px 6px" }}>
            <option value="all">All sub-criteria</option>
            {subCriteria.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
          </select>
          <button disabled={running} onClick={runMatchAnalysis} style={{ cursor: running ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a" }}>
            {running ? "Analysing…" : "Run match analysis"}
          </button>
          <button onClick={exportCsv} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
            Export CSV
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>
          Measures whether the app's AI raises the same gaps real SSG assessors raised. Measurement only — nothing here
          changes prompts or audit results. AI match verdicts are editable; a human edit is never overwritten by a re-run.
        </p>
        {runError && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>{runError}</div>}
      </Card>

      {/* Scoreboard */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Scoreboard</h3>
          <span style={{ fontSize: 12, fontWeight: 600, color: lastRunAt ? "#374151" : "#b45309" }}>
            {lastRunAt ? `Last match analysis run: ${fmtDateTime(lastRunAt)}` : "Match analysis has not been run yet — verdicts below are from earlier runs or manual edits."}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Pill s="good">Caught {scoreboard.total.caught}</Pill>
          <Pill s="medium">Partially caught {scoreboard.total.partial}</Pill>
          <Pill s="critical">Missed {scoreboard.total.missed}</Pill>
          <Pill s="neutral">Unassessed {scoreboard.total.unassessed}</Pill>
        </div>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              {["Breakdown", "Caught", "Partial", "Missed", "Unassessed"].map((h) => (
                <th key={h} style={{ padding: "5px 10px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(scoreboard.byYear).map(([year, c]) => (
              <tr key={year}>
                <td style={{ padding: "4px 10px", fontWeight: 600 }}>Report {year}</td>
                <td style={{ padding: "4px 10px" }}>{c.caught}</td><td style={{ padding: "4px 10px" }}>{c.partial}</td><td style={{ padding: "4px 10px" }}>{c.missed}</td><td style={{ padding: "4px 10px" }}>{c.unassessed}</td>
              </tr>
            ))}
            {PATTERNS.filter((p) => scoreboard.byPattern[p]).map((p) => {
              const c = scoreboard.byPattern[p];
              return (
                <tr key={p}>
                  <td style={{ padding: "4px 10px" }}>{p}</td>
                  <td style={{ padding: "4px 10px" }}>{c.caught}</td><td style={{ padding: "4px 10px" }}>{c.partial}</td><td style={{ padding: "4px 10px" }}>{c.missed}</td><td style={{ padding: "4px 10px" }}>{c.unassessed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {runHistory.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Run history (all benchmark AFIs)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {runHistory.slice(0, 6).map((r, i) => (
                <div key={r.runAt} style={{ fontSize: 12, color: i === 0 ? "#1e293b" : "#6b7280", fontWeight: i === 0 ? 600 : 400 }}>
                  {fmtDateTime(r.runAt)}: Caught {r.caught} · Partial {r.partial} · Missed {r.missed} · Unassessed {r.unassessed}
                  {i === 0 && runHistory.length > 1 && (() => {
                    const d = r.caught - runHistory[1].caught;
                    return <span style={{ marginLeft: 6, color: d > 0 ? "#15803d" : d < 0 ? "#b91c1c" : "#94a3b8" }}>({d > 0 ? `+${d}` : d} caught vs previous run)</span>;
                  })()}
                </div>
              ))}
              {runHistory.length > 6 && <div style={{ fontSize: 11, color: "#94a3b8" }}>… {runHistory.length - 6} older run{runHistory.length - 6 === 1 ? "" : "s"}</div>}
            </div>
          </div>
        )}
      </Card>

      {/* Charts — visual summaries of the scoreboard + improvement trend. */}
      <Card>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
          <BenchmarkBreakdownChart byYear={scoreboard.byYear} byPattern={scoreboard.byPattern} />
          <ImprovementChart history={runHistory} />
        </div>
      </Card>

      {/* Tuning Advisor — auto-generated from the missed/partial findings. */}
      {lastRunAt && (
        <RecommendationsPanel source="benchmark" recommendations={recommendFromBenchmark(matches, BENCHMARK_AFIS)} />
      )}

      {/* Over-rating check */}
      {overRated.length > 0 && (
        <Card>
          <h3 style={{ marginTop: 0, fontSize: 14, color: "#b91c1c" }}>⚠ Over-rating check</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {overRated.map((o) => (
              <div key={o.subCriterion} style={{ fontSize: 12.5, color: "#7f1d1d", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 11px" }}>
                <b>Sub-criterion {o.subCriterion}:</b> AI rated everything Adequate/Met with no findings, but the real
                assessor raised <b>{o.count} AFI{o.count === 1 ? "" : "s"}</b> here.
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Per-AFI comparison */}
      {(selected === "all" ? subCriteria : [selected]).map((sc) => {
        const afis = BENCHMARK_AFIS.filter((a) => a.subCriterion === sc);
        if (afis.length === 0) return null;
        return <SubCriterionSection key={sc} subCriterionId={sc} afis={afis} statusOf={statusOf} matchesJustification={(id) => matches[id]} setMatch={setMatch} />;
      })}
    </div>
  );
}

function SubCriterionSection({ subCriterionId, afis, statusOf, matchesJustification, setMatch }: {
  subCriterionId: string;
  afis: BenchmarkAFI[];
  statusOf: (a: BenchmarkAFI) => MatchStatus;
  matchesJustification: (id: string) => { justification: string; humanOverride?: boolean; assessedAt?: string } | undefined;
  setMatch: (afiId: string, status: MatchStatus, justification: string, humanOverride: boolean) => void;
}) {
  const { ppd, ev, findings } = useAppResults(subCriterionId);
  const digest = appResultsDigest(subCriterionId, ppd, ev, findings);
  const [showApp, setShowApp] = useState(false);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Sub-criterion {subCriterionId}</h3>
        <span style={{ fontSize: 11.5, color: "#6b7280" }}>
          {afis.length} real finding{afis.length === 1 ? "" : "s"} · app: {ppd ? `PPD ✓ (audit ${fmtDate(ppd.runAt)})` : "PPD —"} · {ev ? `Evidence ✓ (audit ${fmtDate(ev.runAt)})` : "Evidence —"} · {findings.length} compiled finding{findings.length === 1 ? "" : "s"}
          {!ppd && !ev && " · no app audit to compare against"}
        </span>
        <button onClick={() => setShowApp((v) => !v)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginLeft: "auto" }}>
          {showApp ? "Hide app results" : "Show app results"}
        </button>
      </div>
      {showApp && (
        <pre style={{ margin: "8px 0 0", padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflowY: "auto", color: "#1e293b" }}>{digest}</pre>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {afis.map((a) => {
          const st = statusOf(a);
          const m = matchesJustification(a.id);
          const isGap = a.kind === "AFI";
          return (
            <div key={a.id} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${st === "caught" ? "#16a34a" : st === "partial" ? "#d97706" : st === "missed" ? "#dc2626" : "#94a3b8"}`, borderRadius: 8, padding: "9px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca" }}>{a.id}</span>
                {a.gd4Ref && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#64748b" }}>{a.gd4Ref}</span>}
                <Pill s={a.kind === "AFI" ? "critical" : a.kind === "strength" ? "good" : "medium"}>{a.kind}</Pill>
                <Pill s="neutral">{a.findingPattern}</Pill>
                {a.hasNamedExample && <Pill s="neutral">named example</Pill>}
                {isGap && (
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {m?.humanOverride && <Pill s="neutral">human</Pill>}
                    <Pill s={STATUS_TONE[st]}>{st === "partial" ? "partially caught" : st}</Pill>
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-line" }}>{a.findingText}</div>
              {isGap && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 7 }}>
                  <select
                    value={st}
                    onChange={(e) => setMatch(a.id, e.target.value as MatchStatus, m?.justification ?? "", true)}
                    style={{ ...inputStyle, width: 150, padding: "3px 5px", fontSize: 11.5 }}
                  >
                    <option value="unassessed">unassessed</option>
                    <option value="caught">caught</option>
                    <option value="partial">partially caught</option>
                    <option value="missed">missed</option>
                  </select>
                  <input
                    value={m?.justification ?? ""}
                    onChange={(e) => setMatch(a.id, st, e.target.value, true)}
                    placeholder="Justification — what matched, or what the AI missed"
                    style={{ ...inputStyle, flex: 1, minWidth: 240, padding: "3px 6px", fontSize: 11.5 }}
                  />
                </div>
              )}
              {isGap && m?.assessedAt && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                  assessed {fmtDateTime(m.assessedAt)}
                  {m.humanOverride && <span style={{ color: "#7c3aed" }}> · edited by you {fmtDate(m.assessedAt)} — re-runs won't overwrite this verdict</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
