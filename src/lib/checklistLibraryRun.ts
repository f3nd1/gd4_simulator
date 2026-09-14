// Runs the Audit Checklist Library pass and files its verdicts.
//
// ONE writer path shared by BOTH audit options, so neither can drift to a
// looser rule than the other:
//   Option A — runPPDReview (policy bucket) and runEvidenceAssessment
//              (evidence bucket) in useWorkspaceStore.
//   Option B — auditFolderStaged, which runs both buckets after its three
//              staged passes.
// The AI pass itself (runChecklistLibraryAudit) is likewise a single function;
// this module only chooses which checks are in scope, and maps the returned
// rows onto stored verdicts.

import { PARSED_DOMAIN_FILES } from "../data/skills/domainExpertise";
import { currentDomainOverrides } from "../store/useDomainChecklistStore";
import { domainRowsFor, checksInScopeForSub, subCriterionOfRef, fnv1a, SECTION_KIND_LABEL, type DomainChecklistRow } from "./domainChecklist";
import { runChecklistLibraryAudit, type ChecklistAuditBucket, type ChecklistAuditInput, type ChecklistAuditRow } from "./ai/agentRuntime";
import { useChecklistVerdictStore, type StoredChecklistVerdict } from "../store/useChecklistVerdictStore";
import type { AISettings } from "../types";
import type { SkillCalibrationExample, SkillCalibrationMemory } from "./ai/skills";

// The checks an audit of this sub-criterion actually assesses, in prompt order,
// with the CURRENT text (built-in, edited or approved custom) — the same text
// composeDomainMarkdown puts in the prompt, so a verdict can never be about
// wording the model was not shown.
export function checklistRowsForScope(subCriterionId: string): DomainChecklistRow[] {
  const criterionId = subCriterionId.split(".")[0];
  const parsed = PARSED_DOMAIN_FILES[criterionId];
  if (!parsed) return [];
  // Run scopes are not always sub-criterion ids: the 4.2 split runs as "4.2.1"
  // and "4.2.2", which are ITEM ids and match no checklist tag. Resolve to the
  // parent sub-criterion for SELECTION only — the verdict is still stored under
  // the scope that was actually run, so the two halves of 4.2 stay separate.
  const subId = subCriterionOfRef(subCriterionId);
  return checksInScopeForSub(domainRowsFor(parsed, currentDomainOverrides()), subId);
}

export function toAuditInputs(rows: DomainChecklistRow[]): ChecklistAuditInput[] {
  return rows.map((r) => ({ ref: r.id, text: r.text, kind: SECTION_KIND_LABEL[r.sectionKind] }));
}

export type ChecklistVerdictMeta = {
  subCriterionId: string;
  bucket: ChecklistAuditBucket;
  path: "A" | "B";
  runId?: string;
  runAt: string;
  model?: string;
};

// Rows -> stored verdicts. sourceHash is taken from the text that was actually
// sent, so an edit afterwards shows the verdict as stale instead of implying
// the new wording was assessed.
export function toStoredVerdicts(
  rows: ChecklistAuditRow[],
  meta: ChecklistVerdictMeta,
): StoredChecklistVerdict[] {
  return rows.map((r) => ({
    checkId: r.checkId,
    subCriterionId: meta.subCriterionId,
    bucket: meta.bucket,
    verdict: r.verdict,
    rationale: r.rationale,
    ...(r.quote ? { quote: r.quote } : {}),
    chunkIds: r.chunkIds,
    sourceHash: fnv1a(r.checkText),
    ...(meta.runId ? { runId: meta.runId } : {}),
    runAt: meta.runAt,
    path: meta.path,
    ...(meta.model ? { model: meta.model } : {}),
  }));
}

export type ChecklistPassOpts = {
  subCriterionId: string;
  docText: string;
  bucket: ChecklistAuditBucket;
  path: "A" | "B";
  settings: AISettings;
  runId?: string;
  model?: string;
  calibration?: SkillCalibrationExample[];
  memories?: SkillCalibrationMemory[];
  ruleInjection?: string;
  fileType?: "spreadsheet" | "scanned" | null;
  onProgress?: (detail: string) => void;
  shouldStop?: () => boolean;
  signal?: AbortSignal;
  resolveChunkFile?: (chunkId: string) => string | undefined;
};

export type ChecklistPassResult = { assessed: number; stored: number; skippedReason?: string };

// Never fabricates: with no documents or no checks in scope it stores nothing
// and says why, rather than filing a row full of "Not assessed" that would look
// like the pass ran. A failed or stopped pass likewise files only what the
// engine actually produced (its own rows already say "Not assessed" with the
// reason).
export async function runChecklistLibraryPass(opts: ChecklistPassOpts): Promise<ChecklistPassResult> {
  if (!opts.docText.trim()) return { assessed: 0, stored: 0, skippedReason: "no documents were read for this bucket" };
  const rows = checklistRowsForScope(opts.subCriterionId);
  if (rows.length === 0) return { assessed: 0, stored: 0, skippedReason: "no library checks are in scope for this sub-criterion" };

  const result = await runChecklistLibraryAudit(
    toAuditInputs(rows),
    opts.docText,
    opts.bucket,
    opts.settings,
    {
      criterionId: opts.subCriterionId,
      calibration: opts.calibration,
      memories: opts.memories,
      ruleInjection: opts.ruleInjection,
      fileType: opts.fileType,
      onProgress: opts.onProgress,
      shouldStop: opts.shouldStop,
      signal: opts.signal,
      resolveChunkFile: opts.resolveChunkFile,
    },
  );

  const stored = toStoredVerdicts(result.rows, {
    subCriterionId: opts.subCriterionId,
    bucket: opts.bucket,
    path: opts.path,
    runId: opts.runId,
    runAt: new Date().toISOString(),
    model: opts.model ?? result.usage?.model,
  });
  useChecklistVerdictStore.getState().putRun(stored);
  return { assessed: result.rows.length, stored: stored.length };
}
