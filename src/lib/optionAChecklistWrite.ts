// Maps Option A (PPD + Evidence path) assessment rows onto Sub-Criterion
// Checklist line writes — the SAME shape Option B's staged audit writes
// (line status + one audit evidence item carrying sufficiency/APSR/notes),
// so Option A results persist with the checklist and feed buildScored /
// computeBand identically. Pure and store-free so it is unit-testable
// (the stores transitively load pdfjs and cannot be imported under Vitest).

import type { ApsrBreakdown, ChecklistLineWrite, EvidenceAssessmentRow, PPDReviewRow, SpecificChecklistLine } from "../types";
import { normalizeAuditRef } from "./gd4Refs";
import { ppdVerdictLabel, evVerdictLabel } from "./verdictTone";

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
      note: ppdRow?.shortComment || `PPD verdict: ${ppdVerdictLabel(row.ppdVerdict)}.`,
      sourceChunkIds: ppdRow?.chunkIds ?? [],
    },
    processes: {
      status: row.verdict === "Met" ? "Deployed" : row.verdict === "Partial" ? "Weak" : "Not evident",
      note: row.evidenceSummary || row.comment || `Combined evidence verdict: ${evVerdictLabel(row.verdict)}.`,
      sourceChunkIds: row.evidenceChunkIds ?? [],
    },
    systemsOutcomes: { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
    review: { status: "Not evident", note: notAssessedNote, sourceChunkIds: [] },
  };
}

// Frozen-at-raise source trace appended to a finding's observation when the
// Option A compile raises it. A finding is a standalone register record — it
// must carry its own citations (file names, chunk ids, verbatim quotes), the
// same way the PPD-contradiction findings embed quoteA/quoteB + chunkA/chunkB.
// This is NOT the retired auditorNote blob: that duplicated live checklist-tab
// data on the evidence item; a register finding has no live tabs to defer to.
// Honesty rule: only verified quotes are embedded (promiseChecks[].quote and
// PPDReviewRow.supportQuote exist only after verbatim verification against the
// source), so the trace can never fabricate a citation.
export function buildOptionASourceTrace(
  row: EvidenceAssessmentRow,
  ppdRow: PPDReviewRow | undefined,
  resolveChunkFile?: (chunkId: string) => string | undefined,
  runId?: string
): string {
  const label = (cid: string) => {
    const file = resolveChunkFile?.(cid);
    return file ? `${file} · ${cid}` : cid;
  };
  const lines: string[] = [];
  const files = (row.evidenceFiles ?? []).map((f) => f.name).filter(Boolean);
  if (files.length > 0) lines.push(`Evidence files: ${files.join("; ")}`);
  const cites = (row.evidenceChunkIds ?? []).map(label);
  if (cites.length > 0) lines.push(`Cited passages: ${cites.join(", ")}`);
  // The row's own verified excerpt (see EvidenceAssessmentRow.evidenceQuote) —
  // no per-chunk attribution is asserted; the cited-passages line above names
  // the chunks it can only have come from.
  if (row.evidenceQuote) lines.push(`Verified excerpt: "${row.evidenceQuote}"`);
  for (const p of row.promiseChecks ?? []) {
    if (!p.quote) continue;
    const cid = p.chunkId ?? p.chunkIds?.[0];
    lines.push(`"${p.quote}"${cid ? ` (${label(cid)})` : ""} — ${p.verdict}: ${p.promiseText}`);
  }
  if (ppdRow?.supportQuote) {
    const cid = ppdRow.chunkIds?.[0];
    lines.push(`PPD basis: "${ppdRow.supportQuote}"${cid ? ` (${label(cid)})` : ""}`);
  }
  if (lines.length === 0) {
    // Nothing citable (typical for a Not met line — the gap IS the absence of
    // evidence). Still point at the run's file ledger so the finding names
    // what was actually read, rather than tracing to nothing.
    return runId ? `Source evidence (run ${runId}): no evidence passages were cited for this line — the run's file ledger records which documents were read.` : "";
  }
  return `Source evidence${runId ? ` (run ${runId})` : ""}:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export function buildOptionALineWrites(
  rows: EvidenceAssessmentRow[],
  // gd4ItemId -> that item's existing specific checklist lines
  linesByItem: Record<string, Array<Pick<SpecificChecklistLine, "id" | "sourceRef" | "clause">>>,
  ppdRows: PPDReviewRow[],
  opts: { runId: string; folderName?: string; drive?: string; owner?: string }
): ChecklistLineWrite[] {
  const ppdByRef = new Map(ppdRows.map((r) => [normalizeAuditRef(r.ref), r]));
  const writes: ChecklistLineWrite[] = [];
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
    // Confidence gating signal (used by the "confidence" run mode): gap
    // verdicts, uncited lines, unverified quotes and contradicted promises
    // all queue for human review instead of auto-committing.
    const contradicted = (row.promiseChecks ?? []).filter((p) => p.verdict === "contradicted");
    const confidence: { lowConfidence: boolean; confidenceReason?: string } =
      status !== "Met"
        ? { lowConfidence: true, confidenceReason: `Verdict ${status} — no or weak evidence found; confirm before committing.` }
        : contradicted.length > 0
          ? { lowConfidence: true, confidenceReason: `Evidence contradicts the PPD promise: ${contradicted[0].promiseText}.` }
          : (row.evidenceChunkIds ?? []).length === 0
            ? { lowConfidence: true, confidenceReason: "No evidence chunks cited for this verdict." }
            : (row.comment ?? "").includes("unverified")
              ? { lowConfidence: true, confidenceReason: "A quoted excerpt could not be verified against the source documents." }
              : { lowConfidence: false };
    writes.push({
      ...confidence,
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
        ppdVerdict: row.ppdVerdict,
        // Tab snapshots (see SubChecklistEvidenceItem) — the run's own verdict
        // and both halves' reasoning verbatim. These structured fields are the
        // ONLY carrier now: the old auto-generated auditorNote blob ("PPD
        // verdict: X. Combined verdict: Y." + reasoning + promise list +
        // SOURCE TRACE) is deliberately no longer written — it froze at write
        // time, went stale against later runs, and duplicated everything the
        // checklist card's PPD/Evidence tabs already show live. auditorNote
        // stays reserved for HUMAN-typed notes (and the hybrid-gate override
        // append); notes on old stored items render behind an "archived"
        // toggle, never as current data.
        evidenceVerdict: status,
        ppdComment: ppdRow?.fullComment || ppdRow?.shortComment || undefined,
        evidenceComment: row.comment || row.evidenceSummary || undefined,
        suggestedAction: row.suggestedAction || undefined,
        promiseChecks: row.promiseChecks,
        apsr: optionAApsr(row, ppdRow),
        runId: opts.runId,
      },
    });
  }
  return writes;
}
