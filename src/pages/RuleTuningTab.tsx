// AI Calibration → Rule Tuning tab. Edit the SAFE, bounded rules layer
// (Met/Partial decision guidance + per-criterion notes), save as versions,
// test the effect (consistency AND benchmark), and revert/champion — all
// without touching code or the protected core prompt.

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { BENCHMARK_AFIS } from "../data/benchmarkAFIs";
import { useRuleTuningStore } from "../store/useRuleTuningStore";
import { foldersConnected, aiReady, runScratch, judgeVsBenchmark } from "../lib/calibrationRunner";
import { consistencyAgreement } from "../lib/calibrationTesting";
import {
  CRITERION_IDS, CRITERION_LABELS, buildRuleInjection, scoreCompareText, isWorseThanChampion,
  RULE_OVERFITTING_CAUTION, type RuleContent, type RuleVersion,
} from "../lib/ruleTuning";

const TA: React.CSSProperties = { width: "100%", minHeight: 80, fontSize: 12.5, padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 7, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 };

function scoreChips(v: RuleVersion) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: v.consistencyPct != null ? "#15803d" : "#94a3b8" }}>consistency {v.consistencyPct != null ? `${v.consistencyPct}%` : "—"}</span>
      <span style={{ fontSize: 11, color: v.benchmarkCaught != null ? "#4338ca" : "#94a3b8" }}>benchmark {v.benchmarkCaught != null ? `${v.benchmarkCaught}/${v.benchmarkTotal} caught` : "—"}</span>
    </span>
  );
}

export function RuleTuningTab() {
  const versions = useRuleTuningStore((s) => s.versions);
  const activeVersionId = useRuleTuningStore((s) => s.activeVersionId);
  const championVersionId = useRuleTuningStore((s) => s.championVersionId);
  const changeLog = useRuleTuningStore((s) => s.changeLog);
  const saveVersion = useRuleTuningStore((s) => s.saveVersion);
  const revertTo = useRuleTuningStore((s) => s.revertTo);
  const setChampion = useRuleTuningStore((s) => s.setChampion);
  const setActive = useRuleTuningStore((s) => s.setActive);
  const recordConsistency = useRuleTuningStore((s) => s.recordConsistency);
  const recordBenchmark = useRuleTuningStore((s) => s.recordBenchmark);

  const active = versions.find((v) => v.id === activeVersionId) ?? versions[0];
  const champion = versions.find((v) => v.id === championVersionId);

  // Editor working copy (seeded from the active version).
  const [draft, setDraft] = useState<RuleContent>(active.content);
  const [seededFor, setSeededFor] = useState(activeVersionId);
  if (seededFor !== activeVersionId) { setDraft(active.content); setSeededFor(activeVersionId); }
  const [label, setLabel] = useState("");
  const [critTab, setCritTab] = useState("6");
  const [savedId, setSavedId] = useState<string | null>(null); // offer-to-test banner
  const [testSub, setTestSub] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(active.content);
  const injectionPreview = buildRuleInjection(draft, critTab);
  const globalPreview = buildRuleInjection(draft);

  const setMetGlobal = (v: string) => setDraft((d) => ({ ...d, metPartial: v }));
  const setMetCrit = (c: string, v: string) => setDraft((d) => ({ ...d, perCriterionMetPartial: { ...d.perCriterionMetPartial, [c]: v } }));
  const setGuideCrit = (c: string, v: string) => setDraft((d) => ({ ...d, perCriterionGuidance: { ...d.perCriterionGuidance, [c]: v } }));

  function save() {
    const id = saveVersion(draft, label);
    setLabel("");
    setSavedId(id);
  }

  // Connected sub-criteria that have benchmark truth (best test targets).
  const benchmarkSubs = useMemo(() => {
    const withTruth = [...new Set(BENCHMARK_AFIS.filter((a) => a.kind === "AFI").map((a) => a.subCriterion))];
    return withTruth.map((sc) => ({ id: sc, title: GD4_SUB_CRITERIA.find((s) => s.id === sc)?.title ?? sc, connected: foldersConnected(sc) }));
  }, []);

  async function testConsistency(versionId: string, subCriterionId: string, runs = 3) {
    const offline = aiReady(); if (offline) { setBusy(null); alert(offline); return; }
    if (!foldersConnected(subCriterionId)) { alert("Connect this sub-criterion's folders first (Evidence Folder page)."); return; }
    const abort = new AbortController(); abortRef.current = abort;
    const injection = useRuleTuningStore.getState().activeInjection(subCriterionId);
    try {
      const outs = [];
      for (let i = 0; i < runs; i++) {
        if (abort.signal.aborted) break;
        setBusy(`Consistency run ${i + 1}/${runs}…`);
        const o = await runScratch("B", subCriterionId, abort.signal, (st) => setBusy(`Consistency run ${i + 1}/${runs} — ${st}`), injection);
        outs.push(o.ok ? o : null);
      }
      const refs = new Set<string>(); const lines: { ref: string; verdicts: (string | null)[] }[] = [];
      for (const o of outs) if (o) for (const l of o.lines) if (!refs.has(l.ref)) { refs.add(l.ref); lines.push({ ref: l.ref, verdicts: outs.map((x) => x?.lines.find((y) => y.ref === l.ref)?.status ?? null) }); }
      const { agreementPct } = consistencyAgreement(lines.map((l) => ({ ref: l.ref, text: l.ref, verdicts: l.verdicts })));
      recordConsistency(versionId, agreementPct);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); abortRef.current = null; }
  }

  async function testBenchmark(versionId: string) {
    const offline = aiReady(); if (offline) { alert(offline); return; }
    const targets = benchmarkSubs.filter((s) => s.connected);
    if (targets.length === 0) { alert("No benchmark sub-criteria have connected folders. Connect at least one on the Evidence Folder page."); return; }
    const abort = new AbortController(); abortRef.current = abort;
    let caught = 0, total = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const sc = targets[i].id;
        if (abort.signal.aborted) break;
        setBusy(`Benchmark ${i + 1}/${targets.length}: ${sc}…`);
        const injection = useRuleTuningStore.getState().activeInjection(sc);
        const o = await runScratch("B", sc, abort.signal, (st) => setBusy(`Benchmark ${i + 1}/${targets.length}: ${sc} — ${st}`), injection);
        if (!o.ok) continue;
        const j = await judgeVsBenchmark(sc, o.digest, abort.signal);
        if (j.judged) { caught += j.caught; total += BENCHMARK_AFIS.filter((a) => a.subCriterion === sc && a.kind === "AFI").length; }
      }
      if (total > 0) recordBenchmark(versionId, caught, total);
      else alert("No benchmark verdicts could be judged (folders/AI unavailable).");
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); abortRef.current = null; }
  }

  function promoteChampion(v: RuleVersion) {
    if (champion && v.id !== champion.id && isWorseThanChampion(v, champion)) {
      if (!confirm(`"${v.label || v.id}" scored LOWER than your current champion (${scoreCompareText(v, champion)}). Promote it anyway?`)) return;
    }
    setChampion(v.id);
  }

  function revert(v: RuleVersion) {
    if (champion && isWorseThanChampion(v, champion)) {
      if (!confirm(`This version scored lower than your champion (${scoreCompareText(v, champion)}). Make it active anyway? (Your champion stays live for real audits.)`)) return;
    }
    revertTo(v.id);
  }

  return (
    <>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Rule Tuning — adjust the assessment rules, test, revert if worse</h3>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 8px" }}>
          Edit only the bounded rules below; they are injected into the assessment prompts at a fixed point. The core
          instructions, output format, citation and safety rules are protected and not editable here — and on any conflict,
          the core rules always win. Your <b>Champion</b> version is what runs real audits; edit and test freely on other versions.
        </p>
        <div style={{ fontSize: 11.5, color: "#3730a3", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
          Editing version: <b>{active.label || active.id.slice(0, 10)}</b>{active.id === championVersionId ? " ★ (this is the Champion)" : ""}. Saving creates a NEW version — nothing is overwritten or lost.
        </div>

        {/* Global Met/Partial rule */}
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#374151" }}>Met / Partial / Not-met decision rule (global — all criteria)</span>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 3 }}>Extra threshold guidance for when a line is Met vs Partial vs Not met. Leave blank to use only the built-in rule.</div>
          <textarea value={draft.metPartial} onChange={(e) => setMetGlobal(e.target.value)} placeholder="e.g. Award Met only when EVERY promise is evidenced with a cited record; any single missing part → Partial." style={TA} />
        </label>

        {/* Per-criterion */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Per-criterion rules (optional)</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {CRITERION_IDS.map((c) => (
            <button key={c} onClick={() => setCritTab(c)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 6, border: `1px solid ${critTab === c ? "#4338ca" : "#e2e8f0"}`, background: critTab === c ? "#eef2ff" : "#fff", color: critTab === c ? "#4338ca" : "#64748b" }}>
              C{c}{(draft.perCriterionMetPartial[c]?.trim() || draft.perCriterionGuidance[c]?.trim()) ? " ●" : ""}
            </button>
          ))}
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4338ca", marginBottom: 6 }}>{CRITERION_LABELS[critTab]}</div>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#475569" }}>Met/Partial override for this criterion (used instead of the global rule for C{critTab})</span>
            <textarea value={draft.perCriterionMetPartial[critTab] ?? ""} onChange={(e) => setMetCrit(critTab, e.target.value)} style={{ ...TA, minHeight: 60 }} />
          </label>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#475569" }}>Extra guidance notes for this criterion (added to C{critTab} assessment calls)</span>
            <textarea value={draft.perCriterionGuidance[critTab] ?? ""} onChange={(e) => setGuideCrit(critTab, e.target.value)} style={{ ...TA, minHeight: 60 }} />
          </label>
        </div>

        {/* Injection preview */}
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#4338ca" }}>Preview what gets added to the prompt (Criterion {critTab})</summary>
          <pre style={{ fontSize: 10.5, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px", whiteSpace: "pre-wrap", marginTop: 6, maxHeight: 220, overflowY: "auto" }}>{injectionPreview || globalPreview || "(nothing — the built-in rules are used unchanged)"}</pre>
        </details>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional label (e.g. 'tightened Met rule for 6.3')" style={{ ...inputStyle, flex: 1, minWidth: 240, padding: "6px 9px" }} />
          <button disabled={!dirty} onClick={save} style={{ cursor: dirty ? "pointer" : "not-allowed", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "1px solid #4338ca", background: dirty ? "#4338ca" : "#c7d2fe", color: "#fff" }}>Save as new version</button>
        </div>

        <div style={{ fontSize: 11, color: "#7c2d12", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "7px 10px", marginTop: 10 }}>
          ⚠ Core rules win: injected rules only refine the Met/Partial threshold — they can never override the output format, citation, or safety instructions. {RULE_OVERFITTING_CAUTION}
        </div>
      </Card>

      {/* Offer-to-test banner after a save */}
      {savedId && (
        <Card>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Version saved. Test its effect? <span style={{ fontWeight: 400, color: "#64748b" }}>(optional — a rule can improve consistency but hurt accuracy, so check both)</span></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={testSub} onChange={(e) => setTestSub(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 260, padding: "5px 8px", fontSize: 12.5 }}>
              <option value="">Sub-criterion for the consistency test…</option>
              {benchmarkSubs.map((s) => <option key={s.id} value={s.id}>{s.id} {s.title}{s.connected ? "" : " (not connected)"}</option>)}
            </select>
            <button disabled={!!busy || !testSub} onClick={() => testConsistency(savedId, testSub)} style={{ cursor: busy || !testSub ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: busy || !testSub ? 0.6 : 1 }}>Test consistency</button>
            <button disabled={!!busy} onClick={() => testBenchmark(savedId)} title="Runs Option B on every connected benchmark sub-criterion and judges against the real findings. Cost ≈ one run per connected benchmark sub-criterion." style={{ cursor: busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: busy ? 0.6 : 1 }}>Test against benchmark (accuracy)</button>
            <button onClick={() => setSavedId(null)} style={{ cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>Skip</button>
          </div>
          <div style={{ fontSize: 11, color: "#b45309", marginTop: 6 }}>⚠ Real AI calls — tokens logged in the AI Review Log. Scratch runs only; your real audit results are untouched.</div>
          {busy && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 11px" }}>
              <span style={{ fontSize: 12, color: "#1d4ed8", flex: 1 }}>{busy}</span>
              <button onClick={() => abortRef.current?.abort()} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b23121" }}>Cancel</button>
            </div>
          )}
        </Card>
      )}

      {/* Version history */}
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Version history</h3>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>Each save is a version. Nothing is auto-deleted; the Original is always restorable. ★ = Champion (live for real audits).</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {versions.map((v, i) => {
            const isChampion = v.id === championVersionId;
            const isActive = v.id === activeVersionId;
            const prev = versions[i + 1];
            return (
              <div key={v.id} style={{ border: `1px solid ${isChampion ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 8, padding: "9px 12px", background: isActive ? "#f8fafc" : "#fff" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {isChampion && <span title="Champion — live for real audits" style={{ fontSize: 14 }}>★</span>}
                  <b style={{ fontSize: 12.5 }}>{v.label || (v.isOriginal ? "Original / default" : v.id.slice(0, 12))}</b>
                  {isActive && <Pill s="neutral">editing</Pill>}
                  {isChampion && <Pill s="good">Champion</Pill>}
                  <span style={{ marginLeft: "auto" }}>{scoreChips(v)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                  {v.isOriginal ? "The built-in baseline." : `${new Date(v.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · ${v.changeSummary ?? ""}`}
                  {prev && !v.isOriginal && (v.consistencyPct != null || v.benchmarkCaught != null) && (v.id === activeVersionId || true) && (
                    <span style={{ color: "#4338ca" }}> · vs {prev.label || "previous"}: {scoreCompareText(v, prev)}</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {!isActive && <button onClick={() => setActive(v.id)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Edit this</button>}
                  <button onClick={() => revert(v)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 600 }}>Revert to this</button>
                  {!isChampion && <button onClick={() => promoteChampion(v)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #fcd34d", background: "#fffbeb", color: "#b45309", fontWeight: 600 }}>★ Make Champion</button>}
                  {!busy && <button onClick={() => testConsistency(v.id, testSub || benchmarkSubs.find((s) => s.connected)?.id || "")} disabled={!benchmarkSubs.some((s) => s.connected)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Test consistency</button>}
                  {!busy && <button onClick={() => testBenchmark(v.id)} disabled={!benchmarkSubs.some((s) => s.connected)} style={{ cursor: "pointer", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Test benchmark</button>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Change log */}
      {changeLog.length > 0 && (
        <Card>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Change log</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {changeLog.slice(0, 20).map((e, i) => (
              <div key={i} style={{ fontSize: 11.5, color: "#475569" }}>
                <span style={{ color: "#94a3b8" }}>{new Date(e.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                {" · "}<span style={{ fontWeight: 600, color: e.action === "champion" ? "#b45309" : e.action === "revert" ? "#4338ca" : "#15803d" }}>{e.action}</span>
                {" · "}{e.detail}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11, color: "#64748b" }}>
        Not sure where these rules end up? They are added to the assessment prompt and visible in the{" "}
        <Link to="/ai-debug" style={{ color: "#4338ca", fontWeight: 600 }}>AI Debug Log</Link> under the "TUNABLE ASSESSMENT RULES" block.
      </div>
    </>
  );
}
