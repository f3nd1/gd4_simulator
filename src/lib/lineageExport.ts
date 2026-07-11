import { toCsv, downloadCsv } from "./auditCsvExport";

// CSV/PDF export for the lineage coverage matrix (LineageDiagram.tsx), Option
// A only. Both exports work off EXACTLY the rows currently rendered in the
// active tab's matrix — no cross-tab data, no re-fetch, no truncation (the
// on-screen "+N more file(s)" stacking is a display convenience; the export
// is where the full list belongs, since this is what an external auditor
// works from once the app isn't open in front of them).

export type LineageExportRow = {
  ref: string;
  requirementText: string;   // full text, never the display-truncated snippet
  verdictLabel: string;
  fileNames: string[];       // full list, joined "; " at export time — never "+N more"
  clauseOrPassage: string;   // policy: distinct clause refs joined; evidence: the supporting passage
  rationale: string;
  barColor: string;          // the row's own left-edge coverage colour, reused as-is (not re-derived)
};

export type LineageExportMeta = {
  tab: "policy" | "evidence";
  runLabel: string;   // sub-criterion id + title, e.g. "6.2 Management Review"
  runAt: string;      // ISO date of the run this matrix reflects
  statusLine: string; // e.g. "2 Documented · 1 Partly · 1 Not covered · 1 Not checked"
};

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lineage";
}

function filenameBase(meta: LineageExportMeta): string {
  return `${safeFilenamePart(meta.runLabel)}-${meta.tab}-lineage-${timestamp()}`;
}

function formatRunAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CSV_HEADERS: Record<LineageExportMeta["tab"], string[]> = {
  policy: ["GD4 Requirement", "Ref", "Policy Verdict", "Policy File(s)", "Policy Clause", "Rationale"],
  evidence: ["GD4 Requirement", "Ref", "Evidence Verdict", "Evidence File(s)", "Supporting Passage", "Rationale"],
};

// Pure builder — exported for unit testing (column order/content, full
// untruncated multi-file "; " join, CSV escaping via the shared csvCell/toCsv
// utility rather than a second serializer) without needing to trigger a
// browser download. Genuinely-empty cells show "—", matching the on-screen
// matrix's own convention (and buildLineagePdfHtml below) rather than a bare
// empty CSV cell an external auditor could misread as a data glitch.
export function buildLineageCsv(meta: LineageExportMeta, rows: LineageExportRow[]): string {
  const csvRows = rows.map((r) => [
    r.requirementText,
    r.ref,
    r.verdictLabel,
    r.fileNames.join("; ") || "—",
    r.clauseOrPassage || "—",
    r.rationale || "—",
  ]);
  return toCsv(CSV_HEADERS[meta.tab], csvRows);
}

export function downloadLineageCsv(meta: LineageExportMeta, rows: LineageExportRow[]): void {
  downloadCsv(buildLineageCsv(meta, rows), `${filenameBase(meta)}.csv`);
}

// Escapes text for safe interpolation into the generated HTML document —
// separate from CSV escaping (csvCell), since this is a different sink.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Exported for unit testing (asserts real <table> markup, full untruncated
// text, and the colour-preservation directive) without needing to actually
// open a browser window.
export function buildLineagePdfHtml(meta: LineageExportMeta, rows: LineageExportRow[]): string {
  const headers = CSV_HEADERS[meta.tab];
  const title = `${filenameBase(meta)}`;
  const rowsHtml = rows.map((r) => `
    <tr style="border-left:4px solid ${escapeHtml(r.barColor)};">
      <td>${escapeHtml(r.requirementText)}</td>
      <td class="mono">${escapeHtml(r.ref)}</td>
      <td>${escapeHtml(r.verdictLabel)}</td>
      <td>${escapeHtml(r.fileNames.join("; ") || "—")}</td>
      <td>${escapeHtml(r.clauseOrPassage || "—")}</td>
      <td>${escapeHtml(r.rationale || "—")}</td>
    </tr>`).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { color: #475569; font-size: 12px; margin-bottom: 2px; }
  .caption { font-style: italic; color: #64748b; font-size: 11px; margin: 8px 0 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; vertical-align: top; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  th { background: #f8fafc; text-transform: uppercase; letter-spacing: 0.3px; font-size: 9.5px; color: #64748b; }
  td.mono { font-family: ui-monospace, monospace; white-space: nowrap; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>Requirement coverage — ${escapeHtml(meta.tab === "policy" ? "policy" : "evidence")} — ${escapeHtml(meta.runLabel)}</h1>
  <div class="meta">Run date: ${escapeHtml(formatRunAt(meta.runAt))}</div>
  <div class="meta">Overall: ${escapeHtml(meta.statusLine)}</div>
  <div class="caption">Expand rows in-app for quoted passages and per-clause rationale.</div>
  <table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

// Opens the matrix as a standalone printable document in a new tab and
// triggers the browser's native print dialog — the same "Print / Save as
// PDF" pattern already used by FinalReport.tsx, generalised into a reusable
// function rather than duplicated. Zero new dependencies: the browser's own
// print-to-PDF renders real HTML text (never rasterised), so the output is
// selectable/searchable by construction. Setting `document.title` in the new
// window makes the browser's Save-as-PDF dialog default to the right filename.
export function openLineagePdf(meta: LineageExportMeta, rows: LineageExportRow[]): void {
  const html = buildLineagePdfHtml(meta, rows);
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked — nothing else to fall back to client-side
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = filenameBase(meta);
  win.focus();
  // Give the new document a tick to finish laying out before printing.
  win.setTimeout(() => win.print(), 150);
}
