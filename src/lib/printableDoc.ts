// Opens generated HTML as a standalone printable document in a new tab and
// triggers the browser's native print dialog — the "Print / Save as PDF"
// pattern already used by the lineage export and FinalReport, extracted here
// so a third copy never appears. Zero dependencies: the browser's own
// print-to-PDF renders real HTML text (never rasterised), so the output stays
// selectable and searchable. Setting document.title makes the Save-as-PDF
// dialog default to the right filename.
export function printHtmlInNewTab(html: string, title: string): void {
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked — nothing else to fall back to client-side
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  // Give the new document a tick to finish laying out before printing.
  win.setTimeout(() => win.print(), 150);
}

// The shared print stylesheet for generated audit documents, so the lineage
// export and the official-requirements export look like one family.
export const PRINTABLE_DOC_CSS = `
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
`;

// Escapes text for safe interpolation into a generated HTML document.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
