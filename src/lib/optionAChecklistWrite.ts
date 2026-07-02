// Maps Option A (PPD + Evidence path) assessment rows onto Sub-Criterion
// Checklist line writes — the SAME shape Option B's staged audit writes
// (line status + one audit evidence item carrying sufficiency/APSR/notes),
// so Option A results persist with the checklist and feed buildScored /
// computeBand identically. Pure and store-free so it is unit-testable
// (the stores transitively load pdfjs and cannot be imported under Vitest).

import type { ApsrBreakdown, EvidenceAssessmentRow, PPDReviewRow, SpecificChecklistLine, SubChecklistEvidenceItem } from "../types";
import { normalizeAuditRef } from "./gd4Refs";

export type OptionALineWrite = {
  gd4ItemId: string;
  // Matched existing checklist line (by normalized GD4 ref) — the write
  // UPDATES this line. undefined -> no line exists yet and newLine is set.
  existingLineId?: string;
  // Line to create when the checklist has no line for this ref yet (Option A
  // can run before the checklist was ever generated).
  newLine?: Pick<SpecificChecklistLine, "text" | "clause" | "sourceRef" | "generatedBy">;
  status: "Met" | "Partial" | "Not met";
  evidence: Omit<SubChecklistEvidenceItem, "id">;
};

// APSR from what Option A actually assessed: Approach from the PPD verdict,
// Processes from the combined evidence verdict. Systems & Outcomes and
// Review are NOT assessed by this path — recorded honestly as "Not evident"
// with a note saying so, never fabricated. (The band itself is driven by
// line status + evidence sufficiency, not by these APSR fields.)
function optionAApsr(row: EvidenceAssessmentRow, ppdRow: PPDReviewRow | undefined): ApsrBreakdown {
  const notAssessedNote = "Not assessed by Option A (PPD + Evidence path) — run the staged audit or attach outcome/review evidence to assess this dimension.";
  return {
    approach: {
      status: row.ppdVerdict === "Adequate" ? "Meeting" : row.ppdVerdict === "Partial" ? "Beginning" : "Not evident",
      note: ppdRow?.shortComment || `PPD verdict: ${row.ppdVerdict}.`,
      sourceChunkIds: ppdRow?.chunkIds ?? [],
    },
    processes: {
      status: row.verdict === "Met" ? "Deployed" : row.verdict === "Partial" ? "Weak" : "Not evident",
      note: row.evidenceSummary || row.comment || `Combined evidence verdict: ${row.verdict}.`,
      sourceChunkIds: row.evidenceChunkIds ?? [],
    },
    systemsOutcomes: { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
    review: { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
  };
}

export function buildOptionALineWrites(
  rows: EvidenceAssessmentRow[],
  // gd4ItemId -> that item's existing specific checklist lines
  linesByItem: Record<string, Array<Pick<SpecificChecklistLine, "id" | "sourceRef" | "clause">>>,
  ppdRows: PPDReviewRow[],
  opts: { runId: string; folderName?: string; drive?: string; owner?: string }
): OptionALineWrite[] {
  const ppdByRef = new Map(ppdRows.map((r) => [normalizeAuditRef(r.ref), r]));
  const writes: OptionALineWrite[] = [];
  for (const row of rows) {
    // "Not assessed" rows and failed AI calls carry no verdict — never write
    // them over an existing checklist status.
    if (row.verdict === "Not assessed" || row.assessmentFailed) continue;
    const status = row.verdict;
    const normRef = normalizeAuditRef(row.gdRef);
    const existing = (linesByItem[row.gd4ItemId] ?? []).find(
      (l) => (l.sourceRef && normalizeAuditRef(l.sourceRef) === normRef) || (l.clause && normalizeAuditRef(l.clause) === normRef)
    );
    const ppdRow = ppdByRef.get(normRef);
    const promiseLines = (row.promiseChecks ?? [])
      .map((p) => `Promise ${p.verdict}: ${p.promiseText}`)
      .join("\n");
    writes.push({
      gd4ItemId: row.gd4ItemId,
      existingLineId: existing?.id,
      newLine: existing
        ? undefined
        : { text: row.requirementText, clause: row.gdRef, sourceRef: row.gdRef, generatedBy: "ai" },
      status,
      evidence: {
        title: `PPD + Evidence assessment ${opts.runId}${opts.folderName ? ` — ${opts.folderName}` : ""}`,
        type: "Record/Log",
        drive: opts.drive,
        owner: opts.owner ?? "",
        date: new Date().toISOString().slice(0, 10),
        approved: false,
        reviewed: false,
        sufficiency: status === "Met" ? "Present" : status === "Partial" ? "Weak" : "Missing",
        auditorNote: [
          `PPD verdict: ${row.ppdVerdict}. Combined verdict: ${status}.`,
          row.comment || row.evidenceSummary,
          promiseLines,
          `SOURCE TRACE\nRun: ${opts.runId} (Option A — PPD Requirements Review + Evidence assessment)`,
        ].filter(Boolean).join("\n\n"),
        apsr: optionAApsr(row, ppdRow),
        runId: opts.runId,
      },
    });
  }
  return writes;
}
