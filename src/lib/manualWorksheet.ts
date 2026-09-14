// Manual audit worksheet — the second, one-way export from the Audit Checklist
// Library.
//
// The Library's own "Export CSV" is a round-trippable EDIT format for the AI's
// instructions: its rows carry item_id and status and import straight back.
// This one is different in kind and deliberately NOT importable. It converts
// the same checks, which are written at the AI ("Audited financials, not
// management accounts. GD4 1.1 expects…"), into questions an auditor asks a
// person in a live walkthrough, plus blank columns to write the answers in.
// Nothing here feeds back into a prompt or a verdict.
//
// The Describe/Show-me wording is produced by an AI pass at export time
// (lib/ai/worksheetWriter.ts) because the source checks are prose arguments,
// not structured data — see that file's header for why a deterministic
// transform was rejected. Everything in THIS file is deterministic: the
// columns, the Type classification and the CSV assembly, so the parts that can
// be tested without an AI call are tested.

import { toCsv } from "./auditCsvExport";
import { GD4_CRITERIA } from "../data/gd4Requirements";
import type { DomainChecklistRow } from "./domainChecklist";

export const WORKSHEET_HEADERS = [
  "Ref", "Criterion", "Type", "Describe", "Show me", "Response", "Evidence seen", "Verdict", "Follow-up",
];

// Printed into every Verdict cell rather than left blank, so the options are
// legible on paper where a spreadsheet dropdown would not survive.
export const VERDICT_OPTIONS = "Met / Partial / Not met / N/A";

export type WorksheetType = "Core" | "Red flag" | "Zero-tolerance";

// One walkthrough question. A check can yield several, and either half may be
// empty when the check genuinely has only one — a documentary check has no
// Describe, a purely procedural one has no Show me.
export type WorksheetAsk = { describe: string; showMe: string };

export type WorksheetRow = {
  sourceId: string;
  ref: string;
  criterion: string;
  type: WorksheetType;
  describe: string;
  showMe: string;
};

// Regulatory-severity cues, taken from the wording the shipped checks actually
// use (measured across all 155, not guessed): these mark a gap the checks
// themselves call a Non-Conformity or a statutory/regulatory breach rather
// than an improvement point.
// Deliberately NOT matching a bare "non-conformity" or "no softening": both
// fire on checks that merely DISCUSS non-conformities (6.1's "NCs raised with
// corrective actions tracked to closure", C6's "trend analysis of
// non-conformities") or that are just telling the AI to stay strict. Those are
// ordinary checks. What marks a real zero-tolerance row is the check calling
// the gap itself regulatory.
const ZERO_TOLERANCE_TEXT = /\b(zero[- ]tolerance|serious (regulatory )?finding|regulatory finding|material finding|statutory|not an AFI)\b/i;
const ZERO_TOLERANCE_SECTION = /zero[- ]tolerance/i;

// Type is derived, never authored, so it stays correct as Felix edits checks.
// Precedence is deliberate and worth knowing: the "Red flags" SECTION wins
// first, so a red flag stays a red flag even when its wording is regulatory.
// Flip these two branches if severity should outrank the section.
export function worksheetType(row: Pick<DomainChecklistRow, "sectionKind" | "sectionKey" | "text">): WorksheetType {
  if (row.sectionKind === "red-flags") return "Red flag";
  if (ZERO_TOLERANCE_SECTION.test(row.sectionKey) || ZERO_TOLERANCE_TEXT.test(row.text)) return "Zero-tolerance";
  return "Core";
}

// 43% of checks carry no requirement reference at all — they are written at a
// whole criterion. Those get an explicit criterion-level tag rather than an
// empty cell, so a sorted sheet never has a blank Ref column to puzzle over.
//
// The refs are printed exactly as the check carries them. Do NOT route them
// through subCriterionOfRef(): that maps an item id to its PARENT, so a check
// tagged 4.1.1 would print as 4.1 and the auditor would lose the precision
// that tells them which requirement they are standing in front of.
export function worksheetRef(row: Pick<DomainChecklistRow, "criterionId" | "subCriterionIds">): string {
  const refs = [...new Set(row.subCriterionIds)].sort();
  return refs.length > 0 ? refs.join(", ") : `C${row.criterionId} (all)`;
}

const CRITERION_TITLE = new Map(GD4_CRITERIA.map((c) => [c.id, c.title]));

export function worksheetCriterion(criterionId: string): string {
  return `C${criterionId} ${CRITERION_TITLE.get(criterionId) ?? ""}`.trim();
}

// Joins each check's stored asks onto it.
//
// `keepEmpty` is what the worksheet export passes. Questions are generated
// ahead of time now, so a check can legitimately have none yet, and dropping
// those rows would hand a sheet that is quietly short of the scope it claims
// to cover. With keepEmpty the check still gets its row, with the Describe and
// Show me cells blank, and the caller reports the count. Without it (the
// default) an ask with nothing in either half is dropped, which is still right
// when the model simply returned nothing usable for a check.
export function assembleWorksheetRows(
  rows: DomainChecklistRow[],
  asksById: Map<string, WorksheetAsk[]>,
  opts: { keepEmpty?: boolean } = {},
): WorksheetRow[] {
  const out: WorksheetRow[] = [];
  for (const r of rows) {
    const asks = asksById.get(r.id) ?? (opts.keepEmpty ? [{ describe: "", showMe: "" }] : []);
    for (const ask of asks) {
      const describe = ask.describe.trim();
      const showMe = ask.showMe.trim();
      if (!describe && !showMe && !opts.keepEmpty) continue;
      out.push({
        sourceId: r.id,
        ref: worksheetRef(r),
        criterion: worksheetCriterion(r.criterionId),
        type: worksheetType(r),
        describe,
        showMe,
      });
    }
  }
  return out;
}

export function buildWorksheetCsv(rows: WorksheetRow[]): string {
  return toCsv(
    WORKSHEET_HEADERS,
    rows.map((r) => [r.ref, r.criterion, r.type, r.describe, r.showMe, "", "", VERDICT_OPTIONS, ""]),
  );
}
