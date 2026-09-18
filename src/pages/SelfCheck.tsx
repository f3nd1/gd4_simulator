import { useEffect, useMemo, useRef, useState } from "react";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { runScopesForSub, scopeTitle, itemIdsForScope, folderScopeId } from "../lib/evidenceScope";
import { parseFolderId } from "../lib/drive/driveClient";
import { aiOfflineReason } from "../lib/ai/aiClient";
import { downloadCsv } from "../lib/auditCsvExport";
import { buildWordingCapture, captureFilename } from "../lib/wordingCapture";
import { printHtmlInNewTab, PRINTABLE_DOC_CSS, POPUP_BLOCKED_MESSAGE } from "../lib/printableDoc";
import {
  formatElapsed, activityLine, countedFor, stallState, fileStageSummary, SLOW_TITLE,
  waitingMessage, roughRemaining,
  type RunProgress, type StageKey,
} from "../lib/selfCheckProgress";
import { useWorkspaceStore, OPTION_A_RUN_HISTORY_CAP } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import {
  toSelfCheckRows, countSelfCheck, mostlyUnchecked, buildSelfCheckCsv, buildSelfCheckHtml,
  selfCheckFilename, describeBlock, plainRunError, plainDetail, planFor, toProcedureRows, toRecordsRows,
  SELF_CHECK_DISCLAIMER, COULD_NOT_CHECK_NOTE, MOSTLY_UNCHECKED_NOTE, NO_BAND_LINE,
  VIEW_LABEL, VIEW_TALLY, VIEW_NOTE, TABS_EXPLAINED, COMBINATION_LABEL, countCombinations, unjudgedBothSides,
  citedText, missingText, expectedEvidenceGroups, VERDICT_LEGEND, tallySlices, feedsFor, SUMMARY_LABEL,
  type SelfCheckBand, type SelfCheckView, type Combination, type SelfCheckRow,
} from "../lib/selfCheck";
import { toFileRows, countFileRows, unreadableWarning, passFileRows, fileCheckMark, sameFolderLink, SAME_LINK_WARNING, type SelfCheckFileRow } from "../lib/selfCheckEvidence";
import { selfCheckRuns, diffRuns, diffSummary, runTimingNote, type SelfCheckRunRef, type RunDiff } from "../lib/selfCheckHistory";
import { SELF_CHECK_RUN_LOG_CAP } from "../lib/selfCheckRunLog";
import { outcomeDimensionState, outcomePassTally } from "../lib/selfCheckOutcome";
import { buildLabel } from "../lib/buildInfo";
import { unassessedDimensions, runNamedGaps, reviewShapedGapNote, reviewShapedRows, IMPROVE_HEADLINE, IMPROVE_WHY, IMPROVE_HEADLINE_CHECKED, IMPROVE_WHY_CHECKED, REVIEW_FINDINGS_HEADING, REVIEW_FINDINGS_INTRO, REVIEW_FINDINGS_NONE } from "../lib/selfCheckImprove";
import { buildBandWorking, bandCoverageNote, bandGraphic, bandGraphicSvg, tallyBarSvg, SCREEN_BAND_PALETTE, BAND_LADDER, ROWS_DO_NOT_SUM_NOTE, dimensionsNote, NOT_ASSESSED_HERE, NO_BAND_WITHOUT_FOUR_NOTE, selfCheckTotal, selfCheckTotalWorking, bandName, INFERRED_THRESHOLDS_NOTE, DIMENSION_SOURCE, DIMENSION_SOURCE_CHECKED, type BandWorking } from "../lib/selfCheckBanding";

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

type Phase = "idle" | "folder" | "policy" | "records" | "outcomes" | "band" | "done" | "stopped" | "failed";

const STEPS: { key: StageKey; label: string }[] = [
  { key: "folder", label: "Opening your folder" },
  { key: "policy", label: "Reading what your written procedure says" },
  { key: "records", label: "Checking your records against it" },
  { key: "outcomes", label: "Checking your results and review records" },
  { key: "band", label: "Working out your result" },
];

export function SelfCheck() {
  const folders = useWorkspaceStore((s) => s.folders);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const evProgress = useWorkspaceStore((s) => s.evidenceAssessmentProgress);
  const ppdProgress = useWorkspaceStore((s) => s.ppdReviewProgress);
  const orProgress = useWorkspaceStore((s) => s.outcomeReviewProgress);
  const outcomeResults = useWorkspaceStore((s) => s.outcomeReviewResults);
  const ppdResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evHistory = useWorkspaceStore((s) => s.evidenceAssessmentHistory);
  const evRunLog = useWorkspaceStore((s) => s.evidenceRunLog);
  const ppdRunLog = useWorkspaceStore((s) => s.ppdRunLog);
  const deleteSelfCheckRun = useWorkspaceStore((s) => s.deleteSelfCheckRun);
  const clearSelfCheckHistory = useWorkspaceStore((s) => s.clearSelfCheckHistory);
  const ppdHistory = useWorkspaceStore((s) => s.ppdReviewHistory);
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
  const [bandWorking, setBandWorking] = useState<BandWorking | null>(null);
  // Two coverage notes, because they caption two different things: the
  // auditor's committed band on the card, and the dimension panel below it.
  const [bandCoverage, setBandCoverage] = useState("");
  const [dimensionCoverage, setDimensionCoverage] = useState("");
  // Which stored run is being viewed. Reset to the latest whenever the area
  // changes or a new run finishes, so "you are looking at an old result" can
  // never be a state somebody arrives in without choosing it.
  const [runIndex, setRunIndex] = useState(0);
  // Deleting is two steps and never a browser confirm(): the panel has to say
  // WHICH check goes, what is left behind, and that the audit lead's PPD
  // Review page reads the same history and loses it too.
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [allRuns, setAllRuns] = useState(false);
  // Whether the run-history card at step 1 is open. Held HERE rather than left
  // to the <details> element's own state, because the card is not rendered at
  // all for an area with no history, so picking an unchecked area and coming
  // back unmounted the node and shut it again. Deliberately not persisted: it
  // is a reading position, not a setting, and starts shut on every visit.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Whether the file list on the result is open. Page-level for the same reason
  // historyOpen is: the panel is not rendered at all on a tab with no files, so
  // the element's own state would be lost on the way there and back.
  const [filesOpen, setFilesOpen] = useState(false);
  // Which requirement the workspace is showing. Held by REF, not by index: the
  // three tabs return the same refs in the same order, so switching tab keeps
  // the reader on the requirement they were reading rather than throwing them
  // back to the top.
  const [selectedRef, setSelectedRef] = useState<string>("");
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
  // Which run is on screen: 0 is the latest, 1.. are the stored earlier runs.
  // The history is the workspace store's OWN, kept since before this page
  // existed and never read here; no new store and no new storage.
  const runs = useMemo(
    () => (scope ? selfCheckRuns(evidenceAssessments[scope], evHistory[scope], ppdResults[scope], ppdHistory[scope], evRunLog[scope], ppdRunLog[scope]) : []),
    [scope, evidenceAssessments, evHistory, ppdResults, ppdHistory, evRunLog, ppdRunLog],
  );
  // Never lands on an entry whose full result has aged out: those are on the
  // timeline to be read, not opened, and clamping to the list length alone
  // would have rendered the current run's rows under an old run's date.
  const openableCount = runs.filter((r) => r.openable).length;
  const viewingRun = Math.min(runIndex, Math.max(0, openableCount - 1));
  const atRun = <T,>(cur: T | undefined, hist: T[] | undefined): T | undefined =>
    viewingRun === 0 ? cur : (hist ?? [])[viewingRun - 1];
  const existing = scope ? atRun(evidenceAssessments[scope], evHistory[scope]) : undefined;

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

  const ppdExisting = scope ? atRun(ppdResults[scope], ppdHistory[scope]) : undefined;
  // What this particular run would actually overwrite. A procedure-only run
  // rewrites the procedure result and leaves the full result alone, so warning
  // about the full one would be a claim about something that will not happen.
  const resultAtRisk = plan.kind === "procedure-only" ? !!(scope && ppdResults[scope]) : !!(scope && evidenceAssessments[scope]);

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
  // Everything the working is read from: the procedure pass's own rows (for the
  // clause-by-clause breakdown) and both passes' chunk-to-file maps (so a quote
  // names the file it came from, not a chunk id).
  const runCtx = useMemo(
    () => ({
      ppdRows: ppdExisting?.rows,
      // NEVER merged. Each pass numbers its chunks from C001 independently, so
      // one merged map makes the later pass's files win every shared id, which
      // attributed every procedure quote to a file from the records folder.
      policyChunkFileNames: ppdExisting?.chunkFileNames,
      evidenceChunkFileNames: existing?.chunkFileNames,
      unreadableFiles: countFileRows(toFileRows(ppdExisting?.fileLedger, existing?.fileLedger)).unreadable,
    }),
    [ppdExisting, existing],
  );
  const rows = useMemo(
    () => {
      if (view === "records") return existing ? toRecordsRows(existing.rows, runCtx) : [];
      if (view === "overview") return existing ? toSelfCheckRows(existing.rows, runCtx) : [];
      return ppdExisting ? toProcedureRows(ppdExisting.rows, runCtx) : [];
    },
    [view, existing, ppdExisting, runCtx],
  );
  // What the run actually opened, from the two passes' own file ledgers. A
  // procedure-only run never read the records folder, so only its ledger is
  // listed: showing an empty records section would imply a folder was read.
  const fileRows = useMemo(
    () => toFileRows(ppdExisting?.fileLedger, procedureOnlyResult ? undefined : existing?.fileLedger),
    [ppdExisting, existing, procedureOnlyResult],
  );
  // Established live, not inferred: one link in both boxes makes BOTH passes
  // take every file in the folder, because each pass only applies the
  // subfolder split when its own link is empty. The procedure is then read as
  // a record and the record as a procedure.
  const sameLink = sameFolderLink(procLink, evLink) || sameFolderLink(folder?.policyLink, folder?.folderLink);
  // The files THIS tab's pass read. Per pass, never merged: a file the records
  // pass read is not evidence the procedure pass read it.
  const tabFileRows = useMemo(
    () => (view === "procedure" || view === "procedure-only" ? passFileRows(ppdExisting?.fileLedger)
      : view === "records" ? passFileRows(existing?.fileLedger)
      : fileRows),
    [view, ppdExisting, existing, fileRows],
  );
  // The results-and-review pass, and only when the run on screen is the CURRENT
  // one: the pass is stored once per area, not once per run, so attaching it to
  // an archived run would date a later check to an earlier day.
  //
  // It must also be NEWER than the run it is shown against. The pass reads a
  // run's own documents, so one stored before the run on screen belongs to an
  // earlier check; pairing them would credit this result with a pass that never
  // saw it. A result from before the pass existed carries nothing at all, and
  // then says the pass did not run, which is the truth about it.
  const outcomeShown = useMemo(() => {
    if (viewingRun !== 0) return undefined;
    const res = outcomeResults[scope];
    if (!res) return undefined;
    const runAt = existing?.runAt;
    if (runAt && res.runAt && new Date(res.runAt).getTime() < new Date(runAt).getTime()) return undefined;
    return res;
  }, [viewingRun, outcomeResults, scope, existing]);
  const outcomeState = useMemo(() => outcomeDimensionState(outcomeShown), [outcomeShown]);
  const outcomeTally = useMemo(() => outcomePassTally(outcomeShown?.rows), [outcomeShown]);
  // Only the official review lines, via the same ref set the improvement panel
  // already uses. Nothing here re-judges: these are the pass's own verdicts.
  const outcomeReviewLines = useMemo(() => reviewShapedRows(outcomeShown?.rows ?? []), [outcomeShown]);
  // Whether the two dimensions this page does not score were nevertheless
  // LOOKED AT on the run being shown. Read off the working the panel prints, so
  // every sentence about them on the page comes from the same fact.
  const dimensionsChecked = !!bandWorking?.rows.every((r) => r.assessedHere);
  // The band, and null whenever any dimension is missing. One derivation, used
  // by the card, the working panel and both exports.
  const selfTotal = useMemo(() => selfCheckTotal(bandWorking ?? undefined, apsrScale), [bandWorking, apsrScale]);
  // The run's own report that something did not finish, from EITHER pass. Both
  // are checked: a records-pass failure was never surfaced here at all.
  // Lines the procedure pass never reached a verdict on. Not a gap: the engine
  // caps their combined verdict and says so in the row's own comment.
  const unjudgedProcedure = useMemo(
    () => (existing?.rows ?? []).filter((r) => r.ppdVerdict === "Not assessed").length,
    [existing],
  );
  const incompleteNote = useMemo(() => {
    const w = [...(ppdResults[scope]?.runWarnings ?? []), ...(existing?.runWarnings ?? [])];
    return w.length > 0 ? plainRunError(w[0]) : undefined;
  }, [ppdResults, existing, scope]);
  const expectedGroups = useMemo(() => expectedEvidenceGroups(rows), [rows]);
  // The run's own reported gaps, gathered for the improvement section. Nothing
  // new is written: these are the strings already on the rows.
  const runGaps = useMemo(() => runNamedGaps(rows), [rows]);
  // The run's own verdicts on the official review-shaped lines. Same refs, same
  // verdicts, same words as the table above; no judgement is added here.
  const reviewRows = useMemo(() => reviewShapedRows(rows), [rows]);
  const counts = useMemo(() => countSelfCheck(rows), [rows]);
  const shownRun = runs[viewingRun];
  // What changed since the check before the one on screen. Counted from the
  // two runs' own stored verdicts; nothing is re-judged.
  const runDiff = useMemo(() => {
    if (!scope) return null;
    const older = viewingRun === 0 ? (evHistory[scope] ?? [])[0] : (evHistory[scope] ?? [])[viewingRun];
    if (!older || !existing) return null;
    return diffRuns(existing.rows, older.rows);
  }, [scope, viewingRun, evHistory, existing]);
  const combos = useMemo(() => (existing ? countCombinations(existing.rows) : null), [existing]);
  // Off the stored result, not off `rows`: switching to a tab that happens to
  // be empty must not make the whole result section disappear.
  //
  // And NOT gated on phase === "done" any more. `phase` is session state that
  // starts at "idle", so a stored result rendered only in the browser session
  // that produced it: come back tomorrow and the page showed steps 1-3 and
  // nothing else. The run history was therefore unreachable without running
  // again, and running again was the one thing that pushed the result you
  // wanted to look at into the archive. Reproduced live before it was fixed.
  const showResult = !running && (procedureOnlyResult ? !!ppdExisting?.rows.length : !!existing?.rows.length);

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
    setError(null); setNote(null); setBand({ kind: "none" }); setBandWorking(null); setBandCoverage(""); setDimensionCoverage("");
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
        setRunIndex(0);
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

      // The third pass, over the SAME documents the two above already read —
      // which is how Option B's full audit has always assessed these two
      // dimensions. The store gates it on whether any of the records could
      // actually be read (lib/selfCheckOutcome.ts): unread records must never
      // become a "Not evident", which is Band 1 downstream.
      setPhase("outcomes");
      await useWorkspaceStore.getState().runOutcomeReviewPass(area.scope);
      if (stale()) return;

      setPhase("band");
      // No band is derived from this check. The auditor's committed band shows
      // if there is one, because that is a recorded fact about the area rather
      // than a reading of this run. suggestBand() is still called, but ONLY for
      // the two dimensions this path actually wrote a real status onto: its
      // Systems & Outcomes and Review judgements are made from lines that say
      // outright it did not look, and feeding those into the total understated
      // a genuinely Band 4 area as Band 3. buildBandWorking drops them.
      const itemIds = itemIdsForScope(area.scope);
      // WHICH item the band belongs to, not just the band. Two sub-criteria
      // (2.2 and 4.2) hold more than one requirement item, and both the
      // committed band and the suggestion describe ONE of them while the table
      // covers them all. Unlabelled, that is misreporting an auditor cannot see.
      const committedEntry = itemIds.map((id) => ({ id, band: checklistEntries[id]?.holisticBand })).find((e) => !!e.band);
      const committed = committedEntry?.band;
      // Which requirement item the panel below describes. Two sub-criteria
      // (2.2 and 4.2) hold more than one item, and the panel describes ONE of
      // them while the table covers them all.
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
        setBandCoverage(bandCoverageNote(committedEntry!.id, itemIds, "This band"));
      }
      if (judged) {
        // The pass's own verdicts go INTO the band call. Without them the
        // digest carries the "not assessed" placeholder on every line for these
        // two dimensions (measured live), and a band diagnosed from that is a
        // band diagnosed from an absence. Nothing is written to the checklist.
        const orRows = useWorkspaceStore.getState().outcomeReviewResults[area.scope];
        const usableOutcomeRows = orRows && !orRows.skippedReason ? orRows.rows : undefined;
        const s = await useChecklistModuleStore.getState().suggestBand(itemIds[0], usableOutcomeRows);
        if (stale()) return;
        if (s) {
          // Whether the results-and-review pass reached verdicts on THIS run,
          // read from the store at this moment rather than from a render-time
          // closure. It decides the wording of the two rows the panel does not
          // score: "checked, not scored here" against "not assessed".
          const orNow = useWorkspaceStore.getState().outcomeReviewResults[area.scope];
          const orChecked = !!orNow && !orNow.skippedReason && (orNow.rows?.length ?? 0) > 0;
          setBandWorking(buildBandWorking(s.dimensionBands, {
            approach: s.dimensions.approach.reason,
            processes: s.dimensions.processes.reason,
            systemsOutcomes: s.dimensions.systemsOutcomes.reason,
            review: s.dimensions.review.reason,
          }, apsrScale, { systemsOutcomes: orChecked, review: orChecked }));
          setDimensionCoverage(bandCoverageNote(itemIds[0], itemIds, "This dimension assessment"));
        }
      }
      setRanAt(new Date().toLocaleString("en-SG"));
      // A finished run is always the one you are shown. Landing on an old
      // result after pressing "Check my area" would be the worst possible
      // default.
      setRunIndex(0);
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
  // those are session state, and the stored result carries its own runAt.
  const previous = useMemo(() => {
    const src = plan.kind === "procedure-only" ? ppdExisting : existing;
    if (!src || src.rows.length === 0 || !area) return null;
    const prevRows = plan.kind === "procedure-only"
      ? toProcedureRows((src as { rows: Parameters<typeof toProcedureRows>[0] }).rows)
      : toSelfCheckRows((src as { rows: Parameters<typeof toSelfCheckRows>[0] }).rows);
    // The auditor's committed band is a stored fact and survives. There is no
    // other band to lose: this page derives none.
    const committed = itemIdsForScope(area.scope).map((id) => checklistEntries[id]?.holisticBand).find((bd) => !!bd);
    const prevBand: SelfCheckBand = committed
      ? { kind: "auditor", band: committed.band, name: bandName(committed.band), totalPct: committed.totalPct }
      : { kind: "none" };
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

  // The file list in a download is the one on screen: a procedure-tab export
  // that carried the records pass's files would be the same merge the per-tab
  // table refuses.
  const exportFiles = tabFileRows;
  const exportTiming = shownRun?.duration ?? "";

  function onCsv() {
    if (!area) return;
    // The tab you are looking at is the tab you get, named on the file so two
    // downloads of the same run can never be confused for each other.
    // bandWorking rides on EVERY view now: the two half-tabs use it to draw
    // which dimension their own verdicts feed. Only the overall view prints the
    // full dimension panel and the coverage note.
    downloadCsv(buildSelfCheckCsv(`${area.scope} ${area.title}`, rows, band, view, exportFiles, bandWorking ?? undefined, view === "overview" ? bandCoverage : undefined, itemIdsForScope(area.scope), exportTiming, sameLink), selfCheckFilename(view === "overview" ? area.title : `${area.title} ${VIEW_LABEL[view]}`, "csv"));
  }
  function onPdf() {
    if (!area) return;
    const ok = printHtmlInNewTab(
      `<style>${PRINTABLE_DOC_CSS}</style>${buildSelfCheckHtml({
        areaLabel: `${area.scope} ${area.title}`, areaDescription: area.description,
        counts, band, rows, ranAt: shownRun?.label || ranAt, view, files: exportFiles,
        timing: exportTiming, sameLink,
        bandWorking: bandWorking ?? undefined,
        bandCoverage: view === "overview" ? bandCoverage : undefined,
        itemIds: itemIdsForScope(area.scope),
      })}`,
      view === "overview" ? `Self-check ${area.title}` : `Self-check ${area.title} — ${VIEW_LABEL[view]}`,
    );
    if (!ok) setNote(POPUP_BLOCKED_MESSAGE);
  }

  const liveDetail = plainDetail(evProgress?.detail || ppdProgress?.detail || "");
  // Which pass is live right now. The two passes each keep their own progress
  // object, and only one is running at a time.
  const liveProgress: RunProgress | undefined =
    phase === "policy" ? (ppdProgress ?? undefined)
      : phase === "outcomes" ? (orProgress?.detail ? { detail: orProgress.detail } : undefined)
      : (phase === "records" || phase === "band") ? (evProgress ?? undefined) : undefined;
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
  const visibleSteps = procedureOnlyResult
    ? STEPS.filter((s) => s.key !== "records" && s.key !== "outcomes" && s.key !== "band")
    : STEPS;
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
        // The band graphic's palette, as custom properties so the SAME markup
        // renders on a light card and on a dark one. The rest of this page is
        // light-only today; the graphic is written so it does not become
        // unreadable if the browser renders dark, rather than pretending the
        // app has a theme it does not have. The printed copy passes literal
        // colours instead (PRINT_BAND_PALETTE), so no dark-mode media query can
        // reach paper. Every other rule the SVG needs is an inline style.
        // The run history: one row per check, and the four count columns are a
        // FIXED width anchored from the right, so they line up down the list
        // and a reader can see a trend without opening anything. That is the
        // whole reason this is a list and not the card grid it used to be:
        // ten cards took 425px and showed four, with the counts wrapping.
        //
        // Each row is its OWN grid rather than the list being one big grid,
        // because that is what lets a row reflow on a phone independently
        // while the fixed right-hand columns still align on a wide screen.
        ".sc-run-row{display:grid;grid-template-columns:minmax(0,1fr) 62px 124px 58px;align-items:center;column-gap:8px;line-height:17px}",
        ".sc-run-counts{display:grid;grid-template-columns:repeat(4,1fr);text-align:center}",
        `.sc-runs-box{max-height:${RUNS_BOX_HEIGHT}px;overflow-y:auto}`,
        // ── The requirement workspace ────────────────────────────────────
        // A list to choose from and one requirement in full, in place of four
        // narrow columns carrying requirement wording, reasoning, quotes,
        // source files, missing elements and remediation all at once.
        ".sc-view-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0 10px}",
        ".sc-view-tab{border:1px solid;border-radius:10px;padding:9px 12px;text-align:left;cursor:pointer;font:inherit}",
        ".sc-view-tab strong{display:block;font-size:13.5px;line-height:1.2}",
        ".sc-view-tab span{display:block;font-size:11.5px;margin-top:3px;line-height:1.35}",
        ".sc-workspace{display:grid;grid-template-columns:minmax(210px,248px) minmax(0,1fr);gap:14px;align-items:start;margin:12px 0}",
        // The list scrolls on its own and stays put while a long requirement is
        // read, so choosing the next one never means scrolling back up.
        ".sc-req-nav{border:1px solid #e2e8f0;border-radius:10px;background:#fff;position:sticky;top:12px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;overflow:hidden}",
        ".sc-req-nav-head{padding:9px 11px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;color:#0f172a;background:#f8fafc}",
        ".sc-req-nav-list{overflow-y:auto;padding:5px}",
        ".sc-req-link{display:grid;grid-template-columns:9px minmax(0,1fr);gap:1px 8px;align-items:center;width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:7px 8px;cursor:pointer;font:inherit}",
        ".sc-req-link:hover{background:#f8fafc}",
        ".sc-req-dot{width:9px;height:9px;border-radius:50%;grid-row:1/3}",
        ".sc-req-code{font-size:12px;font-weight:800;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".sc-req-state{font-size:11px;font-weight:700}",
        ".sc-req-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:15px 17px;min-width:0}",
        ".sc-req-summary{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:16px;margin-top:12px}",
        ".sc-req-eyebrow{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-bottom:4px}",
        // One column below the width where two make the prose too narrow, and
        // the list becomes a short scrolling strip above the card rather than a
        // sidebar pushed off-screen.
        "@media (max-width: 900px){",
        ".sc-view-tabs{grid-template-columns:1fr}",
        ".sc-workspace{grid-template-columns:1fr}",
        ".sc-req-nav{position:static;max-height:230px}",
        ".sc-req-summary{grid-template-columns:1fr;gap:12px}",
        "}",
        // The delete control is quiet until it is pointed at. Nine red words
        // down a dense list would compete with the counts, which are the whole
        // reason for the list, and would advertise the one control here that
        // destroys something.
        ".sc-run-del button{color:#64748b}",
        ".sc-run-row[data-here] .sc-run-del button{color:#cbd5e1}",
        ".sc-run-del button:hover,.sc-run-del button:focus-visible{color:#b91c1c;text-decoration:underline}",
        ".sc-run-row[data-here] .sc-run-del button:hover,.sc-run-row[data-here] .sc-run-del button:focus-visible{color:#fecaca}",
        // Below this width a four-column table is unreadable, so the row
        // becomes two lines: check and date over take and counts, with the
        // delete control staying top right and away from the row's own
        // click target.
        "@media (max-width: 640px){",
        ".sc-run-row{grid-template-columns:minmax(0,1fr) auto;row-gap:2px;padding:3px 0}",
        ".sc-run-row>.sc-run-when{grid-column:1;grid-row:1}",
        ".sc-run-row>.sc-run-del{grid-column:2;grid-row:1;text-align:right}",
        ".sc-run-row>.sc-run-took{grid-column:1;grid-row:2;text-align:left}",
        ".sc-run-row>.sc-run-counts{grid-column:2;grid-row:2;width:124px}",
        ".sc-runs-head{display:none}",
        // A phone row is two lines, so the same box would hold four runs, which
        // is the number this redesign exists to beat. Half as much again holds
        // six and still keeps the panel inside one screen.
        `.sc-runs-box{max-height:${Math.round(RUNS_BOX_HEIGHT * 1.5)}px}`,
        "}",
        ".sc-band-graphic{--g-ink:#1f2733;--g-mute:#64748b;--g-track:#e2e8f0;--g-on:#7c3aed;--g-hatch-bg:#f1f5f9;--g-hatch-line:#cbd5e1;--g-surface:#fff;--g-edge:#e2e8f0}",
        "@media (prefers-color-scheme: dark){.sc-band-graphic{--g-ink:#e2e8f0;--g-mute:#94a3b8;--g-track:#334155;--g-on:#a78bfa;--g-hatch-bg:#1e293b;--g-hatch-line:#475569;--g-surface:#0f172a;--g-edge:#334155}}",
      ].join("")}</style>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 25, margin: "0 0 6px", color: INK }}>Check your area before the audit</h1>
          <p style={{ ...muted, margin: 0, fontSize: 14 }}>
            A practice run on your own documents, so you can fix things before the real audit. It takes a few minutes.
          </p>
          {/* Which build this is. Not a number anybody maintains: it comes from
              the commit the bundle was built from (lib/buildInfo.ts). Two of
              the three "the fix did not work" reports on this project were a
              browser holding the previous bundle, and there was no way to see
              that from the page. Quiet, but on the first screen rather than
              behind a developer toggle, because the person who needs it is the
              one reporting the problem. */}
          <p style={{ ...muted, margin: "6px 0 0", fontSize: 11.5 }} title="The version of this page you are looking at. Quote it if you report a problem.">
            Build <span style={{ fontFamily: "ui-monospace,monospace" }}>{buildLabel()}</span>
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
          <select value={scope} onChange={(e) => { setScope(e.target.value); setRunIndex(0); setConfirmDelete(null); setAllRuns(false); setPhase("idle"); setError(null); setConfirmOverwrite(false); }}
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
          {/* Whether this area has been checked before, as soon as it is
              picked. It answers the returning user's first question without
              running anything and without scrolling past a full result. */}
          {area && (
            <RunHistory
              runs={runs} viewingRun={viewingRun} setRunIndex={setRunIndex}
              allRuns={allRuns} setAllRuns={setAllRuns}
              open={historyOpen} setOpen={setHistoryOpen}
              confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
              scope={scope} deleteSelfCheckRun={deleteSelfCheckRun} clearSelfCheckHistory={clearSelfCheckHistory}
              runDiff={runDiff} shownRun={shownRun}
            />
          )}
        </section>

        {/* 2 — two links, because the engine reads the two folders differently */}
        <section style={{ ...card, opacity: area ? 1 : 0.55 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={stepNum}>2</span><h2 style={h2}>Where are your documents?</h2>
          </div>
          <p style={{ ...muted, marginTop: 0 }}>
            Two folders are needed, because they answer two different questions: what you say you do, and what you
            actually did. They must be two DIFFERENT folders: one link in both boxes makes every document count as
            your written procedure and as your records at the same time, and a requirement then looks proved because
            your procedure says it happens.
          </p>
          {/* The check cannot tell a swapped pair from an honest "documented
              but no records" result: both were run, and both produce the same
              evidence-side signature down to the same comment. So the only
              honest help is at the point of entry, and this says what the two
              boxes mean in four words each and what going wrong looks like. */}
          <p style={{ ...muted, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", margin: "8px 0 0" }}>
            <b>Getting these the wrong way round is easy to do and hard to spot.</b> The check reads the first
            box looking for what you promise and the second looking for proof it happened, and it cannot tell a
            swapped pair from an area with no records yet. If almost every line comes back the same way and the
            reasons keep saying the records were policy wording, check the two boxes before you believe the result.
          </p>
          <div style={{ height: 6 }} />

          <LinkField
            label="Where is your written procedure?"
            help="What you SAY you do. The document that sets out how this area is meant to work: your policy, your procedure, your handbook or your terms of reference. Not minutes, registers, logs or reports, even when they are about this area: those go in the second box."
            value={procLink} onChange={setProcLink} state={procState} disabled={!area || running}
            onEdit={() => { setError(null); setConfirmOverwrite(false); }}
          />

          <div style={{ height: 18 }} />

          <LinkField
            label="Where is your evidence?"
            help="What you actually DID. The records that show it happening: minutes, forms, logs, registers, signed copies, reports and emails. Not your policy or procedure documents, even when their names mention records: those go in the first box."
            value={evLink} onChange={setEvLink} state={evState} disabled={!area || running}
            onEdit={() => { setError(null); setConfirmOverwrite(false); }}
          />

          {/* A third box for a separate results-and-review folder was here for
              one commit. It was removed because this folder already holds what
              it asked for: internal audit reports, review minutes, CAP logs and
              KPI data are records. Asking for them again meant splitting one
              folder in two or pasting the same link twice, which is the mistake
              the paragraph above warns about. A stored link from that commit is
              not silently ignored. */}
          {folder?.outcomeLink && (
            <p style={{ ...muted, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", margin: "12px 0 0" }}>
              A separate results and review folder was linked here before. It is no longer needed and is not read:
              this check now looks for your results and review records in the records folder above, which is where
              they usually live.
            </p>
          )}

          {/* What will and will not be checked, said before the button rather
              than discovered afterwards. */}
          {/* BEFORE the run, not only after it. The result-side warning still
              prints, but by then the check has already read the procedure as
              its own record and the auditor has a result they should not
              file. */}
          {sameLink && (
            <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px", margin: "8px 0 0" }}>
              <b>Both boxes hold the same folder.</b> Every document in it will be treated as your written procedure
              AND as your records, so a requirement can come back proved because your procedure says it happens rather
              than because a record shows it happening. Point the two boxes at two different folders before running.
            </p>
          )}
          {plan.note && (
            <p style={{
              ...muted, marginBottom: 0, marginTop: 14, padding: "9px 11px", borderRadius: 8,
              background: plan.canRun ? (plan.kind === "full" ? "#f0fdf4" : "#fffbeb") : "#fef2f2",
              border: `1px solid ${plan.canRun ? (plan.kind === "full" ? "#bbf7d0" : "#fde68a") : "#fecaca"}`,
              color: plan.canRun ? (plan.kind === "full" ? "#166534" : "#92400e") : "#991b1b",
            }}>
              {plan.note}
              {plan.kind === "full" && " I will then read the same documents again looking for results and review records, and report what they show for the two areas this check used to leave alone."}
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
                {resultAtRisk && `The check you have now stays: it moves into the list of earlier checks on the result below, and you can open it whenever you like. What changes is which one counts as the current ${plan.kind === "procedure-only" ? "written procedure check" : "result"} for this area, and the current one is what your audit lead sees. ${runs.length >= OPTION_A_RUN_HISTORY_CAP + 1 ? `This area is already keeping ${runs.length} checks, which is the most it holds, so the oldest one drops off. ` : ""}`}
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
                        <span style={{ width: 18 }}>{state === "done" ? "✓" : state === "now" ? "!" : "○"}</span>
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
              {area.scope} {area.title} · {procedureOnlyResult ? "written procedure only" : "procedure and records"} · checked {shownRun?.label || ranAt}
              {shownRun?.duration && ` · took ${shownRun.duration}`}
            </p>

            {/* AT THE TOP, before a single verdict. This used to sit below the
                export buttons, at 99% of the page: by the time a reader met it
                they had already read and believed the whole result.

                What a failed extraction call actually does, established by
                running it: every line in the failed batch is added to
                extractFailedRefs (agentRuntime.ts:2725) and any such line that
                reaches no verdict comes back "Not assessed", never the
                fabricated "Not documented" gap. So an incomplete run UNDER-
                reports rather than invents, and the honest thing to say is
                which lines are missing answers rather than gaps. */}
            {incompleteNote && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "11px 13px", margin: "10px 0 0" }}>
                <b style={{ fontSize: 13.5, color: "#92400e" }}>Part of this check did not complete, so this result is incomplete</b>
                <p style={{ ...muted, margin: "6px 0 0", color: "#92400e" }}>{incompleteNote}</p>
                {/* What is ACTUALLY affected, counted off the rows rather than
                    asserted. A failed pass never writes a gap: the lines it
                    covered come back with no verdict on that side, and their
                    overall result is capped rather than failed. Both shapes are
                    named because they read differently on the tabs. */}
                {counts.couldNotCheck > 0 && (
                  <p style={{ ...muted, margin: "6px 0 0", color: "#92400e" }}>
                    {counts.couldNotCheck} of the {counts.total} requirement {counts.total === 1 ? "line" : "lines"} below came back <b>could not check</b>.
                    Those are missing answers, not gaps: nothing that failed was recorded as a fault in your area.
                  </p>
                )}
                {unjudgedProcedure > 0 && (
                  <p style={{ ...muted, margin: "6px 0 0", color: "#92400e" }}>
                    {unjudgedProcedure} of the {counts.total} requirement {counts.total === 1 ? "line" : "lines"} below reached <b>no verdict on the procedure side</b>.
                    Their overall result is held at <b>partly complies</b> for that reason alone, and none of them is a finding that your procedure is missing.
                  </p>
                )}
                <p style={{ ...muted, margin: "6px 0 0", color: "#92400e" }}>
                  Run the check again before relying on this result.
                </p>
              </div>
            )}

            {/* The check asks two separate questions and they fail
                independently: your procedure can be silent while your records
                are full, and the other way round. Blended into one verdict that
                difference was invisible, and the fix for each is different. */}
            {/* Each tab carries its own one-line hint, so all three meanings
                are readable whichever one is open, and the active tab's fuller
                sentence follows as the subheader. A reader could previously see
                three tabs and not know what Overall was for. */}
            {!procedureOnlyResult && (
              <div className="sc-view-tabs">
                {(["overview", "procedure", "records"] as const).map((k) => (
                  <button
                    key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                    className="sc-view-tab"
                    style={{
                      borderColor: tab === k ? INK : "#cbd5e1", background: tab === k ? INK : "#fff",
                      color: tab === k ? "#fff" : INK,
                    }}
                  >
                    <strong>{k === "overview" ? "Overall" : VIEW_LABEL[k]}</strong>
                    <span style={{ color: tab === k ? "#dbe3ef" : "#64748b" }}>{TABS_EXPLAINED[k].hint}</span>
                  </button>
                ))}
              </div>
            )}

            {!procedureOnlyResult && (
              <p style={{ ...muted, margin: "0 0 10px" }}>
                <b style={{ color: INK }}>{tab === "overview" ? "Overall" : VIEW_LABEL[tab]}:</b> {TABS_EXPLAINED[tab as "overview" | "procedure" | "records"].text}
              </p>
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
                {/* The rule itself is stated once, under the tabs. This says
                    only what each COUNT means, which that sentence does not. */}
                <p style={{ ...muted, margin: "7px 0 0" }}>
                  Documented but no records means the procedure is fine and the proof is missing. Records but nothing documented means it happens but the procedure does not say so. The Procedure and Records tabs show which requirement is which.
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

            {/* THE BAND, and the one condition for showing one: all four
                dimensions carry a real score from THIS run, which can only
                happen when the results-and-review pass ran and read something.
                Two of four is not a total, and a total built on two understates
                a well-run area by one to two bands, which is why this page went
                without a band at all (9f63527) until all four could be scored.
                The arithmetic is printed beside it: a band nobody can check is
                a number to argue with rather than read. */}
            {view === "overview" && selfTotal && (
              <div style={{ border: "2px solid #c7d2fe", borderRadius: 10, padding: 14, margin: "12px 0", background: "#eef2ff" }}>
                <b style={{ fontSize: 15, color: INK }}>Band {selfTotal.band} of 5, {bandName(selfTotal.band)}</b>
                <p style={{ ...muted, margin: "5px 0 0", color: "#3730a3" }}>
                  <b>{selfCheckTotalWorking(selfTotal)}</b>. That is Approach, Processes, Systems &amp; Outcomes and Review added up, each worth up to {bandWorking?.maxPct ?? 25}%.
                  The four are broken out below.
                </p>
                <p style={{ ...muted, margin: "5px 0 0", color: "#3730a3" }}>
                  This is this tool's reading of your own documents, not an SSG result and not your audit lead's band. {SELF_CHECK_DISCLAIMER}
                </p>
                {bandCoverage && <p style={{ ...muted, margin: "5px 0 0", color: "#3730a3" }}>{bandCoverage}</p>}
              </div>
            )}
            {view === "overview" && !selfTotal && dimensionsChecked === false && bandWorking && (
              <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px" }}>
                {NO_BAND_WITHOUT_FOUR_NOTE}
              </p>
            )}

            {view === "overview" && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fbfcfe" }}>
              {band.kind === "none" ? (
                <>
                  <b style={{ fontSize: 14 }}>{selfTotal ? "Your audit lead has not recorded a band for this area" : "This check gives no band"}</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>{selfTotal ? "The band above is this check's own working. When your audit lead records one for this area it appears here beside it." : NO_BAND_LINE}</p>
                </>
              ) : (
                <>
                  <b style={{ fontSize: 14 }}>Band {band.band} of 5, {band.name}</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>
                    This is the band your audit lead has already recorded for this area. It is not a result of this check.
                    {" "}{SELF_CHECK_DISCLAIMER}
                  </p>
                  {/* Which requirement item the number belongs to. Shown on the
                      card as well as in the working below, because a committed
                      auditor band has no working panel to carry it. */}
                  {bandCoverage && <p style={{ ...muted, margin: "5px 0 0" }}>{bandCoverage}</p>}
                </>
              )}
            </div>
            )}

            {/* Every file THIS TAB's pass read, open by default and tickable
                down the list. It used to be a closed disclosure that only
                opened itself when something was unreadable, so on a clean run
                an auditor saw one line and had to know to click it.

                It sits BELOW the verdicts it backs: open and above them it put
                the findings table a full screen down the page, which is what
                the last redesign was for. The unreadable-files warning still
                prints above the verdicts, because it changes how they read.

                Per pass, never merged: a file the records pass read is not
                evidence the procedure pass read it, and merging the two would
                be the same class of error as merging their chunk maps. The
                overall tab keeps the merged view, which answers the different
                question of what the whole check opened. */}
            <FileTable rows={tabFileRows} perPass={view !== "overview"} sameLink={sameLink} open={filesOpen} setOpen={setFilesOpen} />

            {/* The shape of the tab before a single row is read, and which
                dimension this tab's own verdicts feed. Both were on the overall
                tab only, and the procedure and records tabs are where the
                reading time actually goes. */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", margin: "10px 0", background: "#fff", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 400px", minWidth: 0 }}>
                <Svg html={tallyBarSvg(tallySlices(counts, view), SCREEN_BAND_PALETTE)} />
              </div>
              {feedsFor(view) && bandWorking && (
                <div style={{ flex: "1 1 460px", minWidth: 0 }}>
                  <Svg html={bandGraphicSvg(bandGraphic(bandWorking), SCREEN_BAND_PALETTE, { feeds: feedsFor(view) })} />
                  <p style={{ ...muted, margin: "4px 0 0", fontSize: 11.5 }}>{feedsFor(view)!.caption}</p>
                </div>
              )}
            </div>

            {/* Read BEFORE the table. An auditor could not tell whether
                "Written down" meant compliant, and the honest answer is that
                each tab settles half the question. */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 13px", margin: "12px 0", background: "#fff" }}>
              <b style={{ fontSize: 13 }}>What each result means on this tab</b>
              <div style={{ display: "grid", gap: 5, marginTop: 7, gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
                {VERDICT_LEGEND[view].map((l) => (
                  <div key={l.label} style={{ display: "flex", gap: 9, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ ...TONE_BG[LEGEND_TONE[l.icon]], padding: "1px 8px", borderRadius: 999, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{l.icon} {l.label}</span>
                    <span style={{ color: "#475569" }}>{l.meaning}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* THE REQUIREMENT WORKSPACE, in place of the four-column table.
                The table put requirement wording, verdict, reasoning, quoted
                passages, source files, missing elements and remediation into
                four narrow columns, which made rows hundreds of pixels tall and
                forced horizontal scanning across every one of them. One
                requirement is now read at a time, chosen from a list that can
                be scanned in a glance.

                The rows are the SAME rows the table had, and they are already
                per-tab: toSelfCheckRows / toProcedureRows / toRecordsRows. So
                switching tab rebuilds the list, every sidebar status, the
                selected requirement's status and everything in the card, with
                no new assessment logic anywhere. */}
            {/* No key on the view: remounting per tab threw the reader back to
                the first requirement every time they switched, which defeats
                the whole point of being able to see which layer has the
                problem on ONE line. The selection is held by ref instead. */}
            <RequirementWorkspace
              rows={rows}
              selectedRef={selectedRef}
              setSelectedRef={setSelectedRef}
              view={view}
            />

            {/* The two dimensions this check can defend, and the two it leaves
                alone. It shows no overall band: scoring Systems & Outcomes and
                Review at the bottom for never having been opened understated a
                genuinely Band 4 area as Band 3, which is an absence of
                assessment presented as a judgement. The rows-to-dimension step
                is a judgement and not arithmetic, and the note says so rather
                than drawing an arrow that does not exist. */}
            {view === "overview" && bandWorking && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "13px 15px", margin: "14px 0 0", background: "#fff" }}>
                <b style={{ fontSize: 14 }}>What this check assessed</b>
                <Svg html={bandGraphicSvg(bandGraphic(bandWorking), SCREEN_BAND_PALETTE, { minWidth: 430 })} />
                {dimensionCoverage && <p style={{ ...muted, margin: "8px 0 2px" }}>{dimensionCoverage}</p>}
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                        <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "18%" }}>Dimension</th>
                        <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "9%" }}>Band</th>
                        <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "12%" }}>Earned</th>
                        <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "32%" }}>Official descriptor at that band</th>
                        <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0" }}>Where it came from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bandWorking.rows.map((d) => (
                        <tr key={d.key} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top", background: d.assessedHere ? undefined : "#f8fafc" }}>
                          <td style={{ padding: "8px 9px", fontWeight: 600 }}>
                            {d.label}
                            <div style={{ ...muted, fontSize: 11 }}>{d.definition}</div>
                          </td>
                          <td style={{ padding: "8px 9px" }}>{d.band === undefined ? <span style={muted}>not scored</span> : `Band ${d.band}`}</td>
                          <td style={{ padding: "8px 9px", fontWeight: 700 }}>
                            {d.assessedHere
                              ? `${d.pct}% of ${bandWorking.maxPct}%`
                              : <span style={{ ...muted, fontWeight: 400 }}>{NOT_ASSESSED_HERE}</span>}
                          </td>
                          <td style={{ padding: "8px 9px", color: "#475569" }}>{d.descriptor || <span style={muted}>—</span>}</td>
                          <td style={{ padding: "8px 9px", color: "#475569" }}>
                            {d.assessedHere
                              ? (d.reason || DIMENSION_SOURCE_CHECKED[d.key] || DIMENSION_SOURCE[d.key])
                              : <b style={{ color: "#92400e" }}>{DIMENSION_SOURCE[d.key]}</b>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ ...muted, marginBottom: 0 }}>{ROWS_DO_NOT_SUM_NOTE}</p>
                {/* One decision for all three surfaces (screen, CSV, print):
                    dimensionsNote reads the working, not the caller's idea of
                    what ran, so they cannot disagree. */}
                <p style={dimensionsChecked
                  ? { ...muted, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 8, padding: "9px 11px" }
                  : { ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px" }}>
                  {dimensionsNote(bandWorking)}
                </p>


                {/* What the other two dimensions need. Every line below is
                    either the Guidance Document's own wording, the official
                    expected-evidence list filtered to entries that name the
                    dimension, or a gap this run itself reported. */}
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 10, padding: "12px 14px", margin: "12px 0" }}>
                  <b style={{ fontSize: 13.5, color: "#1e40af" }}>What the full audit will look for</b>
                  <p style={{ ...muted, margin: "6px 0 2px", color: "#1e3a8a" }}>{dimensionsChecked ? IMPROVE_HEADLINE_CHECKED : IMPROVE_HEADLINE}</p>
                  <p style={{ ...muted, margin: "0 0 10px", color: "#1e3a8a" }}>{dimensionsChecked ? IMPROVE_WHY_CHECKED : IMPROVE_WHY}</p>
                  {unassessedDimensions(itemIdsForScope(area.scope)).map((d) => (
                    <div key={d.key} style={{ borderTop: "1px solid #bfdbfe", paddingTop: 9, marginTop: 9 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{d.label}</div>
                      <div style={{ ...muted, margin: "2px 0 6px" }}>{d.plainQuestion}</div>
                      <div style={{ ...muted, fontWeight: 700, color: "#475569" }}>What the Guidance Document asks for, at each band from here up</div>
                      <ul style={{ ...muted, margin: "3px 0 7px", paddingLeft: 17 }}>
                        {d.ladder.map((l) => <li key={l.band}><b>Band {l.band} {l.name}:</b> {l.descriptor}</li>)}
                      </ul>
                      {d.officialEvidence.length > 0 ? (
                        <>
                          <div style={{ ...muted, fontWeight: 700, color: "#475569" }}>On the official expected-evidence list for this requirement</div>
                          <ul style={{ ...muted, margin: "3px 0 0", paddingLeft: 17 }}>
                            {d.officialEvidence.map((e) => <li key={e}>{e}</li>)}
                          </ul>
                        </>
                      ) : (
                        <div style={{ ...muted }}>{d.noOfficialList}</div>
                      )}
                      {/* Review only. Every one of the 31 requirement items has
                          at least one official line asking whether the process
                          is reviewed, and this check has already judged them.
                          Systems & Outcomes gets no equivalent: the words that
                          would catch outcome lines also catch processes, and a
                          filter that wrong is a fabricated list. */}
                      {d.key === "review" && (
                        <div style={{ borderTop: "1px solid #bfdbfe", paddingTop: 9, marginTop: 9 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{REVIEW_FINDINGS_HEADING}</div>
                          <p style={{ ...muted, margin: "3px 0 7px" }}>{REVIEW_FINDINGS_INTRO}</p>
                          {reviewRows.length === 0 ? (
                            <div style={{ ...muted }}>{REVIEW_FINDINGS_NONE}</div>
                          ) : (
                            <div style={{ display: "grid", gap: 5 }}>
                              {reviewRows.map((r) => (
                                <div key={r.ref} style={{ display: "flex", gap: 9, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.5 }}>
                                  <span style={{ ...TONE_BG[r.tone], border: `1px solid ${TONE_BG[r.tone].fg}`, padding: "1px 8px", borderRadius: 6, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{r.icon} {r.label}</span>
                                  <span style={{ color: "#334155" }}>
                                    {r.requirement}
                                    <span style={{ ...muted, marginLeft: 6 }}>{r.ref}</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {runGaps.length > 0 && (
                    <div style={{ borderTop: "1px solid #bfdbfe", paddingTop: 9, marginTop: 9 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>What this run already told you is missing</div>
                      {reviewShapedGapNote(runGaps) && <p style={{ ...muted, margin: "3px 0 5px" }}>{reviewShapedGapNote(runGaps)}</p>}
                      <ul style={{ ...muted, margin: "3px 0 0", paddingLeft: 17 }}>
                        {runGaps.slice(0, 8).map((g, i) => <li key={`${g.ref}-${i}`}><b>{g.ref}</b> {g.text}</li>)}
                      </ul>
                      {runGaps.length > 8 && <div style={{ ...muted, marginTop: 4 }}>and {runGaps.length - 8} more in the table above.</div>}
                    </div>
                  )}
                </div>

                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: INK }}>The official band scale, for all four dimensions</summary>
                  <div style={{ overflowX: "auto", marginTop: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                          <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0", width: "16%" }}>Band</th>
                          <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Approach</th>
                          <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Processes</th>
                          <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Systems &amp; Outcomes</th>
                          <th style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {BAND_LADDER.map((b) => {
                          return (
                            <tr key={b.band} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top" }}>
                              <td style={{ padding: "7px 8px" }}>Band {b.band} {b.name}</td>
                              <td style={{ padding: "7px 8px", color: "#475569" }}>{b.approach}</td>
                              <td style={{ padding: "7px 8px", color: "#475569" }}>{b.processes}</td>
                              <td style={{ padding: "7px 8px", color: "#475569" }}>{b.systemsOutcomes}</td>
                              <td style={{ padding: "7px 8px", color: "#475569" }}>{b.review}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
                <p style={{ ...muted, marginBottom: 0, marginTop: 8 }}>{INFERRED_THRESHOLDS_NOTE}</p>
              </div>
            )}

            {/* OUTSIDE the band panel above, deliberately. That panel only renders
                when the run judged something, and a run where nothing could be read
                judges nothing — which is exactly when this block's reason needs
                to be on screen. Nested inside it, the reason was invisible in
                the one case it exists for.

                Three states, and only one of
                    them licenses a negative finding: a folder that was linked
                    and read. The other two name the reason instead, because
                    "Not evident" is the bottom of the scale downstream and an
                    unlooked-at dimension must never land there.

                    The two dimensions are reported DIFFERENTLY on purpose.
                    Review has an official spine: 42 of the 200 Describe/Show
                    lines ask whether a process is reviewed, and all 31
                    requirement items carry one, so its result is per line.
                    Systems & Outcomes has none: an outcome-word filter over the
                    same 200 lines is wrong about 9 of the 11 it catches, so
                    there is no list to check against and its result is reported
                    for the scope as a whole, against the official descriptors
                    alone. Forcing the two into the same shape would mean
                    inventing the list this page has twice refused to invent. */}
            {view === "overview" && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", margin: "12px 0", background: "#fff" }}>
                  <b style={{ fontSize: 13.5 }}>Your results and review records</b>
                  {outcomeState.state !== "assessed" ? (
                    <p style={{ ...muted, margin: "6px 0 0" }}>{outcomeState.reason}</p>
                  ) : (
                    <>
                      <p style={{ ...muted, margin: "6px 0 10px" }}>
                        Read from the same documents listed at the top of this result, looked at a second time for results and review records.
                        {" "}{outcomeTally.total} {outcomeTally.total === 1 ? "point" : "points"} of the official requirement were checked for both.
                      </p>

                      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 9 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Review, requirement by requirement</div>
                        <p style={{ ...muted, margin: "3px 0 7px" }}>
                          These are the official GD4 lines asking whether a process is reviewed for continual improvement.
                          A tick means a record of a review having happened was found and quoted. A procedure that says a review will happen is not one.
                        </p>
                        {outcomeReviewLines.length === 0 ? (
                          <p style={{ ...muted, margin: 0 }}>This area&rsquo;s review lines were not among the ones the pass judged, so there is nothing to report here.</p>
                        ) : (
                          <div style={{ display: "grid", gap: 5 }}>
                            {outcomeReviewLines.map((r) => (
                              <div key={r.ref} style={{ display: "flex", gap: 9, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.5 }}>
                                <span style={{
                                  // "critical", not "bad": TONE_BG is keyed by
                                  // the row tones this page already uses, and a
                                  // missing key reads back undefined and throws
                                  // on .fg, blanking the whole result.
                                  ...TONE_BG[r.reviewEvident ? "good" : "critical"], border: `1px solid ${TONE_BG[r.reviewEvident ? "good" : "critical"].fg}`,
                                  padding: "1px 8px", borderRadius: 6, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                                }}>
                                  {r.reviewEvident ? "✓ record found" : "✗ none found"}
                                </span>
                                <span style={{ color: "#334155" }}>
                                  {r.pointText}
                                  <span style={{ ...muted, marginLeft: 6 }}>{r.ref}</span>
                                  {r.note && <div style={{ ...muted, fontSize: 11.5 }}>{r.note}</div>}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 9, marginTop: 9 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Systems &amp; Outcomes, for this area as a whole</div>
                        <p style={{ ...muted, margin: "3px 0 7px" }}>
                          Outcome data means real figures, results or trends covering the period, not a statement that outcomes will be tracked.
                          It was found for <b>{outcomeTally.withOutcome} of the {outcomeTally.total}</b> points checked.
                          This is reported for the area as a whole rather than line by line: the official requirement text for this area does not itemise what outcome evidence should look like, so there is no official list to tick off, and inventing one would be fabricating an official expectation.
                        </p>
                      </div>

                      {(outcomeShown?.runWarnings?.length ?? 0) > 0 && (
                        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 9, marginTop: 9 }}>
                          {/* Files this pass could not get text for. Named, not
                              counted into a silent absence. */}
                          {outcomeShown!.runWarnings!.map((w, i) => (
                            <p key={i} style={{ ...muted, margin: "2px 0 0", color: "#92400e" }}>{w}</p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
            )}

            {/* What good looks like, from the official published list and
                nothing else. Once per requirement item, because that is the
                granularity the list is published at. */}
            {expectedGroups.length > 0 && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", margin: "14px 0 0", background: "#f8fafc" }}>
                <b style={{ fontSize: 13.5 }}>What a passing record contains</b>
                <p style={{ ...muted, margin: "4px 0 8px" }}>
                  The official EduTrust GD4 expected-evidence list, quoted as published. It is not a judgement on anything you hold.
                </p>
                {expectedGroups.map((g) => (
                  <div key={g.itemId} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>Requirement {g.itemId}</div>
                    <ul style={{ ...muted, margin: "2px 0 0", paddingLeft: 17 }}>
                      {g.items.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={onPdf} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px" }}>⬇ Download as PDF</button>
              <button type="button" onClick={onCsv} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px", background: "#fff", color: INK, border: "1px solid #cbd5e1" }}>⬇ Download as spreadsheet (CSV)</button>
            </div>
            {note && <p style={{ ...muted, color: "#92400e", marginBottom: 0 }}>{note}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

const FILE_TONE: Record<SelfCheckFileRow["outcome"], string> = { read: "good", check: "medium", unreadable: "critical" };
// The legend chips carry the same colour as the rows they explain, keyed off
// the glyph so the two can never drift apart.
const LEGEND_TONE: Record<string, string> = { "✓": "good", "!": "medium", "✗": "critical", "?": "neutral" };

// The working behind one verdict: the passage that satisfied it and where it
// came from, or the named element that is missing, or why nothing could be
// decided. All of it is read off the row the engine already produced; none of
// it is written here, which is why a row with no breakdown says exactly that
// instead of filling the space.
// The Why cell, as four separable things rather than one block.
//
// It held the reasoning paragraph, a quote embedded mid-sentence, a "Quoted:"
// line repeating that same quote, and a run-on "Missing:" paragraph that on
// some lines concatenated fifteen elements. Single cells were taller than the
// viewport and nothing in them could be skipped.
//
// Each part is now its own block, the long ones open on demand, and NOTHING is
// clipped: every disclosure opens to the full text, and both exports print all
// of it regardless. An auditor may have to defend any word of it.
const MISSING_SHOWN = 3;
const LONG_REASONING = 320;

function Disclosure({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#475569" }}>{summary}</summary>
      <div style={{ marginTop: 5 }}>{children}</div>
    </details>
  );
}

// One requirement at a time: a list to choose from, and the chosen one in full.
//
// Everything here comes off the SelfCheckRow the table already had. Nothing is
// re-judged, re-worded or re-counted, and the supporting detail is the existing
// WhyCell verbatim, so the disclosures, the quote de-duplication and the
// "show all N missing" control behave exactly as they did.
function RequirementWorkspace({ rows, selectedRef, setSelectedRef, view }: {
  rows: SelfCheckRow[];
  selectedRef: string;
  setSelectedRef: (r: string) => void;
  view: SelfCheckView;
}) {
  // The chosen row, or the first one. Falling back rather than showing nothing
  // matters on a tab switch and on a rerun, where the stored ref may not exist
  // in the new list.
  const selected = rows.find((r) => r.ref === selectedRef) ?? rows[0];
  if (!selected) return null;
  const fixLabel = view === "procedure" ? "What to write" : "What to do";
  return (
    <div className="sc-workspace">
      <nav className="sc-req-nav" aria-label="Requirements">
        <div className="sc-req-nav-head">Requirements <span style={{ ...muted, fontWeight: 400 }}>({rows.length})</span></div>
        <div className="sc-req-nav-list">
          {rows.map((r) => {
            const here = r.ref === selected.ref;
            return (
              <button
                key={r.ref} type="button" onClick={() => setSelectedRef(r.ref)} aria-current={here || undefined}
                className="sc-req-link"
                style={{ background: here ? "#eef2ff" : undefined, borderColor: here ? "#c7d2fe" : "transparent" }}
              >
                {/* The state travels as a glyph AND a word AND a colour, the
                    same three ways it does on the card. */}
                <span aria-hidden className="sc-req-dot" style={{ background: TONE_BG[r.tone].fg }} />
                <span className="sc-req-code" style={{ color: INK }}>{r.ref}</span>
                <span className="sc-req-state" style={{ color: TONE_BG[r.tone].fg }}>{r.icon} {r.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <article className="sc-req-card" style={{ borderLeft: `5px solid ${TONE_BG[selected.tone].fg}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{ ...TONE_BG[selected.tone], border: `2px solid ${TONE_BG[selected.tone].fg}`, padding: "5px 11px", borderRadius: 8, fontSize: 13.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 7, lineHeight: 1.25 }}
          >
            <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>{selected.icon}</span>{selected.label}
          </span>
          <span style={{ ...muted, fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{selected.ref}</span>
        </div>
        <h3 style={{ fontSize: 16.5, lineHeight: 1.4, margin: "10px 0 0", color: INK, fontWeight: 700 }}>{selected.requirement}</h3>

        <div className="sc-req-summary">
          <div>
            <div className="sc-req-eyebrow">{SUMMARY_LABEL[selected.summaryKind] || "What was found"}</div>
            {/* The summary ONLY. Where the engine wrote none, WhyCell below
                prints the full reasoning open, exactly as it always did; both
                printing it would show the same prose twice. */}
            <p style={{ margin: 0, color: "#334155", fontSize: 13.5, lineHeight: 1.62 }}>
              {selected.summary || <span style={muted}>{selected.why ? "No short summary was written. The full reasoning is below." : "No reason recorded."}</span>}
            </p>
          </div>
          <div>
            <div className="sc-req-eyebrow">{fixLabel}</div>
            <p style={{ margin: 0, color: "#334155", fontSize: 13.5, lineHeight: 1.62 }}>
              {selected.fix || <span style={muted}>{selected.tone === "good" || selected.tone === "neutral" ? "Nothing to do for this one." : "The check did not suggest anything specific here. Ask your audit lead what would close it."}</span>}
            </p>
          </div>
        </div>

        {/* The reasoning gets its own labelled section rather than trailing
            under the summary with nothing to say what it is, and folds like
            every other piece of supporting detail. */}
        <div style={{ borderTop: "1px solid #eef2f7", marginTop: 12, paddingTop: 6 }}>
          {selected.why && (
            <Disclosure summary="Why this verdict">
              <span style={{ color: "#334155" }}>{selected.why}</span>
            </Disclosure>
          )}
          {/* Everything else, unchanged: the same component the table cell used,
              so every disclosure stays shut by default and every quote is still
              shown once. */}
          <WhyCell key={`${view}-${selected.ref}`} row={selected} showProse={false} />
        </div>
      </article>
    </div>
  );
}

// `showProse: false` leaves out the summary and the reasoning, which the
// requirement card prints itself under its own headings. Everything else (the
// cap note, the quotes, the missing elements, the weaker file-only citations)
// is identical either way.
function WhyCell({ row, showProse = true }: { row: SelfCheckRow; showProse?: boolean }) {
  const w = row.working;
  const quotes = w?.citations ?? [];
  // A weaker citation: files named with no verified excerpt. Still real, so
  // still shown, just not as a quotation.
  const citedOnly = quotes.length === 0 ? citedText(w) : "";
  const missing = w?.missing ?? [];
  const otherMissing = missing.length === 0 ? missingText(w) : "";
  const unchecked = row.verdict === "Not assessed";
  const missingLabel = unchecked ? "Why not" : "What is missing";
  const [allMissing, setAllMissing] = useState(false);
  const shown = allMissing ? missing : missing.slice(0, MISSING_SHOWN);
  const reasoning = row.why || "";
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
      {showProse && row.summary && (
        <div style={{ marginBottom: 5 }}>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>{SUMMARY_LABEL[row.summaryKind]}: </span>
          <span style={{ color: "#1f2937" }}>{row.summary}</span>
        </div>
      )}
      {showProse && !reasoning && !row.summary && <span style={muted}>No reason recorded.</span>}
      {showProse && reasoning && (row.summary && reasoning.length > LONG_REASONING
        // Only collapsed where a one-line summary already stands in for it.
        // With no summary the reasoning IS the answer and stays open.
        ? <Disclosure summary="Why this verdict"><span style={{ color: "#334155" }}>{reasoning}</span></Disclosure>
        : <div style={{ color: "#334155" }}>{reasoning}</div>)}
      {row.cappedNote && (
        // Verbatim, never trimmed: on a line with fifteen unmet promises it
        // re-lists all fifteen, and those same fifteen are the list below. It
        // is folded rather than shortened, because an auditor defending the
        // verdict may need the engine's exact words.
        <Disclosure summary="Why this could not be higher">
          <span style={{ color: "#475569" }}>{row.cappedNote}</span>
        </Disclosure>
      )}
      {quotes.length > 0 && (
        <Disclosure summary={`Quoted from your documents (${quotes.length})`}>
          {quotes.map((c, i) => (
            <blockquote key={`${c.file}-${i}`} style={{ margin: "0 0 6px", paddingLeft: 9, borderLeft: "3px solid #bbf7d0", color: "#475569", fontStyle: "italic" }}>
              {c.quote}
              <div style={{ ...muted, fontStyle: "normal", marginTop: 2 }}>{c.file}</div>
            </blockquote>
          ))}
        </Disclosure>
      )}
      {citedOnly && <div style={{ ...muted, marginTop: 5 }}>{citedOnly}</div>}
      {missing.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {/* A line nothing could be decided for has no missing ELEMENT — it
              has a reason, and colouring it as a gap would be the same error
              as counting it as one. */}
          <div style={{ fontWeight: 700, color: unchecked ? "#475569" : "#991b1b" }}>{missingLabel} ({missing.length})</div>
          <ul style={{ margin: "3px 0 0", paddingLeft: 17, color: "#475569" }}>
            {shown.map((m, i) => (
              <li key={`${m.text}-${i}`} style={{ marginBottom: 3 }}>
                <span style={{ color: "#1f2937" }}>{m.text}</span>{m.why ? ` — ${m.why}` : ""}
              </li>
            ))}
          </ul>
          {missing.length > MISSING_SHOWN && (
            <button
              type="button" onClick={() => setAllMissing((v) => !v)}
              style={{ marginTop: 4, background: "none", border: "none", padding: 0, color: "#1d4ed8", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
            >
              {allMissing ? "Show fewer" : `Show all ${missing.length}`}
            </button>
          )}
        </div>
      )}
      {otherMissing && (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontWeight: 700, color: unchecked ? "#475569" : "#991b1b" }}>{missingLabel}: </span>
          <span style={{ color: "#475569" }}>{otherMissing}</span>
        </div>
      )}
    </div>
  );
}

// What one pass read, as a list an auditor can tick down.
//
// Collapsed by default: on a folder of any size this is the longest thing on
// the tab, and it answers a question ("did Drive actually open everything?")
// that a reader asks occasionally, not every time. The count is on the header
// so the shut state still answers it roughly.
//
// The UNREADABLE warning does NOT collapse with it. A gap reported against a
// file that was never read is not a real gap, and a warning that only appears
// when the panel happens to be open is not a warning. Shut and clean the header
// is one line; shut with failures it names the files. Unreadable rows still
// carry a tint AND a word AND a cross inside.
function FileTable({ rows, perPass, sameLink, open, setOpen }: {
  rows: SelfCheckFileRow[]; perPass: boolean; sameLink: boolean;
  open: boolean; setOpen: (v: boolean) => void;
}) {
  if (rows.length === 0) return null;
  const counts = countFileRows(rows);
  const warning = unreadableWarning(counts);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ border: "1px solid #e2e8f0", borderRadius: 10, margin: "12px 0", background: "#fff", borderColor: counts.unreadable > 0 ? "#fde68a" : "#e2e8f0" }}
    >
      <summary style={{ cursor: "pointer", listStyle: "revert", padding: "10px 13px" }}>
        <b style={{ fontSize: 13.5, color: INK }}>{perPass ? "Every file this tab read" : "Every file this check read"}</b>
        {/* Each count is its own nowrap unit, so a narrow screen breaks
            BETWEEN them rather than through "1 could not be read". */}
        <span style={{ ...muted, fontWeight: 400, marginLeft: 8 }}>
          <span style={{ whiteSpace: "nowrap" }}>{counts.read} read</span>
          {counts.check > 0 && <> · <span style={{ whiteSpace: "nowrap" }}>{counts.check} worth checking</span></>}
          {counts.unreadable > 0 && <> · <span style={{ whiteSpace: "nowrap" }}>{counts.unreadable} could not be read</span></>}
        </span>
        {warning && (
          <span style={{ ...muted, display: "block", marginTop: 6, color: "#92400e", fontWeight: 700 }}>{warning}</span>
        )}
      </summary>
      <div style={{ padding: "0 13px 13px" }}>
        {sameLink && (
          <p style={{ ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px", marginTop: 0 }}>
            {SAME_LINK_WARNING}
          </p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: 34 }} aria-label="Read" />
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0" }}>File</th>
                {!perPass && <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "14%" }}>Folder</th>}
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "15%" }}>Was it read?</th>
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "18%" }}>What came out</th>
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "10%" }}>Quoted</th>
                <th style={{ padding: "7px 9px", borderBottom: "1px solid #e2e8f0", width: "26%" }}>What to do about it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f, i) => {
                const m = fileCheckMark(f);
                return (
                  <tr key={`${f.bucket}-${f.name}-${i}`} style={{ borderBottom: "1px solid #f1f5f9", verticalAlign: "top", background: f.outcome === "unreadable" ? "#fef2f2" : undefined }}>
                    <td style={{ padding: "8px 9px", textAlign: "center" }}>
                      <span title={m.label} style={{ ...TONE_BG[FILE_TONE[m.tone]], display: "inline-block", width: 21, height: 21, lineHeight: "21px", borderRadius: 5, fontWeight: 800, fontSize: 13 }}>{m.mark}</span>
                    </td>
                    <td style={{ padding: "8px 9px" }}>{f.name}</td>
                    {!perPass && <td style={{ padding: "8px 9px", color: "#475569" }}>{f.bucket}</td>}
                    <td style={{ padding: "8px 9px" }}>
                      <span style={{ ...TONE_BG[FILE_TONE[f.outcome]], padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, display: "inline-block" }}>{f.label}</span>
                    </td>
                    <td style={{ padding: "8px 9px", color: "#475569" }}>{f.detail || "—"}</td>
                    {/* "no" is not a fault: plenty of files in a folder have
                        nothing to say about the lines being checked. */}
                    <td style={{ padding: "8px 9px", color: f.cited ? "#166534" : "#94a3b8", fontWeight: f.cited ? 700 : 400 }}>{f.cited ? "yes" : "no"}</td>
                    <td style={{ padding: "8px 9px", color: "#334155" }}>{f.action || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

// Rows are uniform, so the collapsed list is a COUNT expressed in pixels: ten
// runs, at a measured 22px each (17px line box + 2px above and below + the 1px
// rule). The same 232px of box used to be a card grid that showed four runs of
// ten, with each card wrapping its counts onto a second line.
const RUN_ROW_HEIGHT = 22;
const RUNS_VISIBLE = 10;
const RUNS_BOX_HEIGHT = RUN_ROW_HEIGHT * RUNS_VISIBLE;

type DeleteTarget = { kind: "run"; index: number } | { kind: "history" };

// Has this area been checked before, when, and how did it come out.
//
// This used to live inside the step 4 result section, so it only appeared once
// a result was on screen: a returning user had to scroll past a full result to
// reach it, and on an area they had never checked they were told nothing at
// all. It is the answer to a question asked at step 1, when the area is picked,
// so that is where it renders. It is rendered ONCE: the "you are looking at an
// earlier check" banner stays with the result, which is the only place that
// distinction has to be made.
function RunHistory(props: {
  runs: SelfCheckRunRef[];
  viewingRun: number;
  setRunIndex: (i: number) => void;
  allRuns: boolean;
  setAllRuns: (f: (v: boolean) => boolean) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  confirmDelete: DeleteTarget | null;
  setConfirmDelete: (t: DeleteTarget | null) => void;
  scope: string;
  deleteSelfCheckRun: (s: string, i: number) => void;
  clearSelfCheckHistory: (s: string) => void;
  runDiff: RunDiff | null;
  shownRun: SelfCheckRunRef | undefined;
}) {
  const { runs, viewingRun, setRunIndex, allRuns, setAllRuns, open, setOpen, confirmDelete, setConfirmDelete, scope, runDiff, shownRun, deleteSelfCheckRun, clearSelfCheckHistory } = props;
  const archivedCount = runs.filter((r) => !r.current && r.openable).length;
  const agedOut = runs.filter((r) => !r.openable).length;
  // An area nobody has checked says so, rather than showing nothing and
  // leaving a first-time user to guess whether the page is broken.
  if (runs.length === 0) {
    return (
      <p style={{ ...muted, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", margin: "10px 0 0" }}>
        This area has not been checked yet. Once you run it, every check is kept here so you can come back to it and compare.
      </p>
    );
  }
  // Viewing an earlier run is pure display: it re-renders the rows that run
  // recorded and never re-runs, never re-bands and never writes.
  //
  // COLLAPSED BY DEFAULT, because step 1 is where an area is picked to run a
  // FRESH check, and eleven past checks put 435px of history in front of that.
  // Native <details>, so the keyboard and screen-reader behaviour is the
  // browser's; the open state is the page's (see historyOpen) so it survives
  // running a check and switching area.
  //
  // The summary carries what the collapsed state has to answer on its own:
  // that there IS history, how much, and how recent.
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", margin: "10px 0 0", background: viewingRun === 0 ? "#fbfcfe" : "#fffbeb", borderColor: viewingRun === 0 ? "#e2e8f0" : "#fde68a" }}
    >
              <summary style={{ cursor: "pointer", listStyle: "revert" }}>
                <b style={{ fontSize: 13 }}>{runs.length} check{runs.length === 1 ? "" : "s"} of this area</b>
                <span style={{ ...muted, marginLeft: 8 }}>Latest {runs[0].label}.</span>
                {/* Stays in the HEADER, not in the body: a warning that only
                    shows when the panel happens to be open is not a warning. */}
                {viewingRun > 0 && (
                  <span style={{ ...muted, color: "#92400e", fontWeight: 700, marginLeft: 8 }}>
                    You are looking at an earlier check, not your latest one. Choose Latest to go back.
                  </span>
                )}
              </summary>
              <p style={{ ...muted, margin: "8px 0 0" }}>
                {runs.length === 1
                  ? "Kept here so you can come back to it. Running again keeps this one and adds a new one."
                  : "Newest first. Choosing an earlier one shows what it recorded at the time."}
              </p>
              {/* One row per check, reading left to right. It was a grid of
                  cards: ten of them took 425px, showed four, and wrapped each
                  run's counts onto a second line. A card is the wrong shape
                  for a chronological list of short, uniform records.

                  Bounded by height with an expander, because the timeline runs
                  to 120 entries. The bound now holds ten rows rather than four
                  cards. */}
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <div className="sc-run-row sc-runs-head" style={{ ...muted, fontWeight: 700, fontSize: 11, padding: "0 6px 4px", borderBottom: "1px solid #e2e8f0" }}>
                  <div>Check</div>
                  <div style={{ textAlign: "right" }}>Took</div>
                  {/* The same four glyphs the verdicts carry everywhere else on
                      this page, so the columns need no second vocabulary. */}
                  <div className="sc-run-counts" title="Complies · partly · does not comply · could not check">
                    <span>✓</span><span>!</span><span>✗</span><span>?</span>
                  </div>
                  <div />
                </div>
                <div className={allRuns ? undefined : "sc-runs-box"}>
                  {runs.map((r) => {
                    const here = r.index === viewingRun;
                    const bg = here ? INK : r.openable ? undefined : "#f8fafc";
                    const fg = here ? "#fff" : r.openable ? INK : "#64748b";
                    const cell = { background: bg, color: fg, padding: "2px 0" };
                    return (
                      <div
                        key={`${r.index}-${r.runAt}`} data-run-row data-here={here || undefined} className="sc-run-row"
                        style={{ borderBottom: "1px solid #f1f5f9", background: bg, color: fg }}
                      >
                        <button
                          type="button" disabled={!r.openable} onClick={() => setRunIndex(r.index)}
                          className="sc-run-when"
                          title={r.openable ? `Open the check from ${r.label}` : "Only this run's date, time and counts were kept. The full result is no longer stored."}
                          style={{ ...cell, border: "none", background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: r.openable ? "pointer" : "default", paddingLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          <b>{r.current ? "Latest" : `#${runs.length - r.index}`}</b>
                          <span style={{ opacity: 0.75, marginLeft: 6 }}>{r.label}</span>
                          {r.procedureOnly && <span style={{ opacity: 0.75, marginLeft: 6 }}>· procedure only</span>}
                          {!r.openable && <span style={{ opacity: 0.75, marginLeft: 6 }}>· summary only</span>}
                        </button>
                        {/* A dash, not "time not recorded" nine times over: the
                            column is headed Took, so an empty one says it. The
                            note under the table explains it once. */}
                        <div className="sc-run-took" title={r.duration || "This check ran before durations were recorded"} style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", opacity: r.duration ? 0.85 : 0.5 }}>{r.durationShort || "—"}</div>
                        <div className="sc-run-counts" style={cell}>
                          {r.counts.total === 0
                            ? <span style={{ gridColumn: "1 / -1", opacity: 0.6 }}>no lines</span>
                            : [r.counts.complies, r.counts.partly, r.counts.doesNot, r.counts.couldNotCheck].map((v, i) => (
                                <span key={i} style={{ opacity: v === 0 ? 0.35 : 1, fontWeight: v > 0 ? 700 : 400 }}>{v}</span>
                              ))}
                        </div>
                        {/* Archived runs only, in its own column with a gutter,
                            never inside the row's click target. The current
                            result is what the Evidence Folder and PPD Review
                            pages read, and the store refuses index 0 too, so
                            this is not the only guard. */}
                        <div className="sc-run-del" style={{ ...cell, textAlign: "right", paddingRight: 6 }}>
                          {!r.current && r.openable && (
                            <button
                              type="button" onClick={() => setConfirmDelete({ kind: "run", index: r.index })}
                              title={`Delete the check from ${r.label}`}
                              style={{ border: "none", background: "transparent", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "0 4px" }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {runs.some((r) => !r.duration) && (
                  <p style={{ ...muted, margin: "6px 0 0", fontSize: 11.5 }}>
                    A dash under Took means that check ran before this page started recording how long a check takes.
                  </p>
                )}
              </div>

              {confirmDelete && (
                <DeleteConfirm
                  what={confirmDelete}
                  runs={runs}
                  onCancel={() => setConfirmDelete(null)}
                  onConfirm={() => {
                    if (!scope) return;
                    if (confirmDelete.kind === "history") clearSelfCheckHistory(scope);
                    else deleteSelfCheckRun(scope, confirmDelete.index);
                    setConfirmDelete(null);
                    setRunIndex(0);
                  }}
                />
              )}
              {runs.length > RUNS_VISIBLE && (
                <button
                  type="button" onClick={() => setAllRuns((v) => !v)}
                  style={{ marginTop: 8, display: "block", background: "none", border: "none", padding: 0, color: "#1d4ed8", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                >
                  {allRuns ? "Show fewer" : `Open out all ${runs.length} checks`}
                </button>
              )}
              {archivedCount > 0 && (
                <button
                  type="button" onClick={() => setConfirmDelete({ kind: "history" })}
                  style={{ marginTop: 14, display: "block", background: "none", border: "1px solid #fecaca", borderRadius: 7, padding: "5px 10px", color: "#991b1b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Delete all {archivedCount} earlier check{archivedCount === 1 ? "" : "s"}, keeping the latest
                </button>
              )}
              {agedOut > 0 && (
                <p style={{ ...muted, margin: "8px 0 0" }}>
                  The {agedOut} oldest {agedOut === 1 ? "entry keeps" : "entries keep"} only the date, the time taken and the counts.
                  This area holds the last {OPTION_A_RUN_HISTORY_CAP + 1} checks in full, and a summary of the {SELF_CHECK_RUN_LOG_CAP} most recent.
                </p>
              )}
              {shownRun && (shownRun.procedureDuration || shownRun.recordsDuration) && (
                <p style={{ ...muted, margin: "6px 0 0" }}>
                  Written procedure pass {shownRun.procedureDuration || "not recorded"} · records pass {shownRun.recordsDuration || "not recorded"}.
                  {" "}{runTimingNote(runs, viewingRun)}
                </p>
              )}
              {runDiff && (
                <p style={{ ...muted, margin: "6px 0 0" }}>
                  <b>Against the check before it:</b> {diffSummary(runDiff)}.
                  {runDiff.improved.length > 0 && ` Improved: ${runDiff.improved.slice(0, 6).map((c) => c.ref).join(", ")}${runDiff.improved.length > 6 ? ", and others" : ""}.`}
                  {runDiff.worsened.length > 0 && ` Went backwards: ${runDiff.worsened.slice(0, 6).map((c) => c.ref).join(", ")}${runDiff.worsened.length > 6 ? ", and others" : ""}.`}
                </p>
              )}
    </details>
  );
}


// Two steps, in place, spelling out exactly what goes and what stays.
//
// The blast radius is real and is named here rather than discovered later:
// ppdReviewHistory and evidenceAssessmentHistory are the workspace store's
// own, and the audit lead browses the same arrays on the PPD Review page
// (PPDReview.tsx:447 and :1079). Deleting here deletes there.
//
// Deleting the LATEST check promotes the next one down to current, because
// "current" is what the Evidence Folder and PPD Review pages read. With
// nothing to promote, the area is left with no result, and the panel says so
// in those words instead of leaving it to be found out.
function DeleteConfirm({ what, runs, onCancel, onConfirm }: { what: DeleteTarget; runs: SelfCheckRunRef[]; onCancel: () => void; onConfirm: () => void }) {
  const target = what.kind === "run" ? runs[what.index] : undefined;
  const archived = runs.filter((r) => !r.current && r.openable).length;
  return (
    <div style={{ border: "2px solid #991b1b", background: "#fef2f2", borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
      <b style={{ fontSize: 13.5, color: "#991b1b" }}>
        {what.kind === "history" ? `Delete all ${archived} earlier check${archived === 1 ? "" : "s"}?` : `Delete the check from ${target?.label ?? "this run"}?`}
      </b>
      <ul style={{ ...muted, color: "#7f1d1d", margin: "7px 0 0", paddingLeft: 17, lineHeight: 1.55 }}>
        {what.kind === "history" ? (
          <>
            <li>Every earlier check of this area goes, and its line on the timeline with it.</li>
            <li>Your latest check is not affected. It is what your audit lead sees, and it cannot be deleted from here.</li>
            <li>This cannot be undone. Download anything you want to keep first.</li>
          </>
        ) : (
          <>
            <li>The whole check from <b>{target?.label}</b> goes: its results, what it read, its timing and its line on the timeline.</li>
            <li>Your latest check is not affected. It is what your audit lead sees, and it cannot be deleted from here.</li>
            <li>This cannot be undone. Download it first if you want a copy.</li>
          </>
        )}
        <li>It also disappears from the PPD Review page your audit lead uses, which reads the same list.</li>
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
        <button
          type="button" onClick={onConfirm}
          style={{ border: "1px solid #991b1b", background: "#991b1b", color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          {what.kind === "history" ? "Yes, delete them" : "Yes, delete it"}
        </button>
        <button
          type="button" onClick={onCancel}
          style={{ border: "1px solid #cbd5e1", background: "#fff", color: INK, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

// One scroll container for every SVG this page renders, so the screen palette
// (CSS custom properties, so the dark-mode media query applies) and the
// narrow-viewport behaviour are wired up in exactly one place. An SVG scaled
// down to a 420px screen renders its 10.5px labels at about 5px, which is not
// legible, so the drawings keep a minimum width and this scrolls instead —
// the same thing the result tables on this page already do.
function Svg({ html }: { html: string }) {
  if (!html) return null;
  return <div className="sc-band-graphic" style={{ marginTop: 6, overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: html }} />;
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

