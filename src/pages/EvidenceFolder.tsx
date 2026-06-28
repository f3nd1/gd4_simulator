import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { AuditProgressState, FolderStatus } from "../types";

const SUMMARY_CAP = 320; // chars shown before the audit summary collapses

// ── Audit Progress Modal ────────────────────────────────────────────────────

const STAGE_LABELS: Record<AuditProgressState["stage"], string> = {
  listing: "Connecting to Drive",
  reading: "Reading files",
  condensing: "Condensing documents",
  auditing: "Running AI audit",
  saving: "Saving verdicts",
  complete: "Audit complete",
  error: "Error",
};

const STAGE_ORDER: AuditProgressState["stage"][] = [
  "listing", "reading", "auditing", "saving", "complete",
];

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

function AuditProgressModal({ progress, onClose }: { progress: AuditProgressState; onClose: () => void }) {
  const pct = stageProgress(progress);
  const isError = progress.stage === "error";
  const isDone = progress.stage === "complete";
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0005", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "26px 30px", width: 400, boxShadow: "0 8px 40px #0003" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <b style={{ flex: 1, fontSize: 14 }}>Running folder audit</b>
          {(isDone || isError) && (
            <button onClick={onClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 18, color: "#6b7280", lineHeight: 1, padding: 0 }}>×</button>
          )}
        </div>
        <div style={{ background: "#f1f5f9", borderRadius: 8, height: 10, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: isError ? "#ef4444" : "#3b82f6", transition: "width 0.4s" }} />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {STAGE_ORDER.map((s) => {
            const idx = STAGE_ORDER.indexOf(progress.stage);
            const myIdx = STAGE_ORDER.indexOf(s);
            const done = myIdx < idx || (isDone && myIdx <= idx);
            const active = s === progress.stage && !isDone;
            return (
              <span key={s} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: done ? "#dcfce7" : active ? "#dbeafe" : "#f1f5f9", color: done ? "#15803d" : active ? "#1d4ed8" : "#94a3b8", fontWeight: active ? 700 : 400 }}>
                {active && !isDone ? "⏳ " : done ? "✓ " : ""}{STAGE_LABELS[s]}
              </span>
            );
          })}
        </div>
        <div style={{ fontSize: 12.5, color: isError ? "#b23121" : "#475569", lineHeight: 1.5 }}>
          {isError ? (
            <>{progress.errorMessage}<br /><span style={{ color: "#6b7280", fontSize: 11 }}>Any results before the error were saved. Check console for details.</span></>
          ) : (
            <>
              {progress.stage === "reading" && progress.filesTotal != null && (
                <><b>{progress.filesRead ?? 0}</b> of <b>{progress.filesTotal}</b> files read<br /></>
              )}
              {progress.stage === "auditing" && progress.batchTotal != null && (
                <><b>Batch {progress.batchCurrent ?? 0}</b> of <b>{progress.batchTotal}</b><br /></>
              )}
              {progress.stageDetail && <span style={{ color: "#6b7280" }}>{progress.stageDetail}</span>}
            </>
          )}
        </div>
        {(isDone || isError) && (
          <button onClick={onClose} style={{ marginTop: 14, cursor: "pointer", width: "100%", padding: "8px", borderRadius: 8, border: "none", background: isError ? "#fee2e2" : "#dcfce7", color: isError ? "#b23121" : "#15803d", fontWeight: 700, fontSize: 13 }}>
            {isError ? "Dismiss" : "Done"}
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
