import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { itemIdsForScope, scopeTitle } from "./evidenceScope";
import { toCsv, downloadCsv } from "./auditCsvExport";
import { printHtmlInNewTab, PRINTABLE_DOC_CSS, escapeHtml } from "./printableDoc";
import type { FlatAuditPoint } from "../types";

// PRE-AUDIT reference view: the official EduTrust GD4 requirement text for a
// sub-criterion, straight from the static GD4_REQUIREMENTS data. Deliberately
// carries NO verdict, status or evidence field of any kind — nothing has been
// read at this point, so anything resembling found/not-found would be a claim
// about an audit that has not happened. Its only inputs are the scope id and
// the shipped requirement data: no run, no Drive folder, no uploaded file, no
// AI call. That is what lets it render on a sub-criterion nobody has touched.

// Official section a line comes from, in the Guidance Document's own terms.
// "Expected evidence" here is the GD4 document's published list of documents a
// PEI is expected to hold — a preparation prompt, NOT a check of anything the
// school has actually provided.
const SECTION_LABEL: Record<FlatAuditPoint["sourceType"], string> = {
  describeShow: "Describe and Show",
  expectedEvidence: "Expected evidence (official list)",
  note: "Note",
};

export type RequirementRefRow = {
  itemId: string;        // e.g. "6.2.1"
  itemTitle: string;     // e.g. "Management Review"
  ref: string;           // e.g. "6.2.1.DS1" or "6.2.1.DS1.a"
  section: string;       // SECTION_LABEL value
  text: string;          // the official wording, verbatim
  isChild: boolean;      // a lettered sub-item under a parent bullet
};

// A lettered child's ref is its parent's plus a letter segment ("2.1.1.DS1.a"
// → "2.1.1.DS1"). The parent bullet is not itself a flatAuditPoint when it
// splits, so it is reconstructed here from the children's shared parentText —
// otherwise the exported list would show the sub-items with no sight of the
// sentence they hang off, which is not how the official document reads.
function parentRefOf(ref: string): string {
  return ref.replace(/\.[a-z]$/, "");
}

export function buildRequirementRows(scopeId: string): RequirementRefRow[] {
  const rows: RequirementRefRow[] = [];
  for (const itemId of itemIdsForScope(scopeId)) {
    const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
    if (!req) continue;
    const itemTitle = req.requirement;
    let lastParentRef: string | null = null;
    for (const p of req.flatAuditPoints ?? []) {
      if (p.parentText) {
        const pref = parentRefOf(p.ref);
        // Emit the parent bullet once, immediately before its first child.
        if (pref !== lastParentRef) {
          rows.push({ itemId, itemTitle, ref: pref, section: SECTION_LABEL[p.sourceType], text: p.parentText, isChild: false });
          lastParentRef = pref;
        }
        rows.push({ itemId, itemTitle, ref: p.ref, section: SECTION_LABEL[p.sourceType], text: p.text, isChild: true });
        continue;
      }
      lastParentRef = null;
      rows.push({ itemId, itemTitle, ref: p.ref, section: SECTION_LABEL[p.sourceType], text: p.text, isChild: false });
    }
  }
  return rows;
}

const HEADERS = ["Item", "Ref", "Section", "Official Requirement Text"];
const PRE_AUDIT_NOTE =
  "Official EduTrust GD4 requirement text only. Nothing here has been checked against any document: this is the published requirement wording, for preparation before an audit runs.";

function rowCells(r: RequirementRefRow): string[] {
  return [`${r.itemId} ${r.itemTitle}`, r.ref, r.section, r.text];
}

export function buildRequirementsCsv(scopeId: string): string {
  const csv = toCsv(HEADERS, buildRequirementRows(scopeId).map(rowCells));
  // The note travels with the file: an exported list read away from the app
  // must not be mistaken for an assessment. Always quoted for CSV safety.
  return `${csv}\r\n"${PRE_AUDIT_NOTE.replace(/"/g, '""')}"`;
}

function filenameBase(scopeId: string): string {
  return `GD4-${scopeId}-official-requirements`.replace(/[^a-zA-Z0-9.-]+/g, "-");
}

export function buildRequirementsPdfHtml(scopeId: string): string {
  const rows = buildRequirementRows(scopeId);
  const title = `${scopeId} ${scopeTitle(scopeId)}`;
  const body = rows.map((r) => `
    <tr>
      <td class="mono">${escapeHtml(r.ref)}</td>
      <td>${escapeHtml(r.section)}</td>
      <td${r.isChild ? ' style="padding-left:26px;"' : ""}>${escapeHtml(r.text)}</td>
    </tr>`).join("");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(filenameBase(scopeId))}</title>
<style>${PRINTABLE_DOC_CSS}</style>
</head>
<body>
  <h1>Official requirements — ${escapeHtml(title)}</h1>
  <div class="meta">Source: EduTrust Guidance Document v4 requirement text, as shipped with this tool.</div>
  <div class="caption">${escapeHtml(PRE_AUDIT_NOTE)}</div>
  <table>
    <thead><tr><th>Ref</th><th>Section</th><th>Official Requirement Text</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export function downloadRequirementsCsv(scopeId: string): void {
  downloadCsv(buildRequirementsCsv(scopeId), `${filenameBase(scopeId)}.csv`);
}

// Returns false when the browser blocked the new tab — see openLineagePdf.
export function openRequirementsPdf(scopeId: string): boolean {
  return printHtmlInNewTab(buildRequirementsPdfHtml(scopeId), filenameBase(scopeId));
}
