import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { AuditFileRecord, AuditProgressState, AuditRunRecord, AuditScope, FolderStatus } from "../types";
import { downloadCsv, exportFileLedgerCsv, exportAISummaryCsv, auditCsvFilename, progressToRunRecord } from "../lib/auditCsvExport";
import { domainExpertiseLabelFor } from "../data/skills/domainExpertise";

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
`;

const VISUAL_STEPS = [
  { emoji: "🔌", label: "Connect" },
  { emoji: "📂", label: "Read files" },
  { emoji: "🤖", label: "Ask AI" },
  { emoji: "💾", label: "Save" },
  { emoji: "✅", label: "Complete" },
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
    case "apsr_build":   return 2;
    case "findings_summary":
    case "saving":       return 3;
    case "complete":     return 4;
    case "error":        return -1;
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

function FileRow({ file, isReading, onSkipFile }: { file: AuditFileRecord; isReading?: boolean; onSkipFile?: () => void }) {
  const bucketLabel = file.bucket === "policy" ? "Policy" : file.bucket === "evidence" ? "Evid" : "Auto";
  const bucketColor = file.bucket === "policy" ? "#1d4ed8" : file.bucket === "evidence" ? "#15803d" : "#9ca3af";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 11, background: isReading ? "#fffbeb" : undefined }}>
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
      <ProcessingModeBadge file={file} />
      <DimIcons file={file} />
      <FileStatusBadge file={file} />
      {file.failReason && <span style={{ fontSize: 9.5, color: "#b91c1c", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.failReason}>{file.failReason}</span>}
      {file.skipReason && file.readStatus === "skipped" && <span style={{ fontSize: 9.5, color: "#9ca3af", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.skipReason}>{file.skipReason}</span>}
      {isReading && onSkipFile && (
        <button
          onClick={onSkipFile}
          title="Abort reading this file and move on to the next one"
          style={{ cursor: "pointer", fontSize: 9.5, padding: "2px 6px", borderRadius: 4, border: "1px solid #fbbf24", background: "#fffbeb", color: "#92400e", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Skip
        </button>
      )}
    </div>
  );
}

// Expandable file ledger with filter tabs, search and sort — used in both the
// live audit progress modal and the read-only "View last run" modal.
function FileLedger({
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
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
            </div>
            {/* Files being sent to AI in this pass */}
            {files.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>📤 Sending <b>{files.length}</b> file{files.length !== 1 ? "s" : ""} to AI</span>
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
                    .map((file, fi) => {
                      const badge = file.auditStatus === "cited" ? { label: "📎 Cited", color: "#0369a1", bg: "#e0f2fe" }
                        : file.auditStatus === "not_used" ? { label: "— Not used", color: "#6b7280", bg: "#f3f4f6" }
                        : file.auditStatus === "audited" ? { label: "🤖 Audited", color: "#1e40af", bg: "#eff6ff" }
                        : { label: "⏳ Pending", color: "#b45309", bg: "#fffbeb" };
                      return (
                        <div key={file.path + fi} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderBottom: "1px solid #eff6ff", fontSize: 10 }}>
                          <span style={{ flexShrink: 0, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: badge.bg, color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1e40af" }}>{file.name}</span>
                          <span style={{ flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{file.fileKind?.toUpperCase()}</span>
                          {file.charCount != null && file.charCount > 0 && (
                            <span style={{ flexShrink: 0, fontFamily: "ui-monospace,monospace", color: "#6b7280", fontSize: 9 }}>{file.charCount.toLocaleString()} ch</span>
                          )}
                        </div>
                      );
                    })
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
              {analyzedFiles.map((file) => {
                const isCited = file.auditStatus === "cited";
                const isNotUsed = file.auditStatus === "not_used";
                return (
                  <div key={file.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 10.5 }}>
                    <span style={{ flexShrink: 0, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: isCited ? "#e0f2fe" : "#f3f4f6", color: isCited ? "#0369a1" : "#6b7280", fontWeight: 600 }}>
                      {isCited ? "📎 Cited" : isNotUsed ? "— Not used" : "✓ Done"}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>{file.name}</span>
                    <span style={{ flexShrink: 0, color: "#94a3b8", fontSize: 9.5 }}>{file.fileKind}</span>
                  </div>
                );
              })}
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
          <div style={{ maxHeight: 110, overflowY: "auto", border: "1px solid #bbf7d0", borderRadius: 6, background: "#f0fdf4" }}>
            {files.map((file, fi) => {
              const isCited = file.auditStatus === "cited";
              const isNotUsed = file.auditStatus === "not_used";
              return (
                <div key={file.path + fi} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px", borderBottom: "1px solid #dcfce7", fontSize: 10 }}>
                  <span style={{ flexShrink: 0, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: isCited ? "#dcfce7" : isNotUsed ? "#f3f4f6" : "#e0f2fe", color: isCited ? "#15803d" : isNotUsed ? "#6b7280" : "#0369a1", fontWeight: 600 }}>
                    {isCited ? "📎 cited" : isNotUsed ? "— skipped" : "✓"}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#166534" }}>{file.name}</span>
                  <span style={{ flexShrink: 0, color: "#94a3b8", fontSize: 9 }}>{file.fileKind?.toUpperCase()}</span>
                  {file.charCount != null && file.charCount > 0 && (
                    <span style={{ flexShrink: 0, fontFamily: "ui-monospace,monospace", color: "#6b7280", fontSize: 9 }}>{file.charCount.toLocaleString()} ch</span>
                  )}
                </div>
              );
            })}
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

  const checklistHref = p.subCriterionId ? `#/sub-checklist?item=${p.subCriterionId}.1` : "#/sub-checklist";
  const findingsHref  = p.subCriterionId ? `#/findings?item=${p.subCriterionId}` : "#/findings";

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
        <a href={checklistHref} style={{ color: "#4f46e5", fontWeight: 600 }}>Sub-Criterion Checklist</a>
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
  const filesFound = p.filesFound?.length ?? 0;
  const filesRead = p.filesRead ?? 0;
  const linesAssessed = p.linesAssessed ?? 0;
  const partialSaved = linesAssessed > 0;

  let failedStep: string;
  let guidance: string;
  if (filesFound === 0 && filesRead === 0) {
    failedStep = "Connecting to Google Drive";
    guidance = "Check that your Google Drive is still connected (Settings → Google Drive) and that the folder link is correct. If the folder is in a Shared Drive, make sure your Google account has at least Viewer access.";
  } else if (filesRead === 0 || (p.filesTotal != null && filesRead < p.filesTotal)) {
    failedStep = "Reading evidence files";
    guidance = "One or more files could not be read. Password-protected PDFs and unsupported file types are skipped automatically — this error usually means a network issue or an unusually large file. Try running the audit again.";
  } else {
    failedStep = "Asking AI to assess";
    guidance = "The AI call timed out or was rejected. Check your OpenAI key in Settings → AI Settings. If the folder has more than 15–20 files, try reducing it to the most relevant ones.";
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
          ✓ <b>{linesAssessed}</b> verdict{linesAssessed !== 1 ? "s" : ""} saved before the error — those results are kept.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
          No verdicts saved — you can safely run the audit again once the issue is fixed.
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#374151" }}>
        <b>What to do:</b> {guidance}
      </div>
    </div>
  );
}

function StepDetail({
  step, p, onSkipFile, onExportFileLedger, onExportAISummary,
}: {
  step: number;
  p: AuditProgressState;
  onSkipFile?: () => void;
  onExportFileLedger?: () => void;
  onExportAISummary?: () => void;
}) {
  const currentStep = stageToVisualStep(p.stage);
  const isActive = step === currentStep;
  const isError = p.stage === "error";
  if (isError && step === currentStep) return <ErrorDetail p={p} />;
  switch (step) {
    case 0: return <ConnectDetail p={p} isActive={isActive} />;
    case 1: return <ReadFilesDetail p={p} isActive={isActive} onSkipFile={onSkipFile} onExportCsv={onExportFileLedger} />;
    case 2: return <AuditStepDetail p={p} isActive={isActive} onExportAISummary={onExportAISummary} />;
    case 3: return <SaveStepDetail p={p} isActive={isActive} />;
    case 4: return <CompleteDetail p={p} onExportFileLedger={onExportFileLedger} onExportAISummary={onExportAISummary} />;
    default: return null;
  }
}

const STUCK_THRESHOLD_MS = 60_000;

function AuditProgressModal({
  progress,
  onClose,
  onCancel,
  onSkipFile,
  onSkipStage,
  onExportFileLedger,
  onExportAISummary,
}: {
  progress: AuditProgressState;
  onClose: () => void;
  onCancel: () => void;
  onSkipFile: () => void;
  onSkipStage: () => void;
  onExportFileLedger: () => void;
  onExportAISummary: () => void;
}) {
  const pct = stageProgress(progress);
  const isError = progress.stage === "error";
  const isDone = progress.stage === "complete";
  const isRunning = !isDone && !isError;
  const currentStep = stageToVisualStep(progress.stage);

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
              {progress.overallTotal && progress.overallCurrent != null && (
                <span style={{ background: "#f1f5f9", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
                  Folder {progress.overallCurrent} of {progress.overallTotal}
                </span>
              )}
            </div>
          </div>
          {isRunning ? (
            <div style={{ display: "flex", gap: 6, marginLeft: 8, flexShrink: 0 }}>
              {currentStep === 2 && (
                <button
                  onClick={onSkipStage}
                  title="Stop the current AI pass early and move to the next stage using results collected so far"
                  style={{ cursor: "pointer", border: "1px solid #fbbf24", background: "#fffbeb", borderRadius: 7, fontSize: 11.5, fontWeight: 600, color: "#92400e", padding: "5px 12px", whiteSpace: "nowrap" }}
                >
                  Skip stage →
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
                  : <>AI no response for <b>{elapsedSec}s</b> — may be stuck. Click <b>Skip stage →</b> to stop this pass and continue with results so far, or <b>Cancel audit</b> to stop.</>)
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

        {/* Progress bar */}
        <div style={{ background: "#f1f5f9", borderRadius: 6, height: 6, overflow: "hidden", marginBottom: 18 }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 6,
            background: isError ? "#ef4444" : isDone ? "#22c55e" : "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
            backgroundSize: "200% 100%", transition: "width 0.5s ease",
            animation: !isDone && !isError ? "audit-shimmer 2s linear infinite" : "none",
          }} />
        </div>

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
          />
        </div>

        {/* Completion buttons — stay open after done */}
        {(isDone || isError) && (
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isDone && (
              <Link
                to={`/sub-checklist?item=${progress.subCriterionId}.1`}
                style={{ flex: 1, cursor: "pointer", padding: "10px", borderRadius: 10, border: "none", background: "#dcfce7", color: "#15803d", fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none", display: "block" }}
              >
                View results →
              </Link>
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

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
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

// ── Page ────────────────────────────────────────────────────────────────────

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];
const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

const SCOPE_OPTIONS: { value: AuditScope; label: string; desc: string }[] = [
  { value: "both",     label: "Both (Policy + Evidence)", desc: "Read all files from both folders" },
  { value: "policy",   label: "Policy only",              desc: "Read only the Policy & Procedure folder" },
  { value: "evidence", label: "Evidence only",            desc: "Read only the Actual Evidence folder" },
];

export function EvidenceFolder() {
  const folders        = useWorkspaceStore((s) => s.folders);
  const departments    = useWorkspaceStore((s) => s.departments);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const checkFolderAccess   = useWorkspaceStore((s) => s.checkFolderAccess);
  const auditFolderContents = useWorkspaceStore((s) => s.auditFolderContents);
  const auditFolderStaged   = useWorkspaceStore((s) => s.auditFolderStaged);
  const cancelBusy          = useWorkspaceStore((s) => s.cancelBusy);
  const clearFileTextCache  = useWorkspaceStore((s) => s.clearFileTextCache);
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

  const [checkingAdditional, setCheckingAdditional] = useState(false);
  const [viewingRun, setViewingRun] = useState<AuditRunRecord | null>(null);

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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
  const [showCacheList, setShowCacheList] = useState(false);
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

  return (
    <>
    {auditProgress && (
      <AuditProgressModal
        progress={auditProgress}
        onClose={clearAuditProgress}
        onCancel={() => { cancelBusy(); clearAuditProgress(); }}
        onSkipFile={skipCurrentFile}
        onSkipStage={skipCurrentAuditStage}
        onExportFileLedger={handleExportFileLedger}
        onExportAISummary={handleExportAISummary}
      />
    )}
    {viewingRun && (
      <AuditRunModal run={viewingRun} onClose={() => setViewingRun(null)} />
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
          {fileTextCacheSize > 0 && (
            <div style={{ marginBottom: 8, background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 7, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
                <span style={{ fontSize: 12, color: "#6d28d9" }}>♻ {fileTextCacheSize} file{fileTextCacheSize !== 1 ? "s" : ""} cached from previous audits</span>
                <button
                  onClick={() => setShowCacheList((v) => !v)}
                  style={{ cursor: "pointer", border: "1px solid #c4b5fd", background: "#fff", borderRadius: 5, fontSize: 11, padding: "2px 8px", color: "#7c3aed" }}
                >
                  {showCacheList ? "Hide files" : "View files"}
                </button>
                <button
                  onClick={() => { if (confirm("Clear the file text cache? The next audit will re-download all files from Drive.")) { clearFileTextCache(); setShowCacheList(false); } }}
                  style={{ marginLeft: "auto", cursor: "pointer", border: "1px solid #c4b5fd", background: "#fff", borderRadius: 5, fontSize: 11, padding: "2px 8px", color: "#7c3aed" }}
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
            const lastRun = lastAuditRuns[f.id];
            return (
              <Fragment key={f.id}>
                <tr className="rowh" ref={(el) => { rowRefs.current[f.subCriterionId] = el; }}>
                  <td><b>{f.folderName}</b></td>
                  <td>
                    <select value={f.owner} onChange={(e) => setFolderField(f.id, "owner", e.target.value)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                      <option value="">(unassigned)</option>
                      {departments.map((d) => <option key={d.id} value={d.acronym}>{d.acronym}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={f.status} onChange={(e) => setFolderField(f.id, "status", e.target.value as FolderStatus)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", minWidth: 52, textTransform: "uppercase", letterSpacing: 0.3 }}>Policy</span>
                        <input
                          placeholder="Policy folder link…"
                          value={f.policyLink || ""}
                          onChange={(e) => setFolderField(f.id, "policyLink", e.target.value)}
                          style={{ ...inputStyle, width: 140, padding: "3px 5px", fontSize: 11 }}
                        />
                        {f.policyLink && <a href={f.policyLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#3b82f6" }}>↗</a>}
                        {f.policyAccessStatus && <Pill s={ACCESS_TONE[f.policyAccessStatus]}>{f.policyAccessStatus}</Pill>}
                      </div>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", minWidth: 52, textTransform: "uppercase", letterSpacing: 0.3 }}>Evidence</span>
                        <input
                          placeholder="Evidence folder link…"
                          value={f.folderLink || ""}
                          onChange={(e) => setFolderField(f.id, "folderLink", e.target.value)}
                          style={{ ...inputStyle, width: 140, padding: "3px 5px", fontSize: 11 }}
                        />
                        {f.folderLink && <a href={f.folderLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#16a34a" }}>↗</a>}
                        {f.accessCheckStatus && <Pill s={ACCESS_TONE[f.accessCheckStatus]}>{f.accessCheckStatus}</Pill>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {isBusy ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button disabled style={{ cursor: "wait", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #93c5fd", background: "#dbeafe", color: "#1d4ed8", whiteSpace: "nowrap", opacity: 0.8 }}>
                          Auditing…
                        </button>
                        <button onClick={cancelBusy} style={{ cursor: "pointer", fontSize: 11, padding: "6px 9px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff", color: "#b23121", whiteSpace: "nowrap" }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          onClick={() => auditFolderStaged(f.id, "all")}
                          title="Staged audit: Policy Adequacy → Evidence Implementation → Outcome & Review → Deterministic APSR verdict"
                          style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff", whiteSpace: "nowrap" }}
                        >
                          Staged audit
                        </button>
                        <button
                          onClick={() => auditFolderStaged(f.id, "policy")}
                          title="Check only Policy & Procedure documents for documented approaches"
                          style={{ cursor: "pointer", fontSize: 11, padding: "5px 8px", borderRadius: 7, border: "1px solid #7c3aed", background: "#faf5ff", color: "#7c3aed", whiteSpace: "nowrap" }}
                        >
                          Policy check
                        </button>
                        <button
                          onClick={() => auditFolderStaged(f.id, "evidence")}
                          title="Check only Actual Evidence documents for implementation records"
                          style={{ cursor: "pointer", fontSize: 11, padding: "5px 8px", borderRadius: 7, border: "1px solid #7c3aed", background: "#faf5ff", color: "#7c3aed", whiteSpace: "nowrap" }}
                        >
                          Evidence check
                        </button>
                        {lastRun && (
                          <button
                            onClick={() => setViewingRun(lastRun)}
                            title={`View run ${lastRun.runId} — ${new Date(lastRun.startedAt).toLocaleDateString()}`}
                            style={{ cursor: "pointer", fontSize: 11, padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#374151", whiteSpace: "nowrap" }}
                          >
                            Last run ↗
                          </button>
                        )}
                        {/* Overflow menu */}
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
                        ⚠ The <b>Policy &amp; Procedure</b> and <b>Actual Evidence</b> links point to the <b>same folder</b>. Link two different folders for a proper audit.
                      </div>
                    </td>
                  </tr>
                )}

                {/* Policy access note */}
                {f.policyAccessNote && !dismissedAccessNotes.has(policyDismissKey) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 6px 28px" }}>
                      <div style={{ background: "#f8fafc", borderLeft: "3px solid #93c5fd", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 0.4 }}>Access — policy</span>
                          <Pill s={ACCESS_TONE[f.policyAccessStatus || "Not Connected"]}>{f.policyAccessStatus || "Not Connected"}</Pill>
                          {f.policyAccessAt && <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.policyAccessAt).toLocaleString()}</span>}
                          <button onClick={() => dismissAccessNote(policyDismissKey)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ color: "#475569", lineHeight: 1.5 }}>{f.policyAccessNote}</div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Evidence access note */}
                {f.accessCheckNote && !dismissedAccessNotes.has(evidenceDismissKey) && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 10px 6px 28px" }}>
                      <div style={{ background: "#f8fafc", borderLeft: "3px solid #86efac", borderRadius: "0 8px 8px 0", padding: "8px 12px", fontSize: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: 0.4 }}>Access — evidence</span>
                          <Pill s={ACCESS_TONE[f.accessCheckStatus || "Not Connected"]}>{f.accessCheckStatus || "Not Connected"}</Pill>
                          {f.accessCheckAt && <span style={{ color: "#94a3b8", fontSize: 11 }}>checked {new Date(f.accessCheckAt).toLocaleString()}</span>}
                          <button onClick={() => dismissAccessNote(evidenceDismissKey)} style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>✕</button>
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
                        <div style={{ color: "#334155", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
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
