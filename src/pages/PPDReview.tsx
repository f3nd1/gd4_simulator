import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { findingTypeTone } from "../lib/findingClassification";
import type { PPDVerdict } from "../types";

// This page IS Option A's complete output — one row per GD4 requirement
// LINE (not per whole requirement item), policy only (no Actual Evidence
// read). No second "Evidence Checklist" step: a Partial/Not documented row
// compiles straight into the same Findings register the checklist (Option
// B) uses — see useWorkspaceStore.compilePPDFindings.

function verdictTone(v: PPDVerdict): "good" | "medium" | "critical" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : "critical";
}

function verdictBorderColor(v: PPDVerdict): string {
  return v === "Adequate" ? "#22c55e" : v === "Partial" ? "#f59e0b" : "#ef4444";
}

const GRID_COLUMNS = "1fr 1fr 1fr";

export function PPDReview() {
  // The sub-criterion is passed in via the ?item= query param — from the
  // Evidence Folder page's "Start review"/"View Results" links — never
  // picked manually here.
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("item") || "";
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === selectedId);

  const busy = useWorkspaceStore((s) => s.busy);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
  const compilePPDFindings = useWorkspaceStore((s) => s.compilePPDFindings);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const folders = useWorkspaceStore((s) => s.folders);

  const result = ppdReviewResults[selectedId];
  const isRunning = busy === "ppdreview" + selectedId;
  const folder = folders.find((f) => f.subCriterionId === selectedId);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const toggleExpanded = (ref: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(ref) ? next.delete(ref) : next.add(ref);
      return next;
    });

  const requirementItems = useMemo(
    () => GD4_REQUIREMENTS.filter((r) => r.subCriterionId === selectedId),
    [selectedId]
  );
  const totalLines = useMemo(
    () => requirementItems.reduce((n, r) => n + (r.flatAuditPoints?.filter((p) => p.sourceType === "describeShow").length ?? 0), 0),
    [requirementItems]
  );

  const compilable = result ? result.rows.filter((r) => r.verdict !== "Adequate" && !r.savedFindingId).length : 0;

  function handleCompile() {
    const n = compilePPDFindings(selectedId);
    setCompileMsg(n > 0 ? `${n} finding${n === 1 ? "" : "s"} raised to the Findings register.` : "No new findings to raise — every Partial/Not documented line already has one.");
  }

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>PPD Requirements Review{sub ? ` — ${sub.id}` : ""}</h3>
        {!sub && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Checks the Policy & Procedure Document only — does it actually document each GD4 requirement line?
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
            {!folder?.policyLink && !folder?.folderLink && <span style={{ color: "#b23121" }}> · No Policy & Procedure folder linked yet (Evidence Folder page).</span>}
          </p>
          <button
            disabled={isRunning}
            onClick={() => { setCompileMsg(null); runPPDReview(selectedId); }}
            style={{ cursor: isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", marginBottom: 12 }}
          >
            {isRunning ? "Reviewing…" : result ? "Re-run PPD review" : "Run PPD review"}
          </button>
        </>
      )}

      {sub && !result && !isRunning && (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No review run yet for this sub-criterion. Click "Run PPD review" above.</p>
      )}

      {result && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, color: "#6b7280" }}>
              Last run {new Date(result.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {" · "}{result.live ? "Live AI" : "Offline"}
              {" · "}{result.rows.filter((r) => r.verdict === "Adequate").length} Adequate, {result.rows.filter((r) => r.verdict === "Partial").length} Partial, {result.rows.filter((r) => r.verdict === "Not documented").length} Not documented
            </div>
            <button
              onClick={handleCompile}
              disabled={compilable === 0}
              title="Raise a finding (NC/OFI) for every Partial/Not documented line that doesn't already have one"
              style={{
                marginLeft: "auto", cursor: compilable === 0 ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 8, border: "1px solid #4338ca",
                background: compilable === 0 ? "#eef2ff" : "#4338ca", color: compilable === 0 ? "#a5b4fc" : "#fff", whiteSpace: "nowrap",
              }}
            >
              Compile findings → {compilable > 0 ? `(${compilable})` : ""}
            </button>
            <Link to={`/findings?item=${selectedId}`} style={{ fontSize: 12, color: "#4a5a8a", fontWeight: 600, textDecoration: "none", padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 8 }}>
              Findings register →
            </Link>
          </div>
          {compileMsg && (
            <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 11px", marginBottom: 8 }}>
              {compileMsg}
            </div>
          )}
          {/* Sticky column header, aligned to the same 3-column grid as each row below. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              gap: 10,
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px 8px 0 0",
              padding: "6px 12px",
              marginBottom: -1,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>GD4 requirement</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>PPD procedure (AI-matched)</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>AI verdict</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.rows.map((row) => {
              const expanded = expandedRows.has(row.ref);
              const sourceRef = row.chunkIds.length > 0
                ? row.chunkIds.map((cid) => result.chunkFileNames?.[cid] ? `${result.chunkFileNames[cid]} · ${cid}` : cid).join(", ")
                : "No chunk cited";
              const extractPreview = row.fullComment || row.shortComment || "(no comment returned)";
              return (
                <div
                  key={row.ref}
                  style={{ border: "1px solid #e2e8f0", borderLeft: `4px solid ${verdictBorderColor(row.verdict)}`, borderRadius: 8, padding: "10px 12px" }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: GRID_COLUMNS, gap: 10, alignItems: "start" }}>
                    {/* Column 1 — GD4 requirement (ref + full line text) */}
                    <div>
                      <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 4 }}>{row.ref}</div>
                      <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.4 }}>{row.requirementText}</div>
                    </div>

                    {/* Column 2 — PPD procedure (AI-extracted match + source) */}
                    <div>
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 4, fontFamily: "ui-monospace,monospace" }}>{sourceRef}</div>
                      <div style={{ borderLeft: "3px solid #c7d2fe", paddingLeft: 8, fontSize: 12, color: "#374151", lineHeight: 1.4, fontStyle: "italic" }}>
                        {extractPreview}
                      </div>
                    </div>

                    {/* Column 3 — AI verdict */}
                    <div>
                      <Pill s={verdictTone(row.verdict)}>{row.verdict}</Pill>
                      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, margin: "5px 0" }}>{row.shortComment}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          onClick={() => toggleExpanded(row.ref)}
                          style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4a5a8a", border: "none", background: "transparent", padding: 0 }}
                        >
                          {expanded ? "Hide full comment + rewrite ▲" : "Show full comment + rewrite ▼"}
                        </button>
                        {row.savedFindingId ? (
                          <>
                            <Pill s={findingTypeTone(row.verdict === "Not documented" ? "NC" : "OFI")}>Saved as {row.savedFindingId}</Pill>
                            <Link to={`/findings?item=${row.gd4ItemId}`} style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600, textDecoration: "none" }}>View →</Link>
                          </>
                        ) : row.verdict !== "Adequate" ? (
                          <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Not yet compiled</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail — full-width panel below the 3 columns, not inside any one column. */}
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
    </Card>
  );
}
