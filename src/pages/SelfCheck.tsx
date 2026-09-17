import { useEffect, useMemo, useRef, useState } from "react";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { EDUTRUST_BANDS } from "../data/edutrustRubric";
import { runScopesForSub, scopeTitle, itemIdsForScope, folderScopeId } from "../lib/evidenceScope";
import { parseFolderId } from "../lib/drive/driveClient";
import { aiOfflineReason } from "../lib/ai/aiClient";
import { apsrMatrixResult } from "../lib/checklistBanding";
import { downloadCsv } from "../lib/auditCsvExport";
import { buildWordingCapture, captureFilename } from "../lib/wordingCapture";
import { printHtmlInNewTab, PRINTABLE_DOC_CSS, POPUP_BLOCKED_MESSAGE } from "../lib/printableDoc";
import {
  formatElapsed, activityLine, countedFor, stallState, fileStageSummary, SLOW_TITLE,
  waitingMessage, roughRemaining,
  type RunProgress, type StageKey,
} from "../lib/selfCheckProgress";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import {
  toSelfCheckRows, countSelfCheck, mostlyUnchecked, buildSelfCheckCsv, buildSelfCheckHtml,
  selfCheckFilename, describeBlock, plainRunError, plainDetail, planFor, toProcedureRows, toRecordsRows,
  SELF_CHECK_DISCLAIMER, COULD_NOT_CHECK_NOTE, MOSTLY_UNCHECKED_NOTE,
  VIEW_LABEL, VIEW_TALLY, VIEW_NOTE, COMBINATION_LABEL, countCombinations, unjudgedBothSides,
  type SelfCheckBand, type SelfCheckView, type Combination,
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

const STEPS: { key: StageKey; label: string }[] = [
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
  const [tab, setTab] = useState<SelfCheckView>("overview");
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
  // Elapsed time and stall detection both need the clock to move independently
  // of the engine: a run that has stopped emitting is precisely the case that
  // must still update on screen. Ticks only while a run is in flight.
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

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

  // Wording-rule instrumentation, for measuring a REAL run rather than a mocked
  // one. Attached to window only: nothing is rendered, so the page a process
  // owner sees is unchanged. Reads the completed run already in the store,
  // writes a JSON file, and changes no stored state.
  useEffect(() => {
    const w = window as unknown as { __gd4Capture?: () => string };
    w.__gd4Capture = () => {
      const ws = useWorkspaceStore.getState();
      const sc = scope;
      const ev = sc ? ws.evidenceAssessments[sc] : undefined;
      const ppd = sc ? ws.ppdReviewResults[sc] : undefined;
      if (!sc || (!ev && !ppd)) return "No completed check found. Run a check on this page first, then run this again.";
      // Corpus the names are checked against: the text this run actually read.
      const cache = Object.values(ws.fileTextCache ?? {});
      const sourceText = cache.map((f) => f.text ?? "").join("\n");
      const sourceFiles = cache.map((f) => f.fileName || f.filePath || "(unnamed)");
      const report = buildWordingCapture({
        area: `${sc} ${area?.title ?? ""}`.trim(),
        pass: ev ? "evidence" : "procedure",
        evidenceRows: ev?.rows,
        procedureRows: ppd?.rows,
        sourceFiles,
        sourceText,
      });
      const blob = new Blob([JSON.stringify(report, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = captureFilename(area?.title ?? sc);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return `Saved ${a.download} — ${report.totals.rows} rows, ${report.sourceChars} characters of source text checked.`;
    };
    return () => { delete w.__gd4Capture; };
  }, [scope, area]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

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

  const procedureOnlyResult = mode === "procedure-only";
  // Which half of the result is on screen. A procedure-only run has only one
  // half and gets no tabs at all, so the tab state is ignored there rather
  // than offering a records view that was never run.
  const view: SelfCheckView = procedureOnlyResult ? "procedure-only" : tab;
  const rows = useMemo(
    () => {
      if (view === "records") return existing ? toRecordsRows(existing.rows) : [];
      if (view === "overview") return existing ? toSelfCheckRows(existing.rows) : [];
      return ppdExisting ? toProcedureRows(ppdExisting.rows) : [];
    },
    [view, existing, ppdExisting],
  );
  const counts = useMemo(() => countSelfCheck(rows), [rows]);
  const combos = useMemo(() => (existing ? countCombinations(existing.rows) : null), [existing]);
  // Off the stored result, not off `rows`: switching to a tab that happens to
  // be empty must not make the whole result section disappear.
  const showResult = phase === "done" && (procedureOnlyResult ? !!ppdExisting?.rows.length : !!existing?.rows.length);

  async function run() {
    if (!area || !folder || !ready) return;
    // Never silently replace a result someone else may be relying on. Asked
    // BEFORE the generation is bumped, so a question that ends in "Cancel"
    // cannot mark anything stale.
    if ((resultAtRisk || linkClash) && !confirmOverwrite) { setConfirmOverwrite(true); return; }
    setConfirmOverwrite(false);
    const myGen = ++generation.current;
    const stale = () => generation.current !== myGen;
    setRunStartedAt(Date.now());
    setNow(Date.now());
    setStageStartedAt(Date.now());
    setDoneSummaries({});
    setError(null); setNote(null); setBand({ kind: "none" });
    const procedureOnly = plan.kind === "procedure-only";
    setMode(procedureOnly ? "procedure-only" : "full");
    setTab("overview");
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
      // Same definition the table uses. The engine stores an unjudged pair as
      // "Partial" (agentRuntime.ts:3553), so reading its verdict alone counted
      // a run where nothing was decided as judged, and banded it.
      const judged = ev.rows.some((r) => r.verdict !== "Not assessed" && !unjudgedBothSides(r));
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

  // The previous result, exactly as stored, for the two download controls in
  // the replace dialog. Deliberately NOT the component's `rows`/`band`/`ranAt`:
  // those are session state, and the stored result carries its own runAt. Its
  // band is another matter — see SCORE_NOT_RECORDED in selfCheck.ts.
  const previous = useMemo(() => {
    const src = plan.kind === "procedure-only" ? ppdExisting : existing;
    if (!src || src.rows.length === 0 || !area) return null;
    const prevRows = plan.kind === "procedure-only"
      ? toProcedureRows((src as { rows: Parameters<typeof toProcedureRows>[0] }).rows)
      : toSelfCheckRows((src as { rows: Parameters<typeof toSelfCheckRows>[0] }).rows);
    // The auditor's committed band is a stored fact and survives; the
    // indicative one was never saved with the result, so say so on the file.
    const committed = itemIdsForScope(area.scope).map((id) => checklistEntries[id]?.holisticBand).find((bd) => !!bd);
    const prevBand: SelfCheckBand = committed
      ? { kind: "auditor", band: committed.band, name: bandName(committed.band), totalPct: committed.totalPct }
      : { kind: "not-recorded" };
    const ranAtPrev = new Date(src.runAt).toLocaleString("en-SG");
    return { rows: prevRows, counts: countSelfCheck(prevRows), band: prevBand, ranAt: ranAtPrev };
  }, [plan.kind, existing, ppdExisting, area, checklistEntries]);

  function onPreviousCsv() {
    if (!area || !previous) return;
    downloadCsv(
      buildSelfCheckCsv(`${area.scope} ${area.title}`, previous.rows, previous.band, plan.kind === "procedure-only" ? "procedure-only" : "overview"),
      selfCheckFilename(`${area.title} previous`, "csv"),
    );
  }
  function onPreviousPdf() {
    if (!area || !previous) return;
    const ok = printHtmlInNewTab(
      `<style>${PRINTABLE_DOC_CSS}</style>${buildSelfCheckHtml({
        areaLabel: `${area.scope} ${area.title}`, areaDescription: area.description,
        counts: previous.counts, band: previous.band, rows: previous.rows,
        ranAt: previous.ranAt, view: plan.kind === "procedure-only" ? "procedure-only" : "overview",
      })}`,
      `Self-check ${area.title} (earlier check)`,
    );
    if (!ok) setNote(POPUP_BLOCKED_MESSAGE);
  }

  function onCsv() {
    if (!area) return;
    // The tab you are looking at is the tab you get, named on the file so two
    // downloads of the same run can never be confused for each other.
    downloadCsv(buildSelfCheckCsv(`${area.scope} ${area.title}`, rows, band, view), selfCheckFilename(view === "overview" ? area.title : `${area.title} ${VIEW_LABEL[view]}`, "csv"));
  }
  function onPdf() {
    if (!area) return;
    const ok = printHtmlInNewTab(
      `<style>${PRINTABLE_DOC_CSS}</style>${buildSelfCheckHtml({
        areaLabel: `${area.scope} ${area.title}`, areaDescription: area.description,
        counts, band, rows, ranAt, view,
      })}`,
      view === "overview" ? `Self-check ${area.title}` : `Self-check ${area.title} — ${VIEW_LABEL[view]}`,
    );
    if (!ok) setNote(POPUP_BLOCKED_MESSAGE);
  }

  const liveDetail = plainDetail(evProgress?.detail || ppdProgress?.detail || "");
  // Which pass is live right now. The two passes each keep their own progress
  // object, and only one is running at a time.
  const liveProgress: RunProgress | undefined =
    phase === "policy" ? (ppdProgress ?? undefined) : (phase === "records" || phase === "band") ? (evProgress ?? undefined) : undefined;
  const stall = stallState(now, liveProgress, runStartedAt || now);
  // When the currently counted stage began. The finish estimate divides the
  // time this stage has ACTUALLY taken by the requirements it has ACTUALLY
  // finished, so it needs a real start, not the whole run's.
  const [stageStartedAt, setStageStartedAt] = useState(0);
  useEffect(() => { setStageStartedAt(Date.now()); }, [phase]);
  const liveCount = countedFor(phase === "policy" ? "policy" : "records", liveProgress)
    ?? countedFor("records", evProgress ?? undefined)
    ?? countedFor("policy", ppdProgress ?? undefined);
  const remaining = liveCount
    ? roughRemaining(liveCount.done, liveCount.total, now - (stageStartedAt || now))
    : null;
  // A completed stage keeps its one-line result. Snapshotted in an effect as
  // each stage ends, because the engine's progress object moves on to the next
  // pass and the previous pass's file ledger would otherwise be unreachable.
  const [doneSummaries, setDoneSummaries] = useState<Partial<Record<StageKey, string>>>({});
  useEffect(() => {
    // Snapshotted WHILE each pass is live, not after it ends: the store drops
    // its progress object when a pass finishes, so waiting until the stage was
    // marked done left nothing to read and the summary never appeared.
    const policy = fileStageSummary(ppdProgress?.filesFound);
    if (policy) setDoneSummaries((d) => (d.policy === policy ? d : { ...d, policy }));
    const records = fileStageSummary(evProgress?.filesFound);
    if (records) setDoneSummaries((d) => (d.records === records ? d : { ...d, records }));
  }, [ppdProgress, evProgress]);
  const visibleSteps = procedureOnlyResult ? STEPS.filter((s) => s.key !== "records" && s.key !== "band") : STEPS;
  const activeIdx = visibleSteps.findIndex((s) => s.key === phase);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fa", padding: "26px 16px 70px" }}>
      {/* Indeterminate bar for the two stages that count nothing. Movement here
          means "still alive", never "N% done". */}
      <style>{[
        "@keyframes scSlide{0%{margin-left:0}50%{margin-left:62%}100%{margin-left:0}}",
        // Slow on purpose. A 4s breath is roughly a resting animal's, and it is
        // the fastest thing about the cat.
        "@keyframes scBreathe{0%,100%{transform:translateY(0) scaleY(1)}50%{transform:translateY(-0.7px) scaleY(1.025)}}",
        // The tail rests for most of the cycle and flicks once, so the eye is
        // drawn briefly rather than continuously.
        "@keyframes scTail{0%,62%{transform:rotate(0deg)}72%{transform:rotate(-15deg)}82%{transform:rotate(7deg)}92%,100%{transform:rotate(0deg)}}",
        // A blink is a fast squash on a long cycle: visible if you are looking,
        // invisible if you are not.
        "@keyframes scBlink{0%,94%,100%{transform:scaleY(1)}96%,98%{transform:scaleY(0.12)}}",
        ".sc-cat-body{animation:scBreathe 4s ease-in-out infinite;transform-origin:23px 33px}",
        ".sc-cat-tail{animation:scTail 3.2s ease-in-out infinite;transform-origin:33px 31px}",
        ".sc-cat-eyes{animation:scBlink 6s ease-in-out infinite;transform-origin:23px 15px}",
        // Anyone who has asked the operating system for less movement gets a
        // still cat. The rotating copy and the elapsed timer still change, so
        // the card is still demonstrably alive without any animation at all.
        "@media (prefers-reduced-motion: reduce){.sc-cat-body,.sc-cat-tail,.sc-cat-eyes{animation:none}.sc-bar,.sc-indet{animation:none!important;transition:none!important}}",
      ].join("")}</style>
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
                {resultAtRisk && `Running again replaces the previous ${plan.kind === "procedure-only" ? "written procedure check" : "result"} for this area, including anything your audit lead has seen. Nothing is deleted. Download a copy below if you want one. `}
                {linkClash && `It also replaces the ${clashes.length === 2 ? "written procedure and records folders" : `${clashes[0]} folder`} your audit lead recorded for this area with what you pasted above. If you are not sure that is right, check with them first.`}
              </p>
              <button type="button" style={{ ...bigBtn, fontSize: 13.5, padding: "9px 16px" }} onClick={() => void run()}>Yes, check it again</button>
              <button type="button" onClick={() => setConfirmOverwrite(false)}
                style={{ marginLeft: 8, fontSize: 13.5, padding: "9px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Cancel</button>

              {/* Deliberately smaller, plainer and on their own row, so they read
                  as "take a copy first" rather than as the decision. Neither
                  dismisses the dialog: the choice above is still open after a
                  download. Hidden entirely when no previous result can be
                  retrieved, rather than offering a control that would fail. */}
              {previous && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #fde68a" }}>
                  <span style={{ ...muted, color: "#92400e", marginRight: 8 }}>Keep a copy of the earlier check:</span>
                  <button type="button" onClick={onPreviousPdf}
                    style={{ fontSize: 12.5, padding: "5px 11px", borderRadius: 8, border: "1px solid #d6bc8a", background: "#fff", color: "#92400e", cursor: "pointer", marginRight: 6 }}>
                    ⬇ Download PDF
                  </button>
                  <button type="button" onClick={onPreviousCsv}
                    style={{ fontSize: 12.5, padding: "5px 11px", borderRadius: 8, border: "1px solid #d6bc8a", background: "#fff", color: "#92400e", cursor: "pointer" }}>
                    ⬇ Download CSV
                  </button>
                </div>
              )}
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
              {/* Elapsed time runs for the whole check, from the first stage to
                  the last, so a long run is never indistinguishable from a hang. */}
              <div style={{ ...muted, marginTop: 0, marginBottom: 10 }}>
                Running for {formatElapsed(now - (runStartedAt || now))}
                {/* Only once a requirement has actually finished, so the figure
                    is measured pace rather than an invented constant. */}
                {remaining && <span> · {remaining}</span>}
              </div>

              <ol style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                {visibleSteps.map((s, i) => {
                  const state = i < activeIdx ? "done" : i === activeIdx ? "now" : "todo";
                  const activity = state === "now" ? activityLine(s.key, liveProgress) : "";
                  const count = state === "now" ? countedFor(s.key, liveProgress) : null;
                  const summary = state === "done" ? doneSummaries[s.key] : "";
                  return (
                    <li key={s.key} style={{ padding: "6px 0", color: state === "todo" ? "#94a3b8" : INK, fontSize: 14 }}>
                      <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                        <span style={{ width: 18 }}>{state === "done" ? "✓" : state === "now" ? "◐" : "○"}</span>
                        <span style={{ fontWeight: state === "now" ? 700 : 400 }}>{s.label}</span>
                        {count && <span style={{ ...muted, marginLeft: 4 }}>{count.pct}%</span>}
                      </div>

                      {/* A completed stage keeps its result on screen, naming any
                          file that was skipped rather than implying it was read. */}
                      {summary && <div style={{ ...muted, marginLeft: 27 }}>{summary}</div>}

                      {state === "now" && (
                        <div style={{ marginLeft: 27, marginTop: 4 }}>
                          {count ? (
                            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", maxWidth: 320 }}>
                              <div className="sc-bar" style={{ width: `${count.pct}%`, height: "100%", background: "#7c3aed", transition: "width 1.6s cubic-bezier(.22,.61,.36,1)" }} />
                            </div>
                          ) : (
                            // No counted denominator for this stage, so an
                            // indeterminate bar rather than an invented number.
                            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", maxWidth: 320 }}>
                              <div className="sc-indet" style={{ height: "100%", width: "38%", background: "#c4b5fd", borderRadius: 99, animation: "scSlide 1.4s ease-in-out infinite" }} />
                            </div>
                          )}
                          <div style={{ ...muted, marginTop: 5 }}>
                            {activity || liveDetail || "Still working"}
                            {/* Only when the activity line has not already said
                                it, so it does not read "1 of 4 (0 of 4)". */}
                            {count && !activity && ` (${count.done} of ${count.total})`}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>

              {/* The only thing on this card that moves between engine events.
                  The stage list above is entirely event-driven and holds still
                  for 15 to 25 seconds at a time, which reads as a freeze. */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <WaitingCat />
                <div style={{ ...muted, margin: 0 }}>{waitingMessage(now - (runStartedAt || now))}</div>
              </div>

              {/* Stall: the engine bumps a heartbeat on every event, so silence
                  is measurable rather than guessed. */}
              {stall.level !== "none" && (
                <div style={{
                  background: stall.level === "stuck" ? "#fef2f2" : "#fffbeb",
                  border: `1px solid ${stall.level === "stuck" ? "#fecaca" : "#fde68a"}`,
                  borderRadius: 9, padding: 11, marginBottom: 12,
                }}>
                  <b style={{ fontSize: 13.5, color: stall.level === "stuck" ? "#991b1b" : "#92400e" }}>{SLOW_TITLE}</b>
                  <p style={{ ...muted, margin: "5px 0 0", color: stall.level === "stuck" ? "#7f1d1d" : "#92400e" }}>
                    {stall.waitingOn} Nothing has happened for {formatElapsed(now - (liveProgress?.heartbeatAt ?? runStartedAt))}.
                  </p>
                  {stall.level === "stuck" && (
                    <div style={{ marginTop: 9 }}>
                      <button
                        type="button"
                        onClick={() => { if (stall.control === "skip") useWorkspaceStore.getState().skipCurrentFile(); else stop(); }}
                        style={{ fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 9, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", color: "#991b1b" }}
                      >
                        {stall.controlLabel}
                      </button>
                      <p style={{ ...muted, margin: "6px 0 0" }}>{stall.controlNote}</p>
                    </div>
                  )}
                </div>
              )}

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
          // Step 4 alone widens: "Why" and "What to fix" were wrapping to about
          // 25 characters at the page's reading width. The negative margins pull
          // it out of the 880px column without moving steps 1 to 3, and the
          // clamp keeps it from sprawling on a very wide screen. min() rather
          // than a media query so it simply collapses back to the column width
          // on a narrow screen.
          <section
            style={{ ...card, width: "max(100%, min(80vw, 1400px))", marginLeft: "min(0px, calc(440px - min(40vw, 700px)))", marginRight: "min(0px, calc(440px - min(40vw, 700px)))" }}
            ref={resultRef}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
              <span style={stepNum}>4</span><h2 style={h2}>Your result</h2>
            </div>
            <p style={{ ...muted, marginTop: 0 }}>
              {area.scope} {area.title} · {procedureOnlyResult ? "written procedure only" : "procedure and records"} · checked {ranAt}
            </p>

            {/* The check asks two separate questions and they fail
                independently: your procedure can be silent while your records
                are full, and the other way round. Blended into one verdict that
                difference was invisible, and the fix for each is different. */}
            {!procedureOnlyResult && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "14px 0 10px" }}>
                {(["overview", "procedure", "records"] as const).map((k) => (
                  <button
                    key={k} type="button" onClick={() => setTab(k)}
                    style={{
                      border: "1px solid", borderColor: tab === k ? INK : "#cbd5e1", background: tab === k ? INK : "#fff",
                      color: tab === k ? "#fff" : INK, borderRadius: 999, padding: "8px 16px",
                      fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {k === "overview" ? "Overall" : VIEW_LABEL[k]}
                  </button>
                ))}
              </div>
            )}

            {/* A procedure-only result answers "is it written down?", so it is
                counted in those words. "Complies" on a run that never opened a
                record would be a claim nobody made. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
              <Tally n={counts.complies} label={VIEW_TALLY[view].complies} tone="good" />
              {VIEW_TALLY[view].partly && <Tally n={counts.partly} label={VIEW_TALLY[view].partly!} tone="medium" />}
              <Tally n={counts.doesNot} label={VIEW_TALLY[view].doesNot} tone="critical" />
              <Tally n={counts.couldNotCheck} label="could not check" tone="neutral" />
            </div>

            {VIEW_NOTE[view] && (
              <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px" }}>
                {VIEW_NOTE[view]}
              </p>
            )}

            {/* The four combinations, counted, on the overall tab only: it is
                the one place both halves are in view at once. */}
            {view === "overview" && combos && combos.unknown < counts.total && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 13px", margin: "12px 0", background: "#fbfcfe" }}>
                <b style={{ fontSize: 13 }}>Written procedure vs records</b>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 7 }}>
                  {(Object.keys(COMBINATION_LABEL) as Combination[]).filter((k) => combos[k] > 0).map((k) => (
                    <span key={k} style={{ fontSize: 13, color: "#334155" }}>
                      <b style={{ fontSize: 15 }}>{combos[k]}</b> {COMBINATION_LABEL[k]}
                    </span>
                  ))}
                </div>
                <p style={{ ...muted, margin: "7px 0 0" }}>
                  Written down but no records means the procedure is fine and the proof is missing. Records but nothing written down means it happens but the procedure does not say so. The two tabs above show which requirement is which.
                </p>
              </div>
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

            {view === "overview" && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fbfcfe" }}>
              {band.kind === "none" || band.kind === "not-recorded" ? (
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
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0", width: "24%" }}>What the requirement asks</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0", width: "9%", minWidth: 84 }}>Result</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0", width: "37%" }}>Why</th>
                    <th style={{ padding: "9px 10px", borderBottom: "1px solid #e2e8f0", width: "30%" }}>What to fix</th>
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
                      <td style={{ padding: "10px", color: "#334155" }}>{r.fix || <span style={muted}>{r.tone === "good" || r.tone === "neutral" ? "—" : "The check did not suggest anything specific here. Ask your audit lead what would close it."}</span>}</td>
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

// A small cat that breathes, blinks and flicks its tail while the check runs.
//
// It exists because every OTHER indicator on this card is driven by engine
// events, and those arrive 15 to 25 seconds apart. Between two of them the card
// was completely still, which reads as a freeze rather than as work in
// progress. This moves on its own clock and tells the honest truth: something
// is alive. It claims nothing about progress, because it knows nothing about
// progress.
//
// Kept calm rather than cute: everything is slow (a 4s breath, a 3.2s tail, a
// blink every 6s), nothing travels across the card, and it is drawn in the
// page's own muted slate and violet rather than in saturated colour, so it sits
// quieter than the progress bar beside it. Pure inline SVG and CSS keyframes:
// no image file, no library, no JavaScript loop.
//
// Under prefers-reduced-motion every animation is disabled by the stylesheet
// below and the cat simply sits there; the rotating copy and the elapsed timer
// carry the "still alive" job on their own.
function WaitingCat() {
  return (
    <svg
      width="58" height="50" viewBox="0 0 46 40" aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <g className="sc-cat">
        {/* tail, hinged at the body so the flick pivots rather than slides */}
        <path
          className="sc-cat-tail"
          d="M33 31 C40 31, 42 25, 39 21"
          fill="none" stroke="#8ea0b5" strokeWidth="2.8" strokeLinecap="round"
        />
        <g className="sc-cat-body">
          {/* haunch and chest, one sitting silhouette */}
          <path d="M14 33 C13 24, 17 19, 23 19 C29 19, 33 24, 32 33 Z" fill="#b6c2d2" />
          {/* head */}
          <circle cx="23" cy="15" r="8" fill="#b6c2d2" />
          {/* ears */}
          <path d="M16.5 10 L16 4.5 L21 8 Z" fill="#b6c2d2" />
          <path d="M29.5 10 L30 4.5 L25 8 Z" fill="#b6c2d2" />
          {/* eyes: two short strokes that squash shut on the blink */}
          <g className="sc-cat-eyes">
            <ellipse cx="20" cy="15" rx="1.3" ry="1.6" fill="#475569" />
            <ellipse cx="26" cy="15" rx="1.3" ry="1.6" fill="#475569" />
          </g>
          {/* nose */}
          <path d="M23 18 l-1.2 -1.4 h2.4 Z" fill="#a78bfa" />
        </g>
        {/* paws stay put while the body breathes above them */}
        <ellipse cx="18" cy="33" rx="4" ry="2.2" fill="#d5dde7" />
        <ellipse cx="28" cy="33" rx="4" ry="2.2" fill="#d5dde7" />
      </g>
    </svg>
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
