// Third export from the Audit Checklist Library: the AI's own verdict per check.
//
// The three are deliberately different in kind and none replaces another:
//   Export CSV         — the round-trippable EDIT format for the checks themselves
//                        (carries item_id + status, imports straight back).
//   Manual worksheet   — a BLANK walkthrough form for a human to fill in by hand.
//   Verdicts (this)    — what the AI already concluded, read straight out of
//                        useChecklistVerdictStore. No AI call, nothing generated.
//
// Column building, ref/criterion/sub-criterion derivation and the CSV assembly
// are reused from manualWorksheet.ts rather than re-derived, so a check prints
// the same Ref in both files.

import { toCsv } from "./auditCsvExport";
import { fnv1a, type DomainChecklistRow } from "./domainChecklist";
import { worksheetRef, worksheetCriterion, worksheetSubCriterion } from "./manualWorksheet";
import type { StoredChecklistVerdict } from "../store/useChecklistVerdictStore";

export const VERDICT_EXPORT_HEADERS = [
  "Ref", "Criterion", "Sub-criterion", "Check text", "Assessed under",
  "Bucket", "Verdict", "Rationale", "Quote", "Audit path", "Run ID",
  "Assessed on", "Check changed since",
];

// The state a check with no stored verdict prints. It is never a judgement
// about the check: every one of the 155 checks is reachable by auditing a
// sub-criterion it applies to (asserted in the tests), so this only ever means
// "no audit has covered this area yet".
export const NOT_YET_ASSESSED = "Not yet assessed";

export type ChecklistVerdictExportRow = {
  ref: string;
  criterion: string;
  subCriterion: string;
  checkText: string;
  assessedUnder: string;
  bucket: string;
  verdict: string;
  rationale: string;
  quote: string;
  path: string;
  runId: string;
  assessedOn: string;
  stale: string;
};

// The stored rationale is the run note, which carries the "#N [chunk]:" citation
// prefix on its own line (renderWindowNotes builds it that way, and the browser
// collapses it on screen). Collapsing it here keeps one CSV row on one line and
// makes the cell read exactly as the page shows it.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const BUCKET_LABEL: Record<StoredChecklistVerdict["bucket"], string> = {
  policy: "Policy",
  evidence: "Evidence",
};

// "2026-09-14 08:25" — sortable as text in a spreadsheet, unlike a locale
// string, and keeps the time so two runs on one day stay distinguishable.
function assessedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : iso.slice(0, 16).replace("T", " ");
}

// One row per stored verdict, which is one per (sub-criterion audited × bucket)
// — exactly the rows the Library page shows under each check. The two buckets
// are NEVER merged into a single verdict: a check the policy documents but no
// record evidences is the documented-but-not-implemented split the app already
// models per GD4 line, and re-deriving it here would be a second copy of that
// rule.
//
// A check with no verdict still gets its row, marked NOT_YET_ASSESSED. Dropping
// it would hand over a file quietly short of the scope it claims to cover —
// the same reasoning as assembleWorksheetRows' keepEmpty, and here the empty
// rows are the actionable part: they name the areas nobody has audited.
export function assembleVerdictRows(
  rows: DomainChecklistRow[],
  verdicts: StoredChecklistVerdict[],
): ChecklistVerdictExportRow[] {
  const byCheck = new Map<string, StoredChecklistVerdict[]>();
  for (const v of verdicts) {
    const list = byCheck.get(v.checkId) ?? [];
    list.push(v);
    byCheck.set(v.checkId, list);
  }

  const out: ChecklistVerdictExportRow[] = [];
  for (const r of rows) {
    const base = {
      ref: worksheetRef(r),
      criterion: worksheetCriterion(r.criterionId),
      subCriterion: worksheetSubCriterion(r),
      checkText: r.text,
    };
    const mine = (byCheck.get(r.id) ?? []).slice().sort((a, b) =>
      a.subCriterionId === b.subCriterionId ? a.bucket.localeCompare(b.bucket) : a.subCriterionId.localeCompare(b.subCriterionId)
    );
    if (mine.length === 0) {
      out.push({ ...base, assessedUnder: "", bucket: "", verdict: NOT_YET_ASSESSED, rationale: "", quote: "", path: "", runId: "", assessedOn: "", stale: "" });
      continue;
    }
    const currentHash = fnv1a(r.text);
    for (const v of mine) {
      out.push({
        ...base,
        // Which audit produced this verdict. Load-bearing for a criterion-wide
        // check: it is assessed once per sub-criterion audited, so without this
        // column two rows would differ only in their verdict, with nothing
        // saying why.
        assessedUnder: v.subCriterionId,
        bucket: BUCKET_LABEL[v.bucket],
        verdict: v.verdict,
        rationale: oneLine(v.rationale),
        quote: oneLine(v.quote ?? ""),
        path: `Option ${v.path}`,
        runId: v.runId ?? "",
        assessedOn: assessedOn(v.runAt),
        // The page shows a "Stale — check reworded since" pill for these. A CSV
        // that dropped the marker would contradict the screen.
        stale: v.sourceHash === currentHash ? "" : "Yes",
      });
    }
  }
  return out;
}

export function buildChecklistVerdictCsv(rows: ChecklistVerdictExportRow[]): string {
  return toCsv(
    VERDICT_EXPORT_HEADERS,
    rows.map((r) => [
      r.ref, r.criterion, r.subCriterion, r.checkText, r.assessedUnder,
      r.bucket, r.verdict, r.rationale, r.quote, r.path, r.runId,
      r.assessedOn, r.stale,
    ]),
  );
}
