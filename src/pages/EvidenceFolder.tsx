import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { AuditProgressState, FolderStatus } from "../types";

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
@keyframes audit-done-pop {
  0%   { transform: scale(0.7); opacity: 0; }
  60%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}
`;

// Visual steps (condensing is folded into "Read files" visually)
const VISUAL_STEPS = [
  { emoji: "🔌", label: "Connect" },
  { emoji: "📂", label: "Read files" },
  { emoji: "🤖", label: "AI audit" },
  { emoji: "💾", label: "Save" },
  { emoji: "✅", label: "Complete" },
] as const;

// Map audit stage → which visual step (0-based) it belongs to
function stageToVisualStep(stage: AuditProgressState["stage"]): number {
  switch (stage) {
    case "listing":   return 0;
    case "reading":
    case "condensing": return 1;
    case "auditing":  return 2;
    case "saving":    return 3;
    case "complete":  return 4;
    case "error":     return -1;
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
    case "error": return 100;
  }
}

// Tiny animated dots component for "live" feel on active lines
function Dots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((d) => (d % 3) + 1), 500);
    return () => clearInterval(t);
  }, []);
  return <span style={{ color: "#93c5fd", letterSpacing: 2 }}>{"•".repeat(n)}</span>;
}

// Detail panel — shows context-appropriate info for each stage
function ProgressDetail({ p }: { p: AuditProgressState }) {
  const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 5 };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: "#6b7280", minWidth: 90, flexShrink: 0, paddingTop: 1 };
  const valueStyle: React.CSSProperties = { fontSize: 12.5, color: "#1e293b", fontWeight: 500, wordBreak: "break-word" };
  const mutedStyle: React.CSSProperties = { fontSize: 11.5, color: "#64748b" };

  if (p.stage === "listing") return (
    <div>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        Connecting to Google Drive and listing all files in the folder<Dots />
      </div>
      <div style={mutedStyle}>Folder: <b>{p.folderName}</b> · sub-criterion {p.subCriterionId}</div>
    </div>
  );

  if (p.stage === "reading") {
    const read = p.filesRead ?? 0;
    const total = p.filesTotal ?? 0;
    const skipped = p.filesSkipped ?? 0;
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
          📂 Reading file {read + 1} of {total}<Dots />
        </div>
        {p.currentFileName && (
          <div style={rowStyle}>
            <span style={labelStyle}>Current file</span>
            <span style={{ ...valueStyle, fontFamily: "ui-monospace,monospace", fontSize: 11.5 }}>{p.currentFileName}</span>
          </div>
        )}
        {p.currentFileBucket && (
          <div style={rowStyle}>
            <span style={labelStyle}>Source</span>
            <span style={{ ...valueStyle, color: p.currentFileBucket === "policy" ? "#1d4ed8" : "#15803d" }}>
              {p.currentFileBucket === "policy" ? "Policy & Procedure folder" : "Actual Evidence folder"}
            </span>
          </div>
        )}
        {p.currentFileAction && (
          <div style={rowStyle}>
            <span style={labelStyle}>Action</span>
            <span style={valueStyle}>{p.currentFileAction}</span>
          </div>
        )}
        <div style={{ marginTop: 8, padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11.5, color: "#475569", display: "flex", gap: 12 }}>
          <span><b>{read}</b> file{read !== 1 ? "s" : ""} processed</span>
          {skipped > 0 && <span style={{ color: "#94a3b8" }}><b>{skipped}</b> skipped</span>}
        </div>
      </div>
    );
  }

  if (p.stage === "condensing") return (
    <div>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
        📋 Condensing large documents to fit AI input limits<Dots />
      </div>
      <div style={mutedStyle}>
        The total document text exceeds the AI's context limit. The system is summarising each large file with a fast AI model so that nothing important is left out of the audit. This usually takes 10–20 seconds.
      </div>
    </div>
  );

  if (p.stage === "auditing") {
    const batch = p.batchCurrent ?? 0;
    const total = p.batchTotal ?? 1;
    const isStrict = p.stageDetail?.includes("strict") || p.stageDetail?.includes("challenge");
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
          🤖 {isStrict ? "Running strict challenge pass" : `AI audit — batch ${batch} of ${total}`}<Dots />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Action</span>
          <span style={valueStyle}>{isStrict ? "Re-checking every Met/Partial verdict against the evidence standard" : "Judging each checklist line against the GD4 standard and your evidence"}</span>
        </div>
        {p.filesTotal != null && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11.5, color: "#475569", display: "flex", gap: 12 }}>
            <span><b>{p.filesTotal}</b> file{p.filesTotal !== 1 ? "s" : ""} in scope</span>
            {total > 1 && <span><b>{batch}</b> of <b>{total}</b> batches done</span>}
          </div>
        )}
      </div>
    );
  }

  if (p.stage === "saving") {
    const lines = p.linesAssessed ?? 0;
    const issues = p.findingsDetected ?? 0;
    return (
      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>
          💾 Saving verdicts to the checklist<Dots />
        </div>
        <div style={{ marginTop: 4, padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 11.5, color: "#475569", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span><b>{lines}</b> checklist line{lines !== 1 ? "s" : ""} assessed</span>
          {issues > 0 && <span style={{ color: "#b45309" }}><b>{issues}</b> potential issue{issues !== 1 ? "s" : ""} detected</span>}
        </div>
        <div style={{ ...mutedStyle, marginTop: 6 }}>Results will appear in the Sub-Criterion Checklist when this step completes.</div>
      </div>
    );
  }

  if (p.stage === "complete") {
    const lines = p.linesAssessed ?? 0;
    const issues = p.findingsDetected ?? 0;
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 8 }}>
          Audit finished successfully!
        </div>
        <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, fontSize: 12.5, color: "#166534", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {lines > 0 && <span>✓ <b>{lines}</b> checklist line{lines !== 1 ? "s" : ""} assessed</span>}
          {issues > 0 ? (
            <span>⚠ <b>{issues}</b> potential issue{issues !== 1 ? "s" : ""} flagged</span>
          ) : lines > 0 ? (
            <span>✓ No issues flagged</span>
          ) : null}
        </div>
        <div style={{ ...mutedStyle, marginTop: 6 }}>Check the Sub-Criterion Checklist to review verdicts and evidence.</div>
      </div>
    );
  }

  if (p.stage === "error") return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#b23121", marginBottom: 6 }}>Something went wrong:</div>
      <div style={{ fontSize: 12.5, color: "#7f1d1d", background: "#fef2f2", borderRadius: 8, padding: "8px 12px", lineHeight: 1.6 }}>
        {p.errorMessage || "An unexpected error occurred."}
      </div>
      <div style={{ ...mutedStyle, marginTop: 6 }}>Any verdicts saved before this error were kept. Fix the issue above and run the audit again.</div>
    </div>
  );

  return null;
}

function AuditProgressModal({ progress, onClose }: { progress: AuditProgressState; onClose: () => void }) {
  const pct = stageProgress(progress);
  const isError = progress.stage === "error";
  const isDone = progress.stage === "complete";
  const currentStep = stageToVisualStep(progress.stage);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <style>{MODAL_KEYFRAMES}</style>
      <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Running folder audit</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {progress.folderName}
              {progress.overallTotal && progress.overallCurrent != null && (
                <span style={{ marginLeft: 8, background: "#f1f5f9", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>
                  Folder {progress.overallCurrent} of {progress.overallTotal}
                </span>
              )}
            </div>
          </div>
          {(isDone || isError) && (
            <button onClick={onClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 20, color: "#94a3b8", lineHeight: 1, padding: "0 0 0 8px", marginTop: -2 }}>×</button>
          )}
        </div>

        {/* Horizontal step flow */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, padding: "0 4px" }}>
          {VISUAL_STEPS.map((step, i) => {
            const status: "done" | "active" | "future" | "error" =
              isError && i === currentStep ? "error" :
              isDone ? "done" :
              i < currentStep ? "done" :
              i === currentStep ? "active" : "future";
            return (
              <Fragment key={i}>
                {/* Step bubble */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 60 }}>
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
                    boxShadow: status === "active" ? "0 0 0 3px rgba(219,234,254,0.8)" : "none",
                  }}>
                    {status === "done" ? "✓" : step.emoji}
                  </div>
                  <span style={{
                    fontSize: 10.5, textAlign: "center", lineHeight: 1.2, fontWeight: status === "active" ? 700 : 400,
                    color: status === "active" ? "#2563eb" : status === "done" ? "#16a34a" : "#94a3b8",
                  }}>{step.label}</span>
                </div>
                {/* Arrow connector */}
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

        {/* Detail section */}
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", minHeight: 90 }}>
          <ProgressDetail p={progress} />
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
    {auditProgress && <AuditProgressModal progress={auditProgress} onClose={clearAuditProgress} />}
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
