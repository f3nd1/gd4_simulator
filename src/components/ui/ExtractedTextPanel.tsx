import type { AuditFileRecord } from "../../types";
import { findQuoteSpan } from "./quoteMatch";

// Shared extracted-text viewer — the single component for showing what was
// actually read from a file (used by the File Ledger rows, the Ask-AI step, and
// the lineage diagram's expand-to-reveal). No second viewer anywhere.
//
// Max chars rendered inline (the full text can be huge; a generous window is
// enough to judge a good read from a bad one). When a `highlight` quote is given
// and found, the window is centred on the quote instead of the file start.
export const EXTRACTED_TEXT_VIEW_CAP = 40_000;

const MONO: React.CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace,monospace", fontSize: 10.5, color: "#1f2733", lineHeight: 1.45 };

export function ExtractedTextPanel({
  file,
  resolveText,
  highlight,
}: {
  file: AuditFileRecord;
  resolveText?: (f: AuditFileRecord) => string | null | undefined;
  highlight?: string;
}) {
  const text = resolveText?.(file);
  let body: React.ReactNode;
  if (file.readStatus === "skipped") {
    body = <span style={{ color: "#9ca3af" }}>Not read — {file.skipReason || "skipped"}. Nothing was extracted, so this file contributed no evidence.</span>;
  } else if (file.readStatus === "failed") {
    body = <span style={{ color: "#b91c1c" }}>Read failed — {file.failReason || "unknown error"}. Nothing was extracted.</span>;
  } else if ((file.charCount ?? 0) === 0 || (typeof text === "string" && text.trim().length === 0)) {
    body = <span style={{ color: "#b45309" }}>0 characters — nothing readable was extracted from this file (image-only/blank). It was not cached and will be re-attempted next run.</span>;
  } else if (typeof text === "string") {
    const CAP = EXTRACTED_TEXT_VIEW_CAP;
    // Highlight only a quote that is a REAL substring of the source — never an
    // approximate/fabricated position. If not found, no highlight is shown.
    const span = highlight ? findQuoteSpan(text, highlight) : null;
    // Only window when the text actually exceeds the cap; then centre the window
    // on the quote so it's visible even in a long doc. When the whole text fits,
    // it is shown in full from index 0 — so the span offsets must be measured
    // against THIS slice's start (0 when unclipped), not the notional window.
    const willClip = text.length > CAP;
    const sliceStart = willClip && span ? Math.max(0, span[0] - 600) : 0;
    const shown = willClip ? text.slice(sliceStart, sliceStart + CAP) : text;
    const clippedStart = sliceStart > 0;
    const clippedEnd = sliceStart + CAP < text.length && willClip;
    let rendered: React.ReactNode = shown;
    if (span) {
      const s = span[0] - sliceStart;
      const e = span[1] - sliceStart;
      if (s >= 0 && e <= shown.length && e > s) {
        rendered = (
          <>
            {shown.slice(0, s)}
            <mark style={{ background: "#fde68a", color: "#713f12", borderRadius: 2, padding: "0 1px" }}>{shown.slice(s, e)}</mark>
            {shown.slice(e)}
          </>
        );
      }
    }
    body = (
      <>
        {clippedStart && <div style={{ marginBottom: 4, color: "#94a3b8", fontStyle: "italic" }}>…showing the passage around the highlighted quote…</div>}
        <div style={MONO}>{rendered}</div>
        {clippedEnd && <div style={{ marginTop: 4, color: "#94a3b8", fontStyle: "italic" }}>… ({text.length.toLocaleString()} characters total{clippedStart ? "" : `, showing first ${CAP.toLocaleString()}`}).</div>}
      </>
    );
  } else {
    body = <span style={{ color: "#94a3b8" }}>Extracted text isn't in the cache (it may have been cleared). Re-run the audit to view what was read.</span>;
  }
  return (
    <div style={{ padding: "6px 10px 9px 26px", borderBottom: "1px solid #f1f5f9", background: "#fbfcfe" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, fontSize: 10, color: "#64748b" }}>
        <span>Read via <b>{file.readMethod === "vision" ? "vision transcription" : file.readMethod === "text" ? "text extraction" : "—"}</b></span>
        <span>· {(file.charCount ?? 0).toLocaleString()} characters</span>
        {file.suspectedScannedPdf && <span style={{ color: "#92400e" }}>· suspected scanned PDF</span>}
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, background: "#fff", fontSize: 10.5 }}>{body}</div>
    </div>
  );
}
