import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { findingTypeForStatus, findingTypeTone } from "../lib/findingClassification";
import type { PPDVerdict, PPDOverallVerdict, EvidenceVerdict } from "../types";

// Option A's complete flow, as two tabs on one page:
//   • PPD Review — policy only, one row per GD4 requirement line (3 columns).
//   • Evidence   — reuses the PPD verdict + reads the Actual Evidence folder
//                  for a combined Met/Partial/Not met verdict (4 columns).
// Findings are compiled from the Evidence tab. The single-column Sub-Criterion
// Checklist (Option B) is untouched.

function ppdVerdictTone(v: PPDVerdict): "good" | "medium" | "critical" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : "critical";
}

function ppdVerdictBorderColor(v: PPDVerdict): string {
  return v === "Adequate" ? "#22c55e" : v === "Partial" ? "#f59e0b" : "#ef4444";
}

function evVerdictTone(v: EvidenceVerdict): "good" | "medium" | "critical" {
  return v === "Met" ? "good" : v === "Partial" ? "medium" : "critical";
}

function evVerdictBorderColor(v: EvidenceVerdict): string {
  return v === "Met" ? "#22c55e" : v === "Partial" ? "#f59e0b" : "#ef4444";
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

export function PPDReview() {
  // The sub-criterion is passed in via the ?item= query param — from the
  // Evidence Folder page's "Start review"/"View Results" links — never picked
  // manually here.
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("item") || "";
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === selectedId);
  const [tab, setTab] = useState<"ppd" | "evidence">("ppd");

  const folders = useWorkspaceStore((s) => s.folders);
  const folder = folders.find((f) => f.subCriterionId === selectedId);

  const requirementItems = useMemo(
    () => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === selectedId),
    [selectedId]
  );
  const totalLines = useMemo(
    () => requirementItems.reduce((n, r) => n + (r.flatAuditPoints?.filter((p) => p.sourceType === "describeShow").length ?? 0), 0),
    [requirementItems]
  );

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>PPD Requirements Review{sub ? ` — ${sub.id}` : ""}</h3>
        {!sub && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Option A: check the Policy & Procedure Document, then the Actual Evidence, per GD4 requirement line.
          </span>
        )}
      </div>

      {!sub && (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
          No sub-criterion selected. Open this page from the <Link to="/evidence-folder" style={{ color: "#4338ca", fontWeight: 600 }}>Evidence Folder</Link> page's
          "Start review →" or "View Results →" link for the sub-criterion you want to check.
        </p>
      )}

      {sub && (
        <>
          <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: -2, marginBottom: 10 }}>
            {sub.title} — {sub.description}
            {" "}· {totalLines} requirement line{totalLines === 1 ? "" : "s"} across {requirementItems.length} item{requirementItems.length === 1 ? "" : "s"}
            {!folder?.policyLink && !folder?.folderLink && <span style={{ color: "#b23121" }}> · No folder linked yet (Evidence Folder page).</span>}
          </p>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
            {([["ppd", "PPD Review"], ["evidence", "Evidence"]] as const).map(([id, label]) => (
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
              </button>
            ))}
          </div>

          {tab === "ppd" ? <PpdTab selectedId={selectedId} totalLines={totalLines} /> : <EvidenceTab selectedId={selectedId} />}
        </>
      )}
    </Card>
  );
}

// ─── PPD Review tab (policy only, 3 columns) ────────────────────────────────
function PpdTab({ selectedId, totalLines }: { selectedId: string; totalLines: number }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);

  const result = ppdReviewResults[selectedId];
  const isRunning = busy === "ppdreview" + selectedId;
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });

  // Old-format results (pre per-line refactor) keyed rows per whole item and
  // lack `ref`; force a re-run rather than render the collapsed single row.
  const isStale = !!result && result.rows.some((r) => !r.ref);
  const liveResult = result && !isStale ? result : undefined;

  return (
    <>
      <button
        disabled={isRunning}
        onClick={() => runPPDReview(selectedId)}
        style={{ cursor: isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", marginBottom: 12 }}
      >
        {isRunning ? "Reviewing…" : result ? "Re-run PPD review" : "Run PPD review"}
      </button>

      {!result && !isRunning && (
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
          {liveResult.overallVerdict && (() => {
            const colors = overallPanelColors(liveResult.overallVerdict);
            const weakRows = liveResult.rows.filter((r) => r.verdict !== "Adequate");
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
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
            Last run {new Date(liveResult.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{liveResult.live ? "Live AI" : "Offline"}
            {" · "}{liveResult.rows.filter((r) => r.verdict === "Adequate").length} Adequate, {liveResult.rows.filter((r) => r.verdict === "Partial").length} Partial, {liveResult.rows.filter((r) => r.verdict === "Not documented").length} Not documented
          </div>

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
                <div key={row.ref} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${ppdVerdictBorderColor(row.verdict)}`, borderRadius: 8, padding: "10px 12px" }}>
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

// ─── Evidence tab (PPD verdict + Actual Evidence, 4 columns) ────────────────
function EvidenceTab({ selectedId }: { selectedId: string }) {
  const busy = useWorkspaceStore((s) => s.busy);
  const runEvidenceAssessment = useWorkspaceStore((s) => s.runEvidenceAssessment);
  const compileEvidenceFindings = useWorkspaceStore((s) => s.compileEvidenceFindings);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const evidenceAssessments = useWorkspaceStore((s) => s.evidenceAssessments);

  const ppd = ppdReviewResults[selectedId];
  const ppdReady = !!ppd && ppd.rows.length > 0 && !ppd.rows.some((r) => !r.ref);
  const assessment = evidenceAssessments[selectedId];
  const isRunning = busy === "evidenceassess" + selectedId;

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });

  const compilable = assessment ? assessment.rows.filter((r) => !r.savedFindingId).length : 0;

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
        verdict: undefined as EvidenceVerdict | undefined, comment: "", savedFindingId: undefined as string | undefined,
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
            Last run {new Date(assessment.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{assessment.live ? "Live AI" : "Offline"}
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

      {compileMsg && (
        <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 11px", marginBottom: 8 }}>{compileMsg}</div>
      )}
      {!assessment && !isRunning && (
        <p style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 0 }}>No evidence assessment run yet. The PPD column below is carried over from the PPD Review tab; click "Run evidence assessment" to read the Actual Evidence folder and produce a combined verdict.</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: EV_GRID, gap: 10, position: "sticky", top: 0, zIndex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px 8px 0 0", padding: "6px 12px", marginBottom: -1 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>GD4 requirement</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>PPD</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Evidence</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>AI verdict</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => {
          const expanded = expandedRows.has(row.gdRef);
          const border = row.verdict ? evVerdictBorderColor(row.verdict) : "#e2e8f0";
          const ppdExtractShort = row.ppdExtract.length > 160 ? `${row.ppdExtract.slice(0, 160)}…` : row.ppdExtract;
          return (
            <div key={row.gdRef} style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${border}`, borderRadius: 8, padding: "10px 12px" }}>
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
                  {row.verdict ? (
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

              {expanded && row.comment && (
                <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 10, paddingTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Combined assessment</div>
                  <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.45, whiteSpace: "pre-line" }}>{row.comment}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
