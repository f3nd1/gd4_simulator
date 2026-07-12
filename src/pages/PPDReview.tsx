import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { DRIVE_CONNECT_PATH } from "../lib/driveGuard";
import { inputStyle } from "../components/ui/Card";
import { RunModeBanner } from "../components/ui/RunModeBanner";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { NextStepBanner } from "../components/ui/Guidance";
import { nextStepText } from "../lib/guidanceText";
import { findingTypeForStatus, findingTypeTone } from "../lib/findingClassification";
import { ppdResultSummary } from "../lib/ppdSelection";
import { auditModeLabel } from "../lib/runModes";
import { exportOptionASummaryCsv, exportFileLedgerCsvFor, downloadCsv, auditCsvFilename } from "../lib/auditCsvExport";
import { LineageDiagram } from "../components/ui/LineageDiagram";
import { RunStepper, ppdRunStep, evidenceRunStep } from "../components/ui/RunStepper";
import { FileLedger } from "./EvidenceFolder";
import { RunDetailColumns } from "../components/ui/RunDetailColumns";
import { normalizeAuditRef } from "../lib/gd4Refs";
import { PreAnalysisChecklistPanel } from "../components/ui/PreAnalysisChecklistPanel";
import { ThumbsButtons } from "../components/ui/ThumbsButtons";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { hasChecklist, computeFlaggedPreCheckItems, type DetectFile } from "../lib/preAnalysisChecklist";
import { usePreCheckChecklistStore } from "../store/usePreCheckChecklistStore";
import { ppdVerdictTone, ppdVerdictBorderColor, evVerdictTone, evVerdictBorderColor, ppdVerdictLabel, evVerdictLabel } from "../lib/verdictTone";
import { excerptAround } from "../components/ui/quoteMatch";
import type { PPDOverallVerdict, EvidenceVerdict, PromiseCheck, EvidenceAssessmentProgress, EvidenceDriftCheck, PPDReviewProgress, AuditFileRecord, PPDReviewRow } from "../types";

// Option A's complete flow, as two tabs on one page:
//   • PPD Review — policy only, one row per GD4 requirement line (3 columns).
//   • Evidence   — reuses the PPD verdict + reads the Actual Evidence folder
//                  for a combined Met/Partial/Not met verdict (4 columns).
// Findings are compiled from the Evidence tab. The single-column Sub-Criterion
// Checklist (Option B) is untouched.

function overallVerdictTone(v: PPDOverallVerdict): "good" | "medium" | "critical" {
  return v === "PPD Adequate" ? "good" : v === "PPD Partial" ? "medium" : "critical";
}

function overallPanelColors(v: PPDOverallVerdict): { bg: string; border: string } {
  if (v === "PPD Adequate") return { bg: "#f0fdf4", border: "#bbf7d0" };
  if (v === "PPD Partial") return { bg: "#fffbeb", border: "#fde68a" };
  return { bg: "#fef2f2", border: "#fecaca" };
}

const PPD_GRID = "1fr 1fr 1fr";
const EV_GRID = "1.1fr 1.1fr 1.1fr 0.9fr";

// The "PPD procedure (AI-matched)" column's exact matched span: the same
// quote+excerptAround(...) lookup the lineage map's expanded spine detail
// already does (LineageDiagram.tsx's resolveSourceFile + excerptAround), so
// this preview highlights via the SAME located passage rather than a new
// mechanism. Prefers the first documented sub-clause's own quote (matches
// what the spine would show first); falls back to the row-level supportQuote
// on older/undecomposed rows. Returns null when no quote resolves against the
// cited file's cached text — callers fall back to the plain comment preview,
// never a fabricated highlight.
function policyMatchedExcerpt(
  row: PPDReviewRow,
  chunkFileNames: Record<string, string> | undefined,
  fileLedger: AuditFileRecord[] | undefined,
  resolveText: (f: AuditFileRecord) => string | null | undefined
) {
  const sub = row.subClauses?.find((c) => c.verdict === "documented" && c.quote);
  const quote = sub?.quote || row.supportQuote;
  if (!quote) return null;
  const chunkId = sub?.chunkId || row.chunkIds[0];
  const fileName = chunkId ? chunkFileNames?.[chunkId] : undefined;
  const record = fileName ? fileLedger?.find((f) => f.name === fileName) : undefined;
  const text = record ? resolveText(record) : undefined;
  return typeof text === "string" ? excerptAround(text, quote) : null;
}

// NOTE: the standalone PPD Requirements Review page (and its /ppd-review route)
// was retired — the review now runs entirely in the Evidence Folder's review
// modal, which imports the shared pieces below (PpdReviewContent, HybridGatePanel,
// ResultNavLinks, OptionAExportButtons). Only the page wrapper was removed; these
// exported building blocks stay.

// Two jump-links shown on every "View result" surface (Option A modal / page
// AND the Option B AuditRunModal) so an auditor can go straight from a run
// result to either the Sub-Criterion Checklist or the Findings register,
// filtered to the sub-criterion just reviewed. Reuses existing routes only.
export function ResultNavLinks({ subCriterionId }: { subCriterionId: string }) {
  const firstItemId = GD4_REQUIREMENTS.find((r) => r.subCriterionId === subCriterionId)?.id ?? "";
  const linkStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#4338ca", textDecoration: "none", padding: "5px 11px", border: "1px solid #c7d2fe", borderRadius: 7, background: "#eef2ff", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Link to={firstItemId ? `/sub-checklist?item=${firstItemId}` : "/sub-checklist"} style={linkStyle}>Sub-Criterion Checklist →</Link>
      <Link to={subCriterionId ? `/findings?subCrit=${subCriterionId}` : "/findings"} style={linkStyle}>Findings register →</Link>
    </div>
  );
}

// CSV export for troubleshooting an Option A run — the same two exports the
// staged path offers: a per-line summary (PPD + evidence verdicts, reasoning,
// citations) and a per-file ledger (matching the staged ledger columns). Shown
// only once there is a saved PPD result or evidence assessment to export.
export function OptionAExportButtons({ subCriterionId }: { subCriterionId: string }) {
  const ppd = useWorkspaceStore((s) => s.ppdReviewResults[subCriterionId]);
  const evidence = useWorkspaceStore((s) => s.evidenceAssessments[subCriterionId]);
  if (!ppd && !evidence) return null;
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === subCriterionId);
  const title = sub?.title ?? subCriterionId;
  const runId = evidence?.runId;
  const runAt = evidence?.runAt ?? ppd?.runAt ?? new Date().toISOString();
  const hasLedger = !!evidence?.fileLedger?.length;
  const btn: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#0f766e", padding: "5px 11px", border: "1px solid #99f6e4", borderRadius: 7, background: "#f0fdfa", whiteSpace: "nowrap", cursor: "pointer" };
  const exportSummary = () => {
    if (!ppd) return;
    downloadCsv(
      exportOptionASummaryCsv({ runId, subCriterionId }, ppd.rows, evidence?.rows ?? []),
      auditCsvFilename("gd4-audit-optionA-summary", { subCriterionId, scope: "A", startedAt: runAt })
    );
  };
  const exportLedger = () => {
    if (!evidence?.fileLedger?.length) return;
    downloadCsv(
      exportFileLedgerCsvFor(evidence.fileLedger, { runId: runId ?? "", startedAt: runAt, scope: "A", subCriterionId, subCriterionTitle: title }),
      auditCsvFilename("gd4-audit-optionA-ledger", { subCriterionId, scope: "A", startedAt: runAt })
    );
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" onClick={exportSummary} disabled={!ppd} style={{ ...btn, opacity: ppd ? 1 : 0.5, cursor: ppd ? "pointer" : "not-allowed" }} title="Per-line CSV: PPD verdict + reasoning and evidence verdict + reasoning, with citations, for each requirement line">⬇ Line summary CSV</button>
      <button type="button" onClick={exportLedger} disabled={!hasLedger} style={{ ...btn, opacity: hasLedger ? 1 : 0.5, cursor: hasLedger ? "pointer" : "not-allowed" }} title={hasLedger ? "Per-file CSV: read status, read method, char count, cited — same columns as the staged file ledger" : "Run the Evidence assessment to capture a file ledger"}>⬇ File ledger CSV</button>
    </div>
  );
}

// The full PPD + Evidence review body for ONE sub-criterion: saved-state
// banner, next-step guidance, tab bar, and the PPD / Evidence tabs (each with
// its own run button, live progress panel and results). Extracted from the
// page so the Evidence Folder's near-fullscreen Option A modal can host the
// EXACT same content — one component, two surfaces, zero drift.
export function PpdReviewContent({ selectedId }: { selectedId: string }) {
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === selectedId);
  const [tab, setTab] = useState<"ppd" | "precheck" | "evidence">("ppd");
  // Set only by "Continue to Evidence" (below) — gives EvidenceTab a one-shot
  // signal to show a clear "you just arrived here" confirmation banner, so
  // the Pre-check → Evidence transition is never silent/ambiguous. Cleared on
  // any manual tab click (including re-clicking "Evidence" itself).
  const [justContinued, setJustContinued] = useState(false);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const folders = useWorkspaceStore((s) => s.folders);
  const folder = folders.find((f) => f.subCriterionId === selectedId);
  // Count of verdicts queued for this sub-criterion's hybrid approval gate —
  // badged on the Evidence tab so the gate (which lives beside the evidence
  // rows there) is discoverable even when the review opens on the PPD tab.
  const pendingGateCount = useWorkspaceStore((s) => s.pendingCommits[selectedId]?.items.length ?? 0);

  const requirementItems = useMemo(
    () => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === selectedId),
    [selectedId]
  );
  const totalLines = useMemo(
    () => requirementItems.reduce((n, r) => n + (r.flatAuditPoints?.filter((p) => p.sourceType === "describeShow").length ?? 0), 0),
    [requirementItems]
  );

  const savedResult = ppdReviewResults[selectedId];
  const savedSummary = ppdResultSummary(savedResult?.rows);
  // Evidence counts for the saved-state line — the SAME rows the Evidence
  // tab's coverage table renders, so the header can never contradict it.
  // The PPD counts alone read as wrong on the Evidence tab (e.g. a PPD pass
  // whose extraction collapsed shows "7 not assessed" above a fully-verdicted
  // evidence table), so each pass's counts are now labelled with its name.
  const savedEvidence = useWorkspaceStore((s) => s.evidenceAssessments[selectedId]);
  const evRows = savedEvidence?.rows ?? [];
  const evCount = (v: EvidenceVerdict) => evRows.filter((r) => r.verdict === v).length;

  if (!sub) return null;
  return (
    <>
      {/* Consolidated status bar — one bordered container for what used to be
          three stacked banners (LIVE AI/OFFLINE mode, saved-state summary,
          next-step guidance). Same information, same per-line semantic color,
          just one visual container instead of three nested boxes. Each piece
          keeps its own show/hide logic (RunModeBanner's ephemeral dismiss,
          NextStepBanner's persisted per-tip dismiss, the saved-state line's
          `savedResult` guard) — an absent piece simply contributes no row, no
          empty divider. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
        {/* Pre-run mode banner — Option A runs (PPD review / evidence assessment)
            are triggered from this content, so the offline/live state is shown
            before the run begins here too (page + Evidence Folder modal). */}
        <RunModeBanner compact bare />

        {/* Saved-state line: proves the results are saved and current, and
            points at where the same verdicts also live (checklist + scoring). */}
        {savedResult && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 11.5, color: "#334155" }}>
            <span>
              <b>Last reviewed {new Date(savedResult.runAt).toLocaleString("en-SG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b>
              {" · Policy (PPD): "}{savedSummary.adequate} adequate / {savedSummary.partial} partial / {savedSummary.gaps} gaps{savedSummary.notAssessed ? ` / ${savedSummary.notAssessed} not assessed` : ""}
              {evRows.length > 0 && (
                <>{" · Evidence: "}{evCount("Met")} {evVerdictLabel("Met").toLowerCase()} / {evCount("Partial")} {evVerdictLabel("Partial").toLowerCase()} / {evCount("Not met")} {evVerdictLabel("Not met").toLowerCase()}{evCount("Not assessed") ? ` / ${evCount("Not assessed")} ${evVerdictLabel("Not assessed").toLowerCase()}` : ""}</>
              )}
            </span>
            <span style={{ marginLeft: "auto", color: "#64748b" }}>
              Also reflected in the{" "}
              <Link to={`/sub-checklist?item=${requirementItems[0]?.id ?? ""}`} style={{ color: "#4338ca", fontWeight: 600 }}>Sub-Criterion Checklist</Link>{" "}&amp;{" "}
              <Link to="/scorecard" style={{ color: "#4338ca", fontWeight: 600 }}>Scorecard</Link>.
            </span>
          </div>
        )}

        <PpdNextStep selectedId={selectedId} bare />
      </div>

      {/* Jump straight to the Checklist or Findings for this sub-criterion,
          plus CSV export for troubleshooting the PPD + evidence run. */}
      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <ResultNavLinks subCriterionId={selectedId} />
        <OptionAExportButtons subCriterionId={selectedId} />
      </div>

      <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: -2, marginBottom: 10 }}>
        {sub.title} — {sub.description}
        {" "}· {totalLines} requirement line{totalLines === 1 ? "" : "s"} across {requirementItems.length} item{requirementItems.length === 1 ? "" : "s"}
        {!folder?.policyLink && !folder?.folderLink && <span style={{ color: "#b23121" }}> · No folder linked yet (Evidence Folder page).</span>}
      </p>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        {([["ppd", "PPD Review"], ["precheck", "Pre-check"], ["evidence", "Evidence"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setJustContinued(false); }}
            style={{
              cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "7px 16px", border: "none",
              borderBottom: `2px solid ${tab === id ? "#4338ca" : "transparent"}`,
              background: "transparent", color: tab === id ? "#4338ca" : "#64748b", marginBottom: -1,
            }}
          >
            {label}
            {id === "evidence" && pendingGateCount > 0 && (
              <span
                title={`${pendingGateCount} AI verdict(s) awaiting your approval — review each beside its evidence here`}
                style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: "#92400e", background: "#fde68a", borderRadius: 999, padding: "1px 7px" }}
              >
                ⏸ {pendingGateCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "ppd" ? <PpdTab selectedId={selectedId} totalLines={totalLines} />
        : tab === "precheck" ? <PreCheckTab selectedId={selectedId} onContinue={() => { setJustContinued(true); setTab("evidence"); }} />
        : (
          <EvidenceTab
            selectedId={selectedId}
            justArrived={justContinued}
            onDismissJustArrived={() => setJustContinued(false)}
            onGoToPrecheck={() => { setTab("precheck"); setJustContinued(false); }}
            onGoToPpd={() => { setTab("ppd"); setJustContinued(false); }}
          />
        )}
    </>
  );
}

// "Pre-check" tab — the per-sub-criterion pre-analysis checklist, sitting
// between PPD Review and Evidence. Reuses whichever runs have already
// happened: the PPD review's fileLedger (policy files) plus, once it exists,
// the evidence assessment's fileLedger (evidence files) — no separate probe.
// Sub-criteria with no defined checklist show an honest "no checks" state
// instead of PreAnalysisChecklistPanel's silent null, so a clicked tab never
// appears blank. Non-blocking: "Continue to Evidence" just switches tabs —
// it never triggers an AI run (that still needs its own explicit "Run
// evidence assessment" click, preserving per-stage AI-cost consent). The
// transition itself is made unambiguous on arrival — see EvidenceTab's
// `justArrived` banner.
function PreCheckTab({ selectedId, onContinue }: { selectedId: string; onContinue: () => void }) {
  const ppd = useWorkspaceStore((s) => s.ppdReviewResults[selectedId]);
  const assessment = useWorkspaceStore((s) => s.evidenceAssessments[selectedId]);
  const checklists = usePreCheckChecklistStore((s) => s.checklists);
  const itemIds = useMemo(() => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === selectedId).map((r) => r.id), [selectedId]);

  if (!hasChecklist(checklists, itemIds)) {
    return (
      <div>
        <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 0 }}>No pre-analysis checks are defined yet for this sub-criterion — continue whenever you're ready.</p>
        <button
          type="button"
          onClick={onContinue}
          style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a" }}
        >
          Continue to Evidence →
        </button>
      </div>
    );
  }

  const subTitle = GD4_SUB_CRITERIA.find((s) => s.id === selectedId)?.title ?? "";
  const files = [...(ppd?.fileLedger ?? []), ...(assessment?.fileLedger ?? [])];
  return (
    <PreAnalysisChecklistPanel
      folderId={selectedId}
      subCriterionId={selectedId}
      subCriterionTitle={subTitle}
      itemIds={itemIds}
      files={files}
      onContinue={onContinue}
      continueLabel="Continue to Evidence"
    />
  );
}

// State-aware next-step banner for this sub-criterion.
function PpdNextStep({ selectedId, bare }: { selectedId: string; bare?: boolean }) {
  const auditMode = useWorkspaceStore((s) => s.auditMode);
  const ppd = useWorkspaceStore((s) => s.ppdReviewResults[selectedId]);
  const ev = useWorkspaceStore((s) => s.evidenceAssessments[selectedId]);
  // While hybrid gates are still queued the sub-criterion is NOT compiled —
  // without this check, one accepted verdict (some savedFindingId) flipped
  // the banner to "assessed and compiled" while the remaining gates were
  // still awaiting review.
  const gatesPending = useWorkspaceStore((s) => (s.pendingCommits[selectedId]?.items.length ?? 0) > 0);
  return (
    <NextStepBanner
      text={nextStepText("ppd-review", {
        mode: auditMode,
        ppdRun: !!ppd && ppd.rows.length > 0,
        evidenceRun: !!ev && ev.rows.length > 0,
        findingsCompiled: !gatesPending && !!ev && ev.rows.some((r) => r.savedFindingId),
      })}
      bare={bare}
    />
  );
}

// ─── PPD Review tab (policy only, 3 columns) ────────────────────────────────
function PpdTab({ selectedId, totalLines }: { selectedId: string; totalLines: number }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
  // Same fileTextCache -> extracted-text lookup LineageDiagram uses, so the
  // "PPD procedure (AI-matched)" column can locate + highlight its matched
  // quote in the same cached text the spine detail highlights.
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback(
    (f: AuditFileRecord) => (f.driveFileId ? fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text : undefined),
    [fileTextCache]
  );
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  // Transient "you stopped this" flag, shown until the next run starts. Cancel
  // reuses cancelBusy() — the same abort path the full-audit sweep uses — which
  // aborts the in-flight AI call and stops the run; runPPDReview writes no
  // checklist verdicts and no pendingCommits, so a cancel strands nothing.
  const [cancelled, setCancelled] = useState(false);
  // Per-line feedback → CalibrationMemory (reuses the app's ThumbsButtons +
  // FeedbackModal pattern). A thumbs-down on a PPD line teaches future Option A
  // runs, because runPPDReview now injects active "Line Status" memories.
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const [lineFeedback, setLineFeedback] = useState<{ ref: string; text: string } | null>(null);

  const result = ppdReviewResults[selectedId];
  const isRunning = busy === "ppdreview" + selectedId;
  const liveProgress = useWorkspaceStore((s) => s.ppdReviewProgress);

  // Drive-connection block for THIS sub-criterion — runPPDReview sets this when
  // the folder can't be reached, so the button appears to "do nothing".
  // Surface it here with a Connect action (Option A parity with Evidence Folder).
  const driveBlockedReason = useWorkspaceStore((s) => s.driveBlockedReason);
  const setDriveBlockedReason = useWorkspaceStore((s) => s.setDriveBlockedReason);
  const driveToken = useGoogleDriveStore((s) => s.accessToken);
  const driveConnecting = useGoogleDriveStore((s) => s.connecting);
  const driveClientId = useGoogleDriveStore((s) => s.clientId);
  const navigate = useNavigate();
  const driveBlock = driveBlockedReason && driveBlockedReason.subCriterionId === selectedId ? driveBlockedReason : null;
  const connectDrive = () => {
    if (!driveClientId) { navigate(DRIVE_CONNECT_PATH); return; }
    useGoogleDriveStore.getState().connect().catch(() => {/* lastError shown in Settings */});
  };
  // Clear the block once a token arrives so the banner disappears without reload.
  useEffect(() => {
    if (driveToken && driveBlock?.reason === "not-connected") setDriveBlockedReason(null);
  }, [driveToken, driveBlock, setDriveBlockedReason]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  // Lineage-diagram node click: expand the matching row and scroll it into
  // view. Must also open the full requirement table itself — the row's DOM
  // node (id="ppdline-...") only exists when tableOpen is true, so a click
  // while the table is collapsed previously found no element and silently
  // did nothing.
  const openLine = (ref: string) => {
    setExpandedRows((prev) => new Set(prev).add(ref));
    setTableOpen(true);
    const id = `ppdline-${normalizeAuditRef(ref)}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  // The lineage map (below) already covers "which file/section backs this
  // line" via its per-sub-part highlighted-source expansion — this prose
  // summary and the full per-line table are secondary detail, so both default
  // collapsed. Nothing inside is removed; a click reopens the exact same
  // content that rendered here before.
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);

  // Old-format results (pre per-line refactor) keyed rows per whole item and
  // lack `ref`; force a re-run rather than render the collapsed single row.
  const isStale = !!result && result.rows.some((r) => !r.ref);
  const liveResult = result && !isStale ? result : undefined;

  return (
    <>
      <span style={{ display: "inline-flex", gap: 8, marginBottom: 12 }}>
        <button
          disabled={isRunning}
          onClick={() => { setCancelled(false); runPPDReview(selectedId); }}
          style={{ cursor: isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a" }}
        >
          {isRunning ? "Reviewing…" : result ? "Re-run PPD review" : "Run PPD review"}
        </button>
        {isRunning && (
          <button
            onClick={() => { setCancelled(true); cancelBusy(); }}
            title="Stops the review: the in-flight AI call is aborted. No verdicts are committed."
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff5f5", color: "#b23121" }}
          >
            Cancel
          </button>
        )}
      </span>

      {/* Show a Connect affordance whenever Drive isn't connected (so the
          button is always reachable), or when a run was explicitly blocked. */}
      {(driveBlock || !driveToken) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "9px 12px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 12.5, color: "#92600a", fontWeight: 600 }}>
          <span aria-hidden>🔌</span>
          <span style={{ flex: 1, minWidth: 220 }}>
            {driveBlock ? driveBlock.message : "Not connected to Google Drive — connect to read this sub-criterion's Policy folder and run the review."}
          </span>
          <button
            type="button"
            onClick={connectDrive}
            disabled={driveConnecting}
            style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: driveConnecting ? "#94a3b8" : "#2563eb", border: "none", borderRadius: 6, padding: "5px 12px", cursor: driveConnecting ? "default" : "pointer", whiteSpace: "nowrap" }}
          >
            {driveConnecting ? "Connecting…" : "Connect to Google Drive"}
          </button>
        </div>
      )}
      {isRunning && (() => {
        const detail = liveProgress?.subCriterionId === selectedId ? liveProgress.detail : "Working…";
        const runProgress = liveProgress?.subCriterionId === selectedId ? liveProgress : null;
        return (
          <>
            <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3730a3" }}>PPD review running</span>
                <span style={{ fontSize: 11, color: "#6366f1" }}>live</span>
              </div>
              {/* Same step-by-step view as the staged audit modal. */}
              <RunStepper current={ppdRunStep(detail, true, false)} running detail={detail} />
            </div>
            {/* Detailed live-activity panel (collapsible to a compact summary) —
                same RunDetailColumns component the Evidence tab's EvidenceRunPanel
                uses, so both tabs' 3-column live views are visually identical. */}
            <PpdRunPanel progress={runProgress} onCancel={cancelBusy} />
          </>
        );
      })()}

      {cancelled && !isRunning && (
        <div style={{ fontSize: 12.5, color: "#b23121", background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
          <b>Review cancelled.</b> The in-flight AI call was aborted, so this run stopped rather than finished. No verdicts were committed. Click "Re-run PPD review" to start again.
        </div>
      )}

      {!result && !isRunning && !cancelled && (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No review run yet for this sub-criterion. Click "Run PPD review" above.</p>
      )}

      {isStale && !isRunning && (
        <div style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
          This review was run before the per-requirement-line update, so it only shows one row for the whole item.
          Click <b>"Re-run PPD review"</b> above to reassess all {totalLines} requirement line{totalLines === 1 ? "" : "s"} as separate rows.
        </div>
      )}

      {liveResult && (
        <>
          {/* When a re-run is in flight the panel below is the PREVIOUS run's
              result — say so, so the "Overall PPD assessment" isn't mistaken for
              a summary of a run that hasn't finished. */}
          {isRunning && (
            <div style={{ fontSize: 12, color: "#3730a3", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "6px 11px", marginBottom: 8 }}>
              Showing your <b>previous</b> PPD review while the new run finishes — it will refresh when the run completes.
            </div>
          )}
          {/* Files read this run — same clickable/inspectable ledger the staged
              audit shows; each file expands to its extracted text. */}
          {liveResult.fileLedger && liveResult.fileLedger.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>📂 Policy files read this run</div>
              <FileLedger files={liveResult.fileLedger} />
            </div>
          )}
          {liveResult.runWarnings && liveResult.runWarnings.length > 0 && (
            <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
              <b>⚠ This run had problems — results may be incomplete:</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {liveResult.runWarnings.slice(0, 5).map((w, i) => (
                  <li key={i} style={{ marginBottom: 1 }}>{w}</li>
                ))}
                {liveResult.runWarnings.length > 5 && <li>…and {liveResult.runWarnings.length - 5} more.</li>}
              </ul>
            </div>
          )}
          {liveResult.overallVerdict && (() => {
            const colors = overallPanelColors(liveResult.overallVerdict);
            // "Not assessed" lines are not gaps — the run simply never
            // reviewed them; they are excluded from the gap bullets.
            const weakRows = liveResult.rows.filter((r) => r.verdict === "Partial" || r.verdict === "Not documented");
            return (
              <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: "11px 14px", marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => setAssessmentOpen((o) => !o)}
                  style={{ cursor: "pointer", width: "100%", textAlign: "left", border: "none", background: "transparent", padding: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Overall PPD assessment</span>
                  <Pill s={overallVerdictTone(liveResult.overallVerdict)}>{liveResult.overallVerdict}</Pill>
                  {/* Compact summary reuses the already-computed overallSummary
                      string (adequate/partial/not-documented counts) — no
                      recomputation, same data the expanded view shows. */}
                  {liveResult.overallSummary && <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{liveResult.overallSummary}{!assessmentOpen ? " — click to expand full assessment" : ""}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#64748b" }}>{assessmentOpen ? "Hide ▲" : "Show ▼"}</span>
                </button>
                {assessmentOpen && (
                  <>
                    {liveResult.overallNarrative && (
                      <p style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.5, margin: "8px 0 6px", whiteSpace: "pre-line" }}>{liveResult.overallNarrative}</p>
                    )}
                    {weakRows.length > 0 && (
                      <div style={{ fontSize: 12, color: "#374151", marginTop: liveResult.overallNarrative ? 0 : 8 }}>
                        <span style={{ fontWeight: 700 }}>Gaps:</span>
                        <ul style={{ margin: "3px 0 0", paddingLeft: 18 }}>
                          {weakRows.map((r) => (
                            <li key={r.ref} style={{ marginBottom: 1 }}>
                              <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "#4338ca" }}>{r.ref}</span>
                              {" — "}
                              <span>{r.requirementText.length > 80 ? `${r.requirementText.slice(0, 80)}…` : r.requirementText}</span>
                              {" "}<Pill s={ppdVerdictTone(r.verdict)}>{r.verdict}</Pill>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
          {liveResult.contradictions && liveResult.contradictions.length > 0 && (
            <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: "11px 14px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  ⚠ Internal PPD contradictions ({liveResult.contradictions.length})
                </span>
                <span style={{ fontSize: 11.5, color: "#7c2d12" }}>Two inconsistent statements for the same thing — these compile as findings.</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {liveResult.contradictions.map((c, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #fed7aa", borderLeft: "4px solid #ea580c", borderRadius: 8, padding: "8px 11px" }}>
                    <div style={{ fontSize: 12.5, color: "#7c2d12", fontWeight: 600, marginBottom: 4 }}>
                      {c.description}
                      {c.savedFindingId && <Pill s="medium">Saved {c.savedFindingId}</Pill>}
                    </div>
                    <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.45 }}>
                      <div><b style={{ color: "#9a3412" }}>A:</b> <span style={{ fontStyle: "italic" }}>{c.quoteA}</span>{c.chunkA && <span style={{ fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}> ({c.chunkA})</span>}</div>
                      <div><b style={{ color: "#9a3412" }}>B:</b> <span style={{ fontStyle: "italic" }}>{c.quoteB}</span>{c.chunkB && <span style={{ fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}> ({c.chunkB})</span>}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
            Last run {new Date(liveResult.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{liveResult.live ? "Live AI" : "Offline"}
            {" · "}{liveResult.rows.filter((r) => r.verdict === "Adequate").length} {ppdVerdictLabel("Adequate")}, {liveResult.rows.filter((r) => r.verdict === "Partial").length} {ppdVerdictLabel("Partial")}, {liveResult.rows.filter((r) => r.verdict === "Not documented").length} {ppdVerdictLabel("Not documented")}
          </div>

          {/* Requirement → PPD lineage map (reuses this run's row data) — the
              primary, always-visible view: per-sub-part expand-to-highlighted-
              source already answers "which file/section backs this line". */}
          <LineageDiagram mode="ppd" ppd={liveResult} onOpenLine={openLine} runLabel={`${selectedId} ${GD4_SUB_CRITERIA.find((s) => s.id === selectedId)?.title ?? ""}`.trim()} />

          {/* Full per-line table below is secondary detail (same rows the map
              already summarises), so it defaults collapsed. Every row, every
              action (thumbs, "show full comment + rewrite") is unchanged and
              intact underneath — this only changes default visibility. */}
          <button
            type="button"
            onClick={() => setTableOpen((o) => !o)}
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155", marginBottom: 10 }}
          >
            {tableOpen ? "Hide full requirement table ▲" : "Show full requirement table ▾"}
          </button>

          {tableOpen && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: PPD_GRID, gap: 10, position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px 8px 0 0", padding: "6px 12px", marginBottom: -1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>GD4 requirement</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>PPD procedure (AI-matched)</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>AI verdict</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {liveResult.rows.map((row) => {
              const expanded = expandedRows.has(row.ref);
              const sourceRef = row.chunkIds.length > 0
                ? row.chunkIds.map((cid) => liveResult.chunkFileNames?.[cid] ? `${liveResult.chunkFileNames[cid]} · ${cid}` : cid).join(", ")
                : "No chunk cited";
              const extractPreview = row.fullComment || row.shortComment || "(no comment returned)";
              // The exact quote this row matched, located in the cited file's
              // cached text — same mechanism the spine's <mark> uses. null
              // when no quote resolves (older run, or text not cached yet),
              // in which case the plain comment preview below is shown as-is.
              const matched = policyMatchedExcerpt(row, liveResult.chunkFileNames, liveResult.fileLedger, resolveText);
              return (
                <div key={row.ref} id={`ppdline-${normalizeAuditRef(row.ref)}`} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${ppdVerdictBorderColor(row.verdict)}`, borderRadius: 8, padding: "10px 12px", scrollMarginTop: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: PPD_GRID, gap: 10, alignItems: "start" }}>
                    <div>
                      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 4 }}>{row.ref}</div>
                      <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4 }}>{row.requirementText}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 4, fontFamily: "ui-monospace,monospace" }}>{sourceRef}</div>
                      <div style={{ borderLeft: "3px solid #c7d2fe", paddingLeft: 8, fontSize: 12, color: "#374151", lineHeight: 1.4, fontStyle: "italic" }}>
                        {matched ? (
                          <>
                            {matched.clippedStart && "… "}{matched.before}
                            <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px", fontStyle: "normal" }}>{matched.match}</mark>
                            {matched.after}{matched.clippedEnd && " …"}
                          </>
                        ) : extractPreview}
                      </div>
                    </div>
                    <div>
                      <Pill s={ppdVerdictTone(row.verdict)}>{ppdVerdictLabel(row.verdict)}</Pill>
                      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, margin: "5px 0" }}>{row.shortComment}</div>
                      <button
                        onClick={() => toggleExpanded(row.ref)}
                        style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
                      >
                        {expanded ? "Hide full comment + rewrite ▲" : "Show full comment + rewrite ▼"}
                      </button>
                      {/* Was this PPD verdict right? 👎 opens the correction modal,
                          which stores a CalibrationMemory that future runs learn from. */}
                      <div style={{ marginTop: 6 }}>
                        <ThumbsButtons
                          onAccept={() => logHumanDecision({ module: "Line Status", subjectId: selectedId, field: row.ref, aiOutput: `PPD ${row.ref}: ${row.verdict}`, humanDecision: `Accepted PPD verdict: ${row.verdict}`, changed: false, decisionType: "Accepted", reason: "" })}
                          onReject={() => setLineFeedback({ ref: row.ref, text: `PPD verdict "${row.verdict}" for ${row.ref}: ${row.fullComment || row.shortComment || "(no comment)"}` })}
                        />
                      </div>
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 10, paddingTop: 10 }}>
                      {row.subClauses && row.subClauses.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Sub-clause check</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {row.subClauses.map((c, i) => (
                              <div key={i} style={{ fontSize: 12, color: c.verdict === "documented" ? "#166534" : "#b91c1c", lineHeight: 1.4 }}>
                                {c.verdict === "documented" ? "✓" : "✗"} {c.text}
                                <span style={{ color: "#94a3b8" }}> — {c.verdict}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {row.promises && row.promises.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>PPD promises (verified in the Evidence tab)</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            {row.promises.map((p, i) => (
                              <div key={i} style={{ fontSize: 12, color: "#374151", lineHeight: 1.4 }}>
                                • {p.promiseText}
                                {p.sourceQuote && <span style={{ fontStyle: "italic", color: "#64748b" }}> — "{p.sourceQuote}"</span>}
                                {p.chunkId && <span style={{ fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}> ({p.chunkId})</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Full comment</div>
                      <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.45, marginBottom: row.suggestedRewrite ? 10 : 0, whiteSpace: "pre-line" }}>
                        {row.fullComment || row.shortComment}
                      </div>
                      {row.suggestedRewrite && (
                        <div style={{ background: "#f0f6ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "7px 10px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Suggested rewrite</div>
                          <div style={{ fontSize: 12, color: "#1e293b", whiteSpace: "pre-line" }}>{row.suggestedRewrite}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
              </div>
            </>
          )}
        </>
      )}
      <FeedbackModal
        open={!!lineFeedback}
        aiOutput={lineFeedback?.text ?? ""}
        module="Line Status"
        onClose={() => setLineFeedback(null)}
        onSubmit={(fb) => {
          logHumanDecision({ module: "Line Status", subjectId: selectedId, field: lineFeedback?.ref, aiOutput: lineFeedback?.text ?? "", humanDecision: (fb.correction || lineFeedback?.text) ?? "", changed: !!fb.correction, decisionType: "Overridden", reason: fb.reason });
          if (!fb.correct && fb.correction) {
            addCalibrationMemory({ module: "Line Status", subjectId: selectedId, context: lineFeedback?.text ?? "", aiOutput: lineFeedback?.text ?? "", staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: Math.round((lineFeedback?.text?.length ?? 0) / 4) });
          }
          setLineFeedback(null);
        }}
      />
    </>
  );
}

// ─── Detailed live-activity panel for a running evidence assessment ─────────
// Collapsible: a compact summary line always shows; "Show detail" reveals the
// full live view (stage, window, per-line status, files, log, AI usage). All
// data comes from evidenceAssessmentProgress — no assessment logic here.
const STAGE_LABEL: Record<NonNullable<EvidenceAssessmentProgress["stage"]>, string> = {
  reading: "Reading files", assessing: "Assessing evidence", verifying: "Verifying citations", synthesising: "Synthesising", done: "Done",
};

function EvidenceRunPanel({ progress: p, onCancel, onSkipFile }: { progress: EvidenceAssessmentProgress | null; onCancel: () => void; onSkipFile: () => void }) {
  return (
    <RunDetailColumns
      pct={p?.pct ?? 5}
      stageLabel={p?.stage ? STAGE_LABEL[p.stage] : "Starting…"}
      windowLabel={p?.window && p.window.total > 1 ? `window ${p.window.current} of ${p.window.total}` : undefined}
      detail={p?.detail ?? "Working…"}
      startedAt={p?.startedAt}
      heartbeatAt={p?.heartbeatAt}
      lineRefs={p?.lineRefs ?? []}
      lineStatus={p?.lineStatus}
      lineVerdict={p?.lineVerdict}
      filesFound={p?.filesFound ?? []}
      filesReadCount={(p?.filesRead ?? []).length}
      filesTotal={p?.filesTotal}
      isReadingStage={p?.stage === "reading"}
      currentFile={p?.currentFile}
      currentWindowFiles={p?.currentWindowFiles}
      canSkipCurrentFile={p?.canSkipCurrentFile}
      onSkipFile={onSkipFile}
      ai={p?.ai}
      log={p?.log ?? []}
      onCancel={onCancel}
      lastIssue={p?.lastIssue}
    />
  );
}

// PPD tab's live-run detail panel — same RunDetailColumns body as Evidence's,
// fed from PPDReviewProgress instead of EvidenceAssessmentProgress. PPD has
// no manual per-file Skip wiring (only Evidence does — see runPPDReview in
// useWorkspaceStore.ts), so onSkipFile is simply omitted.
const PPD_STAGE_LABEL: Record<NonNullable<PPDReviewProgress["stage"]>, string> = {
  reading: "Reading files", assessing: "Assessing PPD documentation", done: "Done",
};
function PpdRunPanel({ progress: p, onCancel }: { progress: PPDReviewProgress | null; onCancel: () => void }) {
  return (
    <RunDetailColumns
      pct={p?.pct ?? 5}
      stageLabel={p?.stage ? PPD_STAGE_LABEL[p.stage] : "Starting…"}
      windowLabel={p?.window && p.window.total > 1 ? `window ${p.window.current} of ${p.window.total}` : undefined}
      detail={p?.detail ?? "Working…"}
      startedAt={p?.startedAt}
      heartbeatAt={p?.heartbeatAt}
      lineRefs={p?.lineRefs ?? []}
      lineStatus={p?.lineStatus}
      lineVerdict={p?.lineVerdict}
      filesFound={p?.filesFound ?? []}
      filesReadCount={(p?.filesFound ?? []).filter((f) => f.readStatus === "read").length}
      filesTotal={p?.filesTotal}
      isReadingStage={p?.stage === "reading"}
      currentFile={p?.currentFile}
      currentWindowFiles={p?.currentWindowFiles}
      ai={p?.ai}
      log={p?.log ?? []}
      onCancel={onCancel}
      lastIssue={p?.lastIssue}
    />
  );
}

// ─── Evidence tab (PPD verdict + Actual Evidence, 4 columns) ────────────────
// Hybrid per-verdict approval gate, scoped to ONE sub-criterion, rendered
// inside the review modal/page beside the evidence rows that produced each
// verdict. Wired directly to the shared pendingCommits / resolvePendingItem
// store API — no parallel state. A verdict commits ONLY on an explicit
// Accept/Reject; closing the modal touches nothing (the queued run stays in
// pendingCommits and re-opens intact, so the Dashboard count stays accurate).
export function HybridGatePanel({ subCriterionId }: { subCriterionId: string }) {
  const run = useWorkspaceStore((s) => s.pendingCommits[subCriterionId]);
  const resolvePendingItem = useWorkspaceStore((s) => s.resolvePendingItem);
  const acceptAllPending = useWorkspaceStore((s) => s.acceptAllPending);
  const discardPendingRun = useWorkspaceStore((s) => s.discardPendingRun);
  const [edits, setEdits] = useState<Record<string, "Met" | "Partial" | "Not met">>({});

  if (!run || run.items.length === 0) return null;

  const statusTone = (s: string) => (s === "Met" ? "#15803d" : s === "Partial" ? "#b45309" : "#b91c1c");
  // Hybrid stops at each gate: present one verdict at a time, beside its
  // evidence. "Accept all remaining" stays as an explicit escape hatch.
  const items = run.items.slice(0, 1);

  return (
    <div style={{ border: "1px solid #fbbf24", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          ⏸ Needs your review ({run.items.length}) — sub-criterion {run.subCriterionId}
        </span>
        <Pill s="medium">{auditModeLabel(run.runMode)}</Pill>
        <Pill s="neutral">Option {run.path}</Pill>
        <span style={{ fontSize: 11, color: "#a16207", fontFamily: "ui-monospace,monospace" }}>{run.runId}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => { if (confirm(`Accept all ${run.items.length} remaining AI verdict(s) without reviewing each one?`)) acceptAllPending(run.subCriterionId); }}
            title="Commits every remaining queued verdict at once instead of stepping through each gate"
            style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 12px", borderRadius: 6, border: "1px solid #15803d", background: "#15803d", color: "#fff" }}
          >
            Accept all remaining
          </button>
          <button
            onClick={() => { if (confirm(`Discard all ${run.items.length} queued verdict(s) for ${run.subCriterionId}? Nothing will be committed.`)) discardPendingRun(run.subCriterionId); }}
            style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}
          >
            Discard run
          </button>
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#a16207", marginBottom: 6 }}>
        Approve, edit or reject each verdict in turn, beside its evidence below — {run.items.length} gate{run.items.length === 1 ? "" : "s"} remaining. Closing this review commits nothing and keeps them pending.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => {
          const chosen = edits[item.id] ?? item.write.status;
          return (
            <div key={item.id} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11.5, fontWeight: 700, color: "#4338ca" }}>{item.write.gd4ItemId}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusTone(item.write.status) }}>AI: {item.write.status}</span>
                {item.reason && <span style={{ fontSize: 11, color: "#a16207" }}>{item.reason}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4, marginBottom: 6 }}>{item.lineText}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={chosen}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [item.id]: e.target.value as "Met" | "Partial" | "Not met" }))}
                  style={{ ...inputStyle, width: 110, padding: "3px 5px", fontSize: 11.5 }}
                  title="Edit the verdict before accepting"
                >
                  <option value="Met">Met</option>
                  <option value="Partial">Partial</option>
                  <option value="Not met">Not met</option>
                </select>
                <button
                  onClick={() => resolvePendingItem(run.subCriterionId, item.id, "accept", chosen !== item.write.status ? chosen : undefined)}
                  style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 12px", borderRadius: 6, border: "1px solid #15803d", background: "#f0fdf4", color: "#15803d" }}
                >
                  {chosen !== item.write.status ? `Accept as ${chosen}` : "Accept"}
                </button>
                <button
                  onClick={() => resolvePendingItem(run.subCriterionId, item.id, "reject")}
                  style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One-shot state-aware action panel shown ONLY right after "Continue to
// Evidence" (never on a manual tab click) — the Pre-check → Evidence
// transition is never silent/passive: this branches on the REAL current
// situation (no assessment yet / unresolved Pre-check flags / an existing
// result that's fresh or stale / a result reused from a staged Option B
// audit) and proposes the one or two actions that actually make sense for
// it, rather than just reporting a status. Every action reuses an existing
// handler (runEvidenceAssessment, jump-to-Pre-check, dismiss-to-reveal-the-
// table-below) — nothing here is a parallel/duplicate code path. Flags and
// "evidence changed" are surfaced honestly but never block proceeding.
// Dismissible; also cleared automatically by any subsequent tab click (see
// PpdReviewContent).
type EvidenceArrivalState =
  | { kind: "not-ready" }
  | { kind: "checking" }
  | { kind: "ready-no-flags" }
  | { kind: "ready-flags"; count: number }
  | { kind: "staged"; runAt: string }
  | { kind: "existing"; met: number; partial: number; notMet: number; runAt: string; caveat?: string }
  | { kind: "changed"; added: number; removed: number; modified: number };

const arrivalPrimaryBtn: CSSProperties = { cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 7, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff" };
const arrivalSecondaryBtn: CSSProperties = { cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 7, border: "1px solid #4a5a8a", background: "#fff", color: "#4a5a8a" };
const arrivalMutedBtn: CSSProperties = { cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: 7, border: "1px solid #d1d5db", background: "#fff", color: "#6b7280" };
const arrivalEmphasizedBtn: CSSProperties = { cursor: "pointer", fontSize: 12.5, fontWeight: 800, padding: "7px 15px", borderRadius: 7, border: "1px solid #b45309", background: "#f59e0b", color: "#fff" };

function fmtRunAt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EvidenceArrivalPanel({
  state, onRun, onReviewPrecheck, onDismiss, onGoToPpd,
}: {
  state: EvidenceArrivalState;
  onRun: () => void;
  onReviewPrecheck: () => void;
  onDismiss?: () => void;
  onGoToPpd?: () => void;
}) {
  const changedState = state.kind === "changed";
  const tone = changedState
    ? { bg: "#fffbeb", border: "#fde68a", fg: "#92400e" }
    : { bg: "#f0fdf4", border: "#bbf7d0", fg: "#166534" };

  let message: React.ReactNode;
  let actions: React.ReactNode = null;

  if (state.kind === "not-ready") {
    message = "You're on the Evidence step now, but the PPD Review hasn't been completed yet — the Evidence assessment reuses each line's PPD verdict, so run the PPD Review first.";
    if (onGoToPpd) actions = <button type="button" onClick={onGoToPpd} style={arrivalPrimaryBtn}>Go to PPD Review →</button>;
  } else if (state.kind === "checking") {
    message = "Checking whether the evidence folder has changed since the last run…";
  } else if (state.kind === "ready-no-flags") {
    message = "No evidence assessment exists yet, and Pre-check found no unresolved flags. Ready to run.";
    actions = <button type="button" onClick={onRun} style={arrivalPrimaryBtn}>Run evidence assessment →</button>;
  } else if (state.kind === "ready-flags") {
    message = `No evidence assessment exists yet. Pre-check has ${state.count} unresolved flagged item${state.count === 1 ? "" : "s"} — advisory, never a gate, but worth a look before you run.`;
    actions = (
      <>
        <button type="button" onClick={onReviewPrecheck} style={arrivalSecondaryBtn}>Review Pre-check ({state.count}) →</button>
        <button type="button" onClick={onRun} style={arrivalPrimaryBtn}>Run anyway →</button>
      </>
    );
  } else if (state.kind === "staged") {
    message = <>This result was <b>reused from the Evidence Folder's staged audit</b> (Option B), run {fmtRunAt(state.runAt)} — not a fresh Option A pass.</>;
    actions = (
      <>
        <button type="button" onClick={onDismiss} style={arrivalSecondaryBtn}>View those results</button>
        <button type="button" onClick={onRun} style={arrivalPrimaryBtn}>Run Option A assessment directly →</button>
      </>
    );
  } else if (state.kind === "existing") {
    message = (
      <>
        An evidence assessment already exists: <b>{state.met} {evVerdictLabel("Met")}, {state.partial} {evVerdictLabel("Partial")}, {state.notMet} {evVerdictLabel("Not met")}</b> (run {fmtRunAt(state.runAt)}).
        {state.caveat && <span style={{ display: "block", marginTop: 3, fontStyle: "italic", color: "#92400e" }}>⚠ {state.caveat}</span>}
      </>
    );
    actions = (
      <>
        <button type="button" onClick={onDismiss} style={arrivalSecondaryBtn}>View results</button>
        <button type="button" onClick={onRun} style={arrivalMutedBtn}>Re-run assessment</button>
      </>
    );
  } else if (state.kind === "changed") {
    const parts = [state.added ? `${state.added} added` : null, state.removed ? `${state.removed} removed` : null, state.modified ? `${state.modified} modified` : null].filter(Boolean);
    message = <>⚠ The evidence folder has <b>changed since this assessment was run</b>{parts.length ? ` (${parts.join(", ")})` : ""} — this result may be outdated.</>;
    actions = (
      <>
        <button type="button" onClick={onRun} style={arrivalEmphasizedBtn}>Re-run assessment (recommended) →</button>
        <button type="button" onClick={onDismiss} style={arrivalMutedBtn}>View outdated results anyway</button>
      </>
    );
  }

  return (
    <div style={{ fontSize: 12, color: tone.fg, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 8, padding: "9px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ flex: 1 }}>{changedState ? "⚠" : "✅"} <b>Pre-check reviewed — now on the Evidence step.</b> {message}</span>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          style={{ cursor: "pointer", border: "none", background: "transparent", color: tone.fg, fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
        >
          ×
        </button>
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>{actions}</div>}
    </div>
  );
}

function EvidenceTab({ selectedId, justArrived, onDismissJustArrived, onGoToPrecheck, onGoToPpd }: { selectedId: string; justArrived?: boolean; onDismissJustArrived?: () => void; onGoToPrecheck?: () => void; onGoToPpd?: () => void }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runEvidenceAssessment = useWorkspaceStore((s) => s.runEvidenceAssessment);
  const deriveEvidenceAssessmentFromAudit = useWorkspaceStore((s) => s.deriveEvidenceAssessmentFromAudit);
  const checkEvidenceDrift = useWorkspaceStore((s) => s.checkEvidenceDrift);
  const compileEvidenceFindings = useWorkspaceStore((s) => s.compileEvidenceFindings);
  // Verdicts queued at this sub-criterion's hybrid approval gate — gates the
  // Compile button below (same selector the tab badge uses).
  const pendingGateCount = useWorkspaceStore((s) => s.pendingCommits[selectedId]?.items.length ?? 0);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const progress = useWorkspaceStore((s) => s.evidenceAssessmentProgress);
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);
  const skipCurrentFile = useWorkspaceStore((s) => s.skipCurrentFile);
  const checklistData = usePreCheckChecklistStore((s) => s.checklists);
  const preChecks = useWorkspaceStore((s) => s.preAnalysisChecks);
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  // Per-line feedback → CalibrationMemory (reuses ThumbsButtons + FeedbackModal).
  // A thumbs-down on an evidence line teaches future runs, because
  // runEvidenceAssessment now injects active "Line Status" memories.
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const addCalibrationMemory = useWorkspaceStore((s) => s.addCalibrationMemory);
  const [lineFeedback, setLineFeedback] = useState<{ ref: string; text: string } | null>(null);

  const ppd = ppdReviewResults[selectedId];
  const ppdReady = !!ppd && ppd.rows.length > 0 && !ppd.rows.some((r) => !r.ref);
  const assessment = evidenceAssessments[selectedId];
  const isRunning = busy === "evidenceassess" + selectedId;
  const runProgress = progress && progress.subCriterionId === selectedId ? progress : null;

  // Fix 1 — reuse the Evidence Folder staged audit's stored per-line results
  // instead of a fresh AI run. When no evidence-tab result exists yet, try to
  // populate it from the audit (no AI calls); only if that finds nothing does
  // the user need to click "Run evidence assessment".
  useEffect(() => {
    if (ppdReady && !assessment) deriveEvidenceAssessmentFromAudit(selectedId);
  }, [ppdReady, assessment, selectedId, deriveEvidenceAssessmentFromAudit]);

  // Arrival-panel state (see EvidenceArrivalPanel) — computed only while the
  // panel would actually be shown, since the drift check is a real (if
  // cheap, metadata-only) Drive API call. Flag count reuses the EXACT same
  // "flagged" definition runEvidenceAssessment's prompt injection uses.
  const itemIds = useMemo(() => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === selectedId).map((r) => r.id), [selectedId]);
  const flagCount = useMemo(() => {
    if (!justArrived || assessment) return 0;
    const files: DetectFile[] = [...(ppd?.fileLedger ?? [])].map((rec) => {
      const cacheKey = rec.driveFileId ? Object.entries(fileTextCache).find(([k]) => k.startsWith(`${rec.driveFileId}:`))?.[1] : undefined;
      return { name: rec.name, path: rec.path, bucket: rec.bucket, driveFileId: rec.driveFileId, text: cacheKey?.text ?? null };
    });
    return computeFlaggedPreCheckItems(checklistData, preChecks, selectedId, itemIds, files).totalCount;
  }, [justArrived, assessment, ppd, checklistData, preChecks, selectedId, itemIds, fileTextCache]);

  const [drift, setDrift] = useState<EvidenceDriftCheck | null>(null);
  useEffect(() => {
    setDrift(null);
    // Only a fresh, non-derived assessment carries a fileLedger to diff
    // against — derivedFromAudit results and assessments with no ledger at
    // all have nothing to compare, so no check is attempted for them.
    if (!justArrived || !assessment || assessment.derivedFromAudit || !assessment.fileLedger?.length) return;
    let cancelled = false;
    checkEvidenceDrift(selectedId).then((r) => { if (!cancelled) setDrift(r); });
    return () => { cancelled = true; };
  }, [justArrived, assessment, selectedId, checkEvidenceDrift]);

  const arrivalState: EvidenceArrivalState = !ppdReady
    ? { kind: "not-ready" }
    : !assessment
      ? (flagCount > 0 ? { kind: "ready-flags", count: flagCount } : { kind: "ready-no-flags" })
      : assessment.derivedFromAudit
        ? { kind: "staged", runAt: assessment.runAt }
        : (() => {
            const met = assessment.rows.filter((r) => r.verdict === "Met").length;
            const partial = assessment.rows.filter((r) => r.verdict === "Partial").length;
            const notMet = assessment.rows.filter((r) => r.verdict === "Not met").length;
            if (drift === null) return { kind: "checking" };
            if (drift.status === "changed") return { kind: "changed", added: drift.added.length, removed: drift.removed.length, modified: drift.modified.length };
            const caveat = drift.status === "error" ? `Couldn't confirm whether the evidence folder has changed since this run (${drift.errorMessage ?? "check failed"}).` : undefined;
            return { kind: "existing", met, partial, notMet, runAt: assessment.runAt, caveat };
          })();

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  // The lineage map (below) already covers "which file/section backs this
  // line" via its per-sub-part highlighted-source expansion, so the full
  // per-line table is secondary detail and defaults collapsed — same as the
  // PPD tab's table. Nothing inside is removed; a click reopens it intact.
  const [tableOpen, setTableOpen] = useState(false);
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  // Lineage-diagram node click: expand the matching evidence row + scroll to
  // it. Must also open the full requirement table itself — the row's DOM
  // node (id="evline-...") only exists when tableOpen is true, so a click
  // while the table is collapsed previously found no element and silently
  // did nothing.
  const openLine = (ref: string) => {
    setExpandedRows((prev) => new Set(prev).add(ref));
    setTableOpen(true);
    const id = `evline-${normalizeAuditRef(ref)}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  // Mirrors compileEvidenceFindings' exclusions: already-saved, failed, and
  // "Not assessed" rows raise nothing, so they don't count as compilable.
  const compilable = assessment ? assessment.rows.filter((r) => !r.savedFindingId && !r.assessmentFailed && r.verdict !== "Not assessed").length : 0;
  // Hybrid gate: while verdicts for this sub-criterion are still queued for
  // approval (HybridGatePanel below), Compile is disabled — compiling before
  // the gate would raise findings from unapproved verdicts and skip the
  // checklist write-back (approval itself re-runs the compile, so nothing is
  // lost by waiting). Full-auto/manual never queue, so they are unaffected.
  const compileDisabled = !assessment || compilable === 0 || pendingGateCount > 0;
  // Lines whose AI call failed/timed out and never recovered — see
  // assessmentFailed's doc comment. Retry re-submits ONLY these refs, but
  // still against the FULL evidence file set (runEvidenceAssessment always
  // re-reads/re-sends every cited file, never a per-file subset — a line's
  // verdict depends on all its evidence together, so a narrower retry would
  // be unsafe). Every other line's stored row is left completely untouched.
  const failedGdRefs = assessment ? assessment.rows.filter((r) => r.assessmentFailed).map((r) => r.gdRef) : [];

  function handleCompile() {
    const n = compileEvidenceFindings(selectedId);
    setCompileMsg(n > 0 ? `${n} finding${n === 1 ? "" : "s"} raised to the Findings register.` : "No new findings to raise — every line already has one.");
  }

  if (!ppdReady) {
    return (
      <>
        {justArrived && (
          <EvidenceArrivalPanel state={{ kind: "not-ready" }} onRun={() => runEvidenceAssessment(selectedId)} onReviewPrecheck={() => onGoToPrecheck?.()} onDismiss={onDismissJustArrived} onGoToPpd={() => onGoToPpd?.()} />
        )}
        <div style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
          Run the <b>PPD Review</b> first (the other tab) — the Evidence assessment reuses each requirement line's PPD verdict and doesn't re-read the policy.
        </div>
      </>
    );
  }

  // Before an assessment exists, still show one row per requirement line with
  // the GD4 + PPD columns filled from the PPD result; Evidence / AI verdict
  // columns show a "not assessed yet" placeholder.
  const rows = assessment
    ? assessment.rows
    : ppd.rows.map((p) => ({
        gdRef: p.ref, gd4ItemId: p.gd4ItemId, requirementText: p.requirementText,
        ppdExtract: p.fullComment || p.shortComment || "", ppdVerdict: p.verdict,
        evidenceSummary: "", evidenceFiles: [] as { name: string; url: string }[], evidenceChunkIds: [] as string[],
        verdict: undefined as EvidenceVerdict | undefined, comment: "", assessmentFailed: undefined as boolean | undefined, savedFindingId: undefined as string | undefined,
        promiseChecks: undefined as PromiseCheck[] | undefined,
      }));

  return (
    <>
      {justArrived && !isRunning && (
        <EvidenceArrivalPanel
          state={arrivalState}
          onRun={() => { setCompileMsg(null); runEvidenceAssessment(selectedId); }}
          onReviewPrecheck={() => onGoToPrecheck?.()}
          onDismiss={onDismissJustArrived}
          onGoToPpd={() => onGoToPpd?.()}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button
          disabled={isRunning}
          onClick={() => { setCompileMsg(null); runEvidenceAssessment(selectedId); }}
          style={{ cursor: isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a" }}
        >
          {isRunning ? "Assessing…" : assessment ? "Re-run evidence assessment" : "Run evidence assessment"}
        </button>
        {assessment && (
          <div style={{ fontSize: 11.5, color: "#6b7280" }}>
            {assessment.derivedFromAudit ? "Reused from Evidence Folder audit" : "Last run"} {new Date(assessment.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{assessment.rows.filter((r) => r.verdict === "Met").length} {evVerdictLabel("Met")}, {assessment.rows.filter((r) => r.verdict === "Partial").length} {evVerdictLabel("Partial")}, {assessment.rows.filter((r) => r.verdict === "Not met").length} {evVerdictLabel("Not met")}
          </div>
        )}
        <button
          onClick={handleCompile}
          disabled={compileDisabled}
          title={pendingGateCount > 0
            ? `Approve or reject the ${pendingGateCount} queued verdict${pendingGateCount === 1 ? "" : "s"} in the review gate below first — approval compiles findings automatically`
            : "Raise a finding (Not met→NC, Partial→OFI, Met→OBS) for every line that doesn't already have one"}
          style={{
            marginLeft: "auto", cursor: compileDisabled ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 8, border: "1px solid #4338ca",
            background: compileDisabled ? "#eef2ff" : "#4338ca", color: compileDisabled ? "#a5b4fc" : "#fff", whiteSpace: "nowrap",
          }}
        >
          Compile findings → {assessment && compilable > 0 ? `(${compilable})` : ""}
        </button>
        {pendingGateCount > 0 && (
          <span style={{ fontSize: 11.5, color: "#92400e" }}>
            ⏸ Compile unlocks after the {pendingGateCount} queued verdict{pendingGateCount === 1 ? "" : "s"} below {pendingGateCount === 1 ? "is" : "are"} reviewed.
          </span>
        )}
        <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 12, color: "#4a5a8a", fontWeight: 600, textDecoration: "none", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8 }}>
          Findings register →
        </Link>
      </div>

      {/* Retry — shown once the run has ended (successfully or not) if any
          line's AI call failed. Re-submits ONLY the failed line(s), always
          against the complete evidence file set (never a per-file subset —
          see failedGdRefs above); every other line's stored verdict is left
          untouched, not silently overwritten. Token counter: this is a fresh
          runEvidenceAssessment call, so its live "tokens" chip starts at 0
          and counts only the retry's own AI calls, not the original run's —
          each run/retry's usage is logged as its own separate AI Review Log
          entry, never summed into one running total. File reads for lines
          already read successfully hit the in-memory fileTextCache (shared
          with Option B), so only genuinely-unread/failed files are re-fetched
          from Drive — see the caching investigation in this task's report. */}
      {!isRunning && failedGdRefs.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8, padding: "9px 12px", background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: 8 }}>
          <span style={{ fontSize: 12.5, color: "#b23121", fontWeight: 600 }}>
            ⚠ {failedGdRefs.length} line{failedGdRefs.length === 1 ? "" : "s"} failed to assess: <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 400 }}>{failedGdRefs.join(", ")}</span>
          </span>
          <button
            type="button"
            onClick={() => { setCompileMsg(null); runEvidenceAssessment(selectedId, failedGdRefs); }}
            title="Re-assesses only these line(s), against the complete evidence file set — every other line's verdict is left untouched"
            style={{ marginLeft: "auto", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #b23121", background: "#fff", color: "#b23121", whiteSpace: "nowrap" }}
          >
            Retry {failedGdRefs.length} failed line{failedGdRefs.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {/* Step-by-step view (consistent with the staged audit modal) sits above
          the detailed live-activity panel below, which keeps the full blow-by-
          blow log / per-line status / files-read view. */}
      {isRunning && (
        <div style={{ marginBottom: 10, padding: "10px 12px", border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 8 }}>
          <RunStepper current={evidenceRunStep(runProgress?.stage, true, false)} running detail={runProgress?.detail} />
        </div>
      )}
      {/* Detailed live-activity panel while a fresh assessment runs (collapsible
          to a compact summary). Surfaces the backend activity the run already
          performs: stage, window, per-line status, files read, live log, AI usage. */}
      {isRunning && <EvidenceRunPanel progress={runProgress} onCancel={cancelBusy} onSkipFile={skipCurrentFile} />}

      {/* Files read this run — same clickable/inspectable ledger the staged audit
          shows; each file expands to its extracted text. (Fresh runs only; the
          derived-from-audit path carries no per-file ledger.) */}
      {assessment?.fileLedger && assessment.fileLedger.length > 0 && !isRunning && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>📂 Evidence files read this run</div>
          <FileLedger files={assessment.fileLedger} />
        </div>
      )}

      {assessment?.derivedFromAudit && !isRunning && (
        <div style={{ fontSize: 12, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 11px", marginBottom: 8 }}>
          These verdicts were reused from the Evidence Folder staged audit — no new AI calls were made. Use "Re-run evidence assessment" to reassess against the latest evidence files.
        </div>
      )}

      {compileMsg && (
        <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 11px", marginBottom: 8 }}>{compileMsg}</div>
      )}
      {!assessment && !isRunning && (
        <p style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 0 }}>No prior evidence result found for this sub-criterion. The PPD column below is carried over from the PPD Review tab; click "Run evidence assessment" to read the Actual Evidence folder and produce a combined verdict.</p>
      )}

      {/* Hybrid per-verdict approval gate — sits directly above the evidence
          rows so each Met/Partial/Not met is judged beside the cited files,
          chunk quotes and contradictions that produced it. */}
      <HybridGatePanel subCriterionId={selectedId} />

      {/* Requirement → PPD → Evidence lineage map (reuses stored row data) —
          the primary, always-visible view: per-sub-part expand-to-highlighted-
          source already answers "which file/section backs this line". */}
      <LineageDiagram mode="evidence" evidence={assessment} ppd={ppd} onOpenLine={openLine} runLabel={`${selectedId} ${GD4_SUB_CRITERIA.find((s) => s.id === selectedId)?.title ?? ""}`.trim()} />

      {/* Full per-line table below is secondary detail (same rows the map
          already summarises), so it defaults collapsed. Every row, every
          action (thumbs, Accept/Reject via the gate above, "show comment")
          is unchanged and intact underneath — this only changes default
          visibility. */}
      <button
        type="button"
        onClick={() => setTableOpen((o) => !o)}
        style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155", marginBottom: 10 }}
      >
        {tableOpen ? "Hide full requirement table ▲" : "Show full requirement table ▾"}
      </button>

      {tableOpen && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: EV_GRID, gap: 10, position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px 8px 0 0", padding: "6px 12px", marginBottom: -1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>GD4 requirement</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>PPD</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Evidence</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>AI verdict</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => {
          const expanded = expandedRows.has(row.gdRef);
          const border = row.assessmentFailed ? "#9ca3af" : row.verdict ? evVerdictBorderColor(row.verdict) : "#e2e8f0";
          const ppdExtractShort = row.ppdExtract.length > 160 ? `${row.ppdExtract.slice(0, 160)}…` : row.ppdExtract;
          return (
            <div key={row.gdRef} id={`evline-${normalizeAuditRef(row.gdRef)}`} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${border}`, borderRadius: 8, padding: "10px 12px", scrollMarginTop: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: EV_GRID, gap: 10, alignItems: "start" }}>
                {/* Column 1 — GD4 requirement */}
                <div>
                  <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 4 }}>{row.gdRef}</div>
                  <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4 }}>{row.requirementText}</div>
                </div>

                {/* Column 2 — PPD (reused from PPD Review tab) */}
                <div>
                  <Pill s={ppdVerdictTone(row.ppdVerdict)}>{row.ppdVerdict}</Pill>
                  <div style={{ borderLeft: "3px solid #c7d2fe", paddingLeft: 8, marginTop: 5, fontSize: 11.5, color: "#374151", lineHeight: 1.4, fontStyle: "italic" }}>
                    {ppdExtractShort || "(no PPD extract)"}
                  </div>
                </div>

                {/* Column 3 — Evidence (read fresh from the Actual Evidence folder) */}
                <div>
                  {!assessment ? (
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Not assessed yet</span>
                  ) : (
                    <>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: row.evidenceFiles.length > 0 ? "#15803d" : "#b23121", marginBottom: 3 }}>
                        {row.evidenceFiles.length > 0 ? `${row.evidenceFiles.length} file${row.evidenceFiles.length > 1 ? "s" : ""} cited` : "No evidence files cited"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "#374151", lineHeight: 1.4, marginBottom: row.evidenceFiles.length > 0 ? 4 : 0 }}>{row.evidenceSummary}</div>
                      {row.evidenceFiles.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {row.evidenceFiles.map((f) => (
                            <li key={f.url} style={{ fontSize: 11, marginBottom: 1 }}>
                              <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "#4338ca" }}>{f.name}</a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>

                {/* Column 4 — AI verdict (combined) */}
                <div>
                  {row.assessmentFailed ? (
                    <div>
                      <Pill s="critical">Assessment failed — retry</Pill>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>Re-run the evidence assessment to retry this line.</div>
                    </div>
                  ) : row.verdict === "Not assessed" ? (
                    <div>
                      <Pill s="neutral">Not assessed</Pill>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>No audit result matched this line — run or re-run the evidence assessment.</div>
                    </div>
                  ) : row.verdict ? (
                    <>
                      <Pill s={evVerdictTone(row.verdict)}>{evVerdictLabel(row.verdict)}</Pill>
                      {row.comment && (
                        <button
                          onClick={() => toggleExpanded(row.gdRef)}
                          style={{ display: "block", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0, marginTop: 5 }}
                        >
                          {expanded ? "Hide comment ▲" : "Show comment ▼"}
                        </button>
                      )}
                      {/* Was this evidence verdict right? 👎 stores a CalibrationMemory
                          that future Option A runs learn from. */}
                      <div style={{ marginTop: 6 }}>
                        <ThumbsButtons
                          onAccept={() => logHumanDecision({ module: "Line Status", subjectId: selectedId, field: row.gdRef, aiOutput: `Evidence ${row.gdRef}: ${row.verdict}`, humanDecision: `Accepted evidence verdict: ${row.verdict}`, changed: false, decisionType: "Accepted", reason: "" })}
                          onReject={() => setLineFeedback({ ref: row.gdRef, text: `Evidence verdict "${row.verdict}" for ${row.gdRef}: ${row.comment || row.evidenceSummary || "(no comment)"}` })}
                        />
                      </div>
                      <div style={{ marginTop: 5 }}>
                        {row.savedFindingId ? (
                          <>
                            <Pill s={findingTypeTone(findingTypeForStatus(row.verdict))}>Saved {row.savedFindingId}</Pill>
                            <Link to={`/findings?item=${row.gd4ItemId}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none", marginLeft: 4 }}>View →</Link>
                          </>
                        ) : (
                          <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Not yet compiled</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>—</span>
                  )}
                </div>
              </div>

              {expanded && (row.comment || (row.promiseChecks && row.promiseChecks.length > 0)) && (
                <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 10, paddingTop: 10 }}>
                  {row.promiseChecks && row.promiseChecks.length > 0 && (
                    <div style={{ marginBottom: row.comment ? 10 : 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>PPD promise checks</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {row.promiseChecks.map((p, i) => {
                          const tone = p.verdict === "evidenced" ? "#166534" : p.verdict === "contradicted" ? "#b91c1c" : "#b45309";
                          const mark = p.verdict === "evidenced" ? "✓" : p.verdict === "contradicted" ? "✗" : "○";
                          return (
                            <div key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>
                              <span style={{ color: tone, fontWeight: 700 }}>{mark} {p.verdict}</span>
                              <span style={{ color: "#1e293b" }}> — {p.promiseText}</span>
                              {p.evidence && <div style={{ color: "#64748b", marginLeft: 16 }}>{p.evidence}{p.chunkIds.length > 0 && <span style={{ fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}> ({p.chunkIds.join(", ")})</span>}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {row.comment && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Combined assessment</div>
                      <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.45, whiteSpace: "pre-line" }}>{row.comment}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </>
      )}
      <FeedbackModal
        open={!!lineFeedback}
        aiOutput={lineFeedback?.text ?? ""}
        module="Line Status"
        onClose={() => setLineFeedback(null)}
        onSubmit={(fb) => {
          logHumanDecision({ module: "Line Status", subjectId: selectedId, field: lineFeedback?.ref, aiOutput: lineFeedback?.text ?? "", humanDecision: (fb.correction || lineFeedback?.text) ?? "", changed: !!fb.correction, decisionType: "Overridden", reason: fb.reason });
          if (!fb.correct && fb.correction) {
            addCalibrationMemory({ module: "Line Status", subjectId: selectedId, context: lineFeedback?.text ?? "", aiOutput: lineFeedback?.text ?? "", staffCorrection: fb.correction, keyLearning: fb.reason, status: "active", tokenCount: Math.round((lineFeedback?.text?.length ?? 0) / 4) });
          }
          setLineFeedback(null);
        }}
      />
    </>
  );
}
