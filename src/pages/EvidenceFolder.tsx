import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { AuditFileRecord, AuditProgressState, FolderStatus } from "../types";

const SUMMARY_CAP = 320; // chars shown before the audit summary collapses

// ── Audit Progress Modal ────────────────────────────────────────────────────

const MODAL_KEYFRAMES = `
@keyframes audit-pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(59,130,246,0.45); }
  70%  { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
  100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
}
@keyframes audit-shimmer {
  0%   { background-position: -300% 0; }
  100% { background-position: 300% 0; }
}
`;

// Visual steps (condensing is folded into "Read files" visually)
const VISUAL_STEPS = [
  { emoji: "🔌", label: "Connect" },
  { emoji: "📂", label: "Read files" },
  { emoji: "🤖", label: "Ask AI" },
  { emoji: "💾", label: "Save" },
  { emoji: "✅", label: "Complete" },
] as const;

// Map audit stage → which visual step (0-based) it belongs to
function stageToVisualStep(stage: AuditProgressState["stage"]): number {
  switch (stage) {
    case "listing":    return 0;
    case "reading":
    case "condensing": return 1;
    case "auditing":   return 2;
    case "saving":     return 3;
    case "complete":   return 4;
    case "error":      return -1;
  }
}

function stageProgress(p: AuditProgressState): number {
  switch (p.stage) {
    case "listing": return 4;
    case "reading": {
      const done = p.filesRead ?? 0;
      const total = p.filesTotal ?? 1;
      return 5 + Math.round(35 * (done / total));
    }
    case "condensing": return 44;
    case "auditing": {
      const done = p.batchCurrent ?? 0;
      const total = p.batchTotal ?? 1;
      return 50 + Math.round(35 * (done / total));
    }
    case "saving": return 88;
    case "complete": return 100;
    case "error":   return 100;
  }
}

function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((d) => (d % 3) + 1), 500);
    return () => clearInterval(t);
  }, []);
  return <span style={{ color: "#93c5fd", letterSpacing: 2 }}>{"•".repeat(n)}</span>;
}

// ── Per-step detail panels ─────────────────────────────────────────────────

function ConnectDetail({ p, isActive }: { p: AuditProgressState; isActive: boolean }) {
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };
  if (isActive) {
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          Connecting to your Google Drive evidence folder<Dots />
        </div>
        <div style={muted}>Folder: <b>{p.folderName}</b> · sub-criterion {p.subCriterionId}</div>
      </div>
    );
  }
  const info = p.connectInfo;
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d", marginBottom: 6 }}>✓ Connected to Google Drive</div>
      {info?.folderNames.map((n) => (
        <div key={n} style={{ fontSize: 11.5, color: "#374151", marginBottom: 2 }}>
          📁 {n}
        </div>
      ))}
      {p.filesTotal != null && (
        <div style={{ ...muted, marginTop: 4 }}>{p.filesTotal} file{p.filesTotal !== 1 ? "s" : ""} found</div>
      )}
    </div>
  );
}

function FileStatusBadge({ file }: { file: AuditFileRecord }) {
  const badge =
    file.auditStatus === "cited"    ? { label: "📎 Cited",     color: "#0369a1", bg: "#e0f2fe" } :
    file.auditStatus === "not_used" ? { label: "— Not used",   color: "#6b7280", bg: "#f3f4f6" } :
    file.auditStatus === "audited"  ? { label: "🤖 Audited",   color: "#1e40af", bg: "#eff6ff" } :
    file.readStatus === "reading"   ? { label: "⏳ Reading…",  color: "#b45309", bg: "#fffbeb" } :
    file.readStatus === "read"      ? { label: "✅ Read",       color: "#15803d", bg: "#f0fdf4" } :
    file.readStatus === "condensed" ? { label: "📋 Condensed", color: "#7c3aed", bg: "#faf5ff" } :
    file.readStatus === "skipped"   ? { label: "⚠ Skipped",   color: "#9ca3af", bg: "#f9fafb" } :
    file.readStatus === "failed"    ? { label: "❌ Failed",    color: "#b91c1c", bg: "#fef2f2" } :
                                      { label: "• Found",      color: "#9ca3af", bg: "#f9fafb" };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: badge.bg, color: badge.color, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
      {badge.label}
    </span>
  );
}

// Dimension icons: shows which APSR dimensions this file was cited for
function DimIcons({ file }: { file: AuditFileRecord }) {
  const dims = file.usedForDimensions;
  if (!dims) return null;
  const items: { label: string; active: boolean }[] = [
    { label: "A", active: dims.approach },
    { label: "P", active: dims.processes },
    { label: "S", active: dims.systemsOutcomes },
    { label: "R", active: dims.review },
  ];
  return (
    <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
      {items.map((d) => (
        <span key={d.label} style={{ fontSize: 9, padding: "0 3px", borderRadius: 3, background: d.active ? "#dbeafe" : "#f1f5f9", color: d.active ? "#1d4ed8" : "#94a3b8", fontWeight: d.active ? 700 : 400 }}>
          {d.label}
        </span>
      ))}
    </span>
  );
}

function ReadFilesDetail({ p, isActive, onSkipFile }: { p: AuditProgressState; isActive: boolean; onSkipFile?: () => void }) {
  const files = p.filesFound ?? [];
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };

  if (files.length === 0) {
    return isActive
      ? <div style={{ fontSize: 13, color: "#374151" }}>Preparing to read files<Dots /></div>
      : <div style={muted}>No file records available.</div>;
  }

  const totalRead = files.filter((f) => f.readStatus === "read" || f.readStatus === "condensed").length;
  const totalSkipped = files.filter((f) => f.readStatus === "skipped").length;
  const totalFailed = files.filter((f) => f.readStatus === "failed").length;
  const totalCited = files.filter((f) => f.auditStatus === "cited").length;
  const totalNotUsed = files.filter((f) => f.auditStatus === "not_used").length;

  return (
    <div>
      {isActive && p.currentFileName && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0 }}>
            📂 Reading: <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11 }}>{p.currentFileName}</span>
            {p.currentFileAction && <span style={{ color: "#64748b", marginLeft: 6 }}>— {p.currentFileAction}</span>}
            <Dots />
          </div>
          {p.canSkipCurrentFile && onSkipFile && (
            <button
              onClick={onSkipFile}
              title="Abort reading this file and move on to the next one"
              style={{ cursor: "pointer", fontSize: 10.5, padding: "3px 8px", borderRadius: 5, border: "1px solid #fbbf24", background: "#fffbeb", color: "#92400e", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              Skip file
            </button>
          )}
        </div>
      )}
      <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff" }}>
        {files.map((file) => {
          const bucketLabel = file.bucket === "policy" ? "Policy" : "Evidence";
          const bucketColor = file.bucket === "policy" ? "#1d4ed8" : "#15803d";
          return (
            <div key={file.path} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 11 }}>
              <span style={{ fontSize: 9.5, color: bucketColor, background: bucketColor + "18", borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>{bucketLabel}</span>
              <span style={{ flex: 1, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.path}>{file.name}</span>
              <span style={{ color: "#94a3b8", flexShrink: 0, fontSize: 9.5 }}>{file.fileKind}</span>
              {file.charCount != null && <span style={{ color: "#94a3b8", flexShrink: 0, fontSize: 9.5 }}>{file.charCount.toLocaleString()}c</span>}
              {file.suspectedScannedPdf && (
                <span style={{ fontSize: 9, padding: "0 3px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontWeight: 600, flexShrink: 0 }} title="Suspected scanned PDF — little extractable text">Scan?</span>
              )}
              {file.extractedTextQuality && file.extractedTextQuality !== "high" && !file.suspectedScannedPdf && (
                <span style={{ fontSize: 9, padding: "0 3px", borderRadius: 3, background: "#f1f5f9", color: "#64748b", flexShrink: 0 }}>{file.extractedTextQuality}</span>
              )}
              <DimIcons file={file} />
              <FileStatusBadge file={file} />
              {file.failReason && <span style={{ fontSize: 9.5, color: "#b91c1c", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.failReason}>{file.failReason}</span>}
              {file.skipReason && file.readStatus === "skipped" && <span style={{ fontSize: 9.5, color: "#9ca3af", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.skipReason}>{file.skipReason}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ ...muted, marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span><b>{files.length}</b> files found</span>
        {totalRead > 0 && <span style={{ color: "#15803d" }}><b>{totalRead}</b> read</span>}
        {totalCited > 0 && <span style={{ color: "#0369a1" }}><b>{totalCited}</b> cited</span>}
        {totalNotUsed > 0 && <span style={{ color: "#6b7280" }}><b>{totalNotUsed}</b> not used</span>}
        {totalSkipped > 0 && <span><b>{totalSkipped}</b> skipped</span>}
        {totalFailed > 0 && <span style={{ color: "#b91c1c" }}><b>{totalFailed}</b> failed</span>}
      </div>
    </div>
  );
}

function AuditStepDetail({ p, isActive }: { p: AuditProgressState; isActive: boolean }) {
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };
  const batch = p.batchCurrent ?? 0;
  const total = p.batchTotal ?? 1;
  const isStrict = p.stageDetail?.includes("strict") || p.stageDetail?.includes("challenge");
  if (isActive) {
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          🤖 {isStrict ? "Running strict challenge pass" : `Asking AI to assess your evidence — batch ${batch} of ${total}`}<Dots />
        </div>
        <div style={{ ...muted, marginBottom: 4 }}>
          {isStrict ? "Re-checking every Met/Partial verdict: is this truly implemented with records, or just a policy on paper?" : "Comparing your evidence files against each GD4 checklist requirement and writing verdicts"}
        </div>
        <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {p.filesTotal != null && <span><b>{p.filesTotal}</b> file{p.filesTotal !== 1 ? "s" : ""} in scope</span>}
          {total > 1 && <span>Batch <b>{batch}</b> of <b>{total}</b></span>}
          <span>{p.auditLive ? "Live AI" : "Offline estimate"}</span>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d", marginBottom: 4 }}>✓ AI audit complete</div>
      <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 10, flexWrap: "wrap" }}>
        {p.filesTotal != null && <span><b>{p.filesTotal}</b> files analysed</span>}
        {total > 1 && <span><b>{total}</b> batch{total !== 1 ? "es" : ""}</span>}
        <span>{p.auditLive ? "Live AI" : "Offline estimate"}</span>
      </div>
    </div>
  );
}

function SaveStepDetail({ p, isActive }: { p: AuditProgressState; isActive: boolean }) {
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };
  const lines = p.linesAssessed ?? 0;
  const issues = p.findingsDetected ?? 0;
  if (isActive) {
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>💾 Saving AI verdicts to your checklist<Dots /></div>
        <div style={{ ...muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {lines > 0 && <span><b>{lines}</b> checklist line{lines !== 1 ? "s" : ""} assessed</span>}
          {issues > 0 && <span style={{ color: "#b45309" }}><b>{issues}</b> potential gap{issues !== 1 ? "s" : ""} flagged</span>}
        </div>
        <div style={{ ...muted, marginTop: 4 }}>Verdicts will appear in the Sub-Criterion Checklist once this step completes.</div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d", marginBottom: 4 }}>✓ Verdicts saved</div>
      <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 10, flexWrap: "wrap" }}>
        {lines > 0 && <span><b>{lines}</b> checklist line{lines !== 1 ? "s" : ""}</span>}
        {issues > 0 ? <span style={{ color: "#b45309" }}><b>{issues}</b> potential issue{issues !== 1 ? "s" : ""}</span> : lines > 0 ? <span style={{ color: "#15803d" }}>No issues flagged</span> : null}
      </div>
    </div>
  );
}

function CompleteDetail({ p }: { p: AuditProgressState }) {
  const lines = p.linesAssessed ?? 0;
  const issues = p.findingsDetected ?? 0;
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };

  // File summary stats
  const files = p.filesFound ?? [];
  const totalFound = files.length;
  const totalRead = files.filter((f) => f.readStatus === "read" || f.readStatus === "condensed").length;
  const totalSkipped = files.filter((f) => f.readStatus === "skipped").length;
  const totalFailed = files.filter((f) => f.readStatus === "failed").length;
  const totalCited = files.filter((f) => f.auditStatus === "cited").length;
  const totalNotUsed = files.filter((f) => f.auditStatus === "not_used").length;

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 8 }}>Audit finished successfully!</div>
      <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, fontSize: 12.5, color: "#166534", display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
        {lines > 0 && <span>✓ <b>{lines}</b> checklist line{lines !== 1 ? "s" : ""} assessed</span>}
        {issues > 0 ? <span>⚠ <b>{issues}</b> potential issue{issues !== 1 ? "s" : ""} flagged</span> : lines > 0 ? <span>✓ No issues flagged</span> : null}
      </div>
      {totalFound > 0 && (
        <div style={{ padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11.5, color: "#374151", display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <span><b>{totalFound}</b> files found</span>
          {totalRead > 0 && <span style={{ color: "#15803d" }}><b>{totalRead}</b> read</span>}
          {totalCited > 0 && <span style={{ color: "#0369a1" }}><b>{totalCited}</b> cited by AI</span>}
          {totalNotUsed > 0 && <span style={{ color: "#6b7280" }}><b>{totalNotUsed}</b> not used</span>}
          {totalSkipped > 0 && <span><b>{totalSkipped}</b> skipped</span>}
          {totalFailed > 0 && <span style={{ color: "#b91c1c" }}><b>{totalFailed}</b> failed</span>}
        </div>
      )}
      <div style={muted}>Check the Sub-Criterion Checklist to review verdicts and evidence.</div>
    </div>
  );
}

function ErrorDetail({ p }: { p: AuditProgressState }) {
  const filesFound = p.filesFound?.length ?? 0;
  const filesRead = p.filesRead ?? 0;
  const linesAssessed = p.linesAssessed ?? 0;
  const partialSaved = linesAssessed > 0;

  // Detect which step failed from what was completed before the error
  let failedStep: string;
  let guidance: string;
  if (filesFound === 0 && filesRead === 0) {
    failedStep = "Connecting to Google Drive";
    guidance = "Check that your Google Drive is still connected (Settings → Google Drive) and that the folder link is correct. If the folder is in a Shared Drive, make sure your Google account has at least Viewer access.";
  } else if (filesRead === 0 || (p.filesTotal != null && filesRead < p.filesTotal)) {
    failedStep = "Reading evidence files";
    guidance = "One or more files could not be read. Password-protected PDFs and unsupported file types are skipped automatically — this error usually means a network issue or an unusually large file. Try running the audit again; the folder will be re-scanned from the beginning.";
  } else {
    failedStep = "Asking AI to assess";
    guidance = "The AI call timed out or was rejected. Check your OpenAI key in Settings → AI Settings (key must start with 'sk-'). If the folder has more than 15–20 files, try reducing it to the most relevant ones — smaller folders complete faster and are less likely to time out.";
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#b23121", marginBottom: 6 }}>
        Audit stopped — error during: <span style={{ fontWeight: 400, fontStyle: "italic" }}>{failedStep}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#7f1d1d", background: "#fef2f2", borderRadius: 8, padding: "8px 12px", lineHeight: 1.6, marginBottom: 8 }}>
        {p.errorMessage || "An unexpected error occurred."}
      </div>
      {partialSaved ? (
        <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
          ✓ <b>{linesAssessed}</b> checklist verdict{linesAssessed !== 1 ? "s" : ""} were saved before the error — those results are kept in the checklist.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
          No checklist verdicts were saved — you can safely run the audit again once the issue is fixed.
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#374151" }}>
        <b>What to do:</b> {guidance}
      </div>
    </div>
  );
}

function StepDetail({ step, p, onSkipFile }: { step: number; p: AuditProgressState; onSkipFile?: () => void }) {
  const currentStep = stageToVisualStep(p.stage);
  const isActive = step === currentStep;
  const isError = p.stage === "error";
  if (isError && step === currentStep) return <ErrorDetail p={p} />;
  switch (step) {
    case 0: return <ConnectDetail p={p} isActive={isActive} />;
    case 1: return <ReadFilesDetail p={p} isActive={isActive} onSkipFile={onSkipFile} />;
    case 2: return <AuditStepDetail p={p} isActive={isActive} />;
    case 3: return <SaveStepDetail p={p} isActive={isActive} />;
    case 4: return <CompleteDetail p={p} />;
    default: return null;
  }
}

const STUCK_THRESHOLD_MS = 60_000; // warn after 60s of no heartbeat on same file

function AuditProgressModal({
  progress,
  onClose,
  onCancel,
  onSkipFile,
}: {
  progress: AuditProgressState;
  onClose: () => void;
  onCancel: () => void;
  onSkipFile: () => void;
}) {
  const pct = stageProgress(progress);
  const isError = progress.stage === "error";
  const isDone = progress.stage === "complete";
  const isRunning = !isDone && !isError;
  const currentStep = stageToVisualStep(progress.stage);

  // selectedStep: null = auto-follow active step; number = user has pinned a step
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  // Auto-advance: when currentStep moves forward and user hasn't pinned, follow it
  const prevCurrentStep = useRef(currentStep);
  useEffect(() => {
    if (prevCurrentStep.current !== currentStep) {
      prevCurrentStep.current = currentStep;
      setSelectedStep(null); // clear pin, follow new active step
    }
  }, [currentStep]);

  // Stuck guard: check heartbeat every 5s; show warning if >60s with no update.
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    if (!isRunning) { setIsStuck(false); return; }
    const check = () => {
      const hb = progress.lastHeartbeatAt;
      setIsStuck(hb != null && Date.now() - hb > STUCK_THRESHOLD_MS);
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [isRunning, progress.lastHeartbeatAt]);

  // Close confirmation: ask before dismissing a running audit.
  const handleClose = () => {
    if (isRunning) {
      if (window.confirm("The audit is still running. Cancel it and close?")) {
        onCancel();
        onClose();
      }
    } else {
      onClose();
    }
  };

  const displayStep = selectedStep ?? currentStep;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <style>{MODAL_KEYFRAMES}</style>
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 560, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{isRunning ? "Running folder audit" : isDone ? "Audit complete" : "Audit stopped"}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {progress.folderName}
              {progress.overallTotal && progress.overallCurrent != null && (
                <span style={{ marginLeft: 8, background: "#f1f5f9", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
                  Folder {progress.overallCurrent} of {progress.overallTotal}
                </span>
              )}
            </div>
          </div>
          {/* Cancel button — always shown while running; becomes X when done/error */}
          {isRunning ? (
            <button
              onClick={onCancel}
              title="Stop the audit and close. Files read so far are not saved."
              style={{ cursor: "pointer", border: "1px solid #fca5a5", background: "#fff5f5", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: "#b23121", padding: "5px 12px", whiteSpace: "nowrap", marginLeft: 8 }}
            >
              Cancel audit
            </button>
          ) : (
            <button onClick={handleClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 20, color: "#94a3b8", lineHeight: 1, padding: "0 0 0 8px", marginTop: -2 }}>×</button>
          )}
        </div>

        {/* Stuck warning */}
        {isStuck && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#9a3412", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span>
            <span>This file has been reading for over 60 seconds — it may be stuck. Click <b>Skip file</b> to move on, or <b>Cancel audit</b> to stop.</span>
          </div>
        )}

        {/* Horizontal step flow — completed and active steps are clickable */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, padding: "0 4px" }}>
          {VISUAL_STEPS.map((step, i) => {
            const status: "done" | "active" | "future" | "error" =
              isError && i === currentStep ? "error" :
              isDone ? "done" :
              i < currentStep ? "done" :
              i === currentStep ? "active" : "future";
            const isClickable = status !== "future";
            const isSelected = i === displayStep;
            return (
              <Fragment key={i}>
                <div
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 60, cursor: isClickable ? "pointer" : "default" }}
                  onClick={() => { if (isClickable) setSelectedStep(i === selectedStep ? null : i); }}
                  title={isClickable ? `View ${step.label} details` : undefined}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                    background:
                      status === "done" ? "#dcfce7" :
                      status === "active" ? "#2563eb" :
                      status === "error" ? "#fee2e2" : "#f1f5f9",
                    color:
                      status === "done" ? "#15803d" :
                      status === "active" ? "#fff" :
                      status === "error" ? "#b23121" : "#cbd5e1",
                    transition: "background 0.4s, color 0.4s",
                    animation: status === "active" ? "audit-pulse-ring 2s ease-in-out infinite" : "none",
                    outline: isSelected ? "2px solid #3b82f6" : "none",
                    outlineOffset: 3,
                  }}>
                    {status === "done" ? "✓" : step.emoji}
                  </div>
                  <span style={{
                    fontSize: 10.5, textAlign: "center", lineHeight: 1.2,
                    fontWeight: isSelected ? 700 : status === "active" ? 600 : 400,
                    color: isSelected ? "#2563eb" : status === "active" ? "#2563eb" : status === "done" ? "#16a34a" : "#94a3b8",
                  }}>{step.label}</span>
                </div>
                {i < VISUAL_STEPS.length - 1 && (
                  <div style={{ color: i < currentStep ? "#86efac" : "#e2e8f0", fontSize: 18, padding: "0 2px", marginBottom: 18, flexShrink: 0 }}>→</div>
                )}
              </Fragment>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={{ background: "#f1f5f9", borderRadius: 6, height: 6, overflow: "hidden", marginBottom: 18 }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 6,
            background: isError ? "#ef4444" : isDone ? "#22c55e" : "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
            backgroundSize: "200% 100%",
            transition: "width 0.5s ease",
            animation: !isDone && !isError ? "audit-shimmer 2s linear infinite" : "none",
          }} />
        </div>

        {/* Per-step detail panel */}
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", minHeight: 80 }}>
          {selectedStep !== null && selectedStep !== currentStep && (
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 6 }}>
              {VISUAL_STEPS[selectedStep].emoji} {VISUAL_STEPS[selectedStep].label} — click the active step to return to live view
            </div>
          )}
          <StepDetail step={displayStep} p={progress} onSkipFile={progress.canSkipCurrentFile ? onSkipFile : undefined} />
        </div>

        {/* Done / error button */}
        {(isDone || isError) && (
          <button
            onClick={onClose}
            style={{ marginTop: 16, cursor: "pointer", width: "100%", padding: "10px", borderRadius: 10, border: "none", background: isError ? "#fee2e2" : "#dcfce7", color: isError ? "#b23121" : "#15803d", fontWeight: 700, fontSize: 13 }}
          >
            {isError ? "Dismiss" : "View results →"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];
const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

export function EvidenceFolder() {
  const folders = useWorkspaceStore((s) => s.folders);
  const departments = useWorkspaceStore((s) => s.departments);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const checkFolderAccess = useWorkspaceStore((s) => s.checkFolderAccess);
  const auditFolderContents = useWorkspaceStore((s) => s.auditFolderContents);
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);
  const skipCurrentFile = useWorkspaceStore((s) => s.skipCurrentFile);
  const busy = useWorkspaceStore((s) => s.busy);
  const additionalInfo = useWorkspaceStore((s) => s.additionalInfo);
  const setAdditionalInfoLink = useWorkspaceStore((s) => s.setAdditionalInfoLink);
  const checkAdditionalInfoAccess = useWorkspaceStore((s) => s.checkAdditionalInfoAccess);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const activeAuditorId = useWorkspaceStore((s) => s.activeAuditorId);
  const setActiveAuditor = useWorkspaceStore((s) => s.setActiveAuditor);
  const auditProgress = useWorkspaceStore((s) => s.auditProgress);
  const clearAuditProgress = useWorkspaceStore((s) => s.clearAuditProgress);
  const [checkingAdditional, setCheckingAdditional] = useState(false);

  const effectiveAuditor =
    auditors.find((a) => a.id === activeAuditorId) || auditors.find((a) => a.role === "Audit Lead") || auditors[0];

  const [searchParams] = useSearchParams();
  const focusSub = searchParams.get("sub");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (!focusSub) return;
    const row = rowRefs.current[focusSub];
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.style.transition = "background 0.3s";
    row.style.background = "#fff7e0";
    const t = setTimeout(() => {
      row.style.background = "";
    }, 2200);
    return () => clearTimeout(t);
  }, [focusSub, folders]);

  const [critFilter, setCritFilter] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const criteria = useMemo(() => [...new Set(folders.map((f) => f.subCriterionId.split(".")[0]))].sort((a, b) => Number(a) - Number(b)), [folders]);
  const subCriteria = useMemo(
    () => folders.filter((f) => !critFilter || f.subCriterionId.split(".")[0] === critFilter).map((f) => ({ id: f.subCriterionId, name: f.folderName })),
    [folders, critFilter]
  );
  const visibleFolders = folders.filter(
    (f) => (!critFilter || f.subCriterionId.split(".")[0] === critFilter) && (!subFilter || f.subCriterionId === subFilter)
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);

  // Dismiss keys include a timestamp so a new run auto-un-dismisses
  const [dismissedAccessNotes, setDismissedAccessNotes] = useState<Set<string>>(new Set());
  const [dismissedAuditResults, setDismissedAuditResults] = useState<Set<string>>(new Set());

  const dismissAccessNote = (key: string) => setDismissedAccessNotes((s) => new Set([...s, key]));
  const dismissAuditResult = (key: string) => setDismissedAuditResults((s) => new Set([...s, key]));

  // Close overflow on outside click
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(`overflow-${overflowOpen}`);
      if (el && !el.contains(e.target as Node)) setOverflowOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  return (
    <>
    {auditProgress && (
      <AuditProgressModal
        progress={auditProgress}
        onClose={clearAuditProgress}
        onCancel={() => { cancelBusy(); clearAuditProgress(); }}
        onSkipFile={skipCurrentFile}
      />
    )}
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Evidence folder index</h3>
        <button onClick={() => setShowHelp((h) => !h)} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 8px", color: "#6b7280" }}>
          {showHelp ? "Hide help" : "Show help"}
        </button>
      </div>
      {showHelp && (
        <>
          <p style={{ fontSize: 12.5, color: "#6b7280" }}>
            One evidence folder per GD4 sub-criterion. All folders live in Google Drive — the owning department is set up on the Audit Cycle page.
            "Check access" (in the row action menu) confirms this app can see the folder's files (including subfolders). "Run audit" does the whole pipeline in one click:
            it generates the Sub-Criterion Checklist lines if none exist yet, reads every supported file (PDF, Word, text/CSV, and images via AI),
            sets each line's status, and updates the band/score — shown in the result block below the row. To audit every linked folder at once, use
            "Audit all folders → score" on the Dashboard. Both require connecting Google Drive in Settings first.
          </p>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", background: "#f8fafc", marginBottom: 10, fontSize: 12 }}>
            <b style={{ fontSize: 11.5, color: "#475569" }}>Link two folders per sub-criterion, using the Links column below:</b>
            <ol style={{ margin: "4px 0 4px", paddingLeft: 18, color: "#475569" }}>
              <li><b>Policy &amp; Procedure</b> — the documented approach</li>
              <li><b>Actual Evidence</b> — records showing it is implemented</li>
            </ol>
            <span style={{ color: "#6b7280" }}>
              "Run audit" reads both folders and reports a per-type breakdown. (If you only link one, the audit still works and falls back to reading subfolders named "Policy"/"Procedure" inside it.) General, school-wide documents that aren't tied to one sub-criterion go in the <b>Additional info</b> folder below. Omit NRIC/FIN details before uploading.
            </span>
          </div>
        </>
      )}

      <div style={{ border: "1px solid #d8c7a4", borderRadius: 10, padding: "10px", background: "#fffaf0", marginTop: 16, marginBottom: 12, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <b style={{ fontSize: 12, color: "#7a5b12" }}>Additional info — general supporting documents (school-wide, applies to all criteria)</b>
          {additionalInfo.accessStatus && <Pill s={ACCESS_TONE[additionalInfo.accessStatus]}>{additionalInfo.accessStatus}</Pill>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
          <input
            placeholder="https://drive.google.com/drive/folders/…"
            value={additionalInfo.link || ""}
            onChange={(e) => setAdditionalInfoLink(e.target.value)}
            style={{ ...inputStyle, width: 280, padding: "4px 6px" }}
          />
          {additionalInfo.link && <a href={additionalInfo.link} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>Open</a>}
          <button
            disabled={checkingAdditional}
            onClick={async () => {
              setCheckingAdditional(true);
              try { await checkAdditionalInfoAccess(); } finally { setCheckingAdditional(false); }
            }}
            style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
          >
            {checkingAdditional ? "Checking…" : "Check access"}
          </button>
        </div>
        {additionalInfo.accessNote && (
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
            {additionalInfo.accessNote}{additionalInfo.accessAt && <span style={{ color: "#94a3b8" }}> — checked {new Date(additionalInfo.accessAt).toLocaleString()}</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Filter</span>
        <select
          value={critFilter}
          onChange={(e) => { setCritFilter(e.target.value); setSubFilter(""); }}
          style={{ ...inputStyle, width: 150, padding: "5px 6px" }}
        >
          <option value="">All criteria</option>
          {criteria.map((c) => <option key={c} value={c}>Criterion {c}</option>)}
        </select>
        <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} style={{ ...inputStyle, width: 230, padding: "5px 6px" }}>
          <option value="">All sub-criteria</option>
          {subCriteria.map((s) => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
        </select>
        {(critFilter || subFilter) && (
          <button onClick={() => { setCritFilter(""); setSubFilter(""); }} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px" }}>
            Clear
          </button>
        )}
        <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>
          Showing {visibleFolders.length} of {folders.length}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Run audit as</span>
        {auditors.length === 0 ? (
          <span style={{ fontSize: 12, color: "#b23121" }}>
            No auditors yet — add one on <Link to="/auditors" style={{ color: "#2563eb" }}>Auditor Creation</Link> so audits are attributed to a person.
          </span>
        ) : (
          <>
            <select
              value={activeAuditorId || effectiveAuditor?.id || ""}
              onChange={(e) => setActiveAuditor(e.target.value || null)}
              style={{ ...inputStyle, width: 230, padding: "5px 6px" }}
            >
              {auditors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role} (strictness {a.strictness})
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
              The named auditor owns the result; their strictness drives how hard the AI judges.
            </span>
          </>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Sub-criterion</th><th>Owner</th><th>Status</th><th>Links</th><th>Action</th></tr>
        </thead>
        <tbody>
          {visibleFolders.map((f) => {
            const isBusy = busy === "folderaudit" + f.id;
            const auditDismissKey = `${f.id}:${f.lastAuditRunId || f.lastAuditAt || ""}`;
            const policyDismissKey = `${f.id}:policy:${f.policyAccessAt || ""}`;
            const evidenceDismissKey = `${f.id}:evidence:${f.accessCheckAt || ""}`;
            return (
              <Fragment key={f.id}>
                <tr className="rowh" ref={(el) => { rowRefs.current[f.subCriterionId] = el; }}>
                  <td><b>{f.folderName}</b></td>
                  <td>
                    <select value={f.owner} onChange={(e) => setFolderField(f.id, "owner", e.target.value)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                      <option value="">(unassigned)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.acronym}>{d.acronym}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={f.status} onChange={(e) => setFolderField(f.id, "status", e.target.value as FolderStatus)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {/* Policy link row */}
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", minWidth: 52, textTransform: "uppercase", letterSpacing: 0.3 }}>Policy</span>
                        <input
                          placeholder="Policy folder link…"
                          value={f.policyLink || ""}
                          onChange={(e) => setFolderField(f.id, "policyLink", e.target.value)}
                          style={{ ...inputStyle, width: 140, padding: "3px 5px", fontSize: 11 }}
                        />
                        {f.policyLink && <a href={f.policyLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#3b82f6" }}>↗</a>}
                        {f.policyAccessStatus && (
                          <Pill s={ACCESS_TONE[f.policyAccessStatus]}>{f.policyAccessStatus}</Pill>
                        )}
                      </div>
                      {/* Evidence link row */}
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", minWidth: 52, textTransform: "uppercase", letterSpacing: 0.3 }}>Evidence</span>
                        <input
                          placeholder="Evidence folder link…"
                          value={f.folderLink || ""}
                          onChange={(e) => setFolderField(f.id, "folderLink", e.target.value)}
                          style={{ ...inputStyle, width: 140, padding: "3px 5px", fontSize: 11 }}
                        />
                        {f.folderLink && <a href={f.folderLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#16a34a" }}>↗</a>}
                        {f.accessCheckStatus && (
                          <Pill s={ACCESS_TONE[f.accessCheckStatus]}>{f.accessCheckStatus}</Pill>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {isBusy ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button
                          disabled
                          style={{ cursor: "wait", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1d4ed8", whiteSpace: "nowrap", opacity: 0.8 }}
                        >
                          Auditing…
                        </button>
                        <button
                          onClick={cancelBusy}
                          title="Stop waiting and release the button. Any in-flight request finishes in the background."
                          style={{ cursor: "pointer", fontSize: 11, padding: "6px 9px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff", color: "#b23121", whiteSpace: "nowrap" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button
                          onClick={() => auditFolderContents(f.id)}
                          style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #3b82f6", background: "#2563eb", color: "#fff", whiteSpace: "nowrap" }}
                        >
                          Run audit
                        </button>
                        {/* Overflow menu for secondary actions */}
                        <div id={`overflow-${f.id}`} style={{ position: "relative" }}>
                          <button
                            onClick={() => setOverflowOpen(overflowOpen === f.id ? null : f.id)}
                            title="More actions"
                            style={{ cursor: "pointer", fontSize: 13, padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", lineHeight: 1 }}
                          >
                            ⋯
                          </button>
                          {overflowOpen === f.id && (
                            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 14px #0002", zIndex: 30, minWidth: 188, overflow: "hidden" }}>
                              <button
                                disabled={busy === `folderaccess:policy:${f.id}`}
                                onClick={() => { checkFolderAccess(f.id, "policy"); setOverflowOpen(null); }}
                                style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", fontSize: 12, padding: "8px 12px", border: "none", background: "transparent", color: "#374151", borderBottom: "1px solid #f1f5f9" }}
                              >
                                {busy === `folderaccess:policy:${f.id}` ? "Checking…" : "Check policy access"}
                              </button>
                              <button
                                disabled={busy === `folderaccess:evidence:${f.id}`}
                                onClick={() => { checkFolderAccess(f.id, "evidence"); setOverflowOpen(null); }}
                                style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", fontSize: 12, padding: "8px 12px", border: "none", background: "transparent", color: "#374151" }}
                              >
                                {busy === `folderaccess:evidence:${f.id}` ? "Checking…" : "Check evidence access"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Same-folder warning */}
                {f.policyLink && f.folderLink && f.policyLink === f.folderLink && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 8px 28px" }}>
                      <div style={{ background: "#fff7ed", borderLeft: "3px solid #fb923c", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12, color: "#9a3412" }}>
                        ⚠ The <b>Policy &amp; Procedure</b> and <b>Actual Evidence</b> links point to the <b>same folder</b>. The audit will read it once (not twice), but a proper audit needs two different folders — one of policies, one of actual records — so implementation can be verified separately from the documented approach.
                      </div>
                    </td>
                  </tr>
                )}

                {/* Policy access note (dismissible) */}
                {f.policyAccessNote && !dismissedAccessNotes.has(policyDismissKey) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 6px 28px" }}>
                      <div style={{ background: "#f8fafc", borderLeft: "3px solid #93c5fd", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.4 }}>Access check — policy</span>
                          <Pill s={ACCESS_TONE[f.policyAccessStatus || "Not Connected"]}>{f.policyAccessStatus || "Not Connected"}</Pill>
                          {f.policyAccessAt && (
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.policyAccessAt).toLocaleString()}</span>
                          )}
                          <button
                            onClick={() => dismissAccessNote(policyDismissKey)}
                            title="Dismiss"
                            style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                          >
                            ✕
                          </button>
                        </div>
                        <div style={{ color: "#475569", lineHeight: 1.5 }}>{f.policyAccessNote}</div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Evidence access note (dismissible) */}
                {f.accessCheckNote && !dismissedAccessNotes.has(evidenceDismissKey) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 6px 28px" }}>
                      <div style={{ background: "#f8fafc", borderLeft: "3px solid #86efac", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: 0.4 }}>Access check — evidence</span>
                          <Pill s={ACCESS_TONE[f.accessCheckStatus || "Not Connected"]}>{f.accessCheckStatus || "Not Connected"}</Pill>
                          {f.accessCheckAt && (
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.accessCheckAt).toLocaleString()}</span>
                          )}
                          <button
                            onClick={() => dismissAccessNote(evidenceDismissKey)}
                            title="Dismiss"
                            style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                          >
                            ✕
                          </button>
                        </div>
                        <div style={{ color: "#475569", lineHeight: 1.5 }}>{f.accessCheckNote}</div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Audit result (dismissible) */}
                {f.lastAuditSummary && !dismissedAuditResults.has(auditDismissKey) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 10px 28px" }}>
                      <div style={{ background: "#f0fdf4", borderLeft: "3px solid #86c79f", borderRadius: "0 8px 8px 0", padding: "10px 12px", fontSize: 12 }}>
                        {/* Header row: label + pills + dismiss */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: 0.4 }}>Combined audit — policy &amp; evidence</span>
                          <Pill s={f.lastAuditLive ? "progress" : "medium"}>{f.lastAuditLive ? "AI" : "Offline estimate"}</Pill>
                          {f.lastAuditLive === false && f.lastAuditError && (
                            <span style={{ color: "#9a6b15", fontSize: 11 }} title={f.lastAuditError}>AI unavailable — used keyword fallback</span>
                          )}
                          <button
                            onClick={() => dismissAuditResult(auditDismissKey)}
                            title="Dismiss result block (data is kept)"
                            style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                          >
                            ✕
                          </button>
                        </div>
                        {/* Key metadata row */}
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 7, padding: "5px 8px", background: "#fff", borderRadius: 6, border: "1px solid #dcfce7" }}>
                          {f.lastAuditRunId && (
                            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#374151", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 5, padding: "1px 6px" }} title="Audit run ID — stamped on checklist evidence and the AI Review Log.">{f.lastAuditRunId}</span>
                          )}
                          {f.lastAuditAuditor && (
                            <span style={{ fontSize: 11.5, color: "#374151" }}>
                              <span style={{ color: "#6b7280" }}>Auditor:</span> <b>{f.lastAuditAuditor}</b>
                            </span>
                          )}
                          {f.lastAuditAt && (
                            <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
                              Audited {new Date(f.lastAuditAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {/* Summary text */}
                        <div style={{ color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                          {f.lastAuditSummary.length > SUMMARY_CAP && !expanded[f.id]
                            ? `${f.lastAuditSummary.slice(0, SUMMARY_CAP)}…`
                            : f.lastAuditSummary}
                        </div>
                        {/* Footer: expand + link */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                          {f.lastAuditSummary.length > SUMMARY_CAP && (
                            <button
                              onClick={() => setExpanded((e) => ({ ...e, [f.id]: !e[f.id] }))}
                              style={{ cursor: "pointer", border: "none", background: "transparent", color: "#2563eb", fontSize: 11.5, padding: 0, textDecoration: "underline" }}
                            >
                              {expanded[f.id] ? "Show less" : "Show full result"}
                            </button>
                          )}
                          <Link to={`/sub-checklist?item=${f.subCriterionId}.1`} style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>
                            → Sub-Criterion Checklist
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
    </>
  );
}
