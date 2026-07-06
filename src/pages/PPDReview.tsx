import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import { TONE } from "../lib/theme";
import { exportOptionASummaryCsv, exportFileLedgerCsvFor, downloadCsv, auditCsvFilename } from "../lib/auditCsvExport";
import { LineageDiagram } from "../components/ui/LineageDiagram";
import { RunStepper, ppdRunStep, evidenceRunStep } from "../components/ui/RunStepper";
import { FileLedger } from "./EvidenceFolder";
import { normalizeAuditRef } from "../lib/gd4Refs";
import { PreAnalysisChecklistPanel } from "../components/ui/PreAnalysisChecklistPanel";
import { hasChecklist } from "../lib/preAnalysisChecklist";
import { usePreCheckChecklistStore } from "../store/usePreCheckChecklistStore";
import type { PPDVerdict, PPDOverallVerdict, EvidenceVerdict, PromiseCheck, EvidenceAssessmentProgress } from "../types";

// Option A's complete flow, as two tabs on one page:
//   • PPD Review — policy only, one row per GD4 requirement line (3 columns).
//   • Evidence   — reuses the PPD verdict + reads the Actual Evidence folder
//                  for a combined Met/Partial/Not met verdict (4 columns).
// Findings are compiled from the Evidence tab. The single-column Sub-Criterion
// Checklist (Option B) is untouched.

function ppdVerdictTone(v: PPDVerdict): "good" | "medium" | "critical" | "neutral" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : v === "Not assessed" ? "neutral" : "critical";
}

function ppdVerdictBorderColor(v: PPDVerdict): string {
  return v === "Adequate" ? "#22c55e" : v === "Partial" ? "#f59e0b" : v === "Not assessed" ? "#94a3b8" : "#ef4444";
}

function evVerdictTone(v: EvidenceVerdict): "good" | "medium" | "critical" | "neutral" {
  return v === "Met" ? "good" : v === "Partial" ? "medium" : v === "Not assessed" ? "neutral" : "critical";
}

function evVerdictBorderColor(v: EvidenceVerdict): string {
  return v === "Met" ? "#22c55e" : v === "Partial" ? "#f59e0b" : v === "Not assessed" ? "#94a3b8" : "#ef4444";
}

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

  if (!sub) return null;
  return (
    <>
      {/* Pre-run mode banner — Option A runs (PPD review / evidence assessment)
          are triggered from this content, so the offline/live state is shown
          before the run begins here too (page + Evidence Folder modal). */}
      <div style={{ marginBottom: 8 }}><RunModeBanner compact /></div>

      {/* Saved-state banner: proves the results are saved and current, and
          points at where the same verdicts also live (checklist + scoring). */}
      {savedResult && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 11.5, color: "#334155", background: "#eef2ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "7px 11px", marginBottom: 8 }}>
          <span><b>Last reviewed {new Date(savedResult.runAt).toLocaleString("en-SG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b> · {savedSummary.adequate} adequate / {savedSummary.partial} partial / {savedSummary.gaps} gaps{savedSummary.notAssessed ? ` / ${savedSummary.notAssessed} not assessed` : ""}</span>
          <span style={{ marginLeft: "auto", color: "#64748b" }}>
            Also reflected in the{" "}
            <Link to={`/sub-checklist?item=${requirementItems[0]?.id ?? ""}`} style={{ color: "#4338ca", fontWeight: 600 }}>Sub-Criterion Checklist</Link>{" "}&amp;{" "}
            <Link to="/scorecard" style={{ color: "#4338ca", fontWeight: 600 }}>Scorecard</Link>.
          </span>
        </div>
      )}

      <PpdNextStep selectedId={selectedId} />

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
            onClick={() => setTab(id)}
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
        : tab === "precheck" ? <PreCheckTab selectedId={selectedId} onContinue={() => setTab("evidence")} />
        : <EvidenceTab selectedId={selectedId} />}
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
// it never triggers a run.
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
function PpdNextStep({ selectedId }: { selectedId: string }) {
  const auditMode = useWorkspaceStore((s) => s.auditMode);
  const ppd = useWorkspaceStore((s) => s.ppdReviewResults[selectedId]);
  const ev = useWorkspaceStore((s) => s.evidenceAssessments[selectedId]);
  return (
    <NextStepBanner
      text={nextStepText("ppd-review", {
        mode: auditMode,
        ppdRun: !!ppd && ppd.rows.length > 0,
        evidenceRun: !!ev && ev.rows.length > 0,
        findingsCompiled: !!ev && ev.rows.some((r) => r.savedFindingId),
      })}
    />
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
  // Lineage-diagram node click: expand the matching row and scroll it into view.
  const openLine = (ref: string) => {
    setExpandedRows((prev) => new Set(prev).add(ref));
    const id = `ppdline-${normalizeAuditRef(ref)}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

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
        return (
          <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid #c7d2fe", background: "#eef2ff", borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3730a3" }}>PPD review running</span>
              <span style={{ fontSize: 11, color: "#6366f1" }}>live</span>
            </div>
            {/* Same step-by-step view as the staged audit modal. */}
            <RunStepper current={ppdRunStep(detail, true, false)} running detail={detail} />
          </div>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Overall PPD assessment</span>
                  <Pill s={overallVerdictTone(liveResult.overallVerdict)}>{liveResult.overallVerdict}</Pill>
                  {liveResult.overallSummary && <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>{liveResult.overallSummary}</span>}
                </div>
                {liveResult.overallNarrative && (
                  <p style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.5, margin: "0 0 6px", whiteSpace: "pre-line" }}>{liveResult.overallNarrative}</p>
                )}
                {weakRows.length > 0 && (
                  <div style={{ fontSize: 12, color: "#374151" }}>
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
            {" · "}{liveResult.rows.filter((r) => r.verdict === "Adequate").length} Adequate, {liveResult.rows.filter((r) => r.verdict === "Partial").length} Partial, {liveResult.rows.filter((r) => r.verdict === "Not documented").length} Not documented
          </div>

          {/* Requirement → PPD lineage map (reuses this run's row data). */}
          <LineageDiagram mode="ppd" ppd={liveResult} onOpenLine={openLine} />

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
              return (
                <div key={row.ref} id={`ppdline-${normalizeAuditRef(row.ref)}`} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${ppdVerdictBorderColor(row.verdict)}`, borderRadius: 8, padding: "10px 12px", scrollMarginTop: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: PPD_GRID, gap: 10, alignItems: "start" }}>
                    <div>
                      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 4 }}>{row.ref}</div>
                      <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4 }}>{row.requirementText}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 4, fontFamily: "ui-monospace,monospace" }}>{sourceRef}</div>
                      <div style={{ borderLeft: "3px solid #c7d2fe", paddingLeft: 8, fontSize: 12, color: "#374151", lineHeight: 1.4, fontStyle: "italic" }}>{extractPreview}</div>
                    </div>
                    <div>
                      <Pill s={ppdVerdictTone(row.verdict)}>{row.verdict}</Pill>
                      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, margin: "5px 0" }}>{row.shortComment}</div>
                      <button
                        onClick={() => toggleExpanded(row.ref)}
                        style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
                      >
                        {expanded ? "Hide full comment + rewrite ▲" : "Show full comment + rewrite ▼"}
                      </button>
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
  );
}

// ─── Detailed live-activity panel for a running evidence assessment ─────────
// Collapsible: a compact summary line always shows; "Show detail" reveals the
// full live view (stage, window, per-line status, files, log, AI usage). All
// data comes from evidenceAssessmentProgress — no assessment logic here.
const STAGE_LABEL: Record<NonNullable<EvidenceAssessmentProgress["stage"]>, string> = {
  reading: "Reading files", assessing: "Assessing evidence", verifying: "Verifying citations", synthesising: "Synthesising", done: "Done",
};
const LOG_TONE: Record<NonNullable<import("../types").EvidenceRunLogLine["tone"]>, string> = {
  info: "#475569", good: "#166534", warn: "#92600a", bad: "#b23121",
};

function EvidenceRunPanel({ progress, onCancel }: { progress: EvidenceAssessmentProgress | null; onCancel: () => void }) {
  const [open, setOpen] = useState(true);
  // 1s tick so the elapsed timer and "no activity for Ns" heartbeat move even
  // when a slow window produces no events — the run must never look frozen.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const p = progress;
  const pct = p?.pct ?? 5;
  const stage = p?.stage ? STAGE_LABEL[p.stage] : "Starting…";
  const elapsedS = p?.startedAt ? Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000)) : 0;
  const elapsedLabel = elapsedS >= 60 ? `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s` : `${elapsedS}s`;
  const sinceBeatS = p?.heartbeatAt ? Math.floor((Date.now() - p.heartbeatAt) / 1000) : 0;
  const lineRefs = p?.lineRefs ?? [];
  const doneLines = lineRefs.filter((r) => p?.lineStatus?.[r] === "done").length;
  const filesRead = p?.filesRead ?? [];
  const log = p?.log ?? [];

  const R = 26, CIRC = 2 * Math.PI * R;
  const chip = (label: string, value: string, tone: { fg: string; bg: string }) => (
    <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{value} {label}</span>
  );
  const lineTone = (s?: string) => s === "done" ? TONE.good : s === "assessing" ? TONE.progress : TONE.neutral;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #c7d2fe", background: "#f5f7ff", borderRadius: 12, padding: "12px 14px" }}>
      {/* Compact summary line — always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
          <svg width={60} height={60}>
            <circle cx={30} cy={30} r={R} fill="none" stroke={TONE.neutral.bg} strokeWidth={6} />
            <circle cx={30} cy={30} r={R} fill="none" stroke={TONE.progress.fg} strokeWidth={6} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)} transform="rotate(-90 30 30)" style={{ transition: "stroke-dashoffset 0.4s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{pct}%</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
            {stage}{p?.window && p.window.total > 1 ? ` · window ${p.window.current} of ${p.window.total}` : ""}
          </div>
          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
            {p?.detail ?? "Working…"} · {doneLines}/{lineRefs.length} lines · elapsed {elapsedLabel}
            {sinceBeatS > 12 && <span style={{ color: "#92600a", fontWeight: 700 }}> · no activity {sinceBeatS}s (still working, a window can be slow)</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 7, border: "1px solid #c7d2fe", background: "#fff", color: "#4338ca" }}>
            {open ? "Hide detail ▲" : "Show detail ▼"}
          </button>
          <button onClick={onCancel} title="Stops the assessment: the in-flight AI call is aborted" style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff5f5", color: "#b23121" }}>
            Cancel
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Stat chips */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chip("files read", String(filesRead.length + (p?.filesTotal ? `/${p.filesTotal}` : "")), TONE.good)}
            {chip("lines done", `${doneLines}/${lineRefs.length}`, TONE.progress)}
            {chip(p?.ai && p.ai.calls === 1 ? "AI call" : "AI calls", String(p?.ai?.calls ?? 0), TONE.neutral)}
            {p?.ai && p.ai.totalTokens > 0 && chip("tokens", p.ai.totalTokens.toLocaleString(), TONE.neutral)}
            {p?.ai?.model && chip("model", p.ai.model, TONE.neutral)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Per-line status */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>Requirement lines</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 180, overflowY: "auto" }}>
                {lineRefs.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Preparing…</div> : lineRefs.map((r) => {
                  const st = p?.lineStatus?.[r];
                  const tone = lineTone(st);
                  const v = p?.lineVerdict?.[r];
                  return (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone.fg, flexShrink: 0, opacity: st === "waiting" || !st ? 0.4 : 1 }} />
                      <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: tone.fg }}>{r}</span>
                      <span style={{ color: tone.fg, opacity: 0.85 }}>{st === "done" ? (v ?? "done") : st === "assessing" ? "assessing…" : "waiting"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Files read */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>
                Files read{p?.filesTotal ? ` (${filesRead.length}/${p.filesTotal})` : ""}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 180, overflowY: "auto" }}>
                {p?.currentFile && <div style={{ fontSize: 11.5, color: TONE.progress.fg, fontWeight: 600 }}>▸ {p.currentFile} …</div>}
                {filesRead.length === 0 && !p?.currentFile ? <div style={{ fontSize: 12, color: "#94a3b8" }}>None yet</div> : filesRead.slice().reverse().map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#166534", minWidth: 0 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {f.name}</span>
                    {/* Open the exact file in Drive — same link pattern as the pre-flight list. */}
                    {f.driveFileId && (
                      <a href={`https://drive.google.com/file/d/${f.driveFileId}/view`} target="_blank" rel="noopener noreferrer" title={`Open "${f.name}" in Google Drive`} style={{ flexShrink: 0, color: "#2563eb", textDecoration: "none", padding: "0 2px", lineHeight: 1 }}>↗</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live log — newest at the bottom */}
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "8px 11px", maxHeight: 160, overflowY: "auto" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Live activity log</div>
            {log.length === 0 ? <div style={{ fontSize: 11.5, color: "#64748b" }}>Waiting for activity…</div> : log.map((l, i) => (
              <div key={i} style={{ fontSize: 11.5, fontFamily: "ui-monospace,monospace", color: l.tone ? LOG_TONE[l.tone] : "#cbd5e1", lineHeight: 1.6 }}>
                <span style={{ color: "#64748b" }}>{new Date(l.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}{l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
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

function EvidenceTab({ selectedId }: { selectedId: string }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runEvidenceAssessment = useWorkspaceStore((s) => s.runEvidenceAssessment);
  const deriveEvidenceAssessmentFromAudit = useWorkspaceStore((s) => s.deriveEvidenceAssessmentFromAudit);
  const compileEvidenceFindings = useWorkspaceStore((s) => s.compileEvidenceFindings);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const progress = useWorkspaceStore((s) => s.evidenceAssessmentProgress);
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);

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

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });
  // Lineage-diagram node click: expand the matching evidence row + scroll to it.
  const openLine = (ref: string) => {
    setExpandedRows((prev) => new Set(prev).add(ref));
    const id = `evline-${normalizeAuditRef(ref)}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  // Mirrors compileEvidenceFindings' exclusions: already-saved, failed, and
  // "Not assessed" rows raise nothing, so they don't count as compilable.
  const compilable = assessment ? assessment.rows.filter((r) => !r.savedFindingId && !r.assessmentFailed && r.verdict !== "Not assessed").length : 0;

  function handleCompile() {
    const n = compileEvidenceFindings(selectedId);
    setCompileMsg(n > 0 ? `${n} finding${n === 1 ? "" : "s"} raised to the Findings register.` : "No new findings to raise — every line already has one.");
  }

  if (!ppdReady) {
    return (
      <div style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
        Run the <b>PPD Review</b> first (the other tab) — the Evidence assessment reuses each requirement line's PPD verdict and doesn't re-read the policy.
      </div>
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
            {" · "}{assessment.rows.filter((r) => r.verdict === "Met").length} Met, {assessment.rows.filter((r) => r.verdict === "Partial").length} Partial, {assessment.rows.filter((r) => r.verdict === "Not met").length} Not met
          </div>
        )}
        <button
          onClick={handleCompile}
          disabled={!assessment || compilable === 0}
          title="Raise a finding (Not met→NC, Partial→OFI, Met→OBS) for every line that doesn't already have one"
          style={{
            marginLeft: "auto", cursor: (!assessment || compilable === 0) ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 8, border: "1px solid #4338ca",
            background: (!assessment || compilable === 0) ? "#eef2ff" : "#4338ca", color: (!assessment || compilable === 0) ? "#a5b4fc" : "#fff", whiteSpace: "nowrap",
          }}
        >
          Compile findings → {assessment && compilable > 0 ? `(${compilable})` : ""}
        </button>
        <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 12, color: "#4a5a8a", fontWeight: 600, textDecoration: "none", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8 }}>
          Findings register →
        </Link>
      </div>

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
      {isRunning && <EvidenceRunPanel progress={runProgress} onCancel={cancelBusy} />}

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

      {/* Requirement → PPD → Evidence lineage map (reuses stored row data). */}
      <LineageDiagram mode="evidence" evidence={assessment} ppd={ppd} onOpenLine={openLine} />

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
                      <Pill s={evVerdictTone(row.verdict)}>{row.verdict}</Pill>
                      {row.comment && (
                        <button
                          onClick={() => toggleExpanded(row.gdRef)}
                          style={{ display: "block", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0, marginTop: 5 }}
                        >
                          {expanded ? "Hide comment ▲" : "Show comment ▼"}
                        </button>
                      )}
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
  );
}
