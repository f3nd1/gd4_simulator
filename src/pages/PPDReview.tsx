import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { DRIVE_CONNECT_PATH } from "../lib/driveGuard";
import { AUDITOR_CREATION_PATH } from "../lib/auditorGuard";
import { inputStyle } from "../components/ui/Card";
import { RunModeBanner } from "../components/ui/RunModeBanner";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { itemIdsForScope, folderScopeId, subOfScope, scopeTitle } from "../lib/evidenceScope";
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
import { PreAnalysisChecklistPanel } from "../components/ui/PreAnalysisChecklistPanel";
import { ThumbsButtons } from "../components/ui/ThumbsButtons";
import { FeedbackModal } from "../components/ui/FeedbackModal";
import { hasChecklist, computeFlaggedPreCheckItems, type DetectFile } from "../lib/preAnalysisChecklist";
import { usePreCheckChecklistStore } from "../store/usePreCheckChecklistStore";
import { ppdVerdictTone, ppdVerdictLabel, evVerdictLabel } from "../lib/verdictTone";
import type { PPDOverallVerdict, EvidenceVerdict, EvidenceAssessmentProgress, EvidenceDriftCheck, PPDReviewProgress, AuditFileRecord, PPDReviewRow, EvidenceAssessmentRow, EvidenceLineRunStatus, EvidenceRunLogLine, EvidenceRunIssue } from "../types";

// Task 2: a STABLE empty-array reference for "no history yet" — `?? []`
// inline would allocate a new array on every selector call, and since
// useWorkspaceStore's selector equality is reference-based, that reads as
// "the store changed" on every render and infinite-loops (React's "Maximum
// update depth exceeded" / "getSnapshot should be cached" — a real crash
// this exact bug caused for any sub-criterion with no archived runs yet,
// i.e. every one before its second Option A run).
const EMPTY_HISTORY: never[] = [];

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

// NOTE: the standalone PPD Requirements Review page (and its /ppd-review route)
// was retired — the review now runs entirely in the Evidence Folder's review
// modal, which imports the shared pieces below (PpdReviewContent, HybridGatePanel,
// ResultNavLinks, OptionAExportButtons). Only the page wrapper was removed; these
// exported building blocks stay.

// Two jump-links shown on every "View result" surface (Option A modal / page
// AND the Option B AuditRunModal) so an auditor can go straight from a run
// result to either the Sub-Criterion Checklist or the Findings register,
// filtered to the sub-criterion just reviewed. Reuses existing routes only.
// subCriterionId is a run-scope (item id for a split 4.2 card, else the sub).
export function ResultNavLinks({ subCriterionId }: { subCriterionId: string }) {
  const firstItemId = itemIdsForScope(subCriterionId)[0] ?? "";
  const linkStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#4338ca", textDecoration: "none", padding: "5px 11px", border: "1px solid #c7d2fe", borderRadius: 7, background: "#eef2ff", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Link to={firstItemId ? `/sub-checklist?item=${firstItemId}` : "/sub-checklist"} style={linkStyle}>Sub-Criterion Checklist →</Link>
      <Link to={subCriterionId ? `/findings?subCrit=${subOfScope(subCriterionId)}` : "/findings"} style={linkStyle}>Findings register →</Link>
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
  const title = scopeTitle(subCriterionId);
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
// selectedId is a run-scope (item id for a split 4.2 card, else the sub-criterion).
export function PpdReviewContent({ selectedId }: { selectedId: string }) {
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === subOfScope(selectedId));
  const [tab, setTab] = useState<"ppd" | "precheck" | "evidence">("ppd");
  // Set only by "Continue to Evidence" (below) — gives EvidenceTab a one-shot
  // signal to show a clear "you just arrived here" confirmation banner, so
  // the Pre-check → Evidence transition is never silent/ambiguous. Cleared on
  // any manual tab click (including re-clicking "Evidence" itself).
  const [justContinued, setJustContinued] = useState(false);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const folders = useWorkspaceStore((s) => s.folders);
  const folder = folders.find((f) => folderScopeId(f) === selectedId);
  // Count of verdicts queued for this sub-criterion's hybrid approval gate —
  // badged on the Evidence tab so the gate (which lives beside the evidence
  // rows there) is discoverable even when the review opens on the PPD tab.
  const pendingGateCount = useWorkspaceStore((s) => s.pendingCommits[selectedId]?.items.length ?? 0);

  const requirementItems = useMemo(
    () => GD4_REQUIREMENTS.filter((r) => itemIdsForScope(selectedId).includes(r.id)),
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
        {scopeTitle(selectedId)} — {sub.description}
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
  const itemIds = useMemo(() => itemIdsForScope(selectedId), [selectedId]);

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

  const subTitle = scopeTitle(selectedId);
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

// One PPD line's expand-detail extras, rendered inside the matrix's own
// clause-by-clause expand (LineageDiagram's renderExtra) instead of a
// separate "Full requirement table" row. Per the user's Option A decision:
// PPD promises fold INTO the clause table (LineageDiagram's citationCode, an
// exact sourceQuote match, no separate list here) — but the sub-clause check
// stays its own compact strip, because on real runs the clause table can
// have FEWER rows than row.subClauses (not every sub-part resolves to a
// clause+quote), so this is the only place some sub-parts are visible at all.
function PpdRowExtra({ row, selectedId, setLineFeedback }: { row: PPDReviewRow; selectedId: string; setLineFeedback: (fb: { ref: string; text: string } | null) => void }) {
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const [showComment, setShowComment] = useState(false);
  return (
    <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 10, paddingTop: 10 }}>
      {row.subClauses && row.subClauses.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Sub-clause check</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {row.subClauses.map((c, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11, lineHeight: 1.4, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
                  background: c.verdict === "documented" ? "#f0fdf4" : "#fef2f2",
                  border: `1px solid ${c.verdict === "documented" ? "#bbf7d0" : "#fecaca"}`,
                  color: c.verdict === "documented" ? "#166534" : "#b91c1c",
                }}
              >
                {c.verdict === "documented" ? "✓" : "○"} {c.text}
              </span>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowComment((v) => !v)}
        style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
      >
        {showComment ? "Hide the AI's written comment ▲" : "Show the AI's written comment ▼"}
      </button>
      {showComment && (
        <div style={{ marginTop: 6 }}>
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
      {/* Was this PPD verdict right? 👎 opens the correction modal, which
          stores a CalibrationMemory that future runs learn from. */}
      <div style={{ marginTop: 8 }}>
        <ThumbsButtons
          onAccept={() => logHumanDecision({ module: "Line Status", subjectId: selectedId, field: row.ref, aiOutput: `PPD ${row.ref}: ${row.verdict}`, humanDecision: `Accepted PPD verdict: ${row.verdict}`, changed: false, decisionType: "Accepted", reason: "" })}
          onReject={() => setLineFeedback({ ref: row.ref, text: `PPD verdict "${row.verdict}" for ${row.ref}: ${row.fullComment || row.shortComment || "(no comment)"}` })}
        />
      </div>
    </div>
  );
}

// ─── PPD Review tab (policy only, 3 columns) ────────────────────────────────
function PpdTab({ selectedId, totalLines }: { selectedId: string; totalLines: number }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
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

  // Auditor gate — runPPDReview checks this BEFORE the Drive check, so a
  // blocked auditor gate (no auditors, or none currently active) used to make
  // "Re-run PPD review" silently no-op inside this modal: the outer Evidence
  // Folder page already renders auditBlockedReason, but this modal never did.
  const auditBlockedReason = useWorkspaceStore((s) => s.auditBlockedReason);
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
  // The lineage map's "Overall PPD assessment" summary is secondary detail,
  // so it defaults collapsed. Nothing inside is removed; a click reopens the
  // exact same content that rendered here before.
  const [assessmentOpen, setAssessmentOpen] = useState(false);

  // Old-format results (pre per-line refactor) keyed rows per whole item and
  // lack `ref`; force a re-run rather than render the collapsed single row.
  const isStale = !!result && result.rows.some((r) => !r.ref);
  const liveResult = result && !isStale ? result : undefined;

  // Task 2: past runs, newest first — the current run stays exactly at
  // `result` above (untouched), this is ONLY for viewing an older archived
  // run read-only. null = viewing the current run (the default).
  const ppdHistory = useWorkspaceStore((s) => s.ppdReviewHistory[selectedId] ?? EMPTY_HISTORY);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  useEffect(() => { setHistoryIdx(null); }, [selectedId]);
  const viewedResult = historyIdx === null ? liveResult : ppdHistory[historyIdx];

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

      {/* Auditor gate blocked the last run attempt — same message + action
          the outer Evidence Folder page shows, so a click here that fails
          this gate (checked BEFORE Drive) is never a silent no-op. */}
      {auditBlockedReason && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "9px 12px", background: "#fbe7e3", border: "1px solid #f2b8ae", borderRadius: 8, fontSize: 12.5, color: "#b23121", fontWeight: 600 }}>
          <span aria-hidden>⛔</span>
          <span style={{ flex: 1, minWidth: 240 }}>{auditBlockedReason}</span>
          <Link to={AUDITOR_CREATION_PATH} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b23121", borderRadius: 6, padding: "5px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
            Go to Auditor Creation →
          </Link>
        </div>
      )}

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
              <RunStepper current={ppdRunStep(detail)} running detail={detail} />
            </div>
            {/* Detailed live-activity panel (collapsible to a compact summary) —
                same LiveRunPanel/RunDetailColumns the Evidence tab uses, so both
                tabs' 3-column live views are visually identical. */}
            <LiveRunPanel progress={runProgress} stageLabel={PPD_STAGE_LABEL} onCancel={cancelBusy} />
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
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {historyIdx === null ? "Last run" : "Viewing run"} {new Date(viewedResult!.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {" · "}{viewedResult!.live ? "Live AI" : "Offline"}
              {viewedResult!.model && <> · {viewedResult!.model}</>}
              {" · "}{viewedResult!.rows.filter((r) => r.verdict === "Adequate").length} {ppdVerdictLabel("Adequate")}, {viewedResult!.rows.filter((r) => r.verdict === "Partial").length} {ppdVerdictLabel("Partial")}, {viewedResult!.rows.filter((r) => r.verdict === "Not documented").length} {ppdVerdictLabel("Not documented")}
            </span>
            {/* Task 2: past runs are kept, not overwritten — this picker is the
                only place they're viewable (read-only; re-running always
                targets the current/Latest run regardless of what's selected
                here). */}
            {ppdHistory.length > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontWeight: 600, color: "#475569" }}>Run:</span>
                <select
                  value={historyIdx ?? "latest"}
                  onChange={(e) => setHistoryIdx(e.target.value === "latest" ? null : Number(e.target.value))}
                  style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#334155" }}
                >
                  <option value="latest">Latest{liveResult ? ` (${fmtRunAt(liveResult.runAt)})` : ""}</option>
                  {ppdHistory.map((h, i) => (
                    <option key={h.runAt} value={i}>
                      {fmtRunAt(h.runAt)}{h.model ? ` — ${h.model}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Requirement → PPD lineage map (reuses this run's row data) — the
              only view of these 13 lines on this tab: per-sub-part expand
              shows the clause-by-clause detail plus (see renderExtra) the
              policy promises, full comment, and thumbs for that same line. */}
          <LineageDiagram
            mode="ppd"
            ppd={viewedResult!}
            runLabel={`${selectedId} ${scopeTitle(selectedId)}`.trim()}
            renderExtra={(ref) => {
              const row = viewedResult!.rows.find((r) => r.ref === ref);
              return row ? <PpdRowExtra row={row} selectedId={selectedId} setLineFeedback={setLineFeedback} /> : null;
            }}
          />
        </>
      )}
      <FeedbackModal
        open={!!lineFeedback}
        aiOutput={lineFeedback?.text ?? ""}
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

// ─── Detailed live-activity panel for a running PPD review / evidence
// assessment ────────────────────────────────────────────────────────────────
// Collapsible: a compact summary line always shows; "Show detail" reveals the
// full live view (stage, window, per-line status, files, log, AI usage). All
// data comes from the caller's progress object — no assessment logic here.
// EvidenceAssessmentProgress and PPDReviewProgress structurally satisfy this
// (PPD simply lacks the Evidence-only `filesRead` field), so one panel component
// renders both tabs' live view, fed a per-tab stage-label map and read-count.
type LiveRunProgress = {
  pct?: number;
  stage?: string;
  detail?: string;
  startedAt?: number;
  heartbeatAt?: number;
  window?: { current: number; total: number };
  filesTotal?: number;
  filesFound?: AuditFileRecord[];
  filesRead?: { name: string; driveFileId?: string }[]; // Evidence only
  canSkipCurrentFile?: boolean;
  currentFile?: string;
  currentWindowFiles?: string[];
  lineRefs?: string[];
  lineStatus?: Record<string, EvidenceLineRunStatus>;
  lineVerdict?: Record<string, string>;
  log?: EvidenceRunLogLine[];
  ai?: { calls: number; model?: string; totalTokens: number };
  lastIssue?: EvidenceRunIssue;
};

const EVIDENCE_STAGE_LABEL: Record<NonNullable<EvidenceAssessmentProgress["stage"]>, string> = {
  reading: "Reading files", assessing: "Assessing evidence", verifying: "Verifying citations", synthesising: "Synthesising", done: "Done",
};
const PPD_STAGE_LABEL: Record<NonNullable<PPDReviewProgress["stage"]>, string> = {
  reading: "Reading files", assessing: "Assessing PPD documentation", done: "Done",
};

function LiveRunPanel({ progress: p, stageLabel, onCancel, onSkipFile }: { progress: LiveRunProgress | null; stageLabel: Record<string, string>; onCancel: () => void; onSkipFile?: () => void }) {
  // Evidence tracks reads via its own `filesRead` list; PPD (which has no
  // such field) derives the count from filesFound's readStatus instead.
  const filesReadCount = p?.filesRead ? p.filesRead.length : (p?.filesFound ?? []).filter((f) => f.readStatus === "read").length;
  return (
    <RunDetailColumns
      pct={p?.pct ?? 5}
      stageLabel={p?.stage ? (stageLabel[p.stage] ?? p.stage) : "Starting…"}
      windowLabel={p?.window && p.window.total > 1 ? `window ${p.window.current} of ${p.window.total}` : undefined}
      detail={p?.detail ?? "Working…"}
      startedAt={p?.startedAt}
      heartbeatAt={p?.heartbeatAt}
      lineRefs={p?.lineRefs ?? []}
      lineStatus={p?.lineStatus}
      lineVerdict={p?.lineVerdict}
      filesFound={p?.filesFound ?? []}
      filesReadCount={filesReadCount}
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
      {/* Legacy drain: the per-line gate was removed for Option A (new PPD +
          Evidence runs commit straight to the checklist) — a path-A queue can
          only be an older run from before that change, waiting for ONE
          explicit decision. It is also auto-cleared if a newer run commits
          for this sub-criterion (superseded). Option B staged runs still
          queue normally and keep the full per-line flow below. */}
      {run.path === "A" && (
        <div style={{ fontSize: 11.5, color: "#92400e", background: "#fff", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 9px", marginBottom: 6 }}>
          The per-line approval step has been removed — new evidence runs now commit straight to the checklist, where you can edit any verdict.
          This older run was still waiting from before that change: <b>Accept all remaining</b> to apply it, or <b>Discard run</b> if it has been superseded.
        </div>
      )}
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

// Task 1a: blocking choice runEvidenceAssessment presents ONCE, after its
// read loop has attempted every evidence file — bulk, not per-file: every
// file the run's vision-image budget forced it to skip is collected first,
// then one prompt covers all of them — VisionBudgetPromptModal, now mounted
// app-wide in Layout (see that component for why it must not live on one page).

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

// One evidence line's expand-detail extras, rendered inside the matrix's own
// clause-by-clause expand (LineageDiagram's renderExtra). The promise-check
// list itself is NOT repeated here — evidenceSpine() already builds the
// matrix's clause-by-clause rows straight from row.promiseChecks (same
// array), so this only carries what the matrix doesn't: the comment toggle,
// thumbs, and the saved-finding badge/link.
function EvRowExtra({ row, selectedId, setLineFeedback }: { row: EvidenceAssessmentRow; selectedId: string; setLineFeedback: (fb: { ref: string; text: string } | null) => void }) {
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const [showComment, setShowComment] = useState(false);
  if (!row.verdict || row.verdict === "Not assessed" || row.assessmentFailed) return null;
  return (
    <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 10, paddingTop: 10 }}>
      {row.comment && (
        <>
          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
          >
            {showComment ? "Hide comment ▲" : "Show comment ▼"}
          </button>
          {showComment && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>In short</div>
              <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.45, whiteSpace: "pre-line" }}>{row.comment}</div>
            </div>
          )}
        </>
      )}
      {/* Was this evidence verdict right? 👎 stores a CalibrationMemory that
          future Option A runs learn from. */}
      <div style={{ marginTop: 8 }}>
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

  // Same auditor-gate visibility fix as PpdTab — runEvidenceAssessment checks
  // this before Drive too, so "Re-run evidence assessment" had the same
  // silent-no-op risk.
  const auditBlockedReason = useWorkspaceStore((s) => s.auditBlockedReason);

  // Task 2: same read-only past-run viewer as the PPD tab — the current
  // run stays exactly at `assessment` above.
  const evidenceHistory = useWorkspaceStore((s) => s.evidenceAssessmentHistory[selectedId] ?? EMPTY_HISTORY);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  useEffect(() => { setHistoryIdx(null); }, [selectedId]);
  const viewedAssessment = historyIdx === null ? assessment : evidenceHistory[historyIdx];

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
  const itemIds = useMemo(() => itemIdsForScope(selectedId), [selectedId]);
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

  const [compileMsg, setCompileMsg] = useState<string | null>(null);

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

  return (
    <>
      {auditBlockedReason && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12, padding: "9px 12px", background: "#fbe7e3", border: "1px solid #f2b8ae", borderRadius: 8, fontSize: 12.5, color: "#b23121", fontWeight: 600 }}>
          <span aria-hidden>⛔</span>
          <span style={{ flex: 1, minWidth: 240 }}>{auditBlockedReason}</span>
          <Link to={AUDITOR_CREATION_PATH} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b23121", borderRadius: 6, padding: "5px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
            Go to Auditor Creation →
          </Link>
        </div>
      )}
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
        {viewedAssessment && (
          <div style={{ fontSize: 11.5, color: "#6b7280", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>
              {historyIdx !== null ? "Viewing run" : viewedAssessment.derivedFromAudit ? "Reused from Evidence Folder audit" : "Last run"} {new Date(viewedAssessment.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {viewedAssessment.model && <> · {viewedAssessment.model}</>}
              {" · "}{viewedAssessment.rows.filter((r) => r.verdict === "Met").length} {evVerdictLabel("Met")}, {viewedAssessment.rows.filter((r) => r.verdict === "Partial").length} {evVerdictLabel("Partial")}, {viewedAssessment.rows.filter((r) => r.verdict === "Not met").length} {evVerdictLabel("Not met")}
            </span>
            {/* Task 2: past runs are kept, not overwritten — read-only viewer;
                re-running always targets the current/Latest run. */}
            {evidenceHistory.length > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontWeight: 600, color: "#475569" }}>Run:</span>
                <select
                  value={historyIdx ?? "latest"}
                  onChange={(e) => setHistoryIdx(e.target.value === "latest" ? null : Number(e.target.value))}
                  style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#334155" }}
                >
                  <option value="latest">Latest{assessment ? ` (${fmtRunAt(assessment.runAt)})` : ""}</option>
                  {evidenceHistory.map((h, i) => (
                    <option key={h.runAt} value={i}>
                      {fmtRunAt(h.runAt)}{h.model ? ` — ${h.model}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
          <RunStepper current={evidenceRunStep(runProgress?.stage)} running detail={runProgress?.detail} />
        </div>
      )}
      {/* Detailed live-activity panel while a fresh assessment runs (collapsible
          to a compact summary). Surfaces the backend activity the run already
          performs: stage, window, per-line status, files read, live log, AI usage. */}
      {isRunning && <LiveRunPanel progress={runProgress} stageLabel={EVIDENCE_STAGE_LABEL} onCancel={cancelBusy} onSkipFile={skipCurrentFile} />}

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
          the only view of these lines on this tab: per-sub-part expand shows
          the clause-by-clause detail plus (see renderExtra) the comment,
          thumbs, and saved-finding status for that same line. */}
      <LineageDiagram
        mode="evidence"
        evidence={viewedAssessment}
        ppd={ppd}
        runLabel={`${selectedId} ${GD4_SUB_CRITERIA.find((s) => s.id === selectedId)?.title ?? ""}`.trim()}
        renderExtra={(ref) => {
          const row = viewedAssessment?.rows.find((r) => r.gdRef === ref);
          return row ? <EvRowExtra row={row} selectedId={selectedId} setLineFeedback={setLineFeedback} /> : null;
        }}
      />

      {/* On-demand Outcomes & Review pass — Option A only assesses Approach
          and Processes; this button runs Option B's staged third pass over
          the same documents to fill the other two APSR legs. Advisory panel
          first; the checklist changes only on the explicit Apply click. */}
      {assessment && !isRunning && <OutcomeReviewPanel selectedId={selectedId} setLineFeedback={setLineFeedback} />}
      <FeedbackModal
        open={!!lineFeedback}
        aiOutput={lineFeedback?.text ?? ""}
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

// On-demand Outcomes & Review pass panel. Option A structurally assesses only
// Approach (policy) and Processes (evidence); this runs Option B's staged
// third pass in isolation over the documents the Option A runs already read,
// so the Systems & Outcomes and Review APSR legs get a real judgement instead
// of the hardcoded "not assessed" placeholder. The result is ADVISORY until
// the explicit "Apply to checklist" click (all modes, including full-auto —
// this pass has staged-audit rigour, so it keeps the human gate Option A's
// verified two-pass pipeline was allowed to drop, see runModes.ts). Applying
// never moves a band: the band still flows solely from the human holistic
// matrix (setHolisticBand).
function OutcomeReviewPanel({ selectedId, setLineFeedback }: { selectedId: string; setLineFeedback: (v: { ref: string; text: string } | null) => void }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const result = useWorkspaceStore((s) => s.outcomeReviewResults[selectedId]);
  const progress = useWorkspaceStore((s) => s.outcomeReviewProgress);
  const runOutcomeReviewPass = useWorkspaceStore((s) => s.runOutcomeReviewPass);
  const applyOutcomeReviewResult = useWorkspaceStore((s) => s.applyOutcomeReviewResult);
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);
  const logHumanDecision = useWorkspaceStore((s) => s.logHumanDecision);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const isRunning = busy === "outcomereview" + selectedId;
  const runDetail = progress && progress.subCriterionId === selectedId ? progress.detail : null;

  const citedFiles = (chunkIds: string[]) =>
    [...new Set(chunkIds.map((c) => result?.chunkFileNames?.[c] ?? c))].join(", ");

  return (
    <div style={{ marginTop: 14, border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Systems &amp; Outcomes / Review — optional extra pass
        </span>
        {result?.appliedAt && (
          <Pill s="good">Applied to {result.appliedLineCount} line{result.appliedLineCount === 1 ? "" : "s"} · {new Date(result.appliedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Pill>
        )}
        <button
          disabled={isRunning}
          onClick={() => { setApplyMsg(null); runOutcomeReviewPass(selectedId); }}
          style={{ marginLeft: "auto", cursor: isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #6d28d9", background: isRunning ? "#f3e8ff" : "#6d28d9", color: isRunning ? "#a78bfa" : "#fff", whiteSpace: "nowrap" }}
        >
          {isRunning ? "Assessing…" : result ? "Re-run Outcomes & Review pass" : "Also assess Outcomes & Review →"}
        </button>
        {isRunning && (
          <button onClick={cancelBusy} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#475569" }}>
            Cancel
          </button>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: "#6b7280", margin: "6px 0 0" }}>
        Option A assesses Approach (your policy) and Processes (implementation evidence) only. This on-demand pass re-reads the same documents for
        outcome data (KPIs, results, trends) and review records, so those two dimensions get a real judgement instead of "not assessed". Where no such
        evidence exists it honestly reports "Not evident". Review the result below, then apply it — nothing changes on the checklist until you do, and
        the item's band always stays yours to confirm on the Sub-Criterion Checklist.
      </p>
      {isRunning && runDetail && (
        <div style={{ fontSize: 11.5, color: "#6d28d9", marginTop: 6 }}>⏳ {runDetail}</div>
      )}
      {result && !isRunning && (
        <>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8 }}>
            Run {new Date(result.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {result.model && <> · {result.model}</>} · outcome data on {result.rows.filter((r) => r.outcomeEvident).length}, review records on {result.rows.filter((r) => r.reviewEvident).length} of {result.rows.length} audit points
          </div>
          {result.runWarnings && result.runWarnings.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
              {result.runWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#6d28d9" }}>
                  <th style={{ padding: "4px 8px" }}>Ref</th>
                  <th style={{ padding: "4px 8px" }}>Outcome data</th>
                  <th style={{ padding: "4px 8px" }}>Review records</th>
                  <th style={{ padding: "4px 8px" }}>AI observation</th>
                  <th style={{ padding: "4px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const rowText = `Outcomes & Review ${row.ref}: outcome data ${row.outcomeEvident ? "evident" : "not evident"}, review records ${row.reviewEvident ? "evident" : "not evident"} — ${row.note}`;
                  return (
                    <tr key={row.ref} style={{ borderTop: "1px solid #ede9fe", verticalAlign: "top" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap" }}>{row.ref}</td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        {row.notAssessed ? <Pill s="neutral">Not assessed</Pill> : row.outcomeEvident ? <Pill s="good">Evident</Pill> : <Pill s="medium">Not evident</Pill>}
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        {row.notAssessed ? <Pill s="neutral">Not assessed</Pill> : row.reviewEvident ? <Pill s="good">Evident</Pill> : <Pill s="medium">Not evident</Pill>}
                      </td>
                      <td style={{ padding: "5px 8px", color: "#475569" }}>
                        {row.note}
                        {row.chunkIds.length > 0 && <div style={{ color: "#94a3b8", marginTop: 2 }}>Cited: {citedFiles(row.chunkIds)}</div>}
                      </td>
                      <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                        <ThumbsButtons
                          onAccept={() => logHumanDecision({ module: "Line Status", subjectId: selectedId, field: row.ref, aiOutput: rowText, humanDecision: "Accepted Outcomes & Review verdicts", changed: false, decisionType: "Accepted", reason: "" })}
                          onReject={() => setLineFeedback({ ref: row.ref, text: rowText })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <button
              onClick={() => {
                const n = applyOutcomeReviewResult(selectedId);
                setApplyMsg(n > 0
                  ? `Applied: Systems & Outcomes and Review updated on ${n} checklist line${n === 1 ? "" : "s"}. The band itself is unchanged — confirm it on the Sub-Criterion Checklist.`
                  : "No checklist lines matched this result — run the Evidence assessment first so the lines exist, then re-apply.");
              }}
              title="Writes ONLY the Systems & Outcomes and Review legs onto the matched checklist lines. Verdicts, evidence sufficiency and the band are untouched."
              style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 8, border: "1px solid #6d28d9", background: "#6d28d9", color: "#fff" }}
            >
              Apply to checklist →
            </button>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Updates the two APSR legs on matched lines only — never a verdict, never the band.</span>
          </div>
          {applyMsg && (
            <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 11px", marginTop: 8 }}>{applyMsg}</div>
          )}
        </>
      )}
    </div>
  );
}
