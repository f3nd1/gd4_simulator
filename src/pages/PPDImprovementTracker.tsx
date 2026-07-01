import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { PPDRewriteStatus, PPDVerdict } from "../types";

const STATUS_OPTIONS: PPDRewriteStatus[] = ["To draft", "Drafted", "Published to PPD"];

function statusTone(s: PPDRewriteStatus): "critical" | "medium" | "good" {
  return s === "To draft" ? "critical" : s === "Drafted" ? "medium" : "good";
}

function verdictTone(v: PPDVerdict): "good" | "medium" | "critical" {
  return v === "Adequate" ? "good" : v === "Partial" ? "medium" : "critical";
}

export function PPDImprovementTracker() {
  const rewrites = useWorkspaceStore((s) => s.ppdAcceptedRewrites);
  const setPPDRewriteStatus = useWorkspaceStore((s) => s.setPPDRewriteStatus);
  const removePPDRewrite = useWorkspaceStore((s) => s.removePPDRewrite);

  // Group by PPD document — one list per policy document, newest accepted first.
  const grouped = useMemo(() => {
    const byDoc = new Map<string, typeof rewrites>();
    for (const r of rewrites) {
      const list = byDoc.get(r.documentName) ?? [];
      list.push(r);
      byDoc.set(r.documentName, list);
    }
    return Array.from(byDoc.entries())
      .map(([documentName, items]) => ({
        documentName,
        items: [...items].sort((a, b) => (b.acceptedAt > a.acceptedAt ? 1 : -1)),
      }))
      .sort((a, b) => a.documentName.localeCompare(b.documentName));
  }, [rewrites]);

  const openCount = rewrites.filter((r) => r.status !== "Published to PPD").length;

  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>PPD Improvement Tracker</h3>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{openCount} of {rewrites.length} rewrites not yet published</span>
        <Link to="/ppd-review" style={{ marginLeft: "auto", fontSize: 12, color: "#4338ca", fontWeight: 600, textDecoration: "none", padding: "4px 10px", border: "1px solid #c7d2fe", borderRadius: 6, background: "#eef2ff" }}>
          Run PPD review →
        </Link>
      </div>
      <p style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 12 }}>
        Every rewrite accepted from the PPD Requirements Review, grouped by which policy document it belongs to.
        Track each one from "To draft" through "Drafted" to "Published to PPD" as it's folded into the next PPD revision.
      </p>

      {grouped.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
          No accepted rewrites yet. Run a <Link to="/ppd-review" style={{ color: "#4338ca", fontWeight: 600 }}>PPD Requirements Review</Link> and accept a suggested rewrite to see it here.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grouped.map(({ documentName, items }) => (
            <div key={documentName} style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ background: "#f8fafc", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>📄 {documentName}</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>{items.length} rewrite{items.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ borderTop: "1px solid #f1f5f9" }}>
                {items.map((r) => (
                  <div key={r.id} style={{ padding: "10px 12px", borderTop: "1px solid #f8fafc" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, color: "#4338ca" }}>{r.gd4ItemId}</span>
                      <Pill s={verdictTone(r.originalVerdict)}>{r.originalVerdict}</Pill>
                      <span style={{ fontSize: 10.5, color: "#94a3b8" }}>from {r.subCriterionId}</span>
                      <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: "auto" }}>
                        accepted {new Date(r.acceptedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>{r.requirementText}</div>
                    <div style={{ background: "#f0f6ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "7px 10px", fontSize: 12, color: "#1e293b", whiteSpace: "pre-line", marginBottom: 6 }}>
                      {r.rewriteText}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Pill s={statusTone(r.status)}>{r.status}</Pill>
                      <select
                        value={r.status}
                        onChange={(e) => setPPDRewriteStatus(r.id, e.target.value as PPDRewriteStatus)}
                        style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 11.5 }}
                      >
                        {STATUS_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      <button
                        onClick={() => removePPDRewrite(r.id)}
                        title="Remove from tracker"
                        style={{ marginLeft: "auto", cursor: "pointer", border: "none", background: "transparent", color: "#94a3b8", fontSize: 11 }}
                      >
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
