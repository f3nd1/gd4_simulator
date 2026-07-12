import { toCsv, downloadCsv } from "./auditCsvExport";

// CSV/PDF export for the lineage coverage matrix (LineageDiagram.tsx), Option
// A only. Both exports work off EXACTLY the rows currently rendered in the
// active tab's matrix — no cross-tab data, no re-fetch, no truncation (the
// on-screen "+N more file(s)" stacking is a display convenience; the export
// is where the full list belongs, since this is what an external auditor
// works from once the app isn't open in front of them). This now ALSO
// includes each row's clause-by-clause detail (LineageClauseDetailItem[]),
// by default — see clauseDetail below and the includeClauseDetail param on
// the builders. Nothing in the detail is truncated either: the "no-crop"
// rule that applies to the flat matrix's columns applies identically here.

// One sub-part of a covered/partial line's clause-by-clause detail, as PLAIN
// TEXT (the on-screen highlight/fade treatment is a display concern only —
// export shows the full, real located passage verbatim). Computed once in
// LineageDiagram.tsx from the SAME SpineItem data the in-app 4-column table
// renders, never re-derived from a different source.
export type LineageClauseDetailItem = {
  name: string;             // Clause requirement
  found: boolean;
  contradicted?: boolean;
  // PPD tab: "§ clause\n\"quote\"" (or the honest fallback: spread-across /
  // no-exact-quote / unverified / not-found), i.e. the in-app column 2.
  // Evidence tab: the row's OWN Policy promise/clause text, repeated on every
  // sub-part row (matches the in-app table, where column 2 is constant per line).
  col2: string;
  fileName?: string;        // the sub-part's specifically attributed file, if any
  // Evidence tab only: the sub-part's own located passage / honest fallback
  // text (same content the in-app "File and Supporting passage" column
  // shows) — undefined on the PPD tab, where the located quote lives in col2.
  passage?: string;
  remarks: string;          // Remarks / Rationale
};

export type LineageExportRow = {
  ref: string;
  requirementText: string;   // full text, never the display-truncated snippet
  verdictLabel: string;
  fileNames: string[];       // full list, joined "; " at export time — never "+N more"
  clauseOrPassage: string;   // policy: distinct clause refs joined; evidence: the supporting passage
  rationale: string;
  // Evidence tab only: "what would make this Met", grounded in the AI's own
  // gap reasoning — undefined on the policy tab and on Met rows. Additive/
  // optional so older exported code paths / stored rows without it still work.
  suggestedAction?: string;
  // Evidence tab only: the PPD side's finding for this same ref (the matrix's
  // lead "Policy promise/clause" column) — undefined on the policy tab and on
  // very old stored runs predating the ppdExtract merge step (→ "—").
  policyPromise?: string;
  barColor: string;          // the row's own left-edge coverage colour, reused as-is (not re-derived)
  // The row's clause-by-clause detail (one entry per sub-part), when this
  // line is covered/partial and has sub-parts — undefined for flat gap/not-
  // checked rows, which have nothing to expand in-app either.
  clauseDetail?: LineageClauseDetailItem[];
};

export type LineageExportMeta = {
  tab: "policy" | "evidence";
  runLabel: string;   // sub-criterion id + title, e.g. "6.2 Management Review"
  runAt: string;      // ISO date of the run this matrix reflects
  statusLine: string; // e.g. "2 Documented · 1 Partly · 1 Not covered · 1 Not checked"
  // Sampling-basis caveat (samplingCaveat.ts) — printed on both exports so a
  // reader away from the app knows the conclusions cover only the files
  // provided, never unseen records. Optional so older callers still export.
  caveat?: string;
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

// ── Column registry ─────────────────────────────────────────────────────────
// One pickable column = one on-screen matrix column, in matrix order. The
// export column picker (LineageDiagram's export flow, BOTH tabs, CSV and PDF
// alike) works off this SAME registry, so the picker, the CSV and the PDF
// can never disagree about what a column is. A single matrix column can span
// more than one exported column: "requirement" carries the Ref alongside the
// text, and the evidence tab's "rationale" carries the Suggested Action
// (rendered inside the same Rationale cell on screen) — so unticking a
// picker column drops exactly what that on-screen column shows, no more.
export type LineageColumnKey = "requirement" | "policyPromise" | "verdict" | "files" | "clauseOrPassage" | "rationale";

export type LineageColumnDef = {
  key: LineageColumnKey;
  label: string;                             // picker label — matches the on-screen header
  headers: string[];                         // exported header cell(s)
  cells: (r: LineageExportRow) => string[];  // exported value cell(s), same length as headers
  mono?: boolean[];                          // per-sub-column: render monospace in the PDF (the Ref)
};

// Matrix order per tab. Evidence leads requirement → policy promise → verdict
// (the approved Policy → Evidence reframe); policy keeps its original order.
export function lineageColumnsFor(tab: LineageExportMeta["tab"]): LineageColumnDef[] {
  const ev = tab === "evidence";
  return [
    { key: "requirement", label: "GD4 requirement", headers: ["GD4 Requirement", "Ref"], cells: (r) => [r.requirementText, r.ref], mono: [false, true] },
    ...(ev ? [{ key: "policyPromise" as const, label: "Policy promise/clause", headers: ["Policy Promise/Clause"], cells: (r: LineageExportRow) => [r.policyPromise || "—"] }] : []),
    { key: "verdict", label: ev ? "Evidence verdict" : "Policy verdict", headers: [ev ? "Evidence Verdict" : "Policy Verdict"], cells: (r) => [r.verdictLabel] },
    { key: "files", label: ev ? "Evidence file(s)" : "Policy file(s)", headers: [ev ? "Evidence File(s)" : "Policy File(s)"], cells: (r) => [r.fileNames.join("; ") || "—"] },
    { key: "clauseOrPassage", label: ev ? "Supporting passage" : "Policy clause", headers: [ev ? "Supporting Passage" : "Policy Clause"], cells: (r) => [r.clauseOrPassage || "—"] },
    {
      key: "rationale",
      label: ev ? "Rationale (+ suggested action)" : "Rationale",
      headers: ["Rationale", ...(ev ? ["Suggested Action"] : [])],
      cells: (r) => [r.rationale || "—", ...(ev ? [r.suggestedAction || "—"] : [])],
    },
  ];
}

// The tab's columns filtered to a picker selection, still in matrix order
// (the selection can never reorder). No selection — or a selection that
// matches nothing — means every column: the picker UI blocks a zero-column
// export, so an empty list reaching here is a caller bug best handled by
// exporting everything rather than an empty file.
function selectedColumns(tab: LineageExportMeta["tab"], selected?: LineageColumnKey[]): LineageColumnDef[] {
  const all = lineageColumnsFor(tab);
  const chosen = selected ? all.filter((c) => selected.includes(c.key)) : all;
  return chosen.length > 0 ? chosen : all;
}

// CSV convention for clause-by-clause detail (no pre-existing nested-CSV
// pattern in this codebase to follow — auditCsvExport.ts's other exports are
// all flat, so this is a NEW decision, reported here rather than silently
// invented): flatten each sub-part into ITS OWN row, reusing the EXACT SAME
// columns as the parent line — no new columns at all. A sub-part row is
// distinguished by its Requirement cell being prefixed "↳ " (a standard
// flattened-hierarchy marker) and its Ref repeating the parent's, so
// spreadsheet grouping/filtering by ref still finds every sub-part under its
// line. Column reuse: Verdict becomes "Found"/"Not found"/"Contradicted"
// (still a coverage-style status, just at sub-part grain); File(s) becomes
// the ONE file this sub-part was specifically attributed to; clauseOrPassage
// becomes column 2's content on the PPD tab (§ clause + quote) or the sub-
// part's OWN located passage on the evidence tab (col2 there is Policy
// Promise/Clause, which repeats the row's ppdExtract instead); Rationale
// becomes the sub-part's own remarks. Column SELECTION still applies (the
// same `cols` list drives both the parent and every sub-part row), so
// deselecting e.g. "files" hides it from sub-part rows too.
function clauseDetailAsExportRow(parent: LineageExportRow, tab: LineageExportMeta["tab"], item: LineageClauseDetailItem): LineageExportRow {
  const ev = tab === "evidence";
  return {
    ref: parent.ref,
    requirementText: `↳ ${item.name}`,
    verdictLabel: item.found ? "Found" : item.contradicted ? "Contradicted" : "Not found",
    fileNames: item.fileName ? [item.fileName] : [],
    clauseOrPassage: ev ? (item.passage || "—") : item.col2,
    rationale: item.remarks || "—",
    policyPromise: ev ? item.col2 : undefined,
    suggestedAction: undefined,
    barColor: item.found ? "#16a34a" : "#cbd5e1",
  };
}

// Pure builder — exported for unit testing (column order/content, full
// untruncated multi-file "; " join, CSV escaping via the shared csvCell/toCsv
// utility rather than a second serializer) without needing to trigger a
// browser download. Genuinely-empty cells show "—", matching the on-screen
// matrix's own convention (and buildLineagePdfHtml below) rather than a bare
// empty CSV cell an external auditor could misread as a data glitch.
// `selected` (optional) trims to the picker's chosen columns; content within
// a selected column is never truncated — selection controls WHICH columns,
// never how much of one. `includeClauseDetail` (default true — the picker
// opens with it checked) appends a flattened sub-part row per item directly
// after its parent line; false omits every sub-part row entirely.
export function buildLineageCsv(meta: LineageExportMeta, rows: LineageExportRow[], selected?: LineageColumnKey[], includeClauseDetail = true): string {
  const cols = selectedColumns(meta.tab, selected);
  const csvRows: string[][] = [];
  for (const r of rows) {
    csvRows.push(cols.flatMap((c) => c.cells(r)));
    if (includeClauseDetail) for (const item of r.clauseDetail ?? []) csvRows.push(cols.flatMap((c) => c.cells(clauseDetailAsExportRow(r, meta.tab, item))));
  }
  const csv = toCsv(cols.flatMap((c) => c.headers), csvRows);
  // Sampling basis as a trailing note row — the export travels without the
  // app, so the caveat must travel with it. Always quoted for CSV safety.
  return meta.caveat ? `${csv}\r\n"Sampling basis: ${meta.caveat.replace(/"/g, '""')}"` : csv;
}

export function downloadLineageCsv(meta: LineageExportMeta, rows: LineageExportRow[], selected?: LineageColumnKey[], includeClauseDetail = true): void {
  downloadCsv(buildLineageCsv(meta, rows, selected, includeClauseDetail), `${filenameBase(meta)}.csv`);
}

// Escapes text for safe interpolation into the generated HTML document —
// separate from CSV escaping (csvCell), since this is a different sink.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The clause-by-clause detail, rendered beneath its parent <tr> as a REAL
// nested 4-column table — matching the in-app ClauseMatrix structure, not
// the old spine-prose format the earlier export limitation referred to
// ("expand rows in-app for detail"). One row per sub-part; PPD/evidence
// column-2 header follows the same tab-aware wording ClauseMatrix uses.
function clauseDetailTableHtml(tab: LineageExportMeta["tab"], items: LineageClauseDetailItem[], colSpan: number): string {
  const ev = tab === "evidence";
  const headers = ev
    ? ["Clause requirement", "PPD clause / extract", "File and Supporting passage", "Remarks"]
    : ["Clause requirement", "Policy clause & quote", "File", "Rationale"];
  const rowsHtml = items.map((it) => {
    const status = it.found ? "Found" : it.contradicted ? "Contradicted" : "Not found";
    const col3Parts = [it.fileName ? `from ${it.fileName}` : status];
    if (it.fileName) col3Parts.push(status);
    if (ev && it.passage) col3Parts.push(`"${it.passage}"`);
    const col3 = col3Parts.join(" — ");
    return `<tr style="border-left:3px solid ${it.found ? "#16a34a" : "#cbd5e1"};">
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.col2 || "—")}</td>
        <td>${escapeHtml(col3 || "—")}</td>
        <td>${escapeHtml(it.remarks || "—")}</td>
      </tr>`;
  }).join("");
  return `
    <tr class="detail-row"><td colspan="${colSpan}">
      <div class="detail-label">Clause by clause</div>
      <table class="detail-table">
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </td></tr>`;
}

// Exported for unit testing (asserts real <table> markup, full untruncated
// text, and the colour-preservation directive) without needing to actually
// open a browser window. Same optional `selected` column trimming as
// buildLineageCsv — one registry, one selection semantics for both formats.
// `includeClauseDetail` (default true) nests each line's clause-by-clause
// table beneath its row — see clauseDetailTableHtml.
export function buildLineagePdfHtml(meta: LineageExportMeta, rows: LineageExportRow[], selected?: LineageColumnKey[], includeClauseDetail = true): string {
  const cols = selectedColumns(meta.tab, selected);
  const headers = cols.flatMap((c) => c.headers);
  const monoFlags = cols.flatMap((c) => c.mono ?? c.headers.map(() => false));
  const title = `${filenameBase(meta)}`;
  const rowsHtml = rows.map((r) => {
    const mainRow = `
    <tr style="border-left:4px solid ${escapeHtml(r.barColor)};">
      ${cols.flatMap((c) => c.cells(r)).map((cell, i) => `<td${monoFlags[i] ? ' class="mono"' : ""}>${escapeHtml(cell)}</td>`).join("\n      ")}
    </tr>`;
    const detail = includeClauseDetail && r.clauseDetail?.length ? clauseDetailTableHtml(meta.tab, r.clauseDetail, headers.length) : "";
    return mainRow + detail;
  }).join("");
  // Earlier export task's limitation ("PDF export is the flat matrix only,
  // expand rows in-app for detail") no longer holds — say so honestly either
  // way, since the caption is what a reader sees once the app isn't open.
  const detailCaption = includeClauseDetail
    ? "Clause-by-clause detail for covered/partial lines is included beneath each line below."
    : "Clause-by-clause detail was excluded from this export (unchecked in the column picker) — expand rows in-app to see it, or re-export with detail included.";

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
  tr.detail-row > td { padding: 4px 8px 10px 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  .detail-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: #64748b; margin: 4px 0 3px; }
  .detail-table { width: 100%; }
  .detail-table th, .detail-table td { font-size: 10.5px; padding: 4px 6px; background: #fff; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>Requirement coverage — ${escapeHtml(meta.tab === "policy" ? "policy" : "evidence")} — ${escapeHtml(meta.runLabel)}</h1>
  <div class="meta">Run date: ${escapeHtml(formatRunAt(meta.runAt))}</div>
  <div class="meta">Overall: ${escapeHtml(meta.statusLine)}</div>
  <div class="caption">${escapeHtml(detailCaption)}</div>
  ${meta.caveat ? `<div class="caption" style="color:#92400e;">Sampling basis: ${escapeHtml(meta.caveat)}</div>` : ""}
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
export function openLineagePdf(meta: LineageExportMeta, rows: LineageExportRow[], selected?: LineageColumnKey[], includeClauseDetail = true): void {
  const html = buildLineagePdfHtml(meta, rows, selected, includeClauseDetail);
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
