import { useEffect, useMemo, useRef, useState } from "react";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { EDUTRUST_BANDS } from "../data/edutrustRubric";
import { runScopesForSub, scopeTitle, itemIdsForScope, folderScopeId } from "../lib/evidenceScope";
import { parseFolderId } from "../lib/drive/driveClient";
import { aiOfflineReason } from "../lib/ai/aiClient";
import { apsrMatrixResult } from "../lib/checklistBanding";
import { downloadCsv } from "../lib/auditCsvExport";
import { printHtmlInNewTab, PRINTABLE_DOC_CSS, POPUP_BLOCKED_MESSAGE } from "../lib/printableDoc";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import {
  toSelfCheckRows, countSelfCheck, mostlyUnchecked, buildSelfCheckCsv, buildSelfCheckHtml,
  selfCheckFilename, describeBlock, plainRunError, plainDetail, planFor, toProcedureRows, PROCEDURE_ONLY_NOTE,
  SELF_CHECK_DISCLAIMER, COULD_NOT_CHECK_NOTE, MOSTLY_UNCHECKED_NOTE,
  type SelfCheckBand,
} from "../lib/selfCheck";

// A one-page self-check for a process owner: pick your area, paste your Drive
// folder, press one button, read the result.
//
// Deliberately rendered OUTSIDE the app Layout (see App.tsx). The workspace
// chrome — four numbered stages, ~30 pages, cycles, calibration, banding setup
// — is right for the audit lead and wrong for someone who owns one area and
// opens this once a year. Outside the Layout they also never meet the
// locked-cycle banner, which is written for an auditor and tells the reader to
// go and unlock the cycle; this page says something they can act on instead.
//
// It runs the EXISTING Option A engine (runPPDReview then runEvidenceAssessment)
// on one scope. There is no second engine, no second prompt set and no second
// scoring path. It commits no band and raises no findings; see selfCheck.ts.

const INK = "#1f2733";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, marginBottom: 16 };
const stepNum: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: INK, color: "#fff", fontSize: 13, fontWeight: 800, flexShrink: 0 };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 700, margin: 0, color: INK };
const muted: React.CSSProperties = { fontSize: 13, color: "#64748b", lineHeight: 1.55 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: 14, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" };
const bigBtn: React.CSSProperties = { border: "none", borderRadius: 10, padding: "13px 26px", fontSize: 15, fontWeight: 800, cursor: "pointer", background: "#7c3aed", color: "#fff" };
const TONE_BG: Record<string, { bg: string; fg: string }> = {
  good: { bg: "#dcfce7", fg: "#166534" },
  medium: { bg: "#fef3c7", fg: "#92400e" },
  critical: { bg: "#fee2e2", fg: "#991b1b" },
  neutral: { bg: "#f1f5f9", fg: "#475569" },
};

type Phase = "idle" | "folder" | "policy" | "records" | "band" | "done" | "stopped" | "failed";

const STEPS: { key: Phase; label: string }[] = [
  { key: "folder", label: "Opening your folder" },
  { key: "policy", label: "Reading what your written procedure says" },
  { key: "records", label: "Checking your records against it" },
  { key: "band", label: "Working out your result" },
];

export function SelfCheck() {
  const folders = useWorkspaceStore((s) => s.folders);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const evProgress = useWorkspaceStore((s) => s.evidenceAssessmentProgress);
  const ppdProgress = useWorkspaceStore((s) => s.ppdReviewProgress);
  const ppdResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const cycleStatus = useWorkspaceStore((s) => s.cycle.status);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const driveToken = useGoogleDriveStore((s) => s.accessToken);
  const driveClientId = useGoogleDriveStore((s) => s.clientId);
  const aiSettings = useAISettingsStore();
  const apsrScale = useScoringConfigStore((s) => s.apsrScale);

  const [scope, setScope] = useState("");
  const [procLink, setProcLink] = useState("");
  const [evLink, setEvLink] = useState("");
  // Which half the result on screen came from. A procedure-only result answers
  // a different question and must never be dressed as a full one.
  const [mode, setMode] = useState<"full" | "procedure-only">("full");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [band, setBand] = useState<SelfCheckBand>({ kind: "none" });
  const [ranAt, setRanAt] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  // Drive reconnect, the same one-shot silent attempt Layout makes on mount.
  // This page renders OUTSIDE Layout, so without this a process owner always
  // met "Drive is not connected" even on a workspace whose server-side refresh
  // token was perfectly good (found by running the page, not by reading it).
  const [connecting, setConnecting] = useState(false);
  const triedConnect = useRef(false);
  const running = phase === "folder" || phase === "policy" || phase === "records" || phase === "band";
  const resultRef = useRef<HTMLDivElement>(null);
  // Stop has to STICK. cancelBusy aborts the engine, but the awaits already in
  // flight still resolve, and without this every continuation below would
  // carry on and overwrite the stopped state with a result (seen happening in
  // the browser, not theorised). Each run captures the generation; a stop
  // bumps it, and every step after an await bails if it no longer matches.
  const generation = useRef(0);

  // Every runnable scope, grouped by criterion, labelled by its own name. 4.2
  // genuinely splits into two separately-run areas, and scopeTitle already
  // names each, so the picker offers what can actually be run rather than a
  // tidier list that would then fail.
  const areas = useMemo(
    () => GD4_SUB_CRITERIA.flatMap((s) =>
      runScopesForSub(s.id).map((sc) => ({ scope: sc, title: scopeTitle(sc), criterionId: s.criterionId, description: s.description }))),
    [],
  );
  const area = areas.find((a) => a.scope === scope);
  const folder = folders.find((f) => folderScopeId(f) === scope);
  const existing = scope ? evidenceAssessments[scope] : undefined;

  useEffect(() => {
    if (!driveClientId || driveToken || triedConnect.current) return;
    triedConnect.current = true;
    setConnecting(true);
    void useGoogleDriveStore.getState().connectSilently().finally(() => setConnecting(false));
  }, [driveClientId, driveToken]);

  const block = describeBlock({
    cycleLocked: cycleStatus === "Locked",
    hasAuditor: auditors.length > 0,
    aiOffline: aiOfflineReason(aiSettings) ?? null,
    driveConnected: !!driveToken,
  });

  const stateOf = (v: string): "empty" | "bad" | "ok" => (!v.trim() ? "empty" : parseFolderId(v) ? "ok" : "bad");
  const procState = stateOf(procLink);
  const evState = stateOf(evLink);
  const plan = planFor(procState === "ok", evState === "ok");
  // A half-typed or mistyped link is not "they left it out" — never offer a
  // procedure-only run while a link they clearly meant to paste is still wrong.
  const ready = !!area && plan.canRun && procState !== "bad" && evState !== "bad" && block.canRun && !running;

  const ppdExisting = scope ? ppdResults[scope] : undefined;
  // What this particular run would actually overwrite. A procedure-only run
  // rewrites the procedure result and leaves the full result alone, so warning
  // about the full one would be a claim about something that will not happen.
  const resultAtRisk = plan.kind === "procedure-only" ? !!ppdExisting : !!existing;

  // The audit lead links this area's folders on the Evidence Folder page, often
  // as two separate subfolder links. One pasted link here replaces both. That
  // is fine when nothing was set, and destructive when something was — so it is
  // asked about, even on an area that has never been run.
  // Per field now: replacing the lead's procedure folder and replacing their
  // records folder are separate losses, and a procedure-only run only touches
  // the first.
  const clashes = [
    folder?.policyLink && folder.policyLink !== procLink.trim() ? "written procedure" : null,
    // A procedure-only run leaves folderLink alone, so it cannot clash.
    plan.kind === "full" && folder?.folderLink && folder.folderLink !== evLink.trim() ? "records" : null,
  ].filter(Boolean) as string[];
  const linkClash = clashes.length > 0;

  const rows = useMemo(
    () => (mode === "procedure-only"
      ? (ppdExisting ? toProcedureRows(ppdExisting.rows) : [])
      : (existing ? toSelfCheckRows(existing.rows) : [])),
    [mode, existing, ppdExisting],
  );
  const counts = useMemo(() => countSelfCheck(rows), [rows]);
  const procedureOnlyResult = mode === "procedure-only";
  const showResult = phase === "done" && rows.length > 0;

  async function run() {
    if (!area || !folder || !ready) return;
    // Never silently replace a result someone else may be relying on. Asked
    // BEFORE the generation is bumped, so a question that ends in "Cancel"
    // cannot mark anything stale.
    if ((resultAtRisk || linkClash) && !confirmOverwrite) { setConfirmOverwrite(true); return; }
    setConfirmOverwrite(false);
    const myGen = ++generation.current;
    const stale = () => generation.current !== myGen;
    setError(null); setNote(null); setBand({ kind: "none" });
    const procedureOnly = plan.kind === "procedure-only";
    setMode(procedureOnly ? "procedure-only" : "full");
    setPhase("folder");

    // Two explicit links, one per bucket. Each pass keeps EVERY file in its own
    // folder only when its own link parses; otherwise it falls back to guessing
    // the bucket from the first path segment, which in a flat folder is just
    // the filename (driveGuard.ts:89-92). Setting both fields removes that
    // guess entirely. Pasting the same folder into both is still fine and is
    // exactly what the old single field did.
    setFolderField(folder.id, "policyLink", procLink.trim());
    // Left untouched on a procedure-only run: the evidence pass is not called,
    // so blanking the lead's records folder would destroy their link for
    // nothing.
    if (!procedureOnly) setFolderField(folder.id, "folderLink", evLink.trim());

    try {
      setPhase("policy");
      await useWorkspaceStore.getState().runPPDReview(area.scope);
      if (stale()) return;
      const ppd = useWorkspaceStore.getState().ppdReviewResults[area.scope];
      if (!ppd || ppd.rows.length === 0) {
        setPhase("failed");
        setError(plainRunError(ppd?.runWarnings?.[0]) ?? "I could not read anything from that folder. Check the link opens the folder for you, and that it has documents in it.");
        return;
      }
      // No records folder: stop here. Calling the evidence pass anyway would
      // make it fall back to the PROCEDURE folder (useWorkspaceStore.ts:2025)
      // and read the procedure as if it were the records; and with genuinely
      // no evidence it returns a deterministic "Not met" on every line
      // (agentRuntime.ts:3468-3475). Either way a process owner would be told
      // something about their records that was never checked.
      if (procedureOnly) {
        setRanAt(new Date().toLocaleString("en-SG"));
        setPhase("done");
        return;
      }

      setPhase("records");
      await useWorkspaceStore.getState().runEvidenceAssessment(area.scope);
      if (stale()) return;
      const ev = useWorkspaceStore.getState().evidenceAssessments[area.scope];
      if (!ev || ev.rows.length === 0) {
        setPhase("failed");
        setError("The check did not finish. Nothing was judged, so there is no result to show. Try running it again.");
        return;
      }

      setPhase("band");
      // The band is read from the EXISTING holistic banding. If your auditor
      // has already set one it is shown as theirs; otherwise the same
      // suggestion engine they use produces an indicative one. Neither is
      // committed here: this page never writes a band.
      const itemIds = itemIdsForScope(area.scope);
      const committed = itemIds.map((id) => checklistEntries[id]?.holisticBand).find((b) => !!b);
      // A run where nothing could be judged has nothing to band. Asking for a
      // suggestion anyway produced "Band 3 — Meeting Expectation" on a result
      // whose every line read "Could not check", which is the most misleading
      // thing this page could say. The auditor's OWN band still shows: that one
      // is a recorded fact about the area, not a reading of this run.
      const judged = ev.rows.some((r) => r.verdict !== "Not assessed");
      if (committed) {
        setBand({ kind: "auditor", band: committed.band, name: bandName(committed.band), totalPct: committed.totalPct });
      } else if (judged) {
        const s = await useChecklistModuleStore.getState().suggestBand(itemIds[0]);
        if (stale()) return;
        // apsrMatrixResult is the app's own band computation (checklistBanding).
        // Called, never reimplemented, and the result is only displayed.
        if (s) {
          const m = apsrMatrixResult(s.dimensionBands, apsrScale);
          setBand({ kind: "indicative", band: m.band, name: bandName(m.band), totalPct: m.total });
        }
      }
      setRanAt(new Date().toLocaleString("en-SG"));
      setPhase("done");
    } catch (e) {
      if (stale()) return;
      setPhase("failed");
      setError(plainRunError(e instanceof Error ? e.message : String(e)) ?? "The check stopped unexpectedly. Try running it again.");
    }
  }

  function stop() {
    generation.current++;   // every continuation of the running check now bails
    useWorkspaceStore.getState().cancelBusy();
    setPhase("stopped");
  }

  function onCsv() {
    if (!area) return;
    downloadCsv(buildSelfCheckCsv(`${area.scope} ${area.title}`, rows, band, procedureOnlyResult), selfCheckFilename(area.title, "csv"));
  }
  function onPdf() {
    if (!area) return;
    const ok = printHtmlInNewTab(
      `<style>${PRINTABLE_DOC_CSS}</style>${buildSelfCheckHtml({
        areaLabel: `${area.scope} ${area.title}`, areaDescription: area.description,
        counts, band, rows, ranAt, procedureOnly: procedureOnlyResult,
      })}`,
      `Self-check ${area.title}`,
    );
    if (!ok) setNote(POPUP_BLOCKED_MESSAGE);
  }

  const liveDetail = plainDetail(evProgress?.detail || ppdProgress?.detail || "");
  const visibleSteps = procedureOnlyResult ? STEPS.filter((s) => s.key !== "records" && s.key !== "band") : STEPS;
  const activeIdx = visibleSteps.findIndex((s) => s.key === phase);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fa", padding: "26px 16px 70px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 25, margin: "0 0 6px", color: INK }}>Check your area before the audit</h1>
          <p style={{ ...muted, margin: 0, fontSize: 14 }}>
            A practice run on your own documents, so you can fix things before the real audit. It takes a few minutes.
          </p>
          <p style={{ ...muted, marginTop: 8, background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>
            {SELF_CHECK_DISCLAIMER}
          </p>
        </header>

        {connecting && !driveToken && (
          <div style={{ ...card, background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <h2 style={{ ...h2, fontSize: 15, color: "#1e40af" }}>Connecting to Google Drive…</h2>
            <p style={{ ...muted, marginBottom: 0 }}>One moment. This usually takes a couple of seconds.</p>
          </div>
        )}

        {!block.canRun && !connecting && (
          <div style={{ ...card, background: "#fff7ed", borderColor: "#fdba74" }}>
            <h2 style={{ ...h2, fontSize: 15, color: "#9a3412" }}>{block.title}</h2>
            <p style={{ ...muted, marginBottom: 0 }}>{block.detail}</p>
            {/* The detail above tells a process owner to ask their audit lead.
                The audit lead hits the same banner, and had nothing to click.
                Plain anchor, not a router Link: this page renders outside the
                Layout, and the target is inside it. */}
            {block.fixPath && (
              <a href={block.fixPath} style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 700, color: "#1d4ed8" }}>
                {block.fixLabel} →
              </a>
            )}
            {!driveToken && cycleStatus !== "Locked" && auditors.length > 0 && !aiOfflineReason(aiSettings) && driveClientId && (
              <button type="button" style={{ ...bigBtn, background: "#2563eb", fontSize: 13, padding: "9px 16px", marginTop: 10 }}
                onClick={() => { void useGoogleDriveStore.getState().connect().catch(() => {}); }}>
                Connect to Google Drive
              </button>
            )}
          </div>
        )}

        {/* 1 — pick the area, by name */}
        <section style={card}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={stepNum}>1</span><h2 style={h2}>Which area do you look after?</h2>
          </div>
          <select value={scope} onChange={(e) => { setScope(e.target.value); setPhase("idle"); setError(null); setConfirmOverwrite(false); }}
            style={{ ...input, cursor: "pointer" }} disabled={running}>
            <option value="">Choose your area…</option>
            {[...new Set(areas.map((a) => a.criterionId))].map((cid) => (
              <optgroup key={cid} label={`Criterion ${cid}`}>
                {areas.filter((a) => a.criterionId === cid).map((a) => (
                  <option key={a.scope} value={a.scope}>{a.title} ({a.scope})</option>
                ))}
              </optgroup>
            ))}
          </select>
          {area && <p style={{ ...muted, marginTop: 10, marginBottom: 0 }}>{area.description}</p>}
        </section>

        {/* 2 — two links, because the engine reads the two folders differently */}
        <section style={{ ...card, opacity: area ? 1 : 0.55 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={stepNum}>2</span><h2 style={h2}>Where are your documents?</h2>
          </div>
          <p style={{ ...muted, marginTop: 0 }}>
            Two folders, because they answer two different questions. If you keep everything in one folder,
            paste the same link into both.
          </p>
          <div style={{ height: 6 }} />

          <LinkField
            label="Where is your written procedure?"
            help="The folder holding the document that says how this area is meant to work: your policy, your procedure, your handbook or your terms of reference."
            value={procLink} onChange={setProcLink} state={procState} disabled={!area || running}
            onEdit={() => { setError(null); setConfirmOverwrite(false); }}
          />

          <div style={{ height: 18 }} />

          <LinkField
            label="Where is your evidence?"
            help="The folder holding the records that show it actually happens: minutes, forms, logs, registers, signed copies, reports and emails."
            value={evLink} onChange={setEvLink} state={evState} disabled={!area || running}
            onEdit={() => { setError(null); setConfirmOverwrite(false); }}
          />

          {/* What will and will not be checked, said before the button rather
              than discovered afterwards. */}
          {plan.note && (
            <p style={{
              ...muted, marginBottom: 0, marginTop: 14, padding: "9px 11px", borderRadius: 8,
              background: plan.canRun ? (plan.kind === "full" ? "#f0fdf4" : "#fffbeb") : "#fef2f2",
              border: `1px solid ${plan.canRun ? (plan.kind === "full" ? "#bbf7d0" : "#fde68a") : "#fecaca"}`,
              color: plan.canRun ? (plan.kind === "full" ? "#166534" : "#92400e") : "#991b1b",
            }}>
              {plan.note}
            </p>
          )}
        </section>

        {/* 3 — one button */}
        <section style={{ ...card, opacity: ready || running ? 1 : 0.55 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={stepNum}>3</span><h2 style={h2}>Run the check</h2>
          </div>

          {confirmOverwrite && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: 12, marginBottom: 12 }}>
              <b style={{ fontSize: 13.5, color: "#92400e" }}>
                {resultAtRisk ? "This area has already been checked." : "Your audit lead has already set up this area."}
              </b>
              <p style={{ ...muted, margin: "6px 0 10px" }}>
                {resultAtRisk && `Running again replaces the previous ${plan.kind === "procedure-only" ? "written procedure check" : "result"} for this area, including anything your audit lead has seen. The earlier one is kept in the audit history. `}
                {linkClash && `It also replaces the ${clashes.length === 2 ? "written procedure and records folders" : `${clashes[0]} folder`} your audit lead recorded for this area with what you pasted above. If you are not sure that is right, check with them first.`}
              </p>
              <button type="button" style={{ ...bigBtn, fontSize: 13.5, padding: "9px 16px" }} onClick={() => void run()}>Yes, check it again</button>
              <button type="button" onClick={() => setConfirmOverwrite(false)}
                style={{ marginLeft: 8, fontSize: 13.5, padding: "9px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>
            </div>
          )}

          {!running && !confirmOverwrite && (
            <button type="button" style={{ ...bigBtn, opacity: ready ? 1 : 0.45, cursor: ready ? "pointer" : "not-allowed" }}
              disabled={!ready} onClick={() => void run()}>
              {plan.canRun ? plan.button : "Check my area"}
            </button>
          )}

          {running && (
            <div>
              <ol style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                {visibleSteps.map((s, i) => {
                  const state = i < activeIdx ? "done" : i === activeIdx ? "now" : "todo";
                  return (
                    <li key={s.key} style={{ display: "flex", gap: 9, alignItems: "center", padding: "5px 0", color: state === "todo" ? "#94a3b8" : INK, fontSize: 14 }}>
                      <span style={{ width: 18 }}>{state === "done" ? "✓" : state === "now" ? "◐" : "○"}</span>
                      <span style={{ fontWeight: state === "now" ? 700 : 400 }}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
              {liveDetail && <p style={{ ...muted, marginTop: 0 }}>{liveDetail}</p>}
              <button type="button" onClick={stop}
                style={{ fontSize: 13.5, padding: "9px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#991b1b", fontWeight: 700 }}>
                Stop
              </button>
            </div>
          )}

          {phase === "stopped" && (
            <p style={{ ...muted, color: "#92400e", marginBottom: 0 }}>
              Stopped. The check did not finish, so there is no complete result. You can run it again whenever you are ready.
            </p>
          )}
          {phase === "failed" && error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, padding: 12 }}>
              <b style={{ fontSize: 13.5, color: "#991b1b" }}>The check could not finish</b>
              <p style={{ ...muted, margin: "6px 0 0", color: "#7f1d1d" }}>{error}</p>
            </div>
          )}
        </section>

        {/* 4 — the result */}
        {showResult && area && (
          <section style={card} ref={resultRef}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
              <span style={stepNum}>4</span><h2 style={h2}>Your result</h2>
            </div>
            <p style={{ ...muted, marginTop: 0 }}>
              {area.scope} {area.title} · {procedureOnlyResult ? "written procedure only" : "procedure and records"} · checked {ranAt}
            </p>

            {/* A procedure-only result answers "is it written down?", so it is
                counted in those words. "Complies" on a run that never opened a
                record would be a claim nobody made. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
              <Tally n={counts.complies} label={procedureOnlyResult ? "written down" : "complies"} tone="good" />
              <Tally n={counts.partly} label={procedureOnlyResult ? "partly written down" : "partly complies"} tone="medium" />
              <Tally n={counts.doesNot} label={procedureOnlyResult ? "not written down" : "does not comply"} tone="critical" />
              <Tally n={counts.couldNotCheck} label="could not check" tone="neutral" />
            </div>

            {procedureOnlyResult && (
              <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px" }}>
                {PROCEDURE_ONLY_NOTE}
              </p>
            )}

            {counts.couldNotCheck > 0 && !mostlyUnchecked(counts) && (
              <p style={{ ...muted, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px" }}>
                {COULD_NOT_CHECK_NOTE}
              </p>
            )}

            {mostlyUnchecked(counts) && (
              <p style={{ ...muted, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 8, padding: "9px 11px" }}>
                {MOSTLY_UNCHECKED_NOTE}
              </p>
            )}

            {!procedureOnlyResult && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fbfcfe" }}>
              {band.kind === "none" ? (
                <>
                  <b style={{ fontSize: 14 }}>No band yet for this area</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>
                    {counts.couldNotCheck === counts.total
                      ? "Nothing in this check could be judged, so there is nothing to base a band on. Your audit lead sets the final band."
                      : "A band could not be worked out from this check. Your audit lead sets the final band."}
                  </p>
                </>
              ) : (
                <>
                  <b style={{ fontSize: 14 }}>Band {band.band} of 5 — {band.name}</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>
                    {band.kind === "auditor"
                      ? "This is the band your audit lead has already recorded for this area."
                      : "An indicative band from this practice check. Your audit lead has not confirmed it, and this page does not set it."}
                    {" "}{SELF_CHECK_DISCLAIMER}
                  </p>
                </>
              )}
            </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0" }}>What the requirement asks</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0", width: 130 }}>Result</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0" }}>Why</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0" }}>What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                      <td style={{ padding: "10px" }}>{r.requirement}<div style={{ ...muted, fontSize: 11 }}>{r.ref}</div></td>
                      <td style={{ padding: "10px" }}>
                        <span style={{ ...TONE_BG[r.tone], padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", display: "inline-block" }}>{r.label}</span>
                      </td>
                      <td style={{ padding: "10px", color: "#334155" }}>{r.why || <span style={muted}>No reason recorded.</span>}</td>
                      <td style={{ padding: "10px", color: "#334155" }}>{r.fix || <span style={muted}>{r.tone === "good" || r.tone === "neutral" ? "—" : "No specific fix was suggested."}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={onPdf} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px" }}>⬇ Download as PDF</button>
              <button type="button" onClick={onCsv} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px", background: "#fff", color: INK, border: "1px solid #cbd5e1" }}>⬇ Download as spreadsheet (CSV)</button>
            </div>
            {note && <p style={{ ...muted, color: "#92400e", marginBottom: 0 }}>{note}</p>}
            {ppdResults[area.scope]?.runWarnings?.length ? (
              <p style={{ ...muted, marginTop: 10, marginBottom: 0, color: "#92400e" }}>
                Part of this check did not complete, so the result may be incomplete: {plainRunError(ppdResults[area.scope]?.runWarnings?.[0])}
              </p>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  const t = TONE_BG[tone];
  return (
    <div style={{ background: t.bg, color: t.fg, borderRadius: 10, padding: "9px 14px", minWidth: 96 }}>
      <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3 }}>{label}</div>
    </div>
  );
}

// One Drive-link field: its plain-language question, the one line that says
// which folder it means, and per-field validation. Two of these rather than one
// shared field, because the two folders are read by different passes.
function LinkField(props: {
  label: string; help: string; value: string; state: "empty" | "bad" | "ok";
  disabled: boolean; onChange: (v: string) => void; onEdit: () => void;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#0f172a", margin: "0 0 3px" }}>{props.label}</label>
      <p style={{ ...muted, margin: "0 0 7px" }}>{props.help}</p>
      <input
        value={props.value}
        onChange={(e) => { props.onChange(e.target.value); props.onEdit(); }}
        placeholder="https://drive.google.com/drive/folders/..."
        style={{ ...input, borderColor: props.state === "bad" ? "#f87171" : "#cbd5e1" }}
        disabled={props.disabled}
        spellCheck={false}
      />
      {props.state === "bad" && (
        <p style={{ ...muted, color: "#991b1b", margin: "7px 0 0" }}>
          That does not look like a Google Drive folder link. Open the folder in Drive, copy the address from the
          top of the browser, and paste the whole thing here. It should contain "/folders/".
        </p>
      )}
      {props.state === "ok" && <p style={{ ...muted, color: "#166534", margin: "7px 0 0" }}>That looks right.</p>}
    </div>
  );
}

function bandName(b: number): string {
  return EDUTRUST_BANDS.find((x) => x.band === b)?.name ?? "";
}
