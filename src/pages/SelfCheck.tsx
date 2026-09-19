import { useEffect, useMemo, useRef, useState } from "react";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { runScopesForSub, scopeTitle, itemIdsForScope, folderScopeId } from "../lib/evidenceScope";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { parseFolderId } from "../lib/drive/driveClient";
import { aiOfflineReason } from "../lib/ai/aiClient";
import { downloadCsv } from "../lib/auditCsvExport";
import { buildWordingCapture, captureFilename } from "../lib/wordingCapture";
import { printHtmlInNewTab, PRINTABLE_DOC_CSS, POPUP_BLOCKED_MESSAGE } from "../lib/printableDoc";
import {
  formatElapsed, activityLine, countedFor, stallState, fileStageSummary, SLOW_TITLE,
  waitingMessage, roughRemaining, lineProgress, nowDoing, failureLines, linePassLabel,
  type RunProgress, type StageKey, type LiveLine,
} from "../lib/selfCheckProgress";
import { useWorkspaceStore, OPTION_A_RUN_HISTORY_CAP } from "../store/useWorkspaceStore";
import type { AuditFileRecord } from "../types";
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
  splitMismatchWarning,
  type SelfCheckBand, type SelfCheckView, type Combination, type SelfCheckRow,
} from "../lib/selfCheck";
import { toFileRows, countFileRows, unreadableWarning, passFileRows, fileCheckMark, sameFolderLink, SAME_LINK_WARNING, type SelfCheckFileRow } from "../lib/selfCheckEvidence";
// The live file ledger the Evidence Folder page already has: every file this
// run has listed, its status as it changes, and a Skip button on the one being
// read. Reused rather than rebuilt — a second, simpler live view would be a
// second vocabulary for the same thing.
import { FileLedger } from "./EvidenceFolder";
import { selfCheckRuns, diffRuns, diffSummary, runTimingNote, type SelfCheckRunRef, type RunDiff } from "../lib/selfCheckHistory";
import { SELF_CHECK_RUN_LOG_CAP } from "../lib/selfCheckRunLog";
import { outcomeDimensionState, outcomePassTally } from "../lib/selfCheckOutcome";
import { buildLabel } from "../lib/buildInfo";
import { unassessedDimensions, dimensionStepLines, runNamedGaps, reviewShapedGapNote, reviewShapedRows, IMPROVE_HEADLINE, IMPROVE_WHY, IMPROVE_HEADLINE_CHECKED, IMPROVE_WHY_CHECKED, REVIEW_FINDINGS_HEADING, REVIEW_FINDINGS_INTRO, REVIEW_FINDINGS_NONE } from "../lib/selfCheckImprove";
import { buildBandWorking, bandCoverageNote, bandGraphic, bandGraphicSvg, tallyBarSvg, SCREEN_BAND_PALETTE, rubricMatrix, RUBRIC_ACHIEVED_MARK, RUBRIC_NEXT_MARK, nextBandRoute, nextBandWorking, NEXT_BAND_CAVEAT, NEXT_BAND_TOP_NOTE, NO_ACTION_RECORDED, CLIMB_HEADING, CLIMB_NEXT_LABEL, CLIMB_BEYOND_LABEL, CLIMB_BEYOND_NOTE, CLIMB_AT_TOP, CLIMB_HEADING_AT_TOP, TOP_BAND_WITH_ROOM_NOTE, type DimensionStepLine, type BandStepOption, type RubricMatrixRow, ROWS_DO_NOT_SUM_NOTE, dimensionsNote, NO_BAND_WITHOUT_FOUR_NOTE, selfCheckTotal, selfCheckTotalWorking, bandName, INFERRED_THRESHOLDS_NOTE } from "../lib/selfCheckBanding";
import { useGuidanceStore, disclaimerSnoozed, DISCLAIMER_SNOOZE_DAYS } from "../store/useGuidanceStore";

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
// The run log's four tones, as the engine already emits them.
const LOG_TONE: Record<string, string> = { info: "#475569", good: "#15803d", warn: "#92400e", bad: "#b91c1c" };

// The three Audit support categories, in the order a reader needs them: what
// was read, how the check works, what the full audit adds.
const SUPPORT_TABS = [
  { key: "files", label: "Evidence & files" },
  { key: "how", label: "How this assessment works" },
  { key: "outcomes", label: "Outcomes & review" },
] as const;
type SupportTab = (typeof SUPPORT_TABS)[number]["key"];

// The number on each cell of the input row. Small, because it sits inside a
// field label rather than heading a card of its own.
const stepDot: React.CSSProperties = { ...stepNum, width: 21, height: 21, fontSize: 11.5 };

// What each numbered step means, in full. It was three blocks of prose under
// the fields — a guidance box, an expander and a line under each box — which is
// the wall the user kept scrolling past on every run. The words are all still
// here; they open from the number they belong to.
//
// The swapped-folder warning is in BOTH folder steps deliberately: there is no
// honest detector for a swapped pair (a filename heuristic gave 18% false
// positives), so the only defence is saying it where the link is pasted.
const STEP_HELP: Record<number, { title: string; body: string[] }> = {
  1: {
    title: "Which area do you look after?",
    body: [
      "Pick the sub-criterion you are responsible for. The check reads only the requirement lines that belong to it, and its description appears under the row once you have chosen.",
    ],
  },
  2: {
    title: "Where is your written procedure?",
    body: [
      "What you SAY you do. The document that sets out how this area is meant to work: your policy, your procedure, your handbook or your terms of reference. Not minutes, registers, logs or reports, even when they are about this area: those go in box 3.",
      "It must be a different folder from box 3. One link in both boxes makes every document count as your written procedure and as your records at the same time, and a requirement then looks proved because your procedure says it happens.",
      "Getting the two the wrong way round is easy to do and hard to spot: the check cannot tell a swapped pair from an area with no records yet. If almost every line comes back the same way and the reasons keep saying the records were policy wording, check the two boxes before you believe the result.",
    ],
  },
  3: {
    title: "Where is your evidence?",
    body: [
      "What you actually DID. The records that show it happening: minutes, forms, logs, registers, signed copies, reports and emails. Not your policy or procedure documents, even when their names mention records: those go in box 2.",
      "It must be a different folder from box 2, for the same reason: one folder in both boxes proves a requirement with the procedure that promised it.",
    ],
  },
  4: {
    title: "Run the check",
    body: [
      "The check reads your written procedure, then reads your records against it, then reads the same documents again for results and review records. Leave the tab open until it finishes: it runs in this browser, so closing or reloading stops it.",
    ],
  },
};
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
  // Whether the AI call in flight can be abandoned on its own, rather than
  // taking the whole run down with it.
  const canSkipAiCall = useWorkspaceStore((s) => s.canSkipAiCall);
  const clearSelfCheckHistory = useWorkspaceStore((s) => s.clearSelfCheckHistory);
  const ppdHistory = useWorkspaceStore((s) => s.ppdReviewHistory);
  const cycleStatus = useWorkspaceStore((s) => s.cycle.status);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const driveToken = useGoogleDriveStore((s) => s.accessToken);
  const driveClientId = useGoogleDriveStore((s) => s.clientId);
  const aiSettings = useAISettingsStore();
  const apsrScale = useScoringConfigStore((s) => s.apsrScale);

  // Snooze state for the top practice-check banner. Per device, and it expires
  // by itself, so the banner is a recurring reminder rather than something one
  // click removes for good.
  const disclaimerSnoozedAt = useGuidanceStore((g) => g.disclaimerSnoozedAt);
  const snoozeDisclaimer = useGuidanceStore((g) => g.snoozeDisclaimer);
  const [scope, setScope] = useState("");
  const [procLink, setProcLink] = useState("");
  const [evLink, setEvLink] = useState("");
  // Which half the result on screen came from. A procedure-only result answers
  // a different question and must never be dressed as a full one.
  const [mode, setMode] = useState<"full" | "procedure-only">("full");
  const [tab, setTab] = useState<SelfCheckView>("overview");
  // NOT state: derived from the run being shown, so it survives a reload and
  // follows you into an archived check. Held in useState it was lost on every
  // refresh, taking the dimension panel, its detail table, the band card and
  // both exports' dimension sections with it.
  // Two coverage notes, because they caption two different things: the
  // auditor's committed band on the card, and the dimension panel below it.
  const [bandCoverage, setBandCoverage] = useState("");
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
  // Which requirements the selector is offering. Both reset on a tab switch,
  // the way the supplied design does it: a filter left over from Overall would
  // silently hide lines on Procedure, and a reader who did not notice would
  // read a short list as the whole tab.
  // Whether the input row is open: open while nothing has been checked and
  // while a check is running, shut once there is a result to read. A click on
  // the summary wins until one of those two changes again.
  //
  // Driven by an effect rather than by "open={pinned ?? auto}": inserting a
  // <details open> fires a toggle event of its own at mount, which pinned the
  // open state before anybody had clicked anything and left the form standing
  // over every result (found by probing the live page, not by reading it).
  const [inputsOpen, setInputsOpen] = useState(true);
  // Whether the tab's "what this does not answer" line is open. Shut by
  // default: it is read once, not on every visit.
  const [viewNoteOpen, setViewNoteOpen] = useState(false);
  // Which Audit support category is open. Files first: it is what follows
  // naturally from reading a requirement's finding.
  const [supportTab, setSupportTab] = useState<SupportTab>("files");
  // Whether the run's activity log is open. Shut by default: the file list
  // above it answers most questions, and the log is what you open when it does
  // not.
  const [logOpen, setLogOpen] = useState(false);
  // Re-read one file: which file is chosen, what the last attempt said, and
  // whether one is in flight. Page state only — nothing about it is stored.
  const [rereadKey, setRereadKey] = useState("");
  const [rereadNote, setRereadNote] = useState("");
  const [rereading, setRereading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  // Which requirement the stage is showing. Held by REF, not by index: the
  // three tabs return the same refs in the same order, so switching tab keeps
  // the reader on the requirement they were reading rather than throwing them
  // back to the first one.
  const [selectedRef, setSelectedRef] = useState("");
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
  // "outcomes" WAS MISSING from this list, and it is the longest pass of the
  // three. With it missing the page declared the check finished the moment the
  // records pass ended: the progress list vanished, the input row folded and
  // the result appeared, while the results-and-review pass was still running
  // in the background. Anyone who then reloaded or left the page killed that
  // pass, and the result said "these two areas were not looked at on this run"
  // for ever after, with no way to tell that from a pass that failed.
  const running = phase === "folder" || phase === "policy" || phase === "records" || phase === "outcomes" || phase === "band";
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
  // Rebuilt from the run's own stored inputs. The labels, official descriptors
  // and percentages are derived, never stored, so a change to the configured
  // scale re-derives rather than printing a stale number beside a live one.
  // `existing` already resolves to the run being viewed (atRun), so an archived
  // check shows its own dimensions rather than the latest run's.
  const bandWorking = useMemo(() => {
    const b = existing?.bandSuggestion;
    return b ? buildBandWorking(b.scores, b.reasons, apsrScale, b.checked) : null;
  }, [existing, apsrScale]);
  // Which requirement item the panel below describes, from the run that
  // produced it rather than from whatever is selected now.
  const dimensionCoverage = useMemo(() => {
    const b = existing?.bandSuggestion;
    return b && area ? bandCoverageNote(b.itemId, itemIdsForScope(area.scope), "This dimension assessment") : "";
  }, [existing, area]);
  const dimensionsChecked = !!bandWorking?.rows.every((r) => r.assessedHere);
  // The band, and null whenever any dimension is missing. One derivation, used
  // by the card, the working panel and both exports.
  const selfTotal = useMemo(() => selfCheckTotal(bandWorking ?? undefined, apsrScale), [bandWorking, apsrScale]);
  // What the next band would need, computed from the run rather than narrated.
  // The failing lines come from the two passes' own verdicts, not from the
  // rows of whichever tab is open: the dimensions describe the RUN.
  // BUILT rows from both passes, not the raw engine rows: the "What to do"
  // the route prints has to be the very text the requirement row prints, and
  // that text is produced by the row builders (fixFor / suggestedRewrite).
  // Built for BOTH passes regardless of which tab is open, because the
  // dimensions describe the run rather than the tab.
  const stepRefs = useMemo(
    () => dimensionStepLines({
      procedure: ppdExisting ? toProcedureRows(ppdExisting.rows, runCtx) : undefined,
      combined: existing ? toSelfCheckRows(existing.rows, runCtx) : undefined,
    }),
    [ppdExisting, existing, runCtx],
  );
  const bandRoute = useMemo(
    () => nextBandRoute(bandWorking ?? undefined, stepRefs, apsrScale),
    [bandWorking, stepRefs, apsrScale],
  );
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
  // The files THIS stored check read, each with the number of requirement lines
  // that quoted it, counted off the run's own chunk map. Records side only: the
  // written-procedure pass is not what this control re-runs.
  const rereadFiles = useMemo(() => {
    if (!existing) return [] as { key: string; name: string; lines: number }[];
    const chunkFiles = existing.chunkFileNames ?? {};
    return (existing.fileLedger ?? [])
      .filter((f) => f.bucket === "evidence" && (f.driveFileId || f.path))
      .map((f) => ({
        key: f.driveFileId || f.path,
        name: f.name,
        lines: existing.rows.filter((r) =>
          (r.evidenceChunkIds ?? []).some((c) => chunkFiles[c] === f.name)
          || (r.evidenceFiles ?? []).some((e) => e.name === f.name)
        ).length,
      }));
  }, [existing]);
  // The run's own reported gaps, gathered for the improvement section. Nothing
  // new is written: these are the strings already on the rows.
  const runGaps = useMemo(() => runNamedGaps(rows), [rows]);
  // The run's own verdicts on the official review-shaped lines. Same refs, same
  // verdicts, same words as the table above; no judgement is added here.
  const reviewRows = useMemo(() => reviewShapedRows(rows), [rows]);
  const counts = useMemo(() => countSelfCheck(rows), [rows]);
  // The filter chips, in the tab's own vocabulary, dropped when they would
  // read "0". "Needs action" is the two tones a person has to do something
  // about, which is the one grouping the counts do not already give.
  const filterDefs = useMemo(() => {
    const w = VIEW_TALLY[view];
    // The tally words are written lower case for the stat tiles, where they
    // follow a number; as a chip each one starts a label of its own.
    const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    const action = counts.doesNot + counts.partly;
    return [
      { key: "all", label: `All ${counts.total}`, n: counts.total },
      { key: "action", label: `Needs action ${action}`, n: action },
      { key: "critical", label: `${cap(w.doesNot)} ${counts.doesNot}`, n: counts.doesNot },
      { key: "neutral", label: `Could not check ${counts.couldNotCheck}`, n: counts.couldNotCheck },
      { key: "good", label: `${cap(w.complies)} ${counts.complies}`, n: counts.complies },
    ].filter((f) => f.key === "all" || f.n > 0);
  }, [counts, view]);
  // Text search over what the card actually shows, so a hit is always visible
  // on the row it matched.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const byStatus = filter === "all" || r.tone === filter
        || (filter === "action" && (r.tone === "critical" || r.tone === "medium"));
      const byText = !q || `${r.ref} ${r.requirement} ${r.summary} ${r.fix} ${r.why}`.toLowerCase().includes(q);
      return byStatus && byText;
    });
  }, [rows, filter, query]);
  // DERIVED, never stored: a filter or a tab switch can take the chosen
  // requirement off the list, and the design's answer is to fall through to
  // the first one still on offer rather than show an empty stage.
  const selected = visibleRows.find((r) => r.ref === selectedRef) ?? visibleRows[0];
  const selectedIdx = selected ? visibleRows.findIndex((r) => r.ref === selected.ref) : -1;
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
  // Open while this area has no result to read (which includes while a check
  // is running, since showResult is false then), shut once it has one. Keyed
  // on the area too, so picking an unchecked area opens the form again.
  useEffect(() => { setInputsOpen(!showResult); }, [showResult, scope]);

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
    setError(null); setNote(null); setBand({ kind: "none" }); setBandCoverage("");
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
          // Stored on the run, not held in page state.
          useWorkspaceStore.getState().attachBandSuggestion(area.scope, {
            itemId: itemIds[0],
            scores: s.dimensionBands,
            reasons: {
              approach: s.dimensions.approach.reason,
              processes: s.dimensions.processes.reason,
              systemsOutcomes: s.dimensions.systemsOutcomes.reason,
              review: s.dimensions.review.reason,
            },
            checked: { systemsOutcomes: orChecked, review: orChecked },
          });
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
    downloadCsv(buildSelfCheckCsv(`${area.scope} ${area.title}`, rows, band, view, exportFiles, bandWorking ?? undefined, view === "overview" ? bandCoverage : undefined, itemIdsForScope(area.scope), exportTiming, sameLink, stepRefs), selfCheckFilename(view === "overview" ? area.title : `${area.title} ${VIEW_LABEL[view]}`, "csv"));
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
        stepRefs,
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
      : phase === "outcomes" ? (orProgress?.detail ? { detail: orProgress.detail, currentWindowFiles: orProgress.currentWindowFiles } : undefined)
      : (phase === "records" || phase === "band") ? (evProgress ?? undefined) : undefined;
  // EVERY file this run has opened, across all its passes, not just the pass in
  // flight. The live pane read one progress object, so the file list vanished
  // the moment the run moved on to the results-and-review stage, which is the
  // stage that takes longest and where a reader most wants to see what was
  // read. Deduplicated by Drive id (or path), policy pass first.
  const runLedger = useMemo(() => {
    const out: AuditFileRecord[] = [];
    const seen = new Set<string>();
    for (const rec of [...(ppdProgress?.filesFound ?? []), ...(evProgress?.filesFound ?? [])]) {
      const key = rec.driveFileId || rec.path;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(rec);
    }
    return out;
  }, [ppdProgress, evProgress]);
  // The run's own activity log, both passes, oldest first. The engine has
  // always kept it; this page just never showed it.
  const runLog = useMemo(
    () => [...(ppdProgress?.log ?? []), ...(evProgress?.log ?? [])].sort((a, b) => a.at - b.at),
    [ppdProgress, evProgress],
  );
  // The official wording of every requirement line in this area, by ref. No
  // short form exists in the data (the fields are ref, gd4ItemId, sourceType,
  // text, parentText, sourceText, originalIndex) and one is not invented
  // here: the line is shown in the Guidance Document's own words and allowed
  // to wrap. parentText comes with it where there is one, because several
  // lines are fragments that only read as English under their parent.
  const lineText = useMemo(() => {
    const out: Record<string, { text: string; parent?: string }> = {};
    if (!area) return out;
    for (const id of itemIdsForScope(area.scope)) {
      for (const pt of GD4_REQUIREMENTS.find((r) => r.id === id)?.flatAuditPoints ?? []) {
        out[pt.ref] = { text: pt.text, parent: pt.parentText };
      }
    }
    return out;
  }, [area]);
  // Called straight, not memoised: liveProgress is rebuilt every render for
  // the outcomes phase, so a useMemo on it never hits, and both are a map
  // over at most 22 refs.
  const liveLines = lineProgress(liveProgress);
  const doingNow = nowDoing(liveProgress);
  const liveFailures = useMemo(() => failureLines({ log: runLog }), [runLog]);
  const stall = stallState(now, liveProgress, runStartedAt || now, canSkipAiCall);
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
        // Four more movements on cycles that do not divide into each other, so
        // the cat never falls into a visible loop: a head turn, an ear twitch
        // each side, and one paw kneading. A check runs for minutes, and the
        // reported complaint was that a breathing, blinking, tail-flicking cat
        // was still too static to watch.
        "@keyframes scHead{0%,44%{transform:rotate(0deg) translateX(0)}52%{transform:rotate(-7deg) translateX(-0.6px)}60%{transform:rotate(-7deg) translateX(-0.6px)}70%{transform:rotate(5deg) translateX(0.5px)}78%{transform:rotate(5deg) translateX(0.5px)}88%,100%{transform:rotate(0deg) translateX(0)}}",
        "@keyframes scEarL{0%,80%,100%{transform:rotate(0deg)}84%{transform:rotate(-13deg)}88%{transform:rotate(4deg)}92%{transform:rotate(0deg)}}",
        "@keyframes scEarR{0%,36%,100%{transform:rotate(0deg)}40%{transform:rotate(12deg)}45%{transform:rotate(-4deg)}50%{transform:rotate(0deg)}}",
        "@keyframes scKnead{0%,58%,100%{transform:translateY(0) scaleX(1)}64%{transform:translateY(-1.6px) scaleX(0.94)}70%{transform:translateY(0) scaleX(1.03)}76%{transform:translateY(0) scaleX(1)}}",
        ".sc-cat-body{animation:scBreathe 4s ease-in-out infinite;transform-origin:23px 33px}",
        ".sc-cat-tail{animation:scTail 3.2s ease-in-out infinite;transform-origin:33px 31px}",
        ".sc-cat-eyes{animation:scBlink 6s ease-in-out infinite;transform-origin:23px 15px}",
        ".sc-cat-head{animation:scHead 9s ease-in-out infinite;transform-origin:23px 21px}",
        ".sc-cat-ear-l{animation:scEarL 7s ease-in-out infinite;transform-origin:18px 10px}",
        ".sc-cat-ear-r{animation:scEarR 11s ease-in-out infinite;transform-origin:28px 10px}",
        ".sc-cat-paw-l{animation:scKnead 5.5s ease-in-out infinite;transform-origin:18px 33px}",
        // Anyone who has asked the operating system for less movement gets a
        // still cat. The rotating copy and the elapsed timer still change, so
        // the card is still demonstrably alive without any animation at all.
        "@media (prefers-reduced-motion: reduce){.sc-cat-body,.sc-cat-tail,.sc-cat-eyes,.sc-cat-head,.sc-cat-ear-l,.sc-cat-ear-r,.sc-cat-paw-l{animation:none}.sc-bar,.sc-indet{animation:none!important;transition:none!important}}",
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
        // ── The result, to the supplied HTML design ──────────────────────
        // A 250px sticky sidebar (jump list + exports) beside a column of one
        // card per requirement, which is the shape of the mock this page was
        // asked to follow. It replaces a sidebar plus ONE card showing one
        // requirement at a time: that hid seven of eight lines behind a click
        // and cannot be read straight through, printed or scrolled.
        // ── The input row, to the supplied design's "Inputs used for this
        // check" card: area, written procedure, records and run, left to right
        // in one row, the whole thing folding away once there is a result.
        // NOT overflow:hidden. The step popovers hang out of this card, and hidden
        // clipped them mid-sentence with their Close button off the bottom.
        ".sc-inputs{border:1px solid #dfe5ee;border-radius:14px;background:#fff;margin-bottom:16px}",
        ".sc-inputs-summary{list-style:none;cursor:pointer;padding:13px 17px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:750;font-size:14px;color:#172033}",
        ".sc-inputs-summary::-webkit-details-marker{display:none}",
        ".sc-inputs-summary:after{content:\"Show\";font-size:12px;color:#6d28d9;font-weight:800;margin-left:auto}",
        ".sc-inputs[open] .sc-inputs-summary:after{content:\"Hide\"}",
        ".sc-inputs-pill{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:750;white-space:nowrap}",
        ".sc-inputs-body{border-top:1px solid #eef2f6;padding:16px 17px 4px;display:grid;grid-template-columns:1.05fr 1fr 1fr auto;gap:14px;align-items:start}",
        ".sc-field{min-width:0}",
        ".sc-field label{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:#465268;margin:0 0 6px;min-height:22px}",
        // The step explanation, anchored to its number. Above the field rather
        // than below it, because the fields sit in a row and a panel pushing
        // down would move the other three.
        ".sc-step-help{position:absolute;z-index:20;top:26px;left:0;width:330px;max-width:80vw;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:11px 13px;font-size:12.5px;font-weight:400;line-height:1.5;color:#475569;white-space:normal}",
        ".sc-run-button{height:42px;border:0;border-radius:9px;background:#7c3aed;color:#fff;font-weight:800;font-size:14px;padding:0 20px;white-space:nowrap;font-family:inherit}",
        ".sc-inputs-more{padding:8px 17px 16px}",
        // Air between the blocks in here: the run-history card, the folder
        // guidance and the running panel were butted up against each other.
        ".sc-inputs-more>*+*{margin-top:10px}",
        // ── The processing workspace ────────────────────────────────────
        // A bounded frame, not a section that grows with the folder: the two
        // panes scroll inside it, so 150 files and 1 file both end at the same
        // place and the Stop button is never at the foot of a white field.
        ".sc-proc{border:1px solid #dfe5ee;border-radius:12px;background:#fff;overflow:hidden}",
        ".sc-proc-head{display:flex;align-items:flex-start;gap:12px;background:#f8fafc;border-bottom:1px solid #eef2f6;padding:11px 13px}",
        ".sc-proc-hint{font-size:11.5px;color:#8490a3;white-space:nowrap;padding-top:3px}",
        ".sc-proc-body{display:grid;grid-template-columns:minmax(0,38fr) minmax(0,62fr)}",
        ".sc-proc-pane{min-width:0;display:flex;flex-direction:column;padding:11px 13px}",
        ".sc-proc-pane+.sc-proc-pane{border-left:1px solid #eef2f6}",
        ".sc-proc-label{font-size:10.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:#8490a3;margin-bottom:7px}",
        // 300px, not a viewport fraction: the content is a five-row list and a
        // file table, and both are legible in that space at every width.
        ".sc-proc-scroll{min-height:0;max-height:300px;overflow-y:auto}",
        ".sc-proc-status{border-top:1px solid #eef2f6;margin-top:8px;padding-top:8px;overflow-wrap:anywhere}",
        ".sc-proc-log{margin-top:6px;border:1px solid #eef2f6;border-radius:8px;background:#fbfcfe;padding:6px 9px;font-size:11.5px;line-height:1.5;max-height:150px;overflow-y:auto}",
        ".sc-proc-foot{border-top:1px solid #eef2f6;padding:11px 13px}",
        "@media (max-width: 900px){",
        ".sc-proc-body{grid-template-columns:1fr}",
        ".sc-proc-pane+.sc-proc-pane{border-left:0;border-top:1px solid #eef2f6}",
        ".sc-proc-scroll{max-height:220px}",
        ".sc-proc-hint{display:none}",
        "}",
        "@media (max-width: 980px){",
        ".sc-inputs-body{grid-template-columns:1fr 1fr}",
        ".sc-run-field{grid-column:1/-1}",
        ".sc-run-button{width:100%}",
        "}",
        "@media (max-width: 640px){",
        ".sc-inputs-body{grid-template-columns:1fr}",
        "}",
        ".sc-results-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:22px;align-items:start;margin-top:12px}",
        // min-width:0, or the horizontal selector strip below 900px sizes the
        // grid track to its own 8 x 190px content and pushes the whole page
        // sideways: at 420px the result was 1431px wide and scrolled.
        ".sc-side{position:sticky;top:14px;display:flex;flex-direction:column;gap:12px;min-width:0}",
        ".sc-side-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;min-width:0}",
        ".sc-side-card h3{font-size:13px;margin:0 0 6px;color:#0f172a}",
        ".sc-side-list{max-height:calc(100vh - 260px);overflow-y:auto;margin:0 -4px}",
        // The stage holds ONE requirement, so it is given a floor: without it
        // the page jumped every time a short requirement followed a long one.
        ".sc-stage{min-height:430px}",
        ".sc-workspace-heading{display:flex;align-items:center;gap:10px;margin:2px 0 10px}",
        ".sc-workspace-heading h3{font-size:14px;margin:0;color:#172033}",
        ".sc-workspace-position{font-size:12px;color:#65728a;margin-left:auto;white-space:nowrap}",
        ".sc-selected-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#7c3aed;margin-bottom:5px}",
        ".sc-view-subheader{margin-top:10px;border:1px solid #dfe5ee;background:#f8fafc;border-radius:9px;padding:9px 11px;font-size:12.5px;color:#4b5870}",
        ".sc-view-subheader b{color:#172033}",
        ".sc-main{min-width:0}",
        ".sc-hero{border:1px solid #e2e8f0;border-radius:13px;background:#fff;padding:15px 17px}",
        ".sc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:11px}",
        // The gap is deliberate: the four counts are one thing to read, the two
        // pictures under them are another.
        ".sc-hero-split{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin-top:18px}",
        // ── Audit support ───────────────────────────────────────────────
        // One quiet area under the result, with a rule above it, so the
        // supporting panels stop reading as a dozen results of equal weight.
        ".sc-support{border-top:2px solid #e2e8f0;margin-top:20px;padding-top:14px}",
        ".sc-support-head{margin-bottom:10px}",
        ".sc-support-tabs{display:flex;gap:8px;flex-wrap:wrap}",
        ".sc-support-tab{border:1px solid #cfd8e6;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:750;color:#334155;cursor:pointer}",
        ".sc-support-tab[data-on]{background:#172033;color:#fff;border-color:#172033}",
        ".sc-support-body{margin-top:10px}",
        // The panels inside a category keep their own borders, but their old
        // top margins would compound with this one.
        ".sc-support-body>div:first-of-type{margin-top:0}",
        "@media (max-width: 640px){.sc-support-tabs{overflow-x:auto;flex-wrap:nowrap}.sc-support-tab{white-space:nowrap}}",
        // Hidden while the sidebar's Export card is on screen (see the 900px
        // block, where the sidebar goes and this comes back).
        ".sc-export-foot{display:none}",
        // Filters and search sit above the one requirement they choose, and
        // do not float: with a single requirement on the stage the list is
        // never scrolled past while it is being read.
        ".sc-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 0 12px}",
        ".sc-filter{border:1px solid #cfd8e6;background:#fff;border-radius:999px;padding:6px 10px;font-size:12.5px;font-weight:750;cursor:pointer;color:#334155;font-family:inherit}",
        ".sc-filter[data-on]{background:#172033;color:#fff;border-color:#172033}",
        ".sc-search{flex:1;min-width:220px;height:36px;border:1px solid #cfd8e6;border-radius:9px;padding:0 11px;font:inherit;font-size:13px;background:#fff}",
        ".sc-view-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px}",
        ".sc-view-tab{border:1px solid;border-radius:10px;padding:10px 12px;text-align:left;cursor:pointer;font:inherit;min-width:0}",
        ".sc-view-tab strong{display:block;font-size:13.5px;line-height:1.2}",
        ".sc-view-tab span{display:block;font-size:11.5px;margin-top:3px;line-height:1.35}",
        // 96px, because the sticky toolbar above would otherwise cover the head
        // of the card a jump link lands on.
        ".sc-finding{border:1px solid #e2e8f0;border-radius:13px;background:#fff;overflow:hidden;scroll-margin-top:96px;min-width:0}",
        ".sc-finding-head{padding:13px 15px 11px;display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid #eef2f7}",
        ".sc-finding-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}",
        ".sc-status-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 9px;font-size:11.5px;font-weight:800;border:1px solid}",
        ".sc-code{font:800 11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748b}",
        ".sc-finding-title{font-size:15.5px;line-height:1.35;margin:0;font-weight:700;color:#1f2733}",
        ".sc-consistency{margin:11px 15px 0;background:#fff8e8;border:1px solid #f2ce80;border-radius:9px;padding:8px 10px;font-size:12.5px;color:#7b4b00}",
        ".sc-consistency strong{display:block}",
        ".sc-finding-summary{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr)}",
        ".sc-summary-block{padding:12px 15px 13px}",
        ".sc-summary-block+.sc-summary-block{border-left:1px solid #eef2f7;background:#fbfcfe}",
        ".sc-summary-block p{margin:0;color:#334155;font-size:13.5px;line-height:1.6}",
        ".sc-eyebrow{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#64748b;margin-bottom:4px}",
        // Three columns of supporting detail, as the mock has them. WhyCell
        // keeps its own wrapper for the inherited type size, and display:
        // contents lets each disclosure inside it be a column of this grid
        // rather than all of them stacking in one.
        // Two columns, not three: the reasoning runs long and the quotations
        // do not, so the reasoning gets two thirds of the card's full width and
        // anything after the quotations wraps onto the next row.
        ".sc-detail-grid{border-top:1px solid #eef2f7;display:grid;grid-template-columns:2fr 1fr;align-items:start}",
        ".sc-detail-items{display:contents}",
        ".sc-detail-grid>details,.sc-detail-grid>.sc-detail-items>*{padding:10px 13px;border-left:1px solid #eef2f7;margin:0;min-width:0}",
        // 13.5px, the size of the prose beside them. They were rendering at the
        // browser default because the rule only reached a DIRECT child, and the
        // disclosures inside WhyCell's wrapper are grandchildren.
        ".sc-detail-grid summary{font-size:13.5px;font-weight:700;color:#475569}",
        ".sc-detail-grid .sc-detail-items{font-size:13.5px}",
        ".sc-req-link{display:grid;grid-template-columns:10px minmax(0,1fr);gap:1px 8px;align-items:center;width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:10px 9px;margin:2px 0;cursor:pointer;font:inherit;background:none}",
        ".sc-req-link:hover{background:#f7f8fb}",
        ".sc-req-dot{width:8px;height:8px;border-radius:99px;grid-row:1/4}",
        ".sc-req-code{font-size:12px;font-weight:800;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        // Two lines of the requirement itself, clamped: the code alone does not
        // say what the line is about, and the full wording is a paragraph.
        ".sc-req-title{grid-column:2;font-size:11.5px;line-height:1.35;color:#475569;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
        ".sc-req-state{grid-column:2;font-size:11px;font-weight:700;margin-top:3px}",
        ".sc-req-link[data-selected]{background:#f5f3ff;border-color:#c4b5fd;box-shadow:inset 3px 0 0 #6d28d9}",
        ".sc-req-link[data-selected] .sc-req-code{color:#5b21b6}",
        // The design's own breakpoint. The selector CANNOT simply be hidden
        // here the way a jump list could: it is how a requirement is chosen,
        // so it becomes a horizontal strip of cards above the stage. Only the
        // duplicate export buttons go, and the pair at the foot of the result
        // is still there.
        "@media (max-width: 900px){",
        ".sc-results-layout{grid-template-columns:1fr}",
        ".sc-side{position:static}",
        ".sc-side-list{display:flex;gap:7px;overflow-x:auto;max-height:none;padding:2px 2px 8px}",
        ".sc-req-link{min-width:190px;flex:0 0 190px}",
        ".sc-side-card.sc-download-card{display:none}",
        ".sc-export-foot{display:flex}",
        ".sc-finding-summary{grid-template-columns:1fr}",
        ".sc-summary-block+.sc-summary-block{border-left:0;border-top:1px solid #eef2f7}",
        ".sc-detail-grid{grid-template-columns:1fr}",
        ".sc-detail-grid>details,.sc-detail-grid>.sc-detail-items>*{border-left:0;border-top:1px solid #eef2f7}",
        "}",
        "@media (max-width: 640px){",
        ".sc-hero-split{grid-template-columns:1fr;gap:12px}",
        ".sc-results-layout{gap:12px}",
        ".sc-hero{padding:14px}",
        ".sc-view-tabs{grid-template-columns:1fr}",
        ".sc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}",
        ".sc-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}",
        ".sc-search{grid-column:1/-1;width:100%;min-width:0}",
        ".sc-req-link{min-width:170px;flex-basis:170px}",
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
        // The rubric matrix. Light only, like every other table on this page:
        // it sits inside a white panel, so the graphic's dark tokens would put
        // a dark table on a white card.
        // ── The live panel: what it is doing, and where each line has got
        //    to. Light only, like the rest of this page.
        ".sc-now{border:1px solid #ddd6fe;background:#f5f3ff;border-radius:8px;padding:8px 10px;margin-bottom:9px}",
        ".sc-now-head{font-size:11.5px;font-weight:800;color:#5b21b6;margin-bottom:2px}",
        ".sc-now-more{font-size:11px;color:#6d28d9;margin-top:3px}",
        ".sc-now-files{font-size:11.5px;color:#475569;margin-top:5px;overflow-wrap:anywhere}",
        ".sc-now-files b{color:#1f2733}",
        ".sc-now-list{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:3px}",
        ".sc-now-list li{font-size:12.5px;line-height:1.45;color:#334155}",
        ".sc-now-parent{color:#64748b}",
        ".sc-now-ref{margin-left:6px;font-family:ui-monospace,monospace;font-size:10.5px;color:#94a3b8}",
        // Failures first, and never folded.
        ".sc-live-fails{border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:8px 10px;margin-bottom:9px}",
        ".sc-live-fails-head{font-size:11.5px;font-weight:800;color:#991b1b;margin-bottom:4px}",
        ".sc-live-fail{font-size:11.5px;line-height:1.45;color:#7f1d1d;overflow-wrap:anywhere}",
        ".sc-live-fail+.sc-live-fail{margin-top:3px}",
        ".sc-live-more{font-size:11px;color:#b91c1c;margin-top:3px}",
        ".sc-live-board{border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:8px 10px;margin-bottom:9px}",
        ".sc-live-board-head{font-size:11.5px;color:#475569;margin-bottom:6px}",
        ".sc-live-board-head b{color:#1f2733}",
        ".sc-live-board-note{display:block;margin-top:2px;font-size:10.5px;color:#94a3b8}",
        // One row per requirement line in the area, so the list cannot grow
        // during a run: the largest area (4.2) has 22 lines, the median 12.
        // Capped in height anyway, so a long area scrolls rather than pushing
        // the file ledger off the panel.
        ".sc-live-rows{list-style:none;margin:0;padding:0;display:grid;gap:2px;max-height:230px;overflow-y:auto}",
        ".sc-live-row{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:7px;align-items:baseline;font-size:12px;line-height:1.4;padding:2px 0}",
        ".sc-live-mark{font-size:11px;text-align:center}",
        ".sc-live-text{color:#64748b;overflow-wrap:anywhere}",
        // Never colour alone: the state is a word at the end of every row and
        // a different mark at the start.
        ".sc-live-state{font-size:10.5px;font-weight:700;white-space:nowrap}",
        ".sc-live-row[data-state=\"checked\"] .sc-live-mark,.sc-live-row[data-state=\"checked\"] .sc-live-state{color:#166534}",
        ".sc-live-row[data-state=\"checked\"] .sc-live-text{color:#1f2733}",
        ".sc-live-row[data-state=\"checking\"] .sc-live-mark,.sc-live-row[data-state=\"checking\"] .sc-live-state{color:#6d28d9}",
        ".sc-live-row[data-state=\"checking\"]{background:#f5f3ff;border-radius:5px}",
        ".sc-live-row[data-state=\"waiting\"] .sc-live-mark,.sc-live-row[data-state=\"waiting\"] .sc-live-state{color:#94a3b8}",
        "@media (max-width: 640px){.sc-live-row{grid-template-columns:14px minmax(0,1fr);row-gap:1px}.sc-live-state{grid-column:2}}",
        ".sc-rubric-stack{display:none}",
        ".sc-rubric-wide{overflow-x:auto}",
        ".sc-rubric table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11.5px}",
        // index.css gives every th nowrap, uppercase and sticky positioning,
        // which put the row headers on one line straight across the next
        // column. This table's headers are prose, so it opts out.
        ".sc-rubric th,.sc-rubric td{border:1px solid #e2e8f0;padding:6px 7px;text-align:left;vertical-align:top;line-height:1.35;white-space:normal;text-transform:none;letter-spacing:0;position:static;overflow-wrap:anywhere}",
        ".sc-rubric thead th{background:#f8fafc;font-size:11px;font-weight:800;color:#1f2733;width:17.4%}",
        ".sc-rubric thead th:first-child{width:13%}",
        ".sc-rubric thead th span{display:block;font-weight:400;color:#64748b}",
        ".sc-rubric tbody th{background:#f8fafc;color:#1f2733}",
        ".sc-rubric td{background:#fff;color:#475569}",
        ".sc-rubric-dim{display:block;font-weight:800;font-size:12px;color:#1f2733}",
        ".sc-rubric-state{display:block;margin-top:3px;font-size:10.5px;font-weight:600;color:#64748b}",
        // A row with no band says so in the amber this page already uses for
        // "not assessed", and highlights no cell at all.
        ".sc-rubric [data-state=\"not-assessed\"] .sc-rubric-state,.sc-rubric [data-state=\"checked-not-scored\"] .sc-rubric-state{color:#92400e}",
        ".sc-rubric [data-state=\"not-assessed\"] td,.sc-rubric [data-state=\"not-assessed\"] li{background:#f8fafc}",
        ".sc-rubric [data-cell=\"achieved\"]{background:#f5f3ff;color:#1f2733;font-weight:700;outline:2px solid #6d28d9;outline-offset:-2px}",
        ".sc-rubric [data-cell=\"next\"]{outline:2px dashed #a78bfa;outline-offset:-2px}",
        ".sc-rubric-mark{display:block;font-size:10px;font-weight:800;color:#6d28d9;margin-bottom:2px}",
        // Where the dimension came from, on the row itself: the page shows
        // three tabs and four dimensions, and readers hunt for the other two.
        ".sc-rubric-src{display:block;margin-top:4px;font-size:10.5px;color:#64748b;font-weight:400}",
        ".sc-rubric-why-btn{display:block;margin-top:5px;padding:0;border:0;background:none;cursor:pointer;font-size:10.5px;font-weight:700;color:#6d28d9;text-align:left;font-family:inherit}",
        ".sc-rubric-why-btn:hover,.sc-rubric-why-btn:focus-visible{text-decoration:underline}",
        // The reasoning the second table used to hold. Full row width, because
        // it is a paragraph and the dimension column is 13%.
        ".sc-rubric-why{font-size:12px;line-height:1.5;color:#475569;background:#fbfcfe}",
        ".sc-rubric-why p{margin:0 0 5px}",
        ".sc-rubric-why p:last-child{margin-bottom:0}",
        ".sc-rubric-why b{color:#1f2733}",
        ".sc-rubric-noreason{color:#92400e}",
        ".sc-rubric-card{border:1px solid #e2e8f0;border-radius:8px;padding:9px 10px;background:#fff}",
        ".sc-rubric-card ol{list-style:none;margin:7px 0 0;padding:0;display:grid;gap:5px}",
        ".sc-rubric-card li{border:1px solid #e2e8f0;border-radius:6px;padding:6px 7px;font-size:11.5px;color:#475569;line-height:1.35;background:#fff}",
        ".sc-rubric-band{display:block;font-size:11px;font-weight:700;color:#1f2733}",
        ".sc-rubric-card .sc-rubric-mark{display:inline;margin:0 0 0 6px}",
        "@media (max-width: 760px){.sc-rubric-wide{display:none}.sc-rubric-stack{display:grid;gap:10px}}",
        ".sc-band-graphic{--g-ink:#1f2733;--g-mute:#64748b;--g-track:#e2e8f0;--g-on:#7c3aed;--g-hatch-bg:#f1f5f9;--g-hatch-line:#cbd5e1;--g-surface:#fff;--g-edge:#e2e8f0}",
        "@media (prefers-color-scheme: dark){.sc-band-graphic{--g-ink:#e2e8f0;--g-mute:#94a3b8;--g-track:#334155;--g-on:#a78bfa;--g-hatch-bg:#1e293b;--g-hatch-line:#475569;--g-surface:#0f172a;--g-edge:#334155}}",
      ].join("")}</style>
      {/* The design's page width. The result used to break out of an 880px
          column with negative margins to get its table readable; with the
          column this wide it simply fits. */}
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
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
          {/* SNOOZABLE, and only here. This is the repeated reminder at the
              top of the page, which someone running the check weekly read on
              every visit. The same sentence beside a band qualifies that
              specific number, and the copies in both exports travel to people
              who dismissed nothing, so neither of those is snoozable.

              Deliberately NOT behind the guidance master switch: turning off
              tips should not turn off a disclaimer. */}
          {!disclaimerSnoozed(disclaimerSnoozedAt) && (
            <p style={{ ...muted, marginTop: 8, background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ flex: 1 }}>{SELF_CHECK_DISCLAIMER}</span>
              <button
                type="button"
                onClick={snoozeDisclaimer}
                title={`Hide this reminder for ${DISCLAIMER_SNOOZE_DAYS} days on this device. It comes back after that, and it still appears beside every band and in both downloads.`}
                aria-label={`Hide this reminder for ${DISCLAIMER_SNOOZE_DAYS} days`}
                style={{ flexShrink: 0, border: "1px solid #fdba74", background: "#fff", color: "#9a3412", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, lineHeight: 1, padding: "3px 7px" }}
              >
                &#10005;
              </button>
            </p>
          )}
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

        {/* The four steps run LEFT TO RIGHT in one row, as the supplied design
            has them: area, written procedure, records, run. Stacked one under
            another they were a column of headings to scroll through before any
            work could start, and they are four short fields.

            The whole block folds, the way the design's "Inputs used for this
            check" card does, so a result is not read past the form that made
            it. It opens itself while nothing has been run and while a check is
            running, because that is when the form is the page. */}
        <details
          className="sc-inputs"
          open={inputsOpen}
          // Only this element's own toggle: React 19 lets a nested <details>
          // (the run history, "what goes in each box") bubble its toggle up.
          onToggle={(e) => { if (e.target === e.currentTarget) setInputsOpen(e.currentTarget.open); }}
        >
          <summary className="sc-inputs-summary">
            <span>Inputs used for this check</span>
            <span className="sc-inputs-pill">{area ? `${area.scope} ${area.title}` : "No area chosen yet"}</span>
          </summary>

          <div className="sc-inputs-body">
            <div className="sc-field">
              <label htmlFor="sc-area"><StepDot n={1} />Which area do you look after?</label>
              <select id="sc-area" value={scope} onChange={(e) => { setScope(e.target.value); setRunIndex(0); setConfirmDelete(null); setAllRuns(false); setPhase("idle"); setError(null); setConfirmOverwrite(false); }}
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
            </div>

            {/* The dimming that used to belong to a whole card belongs to the
                cell now, so an unpicked area still greys the fields it blocks. */}
            <div className="sc-field" style={{ opacity: area ? 1 : 0.55 }}>
              <LinkField
                step={2}
                label="Where is your written procedure?"
                value={procLink} onChange={setProcLink} state={procState} disabled={!area || running}
                onEdit={() => { setError(null); setConfirmOverwrite(false); }}
              />
            </div>

            <div className="sc-field" style={{ opacity: area ? 1 : 0.55 }}>
              <LinkField
                step={3}
                label="Where is your evidence?"
                value={evLink} onChange={setEvLink} state={evState} disabled={!area || running}
                onEdit={() => { setError(null); setConfirmOverwrite(false); }}
              />
            </div>

            <div className="sc-field sc-run-field" style={{ opacity: ready || running ? 1 : 0.55 }}>
              <label><StepDot n={4} />Run the check</label>
              <button
                type="button" className="sc-run-button"
                style={{ opacity: ready && !running ? 1 : 0.45, cursor: ready && !running ? "pointer" : "not-allowed" }}
                disabled={!ready || running || confirmOverwrite} onClick={() => void run()}
              >
                {/* NEVER a dead grey button: pressing it with a result already
                    stored opens the confirmation, and the label has to say that
                    rather than just going flat, which is what "clicking it does
                    nothing" looked like. */}
                {running ? "Checking…" : confirmOverwrite ? "Confirm below ↓" : plan.canRun ? plan.button : "Check my area"}
              </button>
            </div>
          </div>

          {/* Everything the four fields need said, under the row rather than
              between the fields: what the area covers, what has been checked
              before, which folder goes in which box, and what this run will and
              will not do. */}
          <div className="sc-inputs-more">
            {/* FIRST in this block, directly under the button that raises it.
                It used to sit below the area description, the earlier checks
                and the folder guidance, so pressing "Check my area" on an area
                that already has a result greyed the button and put the only
                thing you could do next off the bottom of the card. */}
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

          {/* The guidance box and its "what goes in each box" expander that
              used to stand here are behind the numbers on the row itself now
              (STEP_HELP): every word of them is in step 2 and step 3,
              including the swapped-folder warning, which is repeated in both
              because there is no honest detector for a swapped pair. */}

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
          {/* Only while nothing is running: during a run the same sentence is
              inside the panel with the cat and the timer, not repeated here. */}
          {plan.note && !running && (
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


          {running && (
            <div className="sc-proc">
              {/* ONE panel while the check runs: the cat, the elapsed time, the
                  finish estimate, what the check is doing with your documents
                  and the rotating line. These were three separate blocks — a
                  timer line at the top, the plan note above the stage list and
                  the cat below it — for one piece of information.

                  The cat is also the only thing here that moves between engine
                  events: the stage list is entirely event-driven and holds
                  still for 15 to 25 seconds at a time, which reads as a freeze. */}
              <div className="sc-proc-head">
                <WaitingCat />
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Elapsed time runs for the whole check, from the first stage
                      to the last, so a long run is never indistinguishable from
                      a hang. The estimate appears only once a requirement has
                      actually finished, so it is measured pace rather than an
                      invented constant. */}
                  <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>
                    Running for {formatElapsed(now - (runStartedAt || now))}
                    {remaining && <span style={{ ...muted, fontWeight: 400 }}> · {remaining}</span>}
                  </div>
                  {plan.note && (
                    <div style={{ ...muted, marginTop: 4 }}>
                      {plan.note}
                      {plan.kind === "full" && " I will then read the same documents again looking for results and review records, and report what they show for the two areas this check used to leave alone."}
                    </div>
                  )}
                  <div style={{ ...muted, marginTop: 4 }}>{waitingMessage(now - (runStartedAt || now))}</div>
                </div>
                {/* Quiet, and desktop only: it answers "is this normal?" without
                    competing with the elapsed time. */}
                <span className="sc-proc-hint">Usually a few minutes</span>
              </div>

              {/* Two columns inside ONE bounded workspace: the five stages on
                  the left, the documents on the right. Both panes scroll
                  INSIDE the frame, so a folder of 150 files no longer makes the
                  page itself hundreds of pixels taller than the content, and a
                  folder of one file no longer leaves a white field under it. */}
              <div className="sc-proc-body">
              <div className="sc-proc-pane">
                <div className="sc-proc-label">Progress</div>
                <div className="sc-proc-scroll">
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

                </div>
              </div>

              <div className="sc-proc-pane">
                <div className="sc-proc-label">Live activity</div>
                <div className="sc-proc-scroll">
                {/* WHICH DOCUMENTS, not just which stage. A run over 154 files
                    showed one line ("Checking requirement 1 of 6") for 50
                    minutes, with no way to see which file or which call it was
                    on, let alone skip it. This is the ledger the Evidence
                    Folder page has always had, with its per-file Skip. */}
                {/* WHAT IT IS ESTABLISHING, first, because "a file is open"
                    is not the question a reader is asking at minute 16. The
                    requirement is in the Guidance Document's own words: no
                    short form exists in the data and none is invented here.
                    Capped at two, with the rest marked on the board below,
                    rather than reprinting a whole batch of wording twice. */}
                {doingNow && (
                  <div className="sc-now">
                    <div className="sc-now-head">{doingNow.verb}:</div>
                    <ul className="sc-now-list">
                      {doingNow.refs.slice(0, 2).map((ref) => (
                        <li key={ref}>
                          {lineText[ref]?.parent && <span className="sc-now-parent">{lineText[ref]!.parent} </span>}
                          {lineText[ref]?.text ?? ref}
                          <span className="sc-now-ref">{ref}</span>
                        </li>
                      ))}
                    </ul>
                    {doingNow.refs.length > 2 && (
                      <div className="sc-now-more">and {doingNow.refs.length - 2} more in the same request, marked below</div>
                    )}
                    {(liveProgress?.currentWindowFiles?.length ?? 0) > 0 && (
                      <div className="sc-now-files"><b>In:</b> {liveProgress!.currentWindowFiles!.join(", ")}</div>
                    )}
                  </div>
                )}

                {/* ANYTHING THAT HAS GONE WRONG, first and unfolded. A batch
                    failure is the thing a reader most needs while there is
                    still time to act on it, and it used to be visible only
                    inside the expandable log. */}
                {liveFailures.rows.length > 0 && (
                  <div className="sc-live-fails">
                    <div className="sc-live-fails-head">&#9888; {liveFailures.rows.length + liveFailures.more} problem{liveFailures.rows.length + liveFailures.more === 1 ? "" : "s"} so far</div>
                    {liveFailures.rows.map((t, i) => <div key={i} className="sc-live-fail">{t}</div>)}
                    {liveFailures.more > 0 && <div className="sc-live-more">and {liveFailures.more} earlier, in the full log below</div>}
                  </div>
                )}

                {/* WHERE EACH REQUIREMENT HAS GOT TO, and deliberately NOT what
                    it was judged. A line's verdict is the raw model answer
                    until four code-level gates run after the judge loop, so a
                    verdict shown here could be contradicted by the result.
                    Reached, being checked and still to do cannot be. */}
                {liveLines && (
                  <div className="sc-live-board">
                    <div className="sc-live-board-head">
                      {linePassLabel(phase)}: <b>{liveLines.checked}</b> checked
                      {liveLines.checking > 0 && <> · <b>{liveLines.checking}</b> being checked</>}
                      {liveLines.waiting > 0 && <> · <b>{liveLines.waiting}</b> still to do</>}
                      {/* Each pass counts its own lines, and the run has two.
                          Saying which one stops the reset reading as lost
                          work, and stops the count reading as a verdict. */}
                      <span className="sc-live-board-note">Each pass counts its own lines. Results are reported when the check finishes, not line by line.</span>
                    </div>
                    <ol className="sc-live-rows">
                      {liveLines.lines.map((l) => <LiveLineRow key={l.ref} line={l} req={lineText[l.ref]} />)}
                    </ol>
                  </div>
                )}

                {runLedger.length > 0 && (
                  <FileLedger
                    files={runLedger}
                    isActive
                    progress={{ currentFileName: liveProgress?.currentFile, currentFileAction: "Reading" }}
                    onSkipFile={() => useWorkspaceStore.getState().skipCurrentFile()}
                  />
                )}

                {/* THE WHOLE RUN'S LOG, not only the line in flight. The engine
                    has always kept it (both passes append to their own `log`);
                    this page showed the current activity and nothing about what
                    had already happened, so a reader could not tell what had
                    been read before the stage that was hanging. Newest last, so
                    it reads like a transcript. */}
                {runLog.length > 0 && (
                  <details open={logOpen} onToggle={(e) => { if (e.target === e.currentTarget) setLogOpen(e.currentTarget.open); }} style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", listStyle: "revert", fontSize: 12, fontWeight: 800, color: "#475569" }}>
                      Activity log ({runLog.length} {runLog.length === 1 ? "line" : "lines"})
                    </summary>
                    <div className="sc-proc-log">
                      {runLog.map((l, i) => (
                        <div key={`${l.at}-${i}`} style={{ display: "flex", gap: 8, padding: "2px 0", color: LOG_TONE[l.tone ?? "info"] }}>
                          <span style={{ color: "#94a3b8", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                            {new Date(l.at).toLocaleTimeString("en-SG", { hour12: false })}
                          </span>
                          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{l.text}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                </div>
                {/* PINNED under the list, never inside it: what the request in
                    flight is reading. Every pass reports it now, including the
                    results-and-review one, which used to say only "window 1/3 ·
                    batch 1/2". */}
                {/* A manual skip, available the whole time rather than only
                    after a minute of silence: a file that is merely slow is
                    still the file the reader wants to move past. Same two
                    actions the stall panel offers.

                    HIDDEN once the stall panel appears, because the panel
                    offers the identical action a few lines below with the
                    explanation of what skipping does attached, and the two
                    were on screen together. Not deleted: the panel only shows
                    after a minute of silence, and before that this is the
                    only way to move past a file that is merely slow. */}
                {(liveProgress?.canSkipCurrentFile || canSkipAiCall) && stall.level === "none" && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const st = useWorkspaceStore.getState();
                        if (liveProgress?.canSkipCurrentFile) st.skipCurrentFile();
                        else st.skipCurrentAiCall();
                      }}
                      style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 8, border: "1px solid #fbbf24", background: "#fffbeb", color: "#92400e", cursor: "pointer" }}
                    >
                      {liveProgress?.canSkipCurrentFile
                        ? `Skip ${liveProgress.currentFile ? `"${liveProgress.currentFile}"` : "this file"}`
                        : "Skip this step and carry on"}
                    </button>
                  </div>
                )}

                <div className="sc-proc-status">
                  {(liveProgress?.currentWindowFiles?.length ?? 0) > 0 ? (
                    <p style={{ ...muted, margin: 0 }}>
                      <b style={{ color: INK }}>Now checking against:</b> {liveProgress!.currentWindowFiles!.join(", ")}
                    </p>
                  ) : (liveProgress?.filesFound?.length ?? 0) === 0 ? (
                    <p style={{ ...muted, margin: 0 }}>The documents this step is using appear here as it opens them.</p>
                  ) : (
                    <p style={{ ...muted, margin: 0 }}>{plainDetail(liveProgress?.detail || "") || "Reading your documents."}</p>
                  )}
                </div>
              </div>
              </div>

              <div className="sc-proc-foot">
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
                  {(stall.level === "stuck" || stall.control !== "cancel") && (
                    <div style={{ marginTop: 9 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const st = useWorkspaceStore.getState();
                          if (stall.control === "skip") st.skipCurrentFile();
                          else if (stall.control === "skip-call") st.skipCurrentAiCall();
                          else stop();
                        }}
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
          </div>
        </details>

        {/* The result */}
        {showResult && area && (
          <section style={card} ref={resultRef}>
            {/* No step number: 1 to 4 are the things you DO, and they now run
                left to right across the input row. This is what came back. */}
            <h2 style={h2}>Your result</h2>
            <p style={{ ...muted, marginTop: 0 }}>
              {area.scope} {area.title} · {procedureOnlyResult ? "written procedure only" : "procedure and records"} · checked {shownRun?.label || ranAt}
              {shownRun?.duration && ` · took ${shownRun.duration}`}
            </p>

            {/* The supplied design: a sticky sidebar of jump links and exports
                beside a column of one card per requirement. The sidebar is the
                only part that is duplicated — its two export buttons are the
                same handlers as the pair at the foot of the result, because the
                sidebar is hidden below 980px. */}
            <div className="sc-results-layout">
              <aside className="sc-side">
                <div className="sc-side-card">
                  <h3>Requirements <span style={{ ...muted, fontWeight: 400 }}>({visibleRows.length}{visibleRows.length === rows.length ? "" : ` of ${rows.length}`})</span></h3>
                  <p style={{ ...muted, margin: "0 0 6px", fontSize: 11.5 }}>Select one requirement to inspect. The main panel shows only that requirement.</p>
                  <div className="sc-side-list">
                    {/* Only the requirements the filter and the search leave on
                        offer, as the design has it: a link that cannot be shown
                        is not an option. */}
                    {visibleRows.map((r) => (
                      <button
                        key={r.ref} type="button" className="sc-req-link"
                        data-selected={selected?.ref === r.ref || undefined}
                        aria-current={selected?.ref === r.ref || undefined}
                        onClick={() => setSelectedRef(r.ref)}
                      >
                        <span aria-hidden className="sc-req-dot" style={{ background: TONE_BG[r.tone].fg }} />
                        <span className="sc-req-code" style={{ color: INK }}>{r.ref}</span>
                        <span className="sc-req-title">{r.requirement}</span>
                        <span className="sc-req-state" style={{ color: TONE_BG[r.tone].fg }}>{r.icon} {r.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sc-side-card sc-download-card">
                  <h3>Export</h3>
                  <div style={{ display: "grid", gap: 7 }}>
                    <button type="button" onClick={onPdf} style={{ ...bigBtn, fontSize: 12.5, padding: "8px 11px", textAlign: "left" }}>⬇ Download PDF</button>
                    <button type="button" onClick={onCsv} style={{ ...bigBtn, fontSize: 12.5, padding: "8px 11px", textAlign: "left", background: "#fff", color: INK, border: "1px solid #cbd5e1" }}>⬇ Download CSV</button>
                  </div>
                </div>
              </aside>

              <div className="sc-main">
                <div className="sc-hero">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14, color: INK }}>{tab === "overview" || procedureOnlyResult ? "This area, requirement by requirement" : `${VIEW_LABEL[tab]}, requirement by requirement`}</b>
                    <span style={{ ...TONE_BG.neutral, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {counts.total} requirement {counts.total === 1 ? "line" : "lines"}
                    </span>
                  </div>

                  {/* The check asks two separate questions and they fail
                      independently: your procedure can be silent while your
                      records are full, and the other way round. Each tab
                      carries its own one-line hint, so all three meanings are
                      readable whichever one is open, and the active tab's
                      fuller sentence follows as the subheader. */}
                  {!procedureOnlyResult && (
                    <div className="sc-view-tabs">
                      {(["overview", "procedure", "records"] as const).map((k) => (
                        <button
                          key={k} type="button" aria-pressed={tab === k}
                          onClick={() => { setTab(k); setFilter("all"); setQuery(""); }}
                          className="sc-view-tab"
                          style={{
                            borderColor: tab === k ? INK : "#cfd8e6", background: tab === k ? INK : "#fff",
                            color: tab === k ? "#fff" : INK,
                          }}
                        >
                          <strong>{k === "overview" ? "Overall" : VIEW_LABEL[k]}</strong>
                          <span style={{ color: tab === k ? "#dbe3ef" : "#65728a" }}>{TABS_EXPLAINED[k].hint}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!procedureOnlyResult && (
                    <div className="sc-view-subheader">
                      <b>{tab === "overview" ? "Overall" : VIEW_LABEL[tab]}:</b> {TABS_EXPLAINED[tab as "overview" | "procedure" | "records"].text}
                      {/* What this tab does NOT settle. It was a yellow box of
                          its own under the counts. A title attribute was tried
                          and was no better than nothing: it needs a steady
                          hover, never fires on a click or a touch, and the user
                          reported exactly that. This is a real button that
                          opens the sentence in place, so it works on click, on
                          keyboard and on a phone. The sentence still prints in
                          full in the PDF and the CSV. */}
                      {VIEW_NOTE[view] && (
                        <>
                          <button type="button" onClick={() => setViewNoteOpen((v) => !v)} aria-expanded={viewNoteOpen}
                            style={{ marginLeft: 6, cursor: "pointer", font: "inherit", fontWeight: 800, color: "#92400e", background: "none", border: "none", padding: 0, textDecoration: "underline" }}>
                            &#9432; {viewNoteOpen ? "Hide" : "What this tab does not answer"}
                          </button>
                          {viewNoteOpen && (
                            <span style={{ display: "block", marginTop: 6, color: "#92400e" }}>{VIEW_NOTE[view]}</span>
                          )}
                        </>
                      )}
                    </div>
                  )}

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

                {/* A procedure-only result answers "is it written down?", so it is
                    counted in those words. "Complies" on a run that never opened a
                    record would be a claim nobody made. */}
                <div className="sc-stats">
                  <Tally n={counts.complies} label={VIEW_TALLY[view].complies} tone="good" />
                  {VIEW_TALLY[view].partly && <Tally n={counts.partly} label={VIEW_TALLY[view].partly!} tone="medium" />}
                  <Tally n={counts.doesNot} label={VIEW_TALLY[view].doesNot} tone="critical" />
                  <Tally n={counts.couldNotCheck} label="could not check" tone="neutral" />
                </div>

                {/* Half and half: the coverage bar for this tab on the left,
                    the ONE APSR graphic this tab gets on the right. There used
                    to be two of these graphics on the two half-tabs — the
                    "← this tab" one here and a second, identical one inside
                    the dimension panel below. The panel keeps its table; the
                    picture lives here. */}
                <div className="sc-hero-split">
                  <div>
                    <Svg html={tallyBarSvg(tallySlices(counts, view), SCREEN_BAND_PALETTE)} />
                  </div>
                  {bandWorking && (
                    <div>
                      <Svg html={bandGraphicSvg(bandGraphic(bandWorking), SCREEN_BAND_PALETTE, feedsFor(view) ? { feeds: feedsFor(view) } : { minWidth: 380 })} />
                      {feedsFor(view) && <p style={{ ...muted, margin: "4px 0 0", fontSize: 11.5 }}>{feedsFor(view)!.caption}</p>}
                    </div>
                  )}
                </div>
                </div>

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

                {/* ONE requirement at a time, chosen in the selector on the
                    left, as the supplied design has it. The filters and the
                    search narrow what the selector offers; they never change a
                    verdict, and the count above still covers the whole tab.

                    The rows are the SAME rows the table had, and they are
                    already per-tab: toSelfCheckRows / toProcedureRows /
                    toRecordsRows. Switching tab rebuilds the selector and the
                    stage, with no new assessment logic anywhere. */}
                <div className="sc-workspace-heading">
                  <h3>Requirement detail</h3>
                  <span className="sc-workspace-position">
                    {selected
                      ? `${selectedIdx + 1} of ${visibleRows.length} shown · ${selected.ref}`
                      : "No requirement matches this filter"}
                  </span>
                </div>

                <div className="sc-toolbar">
                  {filterDefs.map((f) => (
                    <button key={f.key} type="button" className="sc-filter" data-on={filter === f.key || undefined}
                      onClick={() => setFilter(f.key)}>{f.label}</button>
                  ))}
                  <input
                    className="sc-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search code, requirement or finding" aria-label="Search requirements"
                  />
                </div>

                <div className="sc-stage">
                  {selected ? (
                    <FindingCard key={`${view}-${selected.ref}`} row={selected} view={view} id={findingId(view, selected.ref)} />
                  ) : (
                    <p style={{ ...muted, border: "1px dashed #cfd8e6", borderRadius: 12, padding: 24, textAlign: "center", margin: 0, background: "#fff" }}>
                      No requirement matches this filter. This tab checked {rows.length} requirement {rows.length === 1 ? "line" : "lines"}.
                    </p>
                  )}
                </div>

            {/* ── AUDIT SUPPORT ────────────────────────────────────────────
                Everything below the requirement above is supporting material,
                and it used to arrive as a dozen full-width panels of apparently
                equal weight: files, then the two-sides count, then the band,
                then the legend, then the dimension table, then what the full
                audit wants, then the results-and-review pass, then the official
                evidence list. Nothing is removed here. It is grouped into three
                categories, one shown at a time, with the long parts folded.

                The categories carry the same per-tab content they always did:
                the file list is this tab's pass, the legend is this tab's
                vocabulary, and nothing is copied across a tab that has no such
                data. */}
            <div className="sc-support">
              <div className="sc-support-head">
                <b style={{ fontSize: 14, color: INK }}>Audit support</b>
                <p style={{ ...muted, margin: "3px 0 0" }}>
                  The requirement above is the result. This is the supporting evidence, how the check works, and what the full audit adds.
                </p>
              </div>

              <div className="sc-support-tabs" role="tablist" aria-label="Audit support">
                {SUPPORT_TABS.map((t) => (
                  <button
                    key={t.key} type="button" role="tab" aria-selected={supportTab === t.key}
                    onClick={() => setSupportTab(t.key)}
                    className="sc-support-tab" data-on={supportTab === t.key || undefined}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {supportTab === "files" && (
                <div className="sc-support-body">
                  <p style={{ ...muted, margin: "0 0 4px" }}>
                    What this tab&rsquo;s pass opened, and what the official requirement expects a passing record to contain.
                  </p>
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

            {/* RE-READ ONE FILE. A document that was unreadable, or that has
                since been replaced with a better scan, used to mean running the
                whole area again: 150 files fetched to fix one. This reads that
                one file again (the rest come from this session's text cache)
                and re-checks ONLY the requirement lines that quoted it. It says
                so before it runs, and it says what it did not redo after. */}
            {rereadFiles.length > 0 && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 13px", margin: "12px 0", background: "#fff" }}>
                <b style={{ fontSize: 13 }}>Read one file again</b>
                <p style={{ ...muted, margin: "4px 0 8px" }}>
                  For a file that could not be read, or one you have since replaced in Drive. It reads that file again and re-checks only the
                  requirement lines that quoted it. Every other line, and the whole written-procedure side, stays exactly as it is.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={rereadKey} onChange={(e) => { setRereadKey(e.target.value); setRereadNote(""); }}
                    disabled={rereading}
                    style={{ ...input, width: "auto", minWidth: 260, maxWidth: "100%", flex: "1 1 260px", padding: "8px 10px", fontSize: 13, cursor: "pointer" }}
                  >
                    <option value="">Choose a file this check read…</option>
                    {rereadFiles.map((f) => (
                      <option key={f.key} value={f.key}>{f.name}{f.lines === 0 ? " (no line quoted it)" : ` (${f.lines} ${f.lines === 1 ? "line" : "lines"} quoted it)`}</option>
                    ))}
                  </select>
                  <button
                    type="button" disabled={!rereadKey || rereading}
                    onClick={() => {
                      if (!area || !rereadKey) return;
                      setRereading(true); setRereadNote("");
                      void useWorkspaceStore.getState().recheckFileLines(area.scope, rereadKey)
                        .then((r) => setRereadNote(r.message))
                        .finally(() => { setRereading(false); setRunIndex(0); });
                    }}
                    style={{ ...bigBtn, fontSize: 13, padding: "8px 14px", opacity: !rereadKey || rereading ? 0.45 : 1, cursor: !rereadKey || rereading ? "not-allowed" : "pointer" }}
                  >
                    {rereading ? "Reading it again…" : "Read again and re-check its lines"}
                  </button>
                </div>
                {rereadNote && <p style={{ ...muted, margin: "8px 0 0", color: INK }}>{rereadNote}</p>}
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
                <details>
                  <summary style={{ cursor: "pointer", listStyle: "revert", fontSize: 13, fontWeight: 700, color: INK }}>
                    View expected evidence ({expectedGroups.reduce((n, g) => n + g.items.length, 0)} {expectedGroups.reduce((n, g) => n + g.items.length, 0) === 1 ? "entry" : "entries"})
                  </summary>
                {expectedGroups.map((g) => (
                  <div key={g.itemId} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#475569" }}>Requirement {g.itemId}</div>
                    <ul style={{ ...muted, margin: "2px 0 0", paddingLeft: 17 }}>
                      {g.items.map((i) => <li key={i}>{i}</li>)}
                    </ul>
                  </div>
                ))}
                </details>
              </div>
            )}

                </div>
              )}

              {supportTab === "how" && (
                <div className="sc-support-body">
                  <p style={{ ...muted, margin: "0 0 4px" }}>
                    What this check settles, what each result means, and the four EduTrust dimensions behind it.
                  </p>
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

            {/* The two dimensions this check can defend, and the two it leaves
                alone. It shows no overall band: scoring Systems & Outcomes and
                Review at the bottom for never having been opened understated a
                genuinely Band 4 area as Band 3, which is an absence of
                assessment presented as a judgement. The rows-to-dimension step
                is a judgement and not arithmetic, and the note says so rather
                than drawing an arrow that does not exist. */}
            {/* ON EVERY TAB, not just Overall. The four dimensions describe the
                RUN, not the tab, and hiding the table on Procedure and Records
                read as the APSR working having gone missing. */}
            {bandWorking && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "13px 15px", margin: "14px 0 0", background: "#fff" }}>
                <b style={{ fontSize: 14 }}>What this check assessed</b>
                {dimensionCoverage && <p style={{ ...muted, margin: "8px 0 2px" }}>{dimensionCoverage}</p>}
                {/* The four dimensions and what each earned, in one line each.
                    The same numbers the table below carries, read straight off
                    the same rows — nothing here is recomputed. */}
                <RubricMatrixView working={bandWorking} />
                {/* Kept when the second table it used to close went: it says
                    the rows below the matrix do not add up into these
                    dimensions, which nothing else on the page says. */}
                <p style={{ ...muted, margin: "9px 0 0" }}>{ROWS_DO_NOT_SUM_NOTE}</p>
                {/* NOT folded: it says whether all four dimensions were really
                    judged on this run, which changes how every number above
                    reads. */}
                <p style={dimensionsChecked
                  ? { ...muted, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 8, padding: "9px 11px" }
                  : { ...muted, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8, padding: "9px 11px" }}>
                  {dimensionsNote(bandWorking)}
                </p>


                <p style={{ ...muted, marginBottom: 0, marginTop: 8 }}>{INFERRED_THRESHOLDS_NOTE}</p>
              </div>
            )}

            {/* A run stored before the dimension working was kept has none, and
                so does a run where nothing could be read. The panel above then
                renders nothing at all, which looks exactly like the table
                having been dropped from the page. Say which it is instead. */}
            {!bandWorking && (
              <p style={{ ...muted, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px 13px", margin: "14px 0 0" }}>
                <b style={{ color: INK }}>No APSR dimension working is stored for this check.</b> The four dimensions,
                their percentages and the table of official descriptors come from one more AI call at the end of the
                run, and this check carries none. Either it was run before that working was kept with the result, or
                that call did not come back. Which of the two is recorded on the <b>AI Run Log</b> page under
                &ldquo;Holistic Band Assessor&rdquo;, with the error if there was one. Running the check again is what
                produces it.
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
                  The four are broken out in the matrix above.
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

            {/* WHAT THE NEXT BAND NEEDS. Every number is derived: the shortfall
                from the configured thresholds, the target wording from the
                official descriptor one band up, and the named lines from the
                run's own verdicts. It promises nothing and routes nothing that
                the arithmetic does not already say. */}
            {view === "overview" && bandRoute.kind === "route" && (
              <div style={{ border: "1px solid #c7d2fe", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fff" }}>
                <b style={{ fontSize: 14, color: INK }}>{CLIMB_HEADING}</b>
                <p style={{ ...muted, margin: "5px 0 0" }}>{nextBandWorking(bandRoute)}</p>
                <p style={{ ...muted, margin: "5px 0 9px" }}>{NEXT_BAND_CAVEAT}</p>
                <ClimbList options={bandRoute.options} />
                <p style={{ ...muted, margin: "9px 0 0" }}>{INFERRED_THRESHOLDS_NOTE}</p>
              </div>
            )}
            {/* AT THE TOP BAND, the ladder stays. An area at 95% can still
                have a dimension at Band 4, and this block used to vanish
                entirely there, taking the one remaining step with it. */}
            {view === "overview" && bandRoute.kind === "top" && (
              bandRoute.allAtTop ? (
                <p style={{ ...muted, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 8, padding: "9px 11px" }}>
                  {NEXT_BAND_TOP_NOTE}
                </p>
              ) : (
                <div style={{ border: "1px solid #c7d2fe", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fff" }}>
                  <b style={{ fontSize: 14, color: INK }}>{CLIMB_HEADING_AT_TOP}</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>{TOP_BAND_WITH_ROOM_NOTE}</p>
                  <p style={{ ...muted, margin: "5px 0 9px" }}>{NEXT_BAND_CAVEAT}</p>
                  <ClimbList options={bandRoute.options} />
                  <p style={{ ...muted, margin: "9px 0 0" }}>{INFERRED_THRESHOLDS_NOTE}</p>
                </div>
              )
            )}

            {/* EMPTY, and only one line of it. Saying that nothing has been
                recorded is worth a sentence, not a full card: the card's job
                is telling two DIFFERENT numbers apart, and with only one of
                them present there is nothing to tell apart. The fuller
                version below is kept for when a band really is recorded. */}
            {view === "overview" && band.kind === "none" && selfTotal && (
              <p style={{ ...muted, margin: "10px 0" }}>
                <b style={{ color: INK }}>Your audit lead has not recorded a band for this area yet.</b>{" "}
                The band above is this check&rsquo;s own working, and theirs appears here when they set it.
              </p>
            )}
            {view === "overview" && !(band.kind === "none" && selfTotal) && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, margin: "12px 0", background: "#fbfcfe" }}>
              {band.kind === "none" ? (
                <>
                  <b style={{ fontSize: 14 }}>This check gives no band</b>
                  <p style={{ ...muted, margin: "5px 0 0" }}>{NO_BAND_LINE}</p>
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


            {/* LAST in the panel, which reads: what was assessed (the counts
                and the matrix), how it was judged (the reasoning that opens on
                each row), then what the result means. It used to sit between
                the matrix and the old second table, which was the one place it
                broke the reading. */}
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

                </div>
              )}

              {supportTab === "outcomes" && (
                <div className="sc-support-body">
                  <p style={{ ...muted, margin: "0 0 4px" }}>
                    Results, reviews and improvement records, and what the full EduTrust audit looks at beyond this check.
                  </p>
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
            {/* On every tab, for the same reason as the panel above: this is
                what the results-and-review pass found for the whole run. */}
            {(
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", margin: "12px 0", background: "#fff" }}>
                  <b style={{ fontSize: 13.5 }}>Your results and review records</b>
                  {outcomeState.state !== "assessed" ? (
                    <p style={{ ...muted, margin: "6px 0 0" }}>{outcomeState.reason}</p>
                  ) : (
                    <>
                      <p style={{ ...muted, margin: "6px 0 10px" }}>
                        Read from the same documents listed at the top of this result, looked at a second time for results and review records.
                        {outcomeTally.assessed === 0
                          ? ` None of the ${outcomeTally.total} points of the official requirement could be judged on this pass.`
                          : ` ${outcomeTally.assessed} ${outcomeTally.assessed === 1 ? "point" : "points"} of the official requirement ${outcomeTally.assessed === 1 ? "was" : "were"} checked for both.`}
                      </p>

                      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 9 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Review, requirement by requirement</div>
                        <p style={{ ...muted, margin: "3px 0 7px" }}>
                          These are the official GD4 lines asking whether a process is reviewed for continual improvement.
                          A tick means a record of a review having happened was found and quoted. A procedure that says a review will happen is not one.
                        </p>
                        {outcomeReviewLines.length > 0 && (
                          <details>
                            <summary style={{ cursor: "pointer", listStyle: "revert", fontSize: 13, fontWeight: 700, color: INK }}>
                              View review records ({outcomeReviewLines.length} {outcomeReviewLines.length === 1 ? "line" : "lines"})
                            </summary>
                            <div style={{ marginTop: 6 }}>
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
                                  // A point whose AI call failed in every
                                  // window carries notAssessed: it is not a
                                  // point with no review record, and printing
                                  // it as one is the false negative this pass
                                  // is gated to avoid.
                                  ...TONE_BG[r.notAssessed ? "neutral" : r.reviewEvident ? "good" : "critical"],
                                  border: `1px solid ${TONE_BG[r.notAssessed ? "neutral" : r.reviewEvident ? "good" : "critical"].fg}`,
                                  padding: "1px 8px", borderRadius: 6, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                                }}>
                                  {r.notAssessed ? "? not checked" : r.reviewEvident ? "✓ record found" : "✗ none found"}
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
                          </details>
                        )}
                      </div>

                      <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 9, marginTop: 9 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Systems &amp; Outcomes, for this area as a whole</div>
                        <p style={{ ...muted, margin: "3px 0 7px" }}>
                          Outcome data means real figures, results or trends covering the period, not a statement that outcomes will be tracked.{" "}
                          {outcomeTally.assessed === 0 ? (
                            <>None of the {outcomeTally.total} points could be judged on this pass, so nothing is reported either way.{" "}</>
                          ) : (
                            <>
                              It was found for <b>{outcomeTally.withOutcome} of the {outcomeTally.assessed}</b> points this pass could judge.
                              {outcomeTally.notAssessed > 0 && ` ${outcomeTally.notAssessed} of the ${outcomeTally.total} points could not be judged at all on this pass, and are counted neither way.`}
                              {" "}
                            </>
                          )}
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

                  {bandWorking && (
                    <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 10, padding: "12px 14px", margin: "12px 0" }}>
                    {/* What the other two dimensions need. Every line below is
                        either the Guidance Document's own wording, the official
                        expected-evidence list filtered to entries that name the
                        dimension, or a gap this run itself reported. Moved here
                        from inside the dimension panel: it is about what the
                        full audit adds, not about this run's working. */}
                      <b style={{ fontSize: 13.5, color: "#1e40af" }}>Full audit context</b>
                  <p style={{ ...muted, margin: "6px 0 2px", color: "#1e3a8a" }}>{dimensionsChecked ? IMPROVE_HEADLINE_CHECKED : IMPROVE_HEADLINE}</p>
                  <p style={{ ...muted, margin: "0 0 10px", color: "#1e3a8a" }}>{dimensionsChecked ? IMPROVE_WHY_CHECKED : IMPROVE_WHY}</p>
                  <details>
                    <summary style={{ cursor: "pointer", listStyle: "revert", fontSize: 13, fontWeight: 700, color: "#1e40af" }}>What the full audit will look for</summary>
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
                  </details>
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
                  )}
                </div>
              )}
            </div>

            {/* The same two handlers as the sidebar's pair, and hidden at every
                width where that sidebar is on screen: two sets of download
                buttons on one page is one set too many. Below 900px the
                sidebar is gone, and this is the only way to export. */}
            <div className="sc-export-foot" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" onClick={onPdf} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px" }}>⬇ Download as PDF</button>
              <button type="button" onClick={onCsv} style={{ ...bigBtn, fontSize: 13.5, padding: "10px 18px", background: "#fff", color: INK, border: "1px solid #cbd5e1" }}>⬇ Download as spreadsheet (CSV)</button>
            </div>
            {note && <p style={{ ...muted, color: "#92400e", marginBottom: 0 }}>{note}</p>}
              </div>
            </div>
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

// The official rubric as a matrix: four dimensions down the side, the five
// bands across, the Guidance Document's own descriptor in every cell. Both
// shapes below are rendered from ONE rubricMatrix() call, so the phone cards
// and the desktop table cannot come to say different things.
//
// Nothing is marked by colour alone: the achieved cell carries the words
// "✓ This check" and the one above it "→ Next band", and a dimension with no
// band highlights nothing at all and says why on the row.
function RubricMatrixView({ working }: { working: ReturnType<typeof buildBandWorking> }) {
  const m = rubricMatrix(working);
  // The reasoning that used to be a SECOND four-row table under this one. It
  // is the only thing the grid has no room for, so it folds into the row it
  // belongs to instead of being restated beside it.
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const whyButton = (r: RubricMatrixRow) => (
    <button
      type="button"
      className="sc-rubric-why-btn"
      aria-expanded={openWhy === r.key}
      onClick={() => setOpenWhy(openWhy === r.key ? null : r.key)}
    >
      {openWhy === r.key ? "\u25be" : "\u25b8"} Why this band
    </button>
  );
  const whyBody = (r: RubricMatrixRow) => (
    <div className="sc-rubric-why">
      <p><b>What this dimension asks.</b> {r.definition}</p>
      <p><b>Where it came from.</b> {r.sourceDetail}</p>
      {r.reason
        ? <p><b>Why this band.</b> {r.reason}</p>
        : <p className="sc-rubric-noreason">No reason was recorded for this dimension on this run.</p>}
    </div>
  );
  const mark = (state: "achieved" | "next" | "plain") =>
    state === "plain" ? null : <span className="sc-rubric-mark">{state === "achieved" ? RUBRIC_ACHIEVED_MARK : RUBRIC_NEXT_MARK}</span>;
  return (
    <div className="sc-rubric" style={{ marginTop: 10 }}>
      <div className="sc-rubric-wide">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              {m.bands.map((b) => (
                <th key={b.band} scope="col">Band {b.band}<span>{b.name}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.flatMap((r) => [
              <tr key={r.key} data-state={r.state}>
                <th scope="row">
                  <span className="sc-rubric-dim">{r.label}</span>
                  <span className="sc-rubric-state">{r.stateLabel}</span>
                  <span className="sc-rubric-src">{r.source}</span>
                  {whyButton(r)}
                </th>
                {r.cells.map((c) => (
                  <td key={c.band} data-cell={c.state}>{mark(c.state)}{c.descriptor}</td>
                ))}
              </tr>,
              openWhy === r.key ? (
                <tr key={`${r.key}-why`} data-state={r.state}>
                  <td colSpan={6}>{whyBody(r)}</td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
      {/* Below 760px five columns of prose are unreadable at any font size, so
          the matrix turns on its side: one card per dimension, the five bands
          stacked inside it. Same cells, same marks, nothing dropped. */}
      <div className="sc-rubric-stack">
        {m.rows.map((r) => (
          <div key={r.key} className="sc-rubric-card" data-state={r.state}>
            <div className="sc-rubric-dim">{r.label}</div>
            <div className="sc-rubric-state">{r.stateLabel}</div>
            <div className="sc-rubric-src">{r.source}</div>
            {whyButton(r)}
            {openWhy === r.key && whyBody(r)}
            <ol>
              {r.cells.map((c) => (
                <li key={c.band} data-cell={c.state}>
                  <span className="sc-rubric-band">Band {c.band} {m.bands[c.band - 1].name}{mark(c.state)}</span>
                  {c.descriptor}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

// One requirement line in the next-band route: its ref, whether the same line
// also holds another dimension down, and the run's own action for it. The
// action text is printed exactly as the requirement row prints it.
// The ladder: one card per dimension, drawn the same whether the area is short
// of the next overall band or already at the top of the scale.
function ClimbList({ options }: { options: BandStepOption[] }) {
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {options.map((o) => (
                            <div key={o.key} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#fbfcfe" }}>
            {/* Where it stands, then the one step that is work, then
                the rungs above it, which are direction. The two are
                told apart by more than order: the step sits in a
                bordered, tinted box and the rest is folded. */}
            <b style={{ fontSize: 12.5, color: INK }}>{o.label}: now Band {o.from} of 5 on this dimension</b>
            {o.atTop ? (
              <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.45, marginTop: 3 }}>{CLIMB_AT_TOP}</div>
            ) : (
              <>
            <div style={{ border: "1px solid #c7d2fe", borderRadius: 6, background: "#fff", padding: "7px 9px", marginTop: 5 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6d28d9", textTransform: "uppercase", letterSpacing: ".02em" }}>{CLIMB_NEXT_LABEL}</div>
              <b style={{ fontSize: 12.5, color: INK }}>Band {o.from} &rarr; Band {o.to}</b>
              <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.45, marginTop: 3 }}>{o.descriptor}</div>
            {/* Named only where the run really has line-level
                evidence for the dimension. Systems & Outcomes has
                none, and says nothing rather than something.

                Each line brings its OWN "What to do" from the row
                that judged it, so the route reads as a to-do list
                and a reader never has to open the requirement to
                find out what it asks for. */}
            {o.lines.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ ...muted, fontSize: 11.5, marginBottom: 4 }}>
                  Lines this run marked short on this dimension ({o.lines.length}):
                </div>
                <StepLine line={o.lines[0]} />
                {/* One line expanded, the rest folded: four long
                    actions under four dimensions is a wall nobody
                    reads. */}
                {o.lines.length > 1 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#6d28d9" }}>
                      {o.lines.length - 1} more line{o.lines.length - 1 === 1 ? "" : "s"} on this dimension
                    </summary>
                    <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                      {o.lines.slice(1).map((l) => <StepLine key={l.ref} line={l} />)}
                    </div>
                  </details>
                )}
              </div>
            )}
            </div>
            {/* Official wording only. The run produced no evidence
                about a band the area is not standing on, so there is
                nothing to name against these. */}
            {o.beyond.length > 0 && (
              <details style={{ marginTop: 5 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#475569" }}>
                  {CLIMB_BEYOND_LABEL} ({o.beyond.length})
                </summary>
                <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                  {o.beyond.map((b) => (
                    <div key={b.to} style={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                      <b style={{ color: "#475569" }}>Band {b.to}.</b> {b.descriptor}
                    </div>
                  ))}
                  <div style={{ ...muted, fontSize: 11 }}>{CLIMB_BEYOND_NOTE}</div>
                </div>
              </details>
            )}
              </>
            )}
          </div>
      ))}
    </div>
  );
}

// One requirement line on the live board: where it has got to, never what it
// was judged. The state is a word and a mark as well as a colour.
function LiveLineRow({ line, req }: { line: LiveLine; req?: { text: string; parent?: string } }) {
  const MARK = { checked: "\u2713", checking: "\u25cf", waiting: "\u25cb" } as const;
  const LABEL = { checked: "checked", checking: "being checked", waiting: "still to do" } as const;
  return (
    <li className="sc-live-row" data-state={line.state}>
      <span className="sc-live-mark" aria-hidden>{MARK[line.state]}</span>
      <span className="sc-live-text">
        {req?.parent && <span className="sc-now-parent">{req.parent} </span>}
        {req?.text ?? line.ref}
        <span className="sc-now-ref">{line.ref}</span>
      </span>
      <span className="sc-live-state">{LABEL[line.state]}</span>
    </li>
  );
}

function StepLine({ line }: { line: DimensionStepLine }) {
  return (
    <div style={{ borderLeft: "2px solid #ddd6fe", paddingLeft: 8, marginTop: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3730a3" }}>
        {line.ref}
        {line.alsoBlocks.length > 0 && (
          <span style={{ marginLeft: 6, fontWeight: 700, color: "#92400e" }}>
            &#9733; also holds back {line.alsoBlocks.join(" and ")}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: line.action ? "#475569" : "#92400e", lineHeight: 1.45, marginTop: 2 }}>
        {line.action
          ? <><b style={{ color: "#1f2733" }}>What to do.</b> {line.action}</>
          : NO_ACTION_RECORDED}
      </div>
    </div>
  );
}

function Disclosure({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} style={{ marginTop: 6 }}>
      {/* 13.5px on BOTH the heading and the body. The body carried no size of
          its own, so the reasoning under "Why this verdict" inherited the
          browser's 16px default — measured in the page, not assumed. */}
      <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "#475569" }}>{summary}</summary>
      <div style={{ marginTop: 5, fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>
    </details>
  );
}

// One card per requirement, stacked, to the supplied design: status stripe and
// badge, the requirement in full, what was found beside what to do, and the
// supporting detail in three folded columns.
//
// Everything here comes off the SelfCheckRow the table already had. Nothing is
// re-judged, re-worded or re-counted, and the supporting detail is the existing
// WhyCell verbatim, so the disclosures, the quote de-duplication and the
// "show all N missing" control behave exactly as they did.
function FindingCard({ row, view, id }: {
  row: SelfCheckRow; view: SelfCheckView; id: string;
}) {
  const t = TONE_BG[row.tone];
  // The consistency guard's warning arrives inside the comment; it is shown as
  // its own banner rather than at the end of a folded reasoning block.
  const { why, warning } = splitMismatchWarning(row.why);
  const fixLabel = view === "procedure" ? "What to write" : "What to do";
  return (
    <article id={id} className="sc-finding" style={{ borderLeft: `5px solid ${t.fg}` }}>
      <div className="sc-finding-head">
        <div style={{ minWidth: 0 }}>
          {/* Which side of the check this card is reporting. Only on the two
              half-tabs: on Overall the card IS the whole answer, and a label
              saying so would be noise. */}
          {view === "procedure" && <div className="sc-selected-label">Written procedure</div>}
          {view === "records" && <div className="sc-selected-label">Records / implementation evidence</div>}
          <div className="sc-finding-meta">
            {/* The state travels as a glyph AND a word AND a colour, never colour alone. */}
            <span className="sc-status-badge" style={{ ...t, borderColor: t.fg }}>
              <span aria-hidden>{row.icon}</span>{row.label}
            </span>
            <span className="sc-code">{row.ref}</span>
          </div>
          <h3 className="sc-finding-title">{row.requirement}</h3>
        </div>
      </div>

      {warning && (
        <div className="sc-consistency">
          <strong>Assessment consistency warning</strong>
          <span>{warning}</span>
        </div>
      )}

      <div className="sc-finding-summary">
        <section className="sc-summary-block">
          <div className="sc-eyebrow">{SUMMARY_LABEL[row.summaryKind] || "What was found"}</div>
          {/* The summary ONLY. Where the engine wrote none, the reasoning column
              carries the full prose; both printing it would show it twice. */}
          <p>{row.summary || <span style={muted}>{why ? "No short summary was written. The full reasoning is below." : "No reason recorded."}</span>}</p>
        </section>
        <section className="sc-summary-block">
          <div className="sc-eyebrow">{fixLabel}</div>
          <p>{row.fix || <span style={muted}>{row.tone === "good" || row.tone === "neutral" ? "Nothing to do for this one." : "The check did not suggest anything specific here. Ask your audit lead what would close it."}</span>}</p>
        </section>
      </div>

      <div className="sc-detail-grid">
        {why && (
          <Disclosure summary="Why this verdict">
            <span style={{ color: "#334155" }}>{why}</span>
          </Disclosure>
        )}
        <WhyCell key={`${view}-${row.ref}`} row={row} showProse={false} />
      </div>
    </article>
  );
}

// The id a jump link and its card agree on. Prefixed by view, because the same
// refs appear on all three tabs and a bare ref would be three elements.
function findingId(view: SelfCheckView, ref: string) {
  return `sc-${view}-${ref.replace(/[^A-Za-z0-9._-]/g, "-")}`;
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
    <div className="sc-detail-items" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
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
                        {/* In its own column with a gutter, never inside the
                            row's click target. The LATEST check can be deleted
                            too now: an area with one check had no delete
                            anywhere, which is what a user hit. Deleting it
                            promotes the check behind it, and the confirmation
                            says so. */}
                        <div className="sc-run-del" style={{ ...cell, textAlign: "right", paddingRight: 6 }}>
                          {r.openable && (
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
            {target?.current ? (
              <li>
                This is your <b>latest</b> check, the one your audit lead sees.
                {archived > 0
                  ? " The check before it takes its place as the latest one."
                  : " It is the only check of this area, so the area goes back to never having been checked."}
              </li>
            ) : (
              <li>Your latest check is not affected. It is what your audit lead sees.</li>
            )}
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
          fill="none" stroke="#c9922b" strokeWidth="2.8" strokeLinecap="round"
        />
        <g className="sc-cat-body">
          {/* haunch and chest, one sitting silhouette */}
          <path d="M14 33 C13 24, 17 19, 23 19 C29 19, 33 24, 32 33 Z" fill="#e0aa3e" />
          {/* the head is its own group: it tilts and turns on its own cycle,
              which is what makes the cat look like it is watching the run
              rather than sitting still and breathing. */}
          <g className="sc-cat-head">
            <circle cx="23" cy="15" r="8" fill="#e8bb55" />
            {/* ears, each hinged at its own base so they twitch separately */}
            <path className="sc-cat-ear-l" d="M16.5 10 L16 4.5 L21 8 Z" fill="#e8bb55" />
            <path className="sc-cat-ear-r" d="M29.5 10 L30 4.5 L25 8 Z" fill="#e8bb55" />
            {/* eyes: two short strokes that squash shut on the blink */}
            <g className="sc-cat-eyes">
              <ellipse cx="20" cy="15" rx="1.3" ry="1.6" fill="#475569" />
              <ellipse cx="26" cy="15" rx="1.3" ry="1.6" fill="#475569" />
            </g>
            {/* nose */}
            <path d="M23 18 l-1.2 -1.4 h2.4 Z" fill="#a78bfa" />
            {/* whiskers, so the head turn reads as a turn */}
            <g stroke="#b07d1f" strokeWidth="0.7" strokeLinecap="round">
              <path d="M19 18.4 L13.5 17.6" /><path d="M19 19.2 L13.8 19.8" />
              <path d="M27 18.4 L32.5 17.6" /><path d="M27 19.2 L32.2 19.8" />
            </g>
          </g>
        </g>
        {/* front paws: one of them kneads on a long cycle */}
        <ellipse className="sc-cat-paw-l" cx="18" cy="33" rx="4" ry="2.2" fill="#f4d79a" />
        <ellipse cx="28" cy="33" rx="4" ry="2.2" fill="#f4d79a" />
      </g>
    </svg>
  );
}

// The numbered badge, which is also the control that opens that step's
// explanation. A hover tooltip was tried on this page and reported as doing
// nothing: it needs a steady hover, never fires on a click and does not exist
// on a touch screen. This is a button, so it works on all three.
function StepDot({ n }: { n: number }) {
  const [open, setOpen] = useState(false);
  const help = STEP_HELP[n];
  const box = useRef<HTMLSpanElement>(null);
  // A popover that only closes from its own Close button sits over whatever is
  // behind it until you find that button — it blocked the run-history control
  // in testing. Escape and a click anywhere else close it, as any popover
  // should.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={`What step ${n} means`} aria-label={`What step ${n} means`}
        style={{ ...stepDot, border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
      >
        {n}
      </button>
      {open && (
        <span className="sc-step-help" role="note">
          <b style={{ display: "block", color: INK, marginBottom: 4 }}>{help.title}</b>
          {help.body.map((line) => <span key={line} style={{ display: "block", marginBottom: 6 }}>{line}</span>)}
          <button type="button" onClick={() => setOpen(false)}
            style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "#1d4ed8", cursor: "pointer", textDecoration: "underline" }}>
            Close
          </button>
        </span>
      )}
    </span>
  );
}

// One Drive-link field: its plain-language question and per-field validation. Two of these rather than one
// shared field, because the two folders are read by different passes.
function LinkField(props: {
  step: number; label: string; value: string; state: "empty" | "bad" | "ok";
  disabled: boolean; onChange: (v: string) => void; onEdit: () => void;
}) {
  return (
    <div>
      {/* The numbered label is the cell's own heading now: the four steps read
          left to right across the row rather than as four stacked headings,
          and the number opens what used to be a paragraph underneath. */}
      <label><StepDot n={props.step} />{props.label}</label>
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

