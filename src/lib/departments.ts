// Which UCC department owns which GD4 scope, and the division each department
// sits under.
//
// Ownership comes from POLICY_DOCUMENTS (UCC's master Policy and Procedure
// register) and is never inferred. Both were missing, and their absence was
// not cosmetic. `seedFolders()` gave
// every one of the 30 scopes the owner "SQ", and `independenceNotice()`
// compares that owner against the acting auditor's department. So the
// independence check has never once been right: an SQ auditor was warned on
// all 30 scopes including the 24 they are independent of, and every other
// auditor was warned on none, including the areas they actually own.
//
// Ownership is read off the real document codes in POLICY_DOCUMENTS. It is NOT
// derived from the GD4 text, and must not be "improved" by reasoning about
// what a scope sounds like it belongs to.

import { POLICY_DOCUMENTS, type PolicyDocument } from "../data/policyDocuments";

// Department acronym -> the division above it. A department absent from this
// map has no division: it IS the top-level unit and shows as itself.
//
// GEP and IG own no GD4 scope, which the document register confirms: 5.3 is
// covered by PPD-ALI-CD-5.3.1, so Partnerships belongs to Curriculum
// Development. GEP is division-less here because UCC writes it alone.
export const DEPARTMENT_DIVISION: Record<string, string> = {
  CM: "ALI", CD: "ALI",
  IG: "GEP",
  AN: "OEE", FN: "OEE", HR: "OEE", IT: "OEE",
  MG: "SES", SL: "SES",
  CG: "SGL", SQ: "SGL",
  AD: "SSO", SS: "SSO",
};

// ── Ownership, read off the real document codes ──────────────────────────
//
// A code is PPD-<division>-<unit>-<reference>. For a GD4 document the unit is
// the owning department (PPD-SSO-AD-4.1.1 -> AD). For the management-system
// series the unit is the series itself (PPD-IT-ISMS-2.3.1a -> ISMS, owned by
// IT), which is why only SCOPED documents are ever asked who owns them.
export function codeParts(code: string): { division: string; unit: string } | null {
  const m = /^PPD-([A-Za-z]+)-([A-Za-z]+)-/.exec((code ?? "").trim());
  return m ? { division: m[1], unit: m[2] } : null;
}

// Every document covering a scope, the primary one first. A scope normally has
// one; 1.1 has two (Leadership and Corporate Governance, plus Financial
// Management) and the audit lead names the first as the owner.
export function documentsForScope(scopeId: string): PolicyDocument[] {
  return POLICY_DOCUMENTS
    .filter((d) => d.scopeId === scopeId)
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

export function primaryDocumentForScope(scopeId: string): PolicyDocument | undefined {
  return documentsForScope(scopeId)[0];
}

// The owner given to a scope no document covers — a new sub-criterion from a
// future GD4 revision. Blank rather than a guess: "(unassigned)" is visible
// and gets fixed, whereas a plausible wrong department is not.
export const UNMAPPED_SCOPE_OWNER = "";

// The department acronym that owns a scope, taken from its primary document's
// code. Nothing here reasons about what the GD4 text sounds like it belongs
// to: an earlier version of this file did, and was wrong on seven of thirty.
export function departmentForScope(scopeId: string): string {
  const doc = primaryDocumentForScope(scopeId);
  return (doc && codeParts(doc.code)?.unit) || UNMAPPED_SCOPE_OWNER;
}

// "CG" -> "SGL-CG"; "GEP" -> "GEP". Used for display only.
//
// Deliberately NOT a PPD reference, and no code is ever composed from it.
// PPD-OE-FN-1.1.1 spells the division "OE" where every other Operational
// Excellence code says "OEE", so a generated code would match UCC's filing
// only some of the time while looking authoritative. Real codes come from
// POLICY_DOCUMENTS and nowhere else.
export function departmentPair(
  acronym: string | undefined,
  divisionOf: (acronym: string) => string | undefined = (a) => DEPARTMENT_DIVISION[a],
): string {
  const a = (acronym ?? "").trim();
  if (!a) return "";
  const div = divisionOf(a);
  return div && div !== a ? `${div}-${a}` : a;
}

// One register row as the app shows it: the shipped document plus whatever
// version and date the team has entered. Kept here so the setup page, the
// Evidence Folder card and the exports all read one assembly and cannot start
// disagreeing about what version a document is on.
export type PolicyDocumentView = PolicyDocument & { version: string; updatedAt: string; edited: boolean };

export function policyDocumentViews(
  edits: Record<string, { version?: string; updatedAt?: string }> | undefined,
  docs: PolicyDocument[] = POLICY_DOCUMENTS,
): PolicyDocumentView[] {
  return docs.map((d) => {
    const e = edits?.[d.code];
    return { ...d, version: e?.version ?? "", updatedAt: e?.updatedAt ?? "", edited: !!(e?.version || e?.updatedAt) };
  });
}

export function scopeDocumentViews(
  scopeId: string,
  edits: Record<string, { version?: string; updatedAt?: string }> | undefined,
): PolicyDocumentView[] {
  return policyDocumentViews(edits, documentsForScope(scopeId));
}

// "V2 · 14 Mar 2026", or just whichever half is filled, or "" when neither is.
// Never invents a version: an unentered document reads as unrecorded, not as
// version 1.
export function documentStamp(d: { version: string; updatedAt: string }): string {
  const date = d.updatedAt ? shortDate(d.updatedAt) : "";
  return [d.version, date].filter(Boolean).join(" · ");
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
