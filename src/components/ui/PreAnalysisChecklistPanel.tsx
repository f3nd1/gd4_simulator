import { useMemo } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { runPreAnalysisChecklist, hasChecklist, type DetectFile, type DetectStatus, type ChecklistItemResult } from "../../lib/preAnalysisChecklist";

// Non-blocking, per-sub-criterion pre-analysis checklist. Renders as the
// "Pre-check" step of the run stepper — Option B's AuditProgressModal (between
// Read files and Ask AI) and Option A's PPD+Evidence flow (between PPD Review
// and Evidence) — reusing whatever files that run has already read (no separate
// probe needed). Sub-criteria with no definition render NOTHING (returns null)
// — the caller shows a "no checks defined" state instead. A "Continue" action
// is ALWAYS available.

// Minimal shared shape both AuditFileRecord[] (a live run's file list) and
// ProbeFile[] (the pre-flight list) structurally satisfy — this component only
// ever needs identity + bucket to resolve extracted text and file links.
export type PreCheckSourceFile = { name: string; path: string; bucket: "policy" | "evidence" | "auto"; driveFileId?: string };

function DriveLink({ driveFileId, name }: { driveFileId?: string; name: string }) {
  if (!driveFileId) return <span style={{ color: "#94a3b8" }}>{name}</span>;
  return (
    <a href={`https://drive.google.com/file/d/${driveFileId}/view`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={`Open "${name}" in Google Drive`} style={{ color: "#2563eb", textDecoration: "none" }}>
      {name} ↗
    </a>
  );
}

const STATUS_STYLE: Record<DetectStatus | "manual" | "pending", { label: string; fg: string; bg: string; bd: string }> = {
  flag:    { label: "⚠ Flagged",       fg: "#b45309", bg: "#fffbeb", bd: "#fde68a" },
  clear:   { label: "✓ Looks OK",      fg: "#15803d", bg: "#f0fdf4", bd: "#bbf7d0" },
  unknown: { label: "? Check manually", fg: "#7c3aed", bg: "#f5f3ff", bd: "#ddd6fe" },
  manual:  { label: "Manual check",     fg: "#7c3aed", bg: "#f5f3ff", bd: "#ddd6fe" },
  pending: { label: "Not scanned yet",  fg: "#64748b", bg: "#f8fafc", bd: "#e2e8f0" },
};

function ChecklistRow({ item, folderId, scanned }: { item: ChecklistItemResult; folderId: string; scanned: boolean }) {
  const marks = useWorkspaceStore((s) => s.preAnalysisChecks);
  const toggle = useWorkspaceStore((s) => s.togglePreAnalysisCheck);
  const markKey = `${folderId}::${item.id}`;
  const checked = !!marks[markKey];

  // What status chip to show: manual items are always "Manual check"; auto items
  // show their detection outcome once scanned, or "Not scanned yet" before that.
  const kind: DetectStatus | "manual" | "pending" =
    item.mode === "manual" ? "manual" : !scanned ? "pending" : item.outcome?.status ?? "pending";
  const chip = STATUS_STYLE[kind];
  const message = item.mode === "manual"
    ? "Needs human judgement — the app can't verify this itself."
    : !scanned
      ? "Waiting for files to be read — this will scan automatically once they are."
      : item.outcome?.message ?? "";
  const fileRefs = item.mode === "auto" && scanned ? item.outcome?.fileRefs ?? [] : [];

  return (
    <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 2px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <input type="checkbox" checked={checked} onChange={() => toggle(markKey)} title="Optional — tick for your own tracking (never required)" style={{ marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1e293b" }}>{item.title}</span>
            {/* Auto vs manual tag */}
            <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: item.mode === "auto" ? "#eef2ff" : "#f1f5f9", color: item.mode === "auto" ? "#4338ca" : "#64748b" }} title={item.mode === "auto" ? "The app scanned the extracted text (pattern match — no AI call)." : "Needs human judgement."}>
              {item.mode === "auto" ? "Auto-detected" : "Manual check"}
            </span>
            {/* Status chip */}
            <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 4, color: chip.fg, background: chip.bg, border: `1px solid ${chip.bd}` }}>{chip.label}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.45, marginTop: 3 }}>{item.description}</div>
          {message && <div style={{ fontSize: 11.5, color: chip.fg, marginTop: 4 }}>{message}</div>}
          {fileRefs.length > 0 && (
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {fileRefs.map((r, i) => <DriveLink key={i} driveFileId={r.driveFileId} name={r.name} />)}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Source: {item.source}</div>
        </div>
      </div>
    </div>
  );
}

export function PreAnalysisChecklistPanel({
  folderId, subCriterionId, subCriterionTitle, itemIds, files, onContinue, continueLabel,
}: {
  folderId: string;
  subCriterionId: string;
  subCriterionTitle: string;
  itemIds: string[];
  files?: PreCheckSourceFile[];
  onContinue: () => void;
  continueLabel: string;
}) {
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);

  // Resolve each file's extracted text from the cache. Callers only reliably
  // have a driveFileId (not the modifiedTime half of the cache key), so
  // prefix-scan by driveFileId. Image / not-yet-read files have no text → null.
  const detectFiles: DetectFile[] = useMemo(() => {
    if (!files) return [];
    return files.map((f) => {
      const entry = f.driveFileId ? Object.entries(fileTextCache).find(([k]) => k.startsWith(`${f.driveFileId}:`))?.[1] : undefined;
      return { name: f.name, path: f.path, bucket: f.bucket, driveFileId: f.driveFileId, text: entry?.text ?? null };
    });
  }, [files, fileTextCache]);

  const results = useMemo(() => runPreAnalysisChecklist(itemIds, detectFiles), [itemIds, detectFiles]);
  const scanned = !!files && files.length > 0;

  // No definition for this sub-criterion's items yet → render nothing at all.
  if (!hasChecklist(itemIds) || results.length === 0) return null;

  const flags = scanned ? results.filter((r) => r.mode === "auto" && r.outcome?.status === "flag").length : 0;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap", background: "#fbfcfe" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>✅ Pre-analysis checks — {subCriterionId} {subCriterionTitle}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{results.length} item{results.length !== 1 ? "s" : ""}{flags > 0 ? ` · ${flags} flagged` : ""}</span>
      </div>
      <div style={{ padding: "2px 11px 9px" }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", padding: "6px 0 2px" }}>
          Quality checks specific to this sub-criterion, grounded in the SSG evidence list, regulatory rules and this PEI's real finding patterns. Non-blocking — you can continue at any time.
        </div>
        {results.map((item) => (
          <ChecklistRow key={item.id} item={item} folderId={folderId} scanned={scanned} />
        ))}
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 9, marginTop: 2 }}>
          {/* Always available — checklist flags NEVER block continuing. */}
          <button
            type="button"
            onClick={onContinue}
            style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "1px solid #7c3aed", background: "#7c3aed", color: "#fff" }}
          >
            {continueLabel} →
          </button>
          <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: 10 }}>These checks are advisory — nothing here has to be ticked or cleared first.</span>
        </div>
      </div>
    </div>
  );
}
