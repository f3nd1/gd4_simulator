import { useState } from "react";
import { normalizeAuditRef } from "../../lib/gd4Refs";
import type { PPDReviewResult, PPDReviewRow, EvidenceAssessmentResult } from "../../types";

// Requirement → PPD-clause → Evidence lineage diagram.
//
// A read-only visualisation of data ALREADY computed per requirement line by
// the PPD review / evidence assessment — no recompute, no re-fetch. Each line
// renders as a horizontal chain of nodes:
//   (1) the GD4 requirement line   (2) the PPD clause that documents it
//   (3) the evidence cited for it  (Evidence tab only)
// A node with no real backing (PPD not documented, or no evidence cited) shows
// as a visually distinct dashed "gap" node so misses are obvious at a glance.
//
// Every node links to something real and already-supported elsewhere:
//   • requirement / PPD nodes → scroll to + open that line's row (onOpenLine)
//   • evidence node → opens the cited Drive file (the same /file/d/{id}/view
//     links used by the File Ledger and evidence rows).

type NodeState = "documented" | "gap";
type LineageLine = {
  ref: string;
  reqLabel: string;
  ppd: { state: NodeState; verdict: string; fileLabel?: string };
  evidence?: { state: NodeState; fileLabel?: string; url?: string };
};

function shorten(s: string, n = 84): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

// A PPD clause counts as "documented" only when the row's verdict is a positive
// match AND it actually cited a PPD chunk — never guess a connection.
function ppdDocumented(verdict: string, chunkIds: string[]): boolean {
  return (verdict === "Adequate" || verdict === "Partial") && chunkIds.length > 0;
}

function ppdLineage(ppd: PPDReviewResult): LineageLine[] {
  return ppd.rows.map((r) => ({
    ref: r.ref,
    reqLabel: r.requirementText,
    ppd: {
      state: ppdDocumented(r.verdict, r.chunkIds) ? "documented" : "gap",
      verdict: r.verdict,
      fileLabel: r.chunkIds.length > 0 ? (ppd.chunkFileNames?.[r.chunkIds[0]] ?? r.chunkIds[0]) : undefined,
    },
  }));
}

function evidenceLineage(ev: EvidenceAssessmentResult, ppd?: PPDReviewResult): LineageLine[] {
  const ppdByRef = new Map<string, PPDReviewRow>();
  if (ppd) for (const r of ppd.rows) ppdByRef.set(normalizeAuditRef(r.ref), r);
  return ev.rows.map((r) => {
    const pr = ppdByRef.get(normalizeAuditRef(r.gdRef));
    // PPD documented: positive verdict AND (if we can see the PPD row) it cited a
    // chunk. When the matched PPD row is missing we fall back to the verdict only.
    const documented = (r.ppdVerdict === "Adequate" || r.ppdVerdict === "Partial") && (!pr || pr.chunkIds.length > 0);
    const ppdFile = pr && pr.chunkIds.length > 0 ? (ppd?.chunkFileNames?.[pr.chunkIds[0]] ?? pr.chunkIds[0]) : undefined;
    // Evidence cited: a real chunk AND a real file ref (name+url). No citation → genuine gap.
    const evCited = r.evidenceChunkIds.length > 0 && r.evidenceFiles.length > 0;
    const evFile = r.evidenceFiles[0];
    return {
      ref: r.gdRef,
      reqLabel: r.requirementText,
      ppd: { state: documented ? "documented" : "gap", verdict: r.ppdVerdict, fileLabel: ppdFile },
      evidence: { state: evCited ? "documented" : "gap", fileLabel: evFile?.name, url: evFile?.url },
    };
  });
}

const NODE_BASE: React.CSSProperties = {
  fontSize: 11, borderRadius: 7, padding: "5px 9px", minWidth: 0, boxSizing: "border-box",
  display: "flex", flexDirection: "column", gap: 1, overflow: "hidden",
};
const Arrow = ({ dim }: { dim?: boolean }) => (
  <span aria-hidden style={{ flexShrink: 0, color: dim ? "#cbd5e1" : "#94a3b8", fontSize: 13, alignSelf: "center" }}>→</span>
);

export function LineageDiagram({ mode, ppd, evidence, onOpenLine }: {
  mode: "ppd" | "evidence";
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
  onOpenLine: (ref: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const lines = mode === "ppd" ? (ppd ? ppdLineage(ppd) : []) : (evidence ? evidenceLineage(evidence, ppd) : []);
  if (lines.length === 0) return null;

  const gaps = lines.filter((l) => l.ppd.state === "gap" || (l.evidence && l.evidence.state === "gap")).length;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 12, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: open ? "1px solid #f1f5f9" : "none", flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Requirement → PPD{mode === "evidence" ? " → Evidence" : ""} map
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{lines.length} line{lines.length !== 1 ? "s" : ""}{gaps > 0 ? ` · ${gaps} with a gap` : " · all traced"}</span>
        {/* Legend */}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, fontSize: 10.5, color: "#64748b", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 3, background: "#eef2ff", border: "1px solid #c7d2fe" }} /> documented
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 3, background: "#fff", border: "1px dashed #fca5a5" }} /> gap
          </span>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ maxHeight: 380, overflowY: "auto", padding: "6px 10px 10px" }}>
          {lines.map((line, i) => {
            const gridCols = mode === "evidence" ? "minmax(0,1fr) 14px minmax(0,1fr) 14px minmax(0,1fr)" : "minmax(0,1fr) 14px minmax(0,1.3fr)";
            return (
              <div key={line.ref + i} style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "stretch", gap: 6, padding: "4px 0", borderTop: i ? "1px solid #f6f7f9" : "none" }}>
                {/* (1) Requirement node */}
                <button
                  type="button"
                  onClick={() => onOpenLine(line.ref)}
                  title={`${line.ref} — ${line.reqLabel}\n(open this line)`}
                  style={{ ...NODE_BASE, textAlign: "left", cursor: "pointer", background: "#f8fafc", border: "1px solid #e2e8f0", color: "#1e293b" }}
                >
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, fontWeight: 700, color: "#4338ca" }}>{line.ref}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shorten(line.reqLabel)}</span>
                </button>

                <Arrow dim={line.ppd.state === "gap"} />

                {/* (2) PPD clause node */}
                <button
                  type="button"
                  onClick={() => onOpenLine(line.ref)}
                  title={line.ppd.state === "documented"
                    ? `PPD ${line.ppd.verdict}${line.ppd.fileLabel ? ` — ${line.ppd.fileLabel}` : ""}\n(open this line's PPD detail)`
                    : `No PPD clause documents this line (verdict: ${line.ppd.verdict})`}
                  style={{
                    ...NODE_BASE, textAlign: "left", cursor: "pointer",
                    background: line.ppd.state === "documented" ? "#eef2ff" : "#fff",
                    border: line.ppd.state === "documented" ? "1px solid #c7d2fe" : "1px dashed #fca5a5",
                    color: line.ppd.state === "documented" ? "#3730a3" : "#b91c1c",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.2, opacity: 0.8 }}>
                    {line.ppd.state === "documented" ? `PPD · ${line.ppd.verdict}` : "PPD gap"}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {line.ppd.state === "documented" ? (line.ppd.fileLabel ?? "documented") : "Not documented"}
                  </span>
                </button>

                {/* (3) Evidence node — Evidence tab only */}
                {mode === "evidence" && line.evidence && (
                  <>
                    <Arrow dim={line.evidence.state === "gap"} />
                    {line.evidence.state === "documented" && line.evidence.url ? (
                      <a
                        href={line.evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={`Cited evidence: ${line.evidence.fileLabel ?? "file"}\n(open in Google Drive)`}
                        style={{ ...NODE_BASE, textDecoration: "none", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.2, opacity: 0.85 }}>Evidence ↗</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.evidence.fileLabel ?? "cited file"}</span>
                      </a>
                    ) : (
                      <div
                        title="No evidence was cited for this line"
                        style={{ ...NODE_BASE, background: "#fff", border: "1px dashed #fca5a5", color: "#b91c1c" }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.2, opacity: 0.85 }}>Evidence gap</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>No evidence found</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
