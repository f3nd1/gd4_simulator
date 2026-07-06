import { useCallback, useState } from "react";
import { normalizeAuditRef } from "../../lib/gd4Refs";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ExtractedTextPanel } from "./ExtractedTextPanel";
import { excerptAround } from "./quoteMatch";
import type { PPDReviewResult, PPDReviewRow, EvidenceAssessmentResult, AuditFileRecord, PPDSubClause, PromiseCheck } from "../../types";

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
// Clicking a row expands it INLINE (no modal). Many GD4 requirement lines have
// several sub-parts (A/B/C/D — the PPD review's STEP 1 sub-clause decomposition
// on the PPD side; the per-promise checks on the Evidence side), and each
// sub-part is checked INDEPENDENTLY, with its own verdict and its own exact
// verbatim quote. The expanded view shows exactly that: one small block PER
// sub-part, each labelled and showing only the short excerpt around its own
// quote — never the whole document, and never one quote standing in for the
// whole line. A sub-part with no located quote is shown as an explicit gap for
// THAT sub-part, not silently folded into the line's overall verdict. Lines
// with no sub-part decomposition fall back to the single line-level quote,
// same excerpt-only treatment. The full extracted document is still reachable
// via an explicit "View full text" toggle, but it is never the default view.

type NodeState = "documented" | "gap";
// One independently-checked sub-part of a requirement line (a PPD sub-clause,
// or an evidence-side promise check) — label is assigned by array order
// (A, B, C, …) since neither source carries an explicit letter.
type LinePart = {
  label: string;
  text: string;
  positive: boolean;
  // "contradicted" gets its own (amber, ⚠) styling — it's a hard fail, not a
  // plain absence, and its quote (when present) is the CONTRADICTING passage.
  negativeKind?: "not-documented" | "not-evidenced" | "contradicted";
  quote?: string;
};
type NodeData = { state: NodeState; label: string; sub: string; file?: AuditFileRecord; quote?: string; url?: string; parts?: LinePart[] };
type LineageLine = {
  ref: string;
  reqLabel: string;
  ppd: NodeData;
  evidence?: NodeData;
};

function shorten(s: string, n = 84): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

// PPD-side sub-parts: the STEP 1 sub-clause decomposition, each already
// carrying its own documented/not-documented verdict and (now) its own quote.
function subClauseParts(subClauses?: PPDSubClause[]): LinePart[] | undefined {
  if (!subClauses || subClauses.length === 0) return undefined;
  return subClauses.map((c, i) => ({
    label: String.fromCharCode(65 + i),
    text: c.text,
    positive: c.verdict === "documented",
    negativeKind: c.verdict === "not documented" ? "not-documented" : undefined,
    quote: c.quote,
  }));
}

// Evidence-side sub-parts: each PPD promise's individual verification against
// the Actual Evidence — the evidence-to-policy equivalent of subClauses.
function promiseCheckParts(checks?: PromiseCheck[]): LinePart[] | undefined {
  if (!checks || checks.length === 0) return undefined;
  return checks.map((c, i) => ({
    label: String.fromCharCode(65 + i),
    text: c.promiseText,
    positive: c.verdict === "evidenced",
    negativeKind: c.verdict === "contradicted" ? "contradicted" : c.verdict === "not evidenced" ? "not-evidenced" : undefined,
    quote: c.quote,
  }));
}

// A PPD clause counts as "documented" only when the row's verdict is a positive
// match AND it actually cited a PPD chunk — never guess a connection.
function ppdDocumented(verdict: string, chunkIds: string[]): boolean {
  return (verdict === "Adequate" || verdict === "Partial") && chunkIds.length > 0;
}

// Resolve the AuditFileRecord for a cited chunk from the run's file ledger, so
// its extracted text can be shown. Match by the chunk's source file name.
function fileForChunk(chunkId: string | undefined, chunkFileNames: Record<string, string> | undefined, ledger: AuditFileRecord[] | undefined): AuditFileRecord | undefined {
  if (!chunkId || !ledger) return undefined;
  const name = chunkFileNames?.[chunkId];
  if (!name) return undefined;
  return ledger.find((f) => f.name === name);
}

function ppdLineage(ppd: PPDReviewResult): LineageLine[] {
  return ppd.rows.map((r) => {
    const documented = ppdDocumented(r.verdict, r.chunkIds);
    const fileLabel = r.chunkIds.length > 0 ? (ppd.chunkFileNames?.[r.chunkIds[0]] ?? r.chunkIds[0]) : undefined;
    return {
      ref: r.ref,
      reqLabel: r.requirementText,
      ppd: {
        state: documented ? "documented" : "gap",
        label: documented ? `PPD · ${r.verdict}` : "PPD gap",
        sub: documented ? (fileLabel ?? "documented") : "Not documented",
        file: documented ? fileForChunk(r.chunkIds[0], ppd.chunkFileNames, ppd.fileLedger) : undefined,
        quote: documented ? r.supportQuote : undefined,
        parts: subClauseParts(r.subClauses),
      },
    };
  });
}

function evidenceLineage(ev: EvidenceAssessmentResult, ppd?: PPDReviewResult): LineageLine[] {
  const ppdByRef = new Map<string, PPDReviewRow>();
  if (ppd) for (const r of ppd.rows) ppdByRef.set(normalizeAuditRef(r.ref), r);
  return ev.rows.map((r) => {
    const pr = ppdByRef.get(normalizeAuditRef(r.gdRef));
    // PPD documented: positive verdict AND (if we can see the PPD row) it cited a chunk.
    const documented = (r.ppdVerdict === "Adequate" || r.ppdVerdict === "Partial") && (!pr || pr.chunkIds.length > 0);
    const ppdFile = pr && pr.chunkIds.length > 0 ? (ppd?.chunkFileNames?.[pr.chunkIds[0]] ?? pr.chunkIds[0]) : undefined;
    // Evidence cited: a real chunk AND a real file ref (name+url). No citation → genuine gap.
    const evCited = r.evidenceChunkIds.length > 0 && r.evidenceFiles.length > 0;
    const evFile = r.evidenceFiles[0];
    return {
      ref: r.gdRef,
      reqLabel: r.requirementText,
      ppd: {
        state: documented ? "documented" : "gap",
        label: documented ? `PPD · ${r.ppdVerdict}` : "PPD gap",
        sub: documented ? (ppdFile ?? "documented") : "Not documented",
        file: documented && pr ? fileForChunk(pr.chunkIds[0], ppd?.chunkFileNames, ppd?.fileLedger) : undefined,
        quote: documented ? pr?.supportQuote : undefined,
        parts: subClauseParts(pr?.subClauses),
      },
      evidence: {
        state: evCited ? "documented" : "gap",
        label: evCited ? "Evidence" : "Evidence gap",
        sub: evCited ? (evFile?.name ?? "cited file") : "No evidence found",
        file: evCited ? fileForChunk(r.evidenceChunkIds[0], ev.chunkFileNames, ev.fileLedger) : undefined,
        quote: evCited ? r.evidenceQuote : undefined,
        url: evFile?.url,
        parts: promiseCheckParts(r.promiseChecks),
      },
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

function nodeStyle(state: NodeState, kind: "ppd" | "evidence"): React.CSSProperties {
  if (state === "gap") return { ...NODE_BASE, background: "#fff", border: "1px dashed #fca5a5", color: "#b91c1c" };
  return kind === "ppd"
    ? { ...NODE_BASE, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3" }
    : { ...NODE_BASE, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" };
}

function Node({ data, kind }: { data: NodeData; kind: "ppd" | "evidence" }) {
  return (
    <div style={nodeStyle(data.state, kind)} title={`${data.label} — ${data.sub}`}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.2, opacity: 0.85 }}>{data.label}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.sub}</span>
    </div>
  );
}

// Renders EITHER the short excerpt around a located quote, OR an explicit gap
// message — never the whole document, never a fabricated location. `text` is
// the resolved extracted text (undefined when the cache doesn't have it, in
// which case a verified-at-write-time quote still shows as plain text with a
// "context unavailable" note, rather than being silently dropped).
function QuoteOrGap({ quote, text, gapMessage }: { quote?: string; text?: string; gapMessage: string }) {
  if (!quote) {
    return (
      <div style={{ fontSize: 11, color: "#b91c1c", background: "#fff", border: "1px dashed #fca5a5", borderRadius: 5, padding: "4px 8px", fontStyle: "italic" }}>
        {gapMessage}
      </div>
    );
  }
  const excerpt = text ? excerptAround(text, quote) : null;
  if (!excerpt) {
    return (
      <div style={{ fontSize: 11, color: "#713f12", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 5, padding: "4px 8px" }}>
        <span style={{ fontWeight: 700 }}>🔦</span> “{shorten(quote, 220)}” <span style={{ color: "#94a3b8", fontStyle: "italic" }}>(context unavailable — re-run to refresh the cache)</span>
      </div>
    );
  }
  return (
    <div style={{ fontSize: 11, color: "#713f12", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 5, padding: "4px 8px" }}>
      {excerpt.clippedStart && "… "}{excerpt.before}<mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{excerpt.match}</mark>{excerpt.after}{excerpt.clippedEnd && " …"}
    </div>
  );
}

// One independently-checked sub-part — its own label, its own verdict icon,
// and its own excerpt-or-gap. A negative sub-part shows a gap EVEN IF other
// sub-parts (or the line overall) are positive — the point is that a genuine
// per-part miss must stay visible, not get absorbed into the line's verdict.
function PartExcerpt({ part, text }: { part: LinePart; text?: string }) {
  const icon = part.positive ? "✓" : part.negativeKind === "contradicted" ? "⚠" : "✗";
  const tone = part.positive ? "#15803d" : part.negativeKind === "contradicted" ? "#b45309" : "#b91c1c";
  const gapMessage = part.positive
    ? "Documented, but no single exact quote could be located for this sub-part — see \"View full text\" for context."
    : part.negativeKind === "contradicted"
      ? `Sub-part ${part.label} was flagged as contradicted, but no supporting passage could be located.`
      : `No supporting passage found for Sub-part ${part.label} — this specific sub-part is not addressed.`;
  return (
    <div style={{ border: `1px solid ${part.positive ? "#bbf7d0" : "#fecaca"}`, borderRadius: 6, padding: "6px 9px", background: part.positive ? "#f6fefa" : "#fffafa" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 10.5, color: tone, whiteSpace: "nowrap" }}>{icon} Sub-part {part.label}</span>
        <span style={{ fontSize: 11, color: "#475569" }}>{shorten(part.text, 140)}</span>
      </div>
      <QuoteOrGap quote={part.quote} text={text} gapMessage={gapMessage} />
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = { cursor: "pointer", fontSize: 10.5, fontWeight: 600, color: "#4338ca", border: "none", background: "transparent", padding: 0, textDecoration: "underline" };

// One node's expanded view. Default is EXCERPT-ONLY: per sub-part when the
// decomposition is available (each its own labelled block via PartExcerpt),
// else the single line-level quote's excerpt as a fallback. Gap → honest
// empty state. Missing ledger/text → an honest "not available" note. The full
// extracted document is available ONLY via the explicit "View full text"
// toggle below — never shown by default.
function PassageBlock({
  title, node, resolveText, emptyText,
}: {
  title: string;
  node: NodeData;
  resolveText: (f: AuditFileRecord) => string | null | undefined;
  emptyText: string;
}) {
  const [showFull, setShowFull] = useState(false);
  const resolved = node.file ? resolveText(node.file) : undefined;
  const text = typeof resolved === "string" ? resolved : undefined;
  const hasParts = !!node.parts && node.parts.length > 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</span>
        {node.state === "documented" && node.sub && <span style={{ fontSize: 11, color: "#64748b" }}>{node.sub}</span>}
        {node.url && (
          <a href={node.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, color: "#4338ca", textDecoration: "none" }}>Open in Drive ↗</a>
        )}
      </div>
      {hasParts ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {node.parts!.map((p) => <PartExcerpt key={p.label} part={p} text={text} />)}
        </div>
      ) : node.state === "gap" ? (
        <div style={{ fontSize: 11.5, color: "#b91c1c", background: "#fff", border: "1px dashed #fca5a5", borderRadius: 6, padding: "8px 10px" }}>{emptyText}</div>
      ) : node.file ? (
        <QuoteOrGap quote={node.quote} text={text} gapMessage='No single exact quote was identified for this line — see "View full text" for the full cited passage.' />
      ) : (
        <div style={{ fontSize: 11.5, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
          The extracted text for this cited passage isn’t available (it predates per-file capture, or the cache was cleared). Re-run to capture it.
        </div>
      )}
      {node.file && (
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowFull((v) => !v); }} style={linkButtonStyle}>
            {showFull ? "Hide full text" : "View full text →"}
          </button>
          {showFull && (
            <div style={{ marginTop: 4 }}>
              <ExtractedTextPanel file={node.file} resolveText={resolveText} highlight={node.quote} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LineageDiagram({ mode, ppd, evidence, onOpenLine }: {
  mode: "ppd" | "evidence";
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
  onOpenLine: (ref: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const fileTextCache = useWorkspaceStore((s) => s.fileTextCache);
  const resolveText = useCallback(
    (f: AuditFileRecord): string | null | undefined =>
      f.driveFileId ? fileTextCache[`${f.driveFileId}:${f.driveModifiedTime ?? ""}`]?.text : undefined,
    [fileTextCache]
  );

  const lines = mode === "ppd" ? (ppd ? ppdLineage(ppd) : []) : (evidence ? evidenceLineage(evidence, ppd) : []);
  if (lines.length === 0) return null;

  const gaps = lines.filter((l) => l.ppd.state === "gap" || (l.evidence && l.evidence.state === "gap")).length;
  const gridCols = mode === "evidence" ? "12px minmax(0,1fr) 14px minmax(0,1fr) 14px minmax(0,1fr)" : "12px minmax(0,1fr) 14px minmax(0,1.3fr)";

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 12, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: open ? "1px solid #f1f5f9" : "none", flexWrap: "wrap" }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.3 }}>
          Requirement → PPD{mode === "evidence" ? " → Evidence" : ""} map
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{lines.length} line{lines.length !== 1 ? "s" : ""}{gaps > 0 ? ` · ${gaps} with a gap` : " · all traced"} · click a row to see the cited text</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, fontSize: 10.5, color: "#64748b", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 3, background: "#eef2ff", border: "1px solid #c7d2fe" }} /> documented
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 3, background: "#fff", border: "1px dashed #fca5a5" }} /> gap
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 3px" }}>abc</mark> exact quote
          </span>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ maxHeight: 520, overflowY: "auto", padding: "6px 10px 10px" }}>
          {lines.map((line, i) => {
            const isOpen = openRef === line.ref;
            return (
              <div key={line.ref + i} style={{ borderTop: i ? "1px solid #f6f7f9" : "none" }}>
                {/* Clickable node row — toggles the inline passage view. */}
                <div
                  onClick={() => setOpenRef(isOpen ? null : line.ref)}
                  style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "stretch", gap: 6, padding: "4px 0", cursor: "pointer" }}
                >
                  <span aria-hidden style={{ alignSelf: "center", color: "#94a3b8", fontSize: 10 }}>{isOpen ? "▾" : "▸"}</span>
                  {/* (1) Requirement node */}
                  <div style={{ ...NODE_BASE, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#1e293b" }} title={`${line.ref} — ${line.reqLabel}`}>
                    <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, fontWeight: 700, color: "#4338ca" }}>{line.ref}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shorten(line.reqLabel)}</span>
                  </div>
                  <Arrow dim={line.ppd.state === "gap"} />
                  {/* (2) PPD clause node */}
                  <Node data={line.ppd} kind="ppd" />
                  {/* (3) Evidence node — Evidence tab only */}
                  {mode === "evidence" && line.evidence && (
                    <>
                      <Arrow dim={line.evidence.state === "gap"} />
                      <Node data={line.evidence} kind="evidence" />
                    </>
                  )}
                </div>

                {/* Inline expand-to-reveal — the cited passages with highlight. */}
                {isOpen && (
                  <div style={{ margin: "2px 0 10px 18px", paddingLeft: 10, borderLeft: "2px solid #e2e8f0" }}>
                    <PassageBlock
                      title="PPD passage"
                      node={line.ppd}
                      resolveText={resolveText}
                      emptyText="No PPD passage — this requirement is not documented in the Policy & Procedure Document."
                    />
                    {mode === "evidence" && line.evidence && (
                      <PassageBlock
                        title="Evidence passage"
                        node={line.evidence}
                        resolveText={resolveText}
                        emptyText="No evidence found — no implementation record was cited for this requirement."
                      />
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenLine(line.ref); }}
                      style={{ marginTop: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4338ca", border: "none", background: "transparent", padding: 0 }}
                    >
                      Jump to full line detail →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
