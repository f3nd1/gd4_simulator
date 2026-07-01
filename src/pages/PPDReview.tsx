import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, filterSelectStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import type { PPDVerdict, PPDReviewRow } from "../types";

function verdictTone(v: PPDVerdict): "good" | "medium" | "critical" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : "critical";
}

export function PPDReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [critFilter, setCritFilter] = useState<string>("All");
  const [selectedId, setSelectedId] = useState<string>(() => searchParams.get("item") || GD4_SUB_CRITERIA[0]?.id || "");
  const subCritOptions = useMemo(
    () => (critFilter === "All" ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === critFilter)),
    [critFilter]
  );
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === selectedId);

  const busy = useWorkspaceStore((s) => s.busy);
  const runPPDReview = useWorkspaceStore((s) => s.runPPDReview);
  const acceptPPDRewrite = useWorkspaceStore((s) => s.acceptPPDRewrite);
  const ppdReviewResults = useWorkspaceStore((s) => s.ppdReviewResults);
  const ppdAcceptedRewrites = useWorkspaceStore((s) => s.ppdAcceptedRewrites);
  const folders = useWorkspaceStore((s) => s.folders);

  const result = ppdReviewResults[selectedId];
  const isRunning = busy === "ppdreview" + selectedId;
  const folder = folders.find((f) => f.subCriterionId === selectedId);

  const isAccepted = (row: PPDReviewRow) =>
    ppdAcceptedRewrites.some((r) => r.subCriterionId === selectedId && r.gd4ItemId === row.gd4ItemId && r.rewriteText === row.suggestedRewrite);

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>PPD Requirements Review</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          Checks the Policy & Procedure Document only — does it actually document each GD4 requirement?
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={critFilter}
          onChange={(e) => { setCritFilter(e.target.value); setSelectedId(""); }}
          style={filterSelectStyle}
        >
          <option value="All">All criteria</option>
          {GD4_CRITERIA.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}
        </select>
        <select
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); setSearchParams({ item: e.target.value }); }}
          style={filterSelectStyle}
        >
          <option value="">Select sub-criterion…</option>
          {subCritOptions.map((sc) => <option key={sc.id} value={sc.id}>{sc.id} — {sc.title}</option>)}
        </select>
        <button
          disabled={!selectedId || isRunning}
          onClick={() => runPPDReview(selectedId)}
          style={{ cursor: !selectedId || isRunning ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a" }}
        >
          {isRunning ? "Reviewing…" : "Run PPD review"}
        </button>
      </div>

      {sub && (
        <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: -4 }}>
          {sub.title} — {sub.description}
          {!folder?.policyLink && !folder?.folderLink && <span style={{ color: "#b23121" }}> · No Policy & Procedure folder linked yet (Evidence Folder page).</span>}
        </p>
      )}

      {!result && !isRunning && (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>No review run yet for this sub-criterion. Click "Run PPD review" above.</p>
      )}

      {result && (
        <>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 8 }}>
            Last run {new Date(result.runAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}{result.live ? "Live AI" : "Offline"}
            {" · "}{result.rows.filter((r) => r.verdict === "Adequate").length} Adequate, {result.rows.filter((r) => r.verdict === "Partial").length} Partial, {result.rows.filter((r) => r.verdict === "Not documented").length} Not documented
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.rows.map((row) => (
              <div key={row.gd4ItemId} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca" }}>{row.gd4ItemId}</span>
                  <Pill s={verdictTone(row.verdict)}>{row.verdict}</Pill>
                  {row.chunkIds.length > 0 && <span style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: "ui-monospace,monospace" }}>Cited: {row.chunkIds.join(", ")}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "#1e293b", marginBottom: 4 }}>{row.requirementText}</div>
                <div style={{ fontSize: 12, color: "#374151", marginBottom: row.suggestedRewrite ? 6 : 0 }}>{row.fullComment || row.shortComment}</div>
                {row.suggestedRewrite && (
                  <div style={{ background: "#f0f6ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "7px 10px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>Suggested rewrite</div>
                    <div style={{ fontSize: 12, color: "#1e293b", whiteSpace: "pre-line", marginBottom: 6 }}>{row.suggestedRewrite}</div>
                    {isAccepted(row) ? (
                      <Pill s="good">Accepted → PPD Improvement Tracker</Pill>
                    ) : (
                      <button
                        onClick={() => acceptPPDRewrite(selectedId, row)}
                        style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: "1px solid #4338ca", background: "#fff", color: "#4338ca" }}
                      >
                        Accept rewrite →
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
