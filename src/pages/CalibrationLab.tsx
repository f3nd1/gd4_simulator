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
import { useCalibrationStore } from "../store/useCalibrationStore";
import { useBenchmarkAfiStore } from "../store/useBenchmarkAfiStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { verdictTemp, effectiveVerdictTemp, supportsTemperature } from "../lib/ai/aiClient";
import { toCsv, downloadCsv } from "../lib/auditCsvExport";
import { foldersConnected, aiReady, runScratch, judgeVsBenchmark, type ScratchRunOutput, type ScratchLiveEvent } from "../lib/calibrationRunner";
import {
  consistencyAgreement, consistencySummary, bandStabilityLabel, gapVariationLabel, formatRunOn,
  spliceRetryIntoConsistencyResult,
  abWinner, abVerdictLine, abOverallTally,
  type ConsistencyLine, type ConsistencyTestResult, type ABTestResult, type ABPathOutcome,
} from "../lib/calibrationTesting";
import { OVERFITTING_CAUTION, recommendFromConsistency, recommendFromAB, type Recommendation } from "../lib/tuningAdvisor";
import { ConsistencyHeatChart, ABHeadToHeadChart, ABWinPatternChart } from "../components/ui/calibrationCharts";
import { RunDetailColumns } from "../components/ui/RunDetailColumns";
import type { AuditFileRecord, EvidenceLineRunStatus, EvidenceRunLogLine, EvidenceRunIssue } from "../types";

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
  const allAfis = useBenchmarkAfiStore((s) => s.entries);
  return useMemo(() => {
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
  }, [testedMap, allAfis]);
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
  const addConsistencyTest = useCalibrationStore((s) => s.addConsistencyTest);
  const updateConsistencyTest = useCalibrationStore((s) => s.updateConsistencyTest);
  const deleteConsistencyTest = useCalibrationStore((s) => s.deleteConsistencyTest);
  const clearConsistencyTests = useCalibrationStore((s) => s.clearConsistencyTests);
  const verdictTemperature = useAISettingsStore((s) => verdictTemp(s));
  const aiModel = useAISettingsStore((s) => s.model || "gpt-5-mini");
  const modelIgnoresTemp = !supportsTemperature(aiModel);
  // useSubCritInfo wants ONE {runAt} per sub-criterion (for the picker
  // label/coverage line) — reduce the history to its newest entry.
  const latestPerSub = useMemo(() => Object.fromEntries(Object.entries(tests).map(([k, v]) => [k, v[0]])), [tests]);
  const infos = useSubCritInfo(latestPerSub);
  const [selectedId, setSelectedId] = useState("");
  const [path, setPath] = useState<"A" | "B">("B");
  const [runs, setRuns] = useState(3);
  const [running, setRunning] = useState<{ headline: string; stage: string; startedAt: number } | null>(null);
  // "Run 1 ✓, run 2 ✗, run 3 in progress" — kept visible for the WHOLE
  // in-flight test, not lost once the sequence moves past a given run.
  const [runStatuses, setRunStatuses] = useState<("pending" | "ok" | "failed")[]>([]);
  // Live three-column detail view (percentage ring / lines / files / log) —
  // Option A only, since Option B's staged passes have no onEvent stream to
  // drive it from (see runScratchB's comment in calibrationRunner.ts).
  const [liveA, setLiveA] = useState<LiveRunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = infos.find((i) => i.id === selectedId);
  const savedList = selectedId ? (tests[selectedId] ?? []) : [];
  const saved = savedList[0]; // newest — drives the heat chart + Tuning Advisor

  async function runTest(subCriterionId: string, testPath: "A" | "B", n: number) {
    setError(null);
    const offline = aiReady();
    if (offline) { setError(offline); return; }
    if (!foldersConnected(subCriterionId)) { setError("Folders not connected for this sub-criterion."); return; }
    const abort = new AbortController();
    abortRef.current = abort;
    const startedAt = Date.now();
    const outputs: (ScratchRunOutput | null)[] = [];
    const runErrors: Record<number, string> = {};
    const runDiags: Record<number, string[]> = {};
    setRunStatuses(Array.from({ length: n }, () => "pending"));
    setLiveA(testPath === "A" ? emptyLiveState() : null);
    try {
      for (let i = 0; i < n; i++) {
        if (abort.signal.aborted) break;
        setRunning({ headline: `Run ${i + 1} of ${n} (Option ${testPath})`, stage: "Starting…", startedAt });
        if (testPath === "A") setLiveA(emptyLiveState());
        const out = await runScratch(testPath, subCriterionId, abort.signal, (stage) =>
          setRunning({ headline: `Run ${i + 1} of ${n} (Option ${testPath})`, stage, startedAt }),
          undefined,
          testPath === "A" ? (ev) => setLiveA((prev) => applyScratchLiveEvent(prev ?? emptyLiveState(), ev)) : undefined);
        // Keep the failed run's REAL error — it used to be discarded here,
        // leaving a bare ✗ nobody could diagnose or act on.
        if (out.ok) outputs.push(out);
        else { outputs.push(null); runErrors[i + 1] = out.error || "Run failed with no error message."; }
        if (out.diagnostics?.length) runDiags[i + 1] = out.diagnostics;
        setRunStatuses((prev) => prev.map((s, idx) => (idx === i ? (out.ok ? "ok" : "failed") : s)));
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
        id: `${subCriterionId}-${startedAt}`,
        subCriterionId, path: testPath, runs: outputs.length, runAt: new Date().toISOString(),
        temperature: verdictTemp(useAISettingsStore.getState()),
        // The HONEST temperature: null when the model ignores the dial.
        effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()),
        // Scratch runs now assemble production-identical prompts (labParity).
        pipelineParity: true,
        // Which Analysis model produced these runs — without this, two
        // measurements taken across a model switch cannot be attributed
        // (the exact gap the Phase-1-vs-Phase-2 comparison hit).
        model: useAISettingsStore.getState().model || "gpt-5-mini",
        lines, bands, gapCounts, failedRuns,
        failedRunErrors: Object.keys(runErrors).length > 0 ? runErrors : undefined,
        runDiagnostics: Object.keys(runDiags).length > 0 ? runDiags : undefined,
        agreementPct,
        summary: consistencySummary(agreementPct, bands, gapCounts, failedRuns, outputs.length),
      };
      // A brand-new test run always ADDS a history entry — running a new
      // test on an already-tested sub-criterion used to silently overwrite
      // the previous result, destroying the before/after comparison this
      // whole measurement exercise depends on.
      addConsistencyTest(result);
      setSelectedId(subCriterionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
      setLiveA(null);
      abortRef.current = null;
    }
  }

  // Retry ONE failed run and splice its column back into the saved result —
  // a transient failure (Drive token expiry, rate-limit burst) shouldn't
  // force re-paying for the whole N-run test. A retry that fails again
  // updates the stored reason; the run stays marked failed, never blank.
  async function retryRun(t: ConsistencyTestResult, runNumber: number) {
    setError(null);
    const offline = aiReady();
    if (offline) { setError(offline); return; }
    if (!foldersConnected(t.subCriterionId)) { setError("Folders not connected for this sub-criterion."); return; }
    const abort = new AbortController();
    abortRef.current = abort;
    const startedAt = Date.now();
    setLiveA(t.path === "A" ? emptyLiveState() : null);
    try {
      setRunning({ headline: `Retrying run ${runNumber} of ${t.runs} (Option ${t.path})`, stage: "Starting…", startedAt });
      const out = await runScratch(t.path, t.subCriterionId, abort.signal, (stage) =>
        setRunning({ headline: `Retrying run ${runNumber} of ${t.runs} (Option ${t.path})`, stage, startedAt }),
        undefined,
        t.path === "A" ? (ev) => setLiveA((prev) => applyScratchLiveEvent(prev ?? emptyLiveState(), ev)) : undefined);
      updateConsistencyTest(spliceRetryIntoConsistencyResult(t, runNumber, { ...out, diagnostics: out.diagnostics }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
      setLiveA(null);
      abortRef.current = null;
    }
  }

  function exportCsv() {
    const all = Object.values(tests).flat();
    const maxRuns = Math.max(1, ...all.map((t) => t.runs));
    const rows = all.flatMap((t) =>
      t.lines.map((l) => [
        t.subCriterionId, t.path, t.runAt, formatRunOn(t.runAt), t.temperature ?? "", t.model ?? "not recorded", t.runs, t.agreementPct ?? "",
        t.bands.map((b) => b ?? "failed").join(" | "), t.gapCounts.map((c) => c ?? "failed").join(" | "),
        l.ref, l.text,
        ...l.verdicts.map((v) => v ?? "no verdict"),
        t.failedRuns.map((n) => `run ${n}: ${t.failedRunErrors?.[n] ?? "reason not recorded"}`).join(" | "),
        // Reasoning per run, so the drill-in detail travels to the CSV too.
        ...Array.from({ length: maxRuns }, (_, i) => l.details?.[i]?.note ?? ""),
      ])
    );
    downloadCsv(
      toCsv([
        "Sub-criterion", "Path", "Run on (ISO)", "Run on", "Temperature", "Model", "Runs", "Agreement %", "Band estimates", "Gap counts", "Line ref", "Requirement",
        ...Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1} verdict`),
        "Failed run reasons",
        ...Array.from({ length: maxRuns }, (_, i) => `Run ${i + 1} reasoning`),
      ], rows),
      `gd4-consistency-tests-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const anyTests = Object.values(tests).some((arr) => arr.length > 0);
  const totalTests = Object.values(tests).reduce((n, arr) => n + arr.length, 0);

  return (
    <>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Consistency check — does the same path give the same result?</h3>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 10px" }}>
          Runs ONE path N times on the same connected folders and scores how often the per-line verdicts agree.
          High agreement = reliable; low = the path gives inconsistent answers on identical input. Scratch runs only —
          your real audit results are not touched. Any connected sub-criterion works (repeatability needs no benchmark truth).
          Every run you make is kept as its own history entry, newest first — nothing is overwritten.
        </p>
        <CoverageLine label="consistency-tested" infos={infos} testedMap={latestPerSub} />
        {modelIgnoresTemp ? (
          <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
            ⚠ The selected model (<b>{aiModel}</b>) ignores the temperature setting — verdict variation on this model comes from the model itself, and the Settings dial cannot reduce it. New test records store this honestly ("temp n/a").
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: "#3730a3", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
            Verdict temperature now in effect: <b>{verdictTemperature.toFixed(2)}</b>. Inconsistent results? <Link to="/settings" style={{ color: "#4338ca", fontWeight: 600 }}>Lower the temperature in Settings</Link>, then re-run this test.
          </div>
        )}
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
            {running ? "Running…" : savedList.length > 0 ? `Run another test (${runs} runs)` : `Run test (${runs} runs)`}
          </button>
          {anyTests && (
            <>
              <button onClick={exportCsv} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>Export CSV</button>
              <button
                onClick={() => { if (confirm(`Clear all ${totalTests} consistency test result(s)? This deletes only these measurement records — your real audit results are not affected. This cannot be undone.`)) clearConsistencyTests(); }}
                style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}
              >
                Clear all results
              </button>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#b45309", marginBottom: 6 }}>⚠ Real AI calls: cost ≈ {runs} × a normal run. Tokens are logged in the AI Review Log as usual.</div>
        <PrereqNotice selected={selected} />
        {running && (
          <>
            {runStatuses.length > 1 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                {runStatuses.map((s, i) => (
                  <span key={i} style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999,
                    color: s === "ok" ? "#15803d" : s === "failed" ? "#b91c1c" : "#4338ca",
                    background: s === "ok" ? "#dcfce7" : s === "failed" ? "#fee2e2" : "#eef2ff",
                  }}>
                    Run {i + 1} {s === "ok" ? "✓" : s === "failed" ? "✗" : "…"}
                  </span>
                ))}
              </div>
            )}
            {liveA ? (
              <RunDetailColumns {...liveViewProps(liveA, () => abortRef.current?.abort())} />
            ) : (
              <RunProgress headline={running.headline} stage={running.stage} startedAt={running.startedAt} onCancel={() => abortRef.current?.abort()} />
            )}
          </>
        )}
        {error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
      </Card>

      {/* Every history entry for the selected sub-criterion, newest first —
          each independently viewable/retryable/deletable. The heat chart and
          Tuning Advisor track the newest entry only. */}
      {savedList.map((t, i) => (
        <ConsistencyResult key={t.id} result={t} onDelete={() => deleteConsistencyTest(t.subCriterionId, t.id)} onRetryRun={(n) => retryRun(t, n)} retryDisabled={!!running} isLatest={i === 0} />
      ))}
      {saved && <Card><ConsistencyHeatChart result={saved} /></Card>}
      {saved && <RecommendationsPanel source="consistency" recommendations={recommendFromConsistency(saved)} />}

      {/* Past tests on other sub-criteria stay reviewable + individually re-runnable + deletable. */}
      {Object.values(tests).flat().filter((t) => t.subCriterionId !== selectedId).sort((a, b) => b.runAt.localeCompare(a.runAt)).map((t) => (
        <Card key={t.id} style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ fontSize: 12.5 }}>{t.subCriterionId}</b>
            <Pill s="neutral">Option {t.path} × {t.runs}</Pill>
            <span style={{ fontSize: 12, color: "#475569", flex: 1 }}>{t.summary}</span>
            <TempLabel t={t} />
            <ModelLabel t={t} />
            <LegacyRecordBadge t={t} />
            <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Run on {formatRunOn(t.runAt)}</span>
            <button onClick={() => setSelectedId(t.subCriterionId)} style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>View</button>
            <button disabled={!!running} onClick={() => { setSelectedId(t.subCriterionId); setPath(t.path); runTest(t.subCriterionId, t.path, t.runs); }} style={{ cursor: running ? "not-allowed" : "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 600 }}>Re-run</button>
            <button onClick={() => { if (confirm(`Delete this consistency test for ${t.subCriterionId} (run on ${formatRunOn(t.runAt)})? Only this measurement record is removed — audit results are untouched.`)) deleteConsistencyTest(t.subCriterionId, t.id); }} title="Delete this test record" style={{ cursor: "pointer", fontSize: 11.5, padding: "3px 9px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c" }}>Delete</button>
          </div>
        </Card>
      ))}
    </>
  );
}

// ── Live-run view for Option A Consistency runs ──────────────────────────
// Reduces calibrationRunner's ScratchLiveEvent stream into the SAME
// RunDetailColumns component the Evidence tab's EvidenceRunPanel and the
// PPD tab's PpdRunPanel use for a real run — so a Consistency test run
// (including a failure) is visible AS IT HAPPENS, not reconstructed
// afterward from stored error text. Deliberately a plain object + pure
// reducer (not a store) — this view is scratch/ephemeral, gone the moment
// the run ends, matching the GUARANTEE at the top of calibrationRunner.ts.
type LiveRunState = {
  phase: "policy" | "evidence";
  detail: string;
  stage: "reading" | "assessing";
  startedAt: number;
  heartbeatAt: number;
  window?: { current: number; total: number };
  filesTotal?: number;
  filesFound: AuditFileRecord[];
  currentFile?: string;
  currentWindowFiles?: string[];
  lineRefs: string[];
  lineStatus: Record<string, EvidenceLineRunStatus>;
  lineVerdict: Record<string, string>;
  log: EvidenceRunLogLine[];
  ai: { calls: number; model?: string; totalTokens: number };
  lastIssue?: EvidenceRunIssue;
};
const LIVE_LOG_CAP = 200;

function emptyLiveState(): LiveRunState {
  const now = Date.now();
  return { phase: "policy", detail: "Starting…", stage: "reading", startedAt: now, heartbeatAt: now, filesFound: [], lineRefs: [], lineStatus: {}, lineVerdict: {}, log: [], ai: { calls: 0, totalTokens: 0 } };
}

function applyScratchLiveEvent(prev: LiveRunState, ev: ScratchLiveEvent): LiveRunState {
  const heartbeatAt = Date.now();
  if (ev.type === "files") {
    return { ...prev, phase: ev.phase, stage: "reading", filesFound: ev.files, filesTotal: ev.filesTotal, detail: `Reading ${ev.phase === "policy" ? "Policy & Procedure" : "Actual Evidence"} files…`, heartbeatAt };
  }
  if (ev.type === "file-progress") {
    return { ...prev, phase: ev.phase, filesFound: ev.files, currentFile: ev.currentFile, detail: ev.currentFile ? `Reading ${ev.currentFile}…` : prev.detail, heartbeatAt };
  }
  if (ev.type === "usage") {
    return { ...prev, ai: { calls: prev.ai.calls + 1, model: ev.model, totalTokens: prev.ai.totalTokens + ev.totalTokens }, heartbeatAt };
  }
  // ppd-event / evidence-event
  const phase = ev.type === "ppd-event" ? "policy" : "evidence";
  const inner = ev.ev;
  const passLabel = inner.type !== "batch-done" && inner.stage === "extract" ? "Extracting passages" : "Judging verdicts";
  if (inner.type === "window-start") {
    const lineRefs = [...new Set([...prev.lineRefs, ...inner.refs])];
    const lineStatus = { ...prev.lineStatus };
    for (const r of inner.refs) if (lineStatus[r] !== "done") lineStatus[r] = "assessing";
    const winLabel = `window ${inner.window.current}/${inner.window.total}`;
    return {
      ...prev, phase, stage: "assessing", window: inner.window, lineRefs, lineStatus,
      currentWindowFiles: ev.windowFiles,
      detail: `${passLabel} — ${winLabel}`,
      log: [...prev.log, { at: heartbeatAt, text: `${phase === "policy" ? "PPD" : "Evidence"} ${inner.stage}: ${winLabel} (${inner.refs.length} line${inner.refs.length === 1 ? "" : "s"})…`, tone: "info" as const }].slice(-LIVE_LOG_CAP),
      heartbeatAt,
    };
  }
  if (inner.type === "batch-done") {
    const lineStatus = { ...prev.lineStatus }, lineVerdict = { ...prev.lineVerdict };
    for (const v of inner.verdicts) { lineStatus[v.ref] = "done"; lineVerdict[v.ref] = v.verdict; }
    return {
      ...prev, phase, lineStatus, lineVerdict,
      log: [...prev.log, ...inner.verdicts.map((v) => ({ at: heartbeatAt, text: `Judged ${v.ref} → ${v.verdict}`, tone: (v.verdict === "Met" || v.verdict === "Adequate" ? "good" : v.verdict === "Not met" || v.verdict === "Not documented" ? "bad" : "warn") as "good" | "bad" | "warn" }))].slice(-LIVE_LOG_CAP),
      heartbeatAt,
    };
  }
  // batch-failed
  return {
    ...prev, phase,
    lastIssue: { at: heartbeatAt, kind: "call-error", message: inner.error },
    log: [...prev.log, { at: heartbeatAt, text: `FAILED (${inner.stage}): ${inner.error}${ev.windowFiles.length > 0 ? ` — files: ${ev.windowFiles.join(", ")}` : ""}`, tone: "bad" as const }].slice(-LIVE_LOG_CAP),
    heartbeatAt,
  };
}

function liveViewProps(p: LiveRunState, onCancel: () => void) {
  const doneCount = p.lineRefs.filter((r) => p.lineStatus[r] === "done").length;
  const pct = p.stage === "reading" ? 8 : p.lineRefs.length > 0 ? Math.round((doneCount / p.lineRefs.length) * 85) + 10 : 40;
  return {
    pct,
    stageLabel: `${p.phase === "policy" ? "PPD Review" : "Evidence Assessment"} — ${p.stage === "reading" ? "Reading files" : "Assessing"}`,
    windowLabel: p.window && p.window.total > 1 ? `window ${p.window.current} of ${p.window.total}` : undefined,
    detail: p.detail,
    startedAt: p.startedAt,
    heartbeatAt: p.heartbeatAt,
    lineRefs: p.lineRefs,
    lineStatus: p.lineStatus,
    lineVerdict: p.lineVerdict,
    filesFound: p.filesFound,
    filesReadCount: p.filesFound.filter((f) => f.readStatus === "read").length,
    filesTotal: p.filesTotal,
    isReadingStage: p.stage === "reading",
    currentFile: p.currentFile,
    currentWindowFiles: p.currentWindowFiles,
    ai: p.ai,
    log: p.log,
    onCancel,
    lastIssue: p.lastIssue,
  };
}

// Honest temperature chip for a saved measurement record: shows the value
// actually in effect; "n/a" when the model ignored the dial; and for LEGACY
// records (no effectiveTemperature stored) the old dial value with a warning
// that it was recorded under the old, incorrect assumption.
function TempLabel({ t }: { t: { temperature?: number; effectiveTemperature?: number | null } }) {
  if (t.effectiveTemperature === null) return <span style={{ fontSize: 11, color: "#92400e", whiteSpace: "nowrap" }}>temp n/a (model ignores it)</span>;
  if (typeof t.effectiveTemperature === "number") return <span style={{ fontSize: 11, color: "#4338ca", whiteSpace: "nowrap" }}>temp {t.effectiveTemperature.toFixed(2)}</span>;
  if (t.temperature != null) return <span title="Recorded before the app checked whether the model honours temperature — the value shown is the dial setting, which may not have been in effect." style={{ fontSize: 11, color: "#b45309", whiteSpace: "nowrap" }}>temp {t.temperature.toFixed(2)}?</span>;
  return null;
}

// Which Analysis model produced this record. A number without its model is
// unattributable across a model switch — exactly what made the Phase-1 vs
// post-Phase-2 regression impossible to pin down from the stored records.
function ModelLabel({ t }: { t: { model?: string } }) {
  if (t.model) return <span style={{ fontSize: 11, color: "#4338ca", whiteSpace: "nowrap" }}>· {t.model}</span>;
  return (
    <span
      title="Recorded before the Lab stored which Analysis model ran the test — if the model changed since, this number cannot be attributed to either model. Re-run to refresh."
      style={{ fontSize: 11, color: "#b45309", whiteSpace: "nowrap" }}
    >
      · model not recorded
    </span>
  );
}

// Flags measurement records from before the Lab assembled production-identical
// prompts (no memories/calibration were injected back then) — those numbers
// measured a DIFFERENT pipeline and must not be compared against new runs.
function LegacyRecordBadge({ t }: { t: { pipelineParity?: boolean } }) {
  if (t.pipelineParity) return null;
  return (
    <span
      title="Measured before the Lab used production-identical prompt assembly (no calibration memories/examples were injected, and the recorded temperature may not have been in effect). Not comparable with new test results — re-run to refresh."
      style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}
    >
      ⚠ pre-parity run
    </span>
  );
}

// Per-call diagnostics for one run — model + which pass (extract/judge) +
// which file(s), or a plain list when only the coarse windowErrors text was
// captured (Option B, which has no per-file event stream). Collapsed by
// default since a run can carry several entries.
function RunDiagnosticsDetail({ entries }: { entries?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) return null;
  return (
    <div style={{ fontSize: 11 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", color: "#475569" }}>
        {open ? "▾" : "▸"} {entries.length} diagnostic{entries.length === 1 ? "" : "s"} (model, pass, file)
      </button>
      {open && (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2, fontFamily: "ui-monospace,monospace", color: "#475569", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px" }}>
          {entries.map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}
    </div>
  );
}

function ConsistencyResult({ result, onDelete, onRetryRun, retryDisabled, isLatest }: { result: ConsistencyTestResult; onDelete: () => void; onRetryRun?: (runNumber: number) => void; retryDisabled?: boolean; isLatest?: boolean }) {
  const disagreeing = result.lines.filter((l) => {
    const vs = l.verdicts.filter((v): v is string => v != null);
    return vs.length >= 2 && !vs.every((v) => v === vs[0]);
  }).length;
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Consistency — {result.subCriterionId} · Option {result.path} × {result.runs}</h3>
        {isLatest && <Pill s="progress">Latest</Pill>}
        <TempLabel t={result} />
        <ModelLabel t={result} />
        <LegacyRecordBadge t={result} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 9px" }}>Run on {formatRunOn(result.runAt)}</span>
        <button onClick={onDelete} title="Delete this test record (scratch only — audit results untouched)" style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11.5, padding: "3px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontWeight: 600 }}>Delete</button>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: result.agreementPct != null && result.agreementPct < 75 ? "#b45309" : "#15803d", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
        {result.summary}
      </div>
      {/* Failed runs: the REAL reason per run (actionable), plus a one-run
          retry so a transient failure doesn't cost a full re-test. Records
          from before reason-capture say so instead of showing nothing. Each
          failure also carries its full per-call diagnostics (model + pass +
          file), when captured — the exact detail a whole-run "gpt-5-mini on
          6.1" failure needs to be diagnosable instead of a bare reason. */}
      {result.failedRuns.length > 0 && (
        <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {result.failedRuns.map((n) => (
            <div key={n} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 240 }}>
                  ✗ <b>Run {n} failed:</b> {result.failedRunErrors?.[n] ?? "reason not recorded — this test pre-dates failure-reason capture; retry the run to get a diagnosable result."}
                </span>
                {onRetryRun && (
                  <button
                    disabled={retryDisabled}
                    onClick={() => onRetryRun(n)}
                    title={`Re-run ONLY run ${n} (one real AI run) and splice the result back into this test.`}
                    style={{ cursor: retryDisabled ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: "1px solid #f59e0b", background: "#fff7ed", color: "#92400e", whiteSpace: "nowrap", opacity: retryDisabled ? 0.5 : 1 }}
                  >
                    ↻ Retry run {n}
                  </button>
                )}
              </div>
              <RunDiagnosticsDetail entries={result.runDiagnostics?.[n]} />
            </div>
          ))}
        </div>
      )}
      {/* A run can be recorded "ok" (it produced a result) yet still have
          per-call diagnostics — every underlying AI call failed and every
          line came back unassessed, which used to be silently
          indistinguishable from a clean run. Surface those runs too. */}
      {Object.entries(result.runDiagnostics ?? {}).filter(([n]) => !result.failedRuns.includes(Number(n))).length > 0 && (
        <div style={{ fontSize: 12, color: "#1e3a8a", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 11px", marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(result.runDiagnostics ?? {}).filter(([n]) => !result.failedRuns.includes(Number(n))).map(([n, entries]) => (
            <div key={n} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>ⓘ <b>Run {n} completed but had partial call failures</b> — some lines may show "no verdict" as a result:</span>
              <RunDiagnosticsDetail entries={entries} />
            </div>
          ))}
        </div>
      )}
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
          <td key={i} title={v ? undefined : "No verdict for this line in this run — the run failed, or this line's AI call failed (Not assessed). Excluded from the agreement score."} style={{ padding: "5px 8px", fontWeight: 600, color: v ? STATUS_COLOR[v] ?? "#374151" : "#94a3b8", whiteSpace: "nowrap" }}>{v ?? "no verdict"}</td>
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
      const allAfis = useBenchmarkAfiStore.getState().entries;
      const benchmarkCount = allAfis.filter((x) => x.subCriterion === subCriterionId && x.kind === "AFI").length;
      const patterns = [...new Set(allAfis.filter((x) => x.subCriterion === subCriterionId && x.kind === "AFI").map((x) => x.findingPattern))];
      const result: ABTestResult = {
        subCriterionId, runAt: new Date().toISOString(), temperature: verdictTemp(useAISettingsStore.getState()),
        effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()), pipelineParity: true,
        model: useAISettingsStore.getState().model || "gpt-5-mini",
        benchmarkCount, patterns, a, b,
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
  const allAfis = useBenchmarkAfiStore((s) => s.entries);
  const realAFIs = allAfis.filter((a) => a.subCriterion === result.subCriterionId && a.kind === "AFI");
  const [drill, setDrill] = useState(false);
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>A vs B — {result.subCriterionId}</h3>
        <TempLabel t={result} />
        <ModelLabel t={result} />
        <LegacyRecordBadge t={result} />
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
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 3 }}>{label} — <span style={{ color: ln?.status ? STATUS_COLOR[ln.status] ?? "#374151" : "#94a3b8" }}>{ln?.status ?? "no verdict"}</span></div>
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
