import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { RunModeBanner } from "../components/ui/RunModeBanner";
import type { FolderProbeResult } from "../lib/driveGuard";
import { Pill } from "../components/ui/Pill";
import { ExtractedTextPanel } from "../components/ui/ExtractedTextPanel";
import { PreAnalysisChecklistPanel } from "../components/ui/PreAnalysisChecklistPanel";
import { hasChecklist } from "../lib/preAnalysisChecklist";
import type { AuditFileRecord, AuditProgressState, AuditRunRecord, AuditScope, FolderStatus } from "../types";
import { downloadCsv, exportFileLedgerCsv, exportAISummaryCsv, auditCsvFilename, progressToRunRecord } from "../lib/auditCsvExport";
import { domainExpertiseLabelFor } from "../data/skills/domainExpertise";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { PpdReviewContent, HybridGatePanel, ResultNavLinks } from "./PPDReview";
import { useScored } from "../hooks/useScored";
import { AUDIT_MODES, auditModeLabel } from "../lib/runModes";
import { TONE } from "../lib/theme";
import type { FullAuditEntry } from "../lib/fullAudit";
import { resolveAnalysisPath } from "../lib/fullAudit";
import { NextStepBanner, Walkthrough, WalkthroughLink, useTip, DismissX } from "../components/ui/Guidance";
import { nextStepText } from "../lib/guidanceText";
import { runAuditorDisplay, panelUnderMinNotice, MSG_NO_AUDITORS_EXIST, AUDITOR_CREATION_PATH } from "../lib/auditorGuard";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { DRIVE_CONNECT_PATH, driveReadFailureMessage, classifyDriveReadError } from "../lib/driveGuard";

const SUMMARY_CAP = 320;

// ── Shared styles ──────────────────────────────────────────────────────────

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
@keyframes ef-spin {
  to { transform: rotate(360deg); }
}
`;

// Small inline spinner for lightweight "working…" states (e.g. the pre-flight
// folder check), so an in-progress action never looks frozen.
function Spinner({ size = 14, color = "#64748b" }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: size, height: size, flexShrink: 0, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: "50%", animation: "ef-spin 0.7s linear infinite" }}
    />
  );
}

// "Pre-check" has no backing AuditProgressStage of its own — the staged audit
// runs reading straight into the AI passes with no real pause, and this step
// must stay non-blocking (never gate the real pipeline). It is a purely
// presentational slot: `alwaysViewable` keeps it clickable at ANY point in the
// run (even mid-"Read files") so the checklist can be reviewed whenever, and
// stageToVisualStep below simply never targets index 2 as "active" — the dot
// shows pending while reading is in progress and flips straight to done once
// the real engine has moved into the AI stage, same as a skipped-but-available
// step. See PreCheckStepDetail.
const VISUAL_STEPS = [
  { emoji: "🔌", label: "Connect", alwaysViewable: false },
  { emoji: "📂", label: "Read files", alwaysViewable: false },
  { emoji: "📝", label: "Pre-check", alwaysViewable: true },
  { emoji: "🤖", label: "Ask AI", alwaysViewable: false },
  { emoji: "💾", label: "Save", alwaysViewable: false },
  { emoji: "✅", label: "Complete", alwaysViewable: false },
] as const;

function stageToVisualStep(stage: AuditProgressState["stage"]): number {
  switch (stage) {
    case "listing":    return 0;
    case "reading":
    case "condensing": return 1;
    case "auditing":
    case "policy_audit":
    case "evidence_audit":
    case "outcome_review":
    case "apsr_build":   return 3;
    case "findings_summary":
    case "saving":       return 4;
    case "complete":     return 5;
    case "error":        return -1;
  }
}

// Human-readable label for the staged-audit stage — shown in the Full-auto
// overlay's "current sub-criterion detail" so the user watches the same steps
// the standalone AuditProgressModal shows, without a second modal.
function stageLabel(stage: AuditProgressState["stage"]): string {
  switch (stage) {
    case "listing": return "Listing Drive folder";
    case "reading": return "Reading & extracting files";
    case "condensing": return "Condensing large documents";
    case "auditing": return "AI assessment";
    case "policy_audit": return "Policy pass (Approach)";
    case "evidence_audit": return "Evidence pass (Processes)";
    case "outcome_review": return "Outcome & review pass";
    case "apsr_build": return "Building APSR verdicts";
    case "findings_summary": return "Summarising findings";
    case "saving": return "Committing verdicts";
    case "complete": return "Complete";
    case "error": return "Error";
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
    case "policy_audit":   return 50;
    case "evidence_audit": return 62;
    case "outcome_review": return 74;
    case "apsr_build":     return 82;
    case "findings_summary": return 86;
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

// ── File list components ───────────────────────────────────────────────────

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

function ProcessingModeBadge({ file }: { file: AuditFileRecord }) {
  if (!file.processingMode) return null;
  const badge =
    file.processingMode === "reused"  ? { label: "♻ Cached",  color: "#7c3aed", bg: "#faf5ff" } :
    file.processingMode === "changed" ? { label: "↻ Changed", color: "#b45309", bg: "#fffbeb" } :
                                        null;
  if (!badge) return null;
  return (
    <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 3, background: badge.bg, color: badge.color, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
      {badge.label}
    </span>
  );
}

function ReadMethodBadge({ file }: { file: AuditFileRecord }) {
  if (!file.readMethod) return null;
  const badge =
    file.readMethod === "vision"
      ? { label: "👁 Vision", color: "#7c2d12", bg: "#fff7ed", title: "Read by transcribing the image/scan with the vision model" }
      : { label: "🔤 Text", color: "#334155", bg: "#f1f5f9", title: "Read by direct text extraction" };
  return (
    <span title={badge.title} style={{ fontSize: 9, padding: "0 4px", borderRadius: 3, background: badge.bg, color: badge.color, fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
      {badge.label}
    </span>
  );
}

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

type FileFilter = "all" | "read" | "cited" | "not_used" | "skipped" | "failed" | "new" | "changed" | "reused";
type FileSort = "name" | "status" | "type";

function FileRow({ file, isReading, onSkipFile, resolveText }: { file: AuditFileRecord; isReading?: boolean; onSkipFile?: () => void; resolveText?: (f: AuditFileRecord) => string | null | undefined }) {
  const bucketLabel = file.bucket === "policy" ? "Policy" : file.bucket === "evidence" ? "Evid" : "Auto";
  const bucketColor = file.bucket === "policy" ? "#1d4ed8" : file.bucket === "evidence" ? "#15803d" : "#9ca3af";
  const [open, setOpen] = useState(false);
  // Expandable only for files that were actually read/skipped/failed — a file
  // still being read has nothing to show yet.
  const canExpand = !!resolveText && !isReading && file.readStatus !== "found" && file.readStatus !== "reading";
  return (
    <>
      <div
        onClick={canExpand ? () => setOpen((o) => !o) : undefined}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderBottom: open ? "none" : "1px solid #f1f5f9", fontSize: 11, background: isReading ? "#fffbeb" : open ? "#fbfcfe" : undefined, cursor: canExpand ? "pointer" : undefined }}
      >
        <span style={{ width: 10, flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{canExpand ? (open ? "▾" : "▸") : ""}</span>
        <span style={{ fontSize: 9, color: bucketColor, background: bucketColor + "18", borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>{bucketLabel}</span>
        <span style={{ flex: 1, color: isReading ? "#92400e" : "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isReading ? 600 : undefined }} title={file.path}>{file.name}</span>
        {isReading && <span style={{ fontSize: 9, color: "#92400e", flexShrink: 0 }}>reading…</span>}
        <span style={{ color: "#94a3b8", flexShrink: 0, fontSize: 9.5 }}>{file.fileKind}</span>
        {file.charCount != null && <span style={{ color: "#94a3b8", flexShrink: 0, fontSize: 9.5 }}>{file.charCount.toLocaleString()}c</span>}
        {file.suspectedScannedPdf && (
          <span style={{ fontSize: 9, padding: "0 3px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontWeight: 600, flexShrink: 0 }} title="Suspected scanned PDF">Scan?</span>
        )}
        {file.extractedTextQuality && file.extractedTextQuality !== "high" && !file.suspectedScannedPdf && (
          <span style={{ fontSize: 9, padding: "0 3px", borderRadius: 3, background: "#f1f5f9", color: "#64748b", flexShrink: 0 }}>{file.extractedTextQuality}</span>
        )}
        <ReadMethodBadge file={file} />
        <ProcessingModeBadge file={file} />
        <DimIcons file={file} />
        <FileStatusBadge file={file} />
        {file.failReason && <span style={{ fontSize: 9.5, color: "#b91c1c", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.failReason}>{file.failReason}</span>}
        {file.skipReason && file.readStatus === "skipped" && <span style={{ fontSize: 9.5, color: "#9ca3af", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.skipReason}>{file.skipReason}</span>}
        {isReading && onSkipFile && (
          <button
            onClick={(e) => { e.stopPropagation(); onSkipFile(); }}
            title="Abort reading this file and move on to the next one"
            style={{ cursor: "pointer", fontSize: 9.5, padding: "2px 6px", borderRadius: 4, border: "1px solid #fbbf24", background: "#fffbeb", color: "#92400e", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            Skip
          </button>
        )}
        {/* Open the exact file in Google Drive — same link pattern as the
            pre-flight list. Shown on every row regardless of status (most useful
            on Skipped / unreadable rows). stopPropagation so it never toggles
            the extracted-text expand. */}
        {file.driveFileId && (
          <a
            href={`https://drive.google.com/file/d/${file.driveFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Open "${file.name}" in Google Drive`}
            style={{ flexShrink: 0, color: "#2563eb", textDecoration: "none", fontSize: 11, padding: "0 2px", lineHeight: 1 }}
          >
            ↗
          </a>
        )}
      </div>
      {open && canExpand && <ExtractedTextPanel file={file} resolveText={resolveText} />}
    </>
  );
}

// AI-status badge for a file at the "Ask AI" step — mirrors the auditStatus
// wording used across that step (Pending / Analysed / Cited / Not used).
function aiFileBadge(file: AuditFileRecord): { label: string; color: string; bg: string } {
  switch (file.auditStatus) {
    case "cited":    return { label: "📎 Cited",    color: "#0369a1", bg: "#e0f2fe" };
    case "not_used": return { label: "— Not used",  color: "#6b7280", bg: "#f3f4f6" };
    case "audited":  return { label: "🤖 Analysed", color: "#1e40af", bg: "#eff6ff" };
    default:         return { label: "⏳ Pending",   color: "#b45309", bg: "#fffbeb" };
  }
}

// Clickable file row for the "Ask AI" step: same AI-status/chunk info as before,
// but expandable to the SAME ExtractedTextPanel used at the "Read files" step —
// so the user can inspect exactly what evidence text the AI is working from at
// the moment of analysis. `resolveText` is the shared fileTextCache lookup.
function AiFileRow({ file, resolveText, borderColor = "#eff6ff" }: { file: AuditFileRecord; resolveText: (f: AuditFileRecord) => string | null | undefined; borderColor?: string }) {
  const [open, setOpen] = useState(false);
  const badge = aiFileBadge(file);
  // Expandable when we can look up its extracted text (read via Drive → cached).
  const canExpand = !!file.driveFileId;
  const chunkCount = file.chunkIds?.length ?? 0;
  return (
    <>
      <div
        onClick={canExpand ? () => setOpen((o) => !o) : undefined}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderBottom: open ? "none" : `1px solid ${borderColor}`, fontSize: 10, cursor: canExpand ? "pointer" : "default", background: open ? "#fbfcfe" : undefined }}
      >
        <span style={{ width: 9, flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{canExpand ? (open ? "▾" : "▸") : ""}</span>
        <span style={{ flexShrink: 0, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: badge.bg, color: badge.color, fontWeight: 600 }}>{badge.label}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1e40af" }} title={file.path}>{file.name}</span>
        {chunkCount > 0 && (
          <span style={{ flexShrink: 0, fontFamily: "ui-monospace,monospace", color: "#7c3aed", fontSize: 9 }} title={`Sent to the AI as chunk${chunkCount !== 1 ? "s" : ""}: ${file.chunkIds!.join(", ")}`}>
            {chunkCount} chunk{chunkCount !== 1 ? "s" : ""}
          </span>
        )}
        <span style={{ flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{file.fileKind?.toUpperCase()}</span>
        {file.charCount != null && file.charCount > 0 && (
          <span style={{ flexShrink: 0, fontFamily: "ui-monospace,monospace", color: "#6b7280", fontSize: 9 }}>{file.charCount.toLocaleString()} ch</span>
        )}
        {/* Open the exact file in Google Drive — same pattern as the pre-flight
            list and the file ledger. stopPropagation so it never toggles expand. */}
        {file.driveFileId && (
          <a
            href={`https://drive.google.com/file/d/${file.driveFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Open "${file.name}" in Google Drive`}
            style={{ flexShrink: 0, color: "#2563eb", textDecoration: "none", fontSize: 10.5, padding: "0 2px", lineHeight: 1 }}
          >
            ↗
          </a>
        )}
      </div>
      {open && canExpand && (
        <div style={{ borderBottom: `1px solid ${borderColor}` }}>
          {chunkCount > 0 && (
            <div style={{ fontSize: 9.5, color: "#7c3aed", padding: "4px 10px 0 26px" }}>
              This file's text is sent to the AI as chunk{chunkCount !== 1 ? "s" : ""} <b>{file.chunkIds!.join(", ")}</b>.
            </div>
          )}
          <ExtractedTextPanel file={file} resolveText={resolveText} />
        </div>
      )}
    </>
  );
}

// Expandable file ledger with filter tabs, search and sort — used in the live
// audit progress modal, the read-only "View last run" modal, and (exported) the
// AI Review Log entry's Output tab for the run's per-file read detail.
export function FileLedger({
  files,
  isActive,
  progress,
  onSkipFile,
  onExportCsv,
}: {
  files: AuditFileRecord[];
  isActive?: boolean;
  progress?: AuditProgressState;
  onSkipFile?: () => void;
  onExportCsv?: () => void;
}) {
  const [filter, setFilter] = useState<FileFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<FileSort>("status");
  const [expanded, setExpanded] = useState(false);

  // Look up the actual extracted/transcribed text for a file from the cache,
  // keyed by the same fileId:modifiedTime used at read time. Single source of
  // truth — no per-run copy of the text is stored — so clearing the cache also
  // clears the viewable text for old runs (by design).
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback(
    (f: AuditFileRecord): string | null | undefined => {
      if (!f.driveFileId) return undefined;
      return fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text;
    },
    [fileTextCache]
  );

  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };

  const totalRead    = files.filter((f) => f.readStatus === "read" || f.readStatus === "condensed").length;
  const totalSkipped = files.filter((f) => f.readStatus === "skipped").length;
  const totalFailed  = files.filter((f) => f.readStatus === "failed").length;
  const totalCited   = files.filter((f) => f.auditStatus === "cited").length;
  const totalNotUsed = files.filter((f) => f.auditStatus === "not_used").length;
  const totalNew     = files.filter((f) => f.processingMode === "new").length;
  const totalChanged = files.filter((f) => f.processingMode === "changed").length;
  const totalReused  = files.filter((f) => f.processingMode === "reused").length;

  const filterTabs: { key: FileFilter; label: string; count: number }[] = [
    { key: "all",      label: "All",      count: files.length },
    { key: "read",     label: "Read",     count: totalRead },
    { key: "cited",    label: "Cited",    count: totalCited },
    { key: "not_used", label: "Not used", count: totalNotUsed },
    { key: "skipped",  label: "Skipped",  count: totalSkipped },
    { key: "failed",   label: "Failed",   count: totalFailed },
    ...(totalNew     > 0 ? [{ key: "new"     as FileFilter, label: "New",     count: totalNew }]     : []),
    ...(totalChanged > 0 ? [{ key: "changed" as FileFilter, label: "Changed", count: totalChanged }] : []),
    ...(totalReused  > 0 ? [{ key: "reused"  as FileFilter, label: "Cached",  count: totalReused }]  : []),
  ];

  const filtered = useMemo(() => {
    let out = files;
    if (filter === "read")     out = out.filter((f) => f.readStatus === "read" || f.readStatus === "condensed");
    else if (filter === "cited")    out = out.filter((f) => f.auditStatus === "cited");
    else if (filter === "not_used") out = out.filter((f) => f.auditStatus === "not_used");
    else if (filter === "skipped")  out = out.filter((f) => f.readStatus === "skipped");
    else if (filter === "failed")   out = out.filter((f) => f.readStatus === "failed");
    else if (filter === "new")      out = out.filter((f) => f.processingMode === "new");
    else if (filter === "changed")  out = out.filter((f) => f.processingMode === "changed");
    else if (filter === "reused")   out = out.filter((f) => f.processingMode === "reused");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    }
    const copy = [...out];
    if (sort === "name")   copy.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "type") copy.sort((a, b) => a.fileKind.localeCompare(b.fileKind));
    else {
      const order = ["reading", "failed", "skipped", "condensed", "read", "found"];
      const auditOrder = ["cited", "not_used", "audited", "pending"];
      copy.sort((a, b) => {
        const ai = auditOrder.indexOf(a.auditStatus);
        const bi = auditOrder.indexOf(b.auditStatus);
        if (ai !== bi) return ai - bi;
        return order.indexOf(a.readStatus) - order.indexOf(b.readStatus);
      });
    }
    return copy;
  }, [files, filter, search, sort]);

  if (files.length === 0) {
    return isActive
      ? <div style={{ fontSize: 13, color: "#374151" }}>Preparing to read files<Dots /></div>
      : <div style={muted}>No file records available.</div>;
  }

  return (
    <div>
      {isActive && progress?.currentFileName && (
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 8 }}>
          📂 Reading: <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11 }}>{progress.currentFileName}</span>
          {progress.currentFileAction && <span style={{ color: "#64748b", marginLeft: 6 }}>— {progress.currentFileAction}</span>}
          <Dots />
        </div>
      )}

      {/* Filter tabs + controls */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        {filterTabs.filter(t => t.count > 0 || t.key === "all").map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            style={{
              cursor: "pointer", fontSize: 10, padding: "2px 7px", borderRadius: 10,
              border: filter === t.key ? "1px solid #3b82f6" : "1px solid #e2e8f0",
              background: filter === t.key ? "#eff6ff" : "#f8fafc",
              color: filter === t.key ? "#1d4ed8" : "#64748b",
              fontWeight: filter === t.key ? 700 : 400,
            }}
          >
            {t.label} {t.count}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 90, padding: "2px 5px", fontSize: 10 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as FileSort)} style={{ ...inputStyle, padding: "2px 4px", fontSize: 10 }}>
            <option value="status">Sort: status</option>
            <option value="name">Sort: name</option>
            <option value="type">Sort: type</option>
          </select>
        </div>
      </div>

      {/* File list */}
      <div
        style={{
          maxHeight: expanded ? 560 : 320,
          overflowY: "auto",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          background: "#fff",
          transition: "max-height 0.2s",
        }}
      >
        {filtered.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            isReading={isActive && file.readStatus === "reading"}
            onSkipFile={isActive && file.readStatus === "reading" ? onSkipFile : undefined}
            resolveText={resolveText}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "12px", color: "#94a3b8", fontSize: 11.5, textAlign: "center" }}>
            No files match this filter.
          </div>
        )}
      </div>

      {/* "All done reading — waiting for AI step" transitional indicator */}
      {isActive && !progress?.currentFileName && files.length > 0 && totalRead === files.length && (
        <div style={{ fontSize: 12, color: "#7c3aed", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span>🧩</span>
          <span>All files read — preparing AI assessment<Dots /></span>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <div style={{ ...muted, display: "flex", gap: 8, flexWrap: "wrap", flex: 1 }}>
          <span><b>{files.length}</b> files</span>
          {totalRead > 0 && <span style={{ color: "#15803d" }}><b>{totalRead}</b> read</span>}
          {totalCited > 0 && <span style={{ color: "#0369a1" }}><b>{totalCited}</b> cited</span>}
          {totalNotUsed > 0 && <span style={{ color: "#6b7280" }}><b>{totalNotUsed}</b> not used</span>}
          {totalSkipped > 0 && <span><b>{totalSkipped}</b> skipped</span>}
          {totalFailed > 0 && <span style={{ color: "#b91c1c" }}><b>{totalFailed}</b> failed</span>}
          {totalReused > 0 && <span style={{ color: "#7c3aed" }}><b>{totalReused}</b> cached</span>}
        </div>
        {files.length > 8 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ cursor: "pointer", border: "none", background: "transparent", color: "#2563eb", fontSize: 10.5, padding: 0 }}
          >
            {expanded ? "↑ Collapse" : "↓ Expand"}
          </button>
        )}
        {onExportCsv && (
          <button
            onClick={onExportCsv}
            title="Download file ledger as CSV"
            style={{ cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
          >
            ⬇ CSV
          </button>
        )}
      </div>
    </div>
  );
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
        <div style={muted}>Folder: <b>{p.folderName}</b> · sub-criterion {p.subCriterionId}
          {p.scope && p.scope !== "both" && (
            <span style={{ marginLeft: 8, fontSize: 10, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
              {p.scope === "policy" ? "Policy only" : "Evidence only"}
            </span>
          )}
        </div>
        {domainExpertiseLabelFor(p.subCriterionId) && (
          <div style={{ ...muted, marginTop: 4 }}>🎓 Specialist lens: <b>{domainExpertiseLabelFor(p.subCriterionId)}</b></div>
        )}
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
        <div style={{ ...muted, marginTop: 4 }}>{p.filesTotal} file{p.filesTotal !== 1 ? "s" : ""} found
          {p.scope && p.scope !== "both" && (
            <span style={{ marginLeft: 8, fontSize: 10, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
              {p.scope === "policy" ? "Policy only" : "Evidence only"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ReadFilesDetail({ p, isActive, onSkipFile, onExportCsv }: { p: AuditProgressState; isActive: boolean; onSkipFile?: () => void; onExportCsv?: () => void }) {
  const files = p.filesFound ?? [];
  return (
    <>
      {p.stage === "condensing" && (
        <div style={{ fontSize: 12, color: "#7c3aed", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span>🗜️</span>
          <span>Summarising large files to fit AI context — this may take a moment<Dots /></span>
        </div>
      )}
      <FileLedger files={files} isActive={isActive} progress={p} onSkipFile={onSkipFile} onExportCsv={onExportCsv} />
    </>
  );
}

function AuditStepDetail({ p, isActive, onExportAISummary }: { p: AuditProgressState; isActive: boolean; onExportAISummary?: () => void }) {
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };
  const batch = p.batchCurrent ?? 0;
  const total = p.batchTotal ?? 1;
  const isStrict = p.stageDetail?.includes("strict") || p.stageDetail?.includes("challenge");
  const [aiFileSearch, setAiFileSearch] = useState("");
  const [aiFileSort, setAiFileSort] = useState<"name" | "status" | "size">("name");
  // Same extracted-text lookup the "Read files" step uses, so a file at the
  // "Ask AI" step can be expanded to inspect exactly what the AI is analysing.
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback(
    (f: AuditFileRecord): string | null | undefined =>
      f.driveFileId ? fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text : undefined,
    [fileTextCache]
  );

  const files = p.filesFound ?? [];
  const totalNew     = files.filter((f) => f.processingMode === "new").length;
  const totalChanged = files.filter((f) => f.processingMode === "changed").length;
  const totalReused  = files.filter((f) => f.processingMode === "reused").length;
  const hasProcessingModes = totalNew + totalChanged + totalReused > 0;

  // Staged audit stages have distinct labels and descriptions
  const STAGED_STAGE_INFO: Record<string, { icon: string; headline: string; detail: string }> = {
    policy_audit:   { icon: "📋", headline: "Pass 1 of 3 — Policy & Approach check", detail: "AI is reading your policy documents and checking whether each GD4 audit point has a documented approach. It is scoring the Approach (A) dimension of the APSR rubric." },
    evidence_audit: { icon: "🔍", headline: "Pass 2 of 3 — Implementation evidence check", detail: "AI is reviewing your actual evidence files to verify that the documented policies are implemented in practice. It is scoring the Processes (P) and Systems & Outcomes (S) dimensions." },
    outcome_review: { icon: "📊", headline: "Pass 3 of 3 — Outcomes & Review check", detail: "AI is looking for outcome data, trend analysis, and management review records to confirm that results are measured and improvements are tracked. It is scoring the Review (R) dimension." },
    apsr_build:     { icon: "⚙️", headline: "Building APSR verdicts", detail: "All three AI passes are complete. Combining Approach, Processes, Outcomes and Review scores into a single verdict for each checklist line." },
  };
  const stagedInfo = STAGED_STAGE_INFO[p.stage ?? ""];

  if (isActive) {
    // Show files that have been processed by the AI so far
    const analyzedFiles = files.filter((f) => f.auditStatus === "cited" || f.auditStatus === "not_used" || f.auditStatus === "audited");
    const citedCount = files.filter((f) => f.auditStatus === "cited").length;
    const notUsedCount = files.filter((f) => f.auditStatus === "not_used").length;
    const pendingCount = files.filter((f) => f.auditStatus === "pending" || !f.auditStatus).length;

    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          {stagedInfo
            ? <>{stagedInfo.icon} {stagedInfo.headline}<Dots /></>
            : isStrict ? <>🔎 Running strict challenge pass<Dots /></>
            : <>🤖 Asking AI — batch {batch} of {total}<Dots /></>
          }
        </div>
        <div style={{ ...muted, marginBottom: 8 }}>
          {stagedInfo
            ? stagedInfo.detail
            : isStrict
              ? "Re-checking every Met/Partial verdict: truly implemented, or just a policy on paper?"
              : "Comparing evidence against GD4 checklist requirements and writing verdicts"
          }
        </div>
        {p.stageDetail && !stagedInfo && (
          <div style={{ ...muted, marginBottom: 8, fontStyle: "italic" }}>{p.stageDetail}</div>
        )}

        {/* Staged audit pass mini-tracker */}
        {stagedInfo && (
          <>
            {/* Pass pills + window counter */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {(["policy_audit", "evidence_audit", "outcome_review"] as const).map((stg, i) => {
                const stageOrder = ["policy_audit", "evidence_audit", "outcome_review", "apsr_build"];
                const currentIdx = stageOrder.indexOf(p.stage ?? "");
                const isDone = currentIdx > i;
                const isCurrent = stageOrder.indexOf(stg) === currentIdx;
                const labels = ["Policy", "Evidence", "Outcomes"];
                return (
                  <span key={stg} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, fontWeight: 600, background: isDone ? "#dcfce7" : isCurrent ? "#dbeafe" : "#f1f5f9", color: isDone ? "#15803d" : isCurrent ? "#1d4ed8" : "#94a3b8", border: isCurrent ? "1px solid #93c5fd" : "1px solid transparent" }}>
                      {isDone ? "✓ " : isCurrent ? "⏳ " : ""}{labels[i]}
                    </span>
                    {i < 2 && <span style={{ color: "#cbd5e1", fontSize: 10 }}>→</span>}
                  </span>
                );
              })}
              {/* Window counter badge */}
              {p.windowTotal != null && p.windowTotal > 1 && (
                <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "ui-monospace,monospace", background: "#f0f4ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "2px 8px", color: "#3730a3", fontWeight: 600 }}>
                  Window {p.windowCurrent ?? 1} / {p.windowTotal}
                </span>
              )}
            </div>

            {/* Window progress bar (only when multi-window) */}
            {p.windowTotal != null && p.windowTotal > 1 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ background: "#e0e7ff", borderRadius: 4, height: 5, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4, background: "#6366f1",
                    width: `${Math.round(100 * ((p.windowCurrent ?? 1) - 1) / p.windowTotal)}%`,
                    transition: "width 0.4s ease",
                  }} />
                </div>
                <div style={{ ...muted, marginTop: 3 }}>
                  All {files.length} file{files.length !== 1 ? "s" : ""} are bundled into {p.windowTotal} text windows for the AI — each window is one AI call. Use <b>Skip stage →</b> to stop this pass early.
                </div>
              </div>
            )}

            {/* Files list */}
            {files.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>📤 <b>{files.length}</b> file{files.length !== 1 ? "s" : ""} in this pass</span>
                  {p.chunksCount != null && <span>· <b>{p.chunksCount}</b> chunks</span>}
                  <input
                    value={aiFileSearch}
                    onChange={(e) => setAiFileSearch(e.target.value)}
                    placeholder="Search files…"
                    style={{ marginLeft: "auto", fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #cbd5e1", outline: "none", width: 120 }}
                  />
                  <select
                    value={aiFileSort}
                    onChange={(e) => setAiFileSort(e.target.value as "name" | "status" | "size")}
                    style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid #cbd5e1", color: "#374151" }}
                  >
                    <option value="name">Sort: Name</option>
                    <option value="status">Sort: Status</option>
                    <option value="size">Sort: Size</option>
                  </select>
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto", border: "1px solid #dbeafe", borderRadius: 6, background: "#f8fbff" }}>
                  {files
                    .filter((f) => !aiFileSearch || f.name.toLowerCase().includes(aiFileSearch.toLowerCase()))
                    .slice()
                    .sort((a, b) => {
                      if (aiFileSort === "status") {
                        const order: Record<string, number> = { cited: 0, audited: 1, not_used: 2, pending: 3 };
                        return (order[a.auditStatus ?? "pending"] ?? 3) - (order[b.auditStatus ?? "pending"] ?? 3);
                      }
                      if (aiFileSort === "size") return (b.charCount ?? 0) - (a.charCount ?? 0);
                      return a.name.localeCompare(b.name);
                    })
                    .map((file, fi) => (
                      <AiFileRow key={file.path + fi} file={file} resolveText={resolveText} />
                    ))
                  }
                </div>
              </div>
            )}
            {p.stageDetail && (
              <div style={{ ...muted, marginBottom: 6, fontStyle: "italic" }}>{p.stageDetail}</div>
            )}
          </>
        )}

        {/* Stats bar */}
        <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, padding: "6px 10px", background: "#f1f5f9", borderRadius: 6 }}>
          {p.filesTotal != null && <span><b>{p.filesTotal}</b> file{p.filesTotal !== 1 ? "s" : ""}</span>}
          {p.chunksCount != null && <span><b>{p.chunksCount}</b> chunks sent to AI</span>}
          {!stagedInfo && total > 1 && <span>Batch <b>{batch}</b>/<b>{total}</b></span>}
          {p.linesAssessed != null && p.linesAssessed > 0 && <span style={{ color: "#15803d" }}><b>{p.linesAssessed}</b> line{p.linesAssessed !== 1 ? "s" : ""} assessed</span>}
          {p.findingsDetected != null && p.findingsDetected > 0 && <span style={{ color: "#b45309" }}><b>{p.findingsDetected}</b> gap{p.findingsDetected !== 1 ? "s" : ""} detected</span>}
          {p.aiModel && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#64748b" }}>{p.aiModel}</span>}
          <span style={{ color: p.auditLive ? "#7c3aed" : "#94a3b8" }}>{p.auditLive ? "Live AI" : "Offline"}</span>
        </div>

        {/* Live file status — shows which files the AI has cited vs not used */}
        {analyzedFiles.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "flex", gap: 10 }}>
              <span>Files analysed by AI so far: <b>{analyzedFiles.length}</b></span>
              {citedCount > 0 && <span style={{ color: "#0369a1" }}>📎 <b>{citedCount}</b> cited</span>}
              {notUsedCount > 0 && <span style={{ color: "#6b7280" }}>— <b>{notUsedCount}</b> not used</span>}
              {pendingCount > 0 && <span style={{ color: "#94a3b8" }}>⏳ <b>{pendingCount}</b> pending</span>}
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff" }}>
              {analyzedFiles.map((file) => (
                <AiFileRow key={file.path} file={file} resolveText={resolveText} borderColor="#f1f5f9" />
              ))}
            </div>
          </div>
        )}

        {hasProcessingModes && (
          <div style={{ ...muted, display: "flex", gap: 8 }}>
            {totalNew > 0 && <span><b>{totalNew}</b> new</span>}
            {totalChanged > 0 && <span><b>{totalChanged}</b> changed</span>}
            {totalReused > 0 && <span style={{ color: "#7c3aed" }}><b>{totalReused}</b> cached</span>}
          </div>
        )}
      </div>
    );
  }

  // Completed Ask AI panel — show verdicts table if available
  const verdicts = p.verdictLines ?? [];
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#15803d", marginBottom: 4 }}>✓ AI audit complete</div>
      <div style={{ fontSize: 11.5, color: "#475569", display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        {p.filesTotal != null && <span><b>{p.filesTotal}</b> files</span>}
        {p.chunksCount != null && <span><b>{p.chunksCount}</b> chunks</span>}
        {total > 1 && <span><b>{total}</b> batch{total !== 1 ? "es" : ""}</span>}
        {p.aiModel && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#64748b" }}>{p.aiModel}</span>}
        <span>{p.auditLive ? "Live AI" : "Offline"}</span>
        {hasProcessingModes && <>
          {totalNew > 0 && <span><b>{totalNew}</b> new</span>}
          {totalChanged > 0 && <span><b>{totalChanged}</b> changed</span>}
          {totalReused > 0 && <span style={{ color: "#7c3aed" }}><b>{totalReused}</b> cached</span>}
        </>}
      </div>
      {/* Files sent to AI — persist after completion so the user can see what was analysed */}
      {files.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 3 }}>
            📤 Files sent to AI
            {p.chunksCount != null && <> · <b>{p.chunksCount}</b> chunks</>}
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}>
            {files.map((file, fi) => (
              <AiFileRow key={file.path + fi} file={file} resolveText={resolveText} borderColor="#dcfce7" />
            ))}
          </div>
        </div>
      )}
      {verdicts.length > 0 && (
        <div>
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead>
                <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                  <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Line</th>
                  <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Result</th>
                  <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>A·P·S·R</th>
                  <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Cited</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v) => {
                  const resultColor = v.result === "Met" ? "#15803d" : v.result === "Partial" ? "#b45309" : "#b91c1c";
                  const apsrSummary = [v.approachStatus[0], v.processesStatus[0], v.systemsOutcomesStatus[0], v.reviewStatus[0]].join("·");
                  return (
                    <tr key={v.lineId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "3px 6px", fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#374151" }} title={v.lineText}>{v.lineId}</td>
                      <td style={{ padding: "3px 6px", fontWeight: 700, color: resultColor }}>{v.result}</td>
                      <td style={{ padding: "3px 6px", fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#6b7280" }}>{apsrSummary}</td>
                      <td style={{ padding: "3px 6px", fontSize: 10, color: "#6b7280" }}>{v.citedChunkIds.length > 0 ? v.citedChunkIds.join(", ") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {onExportAISummary && (
            <button
              onClick={onExportAISummary}
              style={{ marginTop: 5, cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
            >
              ⬇ Export AI summary CSV
            </button>
          )}
        </div>
      )}
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
          {issues > 0 && <span style={{ color: "#b45309" }}><b>{issues}</b> potential gap{issues !== 1 ? "s" : ""}</span>}
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

function CompleteDetail({ p, onExportFileLedger, onExportAISummary }: { p: AuditProgressState; onExportFileLedger?: () => void; onExportAISummary?: () => void }) {
  const lines = p.linesAssessed ?? 0;
  const issues = p.findingsDetected ?? 0;
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };
  const files = p.filesFound ?? [];
  const totalFound   = files.length;
  const totalRead    = files.filter((f) => f.readStatus === "read" || f.readStatus === "condensed").length;
  const totalSkipped = files.filter((f) => f.readStatus === "skipped").length;
  const totalFailed  = files.filter((f) => f.readStatus === "failed").length;
  const totalCited   = files.filter((f) => f.auditStatus === "cited").length;
  const totalNotUsed = files.filter((f) => f.auditStatus === "not_used").length;

  // The "N checklist lines assessed" chip points at the Sub-Criterion Checklist
  // for BOTH paths — that is where the assessed lines live (Option A verdicts are
  // written there too). The rich Option A PPD+Evidence review opens from the
  // primary "View results →" button (review modal); the standalone PPD page was
  // retired, so there is no separate /ppd-review destination.
  const checklistHref = !p.subCriterionId
    ? "#/sub-checklist"
    : `#/sub-checklist?item=${GD4_REQUIREMENTS.find((r) => r.subCriterionId === p.subCriterionId)?.id ?? ""}`;
  const checklistLabel = "Sub-Criterion Checklist";
  // ?subCrit= (a sub-criterion id like "1.2") — ?item= expects a requirement
  // id ("1.2.1") and would silently ignore a sub-criterion id.
  const findingsHref  = p.subCriterionId ? `#/findings?subCrit=${p.subCriterionId}` : "#/findings";

  const chipLink: React.CSSProperties = { cursor: "pointer", textDecoration: "none", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 8 }}>Audit finished successfully!</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {lines > 0 && (
          <a href={checklistHref} style={{ ...chipLink, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
            ✓ <b>{lines}</b> checklist line{lines !== 1 ? "s" : ""} assessed →
          </a>
        )}
        {issues > 0 ? (
          <a href={findingsHref} style={{ ...chipLink, background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" }}>
            ⚠ <b>{issues}</b> potential issue{issues !== 1 ? "s" : ""} → Findings
          </a>
        ) : lines > 0 ? (
          <a href={checklistHref} style={{ ...chipLink, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
            ✓ No issues flagged
          </a>
        ) : null}
      </div>
      {totalFound > 0 && (
        <div style={{ padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11.5, color: "#374151", display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <a href={checklistHref} style={{ color: "#374151", textDecoration: "none", fontWeight: 600 }}><b>{totalFound}</b> files</a>
          {totalRead > 0 && <a href={checklistHref} style={{ color: "#15803d", textDecoration: "none" }}><b>{totalRead}</b> read</a>}
          {totalCited > 0 && <a href={checklistHref} style={{ color: "#0369a1", textDecoration: "none" }}><b>{totalCited}</b> cited by AI</a>}
          {totalNotUsed > 0 && <span style={{ color: "#6b7280" }}><b>{totalNotUsed}</b> not used</span>}
          {totalSkipped > 0 && <span><b>{totalSkipped}</b> skipped</span>}
          {totalFailed > 0 && <span style={{ color: "#b91c1c" }}><b>{totalFailed}</b> failed</span>}
        </div>
      )}
      <div style={{ ...muted, marginBottom: 8 }}>
        Check the{" "}
        <a href={checklistHref} style={{ color: "#4f46e5", fontWeight: 600 }}>{checklistLabel}</a>
        {issues > 0 && <> · <a href={findingsHref} style={{ color: "#b45309", fontWeight: 600 }}>Findings register</a></>}
        {" "}to review verdicts and evidence.
      </div>
      {(onExportFileLedger || onExportAISummary) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onExportFileLedger && (
            <button
              onClick={onExportFileLedger}
              style={{ cursor: "pointer", fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
            >
              ⬇ File ledger CSV
            </button>
          )}
          {onExportAISummary && (
            <button
              onClick={onExportAISummary}
              style={{ cursor: "pointer", fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
            >
              ⬇ AI summary CSV
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorDetail({ p }: { p: AuditProgressState }) {
  const navigate = useNavigate();
  const driveToken = useGoogleDriveStore((s) => s.accessToken);
  const driveConnecting = useGoogleDriveStore((s) => s.connecting);
  const driveClientId = useGoogleDriveStore((s) => s.clientId);
  const folder = useWorkspaceStore((s) => s.folders.find((f) => f.id === p.folderId));

  const filesFound = p.filesFound?.length ?? 0;
  const filesRead = p.filesRead ?? 0;
  const linesAssessed = p.linesAssessed ?? 0;
  const partialSaved = linesAssessed > 0;

  // A Drive-access failure (nothing could be listed/read) vs a downstream
  // (file-read / AI) failure. Only the first offers Connect/Reconnect + checks.
  const isDriveFailure = filesFound === 0 && filesRead === 0;
  const readCause = isDriveFailure ? classifyDriveReadError(p.errorMessage) : null;

  let failedStep: string;
  let guidance: string;
  if (isDriveFailure) {
    // The pre-run guard blocks a total not-connected state, so here Drive is
    // usually connected but this folder couldn't be read. Report the SPECIFIC
    // cause when the Drive API gave one (Fix 4); otherwise the general check.
    failedStep = driveToken ? "Reading the Drive folder" : "Connecting to Google Drive";
    guidance = readCause && readCause.cause !== "unknown" ? readCause.detail : driveReadFailureMessage();
  } else if (filesRead === 0 || (p.filesTotal != null && filesRead < p.filesTotal)) {
    failedStep = "Reading evidence files";
    guidance = "One or more files could not be read. Password-protected PDFs and unsupported file types are skipped automatically — this error usually means a network issue or an unusually large file. Try running the audit again.";
  } else {
    failedStep = "Asking AI to assess";
    guidance = "The AI call timed out or was rejected. Check your OpenAI key in Settings → AI Settings. If the folder has more than 15–20 files, try reducing it to the most relevant ones.";
  }

  const connectDrive = () => {
    if (!driveClientId) { navigate(DRIVE_CONNECT_PATH); return; }
    useGoogleDriveStore.getState().connect().catch(() => {/* lastError shown in Settings */});
  };

  const btn = (label: string, onClick: () => void, primary: boolean): React.ReactNode => (
    <button
      onClick={onClick}
      disabled={primary && driveConnecting}
      style={{
        cursor: primary && driveConnecting ? "default" : "pointer", fontSize: 11.5, fontWeight: 700,
        padding: "6px 12px", borderRadius: 7, whiteSpace: "nowrap",
        border: primary ? "none" : "1px solid #cbd5e1",
        background: primary ? (driveConnecting ? "#94a3b8" : "#2563eb") : "#fff",
        color: primary ? "#fff" : "#334155",
      }}
    >
      {label}
    </button>
  );

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
          ✓ <b>{linesAssessed}</b> verdict{linesAssessed !== 1 ? "s" : ""} saved before the error — those results are kept.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
          No verdicts saved — you can safely run the audit again once the issue is fixed.
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#374151", marginBottom: isDriveFailure ? 8 : 0 }}>
        <b>What to do:</b> {guidance}
      </div>

      {/* Fix 1/3 — a Drive failure always gives a clickable way forward, not
          just advice: Connect (not connected) or Reconnect (connected but the
          read failed), plus a jump to the folder link settings. */}
      {isDriveFailure && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, marginBottom: 8 }}>
            {btn(
              driveToken ? (driveConnecting ? "Reconnecting…" : "Reconnect Google Drive") : (driveConnecting ? "Connecting…" : "Connect to Google Drive"),
              connectDrive,
              true,
            )}
          </div>
          {/* The specific checks + the folder link so the user can verify it. */}
          <div style={{ fontSize: 11, color: "#64748b", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 7, padding: "7px 10px" }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>Checks for this folder:</div>
            <ul style={{ margin: "0 0 0 16px", padding: 0, lineHeight: 1.6 }}>
              <li>The connected Google account has at least <b>Viewer</b> access to the folder.</li>
              <li>If it's in a <b>Shared Drive</b>, the account is a <b>member</b> of that drive (link-sharing alone is not enough).</li>
              <li>The folder actually <b>contains files</b> (not just subfolders that are themselves empty).</li>
            </ul>
            {(folder?.folderLink || folder?.policyLink) && (
              <div style={{ marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {folder?.policyLink && <a href={folder.policyLink} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>Open Policy folder ↗</a>}
                {folder?.folderLink && <a href={folder.folderLink} target="_blank" rel="noreferrer" style={{ color: "#16a34a", textDecoration: "none" }}>Open Evidence folder ↗</a>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// "Pre-check" step detail — the per-sub-criterion pre-analysis checklist,
// reusing whatever files THIS run has already read (p.filesFound) rather than
// a separate probe. Always viewable (see VISUAL_STEPS' alwaysViewable), so it
// can be reviewed while reading is still in progress, mid-run, or afterward —
// it never gates the real pipeline, which keeps running underneath regardless.
// Sub-criteria with no defined checklist show an honest "no checks" state
// instead of PreAnalysisChecklistPanel's silent null, so a step the user
// clicked never appears blank.
function PreCheckStepDetail({ p, onAdvanceToAskAI }: { p: AuditProgressState; onAdvanceToAskAI?: () => void }) {
  const subCriterionId = p.subCriterionId ?? "";
  const itemIds = useMemo(() => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId).map((r) => r.id), [subCriterionId]);
  const readingInProgress = p.stage === "reading" || p.stage === "condensing";

  if (!hasChecklist(itemIds)) {
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>📝 Pre-check</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>No pre-analysis checks are defined yet for this sub-criterion — continuing automatically.</div>
        <button
          type="button"
          onClick={onAdvanceToAskAI}
          disabled={!onAdvanceToAskAI}
          style={{ cursor: onAdvanceToAskAI ? "pointer" : "default", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff", opacity: onAdvanceToAskAI ? 1 : 0.5 }}
        >
          Continue to Ask AI →
        </button>
      </div>
    );
  }

  const subTitle = GD4_SUB_CRITERIA.find((s) => s.id === subCriterionId)?.title ?? "";
  return (
    <div>
      {readingInProgress && (
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontStyle: "italic" }}>
          Files are still being read — showing checks against what's been read so far. This updates automatically.
        </div>
      )}
      <PreAnalysisChecklistPanel
        folderId={p.folderId}
        subCriterionId={subCriterionId}
        subCriterionTitle={subTitle}
        itemIds={itemIds}
        files={p.filesFound}
        onContinue={onAdvanceToAskAI ?? (() => {})}
        continueLabel="Continue to Ask AI"
      />
    </div>
  );
}

function StepDetail({
  step, p, onSkipFile, onExportFileLedger, onExportAISummary, onAdvanceToAskAI,
}: {
  step: number;
  p: AuditProgressState;
  onSkipFile?: () => void;
  onExportFileLedger?: () => void;
  onExportAISummary?: () => void;
  onAdvanceToAskAI?: () => void;
}) {
  const currentStep = stageToVisualStep(p.stage);
  const isActive = step === currentStep;
  const isError = p.stage === "error";
  if (isError && step === currentStep) return <ErrorDetail p={p} />;
  switch (step) {
    case 0: return <ConnectDetail p={p} isActive={isActive} />;
    case 1: return <ReadFilesDetail p={p} isActive={isActive} onSkipFile={onSkipFile} onExportCsv={onExportFileLedger} />;
    case 2: return <PreCheckStepDetail p={p} onAdvanceToAskAI={onAdvanceToAskAI} />;
    case 3: return <AuditStepDetail p={p} isActive={isActive} onExportAISummary={onExportAISummary} />;
    case 4: return <SaveStepDetail p={p} isActive={isActive} />;
    case 5: return <CompleteDetail p={p} onExportFileLedger={onExportFileLedger} onExportAISummary={onExportAISummary} />;
    default: return null;
  }
}

// A single staged-audit AI call is allowed up to 90s (AUDIT_BATCH_TIMEOUT_MS in
// agentRuntime.ts) before it times out. The heartbeat only refreshes between
// those calls, so the threshold must sit ABOVE the per-call ceiling — otherwise
// a normal, still-running call trips the "stuck" banner and users hit "Skip
// pass", cutting the sliding-window sweep short before all windows finish.
const STUCK_THRESHOLD_MS = 100_000;

function AuditProgressModal({
  progress,
  onClose,
  onCancel,
  onSkipFile,
  onSkipStage,
  onExportFileLedger,
  onExportAISummary,
  onViewResults,
}: {
  progress: AuditProgressState;
  onClose: () => void;
  onCancel: () => void;
  onSkipFile: () => void;
  onSkipStage: () => void;
  onExportFileLedger: () => void;
  onExportAISummary: () => void;
  // Opens the saved result in its review MODAL (Option A review modal / Option B
  // audit-run modal) instead of navigating to a separate page. Optional — falls
  // back to page navigation if a caller doesn't provide it.
  onViewResults?: () => void;
}) {
  const pct = stageProgress(progress);
  const isError = progress.stage === "error";
  const isDone = progress.stage === "complete";
  const isRunning = !isDone && !isError;
  const currentStep = stageToVisualStep(progress.stage);

  // Fallback destination for "View results →" when onViewResults isn't supplied
  // (the render site always supplies it, opening the review modal directly). The
  // standalone PPD page was retired, so Option A falls back to the Evidence
  // Folder row (focused on its sub-criterion) rather than a dead /ppd-review URL;
  // Option B falls back to the Sub-Criterion Checklist.
  const analysisPath = useWorkspaceStore((s) => s.analysisPath);
  const subCriterionId = progress.subCriterionId ?? "";
  const viewResultsHref =
    resolveAnalysisPath(analysisPath, subCriterionId) === "A"
      ? `/evidence-folder?sub=${subCriterionId}`
      : `/sub-checklist?item=${GD4_REQUIREMENTS.find((r) => r.subCriterionId === subCriterionId)?.id ?? ""}`;

  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const prevCurrentStep = useRef(currentStep);
  useEffect(() => {
    if (prevCurrentStep.current !== currentStep) {
      prevCurrentStep.current = currentStep;
      setSelectedStep(null);
    }
  }, [currentStep]);

  const [isStuck, setIsStuck] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isRunning) { setIsStuck(false); setElapsedSec(0); return; }
    const tick = () => {
      const hb = progress.lastHeartbeatAt;
      const elapsed = hb != null ? Math.floor((Date.now() - hb) / 1000) : 0;
      setElapsedSec(elapsed);
      setIsStuck(hb != null && elapsed > STUCK_THRESHOLD_MS / 1000);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isRunning, progress.lastHeartbeatAt]);

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
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 860, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", maxHeight: "92vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {isRunning ? "Running folder audit" : isDone ? "Audit complete" : "Audit stopped"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>{progress.folderName}</span>
              {progress.scope && progress.scope !== "both" && (
                <span style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
                  {progress.scope === "policy" ? "Policy only" : "Evidence only"}
                </span>
              )}
              {progress.runMode && (
                <span
                  title={AUDIT_MODES.find((m) => m.value === progress.runMode)?.desc}
                  style={{ fontSize: 10, background: "#faf5ff", color: "#7c3aed", border: "1px solid #ddd6fe", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}
                >
                  Mode: {auditModeLabel(progress.runMode)}
                </span>
              )}
              {progress.overallTotal && progress.overallCurrent != null && (
                <span style={{ background: "#f1f5f9", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
                  Folder {progress.overallCurrent} of {progress.overallTotal}
                </span>
              )}
            </div>
          </div>
          {isRunning ? (
            <div style={{ display: "flex", gap: 6, marginLeft: 8, flexShrink: 0 }}>
              {currentStep === 3 && (
                <button
                  onClick={onSkipStage}
                  title="Stop the current AI pass early and move to the next pass using results collected so far. Files are processed as bundled text windows — there is no per-file cancel in this stage."
                  style={{ cursor: "pointer", border: "1px solid #fbbf24", background: "#fffbeb", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: "#92400e", padding: "5px 12px", whiteSpace: "nowrap" }}
                >
                  Skip pass →
                </button>
              )}
              <button
                onClick={onCancel}
                style={{ cursor: "pointer", border: "1px solid #fca5a5", background: "#fff5f5", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: "#b23121", padding: "5px 12px", whiteSpace: "nowrap" }}
              >
                Cancel audit
              </button>
            </div>
          ) : (
            <button onClick={handleClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 20, color: "#94a3b8", lineHeight: 1, padding: "0 0 0 8px", marginTop: -2 }}>×</button>
          )}
        </div>

        {(isStuck || (progress.lastHeartbeatAt != null && elapsedSec > 10 && isRunning)) && (
          <div style={{ background: isStuck ? "#fff7ed" : "#f8fafc", border: `1px solid ${isStuck ? "#fed7aa" : "#e2e8f0"}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: isStuck ? "#9a3412" : "#475569", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{isStuck ? "⚠" : "⏱"}</span>
            <span style={{ flex: 1 }}>
              {isStuck
                ? (currentStep === 1
                  ? <>No activity for <b>{elapsedSec}s</b> — file may be stuck. Click <b>Skip</b> next to the file name below, or <b>Cancel audit</b> to stop.</>
                  : <>AI no response for <b>{elapsedSec}s</b> — may be stuck. Click <b>Skip pass →</b> to stop this pass and continue with results so far, or <b>Cancel audit</b> to stop.</>)
                : <>Waiting for AI response — <b>{elapsedSec}s</b> elapsed</>
              }
            </span>
            {isStuck && elapsedSec > 0 && (
              <span style={{ flexShrink: 0, fontFamily: "ui-monospace,monospace", fontSize: 11, background: "#fef3c7", borderRadius: 4, padding: "1px 6px", color: "#92400e" }}>
                {elapsedSec}s / {STUCK_THRESHOLD_MS / 1000}s
              </span>
            )}
          </div>
        )}

        {/* Step flow */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, padding: "0 4px" }}>
          {VISUAL_STEPS.map((step, i) => {
            const status: "done" | "active" | "future" | "error" =
              isError && i === currentStep ? "error" :
              isDone ? "done" :
              i < currentStep ? "done" :
              i === currentStep ? "active" : "future";
            // Pre-check is always viewable (even while "future"/not yet reached)
            // since it never gates the real pipeline — the user can peek at the
            // checklist at any point in the run.
            const isClickable = status !== "future" || step.alwaysViewable;
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
                    background: status === "done" ? "#dcfce7" : status === "active" ? "#2563eb" : status === "error" ? "#fee2e2" : "#f1f5f9",
                    color: status === "done" ? "#15803d" : status === "active" ? "#fff" : status === "error" ? "#b23121" : "#cbd5e1",
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

        {/* Primary progress bar — overall stage */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ background: "#f1f5f9", borderRadius: 6, height: 7, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct}%`, borderRadius: 6,
              background: isError ? "#ef4444" : isDone ? "#22c55e" : "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
              backgroundSize: "200% 100%", transition: "width 0.5s ease",
              animation: !isDone && !isError ? "audit-shimmer 2s linear infinite" : "none",
            }} />
          </div>
          {/* Secondary progress bar — within-stage (file read or AI window) */}
          {isRunning && (() => {
            let subPct: number | null = null;
            let subLabel: string | null = null;
            if (currentStep === 1 && progress.filesTotal && progress.filesTotal > 1) {
              subPct = Math.round(100 * (progress.filesRead ?? 0) / progress.filesTotal);
              subLabel = `File ${progress.filesRead ?? 0} / ${progress.filesTotal}`;
            } else if (currentStep === 3 && progress.windowTotal && progress.windowTotal > 1) {
              subPct = Math.round(100 * ((progress.windowCurrent ?? 1) - 1) / progress.windowTotal);
              subLabel = `AI window ${progress.windowCurrent ?? 1} / ${progress.windowTotal}`;
            }
            if (subPct === null) return null;
            return (
              <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, background: "#e2e8f0", borderRadius: 4, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${subPct}%`, borderRadius: 4, background: currentStep === 3 ? "#6366f1" : "#38bdf8", transition: "width 0.3s ease" }} />
                </div>
                <span style={{ fontSize: 10, color: "#64748b", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{subLabel}</span>
              </div>
            );
          })()}
        </div>
        <div style={{ marginBottom: 14 }} />

        {/* Detail panel */}
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", minHeight: 80 }}>
          {selectedStep !== null && selectedStep !== currentStep && (
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 6 }}>
              {VISUAL_STEPS[selectedStep].emoji} {VISUAL_STEPS[selectedStep].label} — click the active step to return to live view
            </div>
          )}
          <StepDetail
            step={displayStep}
            p={progress}
            onSkipFile={progress.canSkipCurrentFile ? onSkipFile : undefined}
            onExportFileLedger={onExportFileLedger}
            onExportAISummary={onExportAISummary}
            onAdvanceToAskAI={() => setSelectedStep(3)}
          />
        </div>

        {/* Completion buttons — stay open after done */}
        {(isDone || isError) && (
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isDone && (
              onViewResults ? (
                <button
                  onClick={onViewResults}
                  style={{ flex: 1, cursor: "pointer", padding: "10px", borderRadius: 10, border: "none", background: "#dcfce7", color: "#15803d", fontWeight: 700, fontSize: 13, textAlign: "center" }}
                >
                  View results →
                </button>
              ) : (
                <Link
                  to={viewResultsHref}
                  style={{ flex: 1, cursor: "pointer", padding: "10px", borderRadius: 10, border: "none", background: "#dcfce7", color: "#15803d", fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none", display: "block" }}
                >
                  View results →
                </Link>
              )
            )}
            {isError && (
              <button
                onClick={onClose}
                style={{ flex: 1, cursor: "pointer", padding: "10px", borderRadius: 10, border: "none", background: "#fee2e2", color: "#b23121", fontWeight: 700, fontSize: 13 }}
              >
                Dismiss
              </button>
            )}
            <button
              onClick={onClose}
              style={{ cursor: "pointer", padding: "10px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12 }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Read-only "View last run" modal ────────────────────────────────────────

function AuditRunModal({ run, onClose }: { run: AuditRunRecord; onClose: () => void }) {
  const muted: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };

  const handleExportFileLedger = () => {
    const csv = exportFileLedgerCsv(run);
    downloadCsv(csv, auditCsvFilename("gd4-audit-file-ledger", run));
  };

  const handleExportAISummary = () => {
    const csv = exportAISummaryCsv(run);
    downloadCsv(csv, auditCsvFilename("gd4-audit-ai-summary", run));
  };

  const verdicts = run.aiSummary;
  const met      = verdicts.filter((v) => v.result === "Met").length;
  const partial  = verdicts.filter((v) => v.result === "Partial").length;
  const notMet   = verdicts.filter((v) => v.result === "Not met").length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "24px 24px 20px", width: "100%", maxWidth: 860, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
              Audit run — {run.subCriterionId} {run.subCriterionTitle}
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: "ui-monospace,monospace", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 4, padding: "1px 5px" }}>{run.runId}</span>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              {run.scope !== "both" && (
                <span style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
                  {run.scope === "policy" ? "Policy only" : "Evidence only"}
                </span>
              )}
              <span style={{ fontSize: 10, background: run.status === "completed" ? "#f0fdf4" : "#fef2f2", color: run.status === "completed" ? "#15803d" : "#b91c1c", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
                {run.status}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 20, color: "#94a3b8", lineHeight: 1, padding: "0 0 0 8px", marginTop: -2 }}>×</button>
        </div>

        {/* Metadata row */}
        <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8, fontSize: 11.5, color: "#374151", display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          {run.auditorName && <span><span style={muted}>Auditor:</span> {run.auditorName}</span>}
          {domainExpertiseLabelFor(run.subCriterionId) && <span><span style={muted}>Specialist lens:</span> <b>{domainExpertiseLabelFor(run.subCriterionId)}</b></span>}
          {run.aiModel && <span><span style={muted}>Model:</span> <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5 }}>{run.aiModel}</span></span>}
          <span><span style={muted}>AI:</span> {run.auditLive ? "Live" : "Offline"}</span>
          {run.chunkCount > 0 && <span><span style={muted}>Chunks:</span> {run.chunkCount}</span>}
          {run.batchCount > 0 && <span><span style={muted}>Batches:</span> {run.batchCount}</span>}
          <span><span style={muted}>Lines:</span> {run.linesAssessed}</span>
        </div>

        {/* Verdict summary */}
        {verdicts.length > 0 && (
          <div style={{ padding: "6px 10px", background: "#f0fdf4", borderRadius: 8, fontSize: 12, color: "#166534", display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <span>✓ <b>{met}</b> Met</span>
            <span>◐ <b>{partial}</b> Partial</span>
            <span>✗ <b>{notMet}</b> Not met</span>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {/* Hybrid per-verdict approval gate for this Option B run — sits above
              the AI summary (the per-line verdict rows that produced it), so the
              staged-audit gate is judged here in the post-analysis review, not
              inline on the Evidence Folder page. Closing commits nothing. */}
          <HybridGatePanel subCriterionId={run.subCriterionId} />

          {/* File ledger */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>File ledger ({run.fileLedger.length} files)</div>
            <FileLedger files={run.fileLedger} onExportCsv={handleExportFileLedger} />
          </div>

          {/* AI summary table */}
          {verdicts.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>AI summary ({verdicts.length} lines)</div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                      <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Line</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Text</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Result</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>A·P·S·R</th>
                      <th style={{ padding: "3px 6px", textAlign: "left", color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Cited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verdicts.map((v) => {
                      const resultColor = v.result === "Met" ? "#15803d" : v.result === "Partial" ? "#b45309" : "#b91c1c";
                      const apsrSummary = [v.approachStatus[0], v.processesStatus[0], v.systemsOutcomesStatus[0], v.reviewStatus[0]].join("·");
                      return (
                        <tr key={v.lineId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "3px 6px", fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#374151" }}>{v.lineId}</td>
                          <td style={{ padding: "3px 6px", color: "#475569", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.lineText}>{v.lineText}</td>
                          <td style={{ padding: "3px 6px", fontWeight: 700, color: resultColor }}>{v.result}</td>
                          <td style={{ padding: "3px 6px", fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#6b7280" }}>{apsrSummary}</td>
                          <td style={{ padding: "3px 6px", fontSize: 10, color: "#6b7280" }}>{v.citedChunkIds.length > 0 ? v.citedChunkIds.join(", ") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                onClick={handleExportAISummary}
                style={{ cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
              >
                ⬇ Export AI summary CSV
              </button>
            </div>
          )}
        </div>

        {/* Jump straight to the Checklist or Findings for this sub-criterion. */}
        <div style={{ marginTop: 14 }}><ResultNavLinks subCriterionId={run.subCriterionId} /></div>

        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            onClick={handleExportFileLedger}
            style={{ cursor: "pointer", fontSize: 11, padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}
          >
            ⬇ File ledger CSV
          </button>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11, padding: "6px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#374151" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Near-fullscreen modal hosting the FULL PPD + Evidence review (Option A) for
// one sub-criterion, layered over the Evidence Folder — the same content the
// PPD Requirements Review page shows (PpdReviewContent is shared verbatim, so
// the two surfaces cannot drift). Handles all three states through the shared
// content: running (PpdTab/EvidenceTab live progress panels), loaded-saved
// (instant render from ppdReviewResults/evidenceAssessments, no AI call) and
// empty (the tabs' own "Run…" buttons). zIndex 110: above the row modals
// (100), below the Full-auto overlay (120).
function OptionAReviewModal({ subCriterionId, onClose }: { subCriterionId: string; onClose: () => void }) {
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === subCriterionId);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
  const busy = useWorkspaceStore((s) => s.busy);
  const rerunning = busy === "ppdreview" + subCriterionId;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 110 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "absolute", inset: 18, background: "#fff", borderRadius: 12, boxShadow: "0 10px 44px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {/* Fixed header: title + Re-run + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>
            PPD + Evidence Review — {subCriterionId}{sub ? ` ${sub.title}` : ""}
          </h3>
          <button
            onClick={() => runPPDReview(subCriterionId)}
            disabled={rerunning}
            title="Runs the PPD review again with fresh AI calls (usual progress and cost). The Evidence tab has its own re-run button."
            style={{ marginLeft: "auto", cursor: rerunning ? "wait" : "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 7, border: "1px solid #c7d2fe", background: rerunning ? "#e0e7ff" : "#eef2ff", color: "#4338ca", whiteSpace: "nowrap" }}
          >
            {rerunning ? "Re-running…" : "↻ Re-run"}
          </button>
          <button
            onClick={onClose}
            title="Close — the review stays saved and can be re-opened with 'View results'"
            style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 20, color: "#64748b", lineHeight: 1, padding: "0 4px" }}
          >
            ✕
          </button>
        </div>
        {/* Internally scrolling body with the full shared review content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          <PpdReviewContent selectedId={subCriterionId} />
        </div>
      </div>
    </div>
  );
}

// Pre-flight probe results panel — zero AI calls. Shows the file list with
// per-file bucket + read status, and the plain-English warnings (mis-named
// subfolders, unreadable files) that would otherwise silently corrupt a run.
function FolderProbePanel({ result, onClose }: { result: FolderProbeResult; onClose: () => void }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", fontSize: 12, maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 }}>🔎 Folder pre-flight — no AI used</span>
        {result.ok && <span style={{ color: "#64748b" }}>{result.files.length} file{result.files.length === 1 ? "" : "s"} · {result.policyCount} policy · {result.evidenceCount} evidence{result.unreadable.length ? ` · ${result.unreadable.length} unreadable` : ""}</span>}
        <button onClick={onClose} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
      </div>
      {result.listError ? (
        <div style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "7px 10px" }}>{result.listError}</div>
      ) : (
        <>
          {result.warnings.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: result.files.length ? 8 : 0 }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "7px 10px", lineHeight: 1.45 }}>⚠ {w}</div>
              ))}
            </div>
          ) : result.files.length > 0 ? (
            <div style={{ color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>✓ No problems found — every file is readable and bucketed. Safe to audit.</div>
          ) : null}
          {result.files.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: "auto", overflowX: "hidden", border: "1px solid #e2e8f0", borderRadius: 6 }}>
              {result.files.map((file, i) => {
                const driveUrl = file.driveFileId ? `https://drive.google.com/file/d/${file.driveFileId}/view` : undefined;
                // minWidth:0 lets the filename ellipsis actually engage inside the
                // flex row instead of a long path forcing the whole panel wider.
                const nameStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: file.readable ? "#1e293b" : "#b91c1c" };
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 9px", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 11.5, minWidth: 0 }}>
                    {driveUrl ? (
                      <a
                        href={driveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={`Open in Google Drive — ${file.path}${file.readable ? "" : ` (unreadable: ${file.readError ?? "no extractable text"})`}`}
                        style={{ ...nameStyle, textDecoration: "none" }}
                      >
                        {file.readable ? "" : "⚠ "}{file.path} ↗
                      </a>
                    ) : (
                      <span style={nameStyle} title={file.path}>{file.readable ? "" : "⚠ "}{file.path}</span>
                    )}
                    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: file.bucket === "policy" ? "#5b21b6" : "#b45309", background: file.bucket === "policy" ? "#faf5ff" : "#fffbeb", border: "1px solid", borderColor: file.bucket === "policy" ? "#ddd6fe" : "#fde68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{file.bucket}</span>
                    {file.readVia === "vision" && (
                      <span title="Image-based/scanned PDF — the audit will read it via vision (OCR)." style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>via vision</span>
                    )}
                    {!file.readable && <span title={file.readError} style={{ flexShrink: 0, fontSize: 10, color: "#b91c1c", whiteSpace: "nowrap" }}>unreadable</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];
const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

const SCOPE_OPTIONS: { value: AuditScope; label: string; desc: string }[] = [
  { value: "both",     label: "Both (Policy + Evidence)", desc: "Read all files from both folders" },
  { value: "policy",   label: "Policy only",              desc: "Read only the Policy & Procedure folder" },
  { value: "evidence", label: "Evidence only",            desc: "Read only the Actual Evidence folder" },
];

// Full-screen progress for the Full-auto sweep: heading, bar, current
// sub-criterion, live completion log, Cancel via the existing abort
// mechanism, and "View report →" on completion.
function FullAuditOverlay() {
  const progress = useWorkspaceStore((s) => s.fullAuditProgress);
  const cancelBusy = useWorkspaceStore((s) => s.cancelBusy);
  const dismiss = useWorkspaceStore((s) => s.dismissFullAuditProgress);
  // 1s tick while running so the elapsed indicator visibly moves — a long
  // AI/Drive step must never look frozen.
  const [, setTick] = useState(0);
  const isRunning = progress?.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);
  if (!progress) return null;
  const running = progress.status === "running";
  const elapsedS = progress.currentStartedAt ? Math.max(0, Math.floor((Date.now() - progress.currentStartedAt) / 1000)) : null;
  const elapsedLabel = elapsedS == null ? "" : elapsedS >= 60 ? ` ${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s` : ` ${elapsedS}s`;
  const processed = progress.entries.filter((e) => e.status === "done" || e.status === "skipped" || e.status === "error").length;
  const doneCount = progress.entries.filter((e) => e.status === "done").length;
  const skippedCount = progress.entries.filter((e) => e.status === "skipped").length;
  const errorCount = progress.entries.filter((e) => e.status === "error").length;
  const pct = progress.total > 0 ? Math.round((processed / progress.total) * 100) : 0;

  // Status → theme tone: done=good, skipped=medium (amber), error=critical,
  // waiting=neutral, running=progress (accent).
  const toneOf = (s: FullAuditEntry["status"]) =>
    s === "done" ? TONE.good : s === "skipped" ? TONE.medium : s === "error" ? TONE.critical : s === "running" ? TONE.progress : TONE.neutral;
  const statusWord = (e: FullAuditEntry) =>
    e.status === "running" ? `assessing…${elapsedLabel}` : e.status === "waiting" ? "waiting" : e.status === "done" ? `done${e.note ? ` (${e.note})` : ""}` : e.status === "skipped" ? `skipped${e.note ? ` — ${e.note}` : ""}` : `error${e.note ? ` — ${e.note}` : ""}`;

  // Circular percentage ring.
  const R = 44;
  const CIRC = 2 * Math.PI * R;
  const ringColour = progress.status === "cancelled" ? TONE.medium.fg : TONE.progress.fg;

  const chip = (label: string, count: number, tone: { fg: string; bg: string }) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "3px 11px" }}>
      {count} {label}
    </span>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px 30px 24px", width: "100%", maxWidth: 680, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
          {running
            ? `Auditing ${progress.current} of ${progress.total} sub-criteria`
            : progress.status === "complete" ? "Full audit complete" : "Full audit cancelled"}
        </div>
        {running && (
          <div style={{ fontSize: 13, color: "#475569", marginBottom: 6 }}>
            Now: <b>{progress.currentName}</b>
            {running && elapsedLabel && <span style={{ color: "#94a3b8" }}> — assessing…{elapsedLabel}</span>}
          </div>
        )}
        {!running && progress.summary && (
          <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 6 }}>{progress.summary}</div>
        )}

        {/* Percentage ring + live stat chips */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, margin: "6px 0 12px" }}>
          <div style={{ position: "relative", width: 110, height: 110 }}>
            <svg width={110} height={110}>
              <circle cx={55} cy={55} r={R} fill="none" stroke={TONE.neutral.bg} strokeWidth={10} />
              <circle
                cx={55} cy={55} r={R} fill="none"
                stroke={ringColour} strokeWidth={10} strokeLinecap="round"
                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct / 100)}
                transform="rotate(-90 55 55)"
                style={{ transition: "stroke-dashoffset 0.4s ease" }}
              />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{pct}%</span>
              <span style={{ fontSize: 10.5, color: "#64748b", marginTop: 3 }}>{processed} of {progress.total}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {chip("done", doneCount, TONE.good)}
            {chip("skipped", skippedCount, TONE.medium)}
            {chip("errors", errorCount, TONE.critical)}
          </div>
        </div>

        {/* Scrollable body: the current sub-criterion's live detail (replacing
            the separate modal that used to be hidden behind this overlay), then
            the per-sub-criterion sweep log. Header/ring above and Cancel below
            stay fixed, so Cancel is always reachable however long the detail. */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
          {running && <CurrentSubCriterionDetail />}

          {/* Live log: one colour-coded row per sub-criterion */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>Sweep progress</div>
            {progress.entries.length === 0
              ? <div style={{ fontSize: 12, color: TONE.neutral.fg }}>Starting…</div>
              : progress.entries.map((e, i) => {
                  const tone = toneOf(e.status);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 7, fontSize: 12, lineHeight: 1.8 }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone.fg, flexShrink: 0, alignSelf: "center", opacity: e.status === "waiting" ? 0.45 : 1 }} />
                      <span style={{ color: tone.fg, fontWeight: e.status === "running" ? 700 : 500, opacity: e.status === "waiting" ? 0.75 : 1 }}>{e.label}</span>
                      <span style={{ color: tone.fg, opacity: 0.85, fontSize: 11 }}>{statusWord(e)}</span>
                    </div>
                  );
                })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          {running ? (
            <button
              onClick={cancelBusy}
              title="Stops the audit: the in-flight AI call is aborted and no further sub-criteria are started"
              style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "7px 16px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff5f5", color: "#b23121" }}
            >
              Cancel
            </button>
          ) : (
            <>
              <button onClick={dismiss} style={{ cursor: "pointer", fontSize: 12.5, padding: "7px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#374151" }}>
                Close
              </button>
              <Link
                to="/final-report"
                onClick={dismiss}
                style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "7px 18px", borderRadius: 8, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff", textDecoration: "none" }}
              >
                View report →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The live, per-sub-criterion detail for the sub-criterion being assessed
// RIGHT NOW, shown inside the Full-auto overlay. Reads the same auditProgress
// state the standalone AuditProgressModal uses, so the user watches the
// current item unfold in the same view instead of behind it. Renders a
// waiting placeholder between sub-criteria (auditProgress momentarily null).
function CurrentSubCriterionDetail() {
  const p = useWorkspaceStore((s) => s.auditProgress);
  const box: React.CSSProperties = { background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px" };
  const heading = (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#6d28d9", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Current sub-criterion detail</div>
  );
  if (!p) {
    return <div style={box}>{heading}<div style={{ fontSize: 12, color: "#64748b" }}>Preparing the next sub-criterion…</div></div>;
  }
  const stat = (label: string, value: string) => (
    <span style={{ fontSize: 11.5, color: "#475569" }}><b style={{ color: "#334155" }}>{value}</b> {label}</span>
  );
  return (
    <div style={box}>
      {heading}
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>
        {p.subCriterionId} {p.folderName && p.folderName !== p.subCriterionId ? `· ${p.folderName}` : ""}
      </div>
      <div style={{ fontSize: 12, color: "#6d28d9", fontWeight: 600, marginBottom: 4 }}>
        {stageLabel(p.stage)}
        {p.stage === "auditing" && p.batchTotal ? ` — batch ${p.batchCurrent ?? 0}/${p.batchTotal}` : ""}
      </div>
      {p.stageDetail && (
        <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5, marginBottom: 6, whiteSpace: "pre-line" }}>{p.stageDetail}</div>
      )}
      {p.currentFileName && (p.stage === "reading" || p.stage === "condensing") && (
        <div style={{ fontSize: 11.5, color: "#475569", marginBottom: 6 }}>
          📄 <b>{p.currentFileName}</b>{p.currentFileBucket ? ` (${p.currentFileBucket})` : ""}{p.currentFileAction ? ` — ${p.currentFileAction}` : ""}
        </div>
      )}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {(p.filesRead != null || p.filesTotal != null) && stat("files read", `${p.filesRead ?? 0}${p.filesTotal ? `/${p.filesTotal}` : ""}`)}
        {p.linesAssessed != null && stat("lines assessed", String(p.linesAssessed))}
        {p.findingsDetected != null && stat("potential issues", String(p.findingsDetected))}
      </div>
      <div style={{ fontSize: 11, color: "#7c3aed", marginTop: 6 }}>
        Full auto — verdicts commit automatically as each sub-criterion finishes; no review gate.
      </div>
    </div>
  );
}

// The hybrid per-verdict approval gate now lives inside the post-analysis
// review modal (OptionAReviewModal → PpdReviewContent → HybridGatePanel),
// beside the per-line evidence rows that produced each verdict — not inline on
// this launch surface. See src/pages/PPDReview.tsx.

// Guidance for the Analysis path column: which of Option A / Option B to
// choose. One-line summary always visible; detail behind an expander.
function PathGuidance() {
  const [open, setOpen] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc", padding: "8px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1e293b" }}>
          Option B (default) runs in place and batches; Option A is the advanced, assessor-grade PPD-first check.
        </span>
        <button
          onClick={() => { setOpen((v) => !v); setModesOpen(false); }}
          style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, padding: "3px 9px", marginLeft: "auto" }}
        >
          {open ? "Hide" : "Which path?"}
        </button>
        <button
          onClick={() => { setModesOpen((v) => !v); setOpen(false); }}
          style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, padding: "3px 9px" }}
        >
          {modesOpen ? "Hide" : "Which mode?"}
        </button>
      </div>
      {modesOpen && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 2 }}>
            The audit mode is one choice for the whole cycle (set on Start Audit); the path (Option A/B) is chosen per sub-criterion and sets what gets assessed.
          </div>
          {AUDIT_MODES.map((m) => (
            <div key={m.value} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 11px", fontSize: 12, color: "#374151", lineHeight: 1.45 }}>
              <b style={{ color: "#1e293b" }}>{m.icon} {m.label}:</b> {m.desc} {m.best}
            </div>
          ))}
          <Link to="/start-audit" style={{ fontSize: 11.5, color: "#4338ca", fontWeight: 600, textDecoration: "none", marginTop: 2 }}>
            Change mode on the Start Audit page →
          </Link>
        </div>
      )}
      {open && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
          <div style={{ background: "#fff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
            <b style={{ color: "#5b21b6" }}>Option A: PPD + Evidence (advanced, deepest check).</b>{" "}
            Two steps: first checks whether your PPD documents each requirement, then checks the evidence against it.
            Slower and uses more AI, but mirrors how SSG assessors actually work. Most real EduTrust findings are
            "not documented in PPD" or "not implemented per PPD" gaps, which this path is built to catch. Use it for a
            thorough, assessor-grade check on the sub-criteria that matter.
          </div>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
            <b style={{ color: "#1e293b" }}>Option B: Staged audit (the default).</b>{" "}
            A single pass straight to APSR verdicts on the Sub-Criterion Checklist. Faster and cheaper, and simpler to review. Best for a quick first
            sweep to see where you stand, or when the PPD is already solid and you only need to check implementation.
            It blends policy and evidence into one verdict, so it is less likely to isolate a pure policy-documentation gap.
          </div>
        </div>
      )}
    </div>
  );
}

export function EvidenceFolder() {
  const folders        = useWorkspaceStore((s) => s.folders);
  const departments    = useWorkspaceStore((s) => s.departments);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const checkFolderAccess   = useWorkspaceStore((s) => s.checkFolderAccess);
  const probeFolder         = useWorkspaceStore((s) => s.probeFolder);
  const auditFolderStaged   = useWorkspaceStore((s) => s.auditFolderStaged);
  const runPPDReview        = useWorkspaceStore((s) => s.runPPDReview);
  const navigate            = useNavigate();
  const cancelBusy          = useWorkspaceStore((s) => s.cancelBusy);
  const clearFileTextCache  = useWorkspaceStore((s) => s.clearFileTextCache);
  const removeFileTextCacheEntry = useWorkspaceStore((s) => s.removeFileTextCacheEntry);
  const fileTextCacheSize   = useWorkspaceStore((s) => Object.keys(s.fileTextCache).length);
  const fileTextCacheEntries = useWorkspaceStore((s) => s.fileTextCache);
  const auditRunHistory      = useWorkspaceStore((s) => s.auditRunHistory);
  const skipCurrentFile         = useWorkspaceStore((s) => s.skipCurrentFile);
  const skipCurrentAuditStage   = useWorkspaceStore((s) => s.skipCurrentAuditStage);
  const busy                = useWorkspaceStore((s) => s.busy);
  const additionalInfo      = useWorkspaceStore((s) => s.additionalInfo);
  const setAdditionalInfoLink     = useWorkspaceStore((s) => s.setAdditionalInfoLink);
  const checkAdditionalInfoAccess = useWorkspaceStore((s) => s.checkAdditionalInfoAccess);
  const auditors       = useWorkspaceStore((s) => s.auditors);
  const activeAuditorId    = useWorkspaceStore((s) => s.activeAuditorId);
  const setActiveAuditor   = useWorkspaceStore((s) => s.setActiveAuditor);
  const auditProgress      = useWorkspaceStore((s) => s.auditProgress);
  const clearAuditProgress = useWorkspaceStore((s) => s.clearAuditProgress);
  const auditScope         = useWorkspaceStore((s) => s.auditScope);
  const setAuditScope      = useWorkspaceStore((s) => s.setAuditScope);
  const lastAuditRuns      = useWorkspaceStore((s) => s.lastAuditRuns);
  const analysisPath       = useWorkspaceStore((s) => s.analysisPath);
  const setAnalysisPath    = useWorkspaceStore((s) => s.setAnalysisPath);
  // Per-sub-criterion completion summary (Progress column) — read straight
  // from the stores the other pages use, so this row agrees with them.
  const ppdReviewResults    = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);
  const customFindings      = useWorkspaceStore((s) => s.customFindings);
  const scored              = useScored();
  // Automation mode per sub-criterion + the queue of verdicts awaiting review.
  const auditMode           = useWorkspaceStore((s) => s.auditMode);
  const fullAuditProgress   = useWorkspaceStore((s) => s.fullAuditProgress);
  const runFullAudit        = useWorkspaceStore((s) => s.runFullAudit);
  const pendingGates        = useWorkspaceStore((s) => Object.values(s.pendingCommits).reduce((a, r) => a + r.items.length, 0));
  const tip = useTip();

  const [checkingAdditional, setCheckingAdditional] = useState(false);
  const [viewingRun, setViewingRun] = useState<AuditRunRecord | null>(null);
  // Sub-criterion whose Option A (PPD + Evidence) review is open in the
  // near-fullscreen modal; null = closed. Running and re-opening both land here.
  const [optionAModal, setOptionAModal] = useState<string | null>(null);
  // Folder pre-flight probe results, keyed by folder id. Pre-flight results
  // persist in the store (survive ✕ + reload). Local state only tracks which
  // pre-flight panel is currently hidden from view.
  const folderProbes = useWorkspaceStore((s) => s.folderProbes);
  const probeProgress = useWorkspaceStore((s) => s.probeProgress);
  const setFolderProbe = useWorkspaceStore((s) => s.setFolderProbe);
  const [probeStripHidden, setProbeStripHidden] = useState<Set<string>>(new Set());
  const hideRunStrip = (id: string) => setProbeStripHidden((s) => new Set(s).add(id));
  const showRunStrip = (id: string) => setProbeStripHidden((s) => { const n = new Set(s); n.delete(id); return n; });

  const effectiveAuditor =
    auditors.find((a) => a.id === activeAuditorId) || auditors.find((a) => a.role === "Audit Lead") || auditors[0];
  const auditBlockedReason = useWorkspaceStore((s) => s.auditBlockedReason);
  const driveBlockedReason = useWorkspaceStore((s) => s.driveBlockedReason);
  const setDriveBlockedReason = useWorkspaceStore((s) => s.setDriveBlockedReason);
  const driveToken = useGoogleDriveStore((s) => s.accessToken);
  const driveConnecting = useGoogleDriveStore((s) => s.connecting);
  const driveClientId = useGoogleDriveStore((s) => s.clientId);
  const reviewPanelMode = useWorkspaceStore((s) => s.reviewPanelMode);
  const reviewPanelAuditorIds = useWorkspaceStore((s) => s.reviewPanelAuditorIds);
  const auditorDisplay = runAuditorDisplay(auditors, activeAuditorId);
  const panelNotice = panelUnderMinNotice(reviewPanelMode, auditors, reviewPanelAuditorIds);
  const noAuditors = auditors.length === 0;

  const [searchParams] = useSearchParams();
  const focusSub = searchParams.get("sub");
  const focusRun = searchParams.get("run");
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const openedRunParamRef = useRef<string | null>(null);

  // Deep link from the AI Review Log: ?run=<runId> opens that run's result
  // directly. Option B staged runs live in auditRunHistory/lastAuditRuns (open
  // the audit-run modal, which shows the file ledger); Option A evidence runs
  // live in evidenceAssessments (open the Option A review modal, which carries
  // the ledger CSV export). Previously only Option B was handled, so an Option A
  // run id landed on the page with nothing open — the "empty page" bug.
  useEffect(() => {
    if (!focusRun || openedRunParamRef.current === focusRun) return;
    let match: AuditRunRecord | undefined;
    for (const runs of Object.values(auditRunHistory)) { const r = runs.find((x) => x.runId === focusRun); if (r) { match = r; break; } }
    if (!match) match = Object.values(lastAuditRuns).find((r) => r.runId === focusRun);
    if (match) { openedRunParamRef.current = focusRun; setViewingRun(match); return; }
    const evMatch = Object.values(evidenceAssessments).find((ev) => ev.runId === focusRun);
    if (evMatch) { openedRunParamRef.current = focusRun; setOptionAModal(evMatch.subCriterionId); }
  }, [focusRun, auditRunHistory, lastAuditRuns, evidenceAssessments]);

  // Once a Drive token arrives, clear any "not connected" block so the banner
  // and per-row status flip to Connected without a reload (Fix 1).
  useEffect(() => {
    if (driveToken && driveBlockedReason?.reason === "not-connected") setDriveBlockedReason(null);
  }, [driveToken, driveBlockedReason, setDriveBlockedReason]);

  // Shared Connect action for every "Connect to Google Drive" affordance. If no
  // Client ID is configured yet, connect() can't run — send the user to
  // Settings where they set it. Otherwise kick off the OAuth token request.
  const connectDrive = () => {
    if (!driveClientId) { navigate(DRIVE_CONNECT_PATH); return; }
    useGoogleDriveStore.getState().connect().catch(() => {/* lastError shown in Settings */});
  };
  const ConnectDriveButton = ({ compact, label }: { compact?: boolean; label?: string }) => (
    <button
      type="button"
      onClick={connectDrive}
      disabled={driveConnecting}
      style={{
        fontSize: compact ? 11 : 12, fontWeight: 700, color: "#fff",
        background: driveConnecting ? "#94a3b8" : "#2563eb", border: "none",
        borderRadius: 6, padding: compact ? "3px 9px" : "5px 12px",
        cursor: driveConnecting ? "default" : "pointer", whiteSpace: "nowrap",
      }}
    >
      {driveConnecting ? "Connecting…" : label || "Connect to Google Drive"}
    </button>
  );
  // Card chip-to-editor toggles: Owner/Status render as compact chips and
  // expand to their dropdowns only when clicked; the Drive link inputs show
  // only while a card's links are being edited.
  const [editingField, setEditingField] = useState<{ id: string; field: "owner" | "status" } | null>(null);
  const [editingLinks, setEditingLinks] = useState<Set<string>>(new Set());
  const toggleEditingLinks = (id: string) =>
    setEditingLinks((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  // Collapsed by default — the "Access — Policy/Evidence" and "Audit result"
  // detail blocks under each sub-criterion row only show once the row is
  // expanded, keeping the table scannable when many folders are linked.
  const [expandedSubCritRows, setExpandedSubCritRows] = useState<Set<string>>(new Set());
  const toggleSubCritRow = (id: string) =>
    setExpandedSubCritRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  // Ensure a row is expanded (never collapses it) — used when an action needs
  // its result to be visible inside the row's expanded detail, e.g. running the
  // pre-flight check from the ⋯ menu on a currently-collapsed row.
  const expandSubCritRow = (id: string) => setExpandedSubCritRows((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  useEffect(() => {
    if (!focusSub) return;
    setExpandedSubCritRows((prev) => new Set(prev).add(focusSub));
    const row = rowRefs.current[focusSub];
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.style.transition = "background 0.3s";
    row.style.background = "#fff7e0";
    const t = setTimeout(() => { row.style.background = ""; }, 2200);
    return () => clearTimeout(t);
  }, [focusSub, folders]);

  const [critFilter, setCritFilter] = useState("");
  const [subFilter, setSubFilter]   = useState("");
  const criteria = useMemo(() => [...new Set(folders.map((f) => f.subCriterionId.split(".")[0]))].sort((a, b) => Number(a) - Number(b)), [folders]);
  const subCriteria = useMemo(
    () => folders.filter((f) => !critFilter || f.subCriterionId.split(".")[0] === critFilter).map((f) => ({ id: f.subCriterionId, name: f.folderName })),
    [folders, critFilter]
  );
  const visibleFolders = folders.filter(
    (f) => (!critFilter || f.subCriterionId.split(".")[0] === critFilter) && (!subFilter || f.subCriterionId === subFilter)
  );

  // One at-a-glance completion summary per sub-criterion, from the same
  // stores the other pages read (so counts always agree across screens).
  // Split PER PATH so the Progress chips and "View results" can follow the
  // row's A/B toggle: `a` reflects Option A's PPD review / Evidence
  // assessment, `b` reflects the Option B staged run (its policy + evidence
  // passes, from the run record's scope). findingsCount/bandLabel stay
  // sub-criterion-level — both paths write to the SAME checklist and
  // register (the one-truth design), so those numbers are shared; the chips
  // gate them on whether the selected path has actually run.
  const subCritProgress = useMemo(() => {
    const map: Record<string, {
      a: { ppdDone: boolean; evidenceDone: boolean; run: boolean };
      b: { policyDone: boolean; evidenceDone: boolean; run: boolean };
      compileDone: boolean; findingsCount: number; bandLabel: string;
    }> = {};
    for (const f of folders) {
      const sc = f.subCriterionId;
      const itemIds = new Set(GD4_REQUIREMENTS.filter((r) => r.subCriterionId === sc).map((r) => r.id));
      const ppd = ppdReviewResults[sc];
      const ev = evidenceAssessments[sc];
      const a = {
        ppdDone: !!ppd && ppd.rows.length > 0,
        evidenceDone: !!ev && ev.rows.length > 0,
        run: (!!ppd && ppd.rows.length > 0) || (!!ev && ev.rows.length > 0),
      };
      // Option B: the last staged/classic run on this folder. The run
      // record's scope says which passes ran; a legacy lastAuditAt without a
      // record counts as a full run.
      const rec = lastAuditRuns[f.id];
      const bRun = !!rec || !!f.lastAuditAt;
      const b = {
        policyDone: rec ? rec.scope !== "evidence" : bRun,
        evidenceDone: rec ? rec.scope !== "policy" : bRun,
        run: bRun,
      };
      // Compile done when any Evidence-tab row or PPD contradiction has been
      // compiled into the register (Option B auto-raises, so a completed
      // staged audit also counts).
      const compileDone =
        (!!ev && ev.rows.some((r) => r.savedFindingId)) ||
        (!!ppd?.contradictions && ppd.contradictions.some((c) => c.savedFindingId)) ||
        (bRun && customFindings.some((cf) => itemIds.has(cf.gd4ItemId)));
      const findingsCount = customFindings.filter((cf) => itemIds.has(cf.gd4ItemId)).length;
      const startedBands = scored.items.filter((i) => i.subCriterionId === sc && i.started).map((i) => i.band);
      const bandLabel = startedBands.length === 0
        ? "–"
        : Math.min(...startedBands) === Math.max(...startedBands)
          ? String(startedBands[0])
          : `${Math.min(...startedBands)}–${Math.max(...startedBands)}`;
      map[sc] = { a, b, compileDone, findingsCount, bandLabel };
    }
    return map;
  }, [folders, ppdReviewResults, evidenceAssessments, customFindings, scored.items, lastAuditRuns]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
  const [showCacheList, setShowCacheList] = useState(false);
  const [modeChipHidden, setModeChipHidden] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [dismissedAccessNotes, setDismissedAccessNotes] = useState<Set<string>>(new Set());
  const [dismissedAuditResults, setDismissedAuditResults] = useState<Set<string>>(new Set());

  const dismissAccessNote  = (key: string) => setDismissedAccessNotes((s) => new Set([...s, key]));
  const dismissAuditResult = (key: string) => setDismissedAuditResults((s) => new Set([...s, key]));

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(`overflow-${overflowOpen}`);
      if (el && !el.contains(e.target as Node)) setOverflowOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  // CSV export helpers for the live progress modal
  const handleExportFileLedger = () => {
    if (!auditProgress) return;
    const run = progressToRunRecord(auditProgress);
    const csv = exportFileLedgerCsv(run);
    downloadCsv(csv, auditCsvFilename("gd4-audit-file-ledger", run));
  };

  const handleExportAISummary = () => {
    if (!auditProgress) return;
    const run = progressToRunRecord(auditProgress);
    const csv = exportAISummaryCsv(run);
    downloadCsv(csv, auditCsvFilename("gd4-audit-ai-summary", run));
  };

  // Build a lookup: cacheKey (fileId:modifiedTime) → { name, path, subCriterionId }
  // sourced from every run in auditRunHistory so old cache entries get a readable name.
  const cacheKeyMeta = useMemo(() => {
    const map: Record<string, { name: string; path: string; subCriterionId: string }> = {};
    for (const runs of Object.values(auditRunHistory)) {
      for (const run of runs) {
        for (const f of run.fileLedger) {
          if (f.driveFileId) {
            const key = `${f.driveFileId}:${f.driveModifiedTime ?? ""}`;
            if (!map[key]) map[key] = { name: f.name, path: f.path, subCriterionId: run.subCriterionId };
          }
        }
      }
    }
    return map;
  }, [auditRunHistory]);

  // Surface the verdict review straight after a run. The moment a single
  // staged (Option B) run completes, swap the live progress dialog for the
  // run's review panel (AuditRunModal, which hosts the accept / reject / edit
  // gate) so the auditor acts on the verdicts in place instead of closing this
  // and reopening the previous run. Fires once per run; never during a
  // full-auto sweep (that commits automatically and shows its own overlay).
  // This only OPENS the panel - it never accepts, edits or discards anything,
  // and it reuses the same lastAuditRuns record that "View results" reopens.
  const autoOpenedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!auditProgress || auditProgress.stage !== "complete") return;
    if (fullAuditProgress?.status === "running") return;
    const rec = lastAuditRuns[auditProgress.folderId];
    if (!rec || rec.status !== "completed") return;
    if (autoOpenedRunIdRef.current === rec.runId) return;
    autoOpenedRunIdRef.current = rec.runId;
    setViewingRun(rec);
    clearAuditProgress();
  }, [auditProgress, fullAuditProgress, lastAuditRuns, clearAuditProgress]);

  return (
    <>
    {/* During Full auto the per-folder detail is shown INSIDE FullAuditOverlay
        instead — rendering this separate modal too would stack two full-screen
        dialogs and hide the detail behind the sweep overlay. */}
    {auditProgress && fullAuditProgress?.status !== "running" && (
      <AuditProgressModal
        progress={auditProgress}
        onClose={clearAuditProgress}
        onCancel={() => { cancelBusy(); clearAuditProgress(); }}
        onSkipFile={skipCurrentFile}
        onSkipStage={skipCurrentAuditStage}
        onExportFileLedger={handleExportFileLedger}
        onExportAISummary={handleExportAISummary}
        onViewResults={() => {
          // Open the saved result in its review modal (Option A review modal /
          // Option B audit-run modal) instead of navigating to a separate page.
          const scid = auditProgress.subCriterionId ?? "";
          const isA = resolveAnalysisPath(analysisPath, scid) === "A";
          clearAuditProgress();
          if (isA) { setOptionAModal(scid); return; }
          const rec = lastAuditRuns[auditProgress.folderId];
          if (rec) setViewingRun(rec);
        }}
      />
    )}
    {viewingRun && (
      <AuditRunModal run={viewingRun} onClose={() => setViewingRun(null)} />
    )}
    {optionAModal && (
      <OptionAReviewModal subCriterionId={optionAModal} onClose={() => setOptionAModal(null)} />
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
            One evidence folder per GD4 sub-criterion. "Run audit" reads every supported file, judges each checklist line with AI, and writes verdicts.
            Use the scope selector to audit only Policy or only Evidence files. Files are cached — unchanged Drive files are reused on repeat audits.
            "View last run" reopens the read-only audit record with full file ledger and AI summary CSVs.
          </p>
          {/* Folder-prep conventions the audit's file classifier depends on —
              previously only implied, so misnamed subfolders silently
              misclassified files and the operator only found out post-run. */}
          <div style={{ fontSize: 12, color: "#374151", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "9px 12px", marginBottom: 8 }}>
            <b style={{ color: "#0369a1" }}>How to prepare each Drive folder (the audit depends on these exact names):</b>
            <ul style={{ margin: "5px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
              <li>When one shared folder is linked for both tabs, name its two subfolders exactly <b>“1. Policy &amp; Procedure”</b> and <b>“2. Actual Evidence”</b> — files are classified by this path prefix, and a misnamed subfolder silently puts files in the wrong bucket.</li>
              <li><b>Policy &amp; Procedure</b> = the documented approach: the PPD, SOPs, frameworks. <b>Actual Evidence</b> = records of DOING it: filled forms, registers, logs, minutes, screenshots. A policy filed under Evidence earns no implementation credit.</li>
              <li>Evidence the AI can credit is <b>dated, named and in-period</b>: records covering the review period, with owners/signatures and dates visible. Undated or cut-off-breaching documents are graded down.</li>
              <li>Scanned/image-only PDFs extract little text — prefer digital originals or spreadsheets where they exist.</li>
            </ul>
          </div>
          {fileTextCacheSize > 0 && (
            <div style={{ marginBottom: 8, background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 7, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
                <span style={{ fontSize: 12, color: "#6d28d9" }}>♻ {fileTextCacheSize} file{fileTextCacheSize !== 1 ? "s" : ""} cached from previous audits</span>
                {/* Both controls right-aligned: View/Hide files sits beside Clear cache. */}
                <button
                  onClick={() => setShowCacheList((v) => !v)}
                  style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid #c4b5fd", background: "#fff", borderRadius: 5, fontSize: 11, padding: "2px 8px", color: "#7c3aed" }}
                >
                  {showCacheList ? "Hide files" : "View files"}
                </button>
                <button
                  onClick={() => { if (confirm("Are you sure you want to clear the cache? Files will need to be re-read next time.")) { clearFileTextCache(); setShowCacheList(false); } }}
                  style={{ cursor: "pointer", border: "1px solid #c4b5fd", background: "#fff", borderRadius: 5, fontSize: 11, padding: "2px 8px", color: "#7c3aed" }}
                >
                  Clear cache
                </button>
              </div>
              {showCacheList && (
                <div style={{ borderTop: "1px solid #c4b5fd", maxHeight: 300, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                      <tr style={{ background: "#ede9fe" }}>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>#</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>File name</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>Sub-criterion</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>Kind</th>
                        <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>Chars</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }}>Cached</th>
                        <th style={{ textAlign: "center", padding: "4px 8px", fontWeight: 600, color: "#5b21b6" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(fileTextCacheEntries).map(([key, entry], i) => {
                        const meta = cacheKeyMeta[key];
                        const displayName = entry.fileName ?? meta?.name ?? key.split(":")[0];
                        const displayPath = entry.filePath ?? meta?.path;
                        const subCrit = meta?.subCriterionId ?? "—";
                        const cachedLabel = entry.cachedAt
                          ? new Date(entry.cachedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
                          : "—";
                        return (
                          <tr key={key} style={{ background: i % 2 === 0 ? "#faf5ff" : "#f5f3ff", borderTop: "1px solid #ede9fe" }}>
                            <td style={{ padding: "3px 8px", color: "#7c3aed", fontWeight: 700 }}>{i + 1}</td>
                            <td style={{ padding: "3px 8px", color: "#1e293b", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayPath ?? displayName}>
                              {displayName}
                            </td>
                            <td style={{ padding: "3px 8px", color: "#6b7280", whiteSpace: "nowrap" }}>{subCrit}</td>
                            <td style={{ padding: "3px 8px", color: "#6b7280" }}>{entry.fileKind}</td>
                            <td style={{ padding: "3px 8px", color: "#6b7280", textAlign: "right", fontFamily: "ui-monospace,monospace" }}>
                              {entry.charCount > 0 ? entry.charCount.toLocaleString() : "—"}
                            </td>
                            <td style={{ padding: "3px 8px", color: "#94a3b8", whiteSpace: "nowrap", fontFamily: "ui-monospace,monospace", fontSize: 10 }}>{cachedLabel}</td>
                            <td style={{ padding: "3px 8px", textAlign: "center" }}>
                              <button
                                onClick={() => removeFileTextCacheEntry(key)}
                                title={`Remove ${displayName} from the cache — the next audit will re-download it from Drive`}
                                style={{ cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 13, lineHeight: 1, padding: "0 4px" }}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", background: "#f8fafc", marginBottom: 10, fontSize: 12 }}>
            <b style={{ fontSize: 11.5, color: "#475569" }}>Link two folders per sub-criterion:</b>
            <ol style={{ margin: "4px 0 4px", paddingLeft: 18, color: "#475569" }}>
              <li><b>Policy &amp; Procedure</b> — the documented approach</li>
              <li><b>Actual Evidence</b> — records showing it is implemented</li>
            </ol>
          </div>
        </>
      )}

      {/* Additional info folder */}
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
          <div style={{ fontSize: 11.5, color: "#6b7280" }}>
            {additionalInfo.accessNote}{additionalInfo.accessAt && <span style={{ color: "#94a3b8" }}> — checked {new Date(additionalInfo.accessAt).toLocaleString()}</span>}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Filter</span>
        <select value={critFilter} onChange={(e) => { setCritFilter(e.target.value); setSubFilter(""); }} style={{ ...inputStyle, width: 150, padding: "5px 6px" }}>
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
          {visibleFolders.length} of {folders.length}
        </span>
      </div>

      {/* Blocking guard — a run was refused (or would be) because no auditor
          can be attributed. Rendered above the run controls so it can't be
          missed; links straight to the page that fixes it. */}
      {(auditBlockedReason || auditors.length === 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "9px 12px", background: "#fbe7e3", border: "1px solid #f2b8ae", borderRadius: 8, fontSize: 12.5, color: "#b23121", fontWeight: 600 }}>
          <span aria-hidden>⛔</span>
          <span style={{ flex: 1, minWidth: 240 }}>{auditBlockedReason || MSG_NO_AUDITORS_EXIST}</span>
          <Link to={AUDITOR_CREATION_PATH} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b23121", borderRadius: 6, padding: "5px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>
            Go to Auditor Creation →
          </Link>
        </div>
      )}

      {/* Drive-connection guard — a run was refused because the folder isn't
          connected (or nothing is linked). Distinct from a genuine read
          failure, which surfaces on the row's audit result. Offers Connect
          inline when connecting would fix it (Fixes 2-5). */}
      {driveBlockedReason && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "9px 12px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 12.5, color: "#92600a", fontWeight: 600 }}>
          <span aria-hidden>🔌</span>
          <span style={{ flex: 1, minWidth: 240 }}>{driveBlockedReason.message}</span>
          {driveBlockedReason.canConnect && <ConnectDriveButton />}
        </div>
      )}

      {/* Auditor + scope selectors */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Run audit as</span>
        {auditors.length === 0 ? (
          <span style={{ fontSize: 12, color: "#b23121" }}>
            No auditors yet — add one on <Link to="/auditors" style={{ color: "#2563eb" }}>Auditor Creation</Link>.
          </span>
        ) : (
          <select
            value={activeAuditorId || effectiveAuditor?.id || ""}
            onChange={(e) => setActiveAuditor(e.target.value || null)}
            style={{ ...inputStyle, width: 230, padding: "5px 6px" }}
          >
            {auditors.map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {a.role} ({a.strictness})</option>
            ))}
          </select>
        )}
        {/* Who the run will be attributed to, at a glance (name + perspective).
            Unassigned renders as a warning, never as neutral text. */}
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, ...(auditorDisplay.unassigned ? { color: "#b23121", background: "#fbe7e3", border: "1px solid #f2b8ae" } : { color: "#1f7a4d", background: "#e3f3ea", border: "1px solid #bfe3cf" }) }}>
          {auditorDisplay.unassigned ? "⚠ " : ""}{auditorDisplay.text}
        </span>
        {panelNotice && (
          <span style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "3px 9px" }}>
            ⚠ {panelNotice} <Link to={AUDITOR_CREATION_PATH} style={{ color: "#2563eb" }}>Auditor Creation</Link>
          </span>
        )}
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3, marginLeft: 8 }}>Scope</span>
        <select
          value={auditScope}
          onChange={(e) => setAuditScope(e.target.value as AuditScope)}
          style={{ ...inputStyle, width: 200, padding: "5px 6px" }}
          title="Which source folders to read"
        >
          {SCOPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {auditScope !== "both" && (
          <span style={{ fontSize: 11, color: "#b45309", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 5, padding: "2px 8px" }}>
            ⚠ Partial scope — only {auditScope === "policy" ? "Policy" : "Evidence"} files will be read
          </span>
        )}
      </div>

      <NextStepBanner
        text={nextStepText("evidence-folder", {
          mode: auditMode,
          linkedFolders: folders.filter((f) => (f.folderLink && f.folderLink.trim()) || (f.policyLink && f.policyLink.trim())).length,
          totalFolders: folders.length,
          pendingGates,
          fullAuditRunning: fullAuditProgress?.status === "running",
        })}
      />
      <Walkthrough
        pageId="evidence-folder"
        steps={auditMode === "manual" ? [
          { targetId: "wt-mode-chip", title: "Your audit mode", body: "You are in Manual mode: the AI decides nothing. Change the mode here any time." },
          { targetId: "wt-folders-table", title: "Work through each sub-criterion", body: "Open a sub-criterion's checklist from its row and enter verdicts yourself. Ask the AI for a suggestion on any item when you want one." },
        ] : [
          { targetId: "wt-mode-chip", title: "Your audit mode", body: `You are in ${auditModeLabel(auditMode)} mode. This strip always shows the mode; use 'Change mode' to switch.` },
          { targetId: "wt-folders-table", title: "Link your folders", body: "Each sub-criterion has a Policy and an Evidence Drive link. Paste them here and check access before running." },
          { targetId: "wt-path-guidance", title: "Pick the path, then run", body: auditMode === "full-auto" ? "Option A or B per row sets WHAT gets assessed. Then one click on 'Run full audit' at the top assesses everything." : "Option A or B per row sets WHAT gets assessed. Then click the row's run button; in Hybrid mode you approve each result inside its review, beside the evidence that produced it, before it commits." },
        ]}
      />

      {/* Pre-run mode banner — shown before any run entry point on this page
          (Option A "Run review", Option B "Run audit", and "Run full audit")
          so an offline run never begins silently. */}
      <div style={{ marginBottom: 10 }}><RunModeBanner /></div>

      {/* Cycle mode chip + Full-auto master action. The chip is instructional
          (it just states the current mode), so its ✕ dismiss is EPHEMERAL —
          local state, reappears on reload — matching the other instructional
          tips. In Full-auto the SAME chip hosts the "Run full audit" action, so
          the ✕ is not offered there (hiding it would hide the run control);
          full-auto therefore never hides. */}
      {!(modeChipHidden && auditMode !== "full-auto") && (
      <div id="wt-mode-chip" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, padding: "8px 12px", border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#5b21b6" }}>
          Audit mode: {auditModeLabel(auditMode)}
        </span>
        <Link to="/start-audit" title={tip("Choose how much the AI does: Full auto, Hybrid or Manual")} style={{ fontSize: 11.5, color: "#4338ca", fontWeight: 600, textDecoration: "none" }}>
          Change mode →
        </Link>
        <WalkthroughLink pageId="evidence-folder" />
        {auditMode === "full-auto" ? (
          <button
            id="wt-run-full-audit"
            onClick={() => runFullAudit()}
            disabled={!!busy || fullAuditProgress?.status === "running" || noAuditors}
            title={noAuditors ? MSG_NO_AUDITORS_EXIST : tip("Runs every sub-criterion with folder links end to end, using each row's Option A/B choice. Folders without links are marked 'Not assessed / no evidence'.")}
            style={{ marginLeft: "auto", cursor: busy || noAuditors ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "7px 16px", borderRadius: 8, border: "1px solid #7c3aed", background: noAuditors ? "#c4b5fd" : "#7c3aed", color: "#fff" }}
          >
            ⚡ Run full audit
          </button>
        ) : (
          <DismissX onClick={() => setModeChipHidden(true)} title="Hide for now (reappears on reload)" color="#7c3aed" />
        )}
      </div>
      )}

      <div id="wt-path-guidance"><PathGuidance /></div>
      {fullAuditProgress && <FullAuditOverlay />}

      {/* Card list — one self-contained card per sub-criterion. Everything
          stacks vertically and wraps; the container never scrolls sideways. */}
      <div id="wt-folders-table" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visibleFolders.map((f) => {
          const isBusy = busy === "folderaudit" + f.id;
          const auditDismissKey = `${f.id}:${f.lastAuditRunId || f.lastAuditAt || ""}`;
          const policyDismissKey = `${f.id}:policy:${f.policyAccessAt || ""}`;
          const evidenceDismissKey = `${f.id}:evidence:${f.accessCheckAt || ""}`;
          const lastRun = lastAuditRuns[f.id];
          const rowExpanded = expandedSubCritRows.has(f.id);
          const path = resolveAnalysisPath(analysisPath, f.subCriterionId);
          const prog = subCritProgress[f.subCriterionId];
          const firstItemId = GD4_REQUIREMENTS.find((r) => r.subCriterionId === f.subCriterionId)?.id;
          const linksEditing = editingLinks.has(f.id);
          const rowLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, minWidth: 58, flexShrink: 0 };
          const chipBtn: React.CSSProperties = { cursor: "pointer", fontSize: 11, fontWeight: 600, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#374151", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" };
          const linkChip = (kind: "policy" | "evidence") => {
            const link = kind === "policy" ? f.policyLink : f.folderLink;
            const status = kind === "policy" ? f.policyAccessStatus : f.accessCheckStatus;
            const connected = status === "Connected";
            const readFailed = !!link && !!driveToken && status === "Error";
            const label = kind === "policy" ? "Policy" : "Evidence";
            // Two distinct problem states, each with its own action (Fix 2/3):
            //  • no token at all  → "Connect to Google Drive" (starts auth).
            //  • connected but this folder's access check failed → "Reconnect".
            const showConnect = !!link && !driveToken;
            const statusText = !link
              ? "Not linked"
              : !driveToken
                ? "Not connected"
                : connected
                  ? "Connected"
                  : readFailed
                    ? "Can't read"
                    : "Linked";
            const chipTone = connected ? TONE.good : readFailed ? TONE.critical : link ? TONE.medium : TONE.neutral;
            return (
              <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                <button
                  onClick={() => toggleEditingLinks(f.id)}
                  title={tip(`${label} folder: ${link ? (driveToken ? (connected ? "connected" : readFailed ? "connected, but this folder could not be read — check Viewer access / Shared Drive membership" : "linked, access not confirmed") : "linked, but Google Drive is not connected") : "no Drive link yet"}. Click to ${link ? "edit" : "add"} the link.`)}
                  style={{ ...chipBtn, color: chipTone.fg, background: chipTone.bg, border: "none" }}
                >
                  {label}: {statusText}
                </button>
                {showConnect && <ConnectDriveButton compact />}
                {readFailed && <ConnectDriveButton compact label="Reconnect" />}
              </span>
            );
          };
          const primaryStyle: React.CSSProperties = { cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 7, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff", textDecoration: "none", display: "inline-block", width: 128, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
          const overflowItem = (label: string, onClick: () => void, opts?: { disabled?: boolean; title?: string; last?: boolean }) => (
            <button
              key={label}
              disabled={opts?.disabled}
              title={opts?.title}
              onClick={() => { onClick(); setOverflowOpen(null); }}
              style={{ display: "block", width: "100%", textAlign: "left", cursor: opts?.disabled ? "wait" : "pointer", fontSize: 12, padding: "8px 12px", border: "none", background: "transparent", color: "#374151", borderBottom: opts?.last ? "none" : "1px solid #f1f5f9" }}
            >
              {label}
            </button>
          );
          const progChip = (label: string, value: string, on: boolean, onColor: string) => (
            <span key={label} style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, color: on ? onColor : "#94a3b8", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
              {label} {value}
            </span>
          );
          return (
            <div
              key={f.id}
              ref={(el) => { rowRefs.current[f.subCriterionId] = el; }}
              style={{ border: "1px solid #e2e8f0", borderLeft: "4px solid #7c3aed", borderRadius: 10, background: "#fff", maxWidth: "100%" }}
            >
              {/* Header: name (click to expand details) + Status/Owner chips */}
              <div
                onClick={() => toggleSubCritRow(f.id)}
                title={rowExpanded ? "Collapse access/audit details" : "Expand access/audit details"}
                style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "9px 12px 6px", cursor: "pointer" }}
              >
                <span style={{ color: "#64748b", fontSize: 17, lineHeight: 1, flexShrink: 0, transition: "transform 0.15s", transform: rowExpanded ? "rotate(90deg)" : "none" }}>▸</span>
                <b style={{ fontSize: 13 }}>{f.folderName}</b>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                  {editingField?.id === f.id && editingField.field === "status" ? (
                    <select
                      autoFocus
                      value={f.status}
                      onBlur={() => setEditingField(null)}
                      onChange={(e) => { setFolderField(f.id, "status", e.target.value as FolderStatus); setEditingField(null); }}
                      style={{ ...inputStyle, width: 120, padding: "3px 6px", fontSize: 11 }}
                    >
                      {STATUSES.map((st) => <option key={st}>{st}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingField({ id: f.id, field: "status" })} title={tip("Folder workflow status. Click to change.")} style={chipBtn}>
                      {f.status}
                    </button>
                  )}
                  {editingField?.id === f.id && editingField.field === "owner" ? (
                    <select
                      autoFocus
                      value={f.owner}
                      onBlur={() => setEditingField(null)}
                      onChange={(e) => { setFolderField(f.id, "owner", e.target.value); setEditingField(null); }}
                      style={{ ...inputStyle, width: 110, padding: "3px 6px", fontSize: 11 }}
                    >
                      <option value="">(unassigned)</option>
                      {departments.map((d) => <option key={d.id} value={d.acronym}>{d.acronym}</option>)}
                    </select>
                  ) : (
                    <button onClick={() => setEditingField({ id: f.id, field: "owner" })} title={tip("Owning department. Click to change.")} style={chipBtn}>
                      Owner: {f.owner || "—"}
                    </button>
                  )}
                </span>
              </div>

              <div className="ef-card-cols" style={{ padding: "2px 12px 8px 30px" }}>
              {/* LEFT COLUMN — the setup choices: Links + Path */}
              <div className="ef-col-left">
              {/* Links: compact chips; inputs appear only while editing */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }}>
                <span style={rowLabel}>Links</span>
                {linkChip("policy")}
                {linkChip("evidence")}
                {f.policyLink && <a href={f.policyLink} target="_blank" rel="noreferrer" title="Open the Policy folder in Drive" style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>Policy ↗</a>}
                {f.folderLink && <a href={f.folderLink} target="_blank" rel="noreferrer" title="Open the Evidence folder in Drive" style={{ fontSize: 11, color: "#16a34a", textDecoration: "none" }}>Evidence ↗</a>}
              </div>
              {linksEditing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 0 6px" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", minWidth: 58, textTransform: "uppercase", letterSpacing: 0.3 }}>Policy</span>
                    <input
                      placeholder="Policy folder link…"
                      value={f.policyLink || ""}
                      onChange={(e) => setFolderField(f.id, "policyLink", e.target.value)}
                      style={{ ...inputStyle, flex: 1, minWidth: 180, padding: "4px 6px", fontSize: 11 }}
                    />
                    {f.policyAccessStatus && <Pill s={ACCESS_TONE[f.policyAccessStatus]}>{f.policyAccessStatus}</Pill>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", minWidth: 58, textTransform: "uppercase", letterSpacing: 0.3 }}>Evidence</span>
                    <input
                      placeholder="Evidence folder link…"
                      value={f.folderLink || ""}
                      onChange={(e) => setFolderField(f.id, "folderLink", e.target.value)}
                      style={{ ...inputStyle, flex: 1, minWidth: 180, padding: "4px 6px", fontSize: 11 }}
                    />
                    {f.accessCheckStatus && <Pill s={ACCESS_TONE[f.accessCheckStatus]}>{f.accessCheckStatus}</Pill>}
                  </div>
                  <button onClick={() => toggleEditingLinks(f.id)} style={{ alignSelf: "flex-start", cursor: "pointer", fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b" }}>
                    Done
                  </button>
                </div>
              )}

              {/* Path: compact A/B chips + Option A sub-steps */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }}>
                <span style={rowLabel}>Path</span>
                <button
                  onClick={() => setAnalysisPath(f.subCriterionId, "A")}
                  title={tip("Option A (PPD + Evidence), two steps: checks whether the PPD documents each requirement, then checks the evidence against it. Slower, but mirrors how SSG assessors work." + (prog?.a.run ? " Option A has saved results." : ""))}
                  style={{ ...chipBtn, border: `1.5px solid ${path === "A" ? "#7c3aed" : "#e2e8f0"}`, background: path === "A" ? "#faf5ff" : "#fff", color: path === "A" ? "#5b21b6" : "#64748b", fontWeight: 700 }}
                >
                  {path === "A" ? "◉" : "○"} A · PPD + Evidence
                  {prog?.a.run && <span title="Option A has saved results" style={{ marginLeft: 4, color: "#15803d", fontWeight: 800 }}>✓</span>}
                </button>
                <button
                  onClick={() => setAnalysisPath(f.subCriterionId, "B")}
                  title={tip("Option B (Staged audit): a single pass straight to APSR verdicts on the Sub-Criterion Checklist. Faster and cheaper; best for a quick first sweep." + (prog?.b.run ? " Option B has saved results." : ""))}
                  style={{ ...chipBtn, border: `1.5px solid ${path === "B" ? "#7c3aed" : "#e2e8f0"}`, background: path === "B" ? "#faf5ff" : "#fff", color: path === "B" ? "#5b21b6" : "#64748b", fontWeight: 700 }}
                >
                  {path === "B" ? "◉" : "○"} B · Staged audit
                  {prog?.b.run && <span title="Option B has saved results" style={{ marginLeft: 4, color: "#15803d", fontWeight: 800 }}>✓</span>}
                </button>
                {path === "A" && (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 10.5, flexWrap: "wrap" }} title="Option A runs in three steps in the full-screen review (PPD → Evidence → Compile findings)">
                    {([
                      { n: 1, label: "PPD", done: !!prog?.a.ppdDone },
                      { n: 2, label: "Evidence", done: !!prog?.a.evidenceDone && !!prog?.a.ppdDone },
                      { n: 3, label: "Compile", done: !!prog?.compileDone },
                    ]).map((st, i) => (
                      <Fragment key={st.n}>
                        {i > 0 && <span style={{ color: "#cbd5e1" }}>·</span>}
                        <span style={{ color: st.done ? "#15803d" : "#94a3b8", fontWeight: st.done ? 700 : 400, whiteSpace: "nowrap" }}>
                          {st.done ? "✓" : st.n} {st.label}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                )}
              </div>

              </div>
              {/* RIGHT COLUMN — status + what to do: Progress + Action */}
              <div className="ef-col-right">
              {/* Progress: completion chips for the SELECTED path (the A/B
                  toggle is the single source of "which path am I viewing").
                  PPD/Evidence reflect that path's own passes; Findings/Band
                  are the shared checklist truth, shown once the selected
                  path has run and "–" otherwise. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }} title={tip(`Completion summary for Option ${path} on this sub-criterion: ${path === "A" ? "PPD review run, evidence assessed" : "policy pass, evidence pass"}, findings raised, checklist band. Toggle the path to see the other option's progress.`)}>
                <span style={rowLabel}>Progress</span>
                {prog ? (() => {
                  const sel = path === "A"
                    ? { ppd: prog.a.ppdDone, ev: prog.a.evidenceDone, run: prog.a.run }
                    : { ppd: prog.b.policyDone, ev: prog.b.evidenceDone, run: prog.b.run };
                  return (
                    <>
                      {progChip(path === "A" ? "PPD" : "Policy", sel.ppd ? "✓" : "–", sel.ppd, "#15803d")}
                      {progChip("Evidence", sel.ev ? "✓" : "–", sel.ev, "#15803d")}
                      {progChip("Findings", sel.run ? String(prog.findingsCount) : "–", sel.run && prog.findingsCount > 0, "#b45309")}
                      {progChip("Band", sel.run ? prog.bandLabel : "–", sel.run && prog.bandLabel !== "–", "#4338ca")}
                    </>
                  );
                })() : (
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>–</span>
                )}
              </div>

              {/* Action: one short primary + View results + overflow */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "3px 0" }}>
                <span style={rowLabel}>Action</span>
                {isBusy ? (
                  <>
                    <button disabled style={{ cursor: "wait", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1d4ed8", whiteSpace: "nowrap", opacity: 0.8 }}>
                      Auditing…
                    </button>
                    <button onClick={cancelBusy} style={{ cursor: "pointer", fontSize: 11, padding: "6px 9px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff", color: "#b23121", whiteSpace: "nowrap" }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {auditMode === "full-auto" ? (
                      <button
                        disabled
                        title={tip("Full auto mode: per-card runs are locked. Use the single 'Run full audit' button at the top of this page, or change the mode on Start Audit.")}
                        style={{ ...primaryStyle, cursor: "not-allowed", background: "#e2e8f0", border: "1px solid #cbd5e1", color: "#94a3b8" }}
                      >
                        Locked
                      </button>
                    ) : auditMode === "manual" ? (
                      <Link
                        to={firstItemId ? `/sub-checklist?item=${firstItemId}` : "/sub-checklist"}
                        title={tip("Manual mode: the AI decides nothing. Enter each verdict yourself in the Sub-Criterion Checklist; AI suggestions are available per item on request.")}
                        style={primaryStyle}
                      >
                        Open checklist →
                      </Link>
                    ) : path === "A" ? (
                      // Option A is multi-step (PPD → evidence → compile).
                      // Clicking here STARTS the first step (PPD review) and
                      // opens the near-fullscreen review MODAL over this page
                      // — same action shape as Option B's "Run audit", no
                      // page navigation. (The PPD Review page route still
                      // works for deep links.)
                      <button
                        onClick={() => { runPPDReview(f.subCriterionId); setOptionAModal(f.subCriterionId); }}
                        disabled={noAuditors}
                        title={noAuditors ? MSG_NO_AUDITORS_EXIST : tip("Option A (PPD + Evidence): starts the PPD review now and opens the full review, where you continue with the evidence assessment and compile findings. In Hybrid mode you approve, edit or reject each verdict inside that review — beside the evidence rows that produced it — before it commits.")}
                        style={{ ...primaryStyle, ...(noAuditors ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                      >
                        Run review
                      </button>
                    ) : (
                      <button
                        onClick={() => auditFolderStaged(f.id, "all")}
                        disabled={noAuditors}
                        title={noAuditors ? MSG_NO_AUDITORS_EXIST : tip("Option B (Staged audit): policy, evidence, then outcome and review passes produce APSR verdicts. In Hybrid mode they are queued for your approval — open the review to approve, edit or reject each verdict beside its evidence before it commits.")}
                        style={{ ...primaryStyle, ...(noAuditors ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                      >
                        Run audit →
                      </button>
                    )}
                    {/* ONE "View results" re-open per row — identical label,
                        style and position for both paths. It opens the saved
                        result for the path currently SELECTED in the A/B
                        toggle (the single source of "which path am I
                        viewing") with no AI call: A → the review modal,
                        B → the audit-run record. Shown only when the SELECTED
                        path has a saved result; toggling A/B is a pure view
                        switch — both results coexist untouched. */}
                    {(() => {
                      const hasA = !!(ppdReviewResults[f.subCriterionId] || evidenceAssessments[f.subCriterionId]);
                      const selectedHasResult = path === "A" ? hasA : !!lastRun;
                      if (!selectedHasResult) return null;
                      return (
                        <button
                          onClick={() => (path === "A" ? setOptionAModal(f.subCriterionId) : setViewingRun(lastRun!))}
                          title={path === "A"
                            ? (ppdReviewResults[f.subCriterionId] ? `View the saved PPD + Evidence review (last run ${new Date(ppdReviewResults[f.subCriterionId].runAt).toLocaleDateString()}) — instant, no AI call` : "View the saved evidence assessment — instant, no AI call")
                            : `View run ${lastRun!.runId} — ${new Date(lastRun!.startedAt).toLocaleDateString()} — instant, no AI call`}
                          style={{ cursor: "pointer", fontSize: 11, padding: "5px 8px", borderRadius: 7, border: "1px solid #ddd6fe", background: "#faf5ff", color: "#5b21b6", whiteSpace: "nowrap", fontWeight: 600 }}
                        >
                          View results
                        </button>
                      );
                    })()}
                    {/* Secondary actions live here — never competing solid buttons. */}
                    <div id={`overflow-${f.id}`} style={{ position: "relative" }}>
                      <button
                        onClick={() => setOverflowOpen(overflowOpen === f.id ? null : f.id)}
                        title={tip("More actions: partial Option B runs and Drive access checks")}
                        style={{ cursor: "pointer", fontSize: 13, padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", lineHeight: 1 }}
                      >
                        ⋯
                      </button>
                      {overflowOpen === f.id && (
                        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 14px #0002", zIndex: 30, minWidth: 230, overflow: "hidden" }}>
                          {auditMode === "hybrid" && path === "A" &&
                            overflowItem("Run staged audit (Option B)", () => auditFolderStaged(f.id, "all"), {
                              title: "Runs the Option B engine on this folder even though Option A is selected — verdicts land on the Sub-Criterion Checklist",
                            })}
                          {auditMode === "hybrid" && overflowItem("Policy check only (Option B)", () => auditFolderStaged(f.id, "policy"), {
                            title: "Option B partial run: check only Policy & Procedure documents for documented approaches",
                          })}
                          {auditMode === "hybrid" && overflowItem("Evidence check only (Option B)", () => auditFolderStaged(f.id, "evidence"), {
                            title: "Option B partial run: check only Actual Evidence documents for implementation records",
                          })}
                          {overflowItem(busy === `folderaccess:policy:${f.id}` ? "Checking…" : "Check policy access", () => checkFolderAccess(f.id, "policy"), {
                            disabled: busy === `folderaccess:policy:${f.id}`,
                          })}
                          {overflowItem(busy === `folderaccess:evidence:${f.id}` ? "Checking…" : "Check evidence access", () => checkFolderAccess(f.id, "evidence"), {
                            disabled: busy === `folderaccess:evidence:${f.id}`,
                          })}
                          {overflowItem(busy?.startsWith(`probe:`) && busy.endsWith(f.id) ? "Checking files…" : "🔎 Check folder before auditing", async () => {
                            setOverflowOpen(null);
                            // Auto-expand the row so the pre-flight result (and its
                            // live progress) appears in its proper position inside
                            // the expanded detail — the panel is only ever shown as
                            // part of the expanded row, never floating on a
                            // collapsed one.
                            expandSubCritRow(f.id);
                            showRunStrip(f.id);
                            const tab: "policy" | "evidence" = f.policyLink && !f.folderLink ? "policy" : "evidence";
                            const res = await probeFolder(f.id, tab);
                            // Persist the result (survives ✕ + reload).
                            setFolderProbe(f.id, res);
                          }, {
                            disabled: !!busy,
                            title: "Lists this folder's files, flags mis-named subfolders and unreadable files — NO AI call. Run this before auditing to avoid a silently wrong result.",
                            last: true,
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              </div>{/* /right column */}
              </div>{/* /ef-card-cols */}

              {/* Expandable detail: same-folder warning + access notes + audit result */}
              {rowExpanded && f.policyLink && f.folderLink && f.policyLink === f.folderLink && (
                <div style={{ padding: "0 12px 8px 30px" }}>
                  <div style={{ background: "#fff7ed", borderLeft: "3px solid #fb923c", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12, color: "#9a3412" }}>
                    ⚠ The <b>Policy &amp; Procedure</b> and <b>Actual Evidence</b> links point to the <b>same folder</b>. Link two different folders for a proper audit.
                  </div>
                </div>
              )}
              {rowExpanded && f.policyAccessNote && !dismissedAccessNotes.has(policyDismissKey) && (
                <div style={{ padding: "0 12px 6px 30px" }}>
                  <div style={{ background: "#f8fafc", borderLeft: "3px solid #93c5fd", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.4 }}>Access — policy</span>
                      <Pill s={ACCESS_TONE[f.policyAccessStatus || "Not Connected"]}>{f.policyAccessStatus || "Not Connected"}</Pill>
                      {f.policyAccessAt && <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.policyAccessAt).toLocaleString()}</span>}
                      <button onClick={() => dismissAccessNote(policyDismissKey)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ color: "#475569", lineHeight: 1.5 }}>{f.policyAccessNote}</div>
                  </div>
                </div>
              )}
              {rowExpanded && f.accessCheckNote && !dismissedAccessNotes.has(evidenceDismissKey) && (
                <div style={{ padding: "0 12px 6px 30px" }}>
                  <div style={{ background: "#f8fafc", borderLeft: "3px solid #86efac", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: 0.4 }}>Access — evidence</span>
                      <Pill s={ACCESS_TONE[f.accessCheckStatus || "Not Connected"]}>{f.accessCheckStatus || "Not Connected"}</Pill>
                      {f.accessCheckAt && <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.accessCheckAt).toLocaleString()}</span>}
                      <button onClick={() => dismissAccessNote(evidenceDismissKey)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ color: "#475569", lineHeight: 1.5 }}>{f.accessCheckNote}</div>
                  </div>
                </div>
              )}
              {rowExpanded && f.lastAuditSummary && !dismissedAuditResults.has(auditDismissKey) && (
                <div style={{ padding: "0 12px 10px 30px" }}>
                  <div style={{ background: "#f0fdf4", borderLeft: "3px solid #86c79f", borderRadius: "0 8px 8px 0", padding: "10px 12px", fontSize: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: 0.4 }}>Audit result</span>
                      <Pill s={f.lastAuditLive ? "progress" : "medium"}>{f.lastAuditLive ? "AI" : "Offline estimate"}</Pill>
                      <button onClick={() => dismissAuditResult(auditDismissKey)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 7, padding: "5px 8px", background: "#fff", borderRadius: 6, border: "1px solid #dcfce7" }}>
                      {f.lastAuditRunId && (
                        <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#374151", background: "#f1f5f9", border: "1px solid #d1d5db", borderRadius: 5, padding: "1px 6px" }}>{f.lastAuditRunId}</span>
                      )}
                      {f.lastAuditAuditor && <span style={{ fontSize: 11.5, color: "#374151" }}><span style={{ color: "#6b7280" }}>Auditor:</span> <b>{f.lastAuditAuditor}</b></span>}
                      {f.lastAuditAt && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>Audited {new Date(f.lastAuditAt).toLocaleString()}</span>}
                    </div>
                    {/* The summary below (incl. its Band lines) is a SNAPSHOT
                        from this run — checklist edits made since can change
                        the live band shown on the Scorecard. */}
                    <div style={{ fontSize: 10.5, color: "#64748b", fontStyle: "italic", marginBottom: 6 }}>
                      Snapshot as at this run — later checklist edits can change the current bands (see Scorecard).
                    </div>
                    <div style={{ color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {f.lastAuditSummary.length > SUMMARY_CAP && !expanded[f.id]
                        ? `${f.lastAuditSummary.slice(0, SUMMARY_CAP)}…`
                        : f.lastAuditSummary}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      {f.lastAuditSummary.length > SUMMARY_CAP && (
                        <button onClick={() => setExpanded((e) => ({ ...e, [f.id]: !e[f.id] }))} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#2563eb", fontSize: 11.5, padding: 0, textDecoration: "underline" }}>
                          {expanded[f.id] ? "Show less" : "Show full result"}
                        </button>
                      )}
                      {/* Open the saved result in its review MODAL (A → review
                          modal, B → audit-run modal) — the same modals the
                          per-row "View results" button uses. Falls back to page
                          navigation only if the modal's data isn't available. */}
                      {(path === "A" || !!lastRun) ? (
                        <button
                          onClick={() => (path === "A" ? setOptionAModal(f.subCriterionId) : setViewingRun(lastRun!))}
                          style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 11, color: "#2563eb", whiteSpace: "nowrap", padding: 0 }}
                        >
                          View results →
                        </button>
                      ) : (
                        // Reached only for Option B with no stored run record — keep the
                        // existing page navigation as a safe fallback.
                        <Link
                          to={`/sub-checklist?item=${firstItemId ?? ""}`}
                          style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}
                        >
                          View results →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* Pre-flight pane (zero AI calls to render). Positioned LAST —
                  after the Audit Result section — as supporting/diagnostic detail.
                  Visibility follows the SAME single rule as Access-Policy /
                  Access-Evidence / Audit Result: shown only while the row is
                  expanded, hidden entirely when collapsed. Running the check from
                  the ⋯ menu on a collapsed row auto-expands the row (see the menu
                  handler) rather than floating this panel on a closed row. ✕ hides
                  it for this view (the stored result is kept, reopenable) and it
                  survives a page reload. */}
              {rowExpanded && (() => {
                const probing = busy?.startsWith("probe:") && busy.endsWith(f.id);
                if (probing) {
                  const pp = probeProgress && probeProgress.folderId === f.id ? probeProgress : null;
                  const pct = pp && pp.total > 0 ? Math.round((pp.current / pp.total) * 100) : null;
                  return (
                    <div style={{ padding: "0 12px 8px 30px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", fontSize: 12, color: "#475569", maxWidth: "100%", boxSizing: "border-box", flexWrap: "wrap" }}>
                        {/* Spinner animates continuously, so even while the counter
                            holds on one slow file it's clear the check is alive. */}
                        <Spinner />
                        <span style={{ fontWeight: 600 }}>
                          {pp ? `Checking file ${pp.current} of ${pp.total}…` : "Listing folder…"}
                        </span>
                        <span style={{ color: "#94a3b8" }}>testing each file is readable (no AI used)</span>
                        {pct != null && (
                          <span style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flex: 1, height: 5, borderRadius: 3, background: "#e2e8f0", overflow: "hidden" }}>
                              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "#8b5cf6", borderRadius: 3, transition: "width 0.3s ease" }} />
                            </span>
                            <span style={{ fontSize: 10.5, color: "#8b5cf6", fontWeight: 700, minWidth: 30, textAlign: "right" }}>{pct}%</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }
                const stored = folderProbes[f.id];
                if (!stored) return null;
                if (probeStripHidden.has(f.id)) {
                  return (
                    <div style={{ padding: "0 12px 6px 30px" }}>
                      <button onClick={() => showRunStrip(f.id)} style={{ cursor: "pointer", fontSize: 11, color: "#475569", border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 6, padding: "3px 9px" }}>
                        🔎 Show pre-flight check
                      </button>
                    </div>
                  );
                }
                return (
                  <div style={{ padding: "0 12px 8px 30px" }}>
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, border: "1px solid #8b5cf6", background: "#f5f3ff", color: "#6d28d9" }}>🔎 Pre-flight check</span>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>checked {new Date(stored.probedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <button onClick={() => hideRunStrip(f.id)} title="Hide this panel (the pre-flight result is kept — reopen anytime)" style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
                      </div>
                      <div style={{ padding: "8px 10px" }}>
                        <FolderProbePanel result={stored.result} onClose={() => hideRunStrip(f.id)} />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </Card>
    </>
  );
}
