// The AI Calibration page's two measurement tabs:
//   Consistency — run ONE path N times on the same folders and score how
//     often the verdicts agree (repeatability).
//   A vs B — run BOTH paths on the same folders and judge each against the
//     benchmark's real SSG AFIs (accuracy beats raw output count).
// Everything runs from THIS page (no Evidence Folder round-trips): pick a
// sub-criterion, one click, combined progress, results stored with
// timestamps in useCalibrationStore. Scratch-only — the user's real audit
// results are never written.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { combineBenchmarkAfis } from "../data/benchmarkAFIs";
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useCustomBenchmarkStore } from "../store/useCustomBenchmarkStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { verdictTemp } from "../lib/ai/aiClient";
import { toCsv, downloadCsv } from "../lib/auditCsvExport";
import { foldersConnected, aiReady, runScratch, judgeVsBenchmark, type ScratchRunOutput } from "../lib/calibrationRunner";
import {
  consistencyAgreement, consistencySummary, bandStabilityLabel, gapVariationLabel, formatRunOn,
  abWinner, abVerdictLine, abOverallTally,
  type ConsistencyLine, type ConsistencyTestResult, type ABTestResult, type ABPathOutcome,
} from "../lib/calibrationTesting";
import { OVERFITTING_CAUTION, recommendFromConsistency, recommendFromAB, type Recommendation } from "../lib/tuningAdvisor";
import { ConsistencyHeatChart, ABHeadToHeadChart, ABWinPatternChart } from "../components/ui/calibrationCharts";

const STATUS_COLOR: Record<string, string> = { Met: "#15803d", Partial: "#b45309", "Not met": "#b91c1c" };

// ── Tuning Advisor panel ─────────────────────────────────────────────────
// Auto-generated after each test. AI recommends; the human decides. Only
// temperature + path-defaults carry a one-click Apply (visible, reversible);
// prompt/skill work is advisory with a copyable Claude Code instruction.
// Benchmark-derived recommendations show the standing overfitting caution.
export function RecommendationsPanel({ source, recommendations }: { source: "consistency" | "a-vs-b" | "benchmark"; recommendations: Recommendation[] }) {
  const setVerdictTemperature = useAISettingsStore((s) => s.setVerdictTemperature);
  const setAnalysisPath = useWorkspaceStore((s) => s.setAnalysisPath);
  const logApplied = useCalibrationStore((s) => s.logAppliedRecommendation);
  const applied = useCalibrationStore((s) => s.appliedRecommendations);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (recommendations.length === 0) return null;
  const anyBenchmark = recommendations.some((r) => r.benchmarkDerived);

  const apply = (r: Recommendation) => {
    if (!r.apply) return;
    let summary = "";
    if (r.apply.type === "temperature") {
      setVerdictTemperature(r.apply.value);
      summary = `Set verdict temperature to ${r.apply.value.toFixed(2)}`;
    } else {
      for (const [sc, p] of Object.entries(r.apply.paths)) setAnalysisPath(sc, p);
      summary = `Set path default: ${Object.entries(r.apply.paths).map(([sc, p]) => `${sc}→${p}`).join(", ")}`;
    }
    logApplied({ source, recommendationId: r.id, summary });
  };

  const TONE: Record<Recommendation["severity"], { bg: string; border: string; label: string; labelColor: string }> = {
    action: { bg: "#fffbeb", border: "#fde68a", label: "Recommended action", labelColor: "#b45309" },
    advisory: { bg: "#eff6ff", border: "#bfdbfe", label: "Advisory", labelColor: "#1d4ed8" },
    ok: { bg: "#f0fdf4", border: "#bbf7d0", label: "Healthy", labelColor: "#15803d" },
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Tuning Advisor <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8" }}>· auto-generated · AI recommends, you decide</span></h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {recommendations.map((r) => {
          const tone = TONE[r.severity];
          const wasApplied = applied.some((a) => a.recommendationId === r.id);
          return (
            <div key={r.id} style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: tone.labelColor }}>{tone.label}</span>
                <b style={{ fontSize: 12.5, color: "#1e293b", flex: 1 }}>{r.title}</b>
              </div>
              <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: r.evidence.length || r.apply || r.copyableInstruction ? 6 : 0 }}>{r.reasoning}</div>
              {r.evidence.length > 0 && (
                <div style={{ fontSize: 11, color: "#64748b", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 9px", marginBottom: 6, maxHeight: 130, overflowY: "auto" }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Based on:</div>
                  {r.evidence.map((e, i) => <div key={i} style={{ lineHeight: 1.45 }}>· {e}</div>)}
                </div>
              )}
              {r.apply && (
                <button
                  disabled={wasApplied}
                  onClick={() => apply(r)}
                  style={{ cursor: wasApplied ? "default" : "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "1px solid #4338ca", background: wasApplied ? "#e0e7ff" : "#4338ca", color: wasApplied ? "#4338ca" : "#fff" }}
                >
                  {wasApplied ? "✓ Applied" : r.apply.type === "temperature" ? "Apply — lower temperature" : "Apply path defaults"}
                </button>
              )}
              {r.copyableInstruction && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>Advisory only (no auto-apply) — copy this instruction for a deliberate prompt/skill change:</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <textarea readOnly value={r.copyableInstruction} style={{ flex: 1, minHeight: 54, fontSize: 11, fontFamily: "ui-monospace,monospace", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, resize: "vertical", background: "#fff" }} />
                    <button onClick={() => { navigator.clipboard?.writeText(r.copyableInstruction!); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500); }} style={{ cursor: "pointer", fontSize: 11.5, padding: "5px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}>{copiedId === r.id ? "Copied" : "Copy"}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {anyBenchmark && (
        <div style={{ fontSize: 11, color: "#7c2d12", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "7px 10px", marginTop: 8 }}>
          ⚠ Overfitting caution: {OVERFITTING_CAUTION}
        </div>
      )}
    </Card>
  );
}

// ── Shared picker with guidance ──────────────────────────────────────────

type SubCritInfo = {
  id: string;
  title: string;
  benchmarkCount: number;
  connected: boolean;
  testedAt: string | null;
  recommended: boolean;
};

function useSubCritInfo(testedMap: Record<string, { runAt: string }>): SubCritInfo[] {
  const customEntries = useCustomBenchmarkStore((s) => s.entries);
  return useMemo(() => {
    const allAfis = combineBenchmarkAfis(customEntries);
    const infos = GD4_SUB_CRITERIA.map((sc) => {
      const benchmarkCount = allAfis.filter((a) => a.subCriterion === sc.id && a.kind === "AFI").length;
      const connected = foldersConnected(sc.id);
      return {
        id: sc.id, title: sc.title, benchmarkCount, connected,
        testedAt: testedMap[sc.id]?.runAt ?? null,
        recommended: connected && benchmarkCount > 0,
      };
    });
    // Best candidates first: connected + benchmark truth, then benchmark
    // only, then connected only, then the rest — within each, GD4 order.
    return infos.sort((a, b) => {
      const rank = (x: SubCritInfo) => (x.recommended ? 0 : x.benchmarkCount > 0 ? 1 : x.connected ? 2 : 3);
      return rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { numeric: true });
    });
  }, [testedMap, customEntries]);
}

function pickerLabel(i: SubCritInfo): string {
  const bits: string[] = [];
  if (i.benchmarkCount > 0) bits.push(`${i.benchmarkCount} real finding${i.benchmarkCount === 1 ? "" : "s"}`);
  bits.push(i.connected ? "connected" : "no folders linked");
  if (i.testedAt) bits.push(`tested ${new Date(i.testedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`);
  return `${i.recommended ? "★ " : ""}${i.id} ${i.title} — ${bits.join(" · ")}`;
}

function CoverageLine({ label, infos, testedMap }: { label: string; infos: SubCritInfo[]; testedMap: Record<string, unknown> }) {
  const withTruth = infos.filter((i) => i.benchmarkCount > 0);
  const testedWithTruth = withTruth.filter((i) => testedMap[i.id]).length;
  return (
    <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 11px", marginBottom: 8 }}>
      <b>Test coverage:</b> you've {label} {testedWithTruth} of {withTruth.length} sub-criteria that have benchmark findings.
      {" "}<span style={{ color: "#6b7280" }}>Recommended (★): sub-criteria with real findings to compare against AND folders connected.</span>
    </div>
  );
}

function PrereqNotice({ selected, needsTruthNote }: { selected: SubCritInfo | undefined; needsTruthNote?: boolean }) {
  if (!selected) return null;
  return (
    <>
      {!selected.connected && (
        <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "7px 11px", marginBottom: 8 }}>
          {selected.id} has no Drive folders linked, so the test cannot run.{" "}
          <Link to="/evidence-folder" style={{ color: "#4338ca", fontWeight: 600 }}>Connect its folders on the Evidence Folder page</Link>, then come back — the run itself happens here.
        </div>
      )}
      {needsTruthNote && selected.benchmarkCount === 0 && (
        <div style={{ fontSize: 12, color: "#6b7280", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 11px", marginBottom: 8 }}>
          {selected.id} has <b>no truth to compare</b> — no benchmark AFIs. The test will show raw counts only; the accuracy score (which decides "better") won't be available.
        </div>
      )}
    </>
  );
}

// Compact combined progress with heartbeat + cancel.
function RunProgress({ headline, stage, startedAt, onCancel }: { headline: string; stage: string; startedAt: number; onCancel: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "9px 12px", marginBottom: 10 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1d4ed8", whiteSpace: "nowrap" }}>{headline}</span>
      <span style={{ flex: 1, fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage}</span>
      <span style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      <button onClick={onCancel} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b23121" }}>Cancel</button>
    </div>
  );
}

// ── Tab 2: Consistency ───────────────────────────────────────────────────

export function ConsistencyTab() {
  const tests = useCalibrationStore((s) => s.consistencyTests);
  const setConsistencyTest = useCalibrationStore((s) => s.setConsistencyTest);
  const deleteConsistencyTest = useCalibrationStore((s) => s.deleteConsistencyTest);
  const clearConsistencyTests = useCalibrationStore((s) => s.clearConsistencyTests);
  const verdictTemperature = useAISettingsStore((s) => verdictTemp(s));
  const infos = useSubCritInfo(tests);
  const [selectedId, setSelectedId] = useState("");
  const [path, setPath] = useState<"A" | "B">("B");
  const [runs, setRuns] = useState(3);
  const [running, setRunning] = useState<{ headline: string; stage: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = infos.find((i) => i.id === selectedId);
  const saved = selectedId ? tests[selectedId] : undefined;

  async function runTest(subCriterionId: string, testPath: "A" | "B", n: number) {
    setError(null);
    const offline = aiReady();
    if (offline) { setError(offline); return; }
    if (!foldersConnected(subCriterionId)) { setError("Folders not connected for this sub-criterion."); return; }
    const abort = new AbortController();
    abortRef.current = abort;
    const startedAt = Date.now();
    const outputs: (ScratchRunOutput | null)[] = [];
    try {
      for (let i = 0; i < n; i++) {
        if (abort.signal.aborted) break;
        setRunning({ headline: `Run ${i + 1} of ${n} (Option ${testPath})`, stage: "Starting…", startedAt });
        const out = await runScratch(testPath, subCriterionId, abort.signal, (stage) =>
          setRunning({ headline: `Run ${i + 1} of ${n} (Option ${testPath})`, stage, startedAt }));
        outputs.push(out.ok ? out : null);
        if (!out.ok && abort.signal.aborted) break;
      }
      // Align lines by ref across the completed runs — a failed run
      // contributes nulls (factored honestly into the score, never invented).
      const refOrder: { ref: string; text: string }[] = [];
      const seen = new Set<string>();
      for (const out of outputs) if (out) for (const l of out.lines) if (!seen.has(l.ref)) { seen.add(l.ref); refOrder.push({ ref: l.ref, text: l.text }); }
      const lines: ConsistencyLine[] = refOrder.map(({ ref, text }) => ({
        ref, text,
        verdicts: outputs.map((out) => out?.lines.find((l) => l.ref === ref)?.status ?? null),
        // Reasoning + cited evidence behind each run's verdict, for drill-in.
        details: outputs.map((out) => {
          const l = out?.lines.find((x) => x.ref === ref);
          return l ? { note: l.note, evidence: l.evidence } : null;
        }),
      }));
      const bands = outputs.map((o) => (o ? o.bandEstimate : null));
      const gapCounts = outputs.map((o) => (o ? o.gapCount : null));
      const failedRuns = outputs.map((o, i) => (o ? null : i + 1)).filter((x): x is number => x != null);
      const { agreementPct } = consistencyAgreement(lines);
      const result: ConsistencyTestResult = {
        subCriterionId, path: testPath, runs: outputs.length, runAt: new Date().toISOString(),
        temperature: verdictTemp(useAISettingsStore.getState()),
        lines, bands, gapCounts, failedRuns, agreementPct,
        summary: consistencySummary(agreementPct, bands, gapCounts, failedRuns, outputs.length),
      };
      setConsistencyTest(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
      abortRef.current = null;
    }
  }

  function exportCsv() {
    const all = Object.values(tests);
    const maxRuns = Math.max(1, ...all.map((t) => t.runs));
    const rows = all.flatMap((t) =>
      t.lines.map((l) => [
        t.subCriterionId, t.path, t.runAt, formatRunOn(t.runAt), t.temperature ?? "", t.runs, t.agreementPct ?? "",
        t.bands.map((b) => b ?? "failed").join(" | "), t.gapCounts.map((c) => c ?? "failed").join(" | "),
        l.ref, l.text,
        ...l.verdicts.map((v) => v ?? "run failed"),
        // Reasoning per run, so the drill-in detail travels to the CSV too.
        ...Array.from({ length: maxRuns }, (_, i) => l.details?.[i]?.note ?? ""),
      ])
    );
    downloadCsv(
      toCsv([
        "Sub-criterion", "Path", "Run on (ISO)", "Run on", "Temperature", "Runs", "Agreement %", "Band estimates", "Gap counts", "Line ref", "Requirement",
        ...Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1} verdict`),
        ...Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1} reasoning`),
      ], rows),
      `gd4-consistency-tests-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Consistency check — does the same path give the same result?</h3>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 10px" }}>
          Runs ONE path N times on the same connected folders and scores how often the per-line verdicts agree.
          High agreement = reliable; low = the path gives inconsistent answers on identical input. Scratch runs only —
          your real audit results are not touched. Any connected sub-criterion works (repeatability needs no benchmark truth).
        </p>
        <CoverageLine label="consistency-tested" infos={infos} testedMap={tests} />
        <div style={{ fontSize: 11.5, color: "#3730a3", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
          Verdict temperature now in effect: <b>{verdictTemperature.toFixed(2)}</b>. Inconsistent results? <Link to="/settings" style={{ color: "#4338ca", fontWeight: 600 }}>Lower the temperature in Settings</Link>, then re-run this test.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 340, padding: "5px 8px", fontSize: 12.5 }}>
            <option value="">Select a sub-criterion… (★ = recommended)</option>
            {infos.map((i) => <option key={i.id} value={i.id}>{pickerLabel(i)}</option>)}
          </select>
          <select value={path} onChange={(e) => setPath(e.target.value as "A" | "B")} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12.5 }}>
            <option value="A">Option A (PPD + Evidence)</option>
            <option value="B">Option B (Staged audit)</option>
          </select>
          <label style={{ fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 5 }}>
            Repeat runs
            <input type="number" min={2} max={10} value={runs} onChange={(e) => setRuns(Math.max(2, Math.min(10, Number(e.target.value) || 2)))} style={{ ...inputStyle, width: 58, padding: "4px 6px" }} />
          </label>
          <button
            disabled={!!running || !selected || !selected.connected}
            onClick={() => selected && runTest(selected.id, path, runs)}
            title={`Real AI calls — cost is ${runs} × a normal Option ${path} run on this sub-criterion.`}
            style={{ cursor: running || !selected?.connected ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: !selected || !selected.connected ? 0.5 : 1 }}
          >
            {running ? "Running…" : saved ? "Re-run test" : `Run test (${runs} runs)`}
          </button>
          {Object.keys(tests).length > 0 && (
            <>
              <button onClick={exportCsv} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>Export CSV</button>
              <button
                onClick={() => { if (confirm(`Clear all ${Object.keys(tests).length} consistency test result(s)? This deletes only these measurement records — your real audit results are not affected. This cannot be undone.`)) clearConsistencyTests(); }}
                style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}
              >
                Clear all results
              </button>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#b45309", marginBottom: 6 }}>⚠ Real AI calls: cost ≈ {runs} × a normal run. Tokens are logged in the AI Review Log as usual.</div>
        <PrereqNotice selected={selected} />
        {running && <RunProgress headline={running.headline} stage={running.stage} startedAt={running.startedAt} onCancel={() => abortRef.current?.abort()} />}
        {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
      </Card>

      {saved && <ConsistencyResult result={saved} onDelete={() => { deleteConsistencyTest(saved.subCriterionId); setSelectedId(""); }} />}
      {saved && <Card><ConsistencyHeatChart result={saved} /></Card>}
      {saved && <RecommendationsPanel source="consistency" recommendations={recommendFromConsistency(saved)} />}

      {/* Past tests on other sub-criteria stay reviewable + individually re-runnable + deletable. */}
      {Object.values(tests).filter((t) => t.subCriterionId !== selectedId).map((t) => (
        <Card key={t.subCriterionId} style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 12.5 }}>{t.subCriterionId}</b>
            <Pill s="neutral">Option {t.path} × {t.runs}</Pill>
            <span style={{ fontSize: 12, color: "#475569", flex: 1 }}>{t.summary}</span>
            {t.temperature != null && <span style={{ fontSize: 11, color: "#4338ca", whiteSpace: "nowrap" }}>temp {t.temperature.toFixed(2)}</span>}
            <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Run on {formatRunOn(t.runAt)}</span>
            <button onClick={() => setSelectedId(t.subCriterionId)} style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>View</button>
            <button disabled={!!running} onClick={() => { setSelectedId(t.subCriterionId); setPath(t.path); runTest(t.subCriterionId, t.path, t.runs); }} style={{ cursor: running ? "not-allowed" : "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 600 }}>Re-run</button>
            <button onClick={() => { if (confirm(`Delete the consistency test for ${t.subCriterionId}? Only this measurement record is removed — audit results are untouched.`)) deleteConsistencyTest(t.subCriterionId); }} title="Delete this test record" style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}>Delete</button>
          </div>
        </Card>
      ))}
    </>
  );
}

function ConsistencyResult({ result, onDelete }: { result: ConsistencyTestResult; onDelete: () => void }) {
  const disagreeing = result.lines.filter((l) => {
    const vs = l.verdicts.filter((v): v is string => v != null);
    return vs.length >= 2 && !vs.every((v) => v === vs[0]);
  }).length;
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Consistency — {result.subCriterionId} · Option {result.path} × {result.runs}</h3>
        {result.temperature != null && <span style={{ fontSize: 12, fontWeight: 600, color: "#3730a3", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "2px 9px" }}>temperature {result.temperature.toFixed(2)}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 9px" }}>Run on {formatRunOn(result.runAt)}</span>
        <button onClick={onDelete} title="Delete this test record (scratch only — audit results untouched)" style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11.5, padding: "3px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 600 }}>Delete</button>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: result.agreementPct != null && result.agreementPct < 75 ? "#b45309" : "#15803d", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
        {result.summary}
      </div>
      <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 6 }}>
        {bandStabilityLabel(result.bands)} · {gapVariationLabel(result.gapCounts)} · {disagreeing} line{disagreeing === 1 ? "" : "s"} with disagreement (highlighted) · click any row to see the reasoning behind each run's verdict
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600 }}>Requirement line</th>
              {Array.from({ length: result.runs }, (_, i) => (
                <th key={i} style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>Run {i + 1}{result.failedRuns.includes(i + 1) ? " ✗" : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.lines.map((l) => <ConsistencyLineRow key={l.ref} line={l} runs={result.runs} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// One requirement line: the verdict cells, expandable to the per-run reasoning
// + cited evidence so the user sees WHY the runs (dis)agreed, side by side.
function ConsistencyLineRow({ line, runs }: { line: ConsistencyLine; runs: number }) {
  const [open, setOpen] = useState(false);
  const vs = line.verdicts.filter((v): v is string => v != null);
  const disagree = vs.length >= 2 && !vs.every((v) => v === vs[0]);
  const hasDetail = (line.details ?? []).some((d) => d && (d.note || d.evidence.length));
  return (
    <>
      <tr onClick={() => hasDetail && setOpen((o) => !o)} style={{ background: disagree ? "#fff7ed" : undefined, borderBottom: "1px solid #f1f5f9", cursor: hasDetail ? "pointer" : "default" }}>
        <td style={{ padding: "5px 8px", maxWidth: 480 }}>
          {hasDetail && <span style={{ color: "#94a3b8", marginRight: 4 }}>{open ? "▾" : "▸"}</span>}
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#6b7280" }}>{line.ref}</span> {line.text.slice(0, 140)}{line.text.length > 140 ? "…" : ""}
        </td>
        {line.verdicts.map((v, i) => (
          <td key={i} style={{ padding: "5px 8px", fontWeight: 600, color: v ? STATUS_COLOR[v] ?? "#374151" : "#94a3b8", whiteSpace: "nowrap" }}>{v ?? "run failed"}</td>
        ))}
      </tr>
      {open && (
        <tr>
          <td colSpan={runs + 1} style={{ padding: "0 8px 10px", background: disagree ? "#fffbf5" : "#fafafa" }}>
            {/* Per-run reasoning side by side — compare why the verdicts differ. */}
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(${runs}, minmax(0, 1fr))`, marginTop: 4 }}>
              {Array.from({ length: runs }, (_, i) => {
                const v = line.verdicts[i];
                const d = line.details?.[i] ?? null;
                return (
                  <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>Run {i + 1} — <span style={{ color: v ? STATUS_COLOR[v] ?? "#374151" : "#94a3b8" }}>{v ?? "run failed"}</span></div>
                    <div style={{ fontSize: 11.5, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{d?.note || (v ? "(no reasoning captured)" : "This run did not produce a result for this line.")}</div>
                    {d?.evidence.length ? (
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
                        <b>Evidence cited:</b> {d.evidence.join(", ")}
                      </div>
                    ) : d ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>No evidence cited.</div> : null}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Tab 3: A vs B ────────────────────────────────────────────────────────

export function AvsBTab() {
  const tests = useCalibrationStore((s) => s.abTests);
  const setAbTest = useCalibrationStore((s) => s.setAbTest);
  const deleteAbTest = useCalibrationStore((s) => s.deleteAbTest);
  const clearAbTests = useCalibrationStore((s) => s.clearAbTests);
  const infos = useSubCritInfo(tests);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState<{ headline: string; stage: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = infos.find((i) => i.id === selectedId);
  const saved = selectedId ? tests[selectedId] : undefined;
  const tally = useMemo(() => abOverallTally(Object.values(tests)), [tests]);

  async function runAB(subCriterionId: string) {
    setError(null);
    const offline = aiReady();
    if (offline) { setError(offline); return; }
    if (!foldersConnected(subCriterionId)) { setError("Folders not connected for this sub-criterion."); return; }
    const abort = new AbortController();
    abortRef.current = abort;
    const startedAt = Date.now();
    const toOutcome = async (label: "A" | "B"): Promise<ABPathOutcome> => {
      setRunning({ headline: `Running Option ${label}…`, stage: "Starting…", startedAt });
      const out = await runScratch(label, subCriterionId, abort.signal, (stage) => setRunning({ headline: `Running Option ${label}…`, stage, startedAt }));
      if (!out.ok) return { ran: false, error: out.error, findingsTotal: 0, byType: { NC: 0, OFI: 0, OBS: 0 }, bandEstimate: null, judged: false, caught: 0, partial: 0, missed: 0 };
      setRunning({ headline: `Running Option ${label}…`, stage: "Judging against benchmark findings…", startedAt });
      const judge = await judgeVsBenchmark(subCriterionId, out.digest, abort.signal);
      return { ran: true, findingsTotal: out.gapCount, byType: out.byType, bandEstimate: out.bandEstimate, ...judge, lines: out.lines.map((l) => ({ ref: l.ref, text: l.text, status: l.status, note: l.note, evidence: l.evidence })) };
    };
    try {
      const a = await toOutcome("A");
      if (abort.signal.aborted) return;
      const b = await toOutcome("B");
      const allAfis = combineBenchmarkAfis(useCustomBenchmarkStore.getState().entries);
      const benchmarkCount = allAfis.filter((x) => x.subCriterion === subCriterionId && x.kind === "AFI").length;
      const patterns = [...new Set(allAfis.filter((x) => x.subCriterion === subCriterionId && x.kind === "AFI").map((x) => x.findingPattern))];
      const result: ABTestResult = {
        subCriterionId, runAt: new Date().toISOString(), temperature: verdictTemp(useAISettingsStore.getState()), benchmarkCount, patterns, a, b,
        winner: abWinner(a, b, benchmarkCount),
        verdictLine: abVerdictLine(subCriterionId, a, b, benchmarkCount),
      };
      setAbTest(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
      abortRef.current = null;
    }
  }

  function exportCsv() {
    const rows = Object.values(tests).map((t) => [
      t.subCriterionId, t.runAt, formatRunOn(t.runAt), t.temperature ?? "", t.benchmarkCount, t.patterns.join(" | "),
      t.a.caught, t.a.partial, t.a.missed, t.a.findingsTotal, t.a.byType.NC, t.a.byType.OFI, t.a.bandEstimate ?? "",
      t.b.caught, t.b.partial, t.b.missed, t.b.findingsTotal, t.b.byType.NC, t.b.byType.OFI, t.b.bandEstimate ?? "",
      t.winner, t.verdictLine,
    ]);
    downloadCsv(
      toCsv(["Sub-criterion", "Run on (ISO)", "Run on", "Temperature", "Benchmark AFIs", "Patterns", "A caught", "A partial", "A missed", "A findings", "A NC", "A OFI", "A band est.", "B caught", "B partial", "B missed", "B findings", "B NC", "B OFI", "B band est.", "Winner", "Verdict"], rows),
      `gd4-a-vs-b-tests-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>A vs B — which path performs better on the same source?</h3>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 10px" }}>
          Runs Option A then Option B back-to-back on the same connected folders, then judges EACH against the
          benchmark's real SSG findings. Accuracy (catching the RIGHT findings) is the primary measure — raw finding
          counts are shown alongside but never decide the winner. Scratch runs only — your real audit results are not touched.
        </p>
        <CoverageLine label="A-vs-B-tested" infos={infos} testedMap={tests} />
        {(tally.aWins + tally.bWins + tally.ties + tally.noTruth) > 0 && (
          <div style={{ fontSize: 12.5, color: "#1e293b", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
            <b>Overall tally:</b> A wins {tally.aWins} · B wins {tally.bWins} · ties {tally.ties}{tally.noTruth > 0 ? ` · ${tally.noTruth} without truth (raw counts only)` : ""}
            {tally.patternNote && <span style={{ color: "#5b21b6" }}> — pattern: {tally.patternNote}</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 340, padding: "5px 8px", fontSize: 12.5 }}>
            <option value="">Select a sub-criterion… (★ = recommended; prefer ones with real findings)</option>
            {infos.map((i) => <option key={i.id} value={i.id}>{pickerLabel(i)}{i.benchmarkCount === 0 ? " — no truth to compare" : ""}</option>)}
          </select>
          <button
            disabled={!!running || !selected || !selected.connected}
            onClick={() => selected && runAB(selected.id)}
            title="Real AI calls — cost ≈ two full runs (Option A + Option B) plus two small judge calls."
            style={{ cursor: running || !selected?.connected ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: !selected || !selected.connected ? 0.5 : 1 }}
          >
            {running ? "Running…" : saved ? "Re-run A vs B" : "Run A vs B"}
          </button>
          {Object.keys(tests).length > 0 && (
            <>
              <button onClick={exportCsv} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>Export CSV</button>
              <button
                onClick={() => { if (confirm(`Clear all ${Object.keys(tests).length} A-vs-B test result(s)? This deletes only these measurement records — your real audit results are not affected. This cannot be undone.`)) clearAbTests(); }}
                style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}
              >
                Clear all results
              </button>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#b45309", marginBottom: 6 }}>⚠ Real AI calls: cost ≈ two full runs. Tokens are logged in the AI Review Log as usual.</div>
        <PrereqNotice selected={selected} needsTruthNote />
        {running && <RunProgress headline={running.headline} stage={running.stage} startedAt={running.startedAt} onCancel={() => abortRef.current?.abort()} />}
        {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
      </Card>

      {saved && <ABResult result={saved} onDelete={() => { deleteAbTest(saved.subCriterionId); setSelectedId(""); }} />}
      {saved && <Card><ABHeadToHeadChart result={saved} /></Card>}
      {Object.values(tests).some((t) => t.winner === "A" || t.winner === "B") && <Card><ABWinPatternChart tests={Object.values(tests)} /></Card>}
      {Object.keys(tests).length > 0 && <RecommendationsPanel source="a-vs-b" recommendations={recommendFromAB(Object.values(tests))} />}

      {Object.values(tests).filter((t) => t.subCriterionId !== selectedId).map((t) => (
        <Card key={t.subCriterionId} style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 12.5 }}>{t.subCriterionId}</b>
            <Pill s={t.winner === "A" || t.winner === "B" ? "good" : "neutral"}>{t.winner === "no-truth" ? "no truth" : t.winner === "tie" ? "tie" : `${t.winner} wins`}</Pill>
            <span style={{ fontSize: 12, color: "#475569", flex: 1 }}>{t.verdictLine.slice(0, 160)}{t.verdictLine.length > 160 ? "…" : ""}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Run on {formatRunOn(t.runAt)}</span>
            <button onClick={() => setSelectedId(t.subCriterionId)} style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>View</button>
            <button disabled={!!running} onClick={() => { setSelectedId(t.subCriterionId); runAB(t.subCriterionId); }} style={{ cursor: running ? "not-allowed" : "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 600 }}>Re-run</button>
            <button onClick={() => { if (confirm(`Delete the A-vs-B test for ${t.subCriterionId}? Only this measurement record is removed — audit results are untouched.`)) deleteAbTest(t.subCriterionId); }} title="Delete this test record" style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}>Delete</button>
          </div>
        </Card>
      ))}
    </>
  );
}

function PathColumn({ label, outcome, benchmarkCount }: { label: string; outcome: ABPathOutcome; benchmarkCount: number }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {!outcome.ran ? (
        <div style={{ fontSize: 12, color: "#b91c1c" }}>Run failed: {outcome.error}</div>
      ) : (
        <>
          {benchmarkCount > 0 && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              <b>Accuracy vs truth:</b>{" "}
              {outcome.judged
                ? <>caught <b style={{ color: "#15803d" }}>{outcome.caught}</b> · partial <b style={{ color: "#b45309" }}>{outcome.partial}</b> · missed <b style={{ color: "#b91c1c" }}>{outcome.missed}</b> of {benchmarkCount}</>
                : <span style={{ color: "#b45309" }}>judge call failed — accuracy unavailable</span>}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#475569" }}>
            Raw output: {outcome.findingsTotal} finding{outcome.findingsTotal === 1 ? "" : "s"} ({outcome.byType.NC} NC · {outcome.byType.OFI} OFI · {outcome.byType.OBS} lines Met) · band est. {outcome.bandEstimate ?? "–"}
          </div>
        </>
      )}
    </div>
  );
}

function ABResult({ result, onDelete }: { result: ABTestResult; onDelete: () => void }) {
  const customEntries = useCustomBenchmarkStore((s) => s.entries);
  const realAFIs = combineBenchmarkAfis(customEntries).filter((a) => a.subCriterion === result.subCriterionId && a.kind === "AFI");
  const [drill, setDrill] = useState(false);
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>A vs B — {result.subCriterionId}</h3>
        {result.temperature != null && <span style={{ fontSize: 12, fontWeight: 600, color: "#3730a3", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "2px 9px" }}>temperature {result.temperature.toFixed(2)}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 9px" }}>Run on {formatRunOn(result.runAt)}</span>
        <button onClick={onDelete} title="Delete this test record (scratch only — audit results untouched)" style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11.5, padding: "3px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 600 }}>Delete</button>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1e293b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", marginBottom: 10, lineHeight: 1.5 }}>
        {result.verdictLine}
      </div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
        <PathColumn label="Option A (PPD + Evidence)" outcome={result.a} benchmarkCount={result.benchmarkCount} />
        <PathColumn label="Option B (Staged audit)" outcome={result.b} benchmarkCount={result.benchmarkCount} />
        <div style={{ border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px", background: "#faf5ff" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Real SSG findings ({result.benchmarkCount})</div>
          {realAFIs.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>None in the benchmark for this sub-criterion — no truth to compare.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
              {realAFIs.map((a) => (
                <div key={a.id} style={{ fontSize: 11.5, color: "#1e293b", lineHeight: 1.45 }}>
                  <span style={{ fontFamily: "ui-monospace,monospace", color: "#5b21b6", fontWeight: 700 }}>{a.id}</span>{" "}
                  <span style={{ color: "#6b7280" }}>({a.findingPattern})</span> {a.findingText.slice(0, 180)}{a.findingText.length > 180 ? "…" : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(result.a.lines?.length || result.b.lines?.length) ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setDrill((d) => !d)} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#4338ca", border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 7, padding: "5px 11px" }}>
            {drill ? "Hide per-line detail ▾" : "Show what each path actually raised, line by line ▸"}
          </button>
          {drill && <ABLineDetail result={result} />}
        </div>
      ) : null}
    </Card>
  );
}

// Per requirement line: Option A's verdict+reasoning+evidence beside Option
// B's, so the user sees exactly where and why the two paths diverged.
function ABLineDetail({ result }: { result: ABTestResult }) {
  const aByRef = new Map((result.a.lines ?? []).map((l) => [l.ref, l]));
  const bByRef = new Map((result.b.lines ?? []).map((l) => [l.ref, l]));
  const refs: { ref: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const l of [...(result.a.lines ?? []), ...(result.b.lines ?? [])]) if (!seen.has(l.ref)) { seen.add(l.ref); refs.push({ ref: l.ref, text: l.text }); }
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {refs.map(({ ref, text }) => {
        const a = aByRef.get(ref);
        const b = bByRef.get(ref);
        const differ = a && b && a.status !== b.status;
        return (
          <div key={ref} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", background: differ ? "#fffbf5" : "#fff" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#6b7280" }}>{ref}</span> {text.slice(0, 160)}{text.length > 160 ? "…" : ""}
              {differ && <span style={{ marginLeft: 6, color: "#b45309", fontWeight: 700 }}>· paths differ</span>}
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
              {([["Option A", a], ["Option B", b]] as const).map(([label, ln]) => (
                <div key={label} style={{ border: "1px solid #f1f5f9", borderRadius: 6, padding: "6px 9px", background: "#f8fafc" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>{label} — <span style={{ color: ln ? STATUS_COLOR[ln.status] ?? "#374151" : "#94a3b8" }}>{ln?.status ?? "no result"}</span></div>
                  <div style={{ fontSize: 11.5, color: "#1e293b", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{ln?.note || "(no reasoning captured)"}</div>
                  {ln?.evidence.length ? <div style={{ fontSize: 11, color: "#475569", marginTop: 5 }}><b>Evidence:</b> {ln.evidence.join(", ")}</div> : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
