import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage, flushPendingSaves } from "./supabaseStorage";
import type {
  AuditCycle,
  AuditorProfile,
  Department,
  AgentDefinition,
  EvidenceFolder,
  ItemEvidence,
  VersionEntry,
  WorkspaceSnapshot,
  SampleRecord,
  InterviewQuestion,
  ExportLogEntry,
  AIReviewLogEntry,
  AIReviewType,
  Confidence,
  HumanDecisionEntry,
  RunLogEntry,
  RunLogSubOutcome,
  RunLogBandResult,
  HybridDraftProgress,
  DimensionNarrative,
  CalibrationExample,
  CalibrationMemory,
  CalibrationMemoryStatus,
  Finding,
  NcSeverity,
  DriveAccessStatus,
  ApsrBreakdown,
  AuditProgressState,
  AuditFileRecord,
  AuditScope,
  AuditRunRecord,
  AuditAISummaryLine,
  ChangeLogEntry,
} from "../types";
import { seedEvidence, blankEvidence } from "../data/seedEvidence";
import { seedFolders, reconcileFolders } from "../data/folders";
import { itemIdsForScope, folderScopeId, runScopesForSub, scopeTitle } from "../lib/evidenceScope";
import { currentItemIds, currentSubIds, pruneRecordByKeys, reconcileEvidenceMap } from "../lib/structuralReconcile";
import { AGENTS } from "../data/agents";
import { buildDemoDataset } from "../data/demoDataset";
import { buildScored, aiScore, needsJustification } from "../lib/scoring";
import type { EvidenceAuditFlag } from "../lib/evidenceAudit";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { simulateItemReview, simulateClosure, simulateFolderAudit, deriveApsrStatus, type FolderAuditLineVerdict } from "../lib/ai/simulateAI";
import { runLiveItemReview, runLiveClosureReview, runLiveClosureDraft, runLiveFolderAudit, runLiveFindingObservation, FOLDER_DOC_CAP, runStagedPolicyAudit, runStagedEvidenceAudit, runStagedOutcomeReviewAudit, buildStagedApsr, simulateStagedPolicyAudit, simulateStagedEvidenceAudit, simulateStagedOutcomeReview, runPPDRequirementsReview, runEvidenceAssessment, runAuditorPanel, type PPDRequirementInput, type EvidenceAssessmentInput } from "../lib/ai/agentRuntime";
import { useAISettingsStore } from "./useAISettingsStore";
import { useScoringConfigStore } from "./useScoringConfigStore";
// Static circular import (useFindingDraftStore also imports this store) —
// same pattern as useChecklistModuleStore; safe because all cross-store
// usage happens inside actions at runtime, never at module-init time.
import { useFindingDraftStore } from "./useFindingDraftStore";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useGoogleDriveStore } from "./useGoogleDriveStore";
import { usePreCheckChecklistStore } from "./usePreCheckChecklistStore";
import { computeFlaggedPreCheckItems, type DetectFile } from "../lib/preAnalysisChecklist";
import { selectLineStatusMemories, selectLineStatusCalibration } from "../lib/labParity";
import { criteriaQuotesRequirement } from "../lib/findingCriteriaCheck";
import { diffEvidenceFiles } from "../lib/evidenceDrift";
import { parseFolderId, listFolderFilesRecursive, exportFileText, exportFileImageDataUrl, exportPdfPageImages, IMAGE_MIME_TYPES, DriveApiError, XLSX_MIME, XLS_MIME, classifyPdfTextQuality, type DriveFile, type EmbeddedImageHook } from "../lib/drive/driveClient";
import type { EvidenceChunk, FlatAuditPoint, PolicyCoverageRow, EvidenceCoverageRow, OutcomeReviewRow, OutcomeReviewPassResult, ReportAiSuggestion, PPDReviewResult, PPDReviewRow, PPDOverallVerdict, PPDContradiction, AuditMode, PanelReviewMode, PendingRun, PendingCommitItem, ChecklistLineWrite, EvidenceAssessmentResult, EvidenceAssessmentRow, EvidenceFileRef, EvidenceAssessmentProgress, PPDReviewProgress, EvidenceVerdict, SpecificLineStatus, EvidenceDriftCheck, VisionBudgetPrompt } from "../types";
import { buildOutcomeReviewLegUpdates } from "../lib/outcomeReviewApply";
import { aiRateFor } from "../lib/aiCost";
import { findingTypeForStatus, resolveFindingType, resolveNcSeverity } from "../lib/findingClassification";
import { assemblePanel, isValidPanel, shouldAutoRunPanel, findingReviewHash, MIN_PANEL, MAX_PANEL } from "../lib/reviewPanel";
import { computePanelConclusion } from "../lib/panelConclusion";
import { checkAuditorForRun, independenceNotice } from "../lib/auditorGuard";
import { checkDriveForRun, DRIVE_EXPIRED_MID_RUN, classifyFileBucket, classifyDriveReadError, analyzeFolderProbe, type DriveRunBlock, type ProbeFile, type FolderProbeResult } from "../lib/driveGuard";
import { applyCarryover, type PriorCycleArchive } from "../lib/cycleCarryover";
import { useRuleTuningStore } from "./useRuleTuningStore";
import { FINDINGS } from "../data/findings";
import { DEFAULT_SHOW_DEVELOPER_TOOLS } from "../nav";
import { ppdVerdictLabel, evVerdictLabel } from "../lib/verdictTone";

// Sequential auto-run queue for the review panel (auto modes). Findings are
// drained one at a time, and only while the store is otherwise idle, so a
// bulk finding-raise never fires dozens of concurrent AI panels.
const _panelAutoQueue: string[] = [];
let _panelAutoDraining = false;
function enqueuePanelAutoRun(findingId: string, getRunner: () => (id: string, opts?: { force?: boolean }) => Promise<void>, getBusy: () => string | null) {
  if (!_panelAutoQueue.includes(findingId)) _panelAutoQueue.push(findingId);
  if (_panelAutoDraining) return;
  _panelAutoDraining = true;
  const drain = async () => {
    while (_panelAutoQueue.length > 0) {
      // Wait out any in-flight audit/panel so we never contend on busy.
      if (getBusy()) { await new Promise((r) => setTimeout(r, 400)); continue; }
      const id = _panelAutoQueue.shift()!;
      try { await getRunner()(id); } catch { /* runner already logs; keep draining */ }
    }
    _panelAutoDraining = false;
  };
  void drain();
}
import { normalizeAuditRef, findingDedupeKey, findingKeyOf, migrateDs1Ref } from "../lib/gd4Refs";
import { buildOptionALineWrites, buildOptionASourceTrace } from "../lib/optionAChecklistWrite";
import { DEFAULT_AUDIT_MODE, partitionWritesByMode, partitionOptionAWrites, auditModeLabel, stagedWriteConfidence } from "../lib/runModes";
import { buildFullAuditPlan, fullAuditLabel, runFullAuditPlan, type FullAuditEntry, type FullAuditProgress } from "../lib/fullAudit";
import { effectiveVerdictTemp, describeImage, effectiveSettings, addUsage, aiOfflineReason, type AIUsage } from "../lib/ai/aiClient";
import { narrativeInputForEntry, suggestionKey } from "../lib/finalReport";
import { runNarrativeWriter, runConciseLineSummaries } from "../lib/ai/narrativeWriter";
import { lineApsr, findingDimension, buildDraftFinding, apsrMatrixResult } from "../lib/checklistBanding";
import { domainExpertiseLabelFor } from "../data/skills/domainExpertise";
import { apsrReason, apsrAuditNote } from "../lib/ai/simulateAI";

// Module-level ref for the currently active per-file abort. Set at the start
// of each file read; cleared when the file read completes (success, skip, or
// error). Allows cancelBusy() and skipCurrentFile() to abort the in-flight
// Drive download or AI call without waiting for the 30/45s timeout to fire.
// Only one folder audit runs at a time (the busy flag prevents concurrency),
// so a single module-level ref is sufficient.
let _currentFileAbort: (() => void) | null = null;

// Item 2b (2026-07-20): resolver for skipping the CURRENT in-flight AI
// extract call (the "thinking" step that can hang on a slow model), set by
// agentRuntime's onCallAbort around each extract chatComplete and invoked by
// skipCurrentAiCall(). Same one-run-at-a-time reasoning as _currentFileAbort.
let _currentAiCallAbort: (() => void) | null = null;

// Task 1a: resolver for the pending vision-budget blocking prompt (see
// VisionBudgetPrompt) — set while runEvidenceAssessment's read loop is
// paused waiting for "Proceed with all" / "Skip the rest", cleared once
// answered. Same one-run-at-a-time reasoning as _currentFileAbort above.
let _pendingVisionBudgetResolve: ((choice: "proceed" | "skip") => void) | null = null;

// Run-level AbortController for the active AI run (staged audit, PPD review,
// evidence assessment). cancelBusy() aborts it, which propagates through the
// audit functions into chatComplete → fetch, killing the IN-FLIGHT request
// immediately instead of letting it run to its 90s timeout (and letting the
// loop fire further paid calls in the meantime). One run at a time (busy
// flag), so a single module-level ref is sufficient.
let _currentRunAbort: AbortController | null = null;

// Persisted-prompt cap (see partialize): what is WRITTEN to storage is
// truncated; in-memory state keeps full text for the current session.
const PROMPT_PERSIST_CAP = 4_000;

// Task 2: how many PAST (non-current) Option A runs to keep per
// sub-criterion, same cap convention as useCalibrationStore's RUN_HISTORY_CAP.
const OPTION_A_RUN_HISTORY_CAP = 20;

// Run Log: how many past automated runs (Full Auto sweeps + Hybrid per-item
// drafts) to keep, newest first. Entries are lightweight summaries (no raw
// AI prompts/output — that stays in aiReviewLog), so a generous cap is cheap.
const RUN_LOG_CAP = 50;
function capPersistedText(t: string | undefined): string | undefined {
  if (!t || t.length <= PROMPT_PERSIST_CAP) return t;
  return `${t.slice(0, PROMPT_PERSIST_CAP)}\n…[truncated for storage — full text was available in the session that produced it]`;
}

// Combines a run-level abort signal with a hard timeout, without relying on
// AbortSignal.any (not available in all targets). Used to bound every Drive
// read in the Option A path — an unbounded fetch here is exactly what froze
// Full auto on one sub-criterion.
function timeoutSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException(`Timed out after ${Math.round(ms / 1000)}s`, "TimeoutError")), ms);
  const onParent = () => { clearTimeout(timer); ctrl.abort(); };
  if (parent) {
    if (parent.aborted) onParent();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  return ctrl.signal;
}
const DRIVE_LIST_TIMEOUT_MS = 30_000;   // folder listing
const DRIVE_FILE_TIMEOUT_MS = 60_000;   // single file export/extraction
// Absolute per-file ceiling, raced alongside the user's Skip in the Option A
// read loops. Needed because DRIVE_FILE_TIMEOUT_MS only reaches fetches that
// honour the AbortSignal — pdfjs parsing/rendering takes no signal, so a
// corrupt/pathological PDF could hang one file (and with it the whole run)
// indefinitely (a real 6-hour hang, 2026-07-20). 10 minutes clears the
// legitimate worst case (5 vision pages × 90s AI timeout each + 60s fetch).
const DRIVE_FILE_HARD_CAP_MS = 600_000;

// Best-effort evidence-type classification for audit-attached evidence, from
// the checklist line being satisfied (the folder audit reads many files into
// one verdict, so there's no single file type to copy). Keeps the Type column
// meaningful instead of every audited line reading "Other".
// Each sub-criterion's Drive folder is organised into two subfolders:
// "1. Policy & Procedure" and "2. Actual Evidence". Classify a scanned file
// by its top-level path segment so the audit can separate the documented
// approach (policy) from deployed evidence — a band needs both. Files not
// under a recognised policy subfolder default to evidence (preserves prior
// behaviour for folders that aren't split into subfolders yet).
// AI-drafted closure text (root cause / corrective / preventive) comes back
// as a single run-on paragraph. Break it onto one line per sentence so it
// reads as a scannable list in the Quality Action / AFI textarea instead of
// a wall of text. Only applied to what gets written into the closure record
// — the raw text is still logged verbatim to the AI Review Log.
function formatDraftedClosureText(text: string): string {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

// classifyFileBucket now lives in driveGuard.ts (shared with the pre-flight
// probe) — imported below. Re-aliased here so existing call sites are unchanged.

// Clears savedFindingId back-pointers off ONE evidence-assessment result's
// rows when the finding they point at is deleted — the shared per-item logic
// both stripFindingBackPointers (current result) and
// stripFindingBackPointersHistory (Task 2's archived past runs) apply, so a
// deleted finding can never leave a dead "View finding" link in either place.
// Returns the SAME object when nothing matched (no churn / no needless copy).
function clearFindingBackPointerRow<R extends { savedFindingId?: string }, T extends { rows: R[] }>(v: T, shouldClear: (findingId: string) => boolean): T {
  if (!v.rows?.some((r) => r.savedFindingId && shouldClear(r.savedFindingId))) return v;
  return { ...v, rows: v.rows.map((r) => (r.savedFindingId && shouldClear(r.savedFindingId) ? { ...r, savedFindingId: undefined } : r)) };
}

function stripFindingBackPointers<R extends { savedFindingId?: string }, T extends { rows: R[] }>(
  record: Record<string, T>,
  shouldClear: (findingId: string) => boolean
): Record<string, T> {
  let changed = false;
  const out = Object.fromEntries(
    Object.entries(record).map(([k, v]) => {
      const cleared = clearFindingBackPointerRow(v, shouldClear);
      if (cleared !== v) changed = true;
      return [k, cleared];
    })
  );
  return changed ? out : record;
}

// Same sweep, applied to every entry of a Task 2 history array instead of a
// single current result.
function stripFindingBackPointersHistory<R extends { savedFindingId?: string }, T extends { rows: R[] }>(
  record: Record<string, T[]>,
  shouldClear: (findingId: string) => boolean
): Record<string, T[]> {
  let changed = false;
  const out = Object.fromEntries(
    Object.entries(record).map(([k, arr]) => {
      const mapped = arr.map((v) => {
        const cleared = clearFindingBackPointerRow(v, shouldClear);
        if (cleared !== v) changed = true;
        return cleared;
      });
      return [k, mapped];
    })
  );
  return changed ? out : record;
}

// Same sweep for PPD contradiction back-pointers (they live on the result,
// not on rows).
function clearContradictionBackPointer(v: PPDReviewResult, shouldClear: (findingId: string) => boolean): PPDReviewResult {
  if (!v.contradictions?.some((c) => c.savedFindingId && shouldClear(c.savedFindingId))) return v;
  return { ...v, contradictions: v.contradictions.map((c) => (c.savedFindingId && shouldClear(c.savedFindingId) ? { ...c, savedFindingId: undefined } : c)) };
}

function stripContradictionBackPointers(
  record: Record<string, PPDReviewResult>,
  shouldClear: (findingId: string) => boolean
): Record<string, PPDReviewResult> {
  let changed = false;
  const out = Object.fromEntries(
    Object.entries(record).map(([k, v]) => {
      const cleared = clearContradictionBackPointer(v, shouldClear);
      if (cleared !== v) changed = true;
      return [k, cleared];
    })
  );
  return changed ? out : record;
}

// Same sweep, applied to every entry of ppdReviewHistory's arrays.
function stripContradictionBackPointersHistory(
  record: Record<string, PPDReviewResult[]>,
  shouldClear: (findingId: string) => boolean
): Record<string, PPDReviewResult[]> {
  let changed = false;
  const out = Object.fromEntries(
    Object.entries(record).map(([k, arr]) => {
      const mapped = arr.map((v) => {
        const cleared = clearContradictionBackPointer(v, shouldClear);
        if (cleared !== v) changed = true;
        return cleared;
      });
      return [k, mapped];
    })
  );
  return changed ? out : record;
}

// The full School Context string injected into AI calls: the typed markdown
// briefing plus whatever was last read from the linked Drive context. Returns
// "" when the user has switched injection off (cost control), so no context
// tokens are sent at all.
export function composeSchoolContext(sc: { text?: string; driveCache?: string; enabled?: boolean }): string {
  if (sc.enabled === false) return "";
  return [sc.text?.trim(), sc.driveCache?.trim()].filter(Boolean).join("\n\n");
}

// Reads a folder's text files (recursively) into one capped string, used for
// the school-wide "Additional info" context. Text-only on purpose — images
// are skipped here so the general-context folder can't quietly fan out into
// extra AI vision calls on every audit.
async function readFolderPlainText(folderId: string, token: string, maxChars = 12000): Promise<string> {
  const files = await listFolderFilesRecursive(folderId, token);
  const parts: string[] = [];
  let total = 0;
  for (const file of files) {
    if (total >= maxChars) break;
    try {
      const text = await exportFileText(file, token);
      if (text) {
        const piece = `--- ${file.path} ---\n${text}`;
        parts.push(piece);
        total += piece.length;
      }
    } catch {
      // skip unreadable files in the context folder
    }
  }
  return parts.join("\n\n").slice(0, maxChars);
}

// ── Shared read-with-vision helper (Option A) ────────────────────────────
// The full-audit (auditFolderContents) and staged (auditFolderStaged) paths
// each read a Drive file through THREE tiers: (1) typed text extraction, with
// embedded pictures in Office files transcribed via the SAME vision path; (2)
// a scanned/image-only PDF rendered to page images and read via vision; (3) a
// standalone image described via vision. Option A's two read loops (runPPDReview
// and runEvidenceAssessment) historically did tier (1) text-only, so scanned
// PDFs, photographed evidence and Office-embedded pictures produced empty text
// and were silently dropped. This helper is that exact three-tier mechanism,
// extracted ONCE so both Option A loops call it (rather than a third/fourth
// inline copy). The full-audit/staged inline versions are intentionally left
// as-is — this only gives Option A the reading capability they already have.
type VisionReadCtx = {
  canDescribeImages: boolean;
  visionSettings: ReturnType<typeof effectiveSettings>;
  visionModelId: string;
  budget: { count: number; max: number }; // mutable run-level image/page budget
  maxPerFile: number;                      // per-file cap (mirrors MAX_PDF_VISION_PAGES)
  onUsage?: (u: AIUsage) => void;
};
type VisionReadResult = {
  text: string | null;                     // null = nothing readable was produced
  readMethod: "text" | "vision";
  pdfQuality?: ReturnType<typeof classifyPdfTextQuality>;
  note?: string;                           // reason when text is null (unreadable/cap)
  // True when this file was skipped SPECIFICALLY because the run's vision
  // image budget was already exhausted (not a missing-settings/rendering
  // failure) — Task 1a's trigger for the blocking "Proceed with all / Skip
  // the rest" prompt in runEvidenceAssessment, instead of silently dropping
  // the file the way this used to (a real bug: 0 chars extracted, no signal).
  budgetBlocked?: boolean;
};
async function readDriveFileWithVision(
  file: DriveFile & { mimeType: string },
  token: string,
  signal: AbortSignal | undefined,
  ctx: VisionReadCtx
): Promise<VisionReadResult> {
  const isImage = IMAGE_MIME_TYPES.has(file.mimeType);
  let embeddedVisionUsed = false;
  const embeddedImageHook: EmbeddedImageHook | undefined = ctx.canDescribeImages
    ? async (images) => {
        const transcripts: { location: string; text: string }[] = [];
        let skippedForCapCount = 0;
        let usedThisFile = 0;
        for (const img of images) {
          if (usedThisFile >= ctx.maxPerFile || ctx.budget.count >= ctx.budget.max) { skippedForCapCount++; continue; }
          ctx.budget.count++; usedThisFile++;
          const d = await describeImage(img.dataUrl, ctx.visionSettings, { signal, onUsage: ctx.onUsage });
          if (d.trim()) { transcripts.push({ location: img.location, text: d.trim() }); embeddedVisionUsed = true; }
        }
        return { transcripts, skippedForCapCount };
      }
    : undefined;

  const readScannedPdfViaVision = async (): Promise<VisionReadResult> => {
    if (!ctx.canDescribeImages) return { text: null, readMethod: "text", note: "Scanned/image-only PDF: no text could be extracted, and no vision model is available (enable AI and add an API key in Settings)." };
    if (ctx.budget.count >= ctx.budget.max) return { text: null, readMethod: "text", note: `Scanned/image-only PDF not read: the ${ctx.budget.max}-image vision budget for this run was reached.`, budgetBlocked: true };
    const pagesToRender = Math.min(ctx.maxPerFile, ctx.budget.max - ctx.budget.count);
    const { images, totalPages } = await exportPdfPageImages(file, token, pagesToRender, signal);
    if (images.length === 0) return { text: null, readMethod: "text", note: "Scanned/image-only PDF: no text could be extracted and its pages could not be rendered for vision." };
    const parts: string[] = [];
    for (let p = 0; p < images.length; p++) {
      ctx.budget.count++;
      const d = await describeImage(images[p], ctx.visionSettings, { signal, onUsage: ctx.onUsage });
      if (d.trim()) parts.push(images.length > 1 ? `--- Page ${p + 1} ---\n${d.trim()}` : d.trim());
    }
    if (parts.length === 0) return { text: null, readMethod: "text", note: "Scanned/image-only PDF: rendered pages produced no readable text via the vision model." };
    const capNote = totalPages > images.length ? `\n\n[Vision transcription of the first ${images.length} of ${totalPages} pages — page/image budget reached; later pages were not read.]` : "";
    return { text: parts.join("\n\n") + capNote, readMethod: "vision" };
  };

  const text = await exportFileText(file, token, signal, embeddedImageHook);
  if (text !== null) {
    if (file.mimeType === "application/pdf") {
      const pdfQuality = classifyPdfTextQuality(text);
      // Vision fallback ONLY when text extraction genuinely failed (near-zero
      // chars = scanned/image-only PDF). A normal text PDF keeps the fast path.
      if (pdfQuality.extractedTextQuality === "none") return await readScannedPdfViaVision();
      return { text, readMethod: "text", pdfQuality };
    }
    // Office file whose embedded pictures were transcribed via vision counts as
    // a vision read so the cache is stamped correctly.
    return { text, readMethod: embeddedVisionUsed ? "vision" : "text" };
  }
  // No typed text at all: a standalone image → describe it via vision.
  if (isImage) {
    if (!ctx.canDescribeImages) return { text: null, readMethod: "text", note: "No vision model available to read this image (enable AI and add an API key in Settings)." };
    if (ctx.budget.count >= ctx.budget.max) return { text: null, readMethod: "text", note: `Image not read: the ${ctx.budget.max}-image vision budget for this run was reached.`, budgetBlocked: true };
    ctx.budget.count++;
    const dataUrl = await exportFileImageDataUrl(file, token, signal);
    const description = await describeImage(dataUrl, ctx.visionSettings, { signal, onUsage: ctx.onUsage });
    return { text: description.trim() || null, readMethod: "vision", note: description.trim() ? undefined : "Image produced no readable description via the vision model." };
  }
  return { text: null, readMethod: "text" };
}

function inferEvidenceType(lineText: string): string {
  const t = lineText.toLowerCase();
  if (/\b(minutes?|meeting)\b/.test(t)) return "Minutes";
  if (/\b(polic(y|ies)|procedure|manual|framework|plan|guideline|sop)\b/.test(t)) return "Policy/Procedure";
  if (/\b(survey|feedback|questionnaire)\b/.test(t)) return "Survey/Feedback";
  if (/\b(screenshot|system|dashboard|portal|software)\b/.test(t)) return "System screenshot";
  if (/\b(record|log|register|report|list|evidence|certificate|attendance)\b/.test(t)) return "Record/Log";
  return "Other";
}

// Picks a meaningful evidence Type for an audited line from its APSR result,
// so an audited policy reads "Policy/Procedure" and an audited record reads
// "Record/Log" instead of defaulting to "Other". Falls back to the line-text
// heuristic when there is no APSR (offline runs).
function evidenceTypeFromApsr(apsr: ApsrBreakdown | undefined, lineText: string): string {
  if (!apsr) return inferEvidenceType(lineText);
  if (apsr.processes.status === "Deployed" || apsr.processes.status === "Weak") return "Record/Log";
  if (apsr.approach.status === "Meeting" || apsr.approach.status === "Beginning") return "Policy/Procedure";
  return inferEvidenceType(lineText);
}

// Short, human-readable run id for a folder audit (e.g. "AR-1.2-K9QZ"). The
// base-36 suffix of the current time keeps it short while staying unique enough
// to tell two runs of the same sub-criterion apart.
function makeRunId(subCriterionId: string): string {
  return `AR-${subCriterionId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

// Maps an auditor's 20–95 strictness slider onto the three audit calibration
// levels the AI prompt understands, so the auditor's own setting (not a global
// one) controls how hard their audits judge.
function strictnessFromScore(n: number): "Lenient" | "Standard" | "Strict" {
  if (n >= 78) return "Strict";
  if (n <= 45) return "Lenient";
  return "Standard";
}

// The two certification frameworks whose documentation requirements can differ
// for the same shared process (Task 3 — ISO vs EduTrust coverage tagging).
export type ClosureFramework = "ISO 9001" | "EduTrust";

export type ClosureState = {
  root?: string;
  // Immediate correction / containment — ISO 9001 10.2 distinguishes stopping
  // the immediate problem from the corrective action that removes its cause.
  containment?: string;
  corr?: string;
  prev?: string;
  evid?: string;
  human?: "" | "Accepted";
  ai?: string;
  aiReason?: string;
  aiNeed?: string;
  live?: boolean;
  // Closure verification record: WHO accepted it and WHEN — a closure without
  // an identifiable verifier is not an auditable record.
  closedBy?: string;
  closedAt?: string; // ISO
  // Post-closure effectiveness review (ISO 9001 10.2.1(d)): set to +30 days on
  // acceptance; confirmed later with a note once the action is shown to work.
  effectivenessDue?: string;         // ISO date
  effectivenessConfirmedAt?: string; // ISO datetime
  effectivenessNote?: string;
  // Which certification framework(s) this closure's evidence satisfies. ISO
  // 9001 and EduTrust have different documentation requirements even when the
  // underlying process is shared; tagging here stops one shared document being
  // silently assumed to cover both when it only covers one. Empty/undefined =
  // untagged (no claim either way).
  frameworks?: ClosureFramework[];
  // Per-field provenance: true once the user has hand-edited that closure
  // field, so a later panel run defers to it (Fix 3) instead of overwriting.
  // Auto content (finding-writer draft, "Suggest actions" AI, a prior panel
  // run) leaves these false and IS overwritten by the latest panel synthesis.
  manual?: { root?: boolean; corr?: boolean; prev?: boolean; evid?: boolean; containment?: boolean };
};

export type ItemAIVerdict = {
  score: number;
  band: number;
  confidence: Confidence;
  justification: string;
  higherBand: string;
  by: string;
  live: boolean;
};

// A brand-new workspace's cycle has no audit content at all — only the
// workflow-structural fields (status/version/lastSavedAt/the real creation
// timestamp) are pre-filled, since those describe the cycle's actual current
// state rather than sample content. Name/type/period/scope/owner only get
// filled in by the user, or by loadDemoDataset() below via DEMO_CYCLE_FIELDS.
const DEFAULT_CYCLE: AuditCycle = {
  id: "cycle-1",
  name: "",
  type: "",
  periodStart: "",
  periodEnd: "",
  evidenceCutOffDate: "",
  scope: "",
  status: "Draft",
  owner: "",
  version: "v0.1 Draft",
  lastSavedAt: "Not saved",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  driveRoot: "",
};

const DEMO_CYCLE_FIELDS: Partial<AuditCycle> = {
  name: "EduTrust 2027 Readiness Review",
  type: "Internal GD4 Mock Audit",
  periodStart: "2026-07-01",
  periodEnd: "2027-06-30",
  evidenceCutOffDate: "2027-05-31",
  scope: "All EduTrust GD4 criteria across academic and corporate functions.",
  owner: "SQ",
};

// Single source of truth for the five preset auditors — one per review
// perspective — used both by the Dashboard "Use demo data" seeding and the
// Auditor Creation "Load preset auditors" button, so both routes produce
// identical profiles (with perspectives) and a ready 5-seat review panel.
export const DEFAULT_AUDITORS: AuditorProfile[] = [
  { id: "AUD-1", auditCycleId: "cycle-1", name: "Rachel Tan", type: "Internal", departmentId: "SQ", role: "Audit Lead", strictness: 70, focusArea: "Overall audit setup and finalisation", checklistTemplateId: "Audit Lead Checklist", reviewPerspective: "strict-auditor" },
  { id: "AUD-2", auditCycleId: "cycle-1", name: "Marcus Lim", type: "Internal", departmentId: "SGL", role: "Department Reviewer", strictness: 60, focusArea: "Leadership and governance evidence", checklistTemplateId: "Management Review Checklist", reviewPerspective: "optimistic-process-owner" },
  { id: "AUD-3", auditCycleId: "cycle-1", name: "Priya Nair", type: "Internal", departmentId: "ALI / CM", role: "Department Reviewer", strictness: 75, focusArea: "Academic process evidence", checklistTemplateId: "Academic Process Checklist", reviewPerspective: "risk-challenger" },
  { id: "AUD-4", auditCycleId: "cycle-1", name: "Faizal Rahman", type: "Internal", departmentId: "AD / AN", role: "Department Reviewer", strictness: 80, focusArea: "Student protection and contract evidence", checklistTemplateId: "Student Protection Checklist", reviewPerspective: "academic-qa-guardian" },
  { id: "AUD-5", auditCycleId: "cycle-1", name: "Jennifer Wong", type: "External", departmentId: undefined, role: "External Reviewer", strictness: 85, focusArea: "Simulated SSG/EduTrust assessor view", checklistTemplateId: "GD4 Criterion Checklist", reviewPerspective: "management-reviewer" },
];

// Workspace-wide department directory, seeded from the acronyms and full
// names already implied by the auditor data above. Person-in-charge is left
// blank for the user to fill in via Audit Cycle.
const DEFAULT_DEPARTMENTS: Department[] = [
  { id: "ALI", acronym: "ALI", fullName: "Academic and Learning Innovation", personInCharge: "" },
  { id: "CM", acronym: "CM", fullName: "Course Management", personInCharge: "" },
  { id: "CD", acronym: "CD", fullName: "Curriculum Development", personInCharge: "" },
  { id: "GEP", acronym: "GEP", fullName: "Global Expansion and Partnerships", personInCharge: "" },
  { id: "IG", acronym: "IG", fullName: "International Growth and Alliances", personInCharge: "" },
  { id: "OEE", acronym: "OEE", fullName: "Operational Excellence", personInCharge: "" },
  { id: "AN", acronym: "AN", fullName: "Administration", personInCharge: "" },
  { id: "FN", acronym: "FN", fullName: "Finance", personInCharge: "" },
  { id: "HR", acronym: "HR", fullName: "Human Resources", personInCharge: "" },
  { id: "IT", acronym: "IT", fullName: "IT Services", personInCharge: "" },
  { id: "SES", acronym: "SES", fullName: "Sales Enablement and Strategy", personInCharge: "" },
  { id: "MG", acronym: "MG", fullName: "Marketing", personInCharge: "" },
  { id: "SL", acronym: "SL", fullName: "Sales", personInCharge: "" },
  { id: "SGL", acronym: "SGL", fullName: "Strategic Governance and Leadership", personInCharge: "" },
  { id: "CG", acronym: "CG", fullName: "Corporate Governance", personInCharge: "" },
  { id: "SQ", acronym: "SQ", fullName: "Strategic and Quality Management", personInCharge: "" },
  { id: "SSO", acronym: "SSO", fullName: "Student Success and Outreach", personInCharge: "" },
  { id: "AD", acronym: "AD", fullName: "Admissions", personInCharge: "" },
  { id: "SS", acronym: "SS", fullName: "Student Support", personInCharge: "" },
];

export type WorkspaceState = {
  cycle: AuditCycle;
  evidence: Record<string, ItemEvidence>;
  reviewer: Record<string, number>;
  confirmed: Record<string, number | null>;
  justify: Record<string, string>;
  closures: Record<string, ClosureState>;
  agents: AgentDefinition[];
  auditors: AuditorProfile[];
  departments: Department[];
  versions: VersionEntry[];
  folders: EvidenceFolder[];
  itemReviews: Record<string, ItemAIVerdict>;
  aiReviewLog: AIReviewLogEntry[];
  humanDecisionLog: HumanDecisionEntry[];
  // What an automated run (Full Auto sweep / Hybrid per-item draft) actually
  // did — distinct from aiReviewLog (per-AI-call detail). Read-only record,
  // never an input to scoring. See useWorkspaceStore's runFullAudit/
  // runHybridItemDraft (writers) and src/pages/RunLog.tsx (viewer).
  runLog: RunLogEntry[];
  // Delete ONE run-log entry / the whole log. Removes only the summary record;
  // the underlying AI Review Log, findings and scoring/checklist data are all
  // separate stores and are never touched.
  removeRunLogEntry: (id: string) => void;
  clearRunLog: () => void;
  calibrationExamples: CalibrationExample[];
  calibrationMemories: CalibrationMemory[];
  samples: SampleRecord[];
  interviewQuestions: InterviewQuestion[];
  exportLog: ExportLogEntry[];
  customFindings: Finding[];
  // Gates the hard-coded sample findings register (data/findings.ts) so a
  // brand-new workspace's Findings/AFI Closure modules start truly empty —
  // those 22 sample findings only appear once "Use demo data" is clicked.
  seedFindingsLoaded: boolean;
  // True while the workspace holds the loaded SAMPLE dataset (set by
  // loadDemoDataset, cleared by clearSampleData / createNewCycle). Drives the
  // app-wide "SAMPLE — simulated, not an official result" banner so demo data
  // — which is otherwise written into the same fields as real work — can never
  // be mistaken for a real audit. See clearSampleData.
  sampleDataActive: boolean;
  // PDCA memory: the previous cycle's full findings register, archived by
  // createNewCycle. New findings raised in the current cycle are matched
  // against it (item + normalized source ref) to derive repeatFinding and
  // escalate a repeat Minor NC to Major — without this, "did last year's
  // AFIs recur?" was unanswerable because the old cycle was simply wiped.
  priorCycleFindings: PriorCycleArchive | null;
  busy: string | null;
  // Monotonically-increasing counter used as a run-cancellation guard: each
  // audit captures it at start; cancelBusy() increments it; before writing
  // results the audit checks whether the current value still matches its
  // captured value — if not, it was cancelled and results are discarded.
  auditRunToken: number;
  // When true, the current staged AI pass should stop processing further windows
  // and return whatever results it has so far. Reset to false by the store after
  // each stage completes. Does NOT cancel the whole audit — just the current pass.
  auditSkipStageFlag: boolean;
  // Live progress state for the active folder audit — updated per-file and
  // per-batch so the UI can show a polished step indicator. Cleared by the
  // user (clearAuditProgress) so the result panel stays visible after completion.
  auditProgress: AuditProgressState | null;
  // Which folders to include in the next audit run.
  auditScope: AuditScope;
  setAuditScope: (scope: AuditScope) => void;
  // Completed/failed/cancelled audit run records, keyed by folderId.
  // Max 5 runs kept per folder; oldest dropped when the list is full.
  auditRunHistory: Record<string, AuditRunRecord[]>;
  // Most recent completed/failed run per folderId, for quick "View last run" access.
  lastAuditRuns: Record<string, AuditRunRecord>;
  // Most recent "Check folder before auditing" pre-flight result per folderId,
  // persisted so it survives a ✕ dismiss and reload and can be reopened later
  // (viewable beside the audit result). A new probe replaces the stored one.
  folderProbes: Record<string, { result: FolderProbeResult; probedAt: string }>;
  setFolderProbe: (folderId: string, result: FolderProbeResult) => void;
  // Live per-file progress while a pre-flight probe reads each file, so the UI
  // can show "Checking file N of TOTAL" instead of a static line. Transient.
  probeProgress: { folderId: string; current: number; total: number } | null;
  // Optional user tick-marks on pre-analysis checklist items, keyed
  // "folderId::checkItemId" — purely for the user's own tracking, never required.
  preAnalysisChecks: Record<string, boolean>;
  togglePreAnalysisCheck: (key: string) => void;
  // Extracted-text cache keyed by "fileId:modifiedTime". Allows unchanged Drive
  // files to skip the download step on repeat audits.
  // readMethod records HOW the content was extracted ("text" = direct text
  // extraction; "vision" = image/scanned-PDF transcription by the vision model).
  // visionModel records WHICH vision model produced a vision read, so a cached
  // vision read is invalidated and re-read when the user switches vision models.
  fileTextCache: Record<string, { text: string | null; charCount: number; fileKind: string; fileName?: string; filePath?: string; cachedAt?: number; pdfQuality?: { suspectedScannedPdf: boolean; extractedTextQuality: "none" | "low" | "medium" | "high" }; readMethod?: "text" | "vision"; visionModel?: string }>;
  // Persisted "Recheck all evidence" report so it survives navigation and
  // page refreshes. null means the report hasn't been run yet this session.
  evidenceAuditReport: { flags: EvidenceAuditFlag[]; generatedAt: string } | null;
  // PPD Requirements Review (Option A, "PPD Review" tab) — most recent run
  // per sub-criterion: one row per GD4 requirement line, policy only, with an
  // inline suggested rewrite. The verdict here feeds the Evidence tab's
  // combined assessment (below) without re-reading the policy.
  ppdReviewResults: Record<string, PPDReviewResult>;
  // Past (non-current) runs, newest first, capped at RUN_HISTORY_CAP — the
  // CURRENT run stays exactly at ppdReviewResults[subId] as before (every
  // existing reader is untouched); a fresh run archives the outgoing value
  // here instead of discarding it, so "Latest" + history are both viewable
  // without changing what "the current run" means anywhere else.
  ppdReviewHistory: Record<string, PPDReviewResult[]>;
  runPPDReview: (subCriterionId: string) => Promise<void>;
  // Evidence Assessment (Option A, "Evidence" tab) — per requirement line,
  // reuses the PPD verdict and reads the Actual Evidence folder fresh for a
  // combined Met/Partial/Not met verdict. compileEvidenceFindings raises a
  // Finding per row from that verdict — the single Option A findings compile.
  evidenceAssessments: Record<string, EvidenceAssessmentResult>;
  // Same additive history pattern as ppdReviewHistory — past runs only, the
  // current one stays at evidenceAssessments[subId].
  evidenceAssessmentHistory: Record<string, EvidenceAssessmentResult[]>;
  // Populates evidenceAssessments[sub] by REUSING the Evidence Folder staged
  // audit's stored per-checklist-line results (matched by GD4 requirement
  // ref) — no AI calls. Returns true if any audited line was found.
  deriveEvidenceAssessmentFromAudit: (subCriterionId: string) => boolean;
  // retryRefs: when set, re-assesses ONLY these requirement-line refs — the
  // rest of the stored result is left completely untouched (not silently
  // overwritten). Always re-reads/re-sends the FULL evidence file set
  // regardless of which refs are retried (never a per-file subset — a line's
  // verdict depends on ALL its cited evidence together). Omit for a normal
  // full run.
  runEvidenceAssessment: (subCriterionId: string, retryRefs?: string[]) => Promise<void>;
  // Metadata-only Drive listing (no file content read, no AI) compared
  // against the stored assessment's fileLedger — lets the Evidence tab warn
  // "evidence has changed since this result" before the user acts on a
  // possibly-stale assessment. See EvidenceDriftCheck.
  checkEvidenceDrift: (subCriterionId: string) => Promise<EvidenceDriftCheck>;
  compileEvidenceFindings: (subCriterionId: string) => number;
  // On-demand Outcomes & Review pass (Option A, "Also assess Outcomes &
  // Review" button): Option B's staged third pass run in isolation over the
  // documents the Option A run already read (fileTextCache-first; only files
  // missing from the session cache are re-read, text tier only). The result
  // is stored here as an ADVISORY panel — nothing touches the checklist
  // until applyOutcomeReviewResult (the human's explicit Apply click).
  outcomeReviewResults: Record<string, OutcomeReviewPassResult>;
  runOutcomeReviewPass: (subCriterionId: string) => Promise<void>;
  // The explicit Apply click (all modes, including full-auto): writes the
  // pass's Systems & Outcomes / Review legs onto the matched checklist lines
  // (applyOutcomeReviewLegs), logs the human decision, stamps appliedAt.
  // Returns lines updated. Never moves a band — the band still flows solely
  // from holisticBand.matrixScores via setHolisticBand.
  applyOutcomeReviewResult: (subCriterionId: string) => number;
  // Live heartbeat for a running Outcomes & Review pass; null when idle.
  outcomeReviewProgress: { subCriterionId: string; detail: string } | null;
  // Final Report AI improvement suggestions, keyed "itemId::dimensionKey"
  // (see ReportAiSuggestion). Persisted so they survive reload and match the
  // printed PDF; written ONLY by the report's explicit Generate button.
  reportAiSuggestions: Record<string, ReportAiSuggestion>;
  setReportAiSuggestions: (patch: Record<string, ReportAiSuggestion>) => void;
  // Concise auditor-voice summaries for long finding text on the Final
  // Report, keyed "itemId::dimensionKey::lineId" — same generate-once-and-
  // save contract as reportAiSuggestions; the raw finding text is never
  // replaced, only fronted (full text stays behind the row's expand).
  reportConciseFindings: Record<string, ReportAiSuggestion>;
  setReportConciseFindings: (patch: Record<string, ReportAiSuggestion>) => void;
  // Auditor-narrative blocks (Strength/Weakness/Band/Required Action) on the
  // Final Report, keyed "itemId::dimensionKey" — same key scheme and
  // generate-once-and-save contract as reportAiSuggestions. A dimension-level
  // synthesis, additional to reportConciseFindings (which is per row).
  reportDimensionNarratives: Record<string, DimensionNarrative>;
  setReportDimensionNarratives: (patch: Record<string, DimensionNarrative>) => void;
  // Live progress for a fresh runEvidenceAssessment (bar + heartbeat on the
  // Evidence tab); null when no assessment is running.
  evidenceAssessmentProgress: EvidenceAssessmentProgress | null;
  // Task 1a: set the moment runEvidenceAssessment's read loop first hits the
  // run's vision-image budget (a scanned/image-only PDF or standalone image
  // it can't read without more budget) — a BLOCKING prompt, not a post-hoc
  // note, so the run pauses instead of silently producing a false "no
  // evidence" verdict for the unread file. null when nothing is waiting.
  visionBudgetPrompt: VisionBudgetPrompt | null;
  // Answers the pending prompt above: "proceed" raises the budget for the
  // REST of this run and re-reads the file that triggered it; "skip" keeps
  // today's behaviour (file stays unread) but as an affirmed user choice.
  // No-op if nothing is waiting.
  resolveVisionBudgetPrompt: (choice: "proceed" | "skip") => void;
  // Live heartbeat for the PPD review run (window/batch detail), so the tab
  // shows real progress instead of a static "Reviewing…" button.
  ppdReviewProgress: PPDReviewProgress | null;
  // Which analysis path a sub-criterion uses: "A" (PPD Requirements Review —
  // default/recommended) or "B" (the existing checklist, unchanged).
  // Missing key means "A" — see ANALYSIS_PATH_DEFAULT.
  analysisPath: Record<string, "A" | "B">;
  setAnalysisPath: (subCriterionId: string, path: "A" | "B") => void;

  // ONE cycle-level choice of how much the AI does (Start Audit page):
  // full-auto commits everything, hybrid stops at every gate, manual commits
  // nothing automatically. Changeable mid-cycle. Modes only change WHEN
  // results commit and whether the human is prompted — see lib/runModes.ts.
  auditMode: AuditMode;
  setAuditMode: (mode: AuditMode) => void;

  // Auditor review panel: which auditor profiles (2-5) sit on the panel, how
  // it is triggered, and the per-finding run. Panel results cache on the
  // finding (Finding.panelReview); busy id is `panel:<findingId>`.
  reviewPanelAuditorIds: string[];
  setReviewPanelAuditorIds: (ids: string[]) => void;
  reviewPanelMode: PanelReviewMode;
  setReviewPanelMode: (mode: PanelReviewMode) => void;
  // Runs the panel on one finding (per-auditor reviews + synthesis), caches
  // the result on the finding and seeds the closure scaffold from the
  // synthesis. force re-runs even if a cached review matches.
  runFindingPanelReview: (findingId: string, opts?: { force?: boolean }) => Promise<void>;
  // Writes the finding's cached panel synthesis into its closure fields +
  // header classification. Overwrites auto-generated content; defers to
  // manually-edited fields (flagging a conflict) unless force is set — the
  // "Apply panel conclusion" button passes force to override manual edits.
  applyPanelConclusion: (findingId: string, opts?: { force?: boolean }) => void;
  // Full-auto sweep: audits every sub-criterion end to end (respecting each
  // row's Option A/B choice); folders with no links are marked "Not assessed
  // / no evidence" rather than silently skipped. Progress drives the
  // full-screen overlay; cancel goes through the existing abort mechanism.
  fullAuditProgress: FullAuditProgress | null;
  runFullAudit: () => Promise<void>;
  // Post-sweep band pass for Full Auto. No-op (returns empty) unless the
  // "Auto-score bands" scoring-config setting is ON — that gate is what keeps
  // a setting-OFF run byte-identical to before this feature existed. For each
  // assessed item under the given sub-criteria it runs the AI band suggestion
  // and saves it via setHolisticBand({ source: "ai-auto" }); an item the AI
  // cannot score cleanly (suggestion unavailable, or a gate would reject) is
  // skipped, never force-saved. Reused only by runFullAudit today; exposed so
  // it can be unit-tested directly.
  autoScoreAssessedItems: (subIds: string[]) => Promise<{ set: string[]; skipped: { itemId: string; reason: string }[] }>;
  // Hybrid per-item hands-off draft: drives ONE sub-criterion (Option A)
  // straight through — runOptionAFullAuto (PPD -> Evidence -> compile ->
  // Outcomes/Review) then the band auto-scores off that complete data. Scoped
  // to the single sub whose "Run audit" was clicked; never a sweep, never
  // cascades. Wired only from that deliberate click when autoScoreBands is on.
  // Returns the terminal outcome so the caller can react: "done" (a full run
  // that scored the band), "stopped" (ran but stopped early — e.g. no PPD/
  // evidence rows), or "cancelled" (the user hit Cancel). Only "done" should
  // navigate the user onward to the Final Report.
  runHybridItemDraft: (subCriterionId: string) => Promise<"done" | "stopped" | "cancelled">;
  // Auto-writes the Final Report auditor narratives for the given banded items
  // — the run flows call this as their FINAL, non-blocking step (verdicts,
  // findings and band are already committed before it starts, so a slow or
  // failed narrative call can never delay or corrupt scoring data). Returns
  // how many items got a narrative; skips silently when AI is offline or an
  // item has nothing narratable. Same generator the "Regenerate report text"
  // button uses (lib/ai/narrativeWriter).
  writeReportNarratives: (itemIds: string[]) => Promise<number>;
  dismissFullAuditProgress: () => void;
  // Live per-step progress for the Hybrid draft (transient, never persisted) —
  // Full Auto has its own overlay (fullAuditProgress); this is only set by
  // runHybridItemDraft so the single-item run shows real step completion.
  hybridDraftProgress: HybridDraftProgress | null;
  dismissHybridDraftProgress: () => void;
  // Checklist writes held for human review by the gated modes, one pending
  // run per sub-criterion (a new run replaces the previous pending one).
  pendingCommits: Record<string, PendingRun>;
  // Accept ("commit this write, raise its findings") or reject ("drop it,
  // nothing committed") ONE queued item; an optional status override lets
  // Hybrid's Edit apply the human's verdict instead of the AI draft.
  resolvePendingItem: (subCriterionId: string, itemId: string, decision: "accept" | "reject", overrideStatus?: "Met" | "Partial" | "Not met") => void;
  // Commit every still-queued item of the pending run at once (Review mode's
  // "Accept all"), then raise findings through the normal deduped pipeline.
  acceptAllPending: (subCriterionId: string) => void;
  // Throw the whole pending run away — nothing is committed.
  discardPendingRun: (subCriterionId: string) => void;
  // Option A in Full auto: PPD review → evidence assessment → compile
  // findings, end to end with no stops (each step is the existing engine).
  // Returns which real steps ran, for the Run Log (RunLogSubOutcome.steps) —
  // never fabricated, exactly the same early-return decisions the function
  // already made.
  // onStep (optional) fires at each real internal boundary as it STARTS —
  // used only by runHybridItemDraft to drive its live overlay; Full Auto
  // passes nothing and is unaffected. Never changes what runs or in what order.
  runOptionAFullAuto: (subCriterionId: string, onStep?: (step: "ppd" | "evidence" | "findings" | "review") => void) => Promise<{ ppdRan: boolean; evidenceRan: boolean; findingsCompiled: number; outcomeReviewApplied: boolean }>;

  // LEGACY change-log copy: kept in state only so the one-time migration into
  // the dedicated append-only useChangeLogStore can read previously-persisted
  // entries. No longer written to (recordChangeLogEntry removed) and excluded
  // from partialize.
  changeLog: ChangeLogEntry[];
  // Developer/diagnostic UI visibility (commit footer + Change Log page).
  // Synced with the workspace (Supabase) so one off switch covers every
  // device. Hiding the UI never stops change-log entries being recorded.
  showDeveloperTools: boolean;
  setShowDeveloperTools: (show: boolean) => void;
  // Display theme — "default" is the original look; "bold" is a slightly
  // larger, less saturated, heavier-weight look for readability (see
  // ThemeScope in Layout.tsx, which applies it via a wrapping data-theme
  // attribute rather than touching every page's inline styles). Synced with
  // the workspace so the choice follows the user across devices.
  uiTheme: "default" | "bold";
  setUiTheme: (theme: "default" | "bold") => void;

  updateCycle: (patch: Partial<AuditCycle>) => void;
  // Clears a stranded busy/bulk state so a button stuck on "Auditing…" can be
  // released. Also aborts the currently reading file so the loop exits promptly.
  cancelBusy: () => void;
  skipCurrentAuditStage: () => void;
  // Clears the extracted-text cache so the next audit re-downloads all files
  // from Drive. Use when files have been updated but Drive modifiedTime hasn't
  // changed (e.g. in-place Google Docs edits that don't bump the timestamp).
  clearFileTextCache: () => void;
  // Removes one cached file's entry (by its "fileId:modifiedTime" cache key)
  // without touching any other cached file — for re-downloading a single
  // stale/corrupt cache entry rather than clearing everything.
  removeFileTextCacheEntry: (key: string) => void;
  // Skips the file currently being read — aborts its Drive download and/or AI
  // description call and moves the loop to the next file. No-op if not reading.
  skipCurrentFile: () => void;
  skipCurrentAiCall: () => void;
  // Dismisses the audit progress panel (does not cancel the audit itself).
  clearAuditProgress: () => void;
  runEvidenceAudit: (flags: EvidenceAuditFlag[] | null) => void;
  loadDemoDataset: () => void;
  // Clears the loaded SAMPLE dataset and returns the workspace to a blank
  // state (evidence/scores/findings/samples/etc. reset), turning off the
  // SAMPLE banner. Used from that banner's "Clear sample data" control.
  clearSampleData: () => void;
  saveAsNewVersion: (name: string, note?: string) => void;
  restoreVersion: (versionId: string) => void;
  lockCycle: () => void;
  unlockCycle: () => void;
  duplicateCycle: () => void;
  createNewCycle: () => void;

  setReviewerScore: (itemId: string, value: number) => void;
  setJustify: (itemId: string, value: string) => void;
  confirmScore: (itemId: string) => void;

  setAgentStrictness: (agentId: string, value: number) => void;
  runItemAI: (agentId: string, itemId: string) => Promise<void>;

  setClosureField: (afiId: string, field: keyof ClosureState, value: string) => void;
  // Toggle whether this closure's evidence is tagged as satisfying a given
  // certification framework (ISO 9001 / EduTrust). Task 3 — distinguishes
  // shared documentation's coverage per framework.
  toggleClosureFramework: (afiId: string, fw: ClosureFramework) => void;
  // Pre-fills a finding's closure with a derived root cause / corrective /
  // preventive (from buildFindingAnalysis), WITHOUT overwriting anything the
  // user has already written. Used when findings are auto-raised so the AFI
  // Closure form and Final Report start deep instead of blank.
  seedClosure: (afiId: string, seed: { root?: string; corr?: string; prev?: string }) => void;
  runClosureAI: (afiId: string) => Promise<void>;
  draftClosureActions: (afiId: string, issue: string, gd4ItemId: string) => Promise<void>;
  setClosureHuman: (afiId: string, value: "" | "Accepted", reason?: string) => void;
  confirmClosureEffectiveness: (afiId: string, note: string) => void;

  addAuditor: (a: AuditorProfile) => void;
  updateAuditor: (id: string, patch: Partial<AuditorProfile>) => void;
  removeAuditor: (id: string) => void;
  // Seeds the five preset auditors (with perspectives) and puts them on the
  // review panel in one click. "add" skips presets whose name already exists;
  // "replace" swaps the whole roster for the presets. Returns how many were
  // added so the page can message the result.
  loadPresetAuditors: (mode: "add" | "replace") => number;

  addDepartment: (d: Department) => void;
  updateDepartment: (id: string, patch: Partial<Department>) => void;
  removeDepartment: (id: string) => void;
  resetDepartments: () => void;

  setFolderField: <K extends keyof EvidenceFolder>(id: string, field: K, value: EvidenceFolder[K]) => void;
  checkFolderAccess: (id: string, tab?: "policy" | "evidence") => Promise<void>;
  // Pre-flight probe: lists a folder's files, classifies them into the
  // policy/evidence buckets, and read-checks each — with ZERO AI calls — so
  // mis-bucketing and unreadable files are caught before a real audit is spent.
  probeFolder: (id: string, tab?: "policy" | "evidence") => Promise<FolderProbeResult>;
  // extraContext (optional): school-wide "Additional info" folder text, fed in
  // as labeled background — never primary evidence (the evidence-sufficiency
  // caps still gate the band).
  // overallProgress (optional): position within an "Audit All" run, used by
  // the progress panel to show progress like "3 of N".
  auditFolderContents: (id: string, extraContext?: string, overallProgress?: { current: number; total: number }) => Promise<void>;
  // Staged audit: three focused AI passes (policy → evidence → outcome/review)
  // with a deterministic APSR verdict builder. Mode controls which stages run.
  auditFolderStaged: (id: string, mode: "policy" | "evidence" | "all", extraContext?: string, overallProgress?: { current: number; total: number }) => Promise<void>;
  // One-click "audit every folder that has a link" used by the Dashboard.
  // bulkAuditStatus carries human-readable progress ("Auditing 3/24 …") while
  // it runs, and is null when idle.
  bulkAuditStatus: string | null;
  auditAllFolders: () => Promise<void>;
  // Like auditAllFolders, but skips any folder whose newest Drive file has not
  // changed since its last audit (compared via lastAuditNewestModified). Saves
  // time and AI cost on re-runs. Returns a short summary of what it did.
  auditChangedFolders: () => Promise<{ audited: number; skipped: number; unlinked: number }>;

  // School-wide "Additional info" folder — general supporting documents that
  // apply to every criterion (org chart, staff/student/partner listing, MR
  // declaration, awards), not tied to any one sub-criterion.
  additionalInfo: { link: string; accessStatus?: DriveAccessStatus; accessNote?: string; accessAt?: string };
  setAdditionalInfoLink: (link: string) => void;
  checkAdditionalInfoAccess: () => Promise<void>;

  // School Context — the auditor's "briefing": a persistent markdown profile
  // of the institution (+ optional Drive link to pull more), injected as
  // background into every AI assessment so it never starts blind.
  schoolContext: { text: string; link: string; driveCache?: string; cachedAt?: string; accessStatus?: DriveAccessStatus; accessNote?: string; enabled?: boolean };
  setSchoolContextText: (text: string) => void;
  setSchoolContextLink: (link: string) => void;
  setSchoolContextEnabled: (enabled: boolean) => void;
  readSchoolContextFromDrive: () => Promise<void>;

  setSamples: (samples: SampleRecord[]) => void;
  toggleSample: (id: string) => void;
  setSampleOutcome: (id: string, outcome: SampleRecord["testedOutcome"], notes?: string) => void;

  setInterviewQuestions: (qs: InterviewQuestion[]) => void;
  setQuestionReadiness: (id: string, readiness: InterviewQuestion["readiness"], notes?: string) => void;

  addExportLogEntry: (e: ExportLogEntry) => void;

  addCustomFinding: (f: Finding) => void;
  updateCustomFinding: (id: string, patch: Partial<Finding>) => void;
  // Human override of an NC finding's Major/Minor severity (the AI panel
  // suggests it; this lets a human set it directly).
  setNcSeverity: (id: string, severity: NcSeverity) => void;
  removeCustomFinding: (id: string) => void;
  clearAllFindings: () => void;
  // Delete every finding for ONE sub-criterion, leaving all others intact.
  // Reuses the same back-pointer sweep as clearAllFindings / removeCustomFinding.
  clearFindingsForSubCriterion: (subCriterionId: string) => void;
  clearAllClosures: () => void;

  clearAIReviewLog: () => void;
  clearHumanDecisionLog: () => void;
  clearReviewerOverride: (itemId: string) => void;

  // Lets other stores (e.g. the checklist module) record an AI run in the
  // shared review log without duplicating the id/timestamp boilerplate.
  pushAIReviewLog: (entry: {
    agent: string;
    reviewType: AIReviewType;
    subjectId: string;
    verdict: string;
    confidence: Confidence;
    keyConcerns: string[];
    recommendedAction: string;
    evidenceNeeded?: string;
    suggestedScore?: number;
    suggestedBand?: number;
    live: boolean;
    liveError?: string;
    generatedContent?: string;
    promptSent?: string;
    runId?: string;
    usage?: AIUsage;
  }) => void;

  logHumanDecision: (entry: Omit<HumanDecisionEntry, "id" | "timestamp">) => void;
  toggleCalibrationIncluded: (id: string) => void;
  markCalibrationUsed: (ids: string[]) => void;
  addCalibrationMemory: (memory: Omit<CalibrationMemory, "id" | "timestamp" | "usageCount" | "effectivenessScore">) => string;
  updateMemoryStatus: (id: string, status: CalibrationMemoryStatus) => void;
  incrementMemoryUsage: (id: string) => void;

  // Running markdown log of every folder audit in this workspace.
  // Auto-updated after each auditFolderContents call; fed into subsequent AI
  // calls so the model can flag recurring cross-criterion gaps.
  auditJournal: string;
  clearAuditJournal: () => void;

  // Immutable audit trail of every version restore. Entries are appended
  // whenever restoreVersion() is called; never deleted from the store.
  restoreLog: { restoredAt: string; fromVersion: string; fromNote: string }[];

  // The auditor a folder audit is run "on behalf of": the AI does the reading,
  // but a named human auditor owns the result and their strictness drives how
  // hard the AI judges. null → fall back to the Audit Lead, then the first
  // auditor, then the global AI strictness setting.
  activeAuditorId: string | null;
  setActiveAuditor: (id: string | null) => void;

  // Why the last attempted audit run was refused (no auditor selected / none
  // exist). Set by the guard at the top of every audit entry action; cleared
  // when a run starts successfully or the auditor selection changes. Pages
  // render it as a blocking banner next to their run buttons.
  auditBlockedReason: string | null;

  // Why the last attempted run was refused for a Drive reason (no folder link,
  // or not connected to Google Drive). Set by the same pre-run guard; the
  // Evidence Folder page renders it as a banner with a "Connect to Google
  // Drive" button when canConnect. Cleared when a run starts or Drive connects.
  driveBlockedReason: (DriveRunBlock & { subCriterionId?: string }) | null;
  setDriveBlockedReason: (reason: (DriveRunBlock & { subCriterionId?: string }) | null) => void;
};

// ---- Audit Journal helpers -----------------------------------------------

// Maps an APSR breakdown to its weakest-link dimension label for the journal.
function apsrDimLabel(apsr: ApsrBreakdown): string {
  if (apsr.approach.status !== "Meeting") return "Approach gap";
  if (apsr.processes.status !== "Deployed") return "Processes gap";
  if (apsr.systemsOutcomes.status !== "Evident") return "Outcomes gap";
  if (apsr.review.status !== "Evident") return "Review gap";
  return "";
}

// Builds a compact markdown entry for one sub-criterion's audit result.
function buildJournalEntry(
  subCriterionId: string,
  folderName: string,
  bandParts: string[],
  verdicts: FolderAuditLineVerdict[],
  lineTextById: Map<string, string>,
  runId: string,
): string {
  const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
  for (const v of verdicts) counts[v.status]++;
  const date = new Date().toLocaleDateString("en-GB");
  const header = `### ${subCriterionId} [${runId}] — ${folderName} (${date})`;
  const summary = `${bandParts.length ? `Band: ${bandParts.join(", ")}. ` : ""}${counts.Met} Met / ${counts.Partial} Partial / ${counts["Not met"]} Not met.`;
  const gaps = verdicts.filter((v) => v.status !== "Met").slice(0, 4);
  if (gaps.length === 0) return `${header}\n${summary}`;
  const gapLines = gaps.map((v) => {
    const text = (lineTextById.get(v.lineId) || v.lineId).slice(0, 70);
    const dim = v.apsr ? apsrDimLabel(v.apsr) : "";
    return `- ${text}${dim ? ` [${dim}]` : ""}`;
  });
  return `${header}\n${summary}\nGaps:\n${gapLines.join("\n")}`;
}

// Replaces any existing entry for subCriterionId in the journal and appends
// the new entry at the end (most-recent-last order).
function updateJournal(journal: string, subCriterionId: string, newEntry: string): string {
  // Match by sub-criterion id followed by a space (e.g. "### 1.2 ") so the
  // optional "[runId]" in the header doesn't break the replace-in-place.
  const prefix = `### ${subCriterionId} `;
  const lines = journal.split("\n");
  const out: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith(prefix)) { skip = true; continue; }
    if (skip && (line.startsWith("### ") || line.startsWith("⚠ Recurring"))) skip = false;
    // Drop any previously-appended trailing "Recurring patterns" summary lines
    // wherever they sit — exactly one fresh one is re-appended by the caller,
    // so they can never accumulate (the bug that showed the line 3×).
    if (line.startsWith("⚠ Recurring patterns")) continue;
    if (!skip) out.push(line);
  }
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return cleaned ? `${cleaned}\n\n${newEntry}` : newEntry;
}

// Scans the journal for dimensions that recur across 2+ sub-criteria and
// returns a trailing warning line, or "" if no recurring pattern found.
function patternNote(journal: string): string {
  const dims = [
    { key: "Approach gap", label: "Approach" },
    { key: "Processes gap", label: "Processes" },
    { key: "Outcomes gap", label: "Systems & Outcomes" },
    { key: "Review gap", label: "Review" },
  ];
  const recurring = dims.filter(({ key }) => (journal.match(new RegExp(`\\[${key}\\]`, "g")) || []).length >= 2);
  if (recurring.length === 0) return "";
  return `\n\n⚠ Recurring patterns: ${recurring.map(({ label, key }) => `${label} gap (${(journal.match(new RegExp(`\\[${key}\\]`, "g")) || []).length}×)`).join(", ")} — may indicate systemic gaps.`;
}

// ---- End audit journal helpers --------------------------------------------

let logCounter = 0;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      cycle: DEFAULT_CYCLE,
      evidence: blankEvidence(),
      reviewer: {},
      confirmed: {},
      justify: {},
      closures: {},
      agents: AGENTS,
      auditors: [],
      departments: DEFAULT_DEPARTMENTS,
      versions: [],
      folders: seedFolders(),
      itemReviews: {},
      aiReviewLog: [],
      humanDecisionLog: [],
      runLog: [],
      calibrationExamples: [],
      calibrationMemories: [],
      samples: [],
      interviewQuestions: [],
      exportLog: [],
      customFindings: [],
      seedFindingsLoaded: false,
      sampleDataActive: false,
      priorCycleFindings: null,
      busy: null,
      auditRunToken: 0,
      auditSkipStageFlag: false,
      auditProgress: null,
      auditScope: "both" as AuditScope,
      auditRunHistory: {},
      lastAuditRuns: {},
      folderProbes: {},
      setFolderProbe: (folderId, result) => set((s) => ({ folderProbes: { ...s.folderProbes, [folderId]: { result, probedAt: new Date().toISOString() } } })),
      probeProgress: null,
      preAnalysisChecks: {},
      togglePreAnalysisCheck: (key) => set((s) => ({ preAnalysisChecks: { ...s.preAnalysisChecks, [key]: !s.preAnalysisChecks[key] } })),
      fileTextCache: {},
      bulkAuditStatus: null,
      additionalInfo: { link: "" },
      schoolContext: { text: "", link: "" },
      evidenceAuditReport: null,
      ppdReviewResults: {},
      ppdReviewHistory: {},
      evidenceAssessments: {},
      evidenceAssessmentHistory: {},
      evidenceAssessmentProgress: null,
      outcomeReviewResults: {},
      outcomeReviewProgress: null,
      reportAiSuggestions: {},
      // Suggestion text is capped at write time — persisted state must never
      // grow an unbounded blob (same rule as the promptSent caps).
      setReportAiSuggestions: (patch) =>
        set((s) => ({
          reportAiSuggestions: {
            ...s.reportAiSuggestions,
            ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { ...v, text: v.text.slice(0, 2000) }])),
          },
        })),
      reportConciseFindings: {},
      setReportConciseFindings: (patch) =>
        set((s) => ({
          reportConciseFindings: {
            ...s.reportConciseFindings,
            ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { ...v, text: v.text.slice(0, 2000) }])),
          },
        })),
      reportDimensionNarratives: {},
      // Same cap-at-write-time rule as the two suggestion stores above —
      // applied to each of the three free-text fields independently.
      setReportDimensionNarratives: (patch) =>
        set((s) => ({
          reportDimensionNarratives: {
            ...s.reportDimensionNarratives,
            ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, {
              ...v,
              strength: v.strength?.slice(0, 2000),
              weakness: v.weakness?.slice(0, 2000),
              bandLine: v.bandLine.slice(0, 500),
              requiredAction: v.requiredAction?.slice(0, 2000),
            }])),
          },
        })),
      ppdReviewProgress: null,
      analysisPath: {},
      auditMode: DEFAULT_AUDIT_MODE,
      reviewPanelAuditorIds: [],
      reviewPanelMode: "on-demand",
      fullAuditProgress: null,
      hybridDraftProgress: null,
      pendingCommits: {},
      changeLog: [],
      showDeveloperTools: DEFAULT_SHOW_DEVELOPER_TOOLS,
      setShowDeveloperTools: (show) => set({ showDeveloperTools: show }),
      uiTheme: "default",
      setUiTheme: (theme) => set({ uiTheme: theme }),
      auditJournal: "",
      restoreLog: [],
      activeAuditorId: null,
      auditBlockedReason: null,
      driveBlockedReason: null,
      setDriveBlockedReason: (reason) => set({ driveBlockedReason: reason }),

      // Changing the selection clears any "run blocked" banner — the user has
      // acted on exactly what the message asked for.
      setActiveAuditor: (id) => set({ activeAuditorId: id, auditBlockedReason: null }),
      setAuditScope: (scope) => set({ auditScope: scope }),

      updateCycle: (patch) => set((s) => ({ cycle: { ...s.cycle, ...patch, updatedAt: new Date().toISOString() } })),

      cancelBusy: () => {
        // Abort the current file read immediately so the loop doesn't wait for
        // the per-file timeout to fire before releasing the busy state.
        _currentFileAbort?.();
        _currentFileAbort = null;
        _currentAiCallAbort = null;
        // A cancel while the run is paused on the vision-budget prompt must not
        // leave it awaiting forever — answer it as "skip" (the safe, no-extra-
        // spend default) so the paused await resolves and the run can unwind.
        _pendingVisionBudgetResolve?.("skip");
        _pendingVisionBudgetResolve = null;
        // Abort the run-level controller so any IN-FLIGHT AI call dies now —
        // previously cancel only flipped flags checked between calls, so the
        // current request (and, in the staged audit, every remaining
        // window×batch call) kept running and billing after cancel.
        _currentRunAbort?.abort();
        _currentRunAbort = null;
        // Also clear the skip-stage flag — otherwise a stale `true` (set right
        // before cancel, with no chance for the in-flight stage's reset to run)
        // would silently cut short the very next audit's first stage.
        set((s) => ({ busy: null, bulkAuditStatus: null, auditRunToken: s.auditRunToken + 1, auditSkipStageFlag: false, visionBudgetPrompt: null }));
      },

      skipCurrentAuditStage: () => set({ auditSkipStageFlag: true }),

      clearFileTextCache: () => set({ fileTextCache: {} }),
      removeFileTextCacheEntry: (key) =>
        set((s) => {
          const { [key]: _removed, ...rest } = s.fileTextCache;
          return { fileTextCache: rest };
        }),
      skipCurrentFile: () => {
        // Abort only the current file — loop continues to the next one.
        _currentFileAbort?.();
        // Note: _currentFileAbort is cleared by the loop itself after the catch.
      },
      skipCurrentAiCall: () => {
        // Abandon only the current in-flight AI extract call — the loop then
        // continues to the next window/batch, treating this one like an empty
        // reply (its points fall through or are marked not assessed). The
        // abandoned call runs on to its own timeout in the background.
        _currentAiCallAbort?.();
        // Cleared by agentRuntime's raceCallSkip finally after this call.
      },
      visionBudgetPrompt: null,
      resolveVisionBudgetPrompt: (choice) => {
        _pendingVisionBudgetResolve?.(choice);
        _pendingVisionBudgetResolve = null;
        set({ visionBudgetPrompt: null });
      },
      clearAuditProgress: () => set({ auditProgress: null }),
      clearAuditJournal: () => set({ auditJournal: "" }),

      runEvidenceAudit: (flags: EvidenceAuditFlag[] | null) =>
        set({ evidenceAuditReport: flags === null ? null : { flags, generatedAt: new Date().toLocaleString() } }),

      // PPD Requirements Review: reads ONLY the Policy & Procedure Document(s)
      // linked to a sub-criterion's evidence folder, then asks the AI
      // (runPPDRequirementsReview in agentRuntime.ts) whether each GD4
      // requirement in that sub-criterion is actually documented in the PPD.
      // Deliberately much leaner than auditFolderStaged: no evidence-folder
      // reading, no checklist writing, no progress modal — this is a
      // standalone review, not part of the scored audit pipeline.
      runPPDReview: async (subCriterionId) => {
        const s = get();
        const folder = s.folders.find((f) => folderScopeId(f) === subCriterionId);
        if (!folder) return;
        // Every audit entry point refuses to start without a named auditor —
        // an "Unassigned" run has no attribution and breaks the review panel.
        const auditorGate = checkAuditorForRun(s.auditors, s.activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        set({ busy: "ppdreview" + subCriterionId, auditBlockedReason: null });
        const runId = `PPD-${subCriterionId}-${Date.now().toString(36).toUpperCase()}`;
        // Run-level abort — cancelBusy() kills the in-flight AI call.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;

        // Merge-based progress updaters — same pattern as runEvidenceAssessment's
        // curEv/patchEv/logEv, so the detailed live-activity fields (stage,
        // files, per-line status, log) survive every pct/detail tick instead of
        // being wiped by a plain replace.
        const PPD_LOG_CAP = 60;
        const curPpd = (): PPDReviewProgress => {
          const p = get().ppdReviewProgress;
          return p && p.subCriterionId === subCriterionId ? p : { subCriterionId, detail: "" };
        };
        const patchPpd = (patch: Partial<PPDReviewProgress>) =>
          set({ ppdReviewProgress: { ...curPpd(), ...patch, subCriterionId, heartbeatAt: Date.now() } });
        const logPpd = (text: string, tone?: "info" | "good" | "warn" | "bad") =>
          patchPpd({ log: [...(curPpd().log ?? []), { at: Date.now(), text, tone }].slice(-PPD_LOG_CAP) });

        const finish = (rows: PPDReviewRow[] | null, live: boolean, liveError: string | undefined, promptSent?: string, usage?: AIUsage, chunkFileNames?: Record<string, string>, overallNarrative?: string, runWarnings?: string[], contradictions?: PPDContradiction[], fileLedger?: AuditFileRecord[]) => {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          // Sub-criterion roll-up, derived deterministically from the rows.
          // "Not assessed" lines (stopped/failed before review) are counted
          // separately and never counted as gaps.
          const adequate = rows ? rows.filter((r) => r.verdict === "Adequate").length : 0;
          const partial = rows ? rows.filter((r) => r.verdict === "Partial").length : 0;
          const notDocumented = rows ? rows.filter((r) => r.verdict === "Not documented").length : 0;
          const notAssessed = rows ? rows.filter((r) => r.verdict === "Not assessed").length : 0;
          const overallVerdict: PPDOverallVerdict | undefined = rows
            ? notDocumented > 0 ? "PPD Gaps" : partial > 0 ? "PPD Partial" : "PPD Adequate"
            : undefined;
          const overallSummary = rows
            ? (notDocumented === 0 && partial === 0 && notAssessed === 0
              ? `${adequate} of ${rows.length} requirement line${rows.length === 1 ? "" : "s"} adequately documented`
              : `${adequate} adequate · ${partial} partial · ${notDocumented} not documented${notAssessed > 0 ? ` · ${notAssessed} not assessed` : ""}`)
            : undefined;
          const summary = rows
            ? `PPD requirements review${runWarnings?.length ? " (WITH ERRORS — results may be incomplete)" : ""}: ${adequate} Adequate, ${partial} Partial, ${notDocumented} Not documented${notAssessed > 0 ? `, ${notAssessed} Not assessed` : ""} (of ${rows.length}).`
            : `PPD requirements review failed${liveError ? `: ${liveError}` : "."}`;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "PPD Requirements Reviewer",
            reviewType: "Evidence",
            subjectId: subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Review each Partial/Not documented requirement line's suggested rewrite, then compile findings straight from this page.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          };
          set((st) => {
            // Task 2: archive the OUTGOING result into history before it's
            // replaced — never on a failed run (rows null leaves the current
            // result untouched, so there is nothing new to archive either).
            const prev = rows ? st.ppdReviewResults[subCriterionId] : undefined;
            return {
              ppdReviewResults: rows
                ? { ...st.ppdReviewResults, [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live, promptSent, chunkFileNames, overallVerdict, overallSummary, overallNarrative, runWarnings, contradictions, fileLedger, effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()), model: usage?.model } }
                : st.ppdReviewResults,
              ppdReviewHistory: prev
                ? { ...st.ppdReviewHistory, [subCriterionId]: [prev, ...(st.ppdReviewHistory[subCriterionId] ?? [])].slice(0, OPTION_A_RUN_HISTORY_CAP) }
                : st.ppdReviewHistory,
              aiReviewLog: [log, ...st.aiReviewLog].slice(0, 500),
              // Guarded: a timed-out run's late finish must not clear the NEXT
              // run's busy flag (the full-audit sweep may already have moved on).
              busy: st.busy === "ppdreview" + subCriterionId ? null : st.busy,
              ppdReviewProgress: st.ppdReviewProgress?.subCriterionId === subCriterionId ? null : st.ppdReviewProgress,
              // Mid-run Drive expiry (2026-07-20): checkDriveForRun sets
              // driveBlockedReason at run START, but a token that dies DURING the
              // read loop only surfaced here as an error message — no reconnect
              // affordance. Set the same block so the run overlay's Reconnect
              // button appears (it auto-clears once a token arrives).
              ...(liveError === DRIVE_EXPIRED_MID_RUN ? { driveBlockedReason: { reason: "not-connected" as const, message: DRIVE_EXPIRED_MID_RUN, canConnect: true, subCriterionId } } : {}),
            };
          });
        };

        try {
          // One row per GD4 requirement LINE (FlatAuditPoint), not per whole
          // requirement item — e.g. 1.2.1 Strategic Planning has 5
          // Describe/Show lines, so 5 rows. Notes/Expected Evidence bullets
          // are excluded; those aren't requirement lines an auditor tests.
          const requirements: PPDRequirementInput[] = GD4_REQUIREMENTS
            .filter((r) => itemIdsForScope(subCriterionId).includes(r.id))
            .flatMap((r) =>
              (r.flatAuditPoints ?? [])
                .filter((p) => p.sourceType === "describeShow")
                .map((p) => ({ ref: p.ref, gd4ItemId: r.id, requirementText: p.text }))
            );
          if (requirements.length === 0) { finish(null, false, "No GD4 requirement lines map to this sub-criterion."); return; }

          const policyId = parseFolderId(folder.policyLink) || parseFolderId(folder.folderLink);
          // getFreshToken (not getValidToken) so a near-/already-expired token
          // gets silently refreshed here, before the folder listing that
          // follows — the same refresh the per-file read loop below already
          // does, just also covering the run's very first Drive call.
          const token = await useGoogleDriveStore.getState().getFreshToken();
          // Drive guard: block with a clear message + Connect action (via the
          // Evidence Folder banner) instead of failing silently — Option A used
          // to just stop here with no visible error.
          const drive = checkDriveForRun(!!policyId, !!token);
          if (drive) { set({ driveBlockedReason: { ...drive, subCriterionId } }); finish(null, false, drive.message); return; }
          set({ driveBlockedReason: null });
          if (!token || !policyId) { finish(null, false, DRIVE_EXPIRED_MID_RUN); return; } // should be unreachable past the guard; never strand busy

          const allFiles = await listFolderFilesRecursive(policyId, token, "", 0, timeoutSignal(runAbort.signal, DRIVE_LIST_TIMEOUT_MS));
          // If policyLink is a dedicated folder, every file in it is policy;
          // if it's the shared single-folder convention (folderLink doubling
          // as both), keep only files under the "Policy & Procedure" subfolder.
          const policyFiles = parseFolderId(folder.policyLink)
            ? allFiles
            : allFiles.filter((f) => classifyFileBucket(f.path) === "policy");
          // Live recount at run time (Item 4, 2026-07-19): refresh the stored
          // policy file count from THIS run's listing so the estimate reflects
          // the folder's current contents, not the last check-access figure.
          set((st) => ({ folders: st.folders.map((f) => f.id === folder.id ? { ...f, policyFileCount: policyFiles.length, fileCountAt: new Date().toISOString() } : f) }));
          if (policyFiles.length === 0) { finish(null, false, "No Policy & Procedure files found in the linked folder."); return; }

          const MAX_PART_CHARS = 24_000;
          const docParts: string[] = [];
          const chunkFileNames: Record<string, string> = {};
          let chunkCounter = 0;
          // Files whose Drive read ERRORED (network/permission/timeout) — kept
          // separate from genuinely empty files so the run summary can say
          // "results may be incomplete" instead of silently assessing without them.
          const readFailedFiles: string[] = [];
          // Per-file read ledger, so the PPD Review tab can show the same
          // clickable/inspectable file list (extracted text via fileTextCache)
          // that the staged audit shows. Metadata only — no text stored here.
          const ppdFileKind = (mime: string) =>
            mime === "application/pdf" ? "PDF"
              : mime.includes("wordprocessingml") ? "Word"
              : mime.includes("google-apps.document") ? "Google Doc"
              : mime.includes("google-apps.spreadsheet") ? "Google Sheet"
              : mime === XLSX_MIME || mime === XLS_MIME ? "Excel"
              : mime === "text/csv" ? "CSV"
              : mime.includes("presentationml") ? "PowerPoint"
              : mime.includes("google-apps.presentation") ? "Google Slides"
              : mime.startsWith("image/") ? "image"
              : "text";
          // Every policy file in scope, built upfront (all "found"/pending) so
          // the live view shows the whole file set immediately and updates each
          // record's readStatus live — same pattern as runEvidenceAssessment's
          // fileRecords, reusing the identical AuditFileRecord/FileLedger
          // vocabulary so the PPD and Evidence tabs' live file lists match.
          const fileRecords: AuditFileRecord[] = policyFiles.map((file) => ({
            path: file.path, name: file.path.split("/").pop() || file.path, mimeType: file.mimeType, fileKind: ppdFileKind(file.mimeType),
            bucket: "policy", readStatus: "found", auditStatus: "pending",
            driveFileId: file.id, driveModifiedTime: file.modifiedTime,
          }));
          patchPpd({ filesTotal: policyFiles.length, filesFound: [...fileRecords], stage: "reading" });
          // Vision context so this loop reads scanned/image-only PDFs, standalone
          // images and Office-embedded pictures — the same three-tier capability
          // the staged/full-audit paths already have (readDriveFileWithVision).
          const ppdReadAi = useAISettingsStore.getState();
          const ppdVisionCtx: VisionReadCtx = {
            canDescribeImages: ppdReadAi.enabled && !!ppdReadAi.apiKey,
            visionSettings: effectiveSettings(ppdReadAi, { purpose: "vision", context: composeSchoolContext(get().schoolContext) }),
            visionModelId: effectiveSettings(ppdReadAi, { purpose: "vision" }).model,
            budget: { count: 0, max: 10 },
            maxPerFile: 5,
          };
          for (let fi = 0; fi < policyFiles.length; fi++) {
            const file = policyFiles[fi];
            const readFileName = file.path.split("/").pop() || file.path;
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
            patchPpd({ currentFile: readFileName, detail: `Reading ${readFileName}…`, filesFound: [...fileRecords], canSkipCurrentFile: true });
            const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
            const cached = get().fileTextCache[cacheKey];
            // Same processingMode bookkeeping runEvidenceAssessment/auditFolderContents/
            // auditFolderStaged already do — feeds FileLedger's "♻ Cached" badge and
            // AIReview's cached/fresh summary. Previously this loop looked up `cached`
            // but never recorded it on the record, so the PPD tab's ledger could never
            // show a cache hit even when one genuinely occurred.
            const processingMode: "new" | "reused" = cached ? "reused" : "new";
            let body: string | null;
            let readErrored = false;
            let readMethodUsed: "text" | "vision" = cached?.readMethod ?? "text";
            let skipNote: string | undefined;
            let readErrorMsg = "";
            // Manual per-file skip (2026-07-20): mirror runEvidenceAssessment's
            // race so the Drafting overlay's per-file Skip works during the PPD
            // read too (previously only the Evidence read supported it). The
            // abandoned read runs on to its own DRIVE_FILE_TIMEOUT_MS in the
            // background (harmless — nothing awaits it once skipped), so this
            // stays display/control-layer only.
            const FILE_SKIPPED = Symbol("file-skipped");
            const FILE_TIMED_OUT = Symbol("file-timed-out");
            let resolveSkip!: () => void;
            const skipSignal = new Promise<typeof FILE_SKIPPED>((resolve) => { resolveSkip = () => resolve(FILE_SKIPPED); });
            // Hard ceiling raced with the read — same reasoning as
            // runEvidenceAssessment's copy (pdfjs ignores the AbortSignal).
            let hardCapTimer: ReturnType<typeof setTimeout> | undefined;
            const hardCap = new Promise<typeof FILE_TIMED_OUT>((resolve) => { hardCapTimer = setTimeout(() => resolve(FILE_TIMED_OUT), DRIVE_FILE_HARD_CAP_MS); });
            if (cached) {
              body = cached.text;
            } else {
              // Refresh the Drive token per uncached read and HARD-STOP when it
              // can't be refreshed — see auditFolderContents.
              const readToken = await useGoogleDriveStore.getState().getFreshToken();
              if (!readToken) { clearTimeout(hardCapTimer); finish(null, false, DRIVE_EXPIRED_MID_RUN); return; }
              try {
                _currentFileAbort = resolveSkip;
                const raced = await Promise.race([
                  readDriveFileWithVision(file, readToken, timeoutSignal(runAbort.signal, DRIVE_FILE_TIMEOUT_MS), ppdVisionCtx),
                  skipSignal,
                  hardCap,
                ]);
                _currentFileAbort = null;
                if (raced === FILE_SKIPPED || raced === FILE_TIMED_OUT) {
                  body = null;
                  skipNote = raced === FILE_SKIPPED ? "Skipped by user" : `Read hung and was auto-skipped after ${Math.round(DRIVE_FILE_HARD_CAP_MS / 60_000)} minutes (the file may be corrupt or too complex to parse) — not assessed.`;
                } else {
                  body = raced.text;
                  readMethodUsed = raced.readMethod;
                  skipNote = raced.note;
                  // Only cache genuine (non-empty) extractions — caching `text: null`
                  // made a transient read failure stick until the Drive file's
                  // modifiedTime changed, with no way to retry; caching an empty
                  // string would lock in a blank read AND could clobber a good
                  // vision transcription cached under the same key.
                  if (body != null && body.trim().length > 0) {
                    const text = body;
                    set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: file.mimeType, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now(), readMethod: readMethodUsed } } }));
                  }
                }
              } catch (err) {
                _currentFileAbort = null;
                body = null;
                readErrored = true;
                readFailedFiles.push(file.path.split("/").pop() || file.path);
                readErrorMsg = err instanceof Error ? err.message : String(err);
              }
            }
            clearTimeout(hardCapTimer);
            const fileName = readFileName;
            if (!body) {
              fileRecords[fi] = { ...fileRecords[fi], readStatus: readErrored ? "failed" : "skipped", auditStatus: "pending", charCount: 0, readMethod: readMethodUsed, processingMode, ...(readErrored ? { failReason: "Drive read error" } : { skipReason: skipNote ?? "No extractable text" }) };
              patchPpd({ filesFound: [...fileRecords], ...(readErrored ? { lastIssue: { at: Date.now(), kind: "file-read-error" as const, message: `Failed to read ${fileName}: ${readErrorMsg}` } } : {}) });
              logPpd(readErrored ? `FAILED to read ${fileName} (Drive error: ${readErrorMsg})` : `Skipped ${fileName}${skipNote === "Skipped by user" ? " (by user)" : skipNote?.startsWith("Read hung") ? " (hung read auto-skipped)" : " (empty)"}`, readErrored ? "bad" : "warn");
              continue;
            }
            const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
            const fileChunkIds: string[] = [];
            for (let pi = 0; pi < totalParts; pi++) {
              const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
              docParts.push(`[CHUNK:${chunkId}] --- ${file.path}${partLabel} ---\n${chunkBody}`);
              chunkFileNames[chunkId] = fileName;
              fileChunkIds.push(chunkId);
            }
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", auditStatus: "audited", charCount: body.length, readMethod: readMethodUsed, processingMode, chunkIds: fileChunkIds };
            patchPpd({ filesFound: [...fileRecords] });
            logPpd(`Read ${fileName}${cached ? " (cached)" : ""}`, "good");
          }
          // Reading done — clear the "current file"/skip state so the overlay's
          // per-file ledger stops showing a live "Reading…"/Skip once the AI
          // phase begins (mirrors runEvidenceAssessment's reset).
          patchPpd({ currentFile: undefined, canSkipCurrentFile: false });
          if (docParts.length === 0) { finish(null, false, "No readable text could be extracted from the Policy & Procedure files."); return; }
          const policyDocText = docParts.join("\n\n=== POLICY & PROCEDURE ===\n\n");

          const aiSettings = useAISettingsStore.getState();
          if (!aiSettings.enabled || !aiSettings.apiKey) { finish(null, false, aiOfflineReason(aiSettings) ?? "AI is disabled or no API key is configured in Settings."); return; }
          const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });

          // Active "Line Status" calibration memories feed the PPD assessment as
          // LEARNED CORRECTIONS — the same selection the staged path uses, so a
          // thumbs-down on a PPD line teaches future runs (see PPDReview.tsx).
          const ppdMemories = selectLineStatusMemories(get().calibrationMemories);
          ppdMemories.forEach((m) => get().incrementMemoryUsage(m.id));

          const ppdLineRefs = requirements.map((r) => r.ref);
          patchPpd({
            detail: "Starting PPD requirements review…", stage: "assessing", currentFile: undefined,
            lineRefs: ppdLineRefs, lineStatus: Object.fromEntries(ppdLineRefs.map((r) => [r, "waiting" as const])),
          });
          logPpd(`Read ${policyFiles.length - readFailedFiles.length} file${policyFiles.length - readFailedFiles.length === 1 ? "" : "s"} — assessing ${ppdLineRefs.length} requirement line${ppdLineRefs.length === 1 ? "" : "s"}.`);
          const result = await runPPDRequirementsReview(requirements, policyDocText, analysisSettings, {
            criterionId: subCriterionId,
            memories: ppdMemories,
            ruleInjection: useRuleTuningStore.getState().championInjection(subCriterionId),
            onProgress: (detail) => patchPpd({ detail }),
            onEvent: (ev) => {
              if (ev.type === "window-start") {
                const ls = { ...(curPpd().lineStatus ?? {}) };
                for (const r of ev.refs) if (ls[r] !== "done") ls[r] = "assessing";
                // Resolve this window's chunk IDs back to source file names via
                // the SAME chunkFileNames map built during the read loop above,
                // so the live view shows which specific file(s) the in-flight
                // call is using, not just which lines.
                const files = [...new Set(ev.chunkIds.map((c) => chunkFileNames[c]).filter((n): n is string => !!n))];
                patchPpd({ window: ev.window, lineStatus: ls, currentWindowFiles: files });
                logPpd(`Assessing window ${ev.window.current}/${ev.window.total} (${ev.refs.length} line${ev.refs.length === 1 ? "" : "s"})…`);
              } else if (ev.type === "batch-done") {
                const cur = curPpd();
                const ls = { ...(cur.lineStatus ?? {}) };
                const lv = { ...(cur.lineVerdict ?? {}) };
                for (const v of ev.verdicts) { ls[v.ref] = "done"; lv[v.ref] = ppdVerdictLabel(v.verdict); }
                patchPpd({ lineStatus: ls, lineVerdict: lv });
                for (const v of ev.verdicts) logPpd(`Assessed ${v.ref} → ${ppdVerdictLabel(v.verdict)}`, v.verdict === "Adequate" ? "good" : v.verdict === "Not documented" ? "bad" : "warn");
              } else if (ev.type === "batch-failed") {
                logPpd(`Batch failed for ${ev.refs.join(", ")} — will retry in a later window: ${ev.error}`, "bad");
                patchPpd({ lastIssue: { at: Date.now(), kind: "call-error", message: ev.error } });
              }
            },
            // Cancel support: cancelBusy() clears busy and aborts the signal.
            shouldStop: () => get().busy !== "ppdreview" + subCriterionId,
            signal: runAbort.signal,
            // Per-AI-call skip (Item 2b): register each in-flight extract call
            // so skipCurrentAiCall() can abandon just that call and continue.
            onCallAbort: (fn) => { _currentAiCallAbort = fn; },
          });
          // Surface window errors / early stop instead of logging a clean
          // success — a revoked key mid-run used to yield all-"Not documented"
          // rows recorded as a successful review.
          const runWarnings: string[] = [
            ...(result.windowErrors ?? []),
            ...(result.stoppedEarly ? ["Run stopped before every requirement line was reviewed — unreviewed lines are marked Not assessed."] : []),
            ...(readFailedFiles.length ? [`${readFailedFiles.length} of ${policyFiles.length} Policy file(s) could not be read (Drive errors) and were NOT assessed: ${readFailedFiles.slice(0, 5).join(", ")}${readFailedFiles.length > 5 ? ", …" : ""}. Results may be incomplete — fix access and re-run.`] : []),
          ];
          const liveError = result.windowErrors?.length
            ? `${result.windowErrors.length} AI call(s) failed during the review — results may be incomplete. First error: ${result.windowErrors[0]}`
            : undefined;
          finish(result.rows, true, liveError, result.promptSent, result.usage, chunkFileNames, result.overallNarrative, runWarnings.length > 0 ? runWarnings : undefined, result.contradictions, fileRecords);
        } catch (err) {
          finish(null, false, err instanceof Error ? err.message : String(err));
        } finally {
          // Same class of race as checkFolderAccess (2026-07-19): this result
          // persists via the shared 600ms-debounced Supabase write, and the
          // beforeunload flush is fire-and-forget. A user who navigates away
          // or refreshes right after a run completes can lose the PPD review
          // result before Supabase ever receives it — a second device then
          // sees this sub-criterion's Evidence Folder Progress row as blank
          // even though the run genuinely completed. Force the pending write
          // durable on every exit path (success, early return, or error).
          await flushPendingSaves();
        }
      },

      // Reuse path: builds the Evidence tab from the Evidence Folder staged
      // audit's already-stored per-checklist-line results (no AI calls),
      // matched to each PPD requirement line by GD4 ref. Returns true when at
      // least one audited line was found and stored.
      deriveEvidenceAssessmentFromAudit: (subCriterionId) => {
        const s = get();
        const ppd = s.ppdReviewResults[subCriterionId];
        if (!ppd || ppd.rows.length === 0 || ppd.rows.some((r) => !r.ref)) return false;
        const folder = s.folders.find((f) => folderScopeId(f) === subCriterionId);

        const entries = useChecklistModuleStore.getState().entries;
        // Index every audited (has a runId-tagged evidence item) checklist line
        // by its sourceRef, normalized with the SAME normalizeAuditRef the
        // staged audit uses — a weaker normalizer here previously let refs
        // that matched in the staged audit (e.g. "DS: 6.1.1.DS1.a") miss in
        // this derive, falsely marking assessed lines as unmatched.
        const lineByRef = new Map<string, { status: SpecificLineStatus; apsr?: ApsrBreakdown; note?: string }>();
        for (const req of GD4_REQUIREMENTS.filter((r) => itemIdsForScope(subCriterionId).includes(r.id))) {
          const entry = entries[req.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            if (!line.sourceRef) continue;
            const auditEv = [...line.evidence].reverse().find((ev) => ev.runId);
            if (!auditEv) continue;
            lineByRef.set(normalizeAuditRef(line.sourceRef), { status: line.status, apsr: auditEv.apsr, note: auditEv.auditorNote });
          }
        }
        if (lineByRef.size === 0) return false;

        const statusToVerdict = (st: SpecificLineStatus): EvidenceVerdict | null =>
          st === "Met" ? "Met" : st === "Partial" ? "Partial" : st === "Not met" ? "Not met" : null;

        const folderUrl = folder?.folderLink || folder?.policyLink || "";
        let matched = 0;
        const rows: EvidenceAssessmentRow[] = ppd.rows.map((p) => {
          const hit = lineByRef.get(normalizeAuditRef(p.ref));
          const rawVerdict = hit ? statusToVerdict(hit.status) : null;
          if (hit && rawVerdict) {
            matched++;
            const apsr = hit.apsr;
            const chunkIds = apsr
              ? [...new Set([...(apsr.approach.sourceChunkIds ?? []), ...(apsr.processes.sourceChunkIds ?? []), ...(apsr.systemsOutcomes.sourceChunkIds ?? []), ...(apsr.review.sourceChunkIds ?? [])])]
              : [];
            let comment = apsr ? apsrAuditNote(apsr) : (hit.note || "");
            const evidenceSummary = apsr ? (apsr.processes.note || apsr.systemsOutcomes.note || "Assessed by the Evidence Folder staged audit.") : (hit.note || "Assessed by the Evidence Folder staged audit.");
            // PPD hard-gate — same rule as the fresh AI path (runEvidenceAssessment
            // caps at agentRuntime's APSR Approach gate): a line whose PPD verdict
            // is not "Adequate" can never show "Met" here, or the Evidence tab
            // would contradict the PPD tab for the same ref.
            let verdict = rawVerdict;
            if (verdict === "Met" && p.verdict !== "Adequate") {
              verdict = "Partial";
              comment = `${comment ? `${comment}\n\n` : ""}[Capped at Partial: the PPD verdict for this line is "${p.verdict}" — under the APSR Approach hard-gate a line cannot be Met until the documented approach is Adequate, regardless of implementation evidence.]`;
            }
            return {
              gdRef: p.ref, gd4ItemId: p.gd4ItemId, requirementText: p.requirementText,
              ppdExtract: p.fullComment || p.shortComment || "", ppdVerdict: p.verdict,
              evidenceSummary,
              evidenceFiles: folderUrl ? [{ name: "Actual Evidence folder", url: folderUrl }] : [],
              evidenceChunkIds: chunkIds,
              verdict, comment,
            };
          }
          // Line not covered by the staged audit — "Not assessed", a neutral
          // state excluded from the findings compile. Defaulting this to
          // "Not met" previously compiled false NC findings for requirement
          // lines that were never actually assessed.
          return {
            gdRef: p.ref, gd4ItemId: p.gd4ItemId, requirementText: p.requirementText,
            ppdExtract: p.fullComment || p.shortComment || "", ppdVerdict: p.verdict,
            evidenceSummary: "Not covered by the Evidence Folder staged audit.",
            evidenceFiles: [], evidenceChunkIds: [],
            verdict: "Not assessed", comment: "No audit result matched this line — run or re-run the evidence assessment.",
          };
        });
        if (matched === 0) return false;

        set((st) => {
          const prev = st.evidenceAssessments[subCriterionId];
          return {
            evidenceAssessments: {
              ...st.evidenceAssessments,
              [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live: true, derivedFromAudit: true },
            },
            evidenceAssessmentHistory: prev
              ? { ...st.evidenceAssessmentHistory, [subCriterionId]: [prev, ...(st.evidenceAssessmentHistory[subCriterionId] ?? [])].slice(0, OPTION_A_RUN_HISTORY_CAP) }
              : st.evidenceAssessmentHistory,
          };
        });
        return true;
      },

      // Fresh path (only needed when no staged-audit result exists). Reuses the
      // already-decided PPD verdict per requirement line (no policy re-read),
      // reads the Actual Evidence folder, and produces a combined verdict per
      // line, with live progress and per-line failure isolation.
      runEvidenceAssessment: async (subCriterionId, retryRefs) => {
        const s = get();
        const folder = s.folders.find((f) => folderScopeId(f) === subCriterionId);
        if (!folder) return;
        // See runPPDReview: no run without a named auditor.
        const auditorGate = checkAuditorForRun(s.auditors, s.activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        const ppd = s.ppdReviewResults[subCriterionId];
        // Scoped retry: assess ONLY these refs; every other ref's stored row is
        // carried through untouched (see the rows-merge below) — never silently
        // overwritten by a run it wasn't part of.
        const isRetry = !!retryRefs && retryRefs.length > 0;
        const retrySet = new Set(retryRefs ?? []);
        const priorRowsByRef = new Map((s.evidenceAssessments[subCriterionId]?.rows ?? []).map((r) => [r.gdRef, r]));
        set({ busy: "evidenceassess" + subCriterionId, auditBlockedReason: null });
        const runId = `EV-${subCriterionId}-${Date.now().toString(36).toUpperCase()}`;
        // Run-level abort — cancelBusy() kills the in-flight AI call.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;

        const finish = (rows: EvidenceAssessmentRow[] | null, live: boolean, liveError: string | undefined, promptSent?: string, usage?: AIUsage, chunkFileNames?: Record<string, string>, coverageNote?: string, fileLedger?: AuditFileRecord[]) => {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          const notAssessedCount = rows ? rows.filter((r) => r.verdict === "Not assessed").length : 0;
          const summary = rows
            ? `Evidence assessment${notAssessedCount > 0 ? " (PARTIAL)" : ""}: ${rows.filter((r) => r.verdict === "Met").length} Met, ${rows.filter((r) => r.verdict === "Partial").length} Partial, ${rows.filter((r) => r.verdict === "Not met").length} Not met${notAssessedCount > 0 ? `, ${notAssessedCount} Not assessed` : ""} (assessed ${rows.length - notAssessedCount} of ${rows.length} lines).${coverageNote ? `\n⚠ ${coverageNote}` : ""}`
            : `Evidence assessment failed${liveError ? `: ${liveError}` : "."}`;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Evidence Assessor",
            reviewType: "Evidence",
            subjectId: subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Review each Partial/Not met line, then compile findings straight from the Evidence tab.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          };
          set((st) => {
            const prev = rows ? st.evidenceAssessments[subCriterionId] : undefined;
            return {
              evidenceAssessments: rows
                ? { ...st.evidenceAssessments, [subCriterionId]: { subCriterionId, rows, runAt: new Date().toISOString(), live, promptSent, chunkFileNames, derivedFromAudit: false, runId, fileLedger, effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()), model: usage?.model } }
                : st.evidenceAssessments,
              evidenceAssessmentHistory: prev
                ? { ...st.evidenceAssessmentHistory, [subCriterionId]: [prev, ...(st.evidenceAssessmentHistory[subCriterionId] ?? [])].slice(0, OPTION_A_RUN_HISTORY_CAP) }
                : st.evidenceAssessmentHistory,
              aiReviewLog: [log, ...st.aiReviewLog].slice(0, 500),
              // Guarded — see runPPDReview's finish.
              busy: st.busy === "evidenceassess" + subCriterionId ? null : st.busy,
              evidenceAssessmentProgress: st.evidenceAssessmentProgress?.subCriterionId === subCriterionId ? null : st.evidenceAssessmentProgress,
              // Mid-run Drive expiry — see runPPDReview's finish.
              ...(liveError === DRIVE_EXPIRED_MID_RUN ? { driveBlockedReason: { reason: "not-connected" as const, message: DRIVE_EXPIRED_MID_RUN, canConnect: true, subCriterionId } } : {}),
            };
          });
          // Write the verdicts into the Sub-Criterion Checklist — the same
          // store Option B's staged audit writes to — so Option A results
          // persist across reloads/versions and feed buildScored/computeBand
          // identically. Idempotent: lines are matched by normalized ref and
          // updated; prior Option A/audit evidence (runId items) is replaced.
          // Mode gating: full-auto AND hybrid commit immediately (the per-line
          // gate was removed for this path — see partitionOptionAWrites); only
          // full-auto also auto-compiles findings, hybrid leaves that to the
          // human's Compile click. Manual commits nothing (results stay on the
          // PPD page as suggestions only).
          if (rows) {
            try {
              const activeMode: AuditMode = get().auditMode;
              const checklist = useChecklistModuleStore.getState();
              const linesByItem = Object.fromEntries(
                Object.entries(checklist.entries).map(([itemId, e]) => [itemId, e.specific.map((l) => ({ id: l.id, sourceRef: l.sourceRef, clause: l.clause }))])
              );
              const writes = buildOptionALineWrites(rows, linesByItem, ppd?.rows ?? [], {
                runId,
                folderName: folder.folderName,
                drive: folder.folderLink || folder.policyLink,
                owner: folder.owner,
              });
              const { commit } = partitionOptionAWrites(activeMode, writes);
              if (commit.length > 0) {
                checklist.applyOptionAWrites(commit);
                // This freshly-committed run supersedes any still-queued older
                // run for the same sub-criterion (legacy pre-gate-removal
                // queue, or an Option B queue for this sub-criterion is left
                // alone — only path "A" entries are stale duplicates of what
                // was just committed). Without this, a later "Accept all" on
                // the legacy queue would REGRESS the checklist to older data.
                set((st) => {
                  const prev = st.pendingCommits[subCriterionId];
                  if (!prev || prev.path !== "A") return {};
                  const { [subCriterionId]: _superseded, ...rest } = st.pendingCommits;
                  return { pendingCommits: rest };
                });
              }
              if (activeMode === "full-auto") {
                // Full auto carries straight on to findings (existing deduped
                // compile) — no stops.
                get().compileEvidenceFindings(subCriterionId);
              }
            } catch (err) {
              console.error("[EvidenceAssessment] checklist write-back failed", err instanceof Error ? err.message : String(err));
            }
          }
        };
        // Merge-based progress updaters so the detailed live-activity fields
        // (stage, window, per-line status, files, log, AI usage) survive every
        // update — a plain replace would wipe them on each pct tick.
        const EV_LOG_CAP = 60;
        const curEv = (): EvidenceAssessmentProgress => {
          const p = get().evidenceAssessmentProgress;
          return p && p.subCriterionId === subCriterionId ? p : { subCriterionId, pct: 0, detail: "" };
        };
        const patchEv = (patch: Partial<EvidenceAssessmentProgress>) =>
          set({ evidenceAssessmentProgress: { ...curEv(), ...patch, subCriterionId, heartbeatAt: Date.now() } });
        const logEv = (text: string, tone?: "info" | "good" | "warn" | "bad") =>
          patchEv({ log: [...(curEv().log ?? []), { at: Date.now(), text, tone }].slice(-EV_LOG_CAP) });
        const setEvProgress = (detail: string, pct: number) => patchEv({ detail, pct });

        try {
          if (!ppd || ppd.rows.length === 0) { finish(null, false, "Run the PPD review first — the Evidence tab reuses its per-line verdicts."); return; }

          const evidenceId = parseFolderId(folder.folderLink) || parseFolderId(folder.policyLink);
          // getFreshToken (not getValidToken) — see runPPDReview's identical
          // comment: refreshes a near-/already-expired token before the
          // listing call that follows, instead of only refreshing per file.
          const token = await useGoogleDriveStore.getState().getFreshToken();
          const drive = checkDriveForRun(!!evidenceId, !!token);
          if (drive) { set({ driveBlockedReason: { ...drive, subCriterionId } }); finish(null, false, drive.message); return; }
          set({ driveBlockedReason: null });
          if (!token || !evidenceId) { finish(null, false, DRIVE_EXPIRED_MID_RUN); return; } // should be unreachable past the guard; never strand busy

          // On a retry, only the retried lines are in scope for the AI call and
          // the live progress view — every other line's row is carried through
          // untouched from the stored result (see the rows-merge below).
          const targetPpdRows = isRetry ? ppd.rows.filter((r) => retrySet.has(r.ref)) : ppd.rows;
          const lineRefs = targetPpdRows.map((r) => r.ref);
          patchEv({
            stage: "reading", startedAt: Date.now(), pct: 3,
            detail: isRetry ? `Retrying ${lineRefs.length} line${lineRefs.length === 1 ? "" : "s"} — reading the Actual Evidence folder…` : "Reading the Actual Evidence folder…",
            lineRefs, lineStatus: Object.fromEntries(lineRefs.map((r) => [r, "waiting" as const])),
            lineVerdict: {}, filesRead: [], log: [], ai: { calls: 0, totalTokens: 0 },
          });
          logEv(isRetry ? `Retrying ${lineRefs.length} line${lineRefs.length === 1 ? "" : "s"}: ${lineRefs.join(", ")} — the complete evidence file set is re-read/re-sent, not a subset.` : "Listing the Actual Evidence folder…");
          const allFiles = await listFolderFilesRecursive(evidenceId, token, "", 0, timeoutSignal(runAbort.signal, DRIVE_LIST_TIMEOUT_MS));
          // Dedicated evidence folder -> all files are evidence; shared
          // single-folder convention -> keep only the "Actual Evidence" bucket.
          const evidenceFiles = parseFolderId(folder.folderLink)
            ? allFiles
            : allFiles.filter((f) => classifyFileBucket(f.path) === "evidence");
          // Live recount at run time (Item 4, 2026-07-19): refresh the stored
          // evidence file count from THIS run's listing.
          set((st) => ({ folders: st.folders.map((f) => f.id === folder.id ? { ...f, evidenceFileCount: evidenceFiles.length, fileCountAt: new Date().toISOString() } : f) }));

          const MAX_PART_CHARS = 24_000;
          const docParts: string[] = [];
          const chunkFileNames: Record<string, string> = {};
          const chunkFileRefs: Record<string, EvidenceFileRef> = {};
          let chunkCounter = 0;
          const fileKindOf = (mime: string) =>
            mime === "application/pdf" ? "PDF" : mime.includes("wordprocessingml") ? "Word" : mime.includes("google-apps.document") ? "Google Doc"
            : mime.includes("google-apps.spreadsheet") ? "Google Sheet" : mime === XLSX_MIME ? "Excel" : mime === XLS_MIME ? "Excel"
            : mime === "text/csv" ? "CSV" : mime.includes("presentationml") ? "PowerPoint" : mime.includes("google-apps.presentation") ? "Google Slides"
            : mime.startsWith("image/") ? "image" : "text";
          // Every file in scope, built upfront (all "found"/pending) so the live
          // view — reusing the same FileLedger/AuditFileRecord vocabulary the
          // staged/full-audit paths already have — shows the whole file set
          // immediately rather than growing one row at a time. Also doubles as
          // this run's fileLedger (evidenceAssessments[subCriterionId].fileLedger).
          const fileRecords: AuditFileRecord[] = evidenceFiles.map((file) => ({
            path: file.path, name: file.path.split("/").pop() || file.path, mimeType: file.mimeType, fileKind: fileKindOf(file.mimeType),
            bucket: "evidence", readStatus: "found", auditStatus: "pending",
            driveFileId: file.id, driveModifiedTime: file.modifiedTime,
            chunkIds: [],
          }));
          patchEv({ filesTotal: evidenceFiles.length, filesFound: [...fileRecords] });
          let filesReadCount = 0;
          // Drive read ERRORS, kept separate from genuinely empty files, so the
          // run summary can flag incompleteness — see runPPDReview.
          const readFailedFiles: string[] = [];
          // Vision context so this loop reads scanned/image-only PDFs, standalone
          // images and Office-embedded pictures — the same three-tier capability
          // the staged/full-audit paths already have (readDriveFileWithVision).
          const evReadAi = useAISettingsStore.getState();
          const evVisionCtx: VisionReadCtx = {
            canDescribeImages: evReadAi.enabled && !!evReadAi.apiKey,
            visionSettings: effectiveSettings(evReadAi, { purpose: "vision", context: composeSchoolContext(get().schoolContext) }),
            visionModelId: effectiveSettings(evReadAi, { purpose: "vision" }).model,
            budget: { count: 0, max: 10 },
            maxPerFile: 5,
          };
          // Reads evidenceFiles[fi] and records the result into fileRecords /
          // docParts / chunk maps — the SAME logic whether this is the file's
          // first attempt or a Task 1a retry after the budget was raised (see
          // the bulk prompt below). Returns true when this attempt was
          // skipped SPECIFICALLY because the run's vision budget ran out, so
          // the caller can collect it for that one bulk prompt.
          const readAndRecordFile = async (fi: number): Promise<boolean> => {
            const file = evidenceFiles[fi];
            const readFileName = file.path.split("/").pop() || file.path;
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
            patchEv({ currentFile: readFileName, detail: `Reading ${readFileName}…`, pct: Math.min(24, 4 + Math.round((filesReadCount / Math.max(1, evidenceFiles.length)) * 20)), filesFound: [...fileRecords], canSkipCurrentFile: true });
            const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
            const cached = get().fileTextCache[cacheKey];
            const processingMode = cached ? "reused" : "new";
            let body: string | null;
            let readMethod: "text" | "vision" | undefined;
            let pdfQuality: { suspectedScannedPdf: boolean; extractedTextQuality: "none" | "low" | "medium" | "high" } | undefined;
            let skipNote: string | undefined;
            let readErrorMsg = "";
            let budgetBlocked = false;
            // Manual skip: races the real read against a never-resolving promise
            // that ONLY settles when the user clicks Skip (skipCurrentFile()),
            // mirroring the exact pattern used for the mid-run token-refresh
            // wait in runPPDReview/runEvidenceAssessment — the abandoned read
            // keeps running to its own DRIVE_FILE_TIMEOUT_MS in the background
            // (harmless: nothing awaits it once skipped) rather than being
            // forcibly aborted, so this stays display/control-layer only.
            const FILE_SKIPPED = Symbol("file-skipped");
            const FILE_TIMED_OUT = Symbol("file-timed-out");
            let resolveSkip!: () => void;
            const skipSignal = new Promise<typeof FILE_SKIPPED>((resolve) => { resolveSkip = () => resolve(FILE_SKIPPED); });
            // Hard ceiling raced with the read: pdfjs ignores the AbortSignal,
            // so DRIVE_FILE_TIMEOUT_MS alone can't stop a hung parse/render —
            // see DRIVE_FILE_HARD_CAP_MS.
            let hardCapTimer: ReturnType<typeof setTimeout> | undefined;
            const hardCap = new Promise<typeof FILE_TIMED_OUT>((resolve) => { hardCapTimer = setTimeout(() => resolve(FILE_TIMED_OUT), DRIVE_FILE_HARD_CAP_MS); });
            if (cached) {
              body = cached.text;
              readMethod = cached.readMethod;
              if (cached.pdfQuality) pdfQuality = cached.pdfQuality;
            } else {
              // Refresh the Drive token per uncached read and HARD-STOP when it
              // can't be refreshed — see auditFolderContents.
              _currentFileAbort = resolveSkip;
              const readToken = await useGoogleDriveStore.getState().getFreshToken();
              _currentFileAbort = null;
              if (!readToken) { clearTimeout(hardCapTimer); finish(null, false, DRIVE_EXPIRED_MID_RUN); return false; }
              try {
                _currentFileAbort = resolveSkip;
                const raced = await Promise.race([
                  readDriveFileWithVision(file, readToken, timeoutSignal(runAbort.signal, DRIVE_FILE_TIMEOUT_MS), evVisionCtx),
                  skipSignal,
                  hardCap,
                ]);
                _currentFileAbort = null;
                if (raced === FILE_SKIPPED || raced === FILE_TIMED_OUT) {
                  body = null;
                  skipNote = raced === FILE_SKIPPED ? "Skipped by user" : `Read hung and was auto-skipped after ${Math.round(DRIVE_FILE_HARD_CAP_MS / 60_000)} minutes (the file may be corrupt or too complex to parse) — not assessed.`;
                } else {
                  body = raced.text;
                  readMethod = raced.readMethod;
                  budgetBlocked = !!raced.budgetBlocked;
                  if (raced.pdfQuality) pdfQuality = raced.pdfQuality;
                  if (raced.note) skipNote = raced.note;
                  // Only cache genuine (non-empty) extractions — see runPPDReview.
                  if (body != null && body.trim().length > 0) {
                    const text = body;
                    set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: file.mimeType, fileName: readFileName, filePath: file.path, cachedAt: Date.now(), readMethod: raced.readMethod, ...(raced.pdfQuality ? { pdfQuality: raced.pdfQuality } : {}) } } }));
                  }
                }
              } catch (err) {
                _currentFileAbort = null;
                body = null;
                readFailedFiles.push(readFileName);
                readErrorMsg = err instanceof Error ? err.message : String(err);
              }
            }
            clearTimeout(hardCapTimer);
            if (!body) {
              const failed = readFailedFiles.includes(readFileName);
              fileRecords[fi] = {
                ...fileRecords[fi], readStatus: failed ? "failed" : "skipped", charCount: 0, processingMode,
                ...(readMethod ? { readMethod } : {}), ...(pdfQuality ?? {}),
                ...(failed ? { failReason: "Drive read error — file not assessed." } : { skipReason: skipNote ?? "No extractable text (empty or unreadable)." }),
              };
              patchEv({ filesFound: [...fileRecords], ...(failed ? { lastIssue: { at: Date.now(), kind: "file-read-error" as const, message: `Failed to read ${readFileName}: ${readErrorMsg}` } } : {}) });
              logEv(failed ? `FAILED to read ${readFileName} (Drive error: ${readErrorMsg}) — not assessed` : `Skipped ${readFileName}${skipNote === "Skipped by user" ? " (by user)" : skipNote?.startsWith("Read hung") ? " (hung read auto-skipped)" : budgetBlocked ? " (vision budget)" : " (empty)"}`, failed ? "bad" : "warn");
              return budgetBlocked;
            }
            filesReadCount++;
            patchEv({ filesRead: [...(curEv().filesRead ?? []), { name: readFileName, driveFileId: file.id }], currentFile: undefined, canSkipCurrentFile: false });
            logEv(`Read ${readFileName}${cached ? " (cached)" : ""}`, "good");
            const fileName = readFileName;
            const fileUrl = `https://drive.google.com/file/d/${file.id}/view`;
            const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
            const chunkIds: string[] = [];
            for (let pi = 0; pi < totalParts; pi++) {
              const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
              docParts.push(`[CHUNK:${chunkId}] --- ${file.path}${partLabel} ---\n${chunkBody}`);
              chunkFileNames[chunkId] = fileName;
              chunkFileRefs[chunkId] = { name: fileName, url: fileUrl };
              chunkIds.push(chunkId);
            }
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: body.length, processingMode, ...(readMethod ? { readMethod } : {}), ...(pdfQuality ?? {}), chunkIds };
            patchEv({ filesFound: [...fileRecords] });
            return false;
          };
          // Task 1a: read every file first, collecting any that were skipped
          // because the run's vision budget ran out — a false "no evidence"
          // risk if left silent. Bulk, not per-file: ask ONCE after the whole
          // pass, not on the first file that hits the cap.
          const budgetBlockedIdx: number[] = [];
          for (let fi = 0; fi < evidenceFiles.length; fi++) {
            if (await readAndRecordFile(fi)) budgetBlockedIdx.push(fi);
          }
          if (budgetBlockedIdx.length > 0) {
            // The overlay must not keep claiming "Reading X…" while the run is
            // actually paused on the (app-wide) vision-budget modal.
            patchEv({ detail: `Waiting for your decision on ${budgetBlockedIdx.length} unread scanned file${budgetBlockedIdx.length === 1 ? "" : "s"} (see the "Vision image budget reached" prompt)…`, currentFile: undefined, canSkipCurrentFile: false });
            const estimatedExtraImages = budgetBlockedIdx.length * evVisionCtx.maxPerFile;
            const rate = aiRateFor(evVisionCtx.visionModelId);
            // ~1000 tokens/image is a rough, documented estimate (OpenAI vision
            // billing varies by image size/detail level) — good enough for a
            // ballpark "should I proceed" figure, not a promise of exact spend.
            const estimatedCostUSD = (estimatedExtraImages * 1000 * rate.in) / 1e6;
            const choice = await new Promise<"proceed" | "skip">((resolve) => {
              _pendingVisionBudgetResolve = resolve;
              set({
                visionBudgetPrompt: {
                  subCriterionId, budgetMax: evVisionCtx.budget.max, estimatedExtraImages, estimatedCostUSD,
                  fileNames: budgetBlockedIdx.map((i) => evidenceFiles[i].path.split("/").pop() || evidenceFiles[i].path),
                },
              });
            });
            set({ visionBudgetPrompt: null });
            if (choice === "proceed") {
              // Cover every blocked file's own per-file cap — bounded, not an
              // arbitrary "unlimited" — then re-read exactly those files.
              evVisionCtx.budget.max = evVisionCtx.budget.count + estimatedExtraImages;
              for (const fi of budgetBlockedIdx) await readAndRecordFile(fi);
            }
          }
          // Per-file ledger for this Option A evidence run, in the same
          // AuditFileRecord shape the staged path uses so the CSVs line up.
          const fileLedger: AuditFileRecord[] = fileRecords;
          const evidenceDocText = docParts.join("\n\n=== ACTUAL EVIDENCE ===\n\n");
          logEv(`Read ${filesReadCount} file${filesReadCount === 1 ? "" : "s"} — assessing ${lineRefs.length} requirement line${lineRefs.length === 1 ? "" : "s"}.`);
          // detail is reset here too — without it the overlay's live line kept
          // showing the LAST "Reading <file>…" for the whole AI phase, which
          // read as "stuck on that file" whenever the phase was slow.
          patchEv({ stage: "assessing", detail: "Assessing evidence against each requirement line…", currentFile: undefined, canSkipCurrentFile: false });

          const aiSettings = useAISettingsStore.getState();
          if (!aiSettings.enabled || !aiSettings.apiKey) { finish(null, false, aiOfflineReason(aiSettings) ?? "AI is disabled or no API key is configured in Settings."); return; }
          const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });

          // Pre-check flags → AI context (Part 3 of the pre-check module): for
          // each GD4 item this run covers, re-run the pre-analysis checklist
          // over the files actually read (PPD's policy files + this run's
          // evidence files) and collect only the FLAGGED items — an auto
          // detection that returned "flag", or a manual item the user ticked
          // via the Pre-check step's checkbox (same key scheme as
          // PreCheckTab: `${subCriterionId}::${item.id}`). Clean/unticked
          // items are omitted so they add no prompt noise; flagged ones are
          // passed as advisory context only (see runEvidenceAssessment's
          // "Pre-check flags" prompt wording) — never a verdict override.
          const checklistData = usePreCheckChecklistStore.getState().checklists;
          const detectFiles: DetectFile[] = [...(ppd.fileLedger ?? []), ...fileLedger].map((rec) => {
            const cacheKey = rec.driveFileId ? Object.entries(get().fileTextCache).find(([k]) => k.startsWith(`${rec.driveFileId}:`))?.[1] : undefined;
            return { name: rec.name, path: rec.path, bucket: rec.bucket, driveFileId: rec.driveFileId, text: cacheKey?.text ?? null };
          });
          // Hands-off (Full Auto/Hybrid) runs have no human to tick the manual
          // checks, so auto-include the AI-answerable ones as advisory hints
          // (the human-only ones are disclosed as skipped below). Full Manual
          // still relies on the human ticking — same as before.
          const autoIncludeManual = get().auditMode !== "manual";
          const { flagsByItemId, skippedHumanOnly } = computeFlaggedPreCheckItems(
            checklistData, get().preAnalysisChecks, subCriterionId, ppd.rows.map((r) => r.gd4ItemId), detectFiles, autoIncludeManual
          );
          if (autoIncludeManual && skippedHumanOnly.length > 0) {
            logEv(`${skippedHumanOnly.length} pre-check item(s) need human judgement and were not auto-evaluated: ${skippedHumanOnly.join("; ")}.`, "warn");
          }

          const inputs: EvidenceAssessmentInput[] = targetPpdRows.map((r) => ({
            ref: r.ref,
            requirementText: r.requirementText,
            ppdVerdict: r.verdict,
            ppdExtract: r.fullComment || r.shortComment || "",
            // Technique 3: the promises the PPD review extracted become named
            // checks the evidence assessment must verify one by one.
            promises: r.promises,
            preCheckFlags: flagsByItemId[r.gd4ItemId],
          }));
          // Active "Line Status" calibration memories feed the evidence
          // assessment as LEARNED CORRECTIONS — same selection the staged path
          // uses, so a thumbs-down on an evidence line teaches future runs.
          const evMemories = selectLineStatusMemories(get().calibrationMemories);
          evMemories.forEach((m) => get().incrementMemoryUsage(m.id));
          const result = await runEvidenceAssessment(inputs, evidenceDocText, analysisSettings, {
            criterionId: subCriterionId,
            memories: evMemories,
            ruleInjection: useRuleTuningStore.getState().championInjection(subCriterionId),
            onProgress: (detail, pct) => setEvProgress(detail, typeof pct === "number" ? Math.max(25, Math.min(98, pct)) : 50),
            onEvent: (ev) => {
              if (ev.type === "window-start") {
                const ls = { ...(curEv().lineStatus ?? {}) };
                for (const r of ev.refs) if (ls[r] !== "done") ls[r] = "assessing";
                // Resolve this window's chunk IDs back to source file names via
                // the SAME chunkFileNames map built during the read loop above,
                // so the live view shows which specific file(s) the in-flight
                // call is using, not just which lines.
                const files = [...new Set(ev.chunkIds.map((c) => chunkFileNames[c]).filter((n): n is string => !!n))];
                patchEv({ stage: "assessing", window: ev.window, lineStatus: ls, currentWindowFiles: files });
                logEv(`Assessing lines ${ev.firstLine}–${ev.lastLine}${ev.window.total > 1 ? ` · window ${ev.window.current}/${ev.window.total}` : ""}…`);
              } else if (ev.type === "batch-done") {
                const cur = curEv();
                const ls = { ...(cur.lineStatus ?? {}) };
                const lv = { ...(cur.lineVerdict ?? {}) };
                for (const v of ev.verdicts) { ls[v.ref] = "done"; lv[v.ref] = evVerdictLabel(v.verdict); }
                // usage.totalTokens is CUMULATIVE across batches; count each call.
                const ai = ev.usage ? { calls: (cur.ai?.calls ?? 0) + 1, model: ev.usage.model, totalTokens: ev.usage.totalTokens } : cur.ai;
                patchEv({ lineStatus: ls, lineVerdict: lv, ai });
                for (const v of ev.verdicts) logEv(`Assessed ${v.ref} → ${evVerdictLabel(v.verdict)}`, v.verdict === "Met" ? "good" : v.verdict === "Not met" ? "bad" : "warn");
                if (ev.usage) logEv(`AI call done — ${ev.usage.model}, ${ev.usage.totalTokens.toLocaleString()} tokens so far`);
              } else if (ev.type === "batch-failed") {
                logEv(`Batch failed for ${ev.refs.join(", ")} — will retry in a later window: ${ev.error}`, "bad");
                patchEv({ lastIssue: { at: Date.now(), kind: "call-error", message: ev.error } });
              }
            },
            shouldStop: () => get().busy !== "evidenceassess" + subCriterionId,
            signal: runAbort.signal,
            // Per-AI-call skip (Item 2b) — see runPPDReview.
            onCallAbort: (fn) => { _currentAiCallAbort = fn; },
          });
          patchEv({ stage: "verifying", detail: "Verifying citations…", pct: 99 });
          logEv("Verifying quoted excerpts against the source documents…");

          // Merge AI line results with the reused PPD data + resolved file refs.
          const byRef = new Map(result.rows.map((r) => [r.ref, r]));
          const rows: EvidenceAssessmentRow[] = ppd.rows.map((p) => {
            // Scoped retry: a ref NOT in this retry carries its EXISTING stored
            // row through completely unchanged — it was never part of this
            // call, so it must never be silently overwritten by a fresh
            // (possibly blank) default. Only reachable when isRetry; a normal
            // full run always has retrySet empty and falls through below.
            if (isRetry && !retrySet.has(p.ref)) {
              const prior = priorRowsByRef.get(p.ref);
              if (prior) return prior;
            }
            const ev = byRef.get(p.ref);
            const chunkIds = ev?.chunkIds ?? [];
            // Dedupe file refs by name across the row's cited chunks.
            const seen = new Set<string>();
            const evidenceFilesForRow: EvidenceFileRef[] = [];
            for (const cid of chunkIds) {
              const ref = chunkFileRefs[cid];
              if (ref && !seen.has(ref.name)) { seen.add(ref.name); evidenceFilesForRow.push(ref); }
            }
            return {
              gdRef: p.ref,
              gd4ItemId: p.gd4ItemId,
              requirementText: p.requirementText,
              ppdExtract: p.fullComment || p.shortComment || "",
              ppdVerdict: p.verdict,
              evidenceSummary: ev?.evidenceSummary || "No implementation evidence found for this requirement.",
              evidenceFiles: evidenceFilesForRow,
              evidenceChunkIds: chunkIds,
              verdict: ev?.verdict ?? "Not met",
              comment: ev?.comment || "",
              assessmentFailed: ev?.failed,
              promiseChecks: ev?.promiseChecks,
              evidenceQuote: ev?.evidenceQuote,
              suggestedAction: ev?.suggestedAction,
            };
          });
          // Tag the ledger with citation status from the assessed rows: a file
          // whose chunk was cited by any line → "cited" (with the citing lines);
          // a read-but-uncited file → "not_used". Mirrors the staged path so the
          // two file-ledger CSVs report "cited" the same way.
          const chunkToLedgerIdx = new Map<string, number>();
          fileLedger.forEach((rec, i) => { for (const cid of rec.chunkIds ?? []) if (!chunkToLedgerIdx.has(cid)) chunkToLedgerIdx.set(cid, i); });
          for (const rec of fileLedger) { if (rec.readStatus === "read") rec.auditStatus = "not_used"; }
          for (const row of rows) {
            for (const cid of row.evidenceChunkIds) {
              const idx = chunkToLedgerIdx.get(cid);
              if (idx === undefined) continue;
              const rec = fileLedger[idx];
              rec.auditStatus = "cited";
              rec.citedByLineIds = [...new Set([...(rec.citedByLineIds || []), row.gdRef])];
            }
          }
          const coverageParts: string[] = [];
          if (readFailedFiles.length) coverageParts.push(`${readFailedFiles.length} of ${evidenceFiles.length} evidence file(s) could not be read (Drive errors) and were NOT assessed: ${readFailedFiles.slice(0, 5).join(", ")}${readFailedFiles.length > 5 ? ", …" : ""}. Results may be incomplete — fix access and re-run.`);
          // Honest disclosure: the human-judgement-only pre-check items a
          // hands-off run cannot auto-evaluate are named here (durable, shown in
          // the Run Log), not silently absent.
          if (autoIncludeManual && skippedHumanOnly.length) coverageParts.push(`${skippedHumanOnly.length} pre-check item(s) require human judgement and were not auto-evaluated in this hands-off run (review manually in Pre-check): ${skippedHumanOnly.join("; ")}.`);
          const coverageNote = coverageParts.length ? coverageParts.join(" ") : undefined;
          finish(rows, true, undefined, result.promptSent, result.usage, chunkFileNames, coverageNote, fileLedger);
        } catch (err) {
          finish(null, false, err instanceof Error ? err.message : String(err));
        } finally {
          // Same class of race as checkFolderAccess / runPPDReview: force the
          // pending Supabase write durable before a fast navigation/refresh
          // can lose this Evidence Folder Progress-row data on other devices.
          await flushPendingSaves();
        }
      },

      // On-demand Outcomes & Review pass — Option B's staged third pass run
      // in isolation for one sub-criterion, over the documents its Option A
      // runs already read. Requires live AI (the pass is a live judgement;
      // Option A has no offline mode either). Stores an ADVISORY result only:
      // the checklist is untouched until applyOutcomeReviewResult below.
      runOutcomeReviewPass: async (subCriterionId) => {
        const s = get();
        const aiSettings = useAISettingsStore.getState();
        const offline = aiOfflineReason(aiSettings);
        if (offline) { set({ auditBlockedReason: `The Outcomes & Review pass needs live AI. ${offline}` }); return; }
        const auditorGate = checkAuditorForRun(s.auditors, s.activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        const ppd = s.ppdReviewResults[subCriterionId];
        const ev = s.evidenceAssessments[subCriterionId];
        if (!ev) return; // the button only renders with an Option A result

        set({ busy: "outcomereview" + subCriterionId, auditBlockedReason: null, outcomeReviewProgress: { subCriterionId, detail: "Preparing documents…" } });
        const runId = `OR-${subCriterionId}-${Date.now().toString(36).toUpperCase()}`;
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;

        const finish = (result: OutcomeReviewPassResult | null, liveError?: string, promptSent?: string, usage?: AIUsage) => {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          const summary = result
            ? `Outcomes & Review pass: outcome data found on ${result.rows.filter((r) => r.outcomeEvident).length}, review records on ${result.rows.filter((r) => r.reviewEvident).length} of ${result.rows.length} audit points.${result.runWarnings?.length ? `\n⚠ ${result.runWarnings.join("; ")}` : ""}`
            : `Outcomes & Review pass failed${liveError ? `: ${liveError}` : "."}`;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Outcomes & Review Assessor",
            reviewType: "Evidence",
            subjectId: subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Review the per-point results, then click 'Apply to checklist' to update the Systems & Outcomes and Review legs.",
            live: true,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          };
          set((st) => ({
            outcomeReviewResults: result ? { ...st.outcomeReviewResults, [subCriterionId]: result } : st.outcomeReviewResults,
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 500),
            busy: st.busy === "outcomereview" + subCriterionId ? null : st.busy,
            outcomeReviewProgress: st.outcomeReviewProgress?.subCriterionId === subCriterionId ? null : st.outcomeReviewProgress,
            ...(liveError && !result ? { auditBlockedReason: `Outcomes & Review pass failed: ${liveError}` } : {}),
          }));
        };

        try {
          const items = GD4_REQUIREMENTS.filter((r) => itemIdsForScope(subCriterionId).includes(r.id));
          const allAuditPoints = items.flatMap((r) => r.flatAuditPoints ?? []);
          if (allAuditPoints.length === 0) { finish(null, "No audit points are defined for this sub-criterion."); return; }

          // Combined policy + evidence text, rebuilt from the two Option A
          // runs' file ledgers via fileTextCache (cache-first; the cache is
          // session-only, so files missing after a reload are re-read from
          // Drive, text tier only — a vision-only file that can't be re-read
          // this way is reported in runWarnings, never silently dropped).
          const ledger: AuditFileRecord[] = [...(ppd?.fileLedger ?? []), ...(ev.fileLedger ?? [])];
          const seen = new Set<string>();
          const files: AuditFileRecord[] = [];
          for (const rec of ledger) {
            const key = rec.driveFileId || rec.path;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            files.push(rec);
          }
          if (files.length === 0) { finish(null, "The Option A results carry no file ledger — re-run the PPD Review and Evidence assessment first."); return; }

          const MAX_PART_CHARS = 24_000;
          const parts: string[] = [];
          const chunkFileNames: Record<string, string> = {};
          const missing: string[] = [];
          let chunkCounter = 0;
          let readToken: string | null | undefined; // fetched once, on first cache miss
          for (const rec of files) {
            if (runAbort.signal.aborted) { finish(null, "Run cancelled."); return; }
            let text: string | null = null;
            if (rec.driveFileId) {
              const exact = get().fileTextCache[`${rec.driveFileId}:${rec.driveModifiedTime ?? ""}`];
              const hit = exact ?? Object.entries(get().fileTextCache).find(([k]) => k.startsWith(`${rec.driveFileId}:`))?.[1];
              text = hit?.text ?? null;
            }
            if ((text == null || !text.trim()) && rec.driveFileId) {
              set({ outcomeReviewProgress: { subCriterionId, detail: `Re-reading ${rec.name}…` } });
              if (readToken === undefined) readToken = await useGoogleDriveStore.getState().getFreshToken();
              if (readToken) {
                try {
                  const r = await readDriveFileWithVision(
                    { id: rec.driveFileId, name: rec.name, mimeType: rec.mimeType, modifiedTime: rec.driveModifiedTime },
                    readToken,
                    timeoutSignal(runAbort.signal, DRIVE_FILE_TIMEOUT_MS),
                    // Text tier only: no vision budget for this lightweight
                    // fallback — an image/scanned file lands in `missing`
                    // and is reported, matching the honesty rule.
                    { canDescribeImages: false, visionSettings: effectiveSettings(aiSettings, { purpose: "vision" }), visionModelId: "", budget: { count: 0, max: 0 }, maxPerFile: 0 }
                  );
                  text = r.text;
                  if (text && text.trim()) {
                    const cached = text;
                    set((st) => ({ fileTextCache: { ...st.fileTextCache, [`${rec.driveFileId}:${rec.driveModifiedTime ?? ""}`]: { text: cached, charCount: cached.length, fileKind: rec.mimeType, fileName: rec.name, filePath: rec.path, cachedAt: Date.now(), readMethod: r.readMethod } } }));
                  }
                } catch { /* falls through to missing */ }
              }
            }
            if (text == null || !text.trim()) { missing.push(rec.name); continue; }
            const totalParts = Math.ceil(text.length / MAX_PART_CHARS) || 1;
            for (let pi = 0; pi < totalParts; pi++) {
              const chunkBody = text.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              chunkFileNames[chunkId] = rec.name;
              const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
              parts.push(`[CHUNK:${chunkId}] --- ${rec.path}${partLabel} [${rec.fileKind}] ---\n${chunkBody}`);
            }
          }
          if (parts.length === 0) { finish(null, "None of the run's documents could be read (the session text cache is empty and Drive re-read failed) — re-run the Option A assessment first."); return; }

          const memories = selectLineStatusMemories(get().calibrationMemories);
          memories.forEach((m) => get().incrementMemoryUsage(m.id));
          const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
          const result = await runStagedOutcomeReviewAudit(allAuditPoints, parts.join("\n\n"), analysisSettings, {
            criterionId: subCriterionId,
            memories,
            ruleInjection: useRuleTuningStore.getState().championInjection(subCriterionId),
            resolveChunkFile: (cid) => chunkFileNames[cid],
            onProgress: (detail) => set({ outcomeReviewProgress: { subCriterionId, detail } }),
            signal: runAbort.signal,
          });
          const runWarnings = [
            ...(missing.length > 0 ? [`${missing.length} file(s) could not be read for this pass (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""}) — the extracted-text cache is session-only; re-run the Option A assessment for full coverage.`] : []),
            ...(result.truncationNote ? [result.truncationNote] : []),
            ...(result.windowErrors ?? []),
          ];
          finish(
            { subCriterionId, rows: result.rows, runAt: new Date().toISOString(), runId, promptSent: result.promptSent, chunkFileNames, runWarnings: runWarnings.length > 0 ? runWarnings : undefined, model: result.usage?.model },
            undefined,
            result.promptSent,
            result.usage
          );
        } catch (err) {
          finish(null, err instanceof Error ? err.message : String(err));
        }
      },

      applyOutcomeReviewResult: (subCriterionId) => {
        const res = get().outcomeReviewResults[subCriterionId];
        if (!res) return 0;
        const checklist = useChecklistModuleStore.getState();
        const itemIds = GD4_REQUIREMENTS.filter((r) => itemIdsForScope(subCriterionId).includes(r.id)).map((r) => r.id);
        const linesByItem = Object.fromEntries(
          itemIds
            .filter((id) => checklist.entries[id])
            .map((id) => [id, checklist.entries[id].specific.map((l) => ({ id: l.id, sourceRef: l.sourceRef, clause: l.clause }))])
        );
        const updates = buildOutcomeReviewLegUpdates(res.rows, linesByItem);
        const applied = checklist.applyOutcomeReviewLegs(updates);
        if (applied > 0) {
          const outcomeN = res.rows.filter((r) => r.outcomeEvident).length;
          const reviewN = res.rows.filter((r) => r.reviewEvident).length;
          get().logHumanDecision({
            module: "Line Status",
            subjectId: subCriterionId,
            field: "apsr.systemsOutcomes+review",
            aiRunId: res.runId,
            aiOutput: `Outcomes & Review pass ${res.runId}: outcome data on ${outcomeN}, review records on ${reviewN} of ${res.rows.length} audit points`,
            humanDecision: `Applied to ${applied} checklist line(s) — Systems & Outcomes and Review APSR legs updated`,
            changed: true,
            decisionType: "Accepted",
            reason: "",
          });
          set((st) => {
            const cur = st.outcomeReviewResults[subCriterionId];
            return cur ? { outcomeReviewResults: { ...st.outcomeReviewResults, [subCriterionId]: { ...cur, appliedAt: new Date().toISOString(), appliedLineCount: applied } } } : {};
          });
        }
        return applied;
      },

      // Metadata-only check (Drive files.list — no content read, no AI call)
      // for whether the Actual Evidence folder has changed since the stored
      // assessment's fileLedger was built. "error" (not "unchanged") whenever
      // the comparison can't genuinely be made — no ledger to compare against
      // (e.g. derivedFromAudit results never carry one), no folder linked, no
      // Drive connection, or the listing call itself failed/timed out — so a
      // missing answer is never presented as a false "nothing changed".
      checkEvidenceDrift: async (subCriterionId) => {
        const s = get();
        const folder = s.folders.find((f) => folderScopeId(f) === subCriterionId);
        const assessment = s.evidenceAssessments[subCriterionId];
        const ledger = assessment?.fileLedger?.filter((r) => r.bucket === "evidence" && r.driveFileId);
        if (!folder || !ledger || ledger.length === 0) {
          return { status: "error", added: [], removed: [], modified: [], errorMessage: "No prior file ledger to compare against." };
        }
        const evidenceId = parseFolderId(folder.folderLink) || parseFolderId(folder.policyLink);
        if (!evidenceId) return { status: "error", added: [], removed: [], modified: [], errorMessage: "No evidence folder linked." };
        const token = await useGoogleDriveStore.getState().getFreshToken();
        if (!token) return { status: "error", added: [], removed: [], modified: [], errorMessage: "Google Drive isn't connected." };
        try {
          const allFiles = await listFolderFilesRecursive(evidenceId, token, "", 0, timeoutSignal(undefined, DRIVE_LIST_TIMEOUT_MS));
          const evidenceFiles = parseFolderId(folder.folderLink)
            ? allFiles
            : allFiles.filter((f) => classifyFileBucket(f.path) === "evidence");
          const current = evidenceFiles.map((f) => ({ id: f.id, name: f.path.split("/").pop() || f.path, modifiedTime: f.modifiedTime }));
          return diffEvidenceFiles(current, ledger);
        } catch (err) {
          return { status: "error", added: [], removed: [], modified: [], errorMessage: err instanceof Error ? err.message : String(err) };
        }
      },

      // Compiles the Evidence-tab rows into the Findings register. The staged
      // audit's auto-raise (raiseAllUnmetFindings) is the CANONICAL raiser —
      // when a finding with the same composite key (gd4ItemId + normalized
      // ref + finding type) already exists, Compile is a no-op for that row:
      // it links the row to the existing finding instead of creating a
      // second one. Rows the auto-raise didn't cover are routed through the
      // SAME buildDraftFinding seed path the checklist uses, so every
      // finding — whichever pipeline raised it — carries the identical
      // observation/criteria/effect scaffold plus rootCause/corrective/
      // preventive closure seed.
      compileEvidenceFindings: (subCriterionId) => {
        const s = get();
        const result = s.evidenceAssessments[subCriterionId];
        if (!result) return 0;
        const ppd = s.ppdReviewResults[subCriterionId];
        // chunkId → source file name, from whichever run produced the chunk
        // (evidence chunks from this assessment, PPD chunks from the PPD run),
        // so a finding's citations read "file · C004", not a bare chunk id.
        const resolveChunkFile = (cid: string) => result.chunkFileNames?.[cid] ?? ppd?.chunkFileNames?.[cid];
        let raised = 0;
        let changed = false;
        // Composite keys of every finding already in the register, so a
        // requirement the staged audit already raised is linked, not doubled.
        const existingByKey = new Map<string, string>();
        for (const f of s.customFindings) {
          const k = findingKeyOf(f);
          if (k && !existingByKey.has(k)) existingByKey.set(k, f.id);
        }
        // Rows whose verdicts are still queued at the hybrid approval gate are
        // NOT compiled — accepting one gate calls this for the whole
        // sub-criterion, and compiling the still-pending rows would create
        // their checklist lines and findings from verdicts the human hasn't
        // accepted yet (the gate-bypass regression this guard fixes). Each
        // pending row compiles when its own accept applies the write and
        // re-runs this; callers must dequeue an accepted item BEFORE calling.
        // Empty in full-auto/manual (nothing ever queues), so no change there.
        const pendingLineRefs = new Set<string>();
        for (const item of get().pendingCommits[subCriterionId]?.items ?? []) {
          const w = item.write;
          const ref = w.newLine
            ? w.newLine.sourceRef ?? w.newLine.clause
            : (() => {
                const l = useChecklistModuleStore.getState().entries[w.gd4ItemId]?.specific.find((x) => x.id === w.existingLineId);
                return l?.sourceRef ?? l?.clause;
              })();
          if (ref) pendingLineRefs.add(`${w.gd4ItemId}|${normalizeAuditRef(ref)}`);
        }
        const rows = result.rows.map((row) => {
          // "Not assessed" rows raise nothing — no audit result ever matched
          // this line, so there is no verdict to base a finding on.
          if (row.savedFindingId || row.assessmentFailed || row.verdict === "Not assessed") return row;
          const req = GD4_REQUIREMENTS.find((r) => r.id === row.gd4ItemId);
          if (!req) return row;
          const rowStatus: "Met" | "Partial" | "Not met" = row.verdict;
          const key = findingDedupeKey(row.gd4ItemId, row.gdRef, findingTypeForStatus(rowStatus));
          if (key && existingByKey.has(key)) {
            changed = true;
            return { ...row, savedFindingId: existingByKey.get(key) };
          }
          // Prefer the real checklist line for this ref — the same sourceRef-
          // or-clause match rule buildOptionALineWrites uses on the write side
          // (the old sourceRef-only lookup here could miss a clause-matched
          // line and create a second one) — so the finding is confirmed
          // through the one shared checklist path.
          const normRef = normalizeAuditRef(row.gdRef);
          if (pendingLineRefs.has(`${row.gd4ItemId}|${normRef}`)) return row; // still at the gate — not approved, not compiled
          const findLine = () =>
            useChecklistModuleStore.getState().entries[row.gd4ItemId]?.specific.find(
              (l) =>
                (l.sourceRef && normalizeAuditRef(l.sourceRef) === normRef) ||
                (l.clause && normalizeAuditRef(l.clause) === normRef)
            );
          let line = findLine();
          if (!line) {
            // No checklist line yet — manual mode never commits the run's
            // write-back, and hybrid may not have been approved. Create the
            // line NOW through the same machinery the full-auto/hybrid paths
            // use (buildOptionALineWrites → applyOptionAWrites), so
            // computeChecklistOverrides fires for this item and its dashboard
            // band reflects this Option A result instead of silently staying
            // on the legacy evidence-matrix fallback (a real gap: the finding
            // was raised but the score never moved). The finding is then
            // confirmed through the normal checklist path below — no more
            // synthetic store-less branch.
            const folder = s.folders.find((f) => folderScopeId(f) === subCriterionId);
            const checklist = useChecklistModuleStore.getState();
            const writes = buildOptionALineWrites(
              [row],
              { [row.gd4ItemId]: (checklist.entries[row.gd4ItemId]?.specific ?? []).map((l) => ({ id: l.id, sourceRef: l.sourceRef, clause: l.clause })) },
              ppd?.rows ?? [],
              { runId: result.runId ?? `EV-${subCriterionId}-COMPILE`, folderName: folder?.folderName, drive: folder?.folderLink || folder?.policyLink, owner: folder?.owner }
            );
            if (writes.length > 0) checklist.applyOptionAWrites(writes);
            line = findLine();
          }
          if (!line) return row; // write couldn't land — never raise an unanchored finding
          let findingId: string | undefined;
          if (line.draftFinding?.savedFindingId) {
            findingId = line.draftFinding.savedFindingId;
          } else {
            // Type the draft off the ROW's verdict, not the checklist line's
            // possibly-stale status — when Compile runs before the checklist
            // write-back (manual/hybrid), line.status can still hold the old
            // value, which typed the finding differently from the dedupe key
            // built at the top of this loop and produced duplicates later.
            const draft = buildDraftFinding(req, { ...line, status: rowStatus });
            // Freeze this row's citations onto the finding — file names,
            // chunk ids (resolved to files) and verified verbatim quotes —
            // so the register record traces back to the source documents on
            // its own, like the PPD-contradiction findings below already do.
            // Without this the finding kept only buildDraftFinding's
            // paraphrase (the real traceability gap found 2026-07-13).
            const ppdRow = (ppd?.rows ?? []).find((pr) => normalizeAuditRef(pr.ref) === normRef);
            const trace = buildOptionASourceTrace(row, ppdRow, resolveChunkFile, result.runId);
            if (trace) draft.observation = draft.observation ? `${draft.observation}\n\n${trace}` : trace;
            const before = get().customFindings.length;
            useChecklistModuleStore.getState().confirmDraftFinding(row.gd4ItemId, line.id, draft, result.runId);
            findingId = useChecklistModuleStore
              .getState()
              .entries[row.gd4ItemId]?.specific.find((l) => l.id === line!.id)?.draftFinding?.savedFindingId;
            if (findingId && get().customFindings.length > before) {
              get().seedClosure(findingId, { root: draft.rootCause, corr: draft.corrective, prev: draft.preventive });
              raised++;
            }
          }
          if (!findingId) return row;
          if (key) existingByKey.set(key, findingId);
          changed = true;
          return { ...row, savedFindingId: findingId };
        });
        if (changed) {
          set((st) => ({ evidenceAssessments: { ...st.evidenceAssessments, [subCriterionId]: { ...result, rows } } }));
        }

        // Technique 2 compile: each PPD internal contradiction raises its own
        // finding (OFI, or NC-Minor when it involves a gate-sensitive item's
        // sub-criterion). Dedupe via the same composite-key mechanism, with a
        // stable synthetic ref per contradiction. (`ppd` hoisted to the top
        // of this action — the row loop's source traces need it too.)
        if (ppd?.contradictions?.length) {
          const subItems = GD4_REQUIREMENTS.filter((r) => itemIdsForScope(subCriterionId).includes(r.id));
          const anchorItem = subItems[0];
          if (anchorItem) {
            const gateSensitive = subItems.some((r) => r.gateSensitive);
            let contraChanged = false;
            const updated = ppd.contradictions.map((c, i) => {
              if (c.savedFindingId) return c;
              const ref = `${subCriterionId}.CONTRA${i + 1}`;
              const key = findingDedupeKey(anchorItem.id, ref, gateSensitive ? "NC" : "OFI");
              if (key && existingByKey.has(key)) {
                contraChanged = true;
                return { ...c, savedFindingId: existingByKey.get(key) };
              }
              const finding: Finding = {
                id: `EV-${Date.now().toString(36).toUpperCase()}-CONTRA${i + 1}`,
                auditCycleId: s.cycle.id,
                gd4ItemId: anchorItem.id,
                issue: `GD4 ${subCriterionId} — internal PPD contradiction: ${c.description.slice(0, 140)}`,
                type: "AFI",
                severity: gateSensitive ? "High" : "Medium",
                owner: "SQ",
                dueDate: "",
                repeatFinding: false,
                overdue: false,
                managementDecisionNeeded: false,
                status: "Open",
                source: "PPD Review",
                createdAt: new Date().toISOString(),
                dimension: "Procedure",
                riskCategory: gateSensitive ? "B" : "C",
                clause: ref,
                observation: `${c.description}\n\nPassage A: ${c.quoteA}${c.chunkA ? ` (${c.chunkA})` : ""}\nPassage B: ${c.quoteB}${c.chunkB ? ` (${c.chunkB})` : ""}`,
                criteria: `The PPD must state one consistent procedure/value for each obligation under GD4 ${subCriterionId}. Two conflicting statements cannot both be followed, so the documented approach is not sustainable.`,
                effect: "An internally contradictory PPD cannot be consistently implemented or audited — staff cannot know which stated value governs, and an SSG assessor will treat the approach as not sustainably documented.",
                rootCause: "The PPD sections were drafted or revised independently without a consolidation review, so conflicting values for the same process were never reconciled.",
                corrective: `Reconcile the two passages: decide the correct value, amend both PPD sections to state it identically, and re-approve the document. ${c.chunkA || c.chunkB ? `Affected passages: ${[c.chunkA, c.chunkB].filter(Boolean).join(", ")}.` : ""}`,
                preventive: "Add a consistency check to the PPD review checklist (all timelines/values for the same process cross-checked) before each re-approval.",
                findingType: gateSensitive ? "NC" : "OFI",
                ncSeverity: gateSensitive ? "Minor" : null,
                linkedSourceRefs: [ref],
              };
              get().addCustomFinding(finding);
              get().seedClosure(finding.id, { root: finding.rootCause, corr: finding.corrective, prev: finding.preventive });
              if (key) existingByKey.set(key, finding.id);
              raised++;
              contraChanged = true;
              return { ...c, savedFindingId: finding.id };
            });
            if (contraChanged) {
              set((st) => {
                const cur = st.ppdReviewResults[subCriterionId];
                return cur ? { ppdReviewResults: { ...st.ppdReviewResults, [subCriterionId]: { ...cur, contradictions: updated } } } : {};
              });
            }
          }
        }
        return raised;
      },

      setAnalysisPath: (subCriterionId, path) =>
        set((s) => ({ analysisPath: { ...s.analysisPath, [subCriterionId]: path } })),

      setAuditMode: (mode) => set({ auditMode: mode }),

      setReviewPanelAuditorIds: (ids) => set({ reviewPanelAuditorIds: ids.slice(0, MAX_PANEL) }),
      setReviewPanelMode: (mode) => set({ reviewPanelMode: mode }),

      runFindingPanelReview: async (findingId, opts) => {
        const finding = get().customFindings.find((f) => f.id === findingId);
        if (!finding) return;
        if (get().reviewPanelMode === "off") return; // panel disabled
        const panel = assemblePanel(get().auditors, get().reviewPanelAuditorIds);
        if (panel.length < MIN_PANEL) return; // need a valid 2-5 panel
        const hash = findingReviewHash(finding);
        // Cache: skip if a review already ran against this exact finding text.
        if (!opts?.force && finding.panelReview && finding.panelReview.findingHash === hash) return;

        const aiSettings = useAISettingsStore.getState();
        if (!aiSettings.enabled || !aiSettings.apiKey) return;
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;
        set({ busy: "panel:" + findingId });
        const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });

        try {
          const result = await runAuditorPanel(
            {
              issue: finding.issue,
              gd4ItemId: finding.gd4ItemId,
              clause: finding.clause,
              observation: finding.observation,
              criteria: finding.criteria,
              evidenceStatusSummary: finding.evidenceStatusSummary,
              findingTypeLabel: (() => {
                const t = resolveFindingType(finding);
                const sev = resolveNcSeverity(finding);
                return sev ? `${t} (${sev})` : t;
              })(),
              findingHash: hash,
            },
            panel,
            analysisSettings,
            { signal: runAbort.signal },
          );
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          // Cache on the finding.
          get().updateCustomFinding(findingId, { panelReview: result });
          // The panel's synthesis is now the source of truth: write it into the
          // closure fields + header classification, overwriting auto-generated
          // content and deferring to any manual edits (Fix 1/2/3/4).
          const syn = result.synthesis;
          get().applyPanelConclusion(findingId, { force: false });
          // Log EVERY AI sub-call the panel made — each auditor's Round-1
          // review, any rebuttals, and the chair synthesis — as its own AI
          // Review Log entry with its REAL input prompt (promptSent) and output
          // (generatedContent). runId = findingId groups them together. This
          // replaces the previous single synthesis-only entry that carried no
          // promptSent at all.
          const callLog = result.callLog ?? [];
          if (callLog.length > 0) {
            // Roll up the whole panel run's token spend so the synthesis entry
            // can state the per-finding total (a 5-auditor + rebuttal + synthesis
            // run is a meaningful cost) — mirrors AIUsage accumulation elsewhere.
            const panelUsage = callLog.reduce<AIUsage | undefined>((acc, c) => addUsage(acc, c.usage), undefined);
            const panelTotalNote = panelUsage?.totalTokens
              ? `Panel run total: ${callLog.length} AI call${callLog.length === 1 ? "" : "s"} · ${panelUsage.totalTokens.toLocaleString()} tokens (${panelUsage.model}). See the Token & cost estimate for the dollar total.`
              : undefined;
            for (const c of callLog) {
              get().pushAIReviewLog({
                agent: "Auditor Review Panel",
                reviewType: "Closure",
                subjectId: finding.gd4ItemId,
                verdict: `${c.label} — ${c.verdict}`,
                confidence: "Medium",
                keyConcerns: [c.label],
                recommendedAction: c.kind === "synthesis"
                  ? `Review the synthesised conclusion and each panellist's view in the Findings / Quality Action panel.${panelTotalNote ? `\n${panelTotalNote}` : ""}`
                  : "One panel sub-call — see the chair synthesis entry for the combined conclusion.",
                live: true,
                liveError: c.failed ? c.output : undefined,
                generatedContent: c.output,      // Output tab = the model response
                promptSent: c.promptSent,         // Prompt Sent tab = the real input
                // Real per-call usage → the log row shows model + tokens + cost
                // instead of "live · —", and it rolls into the cost estimate.
                usage: c.usage,
                runId: findingId,
              });
            }
          } else {
            // Defensive fallback (e.g. all calls failed before any log entry):
            // still record the run so it isn't invisible.
            get().pushAIReviewLog({
              agent: "Auditor Review Panel",
              reviewType: "Closure",
              subjectId: finding.gd4ItemId,
              verdict: syn.finalClassification || "Panel reviewed",
              confidence: "Medium",
              keyConcerns: [syn.summary || `Panel of ${panel.length} auditor(s) reviewed this finding.`],
              recommendedAction: "Review the synthesised conclusion and each panellist's view in the Findings / Quality Action panel.",
              live: true,
              generatedContent: `FINAL CLASSIFICATION:\n${syn.finalClassification}`,
              runId: findingId,
            });
          }
        } catch (err) {
          console.error("[AuditorPanel] failed", err instanceof Error ? err.message : String(err));
        } finally {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          if (get().busy === "panel:" + findingId) set({ busy: null });
        }
      },

      dismissFullAuditProgress: () => set({ fullAuditProgress: null }),
      dismissHybridDraftProgress: () => set({ hybridDraftProgress: null }),
      // Run-log deletes touch ONLY runLog — never aiReviewLog, findings or any
      // checklist/scoring data (all separate stores).
      removeRunLogEntry: (id) => set((s) => ({ runLog: s.runLog.filter((e) => e.id !== id) })),
      clearRunLog: () => set({ runLog: [] }),

      writeReportNarratives: async (itemIds) => {
        const ai = useAISettingsStore.getState();
        // Never fabricate offline — no AI, no narrative (the report shows the
        // honest "not yet generated" placeholder instead).
        if (aiOfflineReason(ai)) return 0;
        const scale = useScoringConfigStore.getState().apsrScale;
        let written = 0;
        for (const itemId of itemIds) {
          // Fresh entry read per item — the band pass just wrote holisticBand.
          const input = narrativeInputForEntry(itemId, useChecklistModuleStore.getState().entries[itemId], scale);
          if (!input) continue; // no band / nothing assessed — nothing to narrate
          try {
            const settings = effectiveSettings(ai, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
            const res = await runNarrativeWriter(input, settings);
            const keys = Object.keys(res.narratives) as Array<keyof typeof res.narratives>;
            if (keys.length === 0) continue;
            const generatedAt = new Date().toISOString();
            get().setReportDimensionNarratives(Object.fromEntries(keys.map((k) => [suggestionKey(itemId, k), { ...res.narratives[k], generatedAt, model: res.model }])));
            get().pushAIReviewLog({
              agent: "Final Report Narrative Writer",
              reviewType: "Finalisation",
              subjectId: itemId,
              verdict: `Narrative written for ${keys.length} dimension${keys.length === 1 ? "" : "s"}`,
              confidence: "Medium",
              keyConcerns: keys.map((k) => input.findingsGroups.find((g) => g.key === k)?.label || String(k)),
              recommendedAction: "Review the narrative on the Final Report; use Regenerate report text if it misses the mark.",
              live: true,
              generatedContent: res.content,
              promptSent: res.promptSent,
              usage: res.usage,
            });
            // Per-line one-sentence synthesis for the LONG rows (Systems &
            // Outcomes / Review raw evidence merges) so their finding cell reads
            // as short as the Approach/Processes cells instead of a raw citation
            // stack. Same run + generate-once contract as the narratives; the
            // full raw evidence stays reachable behind the report's expand.
            // Returns null (no AI call) when no row is long enough to qualify.
            const concise = await runConciseLineSummaries(input, settings);
            if (concise && Object.keys(concise.summaries).length > 0) {
              const conciseAt = new Date().toISOString();
              get().setReportConciseFindings(Object.fromEntries(Object.entries(concise.summaries).map(([k, text]) => [k, { text, generatedAt: conciseAt, model: concise.model }])));
              get().pushAIReviewLog({
                agent: "Final Report Line Summariser",
                reviewType: "Finalisation",
                subjectId: itemId,
                verdict: `Condensed ${Object.keys(concise.summaries).length} long evidence row${Object.keys(concise.summaries).length === 1 ? "" : "s"}`,
                confidence: "Medium",
                keyConcerns: [],
                recommendedAction: "Review the one-sentence summaries on the Final Report; the full raw evidence stays behind each row's expand.",
                live: true,
                generatedContent: concise.content,
                promptSent: concise.promptSent,
                usage: concise.usage,
              });
            }
            written++;
          } catch (err) {
            // A narrative failure never fails the run — scoring data is already
            // committed; the report just shows the Regenerate placeholder. But
            // it must not vanish either (it used to be swallowed with no trace
            // anywhere): log it so the Run Log's AI-call drill-down and the AI
            // Review Log can answer "why is there no narrative".
            const liveError = err instanceof Error ? err.message : String(err);
            get().pushAIReviewLog({
              agent: "Final Report Narrative Writer",
              reviewType: "Finalisation",
              subjectId: itemId,
              verdict: "Narrative generation failed",
              confidence: "Low",
              keyConcerns: [liveError],
              recommendedAction: "Use Regenerate report text on the Final Report to retry.",
              live: false,
              liveError,
            });
          }
        }
        return written;
      },

      autoScoreAssessedItems: async (subIds) => {
        const set: string[] = [];
        const skipped: { itemId: string; reason: string }[] = [];
        // THE gate: setting OFF → do nothing, touch nothing. This is what makes
        // a Full Auto run byte-identical to before the feature when it is off.
        if (!useScoringConfigStore.getState().autoScoreBands) return { set, skipped };
        // subIds are RUN SCOPES (a sub-criterion id, or an item id like
        // "4.2.1" for a split sub) — resolve through itemIdsForScope, the same
        // mapping every other run consumer uses. Filtering by
        // r.subCriterionId here was the bug that made a completed 4.2.1/4.2.2
        // run silently skip its band + narrative (no requirement has
        // subCriterionId "4.2.1", so the pass found zero items) — the result
        // then never reached the Final Report (2026-07-20).
        const scopeItemIds = new Set(subIds.flatMap((sid) => itemIdsForScope(sid)));
        const checklist = useChecklistModuleStore.getState();
        // Only items that were actually assessed (have checklist lines) under a
        // swept scope. suggestBand reads live line state, fully settled by the
        // time the sweep loop has finished.
        const items = GD4_REQUIREMENTS.filter(
          (r) => scopeItemIds.has(r.id) && (checklist.entries[r.id]?.specific?.length ?? 0) > 0,
        );
        // Items under a swept scope with NO checklist lines used to be
        // silently excluded here — the band step then read "skipped" with no
        // reason recorded anywhere. Report them, don't score them.
        for (const itemId of scopeItemIds) {
          if ((checklist.entries[itemId]?.specific?.length ?? 0) === 0) {
            skipped.push({ itemId, reason: "no checklist lines recorded for this item — nothing to score" });
          }
        }
        for (const req of items) {
          // suggestBand is the same AI call + learning-loop + AI-review-log the
          // human accept flow uses; null = AI unavailable/failed → skip, honest.
          const s = await useChecklistModuleStore.getState().suggestBand(req.id);
          if (!s) { skipped.push({ itemId: req.id, reason: "AI band suggestion unavailable" }); continue; }
          // Mirror the UI's saveBand gate so a skip is reported rather than a
          // silent no-op inside setHolisticBand: complete matrix + a rationale.
          if (!apsrMatrixResult(s.dimensionBands, useScoringConfigStore.getState().apsrScale).complete) {
            skipped.push({ itemId: req.id, reason: "incomplete APSR matrix from the AI suggestion" });
            continue;
          }
          if (!s.rationale.trim()) { skipped.push({ itemId: req.id, reason: "AI returned no written justification" }); continue; }
          useChecklistModuleStore.getState().setHolisticBand(req.id, { matrixScores: s.dimensionBands, rationale: s.rationale, source: "ai-auto" });
          set.push(req.id);
        }
        return { set, skipped };
      },

      runFullAudit: async () => {
        if (get().fullAuditProgress?.status === "running" || get().busy) return;
        // See runPPDReview: no run without a named auditor.
        const auditorGate = checkAuditorForRun(get().auditors, get().activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        set({ auditBlockedReason: null });
        const plan = buildFullAuditPlan(get().folders, get().analysisPath, (l) => !!parseFolderId(l || ""));
        if (plan.length === 0) return;
        // Full auto commits every verdict automatically — its own path never
        // enqueues (partitionWritesByMode returns queue: [] for full-auto). But
        // a PRIOR Hybrid run may have left "Needs your review" items in
        // pendingCommits; clear the queue for the sub-criteria this sweep will
        // (re)assess so the Full auto result isn't mixed with a stale Hybrid
        // gate. Items for sub-criteria outside this plan are left untouched.
        {
          const planSubIds = new Set(plan.map((p) => p.subCriterionId));
          set((st) => ({ pendingCommits: Object.fromEntries(Object.entries(st.pendingCommits).filter(([subId]) => !planSubIds.has(subId))) }));
        }
        const linkedCount = plan.filter((p) => p.hasLinks).length;
        const startToken = get().auditRunToken;
        // One entry per planned sub-criterion, statuses updated live so the
        // overlay can colour-code waiting/running/done/skipped/error rows.
        const entries: FullAuditEntry[] = plan.map((p) => ({
          subCriterionId: p.subCriterionId,
          label: fullAuditLabel(p.subCriterionId, p.folderName),
          status: "waiting",
        }));
        const setFull = (patch: Partial<FullAuditProgress>) =>
          set((st) => ({ fullAuditProgress: { ...(st.fullAuditProgress ?? { status: "running", current: 0, total: plan.length, currentSubCriterionId: "", currentName: "" }), ...patch, entries: entries.map((e) => ({ ...e })) } as FullAuditProgress }));
        setFull({ status: "running", total: plan.length, current: 0 });
        const runStartedAt = new Date().toISOString();
        // Real per-sub step outcome for Run Log purposes, Option A only (see
        // RunLogSubOutcome.steps) — captured as each entry actually runs,
        // never guessed after the fact.
        const optionASteps = new Map<string, { ppdRan: boolean; evidenceRan: boolean; findingsCompiled: number; outcomeReviewApplied: boolean }>();

        // The resilient loop lives in lib/fullAudit.ts (pure + tested):
        // every sub-criterion terminates via success, error, per-item timeout
        // or skip — one stuck assessment can never freeze the sweep.
        const { cancelled } = await runFullAuditPlan(plan, entries, {
          run: async (entry) => {
            if (entry.path === "A") {
              optionASteps.set(entry.subCriterionId, await get().runOptionAFullAuto(entry.subCriterionId));
            } else {
              await get().auditFolderStaged(entry.folderId, "all", undefined, { current: plan.indexOf(entry) + 1, total: plan.length });
            }
          },
          markNoLinks: (entry) => {
            // Never skipped silently: recorded on the folder and in the log.
            set((st) => ({
              folders: st.folders.map((f) => f.id === entry.folderId ? { ...f, lastAuditSummary: "Not assessed / no evidence — no Drive folder links are set for this sub-criterion, so the full audit had nothing to read. Link a Policy & Procedure and/or Actual Evidence folder and re-run." } : f),
            }));
          },
          // User cancel = auditRunToken bump (the Cancel button's mechanism).
          cancelled: () => get().auditRunToken !== startToken,
          // Per-item timeout: abort the hung run's in-flight AI/Drive calls
          // and release its busy flag — WITHOUT bumping the token, so the
          // sweep itself continues to the next sub-criterion.
          abortActiveRun: () => {
            _currentRunAbort?.abort();
            _currentFileAbort?.();
            set({ busy: null, evidenceAssessmentProgress: null, ppdReviewProgress: null });
          },
          onUpdate: (current, entry) =>
            setFull({ current, currentSubCriterionId: entry.subCriterionId, currentName: fullAuditLabel(entry.subCriterionId, entry.folderName), currentStartedAt: entries[current - 1]?.status === "running" ? Date.now() : undefined }),
        });

        const doneCount = entries.filter((e) => e.status === "done").length;
        const errorCount = entries.filter((e) => e.status === "error").length;

        // Consolidated post-sweep band pass (single insertion point — see the
        // helper's note). A no-op unless the "Auto-score bands" setting is ON.
        // Skipped when cancelled: the user stopped, so don't score on top of a
        // half-finished sweep. Each item is banded once here, from its fully
        // settled checklist state, covering both Option A and staged items.
        let autoScore: FullAuditProgress["autoScore"];
        let bandsSet: RunLogEntry["bandsSet"] = [];
        let bandsSkipped: RunLogEntry["bandsSkipped"] = [];
        let narrativesWritten = 0;
        if (!cancelled) {
          const doneSubIds = entries.filter((e) => e.status === "done").map((e) => e.subCriterionId);
          const r = await get().autoScoreAssessedItems(doneSubIds);
          // Undefined when the setting was off (nothing attempted) so the
          // overlay stays identical to a pre-feature run; populated otherwise.
          if (r.set.length > 0 || r.skipped.length > 0) autoScore = { set: r.set.length, skipped: r.skipped };
          // Read back the REAL band/percentage autoScoreAssessedItems just
          // wrote, for the Run Log — never re-derived or guessed.
          const freshChecklist = useChecklistModuleStore.getState().entries;
          bandsSet = r.set
            .map((itemId) => freshChecklist[itemId]?.holisticBand)
            .map((hb, i) => hb ? { itemId: r.set[i], band: hb.band, totalPct: hb.totalPct } : null)
            .filter((b): b is RunLogBandResult => b !== null);
          bandsSkipped = r.skipped;
          // Sub-criteria that errored/timed out are excluded from the band pass
          // (only "done" subs are scored) — their items used to appear in
          // NEITHER bandsSet NOR bandsSkipped, a genuinely invisible skip.
          // Record them with the sub's real error note so the Run Log's band
          // section accounts for every planned item.
          for (const e of entries.filter((en) => en.status === "error")) {
            for (const itemId of itemIdsForScope(e.subCriterionId)) {
              bandsSkipped.push({ itemId, reason: `not scored — this sub-criterion's audit ${e.note ? `failed: ${e.note}` : "errored before scoring"}` });
            }
          }
          // Final decoupled step: auto-write report narratives for the items
          // just banded. Runs AFTER every committed step (verdicts, findings,
          // bands are all saved), so a slow/failed narrative call never blocks
          // scoring; failures just leave the report's Regenerate placeholder.
          narrativesWritten = await get().writeReportNarratives(r.set);
        }
        const autoScorePhrase = autoScore
          ? ` Auto-scored ${autoScore.set} band(s)${autoScore.skipped.length > 0 ? `, ${autoScore.skipped.length} left for manual scoring` : ""}.${narrativesWritten > 0 ? ` Auditor narratives written for ${narrativesWritten} item(s).` : ""}`
          : "";
        const finalSummary = cancelled
          ? `Cancelled — ${doneCount} of ${linkedCount} linked sub-criteria completed before the stop.`
          : `Full audit complete — ${doneCount} of ${linkedCount} linked sub-criteria audited${errorCount > 0 ? `, ${errorCount} errored/timed out` : ""}; ${plan.length - linkedCount} had no links.${autoScorePhrase}`;

        setFull({
          status: cancelled ? "cancelled" : "complete",
          autoScore,
          summary: finalSummary,
        });

        const runLogEntry: RunLogEntry = {
          id: `RUN-${Date.now()}-${++logCounter}`,
          mode: "full-auto",
          subCriterionIds: plan.map((p) => p.subCriterionId),
          startedAt: runStartedAt,
          endedAt: new Date().toISOString(),
          status: cancelled ? "cancelled" : "complete",
          perSub: entries.map((e): RunLogSubOutcome => ({
            subCriterionId: e.subCriterionId,
            path: plan.find((p) => p.subCriterionId === e.subCriterionId)?.path ?? "B",
            status: e.status === "waiting" || e.status === "running" ? "skipped" : e.status,
            note: e.note,
            steps: optionASteps.get(e.subCriterionId),
          })),
          bandsSet,
          bandsSkipped,
          summary: finalSummary,
        };
        set((st) => ({ runLog: [runLogEntry, ...st.runLog].slice(0, RUN_LOG_CAP) }));
      },

      runHybridItemDraft: async (subCriterionId) => {
        // Gated ENTIRELY on the setting: off → strict no-op, so a Hybrid
        // per-item run stays exactly as today (the caller only wires this in
        // when on; this guard is the belt-and-braces backstop). Drives ONE
        // sub-criterion straight through and stops — never touches another.
        if (!useScoringConfigStore.getState().autoScoreBands) return "stopped";
        const runStartedAt = new Date().toISOString();
        // Cancel support (reuses the existing token): cancelBusy() aborts the
        // in-flight AI call AND bumps auditRunToken. We snapshot it here; if it
        // has changed by the time the audit chain returns, the user cancelled —
        // and we SKIP band scoring entirely so nothing is ever banded on
        // incomplete data.
        const startToken = get().auditRunToken;
        // Live overlay: five real steps, all pending. Marked done/skipped only
        // when the step's real await resolves (see onStep + the reconcile
        // below) — never a fake animated bar.
        const stepDefs: HybridDraftProgress["steps"] = [
          { key: "ppd", label: "PPD review", status: "pending" },
          { key: "evidence", label: "Evidence assessment", status: "pending" },
          { key: "findings", label: "Compile findings", status: "pending" },
          { key: "review", label: "Outcomes & Review", status: "pending" },
          { key: "band", label: "Score band", status: "pending" },
          // Decoupled final step: verdicts/findings/band are all committed
          // before this runs, so a slow or failed narrative never blocks them.
          { key: "narrative", label: "Write report narrative", status: "pending" },
        ];
        const ORDER = stepDefs.map((s) => s.key);
        const setStep = (key: HybridDraftProgress["steps"][number]["key"], status: HybridDraftProgress["steps"][number]["status"]) =>
          set((st) => st.hybridDraftProgress ? { hybridDraftProgress: { ...st.hybridDraftProgress, steps: st.hybridDraftProgress.steps.map((s) => s.key === key ? { ...s, status } : s) } } : {});
        set({ hybridDraftProgress: { subCriterionId, steps: stepDefs.map((s) => ({ ...s })), status: "running" } });
        // runOptionAFullAuto: PPD → Evidence → compile → Outcomes/Review (O/R
        // gated on autoScoreBands, already true here). Then the band scores off
        // that now-complete APSR — findings + O/R fully settle before it runs.
        // Both reused verbatim; nothing duplicated. Scoped to this one sub.
        // onStep marks the starting step running and every earlier step done —
        // an earlier step can only be "before" the running one because it
        // already resolved.
        const steps = await get().runOptionAFullAuto(subCriterionId, (step) => {
          const at = ORDER.indexOf(step);
          ORDER.slice(0, at).forEach((k) => setStep(k, "done"));
          setStep(step, "running");
        });
        // Reconcile the four Option A steps from the REAL returned outcome: a
        // step that never produced usable rows is "skipped", not "done".
        // mark() records the final status AND the reason into stepOutcomes so
        // the Run Log can answer "why was this step skipped" after the fact —
        // previously only the transient overlay knew, and only as a bare
        // "skipped" (a real complaint: band/narrative skipped with no visible
        // reason, 2026-07-20).
        const stepFinal: Partial<Record<HybridDraftProgress["steps"][number]["key"], { status: "done" | "skipped"; reason?: string }>> = {};
        const mark = (key: HybridDraftProgress["steps"][number]["key"], stat: "done" | "skipped", reason?: string) => {
          setStep(key, stat);
          stepFinal[key] = { status: stat, ...(stat === "skipped" && reason ? { reason } : {}) };
        };
        const stepOutcomes = (): NonNullable<RunLogEntry["stepOutcomes"]> =>
          stepDefs.map((s) => ({ key: s.key, label: s.label, status: stepFinal[s.key]?.status ?? "skipped", ...(stepFinal[s.key]?.reason ? { reason: stepFinal[s.key]?.reason } : {}) }));
        mark("ppd", steps.ppdRan ? "done" : "skipped", "PPD review returned no usable rows (failed, was stopped, or had nothing to read) — see the AI Review Log");
        mark("evidence", steps.ppdRan && steps.evidenceRan ? "done" : "skipped", steps.ppdRan ? "evidence assessment returned no usable rows (failed or every line was Not assessed) — see the AI Review Log" : "PPD produced nothing to assess against");
        mark("findings", steps.evidenceRan ? "done" : "skipped", "no evidence verdicts to compile");
        mark("review", steps.evidenceRan ? (steps.outcomeReviewApplied ? "done" : "skipped") : "skipped", steps.evidenceRan ? "the Outcomes & Review pass failed or produced nothing applicable — see the AI Review Log" : "no evidence verdicts to review");
        // Cancelled during the audit chain: record honestly and STOP before the
        // band. Steps that genuinely completed keep their writes (a coherent
        // "some lines assessed" state); the band is never scored, so the item
        // reads as un-banded / needs-assessment, never complete-but-isn't.
        if (get().auditRunToken !== startToken) {
          mark("band", "skipped", "cancelled by user before the band step");
          mark("narrative", "skipped", "cancelled by user before the band step");
          const cancelSummary = `Hybrid draft for ${subCriterionId} cancelled — steps completed before the stop are kept; the band was not scored.`;
          set((st) => st.hybridDraftProgress ? { hybridDraftProgress: { ...st.hybridDraftProgress, status: "cancelled", summary: cancelSummary } } : {});
          const cancelledEntry: RunLogEntry = {
            id: `RUN-${Date.now()}-${++logCounter}`,
            mode: "hybrid-item",
            subCriterionIds: [subCriterionId],
            startedAt: runStartedAt,
            endedAt: new Date().toISOString(),
            status: "cancelled",
            perSub: [{ subCriterionId, path: "A", status: "skipped", note: "cancelled by user", steps }],
            bandsSet: [],
            bandsSkipped: [],
            summary: cancelSummary,
            stepOutcomes: stepOutcomes(),
          };
          set((st) => ({ runLog: [cancelledEntry, ...st.runLog].slice(0, RUN_LOG_CAP) }));
          return "cancelled";
        }
        setStep("band", steps.evidenceRan ? "running" : "skipped");
        const r = await get().autoScoreAssessedItems([subCriterionId]);
        const freshChecklist = useChecklistModuleStore.getState().entries;
        const bandsSet: RunLogEntry["bandsSet"] = r.set
          .map((itemId) => freshChecklist[itemId]?.holisticBand)
          .map((hb, i) => hb ? { itemId: r.set[i], band: hb.band, totalPct: hb.totalPct } : null)
          .filter((b): b is RunLogBandResult => b !== null);
        if (!steps.evidenceRan) mark("band", "skipped", "no evidence verdicts to score");
        else if (bandsSet.length > 0) mark("band", "done");
        else mark("band", "skipped", r.skipped.length > 0 ? r.skipped.map((k) => `${k.itemId}: ${k.reason}`).join("; ") : "nothing scoreable was found for this sub-criterion");
        // Final decoupled step: auto-write the report narrative for the item(s)
        // just banded. Everything that scores is already committed above; a
        // cancel arriving during the band pass, a narrative failure, or AI
        // being offline just leaves the report's honest "not yet generated —
        // Regenerate" placeholder.
        let narrativesWritten = 0;
        const lateCancelled = get().auditRunToken !== startToken;
        if (lateCancelled || r.set.length === 0) {
          mark("narrative", "skipped", lateCancelled ? "cancelled by user during the band step" : "no band was set, so there is nothing to narrate");
        } else {
          setStep("narrative", "running");
          narrativesWritten = await get().writeReportNarratives(r.set);
          if (narrativesWritten > 0) mark("narrative", "done");
          else mark("narrative", "skipped", aiOfflineReason(useAISettingsStore.getState()) ?? "narrative generation failed or returned nothing — see the AI Review Log");
        }
        const status: RunLogSubOutcome["status"] = steps.ppdRan && steps.evidenceRan ? "done" : "skipped";
        const stoppedEarlyNote = !steps.ppdRan ? "PPD review returned no rows" : "evidence assessment returned no rows";
        const summary = status === "done"
          ? `Hybrid draft complete for ${subCriterionId} — ${steps.findingsCompiled} finding(s) compiled${steps.outcomeReviewApplied ? ", Outcomes & Review applied" : ""}${bandsSet.length > 0 ? `, band ${bandsSet[0].band} (${bandsSet[0].totalPct}%) set` : r.skipped.length > 0 ? `, band not set (${r.skipped[0].reason})` : ""}${narrativesWritten > 0 ? ", report narrative written" : ""}.`
          : `Hybrid draft for ${subCriterionId} stopped early — ${stoppedEarlyNote}.`;
        // Overlay handover to its final state (kept open; the user closes it,
        // revealing the Option A result modal underneath).
        set((st) => st.hybridDraftProgress ? { hybridDraftProgress: { ...st.hybridDraftProgress, status: "complete", summary } } : {});
        const runLogEntry: RunLogEntry = {
          id: `RUN-${Date.now()}-${++logCounter}`,
          mode: "hybrid-item",
          subCriterionIds: [subCriterionId],
          startedAt: runStartedAt,
          endedAt: new Date().toISOString(),
          // A cancel that arrived during the band pass is still a cancel —
          // previously this entry said "complete" with the narrative silently
          // skipped, indistinguishable from a normal finish.
          status: lateCancelled ? "cancelled" : "complete",
          perSub: [{ subCriterionId, path: "A", status, ...(status === "skipped" ? { note: stoppedEarlyNote } : {}), steps }],
          bandsSet,
          bandsSkipped: r.skipped,
          summary,
          stepOutcomes: stepOutcomes(),
        };
        set((st) => ({ runLog: [runLogEntry, ...st.runLog].slice(0, RUN_LOG_CAP) }));
        return status === "done" ? "done" : "stopped";
      },

      resolvePendingItem: (subCriterionId, itemId, decision, overrideStatus) => {
        const run = get().pendingCommits[subCriterionId];
        const item = run?.items.find((i) => i.id === itemId);
        if (!run || !item) return;
        // Dequeue the resolved item FIRST: compileEvidenceFindings (below)
        // skips rows still queued at the gate, so the accepted item must be
        // out of the queue before compile runs or it would skip itself.
        const dequeue = () =>
          set((s) => {
            const cur = s.pendingCommits[subCriterionId];
            if (!cur) return {};
            const items = cur.items.filter((i) => i.id !== itemId);
            if (items.length === 0) {
              const { [subCriterionId]: _done, ...rest } = s.pendingCommits;
              return { pendingCommits: rest };
            }
            return { pendingCommits: { ...s.pendingCommits, [subCriterionId]: { ...cur, items } } };
          });
        if (decision === "accept") {
          // Commit through the SAME write path both engines use; an edited
          // status remaps the evidence sufficiency and records the override.
          const write = overrideStatus && overrideStatus !== item.write.status
            ? {
                ...item.write,
                status: overrideStatus,
                evidence: {
                  ...item.write.evidence,
                  sufficiency: (overrideStatus === "Met" ? "Present" : overrideStatus === "Partial" ? "Weak" : "Missing") as "Present" | "Weak" | "Missing",
                  auditorNote: `${item.write.evidence.auditorNote ?? ""}\n\n[Human override: AI drafted ${item.write.status}; reviewer set ${overrideStatus}.]`.trim(),
                },
              }
            : item.write;
          useChecklistModuleStore.getState().applyOptionAWrites([write]);
          dequeue();
          try {
            useChecklistModuleStore.getState().raiseAllUnmetFindings(run.runId, { subCriterionId });
            // Option A parity with full-auto: raiseAllUnmetFindings only covers
            // Not-met/missing-evidence lines — compile also raises the OFIs for
            // Partial verdicts and the Technique-2 PPD-contradiction findings
            // (both deduped), so hybrid approval yields the same register as a
            // full-auto run of the same assessment.
            if (run.path === "A") get().compileEvidenceFindings(subCriterionId);
          } catch (err) {
            console.error("[resolvePendingItem] finding raise failed", err instanceof Error ? err.message : String(err));
          }
          get().logHumanDecision({
            module: "Run mode gate",
            subjectId: item.write.gd4ItemId,
            aiRunId: run.runId,
            aiOutput: `AI verdict: ${item.write.status} — ${item.lineText.slice(0, 160)}`,
            humanDecision: overrideStatus && overrideStatus !== item.write.status ? `Edited to ${overrideStatus}` : "Accepted",
            changed: !!overrideStatus && overrideStatus !== item.write.status,
            decisionType: overrideStatus && overrideStatus !== item.write.status ? "Edited" : "Accepted",
            reason: item.reason ?? "",
          });
        } else {
          get().logHumanDecision({
            module: "Run mode gate",
            subjectId: item.write.gd4ItemId,
            aiRunId: run.runId,
            aiOutput: `AI verdict: ${item.write.status} — ${item.lineText.slice(0, 160)}`,
            humanDecision: "Rejected — not committed",
            changed: true,
            decisionType: "Dismissed",
            reason: item.reason ?? "",
          });
          dequeue();
        }
      },

      acceptAllPending: (subCriterionId) => {
        const run = get().pendingCommits[subCriterionId];
        if (!run || run.items.length === 0) return;
        useChecklistModuleStore.getState().applyOptionAWrites(run.items.map((i) => i.write));
        // Clear the queue BEFORE compiling — compileEvidenceFindings skips
        // gate-pending rows, and every row here was just accepted.
        set((s) => {
          const { [subCriterionId]: _done, ...rest } = s.pendingCommits;
          return { pendingCommits: rest };
        });
        try {
          useChecklistModuleStore.getState().raiseAllUnmetFindings(run.runId, { subCriterionId });
          // See resolvePendingItem: Option A parity with full-auto (Partial→OFI
          // + PPD-contradiction findings, deduped).
          if (run.path === "A") get().compileEvidenceFindings(subCriterionId);
        } catch (err) {
          console.error("[acceptAllPending] finding raise failed", err instanceof Error ? err.message : String(err));
        }
        get().logHumanDecision({
          module: "Run mode gate",
          subjectId: subCriterionId,
          aiRunId: run.runId,
          aiOutput: `${run.items.length} queued verdict(s) from run ${run.runId}`,
          humanDecision: "Accept all",
          changed: false,
          decisionType: "Accepted",
          reason: "",
        });
      },

      discardPendingRun: (subCriterionId) =>
        set((s) => {
          const { [subCriterionId]: _dropped, ...rest } = s.pendingCommits;
          return { pendingCommits: rest };
        }),

      runOptionAFullAuto: async (subCriterionId, onStep) => {
        // Cancel gate for the WHOLE chain (2026-07-19 fix). cancelBusy() aborts
        // the in-flight AI call and bumps auditRunToken, but each pass below
        // creates its OWN AbortController and busy state — so without a check
        // BETWEEN passes, cancelling one pass just let the next one start a
        // fresh AI call and the run visibly continued (findings/evidence/O&R
        // kept writing after Cancel). auditRunToken only ever changes on
        // cancelBusy(), so a bump means "user cancelled": stop the chain here
        // and return the progress so far. Nothing after a cancel is scored.
        const startToken = get().auditRunToken;
        const cancelled = () => get().auditRunToken !== startToken;
        // Step 1 — PPD review. Stop the chain if it failed or was stopped.
        onStep?.("ppd");
        await get().runPPDReview(subCriterionId);
        if (cancelled()) return { ppdRan: false, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false };
        const ppd = get().ppdReviewResults[subCriterionId];
        if (!ppd || ppd.rows.length === 0 || ppd.runWarnings?.some((w) => /stopped/i.test(w))) {
          return { ppdRan: false, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false };
        }
        // Step 2 — evidence assessment. Its finish() applies the checklist
        // writes itself under full_auto.
        onStep?.("evidence");
        await get().runEvidenceAssessment(subCriterionId);
        if (cancelled()) return { ppdRan: true, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false };
        const ev = get().evidenceAssessments[subCriterionId];
        if (!ev || ev.rows.length === 0 || ev.rows.every((r) => r.verdict === "Not assessed")) {
          return { ppdRan: true, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false };
        }
        // Step 3 — compile findings (existing deduped pipeline).
        onStep?.("findings");
        const findingsCompiled = get().compileEvidenceFindings(subCriterionId);
        // Step 4 — hands-off sweeps only: also run + apply the Outcomes &
        // Review pass so Option A's Systems & Outcomes and Review legs carry
        // real judgements before the post-sweep band pass scores off them —
        // without this the auto-band rested on "not assessed" placeholders.
        // Gated on autoScoreBands (the one master switch for hands-off
        // drafts), so it fires in BOTH Full auto and the Hybrid first draft
        // when on, and never when off. Safe for individual re-runs by
        // construction: runOptionAFullAuto is called ONLY by runFullAudit, so
        // a per-row iteration re-run (runEvidenceAssessment/auditFolderStaged
        // direct) never reaches here and keeps Apply manual. Scoring-neutral —
        // applyOutcomeReviewResult writes only those two legs, never the band.
        let outcomeReviewApplied = false;
        if (useScoringConfigStore.getState().autoScoreBands && !cancelled()) {
          onStep?.("review");
          await get().runOutcomeReviewPass(subCriterionId);
          // A cancel during the O&R pass must not apply its (partial) legs.
          if (!cancelled() && get().outcomeReviewResults[subCriterionId]) {
            outcomeReviewApplied = get().applyOutcomeReviewResult(subCriterionId) > 0;
          }
        }
        return { ppdRan: true, evidenceRan: true, findingsCompiled, outcomeReviewApplied };
      },

      // Fills the workspace with realistic sample evidence ratings plus the
      // workflow-progress fields derived from them (reviewer drafts,
      // sign-offs, closures, samples, interview prep, management review
      // pack, export log, sample auditor roster). A brand-new workspace
      // starts fully blank (blankEvidence()/auditors:[] above) — this is the
      // only path that populates it.
      loadDemoDataset: () => {
        useChecklistModuleStore.getState().loadDemoChecklistData();
        set((s) => {
          const evidence = seedEvidence();
          return {
            evidence,
            auditors: DEFAULT_AUDITORS,
            // Seed the review panel with all five so the demo route and the
            // "Load preset auditors" button both land on "Panel ready".
            reviewPanelAuditorIds: DEFAULT_AUDITORS.map((a) => a.id).slice(0, MAX_PANEL),
            seedFindingsLoaded: true,
            sampleDataActive: true,
            cycle: { ...s.cycle, ...DEMO_CYCLE_FIELDS },
            // Clear prior REAL audit state so demo data never mixes with it:
            // leftover custom findings, queued pending commits, AI verdicts and
            // Option A results would otherwise sit alongside the demo findings
            // (referencing lines/refs the demo did not create) and corrupt every
            // count on the Dashboard/Findings/Scorecard.
            customFindings: [],
            pendingCommits: {},
            itemReviews: {},
            ppdReviewResults: {},
            ppdReviewHistory: {},
            evidenceAssessments: {},
            evidenceAssessmentHistory: {},
            auditRunHistory: {},
            lastAuditRuns: {},
            ...buildDemoDataset(evidence),
          };
        });
        // Grouped drafts reference findings/lines the demo wipe just replaced.
        useFindingDraftStore.getState().resetAllDrafts();
      },

      // Clear the loaded SAMPLE dataset: reset every field loadDemoDataset
      // populated back to a blank workspace and drop the SAMPLE banner. Mirrors
      // the demo load's own "clear prior state" wipe, in reverse.
      clearSampleData: () => {
        useChecklistModuleStore.getState().replaceAllEntries({});
        useFindingDraftStore.getState().resetAllDrafts();
        set((s) => ({
          sampleDataActive: false,
          seedFindingsLoaded: false,
          evidence: blankEvidence(),
          reviewer: {},
          confirmed: {},
          justify: {},
          closures: {},
          samples: [],
          interviewQuestions: [],
          exportLog: [],
          customFindings: [],
          auditors: [],
          reviewPanelAuditorIds: [],
          itemReviews: {},
          ppdReviewResults: {},
          ppdReviewHistory: {},
          evidenceAssessments: {},
          evidenceAssessmentHistory: {},
          analysisPath: {},
          pendingCommits: {},
          auditRunHistory: {},
          lastAuditRuns: {},
          evidenceAuditReport: null,
          // Return the cycle metadata to a fresh blank (the demo overwrote it
          // with DEMO_CYCLE_FIELDS), keeping the id/createdAt so history and
          // any saved versions still resolve.
          cycle: { ...DEFAULT_CYCLE, id: s.cycle.id, createdAt: s.cycle.createdAt, updatedAt: new Date().toISOString() },
        }));
      },

      // Snapshot+restore versioning: every save captures a full copy of the
      // working state, so a version in the list can be restored exactly, not
      // just relabelled.
      saveAsNewVersion: (name, note) =>
        set((s) => {
          const m = s.cycle.version.match(/v0\.(\d+)/);
          const nv = m ? `v0.${Number(m[1]) + 1}` : "v0.2";
          const snapshot: WorkspaceSnapshot = {
            cycle: { ...s.cycle, version: nv, lastSavedAt: new Date().toLocaleString() },
            evidence: s.evidence,
            reviewer: s.reviewer,
            confirmed: s.confirmed,
            justify: s.justify,
            closures: s.closures,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            checklistEntries: useChecklistModuleStore.getState().entries,
            customFindings: s.customFindings,
            seedFindingsLoaded: s.seedFindingsLoaded,
            sampleDataActive: s.sampleDataActive,
            itemReviews: s.itemReviews,
            // aiReviewLog is deliberately NOT snapshotted any more: each entry
            // can carry a full prompt, and 50 versions × 200 entries was the
            // main localStorage-quota driver. Restore keeps the current log.
            auditors: s.auditors,
            departments: s.departments,
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            auditJournal: s.auditJournal,
            // Option A state + run history. promptSent is kept IN FULL for
            // development — the team inspects full prompts in the AI Review
            // Log. Note: full prompts embed school-document text and are
            // persisted (Supabase/localStorage).
            ppdReviewResults: s.ppdReviewResults,
            ppdReviewHistory: s.ppdReviewHistory,
            evidenceAssessments: s.evidenceAssessments,
            evidenceAssessmentHistory: s.evidenceAssessmentHistory,
            analysisPath: s.analysisPath,
            auditMode: s.auditMode,
            reviewPanelAuditorIds: s.reviewPanelAuditorIds,
            reviewPanelMode: s.reviewPanelMode,
            auditRunHistory: s.auditRunHistory,
          };
          const entry: VersionEntry = {
            id: `VER-${Date.now()}`,
            name: name.trim() || `${nv} Draft`,
            version: nv,
            date: new Date().toLocaleString(),
            status: s.cycle.status,
            note: note?.trim() || "Saved",
            snapshot,
          };
          const allVersions = [entry, ...s.versions];
          if (allVersions.length > 50) {
            console.warn(`Version history capped at 50 — oldest version "${allVersions[50].name}" was dropped.`);
          }
          return {
            cycle: snapshot.cycle,
            versions: allVersions.slice(0, 50),
          };
        }),

      restoreVersion: (versionId) =>
        set((s) => {
          const entry = s.versions.find((v) => v.id === versionId);
          if (!entry) return {};
          const snap = entry.snapshot;
          // Roll the checklist module back together with the workspace so the
          // restored bands match. Older snapshots may not carry it, in which
          // case the current checklist is left untouched.
          if (snap.checklistEntries) useChecklistModuleStore.getState().replaceAllEntries(snap.checklistEntries);
          // Grouped drafts point at findings/lines that are about to roll back —
          // reset them (same as createNewCycle) so no draft dangles.
          useFindingDraftStore.getState().resetAllDrafts();
          const logEntry = {
            restoredAt: new Date().toLocaleString(),
            fromVersion: entry.version,
            fromNote: entry.note || entry.name,
          };
          // Reconcile the snapshot to the CURRENT GD4 structure before writing
          // it back. A snapshot saved before a sub-criterion split / 7.2 fold /
          // item collapse would otherwise reintroduce the old folders (leaving
          // the Evidence Folder and item→folder resolution on a dead structure)
          // and parentless item/sub-criterion keys. Reconciling here keeps
          // ratings for every surviving item and drops only what no longer
          // exists — the same guarantee the persist migration gives on load.
          const validItem = currentItemIds();
          const validSub = currentSubIds();
          const restoredFolders = snap.folders ? reconcileFolders(snap.folders) : snap.folders;
          const keptFolderIds = new Set((restoredFolders ?? []).map((f) => f.id));
          const restoredRunHistory = Object.fromEntries(
            Object.entries(snap.auditRunHistory ?? {}).filter(([folderId]) => keptFolderIds.has(folderId))
          );
          return {
            cycle: { ...snap.cycle, updatedAt: new Date().toISOString() },
            evidence: reconcileEvidenceMap(snap.evidence) ?? snap.evidence,
            reviewer: pruneRecordByKeys(snap.reviewer, validItem) ?? snap.reviewer,
            confirmed: pruneRecordByKeys(snap.confirmed, validItem) ?? snap.confirmed,
            justify: pruneRecordByKeys(snap.justify, validItem) ?? snap.justify,
            closures: snap.closures as WorkspaceState["closures"],
            folders: restoredFolders,
            samples: snap.samples ? snap.samples.filter((x) => validItem.has(x.gd4ItemId)) : snap.samples,
            interviewQuestions: snap.interviewQuestions ? snap.interviewQuestions.filter((x) => validItem.has(x.gd4ItemId)) : snap.interviewQuestions,
            customFindings: snap.customFindings ?? s.customFindings,
            seedFindingsLoaded: snap.seedFindingsLoaded ?? s.seedFindingsLoaded,
            // Keep the SAMPLE banner in sync with restored seed findings; old
            // snapshots (no field) fall back to whether seed findings loaded.
            sampleDataActive: snap.sampleDataActive ?? snap.seedFindingsLoaded ?? s.sampleDataActive,
            // Restore the AI verdicts/log and context so nothing is silently
            // lost; fall back to current state for pre-existing snapshots.
            itemReviews: pruneRecordByKeys((snap.itemReviews as WorkspaceState["itemReviews"]) ?? s.itemReviews, validItem) ?? s.itemReviews,
            aiReviewLog: snap.aiReviewLog ?? s.aiReviewLog,
            // Roster travels with the snapshot so the restored panel ids
            // (reviewPanelAuditorIds below) can't dangle against a different
            // current roster. Older snapshots keep the current roster.
            auditors: snap.auditors ?? s.auditors,
            departments: snap.departments ?? s.departments,
            schoolContext: snap.schoolContext ?? s.schoolContext,
            additionalInfo: snap.additionalInfo ?? s.additionalInfo,
            auditJournal: (snap as WorkspaceSnapshot & { auditJournal?: string }).auditJournal ?? s.auditJournal,
            // Option A state + run history roll back WITH the findings they
            // reference. Unlike the fields above, snapshots that predate
            // these fields CLEAR them (?? {}) instead of keeping current
            // state — keeping it would leave PPD/evidence rows whose
            // savedFindingIds point at findings that no longer exist after
            // customFindings rolled back.
            // Sub-criterion-keyed Option A state, pruned to current sub-criteria.
            ppdReviewResults: pruneRecordByKeys(snap.ppdReviewResults ?? {}, validSub),
            ppdReviewHistory: pruneRecordByKeys(snap.ppdReviewHistory ?? {}, validSub),
            evidenceAssessments: pruneRecordByKeys(snap.evidenceAssessments ?? {}, validSub),
            evidenceAssessmentHistory: pruneRecordByKeys(snap.evidenceAssessmentHistory ?? {}, validSub),
            analysisPath: pruneRecordByKeys(snap.analysisPath ?? {}, validSub),
            auditMode: snap.auditMode ?? DEFAULT_AUDIT_MODE,
            reviewPanelAuditorIds: snap.reviewPanelAuditorIds ?? [],
            reviewPanelMode: snap.reviewPanelMode ?? "on-demand",
            // Run history for folders that survive reconciliation only.
            auditRunHistory: restoredRunHistory,
            // Derived from the restored history: latest run per folder.
            lastAuditRuns: Object.fromEntries(
              Object.entries(restoredRunHistory)
                .filter(([, runs]) => runs.length > 0)
                .map(([folderId, runs]) => [folderId, runs[0]])
            ),
            // Queued pending writes and the evidence recheck report belong to
            // the pre-restore state — keeping them would reference findings /
            // lines that were just rolled back.
            pendingCommits: {},
            evidenceAuditReport: null,
            // Append to the immutable restore audit trail
            restoreLog: [...s.restoreLog, logEntry],
          };
        }),

      lockCycle: () =>
        set((s) => {
          const snapshot: WorkspaceSnapshot = {
            cycle: { ...s.cycle, status: "Locked" },
            evidence: s.evidence,
            reviewer: s.reviewer,
            confirmed: s.confirmed,
            justify: s.justify,
            closures: s.closures,
            folders: s.folders,
            samples: s.samples,
            interviewQuestions: s.interviewQuestions,
            checklistEntries: useChecklistModuleStore.getState().entries,
            customFindings: s.customFindings,
            seedFindingsLoaded: s.seedFindingsLoaded,
            sampleDataActive: s.sampleDataActive,
            itemReviews: s.itemReviews,
            // aiReviewLog is deliberately NOT snapshotted any more: each entry
            // can carry a full prompt, and 50 versions × 200 entries was the
            // main localStorage-quota driver. Restore keeps the current log.
            auditors: s.auditors,
            departments: s.departments,
            schoolContext: s.schoolContext,
            additionalInfo: s.additionalInfo,
            auditJournal: s.auditJournal,
            // Option A state + run history. promptSent is kept IN FULL for
            // development — the team inspects full prompts in the AI Review
            // Log. Note: full prompts embed school-document text and are
            // persisted (Supabase/localStorage).
            ppdReviewResults: s.ppdReviewResults,
            ppdReviewHistory: s.ppdReviewHistory,
            evidenceAssessments: s.evidenceAssessments,
            evidenceAssessmentHistory: s.evidenceAssessmentHistory,
            analysisPath: s.analysisPath,
            auditMode: s.auditMode,
            reviewPanelAuditorIds: s.reviewPanelAuditorIds,
            reviewPanelMode: s.reviewPanelMode,
            auditRunHistory: s.auditRunHistory,
          };
          const entry: VersionEntry = {
            id: `VER-${Date.now()}`,
            name: `${s.cycle.version} Locked`,
            version: s.cycle.version,
            date: new Date().toLocaleString(),
            status: "Locked",
            note: "Final version locked",
            snapshot,
          };
          return { cycle: snapshot.cycle, versions: [entry, ...s.versions].slice(0, 50) };
        }),

      unlockCycle: () => set((s) => ({ cycle: { ...s.cycle, status: "Under Review" } })),

      duplicateCycle: () =>
        set((s) => ({
          cycle: { ...s.cycle, id: `cycle-${Date.now()}`, name: `${s.cycle.name} (Copy)`, status: "Draft", version: "v0.1 Draft", lastSavedAt: "Not saved", createdAt: new Date().toISOString() },
        })),

      // Unlike duplicateCycle (which keeps every bit of evidence, findings,
      // checklist data etc. as-is — a true copy), this wipes the workspace
      // back to the exact same blank slate as a fresh install: only the
      // structural/reference data (rubric, department directory, agents,
      // folder skeleton) AND the saved versions survive. The confirm dialogs
      // on Draft Workspace / Audit Cycle explicitly promise "saved versions
      // are not affected" — `versions` is therefore deliberately NOT reset
      // here (it previously was, silently breaking that promise). Demo data
      // only returns if "Use demo data" is clicked again afterward.
      createNewCycle: () => {
        useChecklistModuleStore.getState().replaceAllEntries({});
        // Sibling store that must not leak the old cycle's context into the
        // new one: grouped finding drafts (their savedFindingIds point at
        // findings wiped below).
        useFindingDraftStore.getState().resetAllDrafts();
        // PDCA carryover (ISO 9011/9001): archive the outgoing cycle's full
        // register so new-cycle findings can be matched against it
        // (repeatFinding + Minor→Major escalation), and carry every OPEN
        // finding (closure not human-Accepted) into the new cycle with its
        // closure state — an unclosed nonconformity does not vanish just
        // because the audit year rolled over.
        const prev = get();
        const allPrev: Finding[] = [...(prev.seedFindingsLoaded ? FINDINGS : []), ...prev.customFindings];
        const archive: PriorCycleArchive | null = allPrev.length
          ? { cycleId: prev.cycle.id, cycleName: prev.cycle.name, archivedAt: new Date().toISOString(), findings: allPrev }
          : prev.priorCycleFindings; // an empty cycle keeps the older archive
        const openFindings = allPrev.filter((f) => prev.closures[f.id]?.human !== "Accepted");
        const carriedClosures = Object.fromEntries(openFindings.filter((f) => prev.closures[f.id]).map((f) => [f.id, prev.closures[f.id]]));
        set(() => ({
          cycle: { ...DEFAULT_CYCLE, id: `cycle-${Date.now()}`, name: "New Audit Cycle", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          evidence: blankEvidence(),
          reviewer: {},
          confirmed: {},
          justify: {},
          closures: carriedClosures,
          auditors: [],
          departments: DEFAULT_DEPARTMENTS,
          folders: seedFolders(),
          itemReviews: {},
          aiReviewLog: [],
          humanDecisionLog: [],
          calibrationExamples: [],
          calibrationMemories: [],
          samples: [],
          interviewQuestions: [],
          exportLog: [],
          customFindings: openFindings,
          seedFindingsLoaded: false,
          sampleDataActive: false,
          priorCycleFindings: archive,
          evidenceAuditReport: null,
          ppdReviewResults: {},
          ppdReviewHistory: {},
          evidenceAssessments: {},
          evidenceAssessmentHistory: {},
          evidenceAssessmentProgress: null,
          analysisPath: {},
          // auditMode is a cycle-level PREFERENCE, kept across cycles;
          // pendingCommits are the old cycle's uncommitted run state — wiped.
          pendingCommits: {},
          auditJournal: "",
          // Old cycle's school briefing and audit-run history must not carry
          // into a brand-new cycle's AI calls / folder panels.
          schoolContext: { text: "", link: "" },
          auditRunHistory: {},
          lastAuditRuns: {},
        }));
      },

      // Editing the reviewer score after a confirm invalidates that
      // confirmation, so a stale "Confirmed" badge can never sit next to a
      // Reviewer input showing a different number — the reviewer must
      // explicitly re-confirm (and re-justify if still required) the new value.
      setReviewerScore: (itemId, rawValue) => {
        // Scores are 0–100 by definition; an unclamped value (e.g. a 999
        // typo) previously flowed straight into eff and inflated the whole
        // criterion average and the award. Reject non-numeric input outright
        // and coerce out-of-range values to the nearest bound.
        if (!Number.isFinite(rawValue)) return;
        const value = Math.max(0, Math.min(100, rawValue));
        const s = get();
        const aiBand = aiScore(s.evidence[itemId]);
        if (aiBand !== value) {
          get().logHumanDecision({
            module: "Item Scoring",
            subjectId: itemId,
            aiOutput: `AI band: ${aiBand}`,
            humanDecision: `Reviewer band: ${value}`,
            changed: true,
            decisionType: "Overridden",
            reason: s.justify[itemId] || "",
            field: "band",
          });
        }
        set((s2) => ({
          reviewer: { ...s2.reviewer, [itemId]: value },
          confirmed: s2.confirmed[itemId] != null ? { ...s2.confirmed, [itemId]: null } : s2.confirmed,
        }));
      },

      setJustify: (itemId, value) => set((s) => ({ justify: { ...s.justify, [itemId]: value } })),

      // Enforces the justification requirement here, not just in the
      // Criterion Scorecard's button handler, so it can't be bypassed by any
      // other caller (e.g. Re-audit's reopen button reuses this action).
      confirmScore: (itemId) =>
        set((s) => {
          const already = s.confirmed[itemId] != null;
          if (already) return { confirmed: { ...s.confirmed, [itemId]: null } };
          const ev = s.evidence[itemId];
          const ais = aiScore(ev);
          const rev = s.reviewer[itemId] != null ? s.reviewer[itemId] : ais;
          const req = GD4_REQUIREMENTS.find((r) => r.id === itemId);
          if (needsJustification(ais, rev, !!req?.gateSensitive) && !(s.justify[itemId] || "").trim()) return {};
          return { confirmed: { ...s.confirmed, [itemId]: rev } };
        }),

      setAgentStrictness: (agentId, value) => set((s) => ({ agents: s.agents.map((a) => (a.id === agentId ? { ...a, strictness: value } : a)) })),

      // Tries a live OpenAI call (Settings page) when configured and enabled;
      // falls back to the deterministic offline simulation otherwise or on
      // any request failure. Either path only ever produces advisory
      // justification text — the score/band passed in is always the one
      // already computed by scoring.ts, never decided by the AI call.
      runItemAI: async (agentId, itemId) => {
        const s = get();
        set({ busy: itemId + agentId });
        const agent = s.agents.find((a) => a.id === agentId)!;
        const ev = s.evidence[itemId];
        const scored = buildScored(s);
        const item = scored.items.find((i) => i.id === itemId)!;

        const aiSettings = useAISettingsStore.getState();
        let verdict;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
            verdict = await runLiveItemReview(agent, item, ev, settings);
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            verdict = simulateItemReview(agent, item, ev);
          }
        } else {
          verdict = simulateItemReview(agent, item, ev);
        }

        const log: AIReviewLogEntry = {
          id: `LOG-${Date.now()}-${++logCounter}`,
          auditCycleId: s.cycle.id,
          agent: agent.name,
          reviewType: "Scoring",
          subjectId: itemId,
          verdict: verdict.band >= 4 ? "Acceptable" : verdict.band === 3 ? "Partial" : "Maintain Finding",
          confidence: verdict.confidence,
          keyConcerns: [verdict.justification],
          recommendedAction: verdict.higherBand,
          suggestedScore: verdict.score,
          suggestedBand: verdict.band as 1 | 2 | 3 | 4 | 5,
          live: verdict.live,
          liveError,
          generatedContent: verdict.justification,
          createdAt: new Date().toISOString(),
          model: (verdict as { usage?: AIUsage }).usage?.model,
          promptTokens: (verdict as { usage?: AIUsage }).usage?.promptTokens,
          completionTokens: (verdict as { usage?: AIUsage }).usage?.completionTokens,
          totalTokens: (verdict as { usage?: AIUsage }).usage?.totalTokens,
        };
        set({ itemReviews: { ...s.itemReviews, [itemId]: verdict }, aiReviewLog: [log, ...s.aiReviewLog].slice(0, 500), busy: null });
      },

      setClosureField: (afiId, field, value) => {
        const isTextField = field === "root" || field === "corr" || field === "prev" || field === "evid" || field === "containment";
        if (field === "root" || field === "corr" || field === "prev" || field === "containment") {
          const c = get().closures[afiId] || {};
          const prev = (c[field] as string | undefined) ?? "";
          // Only log when there was prior AI-drafted content being changed
          if (prev && value !== prev) {
            get().logHumanDecision({
              module: "Closure Drafting",
              subjectId: afiId,
              aiOutput: prev,
              humanDecision: value,
              changed: true,
              decisionType: "Edited",
              reason: "",
              field,
            });
          }
        }
        set((s) => {
          const cur = s.closures[afiId] || {};
          // A user edit marks the field manual, so a later panel run defers to
          // it (Fix 3). Non-text fields (human accept, AI verdict) don't affect
          // provenance.
          const manual = isTextField ? { ...(cur.manual || {}), [field]: true } : cur.manual;
          return { closures: { ...s.closures, [afiId]: { ...cur, [field]: value, manual } } };
        });
      },

      toggleClosureFramework: (afiId, fw) =>
        set((s) => {
          const cur = s.closures[afiId] || {};
          const has = (cur.frameworks || []).includes(fw);
          const frameworks = has ? (cur.frameworks || []).filter((x) => x !== fw) : [...(cur.frameworks || []), fw];
          return { closures: { ...s.closures, [afiId]: { ...cur, frameworks } } };
        }),

      applyPanelConclusion: (findingId, opts) => {
        const finding = get().customFindings.find((f) => f.id === findingId);
        const syn = finding?.panelReview?.synthesis;
        if (!finding || !syn) return;

        const c = get().closures[findingId] || {};
        const curType = resolveFindingType(finding);
        const curSev = resolveNcSeverity(finding);
        const plan = computePanelConclusion(
          { closure: c, findingType: curType, ncSeverity: curSev, classificationManual: finding.classificationManual, synthesis: syn },
          { force: !!opts?.force }
        );

        // Commit the closure overwrites and reset those fields' manual flags —
        // they're panel-sourced (auto) again, so a future re-run refreshes them.
        set((s) => {
          const prev = s.closures[findingId] || {};
          const manual = { ...(prev.manual || {}) };
          for (const k of plan.clearedManual) manual[k] = false;
          return { closures: { ...s.closures, [findingId]: { ...prev, ...plan.closure, manual } } };
        });

        const findingPatch: Partial<Finding> = { panelConflict: plan.conflicts.length ? { fields: plan.conflicts } : undefined };
        if (plan.classification) {
          findingPatch.findingType = plan.classification.findingType;
          findingPatch.ncSeverity = plan.classification.ncSeverity;
          findingPatch.classificationManual = false;
          const fmt = (t: string, sv: string | null) => `${t}${sv ? ` (${sv})` : ""}`;
          get().logHumanDecision({
            module: "Panel Conclusion",
            subjectId: findingId,
            aiOutput: fmt(plan.classification.findingType, plan.classification.ncSeverity),
            humanDecision: `${fmt(curType, curSev)} → ${fmt(plan.classification.findingType, plan.classification.ncSeverity)}`,
            changed: true,
            decisionType: "Overridden",
            reason: "Auditor Review Panel final classification applied.",
            field: "classification",
          });
        }
        get().updateCustomFinding(findingId, findingPatch);
      },

      seedClosure: (afiId, seed) =>
        set((s) => {
          const c = s.closures[afiId] || {};
          return {
            closures: {
              ...s.closures,
              // Only fill blanks — never clobber the user's own text.
              [afiId]: { ...c, root: c.root?.trim() || seed.root, corr: c.corr?.trim() || seed.corr, prev: c.prev?.trim() || seed.prev },
            },
          };
        }),

      runClosureAI: async (afiId) => {
        const s = get();
        set({ busy: "clx" + afiId });
        const c = s.closures[afiId] || {};

        const aiSettings = useAISettingsStore.getState();
        let verdict;
        let liveError: string | undefined;
        if (aiSettings.enabled && aiSettings.apiKey) {
          try {
            const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
            const closureCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "AFI Closure").slice(0, 3);
            if (closureCalibration.length) get().markCalibrationUsed(closureCalibration.map((e) => e.id));
            const closureItemId = get().customFindings.find((f) => f.id === afiId)?.gd4ItemId;
            verdict = await runLiveClosureReview(c, settings, closureCalibration, closureItemId);
          } catch (err) {
            liveError = err instanceof Error ? err.message : String(err);
            verdict = simulateClosure(c);
          }
        } else {
          verdict = simulateClosure(c);
        }

        const log: AIReviewLogEntry = {
          id: `LOG-${Date.now()}-${++logCounter}`,
          auditCycleId: s.cycle.id,
          agent: "Closure Reviewer",
          reviewType: "Closure",
          subjectId: afiId,
          verdict: verdict.verdict,
          confidence: "Medium",
          keyConcerns: [verdict.reason],
          recommendedAction: verdict.evidenceNeeded,
          evidenceNeeded: verdict.evidenceNeeded,
          live: verdict.live,
          liveError,
          generatedContent: verdict.reason,
          createdAt: new Date().toISOString(),
          model: (verdict as { usage?: AIUsage }).usage?.model,
          promptTokens: (verdict as { usage?: AIUsage }).usage?.promptTokens,
          completionTokens: (verdict as { usage?: AIUsage }).usage?.completionTokens,
          totalTokens: (verdict as { usage?: AIUsage }).usage?.totalTokens,
        };
        set({
          closures: { ...s.closures, [afiId]: { ...c, ai: verdict.verdict, aiReason: verdict.reason, aiNeed: verdict.evidenceNeeded, live: verdict.live } },
          aiReviewLog: [log, ...s.aiReviewLog].slice(0, 500),
          busy: null,
        });
      },

      // Automation: AI first-draft of root/corrective/preventive for a finding,
      // written into the closure fields for the auditor to edit. Only fills a
      // field the auditor hasn't already written, so it never overwrites work.
      draftClosureActions: async (afiId, issue, gd4ItemId) => {
        const aiSettings = useAISettingsStore.getState();
        if (!aiSettings.enabled || !aiSettings.apiKey) return;
        set({ busy: "clxdraft" + afiId });
        try {
          const settings = effectiveSettings(aiSettings, { purpose: "analysis", context: composeSchoolContext(get().schoolContext) });
          // Give the AI the real GD4 requirement and (if the line was audited)
          // the APSR breakdown, so the draft is grounded in the standard and
          // names the rubric dimension that fell short — not a generic guess.
          const req = GD4_REQUIREMENTS.find((r) => r.id === gd4ItemId);
          const standard = req ? `${req.requirement}\nIntent: ${req.intent}\nExpected evidence: ${req.expectedEvidence.join("; ")}` : undefined;
          const entry = useChecklistModuleStore.getState().entries[gd4ItemId];
          const auditedLine = entry?.specific.find((l) => l.draftFinding?.savedFindingId === afiId);
          const apsr = auditedLine ? lineApsr(auditedLine) : undefined;
          const closureDraftCalibration = get().calibrationExamples.filter((e) => e.included && e.module === "Closure Drafting").slice(0, 3);
          if (closureDraftCalibration.length) get().markCalibrationUsed(closureDraftCalibration.map((e) => e.id));
          const draft = await runLiveClosureDraft({ issue, gd4ItemId }, settings, { standard, apsr: apsr ? apsrReason(apsr) : undefined, calibration: closureDraftCalibration });
          // Record this AI run so every AI use shows in the AI Review Log.
          get().pushAIReviewLog({
            agent: "Closure Drafter",
            reviewType: "Closure",
            subjectId: gd4ItemId,
            verdict: "Actions drafted",
            confidence: "Medium",
            keyConcerns: ["Root cause, corrective and preventive actions drafted for review"],
            recommendedAction: "Review and edit the drafted actions, then link closure evidence.",
            live: true,
            generatedContent: `ROOT CAUSE:\n${draft.root}\n\nCORRECTIVE:\n${draft.corr}\n\nPREVENTIVE:\n${draft.prev}`,
            promptSent: draft.promptSent,
            usage: draft.usage,
          });
          set((s) => {
            const c = s.closures[afiId] || {};
            return {
              closures: {
                ...s.closures,
                [afiId]: {
                  ...c,
                  root: c.root?.trim() || formatDraftedClosureText(draft.root),
                  corr: c.corr?.trim() || formatDraftedClosureText(draft.corr),
                  prev: c.prev?.trim() || formatDraftedClosureText(draft.prev),
                },
              },
              busy: null,
            };
          });
        } catch (err) {
          set({ busy: null });
          throw err;
        }
      },

      setClosureHuman: (afiId, value, reason = "") => {
        const s = get();
        const c = s.closures[afiId] || {};
        const aiVerdict = c.ai ?? "";
        // ISO 9001 10.2 closure gating — acceptance is only a record when the
        // CAP substance exists. The UI disables the button too; this guard
        // makes the rule hold for every caller.
        if (value === "Accepted") {
          if (!c.root?.trim() || !c.corr?.trim() || !c.evid?.trim()) {
            console.warn("[setClosureHuman] rejected: root cause, corrective action and closure evidence are required before acceptance.");
            return;
          }
          // The override-reason field was rendered but never enforced: a human
          // acceptance that contradicts a negative AI verdict without a stated
          // reason is not an auditable override.
          const contradictsAi = aiVerdict === "Maintain Finding" || aiVerdict === "Escalate";
          if (contradictsAi && !reason.trim()) {
            console.warn("[setClosureHuman] rejected: overriding the AI reviewer verdict requires a reason.");
            return;
          }
        }
        const changed = value !== aiVerdict;
        get().logHumanDecision({
          module: "AFI Closure",
          subjectId: afiId,
          aiOutput: aiVerdict ? `AI verdict: ${aiVerdict}${c.aiReason ? ` — ${c.aiReason}` : ""}` : "No AI verdict yet",
          humanDecision: value || "(cleared)",
          changed,
          decisionType: !aiVerdict ? "Accepted" : changed ? "Overridden" : "Accepted",
          reason,
          field: "human",
        });
        set((st) => {
          const prev = st.closures[afiId] || {};
          const accepted = value === "Accepted";
          return {
            closures: {
              ...st.closures,
              [afiId]: {
                ...prev,
                human: value,
                // Verification record + effectiveness schedule on acceptance;
                // reopening clears them so a re-closure re-records.
                closedBy: accepted ? (st.auditors.find((a) => a.id === st.activeAuditorId)?.name || st.cycle.owner || "Unattributed") : undefined,
                closedAt: accepted ? new Date().toISOString() : undefined,
                effectivenessDue: accepted ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10) : undefined,
                effectivenessConfirmedAt: accepted ? prev.effectivenessConfirmedAt : undefined,
                effectivenessNote: accepted ? prev.effectivenessNote : undefined,
              },
            },
          };
        });
      },

      // Post-closure effectiveness confirmation (ISO 9001 10.2.1(d)): records
      // that the corrective action was later checked and shown to work. A
      // closure without this remains "Closed — pending effectiveness".
      confirmClosureEffectiveness: (afiId, note) => {
        const c = get().closures[afiId];
        if (!c || c.human !== "Accepted" || !note.trim()) return;
        get().logHumanDecision({
          module: "AFI Closure",
          subjectId: afiId,
          aiOutput: "Effectiveness review due " + (c.effectivenessDue ?? "(unscheduled)"),
          humanDecision: `Effective — ${note.trim().slice(0, 200)}`,
          changed: false,
          decisionType: "Accepted",
          reason: note.trim(),
          field: "effectiveness",
        });
        set((st) => ({
          closures: { ...st.closures, [afiId]: { ...(st.closures[afiId] || {}), effectivenessConfirmedAt: new Date().toISOString(), effectivenessNote: note.trim() } },
        }));
      },

      addAuditor: (a) => set((s) => ({ auditors: [...s.auditors, a] })),
      updateAuditor: (id, patch) => set((s) => ({ auditors: s.auditors.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      removeAuditor: (id) => set((s) => ({ auditors: s.auditors.filter((a) => a.id !== id) })),

      loadPresetAuditors: (mode) => {
        const s = get();
        if (mode === "replace") {
          set({ auditors: [...DEFAULT_AUDITORS], reviewPanelAuditorIds: DEFAULT_AUDITORS.map((a) => a.id).slice(0, MAX_PANEL) });
          return DEFAULT_AUDITORS.length;
        }
        // add: skip any preset whose name already exists (case-insensitive) so
        // repeat clicks never create duplicates.
        const existing = new Set(s.auditors.map((a) => a.name.trim().toLowerCase()));
        const toAdd = DEFAULT_AUDITORS.filter((p) => !existing.has(p.name.trim().toLowerCase()));
        const panelIds = [...s.reviewPanelAuditorIds];
        for (const p of toAdd) {
          if (panelIds.length < MAX_PANEL && !panelIds.includes(p.id)) panelIds.push(p.id);
        }
        set({ auditors: [...s.auditors, ...toAdd], reviewPanelAuditorIds: panelIds });
        return toAdd.length;
      },

      addDepartment: (d) => set((s) => ({ departments: [...s.departments, d] })),
      updateDepartment: (id, patch) => set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      removeDepartment: (id) => set((s) => ({ departments: s.departments.filter((d) => d.id !== id) })),
      resetDepartments: () => set({ departments: DEFAULT_DEPARTMENTS }),

      setFolderField: (id, field, value) => set((s) => ({
        folders: s.folders.map((f) => {
          if (f.id !== id) return f;
          // Editing/deleting a link must clear that tab's stale cached access
          // status — otherwise a prior "Error" (rendered as "Policy/Evidence:
          // Can't read") survives the delete + re-add because the folder id is
          // reused per sub-criterion. Cleared to undefined → the chip reads the
          // honest "Linked" (not-yet-checked) until a real access check runs.
          const clear =
            field === "folderLink" ? { accessCheckStatus: undefined, accessCheckNote: undefined, accessCheckAt: undefined } :
            field === "policyLink" ? { policyAccessStatus: undefined, policyAccessNote: undefined, policyAccessAt: undefined } :
            {};
          return { ...f, [field]: value, ...clear };
        }),
      })),

      // "Check access" action on the Evidence Folder page: a real Drive API
      // call (files.list) confirming whether the connected Google account can
      // actually see this folder's files. No AI involved — this only answers
      // "can we read it", not "what's in it".
      checkFolderAccess: async (id, tab = "evidence") => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        set({ busy: `folderaccess:${tab}:` + id });

        const link = tab === "policy" ? folder.policyLink : folder.folderLink;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        const checkedAt = new Date().toISOString();
        const label = tab === "policy" ? "Policy & Procedure" : "Actual Evidence";

        let status: DriveAccessStatus;
        let note: string;
        // Live file count from this check — feeds the pre-run time estimate.
        let liveFileCount: number | undefined;
        if (!folderId) {
          status = "Error";
          note = `Could not find a Drive folder ID in the ${label} link. Paste a Google Drive folder link (e.g. https://drive.google.com/drive/folders/<id>).`;
        } else if (!token) {
          status = "Not Connected";
          note = "Not connected to Google Drive. Connect your Google account in Settings, then try again.";
        } else {
          try {
            const files = await listFolderFilesRecursive(folderId, token);
            liveFileCount = files.length;
            status = "Connected";
            note = files.length
              ? `Connected — found ${files.length} file${files.length === 1 ? "" : "s"} in the ${label} folder (including subfolders).`
              : `Connected, but the ${label} folder (and its subfolders) appears to be empty.`;
          } catch (err) {
            status = "Error";
            if (err instanceof DriveApiError && err.status === 404) note = "Drive could not find this folder. Check the link and that it points to a folder, not a file.";
            else if (err instanceof DriveApiError && err.status === 403)
              note = `Drive denied access to this folder (${err.reason || "no further detail from Google"}). Confirm the connected Google account has at least viewer access — if this folder lives in a Shared Drive, also confirm the account is a member of that Shared Drive, not just shared the folder link.`;
            else note = err instanceof Error ? err.message : String(err);
          }
        }

        set((st) => ({
          folders: st.folders.map((f) =>
            f.id === id
              ? tab === "policy"
                ? { ...f, policyAccessStatus: status, policyAccessNote: note, policyAccessAt: checkedAt, ...(liveFileCount != null ? { policyFileCount: liveFileCount, fileCountAt: checkedAt } : {}) }
                : { ...f, accessCheckStatus: status, accessCheckNote: note, accessCheckAt: checkedAt, ...(liveFileCount != null ? { evidenceFileCount: liveFileCount, fileCountAt: checkedAt } : {}) }
              : f
          ),
          busy: null,
        }));

        // Durability race (2026-07-19 bug): the link and this check-access
        // result both persist via the shared 600ms-debounced Supabase write,
        // and the beforeunload flush is fire-and-forget (browsers do not await
        // async unload work). "Check access" is the natural last action before
        // a user refreshes to confirm the folder saved, so a refresh inside the
        // debounce window pulled the OLDER Supabase row on load AND cached it
        // back over the good localStorage copy, wiping the link/result. Force
        // an immediate flush of the pending workspace write (which has coalesced
        // the just-typed link) so it is durable before any refresh can lose it.
        await flushPendingSaves();
      },

      // Folder pre-flight probe — reuses classifyFileBucket (bucketing) and
      // classifyDriveReadError (read failures); makes NO AI/OpenAI call. Lists
      // the folder, then read-checks each file (warming the fileTextCache the
      // real audit would fill anyway), and hands the results to the pure
      // analyzeFolderProbe for the plain-English warnings.
      probeFolder: async (id, tab = "evidence") => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        const empty: FolderProbeResult = { ok: false, sharedFolder: false, files: [], policyCount: 0, evidenceCount: 0, unreadable: [], warnings: [] };
        if (!folder) return empty;
        const link = tab === "policy" ? folder.policyLink : folder.folderLink;
        const folderId = parseFolderId(link);
        const sharedFolder = !!folder.policyLink && folder.policyLink === folder.folderLink;
        if (!folderId) return { ...empty, listError: `No Drive folder ID in the ${tab === "policy" ? "Policy & Procedure" : "Actual Evidence"} link. Paste a Google Drive folder link.` };
        set({ busy: `probe:${tab}:` + id });
        try {
          const token = useGoogleDriveStore.getState().getValidToken();
          if (!token) return { ...empty, listError: "Not connected to Google Drive — connect it in Settings, then probe again." };
          let listed;
          try {
            listed = await listFolderFilesRecursive(folderId, token);
          } catch (err) {
            const { detail } = classifyDriveReadError(err instanceof Error ? err.message : String(err));
            return { ...empty, listError: detail || (err instanceof Error ? err.message : String(err)) };
          }
          const probeFiles: ProbeFile[] = [];
          const total = listed.length;
          // A vision model makes image-based/scanned PDFs readable (the audit
          // OCRs them), so the pre-flight must classify them accordingly rather
          // than flagging them unreadable. No AI call is made here — the audit
          // does the actual vision extraction.
          const aiForVision = useAISettingsStore.getState();
          const canVision = aiForVision.enabled && !!aiForVision.apiKey;
          for (let fi = 0; fi < listed.length; fi++) {
            const f = listed[fi];
            // Live progress: "Checking file N of TOTAL".
            set({ probeProgress: { folderId: id, current: fi + 1, total } });
            if (IMAGE_MIME_TYPES.has(f.mimeType)) { probeFiles.push({ name: f.path.split("/").pop() || f.path, path: f.path, bucket: classifyFileBucket(f.path), readable: true, driveFileId: f.id }); continue; }
            const cacheKey = `${f.id}:${f.modifiedTime ?? ""}`;
            const cached = get().fileTextCache[cacheKey];
            let readable = true; let readError: string | undefined; let readVia: "vision" | undefined;
            if (cached) {
              readable = !!cached.text;
              if (cached.readMethod === "vision") readVia = "vision";
            } else {
              try {
                const readToken = await useGoogleDriveStore.getState().getFreshToken();
                if (!readToken) { readable = false; readError = "Drive token could not be refreshed."; }
                else {
                  const body = await exportFileText(f, readToken, timeoutSignal(undefined, DRIVE_FILE_TIMEOUT_MS));
                  const hasText = body != null && body.trim().length > 0;
                  // Image-based/scanned PDF: near-zero extractable typed text. The
                  // real audit reads these through the vision path, so mark them
                  // readable-via-vision when a vision model is available — only
                  // genuinely unreadable when it is not. (Same trigger the audit
                  // uses: classifyPdfTextQuality === "none".)
                  const isImagePdf = f.mimeType === "application/pdf" && classifyPdfTextQuality(body ?? "").extractedTextQuality === "none";
                  if (isImagePdf) {
                    if (canVision) { readable = true; readVia = "vision"; }
                    else { readable = false; readError = "Image-based/scanned PDF — enable AI + an API key in Settings so the audit can read it via vision."; }
                  } else {
                    readable = hasText;
                    if (!hasText) readError = "No extractable text.";
                  }
                  // Only cache a genuine (non-empty) extraction — never lock in a
                  // blank read or clobber a good vision transcription with "".
                  if (hasText) {
                    const text = body!;
                    set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: f.mimeType, fileName: f.path.split("/").pop() || f.path, filePath: f.path, cachedAt: Date.now(), readMethod: "text" } } }));
                  }
                }
              } catch (err) {
                readable = false;
                readError = classifyDriveReadError(err instanceof Error ? err.message : String(err)).detail || (err instanceof Error ? err.message : String(err));
              }
            }
            probeFiles.push({ name: f.path.split("/").pop() || f.path, path: f.path, bucket: classifyFileBucket(f.path), readable, readError, driveFileId: f.id, ...(readVia ? { readVia } : {}) });
          }
          return analyzeFolderProbe(probeFiles, sharedFolder);
        } finally {
          set({ busy: null, probeProgress: null });
        }
      },

      // Classic single-pass folder audit. Reads every supported document in
      // the folder via the real Drive API, judges the checklist lines for this
      // sub-criterion against that real text (live OpenAI when configured,
      // offline keyword heuristic otherwise), and writes the verdicts straight
      // into the Sub-Criterion Checklist.
      //
      // REDUNDANCY FLAG (dead-code audit, kept because it is still REACHABLE):
      // this single-pass engine (via runLiveFolderAudit) duplicates the newer
      // canonical staged engine (auditFolderStaged / runOptionAFullAuto — three
      // sequential APSR passes + mode-awareness). The per-folder "Run audit"
      // button on the Evidence Folder page now uses auditFolderStaged; this
      // classic path survives ONLY as the Dashboard bulk sweeps
      // (auditAllFolders / auditChangedFolders → "Audit all folders" /
      // "Re-audit changed only"). It is therefore a consolidation candidate:
      // if those Dashboard sweeps are re-pointed at the staged engine, this
      // action and runLiveFolderAudit can be retired. Left in place for now so
      // no reachable feature is removed.
      auditFolderContents: async (id, extraContext, overallProgress) => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        // See runPPDReview: no run without a named auditor.
        const auditorGate = checkAuditorForRun(s.auditors, s.activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        set({ busy: "folderaudit" + id, auditBlockedReason: null });
        // Capture the cancellation token at start — if cancelBusy() is called
        // while the AI call is in flight, this value will no longer match
        // get().auditRunToken and the results will be discarded without writing.
        const capturedToken = get().auditRunToken;
        const scope = get().auditScope;

        // Emits a progress update so the UI step-indicator and progress bar
        // reflect the current stage in real time. Merges into the existing
        // auditProgress so persistent fields (filesFound, connectInfo, etc.)
        // survive stage transitions without needing to be re-emitted each time.
        const setProgress = (stage: AuditProgressState["stage"], extra?: Partial<AuditProgressState>) => {
          set((st) => {
            const prev = st.auditProgress?.folderId === id ? st.auditProgress : {};
            return {
              auditProgress: {
                ...prev,
                folderId: id,
                folderName: folder.folderName,
                subCriterionId: folder.subCriterionId,
                overallCurrent: overallProgress?.current,
                overallTotal: overallProgress?.total,
                stage,
                // Reset per-file transient fields so they don't bleed across stages.
                currentFileName: undefined,
                currentFileBucket: undefined,
                currentFileAction: undefined,
                stageDetail: undefined,
                errorMessage: undefined,
                ...extra,
              } as AuditProgressState,
            };
          });
        };
        // Track whether this run ended in error so finish() can set the right
        // terminal stage (complete vs error) without needing an extra parameter.
        let auditHadError = false;
        const auditStartedAt = Date.now();
        setProgress("listing", {
          stageDetail: "Listing Drive folder files…",
          status: "running",
          canCancel: true,
          startedAt: auditStartedAt,
          lastHeartbeatAt: auditStartedAt,
        });

        // Safety net: any unexpected exception that escapes the inner
        // try/catches calls finish() with the error message so the button
        // never gets stuck on "Auditing…" indefinitely.
        try {
        // Newest file modifiedTime seen this run; recorded so a later
        // "re-audit only changed" pass can skip folders that haven't changed.
        let newestModified: string | undefined;

        // One short id for this whole run, stamped on the result row, the AI
        // Review Log entry, every checklist evidence item created, and the
        // journal entry — so any verdict can be traced back to its source run.
        const runId = makeRunId(folder.subCriterionId);

        // The auditor this run is on behalf of: the chosen "active" auditor,
        // else the Audit Lead, else the first auditor. Their strictness drives
        // the AI; their name is stamped on the result so it's attributed to a
        // person, not just "AI".
        const actingAuditor =
          s.auditors.find((a) => a.id === get().activeAuditorId) ||
          s.auditors.find((a) => a.role === "Audit Lead") ||
          s.auditors[0];
        const auditorName = actingAuditor?.name || "Unassigned (no auditor set up)";
        const auditorStrictness = actingAuditor ? strictnessFromScore(actingAuditor.strictness) : undefined;
        const auditorLabel = actingAuditor ? `${auditorName} (strictness: ${auditorStrictness})` : auditorName;

        const finish = (summary: string, live: boolean, liveError?: string, usage?: AIUsage, auxUsage?: AIUsage) => {
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Evidence Intake Assistant",
            reviewType: "Evidence",
            subjectId: folder.subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Spot-check the auto-set checklist lines against the source documents.",
            live,
            liveError,
            generatedContent: summary,
            createdAt: new Date().toISOString(),
            runId,
            // Analysis model (verdict call)
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: (usage?.totalTokens || 0) + (auxUsage?.totalTokens || 0) || undefined,
            // Utility model (image + condense calls) — stored separately so the
            // AI Review Log can price each model at its own rate.
            auxModel: auxUsage?.model,
            auxPromptTokens: auxUsage?.promptTokens,
            auxCompletionTokens: auxUsage?.completionTokens,
            auxTotalTokens: auxUsage?.totalTokens,
          };
          const terminalStage = (auditHadError || liveError) ? "error" : "complete";
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: summary, lastAuditLive: live, lastAuditError: liveError, lastAuditNewestModified: newestModified ?? f.lastAuditNewestModified, lastAuditRunId: runId, lastAuditAuditor: auditorLabel, lastAuditScope: scope } : f)),
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 500),
            busy: null,
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: terminalStage, stageDetail: undefined, errorMessage: liveError }
              : st.auditProgress,
          }));
        };

        const evidenceId = parseFolderId(folder.folderLink);
        const policyId = parseFolderId(folder.policyLink);
        // getFreshToken (not getValidToken) — see runPPDReview's identical
        // comment: refreshes a near-/already-expired token before the
        // listing call that follows.
        const token = await useGoogleDriveStore.getState().getFreshToken();
        const drive = checkDriveForRun(!!(evidenceId || policyId), !!token);
        if (drive) {
          auditHadError = true;
          set({ driveBlockedReason: { ...drive, subCriterionId: folder.subCriterionId } });
          finish(drive.message, false);
          return;
        }
        set({ driveBlockedReason: null });
        if (!token) { auditHadError = true; finish(DRIVE_EXPIRED_MID_RUN, false, DRIVE_EXPIRED_MID_RUN); return; } // should be unreachable past the guard; never strand busy

        const items = GD4_REQUIREMENTS.filter((r) => itemIdsForScope(folderScopeId(folder)).includes(r.id));
        if (items.length === 0) {
          auditHadError = true;
          finish("No GD4 items map to this sub-criterion, so there is nothing to audit.", false);
          return;
        }

        // Auto-generate the checklist lines for any item that has none, so a
        // single "Run audit" covers generate → read → score without a separate
        // trip to the Sub-Criterion Checklist page. Generated lines are
        // confirmed straight in and stay fully editable there afterward.
        for (const item of items) {
          const existing = useChecklistModuleStore.getState().entries[item.id];
          if (!existing || existing.specific.length === 0) {
            try {
              await useChecklistModuleStore.getState().generateSpecific(item.id);
              useChecklistModuleStore.getState().confirmGenerated(item.id);
            } catch {
              // Generation failure (AI down, etc.) is non-fatal — the item
              // simply contributes no lines and is reported as such below.
            }
          }
        }

        const checklistEntries = useChecklistModuleStore.getState().entries;
        const lineOwners = new Map<string, string>(); // lineId -> itemId
        const lines: { id: string; text: string }[] = [];
        for (const item of items) {
          const entry = checklistEntries[item.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            lines.push({ id: line.id, text: line.text });
            lineOwners.set(line.id, item.id);
          }
        }
        if (lines.length === 0) {
          auditHadError = true;
          finish("Could not generate any checklist lines to audit against — check AI Settings, or add lines manually on the Sub-Criterion Checklist page.", false);
          return;
        }

        // Gather files from BOTH tab folders, tagging each with its bucket by
        // source folder. If only the evidence folder is linked (legacy / no
        // separate policy folder), fall back to the subfolder-name classifier
        // within it so the old single-folder convention still works.
        type TaggedFile = Awaited<ReturnType<typeof listFolderFilesRecursive>>[number] & { bucket: "policy" | "evidence" | "auto" };
        const taggedFiles: TaggedFile[] = [];
        const listErrors: string[] = [];
        // Setup warnings surfaced in the result summary (configuration problems
        // detected before the AI even runs, e.g. the same folder linked twice).
        const setupWarnings: string[] = [];
        // Non-blocking ISO 19011 independence check: auditor auditing their
        // own department's folder is flagged in the run summary, never blocked.
        const independenceWarn = independenceNotice(auditorGate.auditor, folder.owner);
        if (independenceWarn) setupWarnings.push(independenceWarn);
        const gather = async (fid: string | null, bucket: TaggedFile["bucket"], label: string) => {
          if (!fid) return;
          try {
            const fs = await listFolderFilesRecursive(fid, token);
            for (const f of fs) taggedFiles.push({ ...f, bucket });
          } catch (err) {
            listErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        // Strict two-folder model: the Policy tab and Evidence tab must point to
        // DIFFERENT folders. If the same folder is linked in both, reading it
        // twice would double the file count AND force the AI to grade the policy
        // document as if it were implementation evidence. So read it ONCE and
        // let the subfolder-name classifier decide policy-vs-evidence per file.
        const sameLink = !!policyId && !!evidenceId && policyId === evidenceId;
        if (sameLink) {
          await gather(evidenceId, "auto", "Folder");
          setupWarnings.push(
            "The Policy & Procedure tab and the Actual Evidence tab link the SAME Drive folder, so it was read once (not twice). For a proper audit, link two different folders — one of policies, one of actual records — or organise this folder into '1. Policy & Procedure' and '2. Actual Evidence' subfolders."
          );
        } else {
          await gather(policyId, "policy", "Policy & Procedure");
          await gather(evidenceId, "evidence", policyId ? "Actual Evidence" : "Evidence");
        }
        for (const f of taggedFiles) {
          if (f.modifiedTime && (!newestModified || f.modifiedTime > newestModified)) newestModified = f.modifiedTime;
        }
        // No separate policy folder → let the evidence folder's own subfolders
        // decide policy-vs-evidence (the previous behaviour). Same-link already
        // tagged "auto" above.
        if (!policyId && !sameLink) for (const f of taggedFiles) f.bucket = "auto";

        // Apply audit scope filter — must happen after bucket assignment so
        // the policy/evidence classification is already set on each file.
        if (scope !== "both") {
          const isPolicy = (f: TaggedFile) =>
            f.bucket === "policy" || (f.bucket === "auto" && classifyFileBucket(f.path) === "policy");
          const keep = scope === "policy" ? isPolicy : (f: TaggedFile) => !isPolicy(f);
          const removedCount = taggedFiles.filter((f) => !keep(f)).length;
          taggedFiles.splice(0, taggedFiles.length, ...taggedFiles.filter(keep));
          if (removedCount > 0)
            setupWarnings.push(`Scope "${scope === "policy" ? "Policy only" : "Evidence only"}" — ${removedCount} file${removedCount === 1 ? "" : "s"} from the other folder excluded from this run.`);
        }

        if (taggedFiles.length === 0) {
          auditHadError = true;
          if (listErrors.length) {
            finish(`Could not list the linked folder(s): ${listErrors.join("; ")}.`, false, listErrors.join("; "));
          } else {
            finish("The linked folder(s) contain no files. Add documents to the Drive folder and try again.", false, "Empty folder — no files found");
          }
          return;
        }

        // Resolve school-wide "Additional info" context: the bulk audit reads
        // it once and passes it in; a single Run audit reads it here (best
        // effort, text files only to control cost). undefined extraContext =
        // "read it yourself"; an explicit "" = "skip it".
        let resolvedContext = extraContext;
        if (resolvedContext === undefined) {
          const addId = parseFolderId(get().additionalInfo.link);
          if (addId) {
            try {
              resolvedContext = await readFolderPlainText(addId, token);
            } catch {
              resolvedContext = undefined;
            }
          }
        }

        const aiSettings = useAISettingsStore.getState();
        const schoolCtx = composeSchoolContext(get().schoolContext);
        const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: schoolCtx });
        const visionSettings = effectiveSettings(aiSettings, { purpose: "vision", context: schoolCtx });
        const visionModelId = visionSettings.model;
        const canDescribeImages = aiSettings.enabled && !!aiSettings.apiKey;
        // Each image costs one extra OpenAI vision call — capped separately
        // from the (unbounded) text-file count so a folder full of scanned
        // photos can't turn one "Run audit" click into dozens of API calls.
        // Scanned-PDF pages rendered for the vision fallback draw from the SAME
        // budget (one page = one image), with a per-file page cap on top.
        const MAX_IMAGES = 10;
        const MAX_PDF_VISION_PAGES = 5;
        let imagesDescribed = 0;
        // Tokens spent on the audit's helper AI calls (image descriptions and
        // document condensing) — folded into the audit's total so the log
        // reflects ALL AI used by this run, not just the verdict call.
        let auxUsage: AIUsage | undefined;

        const scanned: string[] = [];
        const skipped: string[] = []; // recognized type, but no text path for it (e.g. video)
        const failed: { path: string; reason: string }[] = []; // tried to read, threw
        // Each chunk keeps its heading (path + file type) so the AI knows a
        // photo from a policy PDF, and its body separately so a big folder can
        // be summarised rather than silently truncated.
        type Part = { heading: string; body: string; isPolicy: boolean; fileIndex: number };
        const parts: Part[] = [];
        let policyCount = 0;
        let evidenceCount = 0;
        const fileKind = (mime: string) =>
          mime === "application/pdf" ? "PDF"
            : mime.includes("wordprocessingml") ? "Word"
            : mime.includes("google-apps.document") ? "Google Doc"
            : mime.includes("google-apps.spreadsheet") ? "Google Sheet"
            : mime === XLSX_MIME ? "Excel"
            : mime === XLS_MIME ? "Excel"
            : mime === "text/csv" ? "CSV"
            : mime.includes("presentationml") ? "PowerPoint"
            : mime.includes("google-apps.presentation") ? "Google Slides"
            : mime.startsWith("image/") ? "image"
            : "text";
        // Evidence chunks are built here and used to:
        // 1. Prefix each document in the docText with a chunk ID so the AI can cite sources
        // 2. Map AI-cited chunk IDs back to file records after verdicts return
        const evidenceChunks: EvidenceChunk[] = [];
        let chunkCounter = 0;
        const inferEvidenceType = (kind: string, bucket: "policy" | "evidence", body: string): EvidenceChunk["evidenceType"] => {
          if (bucket === "policy") return "Policy/Procedure";
          const bodyLower = body.toLowerCase();
          if (kind === "Excel" || kind === "CSV" || kind === "Google Sheet") return "Implementation Record";
          const isOutcome = /outcome|result|trend|survey|feedback|kpi|dashboard|satisfaction/.test(bodyLower);
          const isReview = /review|minute|meeting|decision|improvement|action item|follow.up/.test(bodyLower);
          if (isOutcome) return "Outcome Data";
          if (isReview) return "Review Evidence";
          return "Other";
        };
        // Maximum chars per individual part/chunk. Files larger than this are
        // split into multiple parts (each with its own chunk ID) so no text is
        // lost. Kept well below BATCH_DOC_CAP so a single chunk never exceeds
        // one document window on its own.
        const MAX_PART_CHARS = 24_000;
        const pushPart = (path: string, body: string, bucket: TaggedFile["bucket"], kind: string, fileIndex: number) => {
          const isPolicy = bucket === "policy" || (bucket === "auto" && classifyFileBucket(path) === "policy");
          const resolvedBucket: "policy" | "evidence" = isPolicy ? "policy" : "evidence";
          // Split large files into sub-chunks so no text is ever summarised or dropped.
          const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
          for (let pi = 0; pi < totalParts; pi++) {
            const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
            const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
            const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
            const chunk: EvidenceChunk = {
              chunkId,
              filePath: path,
              fileName: path.split("/").pop() || path,
              bucket: resolvedBucket,
              fileKind: kind,
              text: chunkBody,
              charCount: chunkBody.length,
              evidenceType: inferEvidenceType(kind, resolvedBucket, chunkBody),
            };
            evidenceChunks.push(chunk);
            // Record chunk ID on file record so citations can be traced back
            const existing = fileRecords[fileIndex];
            fileRecords[fileIndex] = { ...existing, chunkIds: [...(existing.chunkIds || []), chunkId] };
            parts.push({ heading: `[CHUNK:${chunkId}] --- ${path}${partLabel} [${kind}] ---`, body: chunkBody, isPolicy, fileIndex });
          }
          if (isPolicy) policyCount++;
          else evidenceCount++;
        };
        const filesTotal = taggedFiles.length;
        // Per-file read timeouts: 30s for text/PDF/doc, 45s for images (includes AI call).
        const FILE_TEXT_TIMEOUT_MS = 30_000;
        const FILE_IMAGE_TIMEOUT_MS = 45_000;
        // Build initial file record list for the progress modal; status updated per-file during read.
        const fileRecords: AuditFileRecord[] = taggedFiles.map((file) => ({
          path: file.path,
          name: file.path.split("/").pop() || file.path,
          mimeType: file.mimeType,
          fileKind: fileKind(file.mimeType),
          bucket: file.bucket,
          readStatus: "found" as const,
          auditStatus: "pending" as const,
          driveFileId: file.id,
          driveModifiedTime: file.modifiedTime,
        }));
        const connectedFolderNames = [policyId ? "Policy & Procedure" : null, evidenceId ? "Actual Evidence" : null].filter(Boolean) as string[];
        setProgress("reading", {
          filesTotal,
          filesRead: 0,
          filesSkipped: 0,
          filesFound: [...fileRecords],
          connectInfo: { foldersLinked: connectedFolderNames.length, folderNames: connectedFolderNames },
          stageDetail: `Reading file 1 of ${filesTotal}…`,
          status: "running",
          canCancel: true,
          lastHeartbeatAt: Date.now(),
          scope,
        });
        for (let fi = 0; fi < taggedFiles.length; fi++) {
          const file = taggedFiles[fi];
          const fileActionHint =
            file.mimeType === "application/pdf" ? "Extracting PDF text" :
            file.mimeType.includes("wordprocessingml") ? "Extracting Word document" :
            file.mimeType.includes("google-apps.document") ? "Fetching Google Doc" :
            file.mimeType.includes("google-apps.spreadsheet") || file.mimeType === "text/csv" ? "Reading spreadsheet" :
            file.mimeType.includes("presentationml") ? "Extracting PowerPoint text" :
            file.mimeType.includes("google-apps.presentation") ? "Reading presentation" :
            file.mimeType.startsWith("image/") ? "Describing image with AI" :
            "Reading document";
          const resolvedBucket: AuditProgressState["currentFileBucket"] =
            file.bucket === "policy" ? "policy" :
            file.bucket === "evidence" ? "evidence" :
            file.bucket === "auto" ? (classifyFileBucket(file.path) === "policy" ? "policy" : "evidence") :
            undefined;
          fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
          // Heartbeat: update per-file so the stuck-guard can detect hangs.
          const isImage = IMAGE_MIME_TYPES.has(file.mimeType);
          setProgress("reading", {
            filesTotal,
            filesRead: fi,
            filesSkipped: skipped.length,
            filesFound: [...fileRecords],
            currentFileName: file.path.split("/").pop() || file.path,
            currentFileBucket: resolvedBucket,
            currentFileAction: fileActionHint,
            stageDetail: `Reading file ${fi + 1} of ${filesTotal}: ${file.path.split("/").pop() || file.path}`,
            lastHeartbeatAt: Date.now(),
            canSkipCurrentFile: true,
          });

          // File caching: if we have previously extracted text for this exact
          // file+version, reuse it and skip the Drive download entirely.
          const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
          const cachedEntry = get().fileTextCache[cacheKey];
          // A PDF cached with ~no text (from before the vision fallback existed,
          // or a run with no key) must NOT be reused as empty when we could now
          // read it via vision — treat it as a cache miss and re-read.
          const cacheIsEmptyScannedPdf = !!cachedEntry && file.mimeType === "application/pdf" && (cachedEntry.text ?? "").trim().length < 50;
          // A cached VISION read done by a different vision model is stale — the
          // user switched models to get a better/worse transcription, so re-read
          // rather than serving the old model's output.
          const cacheStaleVision = !!cachedEntry && cachedEntry.readMethod === "vision" && cachedEntry.visionModel !== visionModelId;
          if (cachedEntry && !(cacheIsEmptyScannedPdf && canDescribeImages) && !(cacheStaleVision && canDescribeImages)) {
            fileRecords[fi] = {
              ...fileRecords[fi],
              readStatus: "read",
              charCount: cachedEntry.charCount,
              processingMode: "reused",
              ...(cachedEntry.readMethod ? { readMethod: cachedEntry.readMethod } : {}),
              ...(cachedEntry.pdfQuality ? {
                suspectedScannedPdf: cachedEntry.pdfQuality.suspectedScannedPdf,
                extractedTextQuality: cachedEntry.pdfQuality.extractedTextQuality,
              } : {}),
            };
            if (cachedEntry.text !== null) {
              pushPart(file.path, cachedEntry.text, file.bucket, cachedEntry.fileKind, fi);
              scanned.push(file.path);
            } else {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
            }
            setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
            continue;
          }

          // Drive tokens last ~1 hour; a long multi-file run WILL cross that.
          // Refresh silently before each uncached read — and HARD-STOP if a
          // fresh token can't be minted, so the run never silently skips the
          // remaining files and scores "no evidence" against unread evidence.
          // This await sits OUTSIDE the per-file read race below, so it gets
          // its own honest stage label + Skip wiring: the server-side refresh
          // call (drive-oauth Edge Function) can stall (bounded by
          // callDriveOauth's 15s watchdog in useGoogleDriveStore.ts — this
          // exact spot once froze a real run for 98 minutes under the old
          // client-only GIS silent-reauth flow, with the UI blaming the
          // innocent file whose name was already on screen).
          setProgress("reading", { stageDetail: `Refreshing Google Drive access (before reading ${file.path.split("/").pop() || file.path})…`, lastHeartbeatAt: Date.now() });
          const TOKEN_WAIT_SKIPPED = Symbol("token-wait-skipped");
          let skipTokenWait!: () => void;
          const tokenWaitSkip = new Promise<typeof TOKEN_WAIT_SKIPPED>((resolve) => { skipTokenWait = () => resolve(TOKEN_WAIT_SKIPPED); });
          _currentFileAbort = skipTokenWait;
          const tokenResult = await Promise.race([useGoogleDriveStore.getState().getFreshToken(), tokenWaitSkip]);
          _currentFileAbort = null;
          if (tokenResult === TOKEN_WAIT_SKIPPED) {
            skipped.push(file.path);
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: "Skipped by user" };
            setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length, lastHeartbeatAt: Date.now() });
            continue;
          }
          const readToken = tokenResult;
          if (!readToken) {
            auditHadError = true;
            finish(DRIVE_EXPIRED_MID_RUN, false, DRIVE_EXPIRED_MID_RUN);
            return;
          }

          // Per-file abort: allows skipCurrentFile() and cancelBusy() to break
          // out of the current Drive download or AI description call immediately.
          const fileAbort = new AbortController();
          // Office files (.pptx/.docx/.xlsx) can carry embedded pictures that are
          // now transcribed via vision, so they get the longer image timeout —
          // one text read plus a few vision calls won't fit the 30s text budget.
          const officeMayEmbed = file.mimeType.includes("presentationml") || file.mimeType.includes("wordprocessingml") || file.mimeType === XLSX_MIME;
          const fileTimeoutMs = isImage || officeMayEmbed ? FILE_IMAGE_TIMEOUT_MS : FILE_TEXT_TIMEOUT_MS;
          let fileTimeoutTimer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => {
            fileTimeoutTimer = setTimeout(() => {
              fileAbort.abort();
              reject(new Error("FILE_TIMEOUT"));
            }, fileTimeoutMs);
          });
          _currentFileAbort = () => { clearTimeout(fileTimeoutTimer); fileAbort.abort(); };

          type FileReadResult =
            | { kind: "text"; text: string; pdfQuality?: ReturnType<typeof classifyPdfTextQuality>; visionModel?: string }
            | { kind: "image"; description: string }
            | { kind: "pdfVision"; text: string }
            | { kind: "unreadable"; reason: string }
            | { kind: "capped"; reason: string }
            | { kind: "skip" };

          // Embedded-image vision hook for office files. Transcribes pasted
          // pictures through the SAME vision path as standalone images, honouring
          // the run's MAX_IMAGES budget plus a per-file cap (mirroring the
          // scanned-PDF page cap) so one image-heavy file can't drain the budget
          // or blow the file timeout. Reports images skipped for the cap so they
          // are flagged, never silently dropped.
          let embeddedVisionModel: string | undefined;
          const embeddedImageHook = canDescribeImages
            ? async (images: { location: string; dataUrl: string }[]) => {
                const transcripts: { location: string; text: string }[] = [];
                let skippedForCapCount = 0;
                let usedThisFile = 0;
                for (const img of images) {
                  if (usedThisFile >= MAX_PDF_VISION_PAGES || imagesDescribed >= MAX_IMAGES) { skippedForCapCount++; continue; }
                  imagesDescribed++; usedThisFile++;
                  const d = await describeImage(img.dataUrl, visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
                  if (d.trim()) { transcripts.push({ location: img.location, text: d.trim() }); embeddedVisionModel = visionModelId; }
                }
                return { transcripts, skippedForCapCount };
              }
            : undefined;

          const readPromise = (async (): Promise<FileReadResult> => {
            const text = await exportFileText(file, readToken, fileAbort.signal, embeddedImageHook);
            if (text !== null) {
              if (file.mimeType === "application/pdf") {
                const pdfQuality = classifyPdfTextQuality(text);
                // Vision fallback ONLY when text extraction genuinely failed
                // (near-zero chars = scanned/image-only PDF). A normal text PDF
                // keeps the fast, cheap text path.
                if (pdfQuality.extractedTextQuality === "none") {
                  return await readScannedPdfViaVision(readToken);
                }
                return { kind: "text", text, pdfQuality };
              }
              // Office file whose embedded pictures were transcribed via vision
              // carries the vision model so the cache is stamped correctly (and
              // re-read when the user switches vision model).
              return { kind: "text", text, visionModel: embeddedVisionModel };
            }
            if (isImage && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, readToken, fileAbort.signal);
              const description = await describeImage(dataUrl, visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              return { kind: "image", description };
            }
            return { kind: "skip" };
          })();

          // Scanned/image-only PDF → render pages and read them through the same
          // vision path as standalone images. Never returns silent empty text:
          // the file is either read via vision, flagged unreadable, or flagged
          // as skipped-for-cap — always with a reason.
          async function readScannedPdfViaVision(token: string): Promise<FileReadResult> {
            if (!canDescribeImages) {
              return { kind: "unreadable", reason: "Scanned/image-only PDF: no text could be extracted, and no vision model is available (enable AI and add an API key in Settings)." };
            }
            if (imagesDescribed >= MAX_IMAGES) {
              return { kind: "capped", reason: `Scanned/image-only PDF not read: the ${MAX_IMAGES}-image vision budget for this run was reached.` };
            }
            const pagesToRender = Math.min(MAX_PDF_VISION_PAGES, MAX_IMAGES - imagesDescribed);
            const { images, totalPages } = await exportPdfPageImages(file, token, pagesToRender, fileAbort.signal);
            if (images.length === 0) {
              return { kind: "unreadable", reason: "Scanned/image-only PDF: no text could be extracted and its pages could not be rendered for vision." };
            }
            const parts: string[] = [];
            for (let p = 0; p < images.length; p++) {
              imagesDescribed++;
              const d = await describeImage(images[p], visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              if (d.trim()) parts.push(images.length > 1 ? `--- Page ${p + 1} ---\n${d.trim()}` : d.trim());
            }
            if (parts.length === 0) {
              return { kind: "unreadable", reason: "Scanned/image-only PDF: rendered pages produced no readable text via the vision model." };
            }
            const capNote = totalPages > images.length
              ? `\n\n[Vision transcription of the first ${images.length} of ${totalPages} pages — page/image budget reached; later pages were not read.]`
              : "";
            return { kind: "pdfVision", text: parts.join("\n\n") + capNote };
          }

          let fileResult: FileReadResult;
          try {
            fileResult = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
          } catch (err) {
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
            const wasAborted = fileAbort.signal.aborted;
            if (wasAborted || (err instanceof Error && err.message === "FILE_TIMEOUT")) {
              const skipReason = (err instanceof Error && err.message === "FILE_TIMEOUT")
                ? `Timed out after ${fileTimeoutMs / 1000}s`
                : "Skipped by user";
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason };
              continue;
            }
            // Genuine read error — mark failed but do not abort the whole audit.
            const failReason = err instanceof Error ? err.message : String(err);
            failed.push({ path: file.path, reason: failReason });
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "failed", failReason };
            continue;
          }

          // Apply the successful read result.
          switch (fileResult.kind) {
            case "text": {
              scanned.push(file.path);
              pushPart(file.path, fileResult.text, file.bucket, fileKind(file.mimeType), fi);
              // An office file whose embedded pictures were transcribed via
              // vision is recorded as a vision read (and stamped with the model)
              // so the ledger reflects it and a vision-model switch re-reads it.
              const textUsedVision = !!fileResult.visionModel;
              fileRecords[fi] = {
                ...fileRecords[fi],
                readStatus: "read",
                charCount: fileResult.text.length,
                processingMode: "new",
                readMethod: textUsedVision ? "vision" : "text",
                ...(fileResult.pdfQuality ? { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } : {}),
              };
              // Cache the extracted text so repeat audits can skip re-downloading
              // unchanged files — but only a genuine (non-empty) read. A 0-char
              // extraction is a failed read and must NOT be cached as a success,
              // or it would lock in the blank and never be re-attempted.
              if (fileResult.text.trim().length > 0) {
                set((st) => ({
                  fileTextCache: {
                    ...st.fileTextCache,
                    [cacheKey]: {
                      text: fileResult.text,
                      charCount: fileResult.text.length,
                      fileKind: fileKind(file.mimeType),
                      fileName: file.path.split("/").pop() || file.path,
                      filePath: file.path,
                      cachedAt: Date.now(),
                      readMethod: textUsedVision ? "vision" : "text",
                      ...(textUsedVision ? { visionModel: fileResult.visionModel } : {}),
                      ...(fileResult.pdfQuality ? { pdfQuality: { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } } : {}),
                    },
                  },
                }));
              }
              break;
            }
            case "image":
              scanned.push(file.path);
              pushPart(file.path, fileResult.description, file.bucket, "image", fi);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: fileResult.description.length, processingMode: "new", readMethod: "vision" };
              // Cache the vision transcription (stamped with the vision model so a
              // model switch re-reads) — only when non-empty. Previously bulk-audit
              // images were never cached and got re-charged to vision every run.
              if (fileResult.description.trim().length > 0) {
                set((st) => ({
                  fileTextCache: {
                    ...st.fileTextCache,
                    [cacheKey]: {
                      text: fileResult.description,
                      charCount: fileResult.description.length,
                      fileKind: "image",
                      fileName: file.path.split("/").pop() || file.path,
                      filePath: file.path,
                      cachedAt: Date.now(),
                      readMethod: "vision",
                      visionModel: visionModelId,
                    },
                  },
                }));
              }
              break;
            case "pdfVision": {
              // Scanned PDF read via the vision fallback — treat the transcription
              // as the file's text and CACHE it, so the expensive vision pass is
              // not repeated on every re-audit of an unchanged file.
              scanned.push(file.path);
              const q = classifyPdfTextQuality(fileResult.text);
              pushPart(file.path, fileResult.text, file.bucket, "PDF", fi);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: fileResult.text.length, processingMode: "new", readMethod: "vision", suspectedScannedPdf: false, extractedTextQuality: q.extractedTextQuality };
              if (fileResult.text.trim().length > 0) {
                set((st) => ({
                  fileTextCache: {
                    ...st.fileTextCache,
                    [cacheKey]: {
                      text: fileResult.text,
                      charCount: fileResult.text.length,
                      fileKind: "PDF",
                      fileName: file.path.split("/").pop() || file.path,
                      filePath: file.path,
                      cachedAt: Date.now(),
                      readMethod: "vision",
                      visionModel: visionModelId,
                      pdfQuality: { suspectedScannedPdf: false, extractedTextQuality: q.extractedTextQuality },
                    },
                  },
                }));
              }
              break;
            }
            case "unreadable":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: fileResult.reason };
              break;
            case "capped":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: fileResult.reason };
              break;
            case "skip":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
              break;
          }
        }
        // Reading stage complete: clear per-file controls.
        setProgress("reading", { canSkipCurrentFile: false, lastHeartbeatAt: Date.now() });

        // Pre-flight: if nothing was readable, tell the user clearly and skip the
        // AI call entirely — an empty prompt would waste tokens and return junk.
        if (scanned.length === 0) {
          auditHadError = true;
          const reason = failed.length
            ? `Could not read any files (${failed.length} file${failed.length === 1 ? "" : "s"} failed, e.g. ${failed[0].reason}). Check that the folder contains supported document types (PDF, Word, Google Docs).`
            : skipped.length
            ? `No readable document content found — ${skipped.length} file${skipped.length === 1 ? "" : "s"} are media or unsupported types. Add PDF, Word, or Google Docs files.`
            : "No readable files were found in the linked folder(s). Add documents and try again.";
          finish(reason, false, reason);
          return;
        }

        // School-wide context is background only — cap it so a large
        // Additional-info folder can't eat the whole audit budget (and push
        // the real evidence past the cap).
        const CONTEXT_CAP = 6000;
        if (resolvedContext && resolvedContext.length > CONTEXT_CAP) resolvedContext = resolvedContext.slice(0, CONTEXT_CAP);

        // Full-folder coverage: if the combined text would overflow the audit
        // cap, condense each document (utility model) instead of dropping
        // everything past the cap. The budget reserves room for each chunk's
        // heading, the section markers and the school-wide context so the
        // FINAL docText lands UNDER FOLDER_DOC_CAP — meaning the audit never has
        // to re-truncate, and no misleading "files may be missing" note fires
        // when in fact every document was read and condensed.
        // Audit journal: prior findings from this workspace, fed in so the AI
        // can spot cross-criterion recurring gaps (Review not documented in 1.1,
        // 2.1, 3.1 → systemic gap worth calling out). Capped so it doesn't eat
        // the document budget; excluded for this sub-criterion's own prior entry
        // (that's replaced at the end of this run anyway).
        const JOURNAL_AI_CAP = 2000;
        const priorJournal = get().auditJournal.trim();
        const journalBlock = priorJournal
          ? `=== PRIOR AUDIT FINDINGS (other sub-criteria already audited in this workspace — use for cross-criterion pattern awareness; judge THIS sub-criterion on its own evidence) ===\n${priorJournal.slice(-JOURNAL_AI_CAP)}`
          : "";

        // Build document windows instead of condensing. Each window contains
        // a subset of parts that fits within BATCH_DOC_CAP chars so no file
        // is ever summarised or dropped — the audit just runs more passes.
        // Parts are kept in order (policy first, evidence second) so each
        // window has the correct POLICY / ACTUAL EVIDENCE sections.
        const fixedPrefix = [
          journalBlock,
          resolvedContext ? `=== SCHOOL-WIDE CONTEXT (general supporting documents — background only, not primary evidence for this sub-criterion) ===\n${resolvedContext}` : "",
        ].filter(Boolean).join("\n\n");
        const fixedPrefixLen = fixedPrefix.length + (fixedPrefix ? 2 : 0);

        // Build windows: pack parts greedily by size so each window fits.
        const WINDOW_BODY_CAP = FOLDER_DOC_CAP - fixedPrefixLen - 200; // 200 ≈ section markers
        const docWindows: string[] = [];
        let winParts: typeof parts = [];
        let winSize = 0;
        const flushWindow = () => {
          if (winParts.length === 0) return;
          const winPolicyText = winParts.filter((p) => p.isPolicy).map((p) => `${p.heading}\n${p.body}`).join("\n\n");
          const winEvidText  = winParts.filter((p) => !p.isPolicy).map((p) => `${p.heading}\n${p.body}`).join("\n\n");
          const win = [
            fixedPrefix,
            winPolicyText ? `=== POLICY & PROCEDURE ===\n${winPolicyText}` : "",
            winEvidText   ? `=== ACTUAL EVIDENCE ===\n${winEvidText}`       : "",
          ].filter(Boolean).join("\n\n");
          docWindows.push(win);
          winParts = [];
          winSize = 0;
        };
        for (const p of parts) {
          const partSize = p.heading.length + p.body.length + 2;
          if (winParts.length > 0 && winSize + partSize > WINDOW_BODY_CAP) flushWindow();
          winParts.push(p);
          winSize += partSize;
        }
        flushWindow();
        // Fallback: if no parts at all, one empty window so the AI still runs
        // and returns "Not evident" for all lines (consistent with prior behaviour).
        if (docWindows.length === 0) docWindows.push(fixedPrefix || "");

        // The official GD4 standard for this sub-criterion, so the AI judges
        // each line against what is actually required, not just its wording.
        const standard = items
          .map((it) => `GD4 ${it.id} — ${it.requirement}\nIntent: ${it.intent}\nDescribe/Show:\n${it.describeShow.map((d) => `- ${d}`).join("\n")}${it.notes.length ? `\nNotes:\n${it.notes.map((n) => `- ${n}`).join("\n")}` : ""}\nExpected evidence: ${it.expectedEvidence.join("; ")}`)
          .join("\n\n");

        // The acting auditor's own strictness drives the audit; only when no
        // auditor exists do we fall back to the global AI strictness setting.
        const strictness = auditorStrictness || useScoringConfigStore.getState().aiStrictness;
        // Merges verdicts from multiple document windows per checklist line.
        // Takes the best APSR status across all windows (most favourable) and
        // unions sourceChunkIds + sources. Notes from different windows are
        // concatenated so the auditor sees analysis from every document pass.
        const mergeWindowVerdicts = (allWindows: ReturnType<typeof simulateFolderAudit>[]): ReturnType<typeof simulateFolderAudit> => {
          const byId = new Map<string, ReturnType<typeof simulateFolderAudit>[number]>();
          for (const window of allWindows) {
            for (const v of window) {
              const ex = byId.get(v.lineId);
              if (!ex) { byId.set(v.lineId, { ...v, apsr: v.apsr ? { ...v.apsr, approach: { ...v.apsr.approach }, processes: { ...v.apsr.processes }, systemsOutcomes: { ...v.apsr.systemsOutcomes }, review: { ...v.apsr.review } } : undefined }); continue; }
              if (!v.apsr || !ex.apsr) { byId.set(v.lineId, ex); continue; }
              const bestLeg = <T extends string>(a: { status: T; note: string; sourceChunkIds?: string[] }, b: { status: T; note: string; sourceChunkIds?: string[] }, order: T[]) => {
                const ai = order.indexOf(a.status), bi = order.indexOf(b.status);
                const winner = ai <= bi ? a : b, loser = ai <= bi ? b : a;
                const note = winner.note && loser.note && winner.note !== loser.note ? `${winner.note} | ${loser.note}` : winner.note || loser.note;
                return { status: winner.status, note, sourceChunkIds: [...new Set([...(a.sourceChunkIds ?? []), ...(b.sourceChunkIds ?? [])])] };
              };
              const merged = {
                ...ex,
                apsr: {
                  approach:       bestLeg(ex.apsr.approach,       v.apsr.approach,       ["Meeting", "Beginning", "Not evident"] as const),
                  processes:      bestLeg(ex.apsr.processes,      v.apsr.processes,      ["Deployed", "Weak", "Not evident"] as const),
                  systemsOutcomes:bestLeg(ex.apsr.systemsOutcomes,v.apsr.systemsOutcomes,["Evident", "Limited", "Not evident"] as const),
                  review:         bestLeg(ex.apsr.review,         v.apsr.review,         ["Evident", "Not evident"] as const),
                },
                sources: [...new Set([...(ex.sources ?? []), ...(v.sources ?? [])])],
              };
              merged.status = deriveApsrStatus(merged.apsr);
              merged.reason = apsrReason(merged.apsr);
              byId.set(v.lineId, merged);
            }
          }
          return Array.from(byId.values());
        };

        let verdicts: ReturnType<typeof simulateFolderAudit>;
        let live = false;
        let liveError: string | undefined;
        let challenged = false;
        let truncationNote: string | undefined;
        let parseWarnings: string[] = [];
        let folderWarnings: string[] = [];
        let auditUsage: AIUsage | undefined;
        let verdictLines: AuditAISummaryLine[] = [];
        let timedOutCount = 0;
        const windowCount = docWindows.length;
        const batchTotal = Math.ceil(lines.length / 4) * windowCount; // AUDIT_BATCH_SIZE = 4
        if (aiSettings.enabled && aiSettings.apiKey) {
          setProgress("auditing", { batchCurrent: 0, batchTotal, auditLive: true, filesFound: [...fileRecords], stageDetail: windowCount > 1 ? `Starting AI audit (${windowCount} document windows)…` : "Starting AI audit…" });
          try {
            // Run one full audit per document window, then merge best-of across windows.
            let globalBatchDone = 0;
            const auditCalibration = selectLineStatusCalibration(get().calibrationExamples);
            const auditMemories = selectLineStatusMemories(get().calibrationMemories);
            // Record that these examples/memories fed a live audit run so the AI
            // Memories page shows real usage counts (see incrementMemoryUsage /
            // markCalibrationUsed). Once per run, before the per-window loop.
            if (auditCalibration.length) get().markCalibrationUsed(auditCalibration.map((e) => e.id));
            auditMemories.forEach((m) => get().incrementMemoryUsage(m.id));
            const windowResults = await Promise.all(
              docWindows.map((docWindow, wi) =>
                runLiveFolderAudit(lines, docWindow, analysisSettings, {
                  strictness,
                  standard,
                  criterionId: folder.subCriterionId,
                  calibration: auditCalibration,
                  memories: auditMemories,
                  onBatchProgress: (current, total) => {
                    globalBatchDone++;
                    setProgress("auditing", {
                      batchCurrent: globalBatchDone,
                      batchTotal,
                      stageDetail: windowCount > 1
                        ? `AI audit window ${wi + 1}/${windowCount}, batch ${current}/${total}…`
                        : total > 1 ? `AI audit batch ${current} of ${total}…` : "Running AI audit…",
                    });
                  },
                })
              )
            );
            verdicts = mergeWindowVerdicts(windowResults.map((r) => r.verdicts));
            truncationNote = windowResults.find((r) => r.truncationNote)?.truncationNote;
            parseWarnings = windowResults.flatMap((r) => r.parseWarnings);
            folderWarnings = [...new Set(windowResults.flatMap((r) => r.folderWarnings))];
            auditUsage = windowResults.reduce<AIUsage | undefined>((acc, r) => addUsage(acc, r.usage), undefined);
            // A line that timed out in one window may still have been assessed
            // in another — only lines with NO verdict anywhere count as not
            // assessed. Failed batches produce no verdicts at all now (never a
            // fabricated "Not met" placeholder), so these lines are simply
            // absent from `verdicts`: nothing is written to the checklist for
            // them and no findings are raised.
            const assessedLineIds = new Set(verdicts.map((v) => v.lineId));
            const timedOutIds = [...new Set(windowResults.flatMap((r) => r.timedOutLineIds ?? []))].filter((lid) => !assessedLineIds.has(lid));
            timedOutCount = timedOutIds.length;
            if (timedOutCount > 0) {
              folderWarnings = [
                ...folderWarnings,
                `${timedOutCount} checklist line${timedOutCount === 1 ? "" : "s"} could not be audited — the AI call failed/timed out after retrying. Those lines were NOT assessed: their previous checklist status is unchanged and no findings were raised for them. Re-run the audit to assess them.`,
              ];
            }
            // Strict mode: challenge pass runs against the first (largest) window.
            if (strictness === "Strict") {
              const toChallenge = verdicts.filter((v) => v.status !== "Not met").map((v) => ({ lineId: v.lineId, status: v.status }));
              if (toChallenge.length) {
                setProgress("auditing", { stageDetail: "Running strict challenge pass…" });
                try {
                  const r2 = await runLiveFolderAudit(lines, docWindows[0], analysisSettings, { strictness, standard, criterionId: folder.subCriterionId, challenge: toChallenge, calibration: auditCalibration, memories: auditMemories });
                  // Challenge results replace first-pass verdicts per line, but a
                  // line the challenge pass failed to re-assess (its batch timed
                  // out → no verdict at all now) KEEPS its first-pass verdict —
                  // never lose an assessed verdict to a failed re-check.
                  const challengeByLine = new Map(r2.verdicts.map((v) => [v.lineId, v]));
                  const firstPassIds = new Set(verdicts.map((v) => v.lineId));
                  verdicts = [
                    ...verdicts.map((v) => challengeByLine.get(v.lineId) ?? v),
                    // A line the FIRST pass failed on but the challenge pass assessed
                    // is recovered here rather than dropped.
                    ...r2.verdicts.filter((v) => !firstPassIds.has(v.lineId)),
                  ];
                  parseWarnings = [...parseWarnings, ...r2.parseWarnings];
                  folderWarnings = [...new Set([...folderWarnings, ...r2.folderWarnings])];
                  auditUsage = addUsage(auditUsage, r2.usage);
                  if (r2.timedOutLineIds?.length) {
                    folderWarnings = [...new Set([...folderWarnings, `${r2.timedOutLineIds.length} line(s) timed out in the strict challenge pass — first-pass verdicts kept for those lines.`])];
                  }
                  challenged = true;
                } catch {
                  // keep multi-window merged verdicts if challenge call fails
                }
              }
            }
            live = true;
          } catch (err) {
            auditHadError = true;
            liveError = err instanceof Error ? err.message : String(err);
            // When a live AI call was attempted but failed, do NOT write
            // offline keyword-estimate verdicts to the checklist — they look
            // indistinguishable from real AI results and mislead the auditor.
            // Surface the error so the user can fix it and re-run.
            finish(
              `Live call failed: ${liveError}\n\nNo checklist entries were updated. Fix the issue above (e.g. check your API key, reduce the folder size) and run the audit again.`,
              false,
              liveError,
              auditUsage,
              auxUsage,
            );
            return;
          }
        } else {
          verdicts = simulateFolderAudit(lines, docWindows[0] ?? "");
        }

        // Cancel guard: if the user clicked "Cancel" while the AI call was in
        // flight, the token won't match — discard results without writing.
        if (get().auditRunToken !== capturedToken) {
          set((st) => ({
            busy: null,
            folders: st.folders.map((f) =>
              f.id === id
                ? { ...f, lastAuditSummary: "Audit was cancelled — no results were saved.", lastAuditAt: new Date().toISOString(), lastAuditLive: false }
                : f
            ),
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: "complete" as const, stageDetail: "Audit cancelled." }
              : st.auditProgress,
          }));
          return;
        }

        // Guarded so an unexpected throw while writing verdicts can't strand
        // `busy` (which would leave this row's button stuck on "Auditing…"
        // forever) — finish() below always runs and clears it.

        // Citation-gap downgrade: for each positive dimension that has no
        // sourceChunkIds, downgrade to "Not evident" and record a warning.
        // Only fires when live AI is used (offline fallback never returns chunk IDs).
        if (live) {
          const CITATION_DOWNGRADE_NOTE = "Downgraded: no source chunks cited to support this claim.";
          for (const v of verdicts) {
            if (!v.apsr) continue;
            const apsr = v.apsr;
            // Approach
            if ((apsr.approach.status === "Meeting" || apsr.approach.status === "Beginning") &&
                (!apsr.approach.sourceChunkIds || apsr.approach.sourceChunkIds.length === 0)) {
              apsr.approach = { ...apsr.approach, status: "Not evident", note: (apsr.approach.note ? apsr.approach.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — approach downgraded (no source chunks cited)`);
            }
            // Processes
            if ((apsr.processes.status === "Deployed" || apsr.processes.status === "Weak") &&
                (!apsr.processes.sourceChunkIds || apsr.processes.sourceChunkIds.length === 0)) {
              apsr.processes = { ...apsr.processes, status: "Not evident", note: (apsr.processes.note ? apsr.processes.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — processes downgraded (no source chunks cited)`);
            }
            // Systems & Outcomes
            if ((apsr.systemsOutcomes.status === "Evident" || apsr.systemsOutcomes.status === "Limited") &&
                (!apsr.systemsOutcomes.sourceChunkIds || apsr.systemsOutcomes.sourceChunkIds.length === 0)) {
              apsr.systemsOutcomes = { ...apsr.systemsOutcomes, status: "Not evident", note: (apsr.systemsOutcomes.note ? apsr.systemsOutcomes.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — systemsOutcomes downgraded (no source chunks cited)`);
            }
            // Review
            if (apsr.review.status === "Evident" &&
                (!apsr.review.sourceChunkIds || apsr.review.sourceChunkIds.length === 0)) {
              apsr.review = { ...apsr.review, status: "Not evident", note: (apsr.review.note ? apsr.review.note + " " : "") + CITATION_DOWNGRADE_NOTE };
              parseWarnings.push(`Line ${v.lineId} — review downgraded (no source chunks cited)`);
            }
          }
        }

        // Build a map from chunkId to file index for citation tracking
        const chunkToFileIndex = new Map<string, number>();
        for (const chunk of evidenceChunks) {
          const fileIdx = fileRecords.findIndex((r) => r.path === chunk.filePath);
          if (fileIdx >= 0) chunkToFileIndex.set(chunk.chunkId, fileIdx);
        }

        const notMetCount = verdicts.filter((v) => v.status === "Not met").length;

        // Map AI citations back to file records:
        // - Files cited by at least one verdict dimension → "cited"
        // - Files that were read but not cited → "not_used"
        for (const rec of fileRecords) {
          if (rec.readStatus === "read" || rec.readStatus === "condensed") {
            rec.auditStatus = "not_used"; // default; overridden below if cited
          }
        }

        // Process each verdict to map sourceChunkIds → file records
        for (const v of verdicts) {
          if (!v.apsr) continue;
          const dimMap: Array<[keyof typeof v.apsr, "approach" | "processes" | "systemsOutcomes" | "review"]> = [
            ["approach", "approach"],
            ["processes", "processes"],
            ["systemsOutcomes", "systemsOutcomes"],
            ["review", "review"],
          ];
          for (const [dimKey] of dimMap) {
            const dim = v.apsr[dimKey];
            if (!dim.sourceChunkIds) continue;
            for (const chunkId of dim.sourceChunkIds) {
              const fileIdx = chunkToFileIndex.get(chunkId);
              if (fileIdx === undefined) continue;
              const rec = fileRecords[fileIdx];
              fileRecords[fileIdx] = {
                ...rec,
                auditStatus: "cited",
                citedByLineIds: [...new Set([...(rec.citedByLineIds || []), v.lineId])],
                usedForDimensions: {
                  approach: (rec.usedForDimensions?.approach ?? false) || dimKey === "approach",
                  processes: (rec.usedForDimensions?.processes ?? false) || dimKey === "processes",
                  systemsOutcomes: (rec.usedForDimensions?.systemsOutcomes ?? false) || dimKey === "systemsOutcomes",
                  review: (rec.usedForDimensions?.review ?? false) || dimKey === "review",
                },
              };
            }
          }
        }
        const lineTextById = new Map(lines.map((l) => [l.id, l.text]));

        // Build per-line AI verdict summary for CSV export and the "Ask AI" step detail.
        verdictLines = verdicts.map((v) => {
          const allChunkIds: string[] = v.apsr ? [
            ...(v.apsr.approach.sourceChunkIds ?? []),
            ...(v.apsr.processes.sourceChunkIds ?? []),
            ...(v.apsr.systemsOutcomes.sourceChunkIds ?? []),
            ...(v.apsr.review.sourceChunkIds ?? []),
          ] : [];
          const uniqueChunkIds = [...new Set(allChunkIds)];
          const citedFileNames = uniqueChunkIds.map((cid) => {
            const chunk = evidenceChunks.find((c) => c.chunkId === cid);
            return chunk?.fileName ?? cid;
          });
          return {
            lineId: v.lineId,
            lineText: lineTextById.get(v.lineId) ?? v.lineId,
            result: v.status as "Met" | "Partial" | "Not met",
            approachStatus: v.apsr?.approach.status ?? "Not evident",
            processesStatus: v.apsr?.processes.status ?? "Not evident",
            systemsOutcomesStatus: v.apsr?.systemsOutcomes.status ?? "Not evident",
            reviewStatus: v.apsr?.review.status ?? "Not evident",
            citedChunkIds: uniqueChunkIds,
            citedFileNames,
            overallReason: v.reason ?? undefined,
            warning: undefined,
          } satisfies AuditAISummaryLine;
        });

        setProgress("saving", {
          filesFound: [...fileRecords],
          stageDetail: `Saving ${verdicts.length} verdict${verdicts.length === 1 ? "" : "s"}…`,
          linesAssessed: verdicts.length,
          findingsDetected: notMetCount,
          verdictLines,
          chunksCount: evidenceChunks.length,
          aiModel: auditUsage?.model,
          scope,
          folderWarnings: folderWarnings.length > 0 ? folderWarnings : undefined,
        });
        try {
          const checklist = useChecklistModuleStore.getState();
          for (const v of verdicts) {
            const itemId = lineOwners.get(v.lineId);
            if (!itemId) continue;
            checklist.setSpecificStatus(itemId, v.lineId, v.status);
            // Finding-style note (POLICY / EVIDENCE / OUTCOMES / REVIEW) instead
            // of a raw rubric dump, plus the cited source files and a "who/which
            // run produced this" trailer so the row is traceable and honest
            // about whether real evidence was actually submitted.
            const baseNote = v.apsr ? apsrAuditNote(v.apsr) : v.reason;
            const sourceLines = [
              `SOURCE TRACE`,
              v.sources && v.sources.length ? `File(s): ${v.sources.join("; ")}` : "File(s): not cited by model",
              `Run: ${runId} (${live ? "live AI" : "offline estimate"})`,
              `Auditor: ${auditorName}`,
              auditorName === "Unassigned (no auditor set up)" ? "Set up an auditor and review before relying on this verdict." : "Review before relying on this verdict.",
            ];
            // replaceAuditEvidence removes prior auto-audit evidence (identified
            // by having a runId) before adding the new one, so a re-audit never
            // accumulates stale "Not met" rows alongside the new verdicts.
            checklist.replaceAuditEvidence(itemId, v.lineId, {
              title: `Drive audit ${runId} — ${folder.folderName}`,
              type: evidenceTypeFromApsr(v.apsr, lineTextById.get(v.lineId) || ""),
              drive: folder.folderLink || folder.policyLink,
              owner: folder.owner,
              date: new Date().toISOString().slice(0, 10),
              approved: false,
              reviewed: false,
              sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
              // The run's own combined verdict, for the checklist card's
              // Evidence tab pill (73d3a66 wired this for Option A only — an
              // Option B item without it rendered an unexplained "—").
              // ppdVerdict stays deliberately absent: this path has no
              // policy-only PPDVerdict, and deriving one from
              // apsr.approach.status would be the lossy mapping the field's
              // type comment forbids.
              evidenceVerdict: v.status,
              auditorNote: `${baseNote}\n\n${sourceLines.join("\n")}`,
              // Persist the structured APSR so a finding raised from this line
              // can explain which rubric dimension (Approach/Processes/Systems &
              // Outcomes/Review) fell short.
              apsr: v.apsr,
              runId,
            });
          }
        } catch (err) {
          finish(`Audit read the folder but failed while writing checklist verdicts: ${err instanceof Error ? err.message : String(err)}`, live, liveError);
          return;
        }

        // Snapshot finding IDs before auto-raise so the post-audit pipeline
        // can identify exactly which findings are new (= need AI enrichment).
        const preRaiseFindingIds = new Set(get().customFindings.map((f) => f.id));

        // Auto-raise findings from the gaps this audit just set, so the
        // Findings register fills itself the moment an audit runs (instead of
        // staying empty until the user remembers to click "Raise findings").
        // Deduped, so re-auditing never double-raises; each carries its APSR
        // dimension (procedure vs evidence) and the detailed root-cause report.
        let autoRaised = 0;
        try {
          autoRaised = useChecklistModuleStore.getState().raiseAllUnmetFindings(runId, { subCriterionId: folder.subCriterionId });
        } catch {
          // Non-fatal: a finding-raise failure must not strand the audit.
        }

        const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
        for (const v of verdicts) counts[v.status]++;
        // Cap the file lists so a folder of dozens of files can't produce a
        // multi-thousand-character summary that floods the row and the AI log.
        const NAME_CAP = 8;
        const briefList = (names: string[]) => {
          const shown = names.slice(0, NAME_CAP).join(", ");
          return names.length > NAME_CAP ? `${shown}, +${names.length - NAME_CAP} more` : shown;
        };

        // Band per item — the band is a HOLISTIC human judgment now (official
        // §23 rubric), never computed by a run: report the existing selection
        // if one stands, otherwise flag that the holistic assessment is
        // pending. A run updating the lines does not move the band by itself.
        const freshEntries = useChecklistModuleStore.getState().entries;
        const bandParts = items
          .map((item) => {
            const e = freshEntries[item.id];
            if (!e || e.specific.length === 0) return null;
            const hb = e.holisticBand;
            return `${item.id} → ${hb ? `Band ${hb.band} (holistic — review it against this run's results)` : "band pending holistic assessment (Sub-Criterion Checklist)"}`;
          })
          .filter(Boolean);

        // Update the running audit journal with a compact entry for this
        // sub-criterion (bands + key gaps + APSR dimension labels). The updated
        // journal is then fed into the NEXT folder audit call so the AI can flag
        // recurring cross-criterion gaps — it won't help this call (already done)
        // but it improves every subsequent one in the same "Audit all" run.
        try {
          const entry = buildJournalEntry(folder.subCriterionId, folder.folderName, bandParts as string[], verdicts, lineTextById, runId);
          // updateJournal strips any old "⚠ Recurring patterns" lines, so we
          // re-append exactly one fresh one — it can never accumulate now.
          const updated = updateJournal(get().auditJournal, folder.subCriterionId, entry);
          set({ auditJournal: updated + patternNote(updated) });
        } catch {
          // Non-fatal — journal update failure must not affect the audit result.
        }

        // The summary is a structured, multi-line report (rendered with
        // white-space: pre-wrap) so a busy run reads as labelled sections
        // instead of one long run-on sentence.
        const lineParts: string[] = [];
        // 1. Headline — the verdict, first. Run id leads so it can be matched to
        // the AI Review Log, the checklist evidence, and the journal entry.
        lineParts.push(`Run ${runId} · Auditor: ${auditorLabel}.`);
        lineParts.push(`✓ ${counts.Met} Met · ◐ ${counts.Partial} Partial · ✗ ${counts["Not met"]} Not met (assessed ${verdicts.length} of ${lines.length} checklist line${lines.length === 1 ? "" : "s"}${timedOutCount > 0 ? `; ${timedOutCount} NOT assessed — AI call failed, previous status unchanged` : ""}).`);
        if (bandParts.length) lineParts.push(`Band: ${bandParts.join(", ")}.`);
        if (autoRaised > 0) lineParts.push(`Raised ${autoRaised} new finding${autoRaised === 1 ? "" : "s"} from the gaps — see the Findings register.${live ? " AI agents are drafting finding bodies and closure actions in the background." : ""}`);
        // 2. Files read.
        lineParts.push(
          scanned.length
            ? `Files read: ${scanned.length} (${policyCount} policy · ${evidenceCount} evidence) — ${briefList(scanned)}.`
            : "Files read: none — no readable files were found in this folder."
        );
        if (skipped.length) lineParts.push(`Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"}: ${briefList(skipped)}.`);
        if (failed.length) {
          const reasons = [...new Set(failed.map((f) => f.reason))];
          const reasonText = reasons.length === 1 ? reasons[0] : `${reasons.length} distinct errors, e.g. ${reasons[0]}`;
          lineParts.push(`Could not read ${failed.length} file${failed.length === 1 ? "" : "s"} (${reasonText}): ${briefList(failed.map((f) => f.path))}.`);
        }
        // 3. Method.
        lineParts.push(
          live
            ? `Method: EduTrust APSR rubric vs the GD4 standard — Approach (documented policy) gates the result, then Processes (implementation), Systems & Outcomes, Review.${windowCount > 1 ? ` ${windowCount} document windows used — all files read in full with no condensing.` : ""}${challenged ? " A strict second-pass challenge was applied." : ""}`
            : `Method: offline keyword estimate — AI was not used. ${aiOfflineReason(useAISettingsStore.getState()) ?? "Live AI calls failed mid-run — see the warnings above."}`
        );
        // Never let an offline run read like an AI audit — lead with WHY.
        {
          const offlineWhy = !live ? aiOfflineReason(useAISettingsStore.getState()) : null;
          if (offlineWhy) lineParts.unshift(`⚠ OFFLINE RUN — ${offlineWhy} Results below are keyword estimates only, not an AI assessment.`);
        }
        // 4. Warnings, each on its own line so they stand out.
        if (truncationNote) lineParts.push(`⚠ ${truncationNote}`);
        if (parseWarnings.length) lineParts.push(`⚠ ${parseWarnings.length} APSR dimension(s) defaulted to "Not evident" due to unexpected model output — those verdicts may be overly harsh; spot-check them.`);
        if (folderWarnings.length > 0) lineParts.push(`⚠ Possible mis-filed documents (${folderWarnings.length}): ${folderWarnings.join(" | ")}`);
        for (const w of setupWarnings) lineParts.push(`⚠ ${w}`);
        const summary = lineParts.join("\n");
        // Pass analysis and utility usage separately so the log can price each
        // model at its own rate rather than applying the analysis rate to all.
        finish(summary, live, liveError, auditUsage, auxUsage);

        // Persist completed/failed run record so the user can reopen it and export CSVs.
        const runRecord: AuditRunRecord = {
          runId,
          folderId: id,
          // Scope (item id for a split 4.2 folder, else the sub) so downstream
          // pending/gate lookups match; identical to subCriterionId elsewhere.
          subCriterionId: folderScopeId(folder),
          subCriterionTitle: folder.folderName,
          scope,
          status: auditHadError ? "failed" : "completed",
          startedAt: new Date(auditStartedAt).toISOString(),
          endedAt: new Date().toISOString(),
          auditorName,
          auditLive: live,
          aiModel: auditUsage?.model,
          effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()),
          fileLedger: [...fileRecords],
          aiSummary: verdictLines,
          linesAssessed: verdicts.length,
          findingsDetected: notMetCount,
          batchCount: batchTotal,
          chunkCount: evidenceChunks.length,
          errorMessage: liveError,
          folderWarnings: folderWarnings.length > 0 ? folderWarnings : undefined,
        };
        set((st) => {
          const prev = st.auditRunHistory[id] ?? [];
          return {
            auditRunHistory: { ...st.auditRunHistory, [id]: [runRecord, ...prev].slice(0, 5) },
            lastAuditRuns: { ...st.lastAuditRuns, [id]: runRecord },
          };
        });

        // Post-audit multi-agent pipeline — fires asynchronously so the audit
        // result appears immediately and the finding enrichment arrives seconds
        // later. Only runs when AI is live (no point enriching offline drafts).
        if (live && autoRaised > 0) {
          const currentSubCriterionId = folder.subCriterionId;
          const newFindings = get().customFindings.filter(
            (f) => !preRaiseFindingIds.has(f.id) && f.source === "Checklist" &&
              GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionId
          );
          if (newFindings.length > 0) {
            (async () => {
              const entries = useChecklistModuleStore.getState().entries;

              // Pass 1 — Finding Writer: parallel AI observation/criteria/effect
              // for every new finding. Each call gets the real APSR context that
              // the folder audit just produced, so the body is specific, not generic.
              const pass1 = newFindings.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  if (!req) return;
                  const entry = entries[finding.gd4ItemId];
                  // Match line by clause first, then by issue-text prefix.
                  const line = entry?.specific.find(
                    (l) => l.clause === finding.clause || finding.issue.startsWith(l.text.slice(0, 50))
                  );
                  if (!line) return;
                  const dim = findingDimension(line);
                  const apsr = lineApsr(line);
                  const result = await runLiveFindingObservation(
                    { id: req.id, requirement: req.requirement, describeShow: req.describeShow, expectedEvidence: req.expectedEvidence },
                    { text: line.text, status: line.status },
                    dim,
                    apsr,
                    analysisSettings
                  );
                  get().updateCustomFinding(finding.id, {
                    observation: result.observation,
                    criteria: result.criteria,
                    // Deterministic verbatim check against the official GD4
                    // text this line traces to — a paraphrased "requirement"
                    // is flagged in the register, never silently accepted.
                    criteriaUnverified: !criteriaQuotesRequirement(result.criteria, [line.sourceText, req.requirement, ...req.describeShow]) || undefined,
                    effect: result.effect,
                  });
                  get().pushAIReviewLog({
                    agent: "Finding Writer",
                    reviewType: "Finding",
                    subjectId: finding.gd4ItemId,
                    verdict: "Drafted",
                    confidence: "Medium",
                    keyConcerns: [dim],
                    recommendedAction: "Review and edit the drafted finding body before closing.",
                    live: true,
                    generatedContent: `OBSERVATION:\n${result.observation}\n\nCRITERIA:\n${result.criteria}\n\nEFFECT:\n${result.effect}`,
                    promptSent: result.promptSent,
                    runId,
                    usage: result.usage,
                  });
                } catch {
                  // Non-fatal — a failed finding draft never affects the audit result.
                }
              });
              await Promise.all(pass1);

              // Pass 2 — Closure Drafter: only for Cat A + B findings (the ones
              // that carry the highest regulatory / Star-disqualifying risk). Uses
              // the AI-enriched finding body from Pass 1 as input so the root cause
              // is specific to what the Folder Audit and Finding Writer actually found.
              const highPriority = get().customFindings.filter(
                (f) => preRaiseFindingIds.has(f.id) === false && (f.riskCategory === "A" || f.riskCategory === "B") &&
                  GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionId
              );
              const pass2 = highPriority.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  const enriched = get().customFindings.find((f) => f.id === finding.id);
                  const standard = req ? `${req.requirement}\n${req.describeShow.map((d) => `- ${d}`).join("\n")}` : "";
                  const apsr = enriched?.apsr ? apsrReason(enriched.apsr) : undefined;
                  const draft = await runLiveClosureDraft(
                    { issue: finding.issue, gd4ItemId: finding.gd4ItemId },
                    analysisSettings,
                    { standard, apsr }
                  );
                  // seedClosure only fills blanks — never overwrites user text.
                  get().seedClosure(finding.id, {
                    root: formatDraftedClosureText(draft.root),
                    corr: formatDraftedClosureText(draft.corr),
                    prev: formatDraftedClosureText(draft.prev),
                  });
                  get().pushAIReviewLog({
                    agent: "Closure Drafter",
                    reviewType: "Closure",
                    subjectId: finding.gd4ItemId,
                    verdict: "Drafted",
                    confidence: "Medium",
                    keyConcerns: [`Cat ${finding.riskCategory} finding — root cause, corrective and preventive actions drafted`],
                    recommendedAction: "Review the drafted actions in Quality Action / AFI, then link closure evidence.",
                    live: true,
                    generatedContent: `ROOT CAUSE:\n${draft.root}\n\nCORRECTIVE:\n${draft.corr}\n\nPREVENTIVE:\n${draft.prev}`,
                    promptSent: draft.promptSent,
                    runId,
                    usage: draft.usage,
                  });
                } catch {
                  // Non-fatal.
                }
              });
              await Promise.all(pass2);
            })();
          }
        }
        } catch (outerErr) {
          // Safety net: surface any unexpected exception that escaped all inner
          // try/catches so the button never gets stuck on "Auditing…" with no
          // visible error. Finish() clears busy and writes the error as the
          // audit summary so the auditor can see what went wrong.
          const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `Audit failed unexpectedly — ${msg}`, lastAuditLive: false, lastAuditError: msg } : f)),
            busy: null,
          }));
        }
      },

      auditFolderStaged: async (id, mode, extraContext, overallProgress) => {
        const s = get();
        const folder = s.folders.find((f) => f.id === id);
        if (!folder) return;
        // See runPPDReview: no run without a named auditor.
        const auditorGate = checkAuditorForRun(s.auditors, s.activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message }); return; }
        set({ auditBlockedReason: null });
        // Automation mode for this sub-criterion (NOT the scope `mode` param):
        // decides whether verdicts commit immediately, queue for review, or
        // whether the run happens at all (manual).
        const automationMode: AuditMode = s.auditMode;
        if (automationMode === "manual") {
          // Manual mode: the AI must not auto-decide anything — no AI calls,
          // no verdicts. The user enters verdicts in the checklist directly.
          set((st) => ({
            folders: st.folders.map((f) => f.id === id ? {
              ...f,
              lastAuditSummary: "Manual mode selected — the staged audit was not run and nothing was committed. Enter verdicts directly in the Sub-Criterion Checklist (AI suggestions are available per item), or switch this sub-criterion's mode to run AI assessments.",
              lastAuditAt: f.lastAuditAt,
            } : f),
          }));
          return;
        }
        // Defensive: a stale true left over from a previous run (e.g. the user
        // clicked "Skip pass" right as that run ended, or a bulk "Audit All"
        // sequence moved to the next folder before the reset fired) must never
        // leak into a fresh run and silently cut its first stage short.
        set({ busy: "folderaudit" + id, auditSkipStageFlag: false });
        const capturedToken = get().auditRunToken;
        // Run-level abort: cancelBusy() aborts this controller, which kills
        // the in-flight AI call inside whichever stage is running.
        const runAbort = new AbortController();
        _currentRunAbort = runAbort;
        const scope: AuditScope = mode === "policy" ? "policy" : mode === "evidence" ? "evidence" : "both";

        const setProgress = (stage: AuditProgressState["stage"], extra?: Partial<AuditProgressState>) => {
          set((st) => {
            const prev = st.auditProgress?.folderId === id ? st.auditProgress : {};
            return {
              auditProgress: {
                ...prev,
                folderId: id,
                folderName: folder.folderName,
                subCriterionId: folder.subCriterionId,
                overallCurrent: overallProgress?.current,
                overallTotal: overallProgress?.total,
                stage,
                currentFileName: undefined,
                currentFileBucket: undefined,
                currentFileAction: undefined,
                stageDetail: undefined,
                errorMessage: undefined,
                ...extra,
              } as AuditProgressState,
            };
          });
        };

        let auditHadError = false;
        const auditStartedAt = Date.now();
        setProgress("listing", { stageDetail: "Loading GD4 audit points…", status: "running", canCancel: true, startedAt: auditStartedAt, lastHeartbeatAt: auditStartedAt, runMode: automationMode });

        try {
        const runId = makeRunId(folder.subCriterionId);
        let newestModified: string | undefined;

        const actingAuditor = s.auditors.find((a) => a.id === get().activeAuditorId) || s.auditors.find((a) => a.role === "Audit Lead") || s.auditors[0];
        const auditorName = actingAuditor?.name || "Unassigned";
        const auditorStrictness = actingAuditor ? strictnessFromScore(actingAuditor.strictness) : undefined;
        const auditorLabel = actingAuditor ? `${auditorName} (strictness: ${auditorStrictness})` : auditorName;

        const finish = (summary: string, live: boolean, liveError?: string, usage?: AIUsage, auxUsage?: AIUsage, promptSent?: string) => {
          // The run is over — release the run-level abort controller (only if
          // it is still ours; a cancel may already have replaced it).
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: "Staged Audit Assistant",
            reviewType: "Evidence",
            subjectId: folder.subCriterionId,
            verdict: summary,
            confidence: "Medium",
            keyConcerns: [summary],
            recommendedAction: "Spot-check the auto-set checklist lines against the source documents.",
            live,
            liveError,
            generatedContent: summary,
            promptSent,
            createdAt: new Date().toISOString(),
            runId,
            model: usage?.model,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: (usage?.totalTokens || 0) + (auxUsage?.totalTokens || 0) || undefined,
          };
          const terminalStage = (auditHadError || liveError) ? "error" : "complete";
          set((st) => ({
            folders: st.folders.map((f) => (f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `[Staged] ${summary}`, lastAuditLive: live, lastAuditError: liveError, lastAuditNewestModified: newestModified ?? f.lastAuditNewestModified, lastAuditRunId: runId, lastAuditAuditor: auditorLabel, lastAuditScope: scope } : f)),
            aiReviewLog: [log, ...st.aiReviewLog].slice(0, 500),
            busy: null,
            auditProgress: st.auditProgress?.folderId === id
              ? { ...st.auditProgress, stage: terminalStage, stageDetail: undefined, errorMessage: liveError }
              : st.auditProgress,
          }));
        };

        const evidenceId = parseFolderId(folder.folderLink);
        const policyId = parseFolderId(folder.policyLink);
        // getFreshToken (not getValidToken) — see runPPDReview's identical
        // comment: refreshes a near-/already-expired token before the
        // listing call that follows.
        const token = await useGoogleDriveStore.getState().getFreshToken();
        const drive = checkDriveForRun(!!(evidenceId || policyId), !!token);
        if (drive) {
          auditHadError = true;
          set({ driveBlockedReason: { ...drive, subCriterionId: folder.subCriterionId } });
          finish(drive.message, false);
          return;
        }
        set({ driveBlockedReason: null });
        if (!token) { auditHadError = true; finish(DRIVE_EXPIRED_MID_RUN, false, DRIVE_EXPIRED_MID_RUN); return; } // should be unreachable past the guard; never strand busy

        const items = GD4_REQUIREMENTS.filter((r) => itemIdsForScope(folderScopeId(folder)).includes(r.id));
        if (items.length === 0) { auditHadError = true; finish("No GD4 items map to this sub-criterion.", false); return; }

        // Stage 1: Load FlatAuditPoints
        const allAuditPoints: FlatAuditPoint[] = items.flatMap((item) => item.flatAuditPoints ?? []);
        if (allAuditPoints.length === 0) {
          auditHadError = true;
          finish("No flat audit points found for this sub-criterion. Run validate:gd4 to check data integrity.", false);
          return;
        }

        // Auto-generate checklist lines if missing
        for (const item of items) {
          const existing = useChecklistModuleStore.getState().entries[item.id];
          if (!existing || existing.specific.length === 0) {
            try { await useChecklistModuleStore.getState().generateSpecific(item.id); useChecklistModuleStore.getState().confirmGenerated(item.id); } catch { /* non-fatal */ }
          }
        }
        const checklistEntries = useChecklistModuleStore.getState().entries;
        const lineOwners = new Map<string, string>();
        const lines: { id: string; text: string; sourceRef?: string }[] = [];
        for (const item of items) {
          const entry = checklistEntries[item.id];
          if (!entry) continue;
          for (const line of entry.specific) {
            lines.push({ id: line.id, text: line.text, sourceRef: line.sourceRef });
            lineOwners.set(line.id, item.id);
          }
        }
        if (lines.length === 0) { auditHadError = true; finish("No checklist lines found.", false); return; }

        // Gather and read files (same file reading code as auditFolderContents)
        type TaggedFile = Awaited<ReturnType<typeof listFolderFilesRecursive>>[number] & { bucket: "policy" | "evidence" | "auto" };
        const taggedFiles: TaggedFile[] = [];
        const listErrors: string[] = [];
        const gather = async (fid: string | null, bucket: TaggedFile["bucket"], label: string) => {
          if (!fid) return;
          try { const fs = await listFolderFilesRecursive(fid, token); for (const f of fs) taggedFiles.push({ ...f, bucket }); }
          catch (err) { listErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`); }
        };
        const sameLink = !!policyId && !!evidenceId && policyId === evidenceId;
        if (sameLink) { await gather(evidenceId, "auto", "Folder"); }
        else {
          if (scope !== "evidence") await gather(policyId, "policy", "Policy & Procedure");
          if (scope !== "policy") await gather(evidenceId, "evidence", policyId ? "Actual Evidence" : "Evidence");
        }
        for (const f of taggedFiles) { if (f.modifiedTime && (!newestModified || f.modifiedTime > newestModified)) newestModified = f.modifiedTime; }
        if (!policyId && !sameLink) for (const f of taggedFiles) f.bucket = "auto";

        if (taggedFiles.length === 0) {
          auditHadError = true;
          finish(listErrors.length ? `Could not list folder(s): ${listErrors.join("; ")}.` : "No files found in the linked folder(s).", false);
          return;
        }

        let resolvedContext = extraContext;
        if (resolvedContext === undefined) {
          const addId = parseFolderId(get().additionalInfo.link);
          if (addId) { try { resolvedContext = await readFolderPlainText(addId, token); } catch { resolvedContext = undefined; } }
        }

        const aiSettings = useAISettingsStore.getState();
        const schoolCtx = composeSchoolContext(get().schoolContext);
        const analysisSettings = effectiveSettings(aiSettings, { purpose: "analysis", context: schoolCtx });
        const visionSettings = effectiveSettings(aiSettings, { purpose: "vision", context: schoolCtx });
        const visionModelId = visionSettings.model;
        const canDescribeImages = aiSettings.enabled && !!aiSettings.apiKey;
        // Scanned-PDF vision pages share the image budget (one page = one image),
        // with a per-file page cap on top. See auditFolderContents.
        const MAX_IMAGES = 10;
        const MAX_PDF_VISION_PAGES = 5;
        let imagesDescribed = 0;
        let auxUsage: AIUsage | undefined;
        const scanned: string[] = [];
        const skipped: string[] = [];
        const failed: { path: string; reason: string }[] = [];

        const fileKind = (mime: string) =>
          mime === "application/pdf" ? "PDF" : mime.includes("wordprocessingml") ? "Word" : mime.includes("google-apps.document") ? "Google Doc"
          : mime.includes("google-apps.spreadsheet") ? "Google Sheet" : mime === XLSX_MIME ? "Excel" : mime === XLS_MIME ? "Excel"
          : mime === "text/csv" ? "CSV" : mime.includes("presentationml") ? "PowerPoint" : mime.includes("google-apps.presentation") ? "Google Slides"
          : mime.startsWith("image/") ? "image" : "text";

        const evidenceChunks: EvidenceChunk[] = [];
        let chunkCounter = 0;
        const inferEvidenceType = (kind: string, bucket: "policy" | "evidence", body: string): EvidenceChunk["evidenceType"] => {
          if (bucket === "policy") return "Policy/Procedure";
          const bl = body.toLowerCase();
          if (/outcome|result|trend|survey|feedback|kpi|satisfaction/.test(bl)) return "Outcome Data";
          if (/review|minute|meeting|decision|improvement/.test(bl)) return "Review Evidence";
          if (kind === "Excel" || kind === "CSV" || kind === "Google Sheet") return "Implementation Record";
          return "Other";
        };

        const MAX_PART_CHARS = 24_000;
        let policyDocParts: string[] = [];
        let evidenceDocParts: string[] = [];
        const fileRecords: AuditFileRecord[] = taggedFiles.map((file) => ({
          path: file.path, name: file.path.split("/").pop() || file.path, mimeType: file.mimeType,
          fileKind: fileKind(file.mimeType), bucket: file.bucket, readStatus: "found" as const, auditStatus: "pending" as const,
          driveFileId: file.id, driveModifiedTime: file.modifiedTime,
        }));
        const filesTotal = taggedFiles.length;

        setProgress("reading", { filesTotal, filesRead: 0, filesSkipped: 0, filesFound: [...fileRecords], stageDetail: `Reading file 1 of ${filesTotal}…`, status: "running", canCancel: true, lastHeartbeatAt: Date.now() });

        const FILE_TEXT_TIMEOUT_MS = 30_000;
        const FILE_IMAGE_TIMEOUT_MS = 45_000;
        for (let fi = 0; fi < taggedFiles.length; fi++) {
          if (get().auditRunToken !== capturedToken) break;
          const file = taggedFiles[fi];
          const isImage = IMAGE_MIME_TYPES.has(file.mimeType);
          const isPolicy = file.bucket === "policy" || (file.bucket === "auto" && classifyFileBucket(file.path) === "policy");
          const resolvedBucket: "policy" | "evidence" = isPolicy ? "policy" : "evidence";
          fileRecords[fi] = { ...fileRecords[fi], readStatus: "reading" };
          setProgress("reading", { filesTotal, filesRead: fi, filesSkipped: skipped.length, filesFound: [...fileRecords], stageDetail: `Reading file ${fi + 1} of ${filesTotal}: ${file.path.split("/").pop() || file.path}`, lastHeartbeatAt: Date.now(), canSkipCurrentFile: true });

          const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
          const cachedEntry = get().fileTextCache[cacheKey];
          // A PDF cached with ~no text (pre-vision-fallback, or a no-key run) is
          // re-read rather than reused-as-empty when vision can now read it.
          const cacheIsEmptyScannedPdf = !!cachedEntry && file.mimeType === "application/pdf" && (cachedEntry.text ?? "").trim().length < 50;
          // A cached VISION read from a different vision model is stale — re-read.
          const cacheStaleVision = !!cachedEntry && cachedEntry.readMethod === "vision" && cachedEntry.visionModel !== visionModelId;
          if (cachedEntry && !(cacheIsEmptyScannedPdf && canDescribeImages) && !(cacheStaleVision && canDescribeImages)) {
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: cachedEntry.charCount, processingMode: "reused", ...(cachedEntry.readMethod ? { readMethod: cachedEntry.readMethod } : {}), ...(cachedEntry.pdfQuality ? { suspectedScannedPdf: cachedEntry.pdfQuality.suspectedScannedPdf, extractedTextQuality: cachedEntry.pdfQuality.extractedTextQuality } : {}) };
            if (cachedEntry.text !== null) {
              scanned.push(file.path);
              const body = cachedEntry.text;
              const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
              for (let pi = 0; pi < totalParts; pi++) {
                const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
                const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
                const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
                evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: cachedEntry.fileKind, text: chunkBody, charCount: chunkBody.length, evidenceType: inferEvidenceType(cachedEntry.fileKind, resolvedBucket, chunkBody) });
                fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
                const part = `[CHUNK:${chunkId}] --- ${file.path}${partLabel} [${cachedEntry.fileKind}] ---\n${chunkBody}`;
                if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              }
            } else {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
            }
            setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
            continue;
          }

          // See auditFolderContents: refresh the Drive token per uncached read
          // and HARD-STOP when it can't be refreshed (never skip files silently).
          // Same honest label + Skip wiring as there — this await is outside the
          // per-file read race, and a stalled GIS silent refresh here is what
          // froze a real 155-file run for 98 minutes.
          setProgress("reading", { stageDetail: `Refreshing Google Drive access (before reading ${file.path.split("/").pop() || file.path})…`, lastHeartbeatAt: Date.now() });
          const TOKEN_WAIT_SKIPPED = Symbol("token-wait-skipped");
          let skipTokenWait!: () => void;
          const tokenWaitSkip = new Promise<typeof TOKEN_WAIT_SKIPPED>((resolve) => { skipTokenWait = () => resolve(TOKEN_WAIT_SKIPPED); });
          _currentFileAbort = skipTokenWait;
          const tokenResult = await Promise.race([useGoogleDriveStore.getState().getFreshToken(), tokenWaitSkip]);
          _currentFileAbort = null;
          if (tokenResult === TOKEN_WAIT_SKIPPED) {
            skipped.push(file.path);
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: "Skipped by user" };
            setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length, lastHeartbeatAt: Date.now() });
            continue;
          }
          const readToken = tokenResult;
          if (!readToken) {
            auditHadError = true;
            finish(DRIVE_EXPIRED_MID_RUN, false, DRIVE_EXPIRED_MID_RUN);
            return;
          }

          const fileAbort = new AbortController();
          // Office files (.pptx/.docx/.xlsx) may run embedded-image vision, so
          // give them the longer image timeout. See auditFolderContents.
          const officeMayEmbed = file.mimeType.includes("presentationml") || file.mimeType.includes("wordprocessingml") || file.mimeType === XLSX_MIME;
          const fileTimeoutMs = isImage || officeMayEmbed ? FILE_IMAGE_TIMEOUT_MS : FILE_TEXT_TIMEOUT_MS;
          let fileTimeoutTimer: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<never>((_, reject) => { fileTimeoutTimer = setTimeout(() => { fileAbort.abort(); reject(new Error("FILE_TIMEOUT")); }, fileTimeoutMs); });
          _currentFileAbort = () => { clearTimeout(fileTimeoutTimer); fileAbort.abort(); };

          type FileReadResult = { kind: "text"; text: string; pdfQuality?: ReturnType<typeof classifyPdfTextQuality>; visionModel?: string } | { kind: "image"; description: string } | { kind: "pdfVision"; text: string } | { kind: "unreadable"; reason: string } | { kind: "capped"; reason: string } | { kind: "skip" };
          // Embedded-image vision hook for office files — see auditFolderContents.
          // Honours the run MAX_IMAGES budget plus a per-file cap; reports images
          // skipped for the cap so they are flagged rather than silently dropped.
          let embeddedVisionModel: string | undefined;
          const embeddedImageHook = canDescribeImages
            ? async (images: { location: string; dataUrl: string }[]) => {
                const transcripts: { location: string; text: string }[] = [];
                let skippedForCapCount = 0;
                let usedThisFile = 0;
                for (const img of images) {
                  if (usedThisFile >= MAX_PDF_VISION_PAGES || imagesDescribed >= MAX_IMAGES) { skippedForCapCount++; continue; }
                  imagesDescribed++; usedThisFile++;
                  const d = await describeImage(img.dataUrl, visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
                  if (d.trim()) { transcripts.push({ location: img.location, text: d.trim() }); embeddedVisionModel = visionModelId; }
                }
                return { transcripts, skippedForCapCount };
              }
            : undefined;
          // Scanned/image-only PDF → vision fallback. See auditFolderContents.
          const readScannedPdfViaVision = async (token: string): Promise<FileReadResult> => {
            if (!canDescribeImages) return { kind: "unreadable", reason: "Scanned/image-only PDF: no text could be extracted, and no vision model is available (enable AI and add an API key in Settings)." };
            if (imagesDescribed >= MAX_IMAGES) return { kind: "capped", reason: `Scanned/image-only PDF not read: the ${MAX_IMAGES}-image vision budget for this run was reached.` };
            const pagesToRender = Math.min(MAX_PDF_VISION_PAGES, MAX_IMAGES - imagesDescribed);
            const { images, totalPages } = await exportPdfPageImages(file, token, pagesToRender, fileAbort.signal);
            if (images.length === 0) return { kind: "unreadable", reason: "Scanned/image-only PDF: no text could be extracted and its pages could not be rendered for vision." };
            const parts: string[] = [];
            for (let p = 0; p < images.length; p++) {
              imagesDescribed++;
              const d = await describeImage(images[p], visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              if (d.trim()) parts.push(images.length > 1 ? `--- Page ${p + 1} ---\n${d.trim()}` : d.trim());
            }
            if (parts.length === 0) return { kind: "unreadable", reason: "Scanned/image-only PDF: rendered pages produced no readable text via the vision model." };
            const capNote = totalPages > images.length ? `\n\n[Vision transcription of the first ${images.length} of ${totalPages} pages — page/image budget reached; later pages were not read.]` : "";
            return { kind: "pdfVision", text: parts.join("\n\n") + capNote };
          };
          const readPromise = (async (): Promise<FileReadResult> => {
            const text = await exportFileText(file, readToken, fileAbort.signal, embeddedImageHook);
            if (text !== null) {
              if (file.mimeType === "application/pdf") {
                const pdfQuality = classifyPdfTextQuality(text);
                if (pdfQuality.extractedTextQuality === "none") return await readScannedPdfViaVision(readToken);
                return { kind: "text", text, pdfQuality };
              }
              return { kind: "text", text, visionModel: embeddedVisionModel };
            }
            if (isImage && canDescribeImages && imagesDescribed < MAX_IMAGES) {
              imagesDescribed++;
              const dataUrl = await exportFileImageDataUrl(file, readToken, fileAbort.signal);
              const description = await describeImage(dataUrl, visionSettings, { signal: fileAbort.signal, onUsage: (u) => { auxUsage = addUsage(auxUsage, u); } });
              return { kind: "image", description };
            }
            return { kind: "skip" };
          })();

          let fileResult: FileReadResult;
          try {
            fileResult = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
          } catch (err) {
            clearTimeout(fileTimeoutTimer!);
            _currentFileAbort = null;
            const wasAborted = fileAbort.signal.aborted;
            if (wasAborted || (err instanceof Error && err.message === "FILE_TIMEOUT")) {
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: wasAborted ? "Skipped by user" : `Timed out after ${fileTimeoutMs / 1000}s` };
              setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length });
              continue;
            }
            if (err instanceof DriveApiError && err.status === 503) { skipped.push(file.path); fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: "Drive temporarily unavailable" }; setProgress("reading", { filesFound: [...fileRecords], filesSkipped: skipped.length }); continue; }
            failed.push({ path: file.path, reason: err instanceof Error ? err.message : String(err) });
            fileRecords[fi] = { ...fileRecords[fi], readStatus: "failed", failReason: err instanceof Error ? err.message : String(err) };
            setProgress("reading", { filesFound: [...fileRecords] });
            continue;
          }

          switch (fileResult.kind) {
            case "text": {
              const body = fileResult.text;
              scanned.push(file.path);
              const kind = fileKind(file.mimeType);
              // Office file whose embedded pictures were transcribed via vision is
              // recorded as a vision read + stamped model (see auditFolderContents).
              const textUsedVision = !!fileResult.visionModel;
              // Only cache a genuine (non-empty) read — a 0-char extraction is a
              // failed read and must be re-attempted next run, not locked in.
              if (body.trim().length > 0) {
                set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text: body, charCount: body.length, fileKind: kind, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now(), readMethod: textUsedVision ? "vision" : "text", ...(textUsedVision ? { visionModel: fileResult.visionModel } : {}), ...(fileResult.kind === "text" && fileResult.pdfQuality ? { pdfQuality: { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } } : {}) } } }));
              }
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: body.length, processingMode: "new", readMethod: textUsedVision ? "vision" : "text", ...(fileResult.pdfQuality ? { suspectedScannedPdf: fileResult.pdfQuality.suspectedScannedPdf, extractedTextQuality: fileResult.pdfQuality.extractedTextQuality } : {}) };
              const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
              for (let pi = 0; pi < totalParts; pi++) {
                const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
                const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
                const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
                evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: kind, text: chunkBody, charCount: chunkBody.length, evidenceType: inferEvidenceType(kind, resolvedBucket, chunkBody) });
                fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
                const part = `[CHUNK:${chunkId}] --- ${file.path}${partLabel} [${kind}] ---\n${chunkBody}`;
                if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              }
              break;
            }
            case "image": {
              scanned.push(file.path);
              const desc = fileResult.description;
              // Cache the vision transcription stamped with the vision model (so a
              // model switch re-reads), only when non-empty.
              if (desc.trim().length > 0) {
                set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text: desc, charCount: desc.length, fileKind: "image", fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now(), readMethod: "vision", visionModel: visionModelId } } }));
              }
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: desc.length, processingMode: "new", readMethod: "vision" };
              const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
              evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: "image", text: desc, charCount: desc.length, evidenceType: "Other" });
              fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
              const part = `[CHUNK:${chunkId}] --- ${file.path} [image] ---\n${desc}`;
              if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              break;
            }
            case "pdfVision": {
              // Scanned PDF read via vision — chunk the transcription like text
              // and cache it so the expensive vision pass isn't repeated.
              const body = fileResult.text;
              scanned.push(file.path);
              const q = classifyPdfTextQuality(body);
              if (body.trim().length > 0) {
                set((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text: body, charCount: body.length, fileKind: "PDF", fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now(), readMethod: "vision", visionModel: visionModelId, pdfQuality: { suspectedScannedPdf: false, extractedTextQuality: q.extractedTextQuality } } } }));
              }
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "read", charCount: body.length, processingMode: "new", readMethod: "vision", suspectedScannedPdf: false, extractedTextQuality: q.extractedTextQuality };
              const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
              for (let pi = 0; pi < totalParts; pi++) {
                const chunkBody = body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS);
                const chunkId = `C${String(++chunkCounter).padStart(3, "0")}`;
                const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
                evidenceChunks.push({ chunkId, filePath: file.path, fileName: file.path.split("/").pop() || file.path, bucket: resolvedBucket, fileKind: "PDF", text: chunkBody, charCount: chunkBody.length, evidenceType: inferEvidenceType("PDF", resolvedBucket, chunkBody) });
                fileRecords[fi] = { ...fileRecords[fi], chunkIds: [...(fileRecords[fi].chunkIds || []), chunkId] };
                const part = `[CHUNK:${chunkId}] --- ${file.path}${partLabel} [PDF] ---\n${chunkBody}`;
                if (isPolicy) policyDocParts.push(part); else evidenceDocParts.push(part);
              }
              break;
            }
            case "unreadable":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: fileResult.reason };
              break;
            case "capped":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped", skipReason: fileResult.reason };
              break;
            case "skip":
              skipped.push(file.path);
              fileRecords[fi] = { ...fileRecords[fi], readStatus: "skipped" };
              break;
          }
          setProgress("reading", { filesTotal, filesRead: fi + 1, filesSkipped: skipped.length, filesFound: [...fileRecords], lastHeartbeatAt: Date.now() });
        }

        if (get().auditRunToken !== capturedToken) {
          set((st) => ({ busy: null, folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditSummary: "Audit was cancelled." } : f), auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete" } : st.auditProgress }));
          return;
        }

        const policyDocText = policyDocParts.join("\n\n=== POLICY & PROCEDURE ===\n\n") || "";
        const evidenceDocText = evidenceDocParts.join("\n\n=== ACTUAL EVIDENCE ===\n\n") || "";
        const allDocText = [policyDocText, evidenceDocText].filter(Boolean).join("\n\n");

        if (!allDocText.trim()) {
          auditHadError = true;
          finish("No readable content extracted from the linked folder(s). Check that the files are not empty or unsupported.", false);
          return;
        }

        // Detect dominant file type from chunks for skill injection
        const hasSpreadsheet = evidenceChunks.some((c) => c.fileKind === "Excel" || c.fileKind === "CSV");
        const hasScanned = evidenceChunks.some((c) => (c as { suspectedScannedPdf?: boolean }).suspectedScannedPdf === true);
        const detectedFileType: "spreadsheet" | "scanned" | null = hasSpreadsheet ? "spreadsheet" : hasScanned ? "scanned" : null;

        // Coverage matrices — populated by staged AI calls
        let policyRows: PolicyCoverageRow[] = [];
        let evidenceRows: EvidenceCoverageRow[] = [];
        let outcomeRows: OutcomeReviewRow[] = [];
        let live = false;
        let auditUsage: AIUsage | undefined;
        let stagedPromptSent: string | undefined;
        const truncationNotes: string[] = [];
        // Stages whose live AI call failed and fell back to offline keyword
        // simulation — the run must then be labelled OFFLINE FALLBACK, not
        // "Live AI", wherever the run source is shown.
        const fallbackStages: string[] = [];
        let totalWindowsProcessed = 0;
        let totalCharsAssessed = 0;
        let totalCharsAvailable = 0;
        let allWindowsFullCoverage = true;

        const criterionId = folder.subCriterionId;
        // Chunk ID → source file name, for the "#N [file · chunk]:" citation the
        // staged functions attach to each window's contributed note (evidence
        // file ledger lookup — this is a display concern, not audit logic).
        const chunkFileNames = new Map(evidenceChunks.map((c) => [c.chunkId, c.fileName]));
        const resolveChunkFile = (chunkId: string): string | undefined => chunkFileNames.get(chunkId);

        if (aiSettings.enabled && aiSettings.apiKey) {
          const stagedCalibration = selectLineStatusCalibration(get().calibrationExamples);
          const stagedMemories = selectLineStatusMemories(get().calibrationMemories);
          // Same usage tracking as the classic path — once per staged run.
          if (stagedCalibration.length) get().markCalibrationUsed(stagedCalibration.map((e) => e.id));
          stagedMemories.forEach((m) => get().incrementMemoryUsage(m.id));
          // Stop when the user skips the stage, OR the run has been cancelled.
          // The token/abort checks matter: cancelBusy() RESETS the skip flag,
          // so the old flag-only check let a cancelled run's current stage
          // keep issuing every remaining window×batch AI call.
          const shouldStopStage = () =>
            get().auditSkipStageFlag || get().auditRunToken !== capturedToken || runAbort.signal.aborted;
          const resetSkipFlag = () => set({ auditSkipStageFlag: false });

          // Stage 2: Policy Adequacy Audit
          if (mode === "policy" || mode === "all") {
            setProgress("policy_audit", { stageDetail: `Checking policy coverage for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedPolicyAudit(allAuditPoints, policyDocText, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, ruleInjection: useRuleTuningStore.getState().championInjection(criterionId), fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("policy_audit", { stageDetail: `Policy: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              policyRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Policy] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Policy] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Policy stage failed] ${msg}`);
              console.error("[StagedAudit] Policy stage threw:", msg);
              policyRows = simulateStagedPolicyAudit(allAuditPoints, policyDocText);
              fallbackStages.push("Policy");
              truncationNotes.push("[OFFLINE FALLBACK] Policy stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            // Mode = "evidence": skip policy stage, default all to "No" (unknown)
            policyRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as const, note: "Policy stage not run in evidence-only mode.", chunkIds: [] }));
          }

          // Stage 3: Evidence Implementation Audit
          if (mode === "evidence" || mode === "all") {
            setProgress("evidence_audit", { stageDetail: `Checking implementation evidence for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedEvidenceAudit(allAuditPoints, evidenceDocText, policyRows, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, ruleInjection: useRuleTuningStore.getState().championInjection(criterionId), fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("evidence_audit", { stageDetail: `Evidence: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              evidenceRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (!stagedPromptSent && result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Evidence] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Evidence] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Evidence stage failed] ${msg}`);
              console.error("[StagedAudit] Evidence stage threw:", msg);
              evidenceRows = simulateStagedEvidenceAudit(allAuditPoints, evidenceDocText);
              fallbackStages.push("Evidence");
              truncationNotes.push("[OFFLINE FALLBACK] Evidence stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            evidenceRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, covered: "No" as const, note: "Evidence stage not run in policy-only mode.", chunkIds: [] }));
          }

          // Stage 4: Outcome & Review Audit (full audit only)
          if (mode === "all") {
            setProgress("outcome_review", { stageDetail: `Checking outcome data and review records for ${allAuditPoints.length} audit points…`, canCancel: true });
            try {
              const result = await runStagedOutcomeReviewAudit(allAuditPoints, allDocText, analysisSettings, {
                criterionId, calibration: stagedCalibration, memories: stagedMemories, ruleInjection: useRuleTuningStore.getState().championInjection(criterionId), fileType: detectedFileType, resolveChunkFile,
                shouldStop: shouldStopStage,
                signal: runAbort.signal,
                onProgress: (detail) => {
                  const m = detail.match(/window (\d+)\/(\d+)/);
                  setProgress("outcome_review", { stageDetail: `Outcomes: ${detail}`, canCancel: true, lastHeartbeatAt: Date.now(), ...(m ? { windowCurrent: +m[1], windowTotal: +m[2] } : {}) });
                },
              });
              resetSkipFlag();
              outcomeRows = result.rows;
              auditUsage = addUsage(auditUsage, result.usage);
              if (!stagedPromptSent && result.promptSent) stagedPromptSent = result.promptSent;
              if (result.truncationNote) truncationNotes.push(`[Outcome/Review] ${result.truncationNote}`);
              if (result.windowErrors?.length) truncationNotes.push(...result.windowErrors.map((e) => `[Outcome/Review] ${e}`));
              if (result.windowsProcessed) totalWindowsProcessed += result.windowsProcessed;
              if (result.totalCharsAssessed) totalCharsAssessed += result.totalCharsAssessed;
              if (result.totalCharsAvailable) totalCharsAvailable += result.totalCharsAvailable;
              if (result.fullCoverage === false) allWindowsFullCoverage = false;
            } catch (err) {
              resetSkipFlag();
              const msg = err instanceof Error ? err.message : String(err);
              truncationNotes.push(`[Outcome/Review stage failed] ${msg}`);
              console.error("[StagedAudit] Outcome/Review stage threw:", msg);
              outcomeRows = simulateStagedOutcomeReview(allAuditPoints, allDocText);
              fallbackStages.push("Outcome/Review");
              truncationNotes.push("[OFFLINE FALLBACK] Outcome/Review stage used keyword simulation, not live AI — its verdicts are rough estimates.");
            }
          } else {
            outcomeRows = allAuditPoints.map((p) => ({ ref: p.ref, pointText: p.text, outcomeEvident: false, reviewEvident: false, note: "Outcome/review stage not run in policy/evidence-only mode.", chunkIds: [] }));
          }
          // "Live AI" now means FULLY live: at least one stage consumed real
          // tokens AND no stage fell back to keyword simulation. A run where
          // a third of the APSR verdicts are keyword guesses must not present
          // as a live AI audit — the summary/truncation notes explain which
          // stage(s) fell back.
          live = auditUsage != null && fallbackStages.length === 0;
        } else {
          // Offline fallback
          policyRows = simulateStagedPolicyAudit(allAuditPoints, policyDocText);
          evidenceRows = simulateStagedEvidenceAudit(allAuditPoints, evidenceDocText);
          outcomeRows = simulateStagedOutcomeReview(allAuditPoints, allDocText);
        }

        if (get().auditRunToken !== capturedToken) {
          set((st) => ({ busy: null, auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete" } : st.auditProgress }));
          return;
        }

        // Stage 5: Deterministic APSR Verdict Builder
        setProgress("apsr_build", { stageDetail: "Building APSR verdicts from coverage matrices…" });
        // Checklist lines' sourceRef comes from an AI call (runLiveChecklistGeneration)
        // that is asked to echo the flatAuditPoint ref verbatim, but LLM output isn't
        // guaranteed byte-identical — a stray "DS:" prefix, extra whitespace, or a case
        // difference (e.g. "6.1.1.DS1.A" vs "6.1.1.DS1.a") makes an exact-string Map
        // lookup miss a ref that genuinely exists in the audit results, silently
        // dropping the line into the generic "overall coverage" fallback. Normalize
        // both sides via the shared module-level normalizeAuditRef so only a truly
        // nonexistent ref falls through.
        const policyByRef = new Map(policyRows.map((r) => [normalizeAuditRef(r.ref), r]));
        const evidenceByRef = new Map(evidenceRows.map((r) => [normalizeAuditRef(r.ref), r]));
        const outcomeByRef = new Map(outcomeRows.map((r) => [normalizeAuditRef(r.ref), r]));

        // Overall coverage for lines without sourceRef — computed over rows
        // that were actually assessed; not-assessed placeholders from a
        // stopped run carry no information and must not skew the fallback.
        const assessedPolicyRows = policyRows.filter((r) => !r.notAssessed);
        const assessedEvidenceRows = evidenceRows.filter((r) => !r.notAssessed);
        const assessedOutcomeRows = outcomeRows.filter((r) => !r.notAssessed);
        const policyOverall: "Yes" | "Partial" | "No" =
          assessedPolicyRows.length === 0 ? "No" :
          assessedPolicyRows.filter((r) => r.covered === "Yes").length >= assessedPolicyRows.length / 2 ? "Yes" :
          assessedPolicyRows.some((r) => r.covered !== "No") ? "Partial" : "No";
        const evidenceOverall: "Yes" | "Partial" | "No" =
          assessedEvidenceRows.length === 0 ? "No" :
          assessedEvidenceRows.filter((r) => r.covered === "Yes").length >= assessedEvidenceRows.length / 2 ? "Yes" :
          assessedEvidenceRows.some((r) => r.covered !== "No") ? "Partial" : "No";
        const outcomeOverall = assessedOutcomeRows.some((r) => r.outcomeEvident);
        const reviewOverall = assessedOutcomeRows.some((r) => r.reviewEvident);

        type StagedVerdict = { lineId: string; apsr: ApsrBreakdown; status: "Met" | "Partial" | "Not met" };
        // Lines whose backing audit rows were never assessed (run stopped or
        // stage skipped before reaching them) get NO verdict written at all —
        // their previous checklist status stays, no finding is raised, and
        // the count is reported so the partial run cannot pass as complete.
        let linesNotAssessed = 0;
        const stagedVerdicts: StagedVerdict[] = lines.flatMap((line) => {
          const normRef = line.sourceRef ? normalizeAuditRef(line.sourceRef) : undefined;
          const pRow = normRef ? policyByRef.get(normRef) : undefined;
          const eRow = normRef ? evidenceByRef.get(normRef) : undefined;
          const oRow = normRef ? outcomeByRef.get(normRef) : undefined;

          if (pRow?.notAssessed || eRow?.notAssessed || oRow?.notAssessed) {
            linesNotAssessed++;
            return [];
          }

          // No-fabrication-under-failure: a stage gives a real basis for this
          // line only if it has EITHER a matched, genuinely-assessed row, OR a
          // folder overall computed from ≥1 genuinely-assessed row. A stage that
          // ran but produced zero assessed rows (a pass that stopped, or whose
          // AI calls all failed) is baseless — its overall defaults to "No" /
          // false, which buildStagedApsr would turn into a CONFIDENT "Not
          // evident" on every dimension. When a line would rest on such a
          // baseless fallback, mark it Not assessed (previous status kept, no
          // finding raised) and let the [PARTIAL RUN] warning below fire —
          // never present an un-assessed line as a real negative verdict.
          // (Synthetic "stage not run in policy/evidence-only mode" rows are not
          // flagged notAssessed, so they still count as a basis and mode
          // behaviour is unchanged. Matched rows already passed the notAssessed
          // guard above, so `pRow ? true` is safe.)
          const policyBasis = pRow ? true : assessedPolicyRows.length > 0;
          const evidenceBasis = eRow ? true : assessedEvidenceRows.length > 0;
          const outcomeBasis = oRow ? true : assessedOutcomeRows.length > 0;
          if (!(policyBasis && evidenceBasis && outcomeBasis)) {
            linesNotAssessed++;
            return [];
          }

          // This checklist line has no sourceRef matching a specific flatAuditPoint
          // ref, so there is no window-level note or chunk citation to inherit —
          // fall back to the folder-wide coverage overall (which we've just
          // confirmed is backed by ≥1 genuinely-assessed row). This is a
          // genuinely different case from "the AI didn't find anything for this
          // ref": here there was no ref to look up in the first place.
          const effectivePRow = pRow ?? { ref: "", pointText: "", covered: policyOverall, note: "No specific audit point maps to this checklist line — using overall policy coverage for the folder.", chunkIds: [] };
          const effectiveERow = eRow ?? { ref: "", pointText: "", covered: evidenceOverall, note: "No specific audit point maps to this checklist line — using overall evidence coverage for the folder.", chunkIds: [] };
          const effectiveORow = oRow ?? { ref: "", pointText: "", outcomeEvident: outcomeOverall, reviewEvident: reviewOverall, note: "No specific audit point maps to this checklist line — using overall outcome/review coverage for the folder.", chunkIds: [] };

          // requireCitations on live runs only: a positive dimension with no
          // cited chunks is downgraded one level. Offline keyword simulation
          // never cites chunks, so applying it there would zero every run.
          const apsr = buildStagedApsr(effectivePRow, effectiveERow, effectiveORow, { requireCitations: live });
          const status = deriveApsrStatus(apsr);
          return [{ lineId: line.id, apsr, status }];
        });
        if (linesNotAssessed > 0) {
          truncationNotes.push(`[PARTIAL RUN] ${linesNotAssessed} checklist line(s) were NOT assessed (run stopped/skipped early, or their AI calls failed) — their previous status was left unchanged and no findings were raised for them.`);
        }

        // Map staged APSR citations back to file records (mirrors the classic
        // path): a file cited by any verdict dimension → "cited" with the
        // dimensions it supported; a read-but-uncited file → "not_used". Without
        // this the staged file-ledger CSV showed every file as uncited even when
        // a line was Met/Deployed. Chunk→file index comes from the chunkIds each
        // file record accumulated at read time.
        const chunkToFileIndex = new Map<string, number>();
        fileRecords.forEach((rec, i) => { for (const cid of rec.chunkIds ?? []) if (!chunkToFileIndex.has(cid)) chunkToFileIndex.set(cid, i); });
        for (const rec of fileRecords) {
          if (rec.readStatus === "read" || rec.readStatus === "condensed") rec.auditStatus = "not_used";
        }
        for (const v of stagedVerdicts) {
          const dims: Array<["approach" | "processes" | "systemsOutcomes" | "review", { sourceChunkIds?: string[] }]> = [
            ["approach", v.apsr.approach], ["processes", v.apsr.processes],
            ["systemsOutcomes", v.apsr.systemsOutcomes], ["review", v.apsr.review],
          ];
          for (const [dimKey, dim] of dims) {
            for (const chunkId of dim.sourceChunkIds ?? []) {
              const fileIdx = chunkToFileIndex.get(chunkId);
              if (fileIdx === undefined) continue;
              const rec = fileRecords[fileIdx];
              fileRecords[fileIdx] = {
                ...rec,
                auditStatus: "cited",
                citedByLineIds: [...new Set([...(rec.citedByLineIds || []), v.lineId])],
                usedForDimensions: {
                  approach: (rec.usedForDimensions?.approach ?? false) || dimKey === "approach",
                  processes: (rec.usedForDimensions?.processes ?? false) || dimKey === "processes",
                  systemsOutcomes: (rec.usedForDimensions?.systemsOutcomes ?? false) || dimKey === "systemsOutcomes",
                  review: (rec.usedForDimensions?.review ?? false) || dimKey === "review",
                },
              };
            }
          }
        }

        // Stage 6: Write to Sub-Criterion Checklist — gated by the automation
        // mode. Every staged verdict becomes the same universal write shape
        // Option A uses (status + one audit evidence item), then the mode
        // decides which commit now and which queue for human review.
        setProgress("saving", { stageDetail: `Saving ${stagedVerdicts.length} verdicts (${auditModeLabel(automationMode)})…`, linesAssessed: stagedVerdicts.length, findingsDetected: stagedVerdicts.filter((v) => v.status === "Not met").length });
        let queuedForReview = 0;
        try {
          const checklist = useChecklistModuleStore.getState();
          const stagedWrites: Array<{ write: ChecklistLineWrite; lineText: string }> = [];
          for (const v of stagedVerdicts) {
            const itemId = lineOwners.get(v.lineId);
            if (!itemId) continue;
            const lineText = lines.find((l) => l.id === v.lineId)?.text || v.lineId;
            const baseNote = apsrAuditNote(v.apsr);
            const sourceLines = [`SOURCE TRACE`, `Run: ${runId} (staged audit, ${mode} mode, ${live ? "live AI" : "offline estimate"})`, `Auditor: ${auditorName}`];
            const conf = stagedWriteConfidence(v.status, v.apsr);
            stagedWrites.push({
              lineText,
              write: {
                gd4ItemId: itemId,
                existingLineId: v.lineId,
                status: v.status,
                lowConfidence: conf.lowConfidence,
                confidenceReason: conf.reason,
                evidence: {
                  title: `Staged audit ${runId} — ${folder.folderName}`,
                  type: evidenceTypeFromApsr(v.apsr, lineText),
                  drive: folder.folderLink || folder.policyLink,
                  owner: folder.owner,
                  date: new Date().toISOString().slice(0, 10),
                  approved: false,
                  reviewed: false,
                  sufficiency: v.status === "Met" ? "Present" : v.status === "Partial" ? "Weak" : "Missing",
                  // Same as the classic path above: the run's combined verdict
                  // for the Evidence tab pill; no ppdVerdict by design.
                  evidenceVerdict: v.status,
                  auditorNote: `${baseNote}\n\n${sourceLines.join("\n")}`,
                  apsr: v.apsr,
                  runId,
                },
              },
            });
          }
          const { commit, queue } = partitionWritesByMode(automationMode, stagedWrites.map((w) => w.write));
          if (commit.length > 0) checklist.applyOptionAWrites(commit);
          if (queue.length > 0) {
            const queueSet = new Set(queue);
            const items: PendingCommitItem[] = stagedWrites
              .filter((w) => queueSet.has(w.write))
              .map((w, i) => ({ id: `${runId}-Q${i + 1}`, write: w.write, lineText: w.lineText, reason: w.write.confidenceReason ?? "Awaiting your approval" }));
            queuedForReview = items.length;
            set((st) => ({
              pendingCommits: {
                ...st.pendingCommits,
                [folder.subCriterionId]: { subCriterionId: folder.subCriterionId, path: "B", runMode: automationMode, runId, createdAt: new Date().toISOString(), items },
              },
            }));
          }
        } catch (err) {
          finish(`Staged audit failed while writing verdicts: ${err instanceof Error ? err.message : String(err)}`, live);
          return;
        }

        const preRaiseFindingIds = new Set(get().customFindings.map((f) => f.id));
        let autoRaised = 0;
        // Findings only auto-raise for verdicts that actually committed;
        // queued lines raise theirs when the human accepts them.
        if (automationMode === "full-auto") {
          try { autoRaised = useChecklistModuleStore.getState().raiseAllUnmetFindings(runId, { subCriterionId: folder.subCriterionId }); } catch { /* non-fatal */ }
        }

        // Stage 7: Findings Summary
        setProgress("findings_summary", { stageDetail: `Found ${autoRaised} gap${autoRaised === 1 ? "" : "s"} — raising findings…` });
        await new Promise((r) => setTimeout(r, 300)); // brief pause so stage is visible

        const counts = { Met: 0, Partial: 0, "Not met": 0 } as Record<string, number>;
        for (const v of stagedVerdicts) counts[v.status]++;
        const stagesRun = mode === "all" ? "Policy ✓ → Evidence ✓ → Outcome/Review ✓ → APSR verdict" : mode === "policy" ? "Policy ✓ → Evidence — → APSR verdict (approach only)" : "Policy — → Evidence ✓ → APSR verdict (processes only)";
        const policyGaps = policyRows.filter((r) => r.covered === "No").length;
        const evidenceGaps = evidenceRows.filter((r) => r.covered === "No").length;

        // Helper to produce a short file list like the classic audit
        const briefListStaged = (names: string[]) => {
          const base = names.map((n) => n.split("/").pop() || n);
          if (base.length <= 3) return base.join(", ");
          return base.slice(0, 3).join(", ") + ` … +${base.length - 3} more`;
        };

        // Band per GD4 item — holistic human judgment, never computed by a
        // run (see the classic path above for the same rule).
        const freshEntriesStaged = useChecklistModuleStore.getState().entries;
        const req = GD4_REQUIREMENTS.find((r) => itemIdsForScope(folderScopeId(folder)).includes(r.id));
        const bandPartsStaged: string[] = [];
        if (req) {
          const e = freshEntriesStaged[req.id];
          if (e && e.specific.length > 0) {
            const hb = e.holisticBand;
            bandPartsStaged.push(`${req.id} → ${hb ? `Band ${hb.band} (holistic — review it against this run's results)` : "band pending holistic assessment (Sub-Criterion Checklist)"}`);
          }
        }

        // Compacts a note for the one-line-per-gap summary below. A note may now
        // be a multi-paragraph "#N [file · chunk]:\ntext" citation block (see
        // renderWindowNotes in agentRuntime.ts) — strip the "#N [...]:" label
        // and collapse it to a single line BEFORE truncating, so a blind
        // char-slice never chops a citation bracket in half or leaves a bare
        // "#1 [Some" hanging in the compact bullet list.
        const noteSummary = (note: string, maxLen: number): string =>
          note.replace(/#\d+\s*(\[[^\]]*\])?:\s*/g, "").replace(/\s*\n+\s*/g, " ").trim().slice(0, maxLen);

        // Per-line notes for Not met / Partial lines
        const gapNotes = stagedVerdicts
          .filter((v) => v.status !== "Met")
          .slice(0, 5)
          .map((v) => {
            const lineText = lines.find((l) => l.id === v.lineId)?.text ?? v.lineId;
            const dims: string[] = [];
            if (v.apsr.approach.status !== "Meeting") dims.push(`Approach${v.apsr.approach.note ? `: ${noteSummary(v.apsr.approach.note, 80)}` : ""}`);
            if (v.apsr.processes.status !== "Deployed") dims.push(`Processes${v.apsr.processes.note ? `: ${noteSummary(v.apsr.processes.note, 80)}` : ""}`);
            if (v.apsr.systemsOutcomes.status !== "Evident") dims.push(`Outcomes${v.apsr.systemsOutcomes.note ? `: ${noteSummary(v.apsr.systemsOutcomes.note, 80)}` : ""}`);
            if (v.apsr.review.status !== "Evident") dims.push(`Review${v.apsr.review.note ? `: ${noteSummary(v.apsr.review.note, 80)}` : ""}`);
            const dimStr = dims.length > 0 ? ` [${dims.join(" · ")}]` : "";
            return `  ${v.status === "Not met" ? "✗" : "◐"} ${lineText.slice(0, 100)}${dimStr}`;
          });
        if (stagedVerdicts.filter((v) => v.status !== "Met").length > 5) {
          gapNotes.push(`  … and ${stagedVerdicts.filter((v) => v.status !== "Met").length - 5} more gaps`);
        }

        // Specialist lens
        const specialistLabel = domainExpertiseLabelFor(folder.subCriterionId);

        const lineParts: string[] = [];
        // Fallback / partial-run banners lead the summary so they cannot be
        // missed under the detail lines.
        if (fallbackStages.length > 0) lineParts.push(`⚠ OFFLINE FALLBACK — ${fallbackStages.join(", ")} stage(s) failed live AI and used keyword simulation. This run is NOT a full live AI audit.`);
        if (linesNotAssessed > 0) lineParts.push(`⚠ PARTIAL RUN — ${linesNotAssessed} line(s) not assessed (run stopped/skipped early, or their AI calls failed); their previous status was left unchanged.`);
        {
          // Non-blocking ISO 19011 independence check (same as the classic run).
          const independenceWarn = independenceNotice(auditorGate.auditor, folder.owner);
          if (independenceWarn) lineParts.push(`⚠ ${independenceWarn}`);
        }
        lineParts.push(`Run ${runId} · Staged audit (${mode} mode) · Mode: ${auditModeLabel(automationMode)} · Auditor: ${auditorLabel}.`);
        if (queuedForReview > 0) lineParts.push(`⏸ ${queuedForReview} verdict${queuedForReview === 1 ? "" : "s"} NOT committed. The review panel ("Needs your review") opens automatically when this run finishes, beside each verdict's evidence; findings for those lines are raised only when you accept them.`);
        if (specialistLabel) lineParts.push(`Specialist lens: ${specialistLabel}.`);
        lineParts.push(`✓ ${counts.Met} Met · ◐ ${counts.Partial} Partial · ✗ ${counts["Not met"]} Not met (of ${stagedVerdicts.length} assessed line${stagedVerdicts.length === 1 ? "" : "s"}${linesNotAssessed > 0 ? `; ${linesNotAssessed} not assessed` : ""}).`);
        if (bandPartsStaged.length) lineParts.push(`Band: ${bandPartsStaged.join(", ")}.`);
        if (autoRaised > 0) lineParts.push(`Raised ${autoRaised} new finding${autoRaised === 1 ? "" : "s"} from the gaps — see the Findings register.`);
        if (gapNotes.length > 0) lineParts.push(`Gap detail:\n${gapNotes.join("\n")}`);
        lineParts.push(`Stages: ${stagesRun}.`);
        if (mode !== "evidence") lineParts.push(`Policy coverage: ${policyRows.length - policyGaps}/${policyRows.length} audit points covered.`);
        if (mode !== "policy") lineParts.push(`Evidence coverage: ${evidenceRows.length - evidenceGaps}/${evidenceRows.length} audit points covered.`);
        // Split EVERY listed file (not just those that produced chunks) by the
        // same bucket rule the reading loop used, so both the "Files read" and
        // "Files assessed" lines count FILES consistently. Previously the
        // "Files read" parenthetical used policyDocParts/evidenceDocParts —
        // which are 24k-char CHUNK counts, not file counts — so one policy file
        // split into 3 chunks read as "policy: 3" here yet "Policy (1)" below.
        const nameOnly = (p: string) => p.split("/").pop() || p;
        const resolvedFileBucket = (rec: AuditFileRecord): "policy" | "evidence" =>
          rec.bucket === "policy" || (rec.bucket === "auto" && classifyFileBucket(rec.path) === "policy") ? "policy" : "evidence";
        const isReadRec = (rec: AuditFileRecord) => rec.readStatus === "read" || rec.readStatus === "condensed";
        const policyFiles = fileRecords.filter((r) => resolvedFileBucket(r) === "policy");
        const evidenceFiles = fileRecords.filter((r) => resolvedFileBucket(r) === "evidence");
        const policyReadCount = policyFiles.filter(isReadRec).length;
        const evidenceReadCount = evidenceFiles.filter(isReadRec).length;
        lineParts.push(
          scanned.length
            ? `Files read: ${scanned.length} of ${fileRecords.length} (policy: ${policyReadCount > 0 ? policyReadCount : "none"}, evidence: ${evidenceReadCount > 0 ? evidenceReadCount : "none"}) — ${briefListStaged(scanned)}.`
            : "Files read: none — no readable files were found in this folder."
        );
        if (fileRecords.length > 0) {
          // Lists ALL files the folder listing returned, each annotated with its
          // read outcome (read / skipped / failed / not read), regardless of
          // whether it produced any chunk — so the count reflects the folder's
          // true contents, not just what the AI ended up seeing.
          const describeFile = (rec: AuditFileRecord) =>
            isReadRec(rec) ? nameOnly(rec.path)
            : rec.readStatus === "skipped" ? `${nameOnly(rec.path)} (skipped${rec.skipReason ? `: ${rec.skipReason}` : ""})`
            : rec.readStatus === "failed" ? `${nameOnly(rec.path)} (failed${rec.failReason ? `: ${rec.failReason}` : ""})`
            : `${nameOnly(rec.path)} (not read)`;
          lineParts.push(
            `Files assessed:\n` +
            `  Policy (${policyFiles.length}): ${policyFiles.length > 0 ? policyFiles.map(describeFile).join(", ") : "none"}\n` +
            `  Evidence (${evidenceFiles.length}): ${evidenceFiles.length > 0 ? evidenceFiles.map(describeFile).join(", ") : "none"}`
          );
        }
        lineParts.push(live ? `Method: EduTrust APSR rubric vs GD4 standard — Approach gates the result, then Processes, Systems & Outcomes, Review (3 AI passes).` : `Method: offline keyword estimate — AI was not used. ${aiOfflineReason(useAISettingsStore.getState()) ?? "Live AI calls failed mid-run — see the warnings above."}`);
        // A silent offline run is the worst failure mode this feature has had:
        // the user believes they got an AI audit. Lead the summary with WHY.
        {
          const offlineWhy = !live ? aiOfflineReason(useAISettingsStore.getState()) : null;
          if (offlineWhy) lineParts.unshift(`⚠ OFFLINE RUN — ${offlineWhy} Results below are keyword estimates only, not an AI assessment.`);
        }
        if (detectedFileType) lineParts.push(`File type skill injected: ${detectedFileType} (${detectedFileType === "spreadsheet" ? "spreadsheet-evidence.md" : "scanned-document-evidence.md"}).`);
        if (totalWindowsProcessed > 0 && totalCharsAvailable > 0) {
          const coveragePct = Math.round((totalCharsAssessed / totalCharsAvailable) * 100);
          const unassessed = totalCharsAvailable - totalCharsAssessed;
          lineParts.push(`Sliding window coverage: ${totalWindowsProcessed} window(s) processed · ${totalCharsAssessed.toLocaleString()} of ${totalCharsAvailable.toLocaleString()} chars assessed (${coveragePct}%) · Full coverage: ${allWindowsFullCoverage ? "Yes" : `No — ${unassessed.toLocaleString()} chars unassessed`}.`);
        }
        if (truncationNotes.length > 0) lineParts.push(truncationNotes.join("\n"));
        const summary = lineParts.join("\n");

        finish(summary, live, undefined, auditUsage, auxUsage, stagedPromptSent);

        const runRecord: AuditRunRecord = {
          runId, folderId: id, subCriterionId: folderScopeId(folder), subCriterionTitle: folder.folderName,
          scope, status: auditHadError ? "failed" : "completed",
          startedAt: new Date(auditStartedAt).toISOString(), endedAt: new Date().toISOString(),
          auditorName, auditLive: live, aiModel: auditUsage?.model,
          effectiveTemperature: effectiveVerdictTemp(useAISettingsStore.getState()),
          fileLedger: [...fileRecords],
          aiSummary: stagedVerdicts.map((v) => {
            // Real citation trail: union the chunk IDs each APSR dimension cited
            // (incl. Review), dedupe, and resolve to file names — the same shape
            // the classic path produces, so a Met/Deployed line carries its
            // evidence trail instead of the previously hard-coded empty arrays.
            const uniqueChunkIds = [...new Set([
              ...(v.apsr.approach.sourceChunkIds ?? []),
              ...(v.apsr.processes.sourceChunkIds ?? []),
              ...(v.apsr.systemsOutcomes.sourceChunkIds ?? []),
              ...(v.apsr.review.sourceChunkIds ?? []),
            ])];
            const citedFileNames = uniqueChunkIds.map((cid) => evidenceChunks.find((c) => c.chunkId === cid)?.fileName ?? cid);
            return {
              lineId: v.lineId, lineText: lines.find((l) => l.id === v.lineId)?.text ?? v.lineId,
              result: v.status as "Met" | "Partial" | "Not met",
              approachStatus: v.apsr.approach.status, processesStatus: v.apsr.processes.status,
              systemsOutcomesStatus: v.apsr.systemsOutcomes.status, reviewStatus: v.apsr.review.status,
              citedChunkIds: uniqueChunkIds, citedFileNames,
            };
          }),
          linesAssessed: stagedVerdicts.length, findingsDetected: counts["Not met"] as number,
          batchCount: 3, chunkCount: evidenceChunks.length,
        };
        set((st) => {
          const prev = st.auditRunHistory[id] ?? [];
          return { auditRunHistory: { ...st.auditRunHistory, [id]: [runRecord, ...prev].slice(0, 5) }, lastAuditRuns: { ...st.lastAuditRuns, [id]: runRecord } };
        });

        if (live && autoRaised > 0) {
          const currentSubCriterionIdStaged = folder.subCriterionId;
          const newFindings = get().customFindings.filter(
            (f) => !preRaiseFindingIds.has(f.id) && f.source === "Checklist" &&
              GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId === currentSubCriterionIdStaged
          );
          if (newFindings.length > 0) {
            (async () => {
              const entries = useChecklistModuleStore.getState().entries;
              await Promise.all(newFindings.map(async (finding) => {
                try {
                  const req = GD4_REQUIREMENTS.find((r) => r.id === finding.gd4ItemId);
                  if (!req) return;
                  const entry = entries[finding.gd4ItemId];
                  const line = entry?.specific.find((l) => l.clause === finding.clause || finding.issue.startsWith(l.text.slice(0, 50)));
                  if (!line) return;
                  const dim = findingDimension(line);
                  const apsr = lineApsr(line);
                  const result = await runLiveFindingObservation(
                    { id: req.id, requirement: req.requirement, describeShow: req.describeShow, expectedEvidence: req.expectedEvidence },
                    { text: line.text, status: line.status }, dim, apsr, analysisSettings
                  );
                  get().updateCustomFinding(finding.id, { observation: result.observation, criteria: result.criteria, criteriaUnverified: !criteriaQuotesRequirement(result.criteria, [line.sourceText, req.requirement, ...req.describeShow]) || undefined, effect: result.effect });
                } catch { /* non-fatal */ }
              }));
            })();
          }
        }

        } catch (outerErr) {
          if (_currentRunAbort === runAbort) _currentRunAbort = null;
          // A cancelled run's in-flight call throws "AI call cancelled." —
          // report it AS a cancellation, not as an unexpected failure.
          if (runAbort.signal.aborted || get().auditRunToken !== capturedToken) {
            set((st) => ({
              folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: "Staged audit cancelled — no results were saved.", lastAuditLive: false } : f),
              busy: null,
              auditProgress: st.auditProgress?.folderId === id ? { ...st.auditProgress, stage: "complete", stageDetail: "Cancelled" } : st.auditProgress,
            }));
            return;
          }
          const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
          set((st) => ({ folders: st.folders.map((f) => f.id === id ? { ...f, lastAuditAt: new Date().toISOString(), lastAuditSummary: `Staged audit failed — ${msg}`, lastAuditLive: false, lastAuditError: msg } : f), busy: null }));
        } finally {
          // Same class of race as checkFolderAccess / runPPDReview (Option B's
          // equivalent): force the pending Supabase write durable so a fast
          // navigation/refresh right after a staged audit completes cannot
          // lose lastAuditRuns/lastAuditAt before another device reads it.
          await flushPendingSaves();
        }
      },

      // Dashboard "Audit all folders": runs the full single-folder pipeline
      // (auto-generate → read evidence → set statuses → band/score) on every
      // folder that has a Drive link, in order, surfacing progress via
      // bulkAuditStatus. The component navigates to the Scorecard when it
      // resolves. Reuses auditFolderContents verbatim so behaviour can't drift.
      auditAllFolders: async () => {
        // See runPPDReview: no run without a named auditor.
        const auditorGate = checkAuditorForRun(get().auditors, get().activeAuditorId);
        if (!auditorGate.ok) { set({ auditBlockedReason: auditorGate.message, bulkAuditStatus: null }); return; }
        set({ auditBlockedReason: null });
        const folders = get().folders.filter((f) => parseFolderId(f.folderLink) || parseFolderId(f.policyLink));
        if (folders.length === 0) {
          set({ bulkAuditStatus: null });
          return;
        }
        // One up-front connection check for the whole run — otherwise every
        // folder would fail individually with the same not-connected message.
        // getFreshToken (not getValidToken): this is the bulk sweep's ONE
        // Drive touchpoint most likely to run long enough to cross the
        // token's ~1hr lifetime, so it gets refreshed here before any of the
        // per-folder audits below start (each of which also refreshes again
        // at its own start — see auditFolderContents/auditFolderStaged).
        const bulkToken = await useGoogleDriveStore.getState().getFreshToken();
        const bulkDrive = checkDriveForRun(true, !!bulkToken);
        if (bulkDrive) { set({ driveBlockedReason: bulkDrive, bulkAuditStatus: null }); return; }
        set({ driveBlockedReason: null });
        // Read the school-wide Additional-info folder ONCE and reuse it for
        // every sub-criterion (vs re-reading it 24×). "" means "no context /
        // don't read again" to each auditFolderContents call. Reuses the
        // just-refreshed bulkToken rather than fetching a second one.
        let sharedContext = "";
        const addId = parseFolderId(get().additionalInfo.link);
        if (addId && bulkToken) {
          set({ bulkAuditStatus: "Reading school-wide additional info…" });
          try {
            sharedContext = await readFolderPlainText(addId, bulkToken);
          } catch {
            sharedContext = "";
          }
        }
        let bulkSucceeded = 0;
        let bulkFailed = 0;
        for (let i = 0; i < folders.length; i++) {
          const f = folders[i];
          set({ bulkAuditStatus: `Auditing ${i + 1}/${folders.length}: ${f.subCriterionId} ${f.folderName}` });
          await get().auditFolderContents(f.id, sharedContext, { current: i + 1, total: folders.length });
          const updated = get().folders.find((x) => x.id === f.id);
          if (updated?.lastAuditError) bulkFailed++;
          else bulkSucceeded++;
        }
        const unlinked = get().folders.length - folders.length;
        const bulkSummary = [
          `Bulk audit complete — ${folders.length} folder${folders.length === 1 ? "" : "s"} processed.`,
          bulkSucceeded > 0 ? `✓ ${bulkSucceeded} succeeded` : "",
          bulkFailed > 0 ? `✗ ${bulkFailed} failed (see individual rows for errors)` : "",
          unlinked > 0 ? `${unlinked} unlinked (no Drive folder set)` : "",
        ].filter(Boolean).join(" · ");
        set({ bulkAuditStatus: bulkSummary });
        // Clear after 10 s so the status bar doesn't persist indefinitely.
        setTimeout(() => set((s) => (s.bulkAuditStatus === bulkSummary ? { bulkAuditStatus: null } : {})), 10_000);
      },

      auditChangedFolders: async () => {
        // getFreshToken (not getValidToken) — this sweep lists every linked
        // folder looking for changes before auditing any of them, the same
        // long-running-bulk-check shape as auditAllFolders above.
        const token = await useGoogleDriveStore.getState().getFreshToken();
        const folders = get().folders;
        const linked = folders.filter((f) => parseFolderId(f.folderLink) || parseFolderId(f.policyLink));
        const unlinked = folders.length - linked.length;
        if (!token || linked.length === 0) {
          set({ bulkAuditStatus: null });
          return { audited: 0, skipped: 0, unlinked };
        }

        // Decide which folders changed by comparing each folder's newest file
        // modifiedTime against what we recorded at its last audit.
        const newestOf = async (f: (typeof linked)[number]): Promise<string | undefined> => {
          let newest: string | undefined;
          for (const fid of [parseFolderId(f.policyLink), parseFolderId(f.folderLink)]) {
            if (!fid) continue;
            try {
              const files = await listFolderFilesRecursive(fid, token);
              for (const file of files) {
                if (file.modifiedTime && (!newest || file.modifiedTime > newest)) newest = file.modifiedTime;
              }
            } catch {
              // a folder we can't list is treated as "changed" so it re-audits
              return new Date().toISOString();
            }
          }
          return newest;
        };

        const toAudit: typeof linked = [];
        let skipped = 0;
        for (let i = 0; i < linked.length; i++) {
          const f = linked[i];
          set({ bulkAuditStatus: `Checking ${i + 1}/${linked.length} for changes: ${f.subCriterionId}` });
          // Never audited before, or no recorded baseline → always audit.
          if (!f.lastAuditAt || !f.lastAuditNewestModified) {
            toAudit.push(f);
            continue;
          }
          const newest = await newestOf(f);
          if (newest && newest > f.lastAuditNewestModified) toAudit.push(f);
          else skipped += 1;
        }

        // Read school-wide Additional-info once, same as auditAllFolders.
        let sharedContext = "";
        const addId = parseFolderId(get().additionalInfo.link);
        if (addId) {
          try {
            sharedContext = await readFolderPlainText(addId, token);
          } catch {
            sharedContext = "";
          }
        }
        for (let i = 0; i < toAudit.length; i++) {
          const f = toAudit[i];
          set({ bulkAuditStatus: `Auditing changed ${i + 1}/${toAudit.length}: ${f.subCriterionId} ${f.folderName}` });
          await get().auditFolderContents(f.id, sharedContext, { current: i + 1, total: toAudit.length });
        }
        set({ bulkAuditStatus: null });
        return { audited: toAudit.length, skipped, unlinked };
      },

      setAdditionalInfoLink: (link) => set((s) => ({ additionalInfo: { ...s.additionalInfo, link } })),

      // Mirrors checkFolderAccess for the single school-wide folder.
      checkAdditionalInfoAccess: async () => {
        const link = get().additionalInfo.link;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        const checkedAt = new Date().toISOString();
        let status: DriveAccessStatus;
        let note: string;
        if (!folderId) {
          status = "Error";
          note = "Could not find a Drive folder ID in the link. Paste a Google Drive folder link.";
        } else if (!token) {
          status = "Not Connected";
          note = "Not connected to Google Drive. Connect your Google account in Settings, then try again.";
        } else {
          try {
            const files = await listFolderFilesRecursive(folderId, token);
            status = "Connected";
            note = files.length ? `Connected — found ${files.length} file${files.length === 1 ? "" : "s"} (including subfolders).` : "Connected, but this folder appears to be empty.";
          } catch (err) {
            status = "Error";
            if (err instanceof DriveApiError && err.status === 404) note = "Drive could not find this folder. Check the link points to a folder, not a file.";
            else if (err instanceof DriveApiError && err.status === 403)
              note = `Drive denied access (${err.reason || "no further detail from Google"}). Confirm the connected account has at least viewer access.`;
            else note = err instanceof Error ? err.message : String(err);
          }
        }
        set((st) => ({ additionalInfo: { ...st.additionalInfo, accessStatus: status, accessNote: note, accessAt: checkedAt } }));
      },

      setSchoolContextText: (text) => set((s) => ({ schoolContext: { ...s.schoolContext, text } })),
      setSchoolContextLink: (link) => set((s) => ({ schoolContext: { ...s.schoolContext, link } })),
      setSchoolContextEnabled: (enabled) => set((s) => ({ schoolContext: { ...s.schoolContext, enabled } })),

      // Reads the linked Drive context folder/doc into driveCache so it can be
      // injected alongside the typed briefing. Best-effort; surfaces an access
      // status like the folder checks do.
      readSchoolContextFromDrive: async () => {
        const link = get().schoolContext.link;
        const folderId = parseFolderId(link);
        const token = useGoogleDriveStore.getState().getValidToken();
        if (!folderId) {
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Error", accessNote: "Could not find a Drive folder ID in the link." } }));
          return;
        }
        if (!token) {
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Not Connected", accessNote: "Not connected to Google Drive. Connect in Settings, then try again." } }));
          return;
        }
        try {
          const text = await readFolderPlainText(folderId, token);
          set((s) => ({
            schoolContext: {
              ...s.schoolContext,
              driveCache: text,
              cachedAt: new Date().toISOString(),
              accessStatus: "Connected",
              accessNote: text ? `Read ${text.length} characters of context from Drive.` : "Connected, but no readable text was found in this folder.",
            },
          }));
        } catch (err) {
          const msg = err instanceof DriveApiError ? err.reason || err.message : err instanceof Error ? err.message : String(err);
          set((s) => ({ schoolContext: { ...s.schoolContext, accessStatus: "Error", accessNote: `Could not read the context folder: ${msg}` } }));
        }
      },

      setSamples: (samples) => set({ samples }),
      toggleSample: (id) => set((s) => ({ samples: s.samples.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)) })),
      setSampleOutcome: (id, outcome, notes) => set((s) => ({ samples: s.samples.map((r) => (r.id === id ? { ...r, testedOutcome: outcome, notes: notes ?? r.notes } : r)) })),

      setInterviewQuestions: (qs) => set({ interviewQuestions: qs }),
      setQuestionReadiness: (id, readiness, notes) =>
        set((s) => ({ interviewQuestions: s.interviewQuestions.map((q) => (q.id === id ? { ...q, readiness, notes: notes ?? q.notes } : q)) })),

      addExportLogEntry: (e) => set((s) => ({ exportLog: [e, ...s.exportLog].slice(0, 300) })),

      addCustomFinding: (raw) => {
        // Cross-cycle repeat check: mark repeatFinding / escalate a repeat
        // Minor NC to Major when the same item+ref gap exists in the archived
        // prior cycle. Findings carried over by createNewCycle bypass this
        // (they are written directly, not via addCustomFinding), so a carried
        // finding never flags itself as its own repeat.
        const f = applyCarryover(raw, get().priorCycleFindings);
        set((s) => ({ customFindings: [...s.customFindings, f] }));
        // Auto-run the review panel for eligible findings under the auto
        // modes. Queued and drained ONE at a time while the store is idle, so
        // a bulk raise (staged audit) never launches dozens of runs at once.
        if (shouldAutoRunPanel(get().reviewPanelMode, f) && isValidPanel(get().auditors, get().reviewPanelAuditorIds)) {
          enqueuePanelAutoRun(f.id, () => get().runFindingPanelReview, () => get().busy);
        }
      },

      updateCustomFinding: (id, patch) =>
        set((s) => {
          if (s.customFindings.some((f) => f.id === id)) {
            return { customFindings: s.customFindings.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
          }
          // The id isn't a runtime finding — it's a seeded demo finding (a
          // read-only const). Promote a patched copy into customFindings so the
          // edit (owner/deadline/severity) actually persists; useAllFindings
          // dedupes by id with custom winning, so it still shows once.
          const seed = s.seedFindingsLoaded ? FINDINGS.find((f) => f.id === id) : undefined;
          return seed ? { customFindings: [...s.customFindings, { ...seed, ...patch }] } : {};
        }),

      // Human Major↔Minor override. Sets classificationManual so the AI panel's
      // non-forced re-runs defer to the human choice (human-override-wins — the
      // same guard computePanelConclusion already honours). Only NC findings
      // carry a severity; logged to the Human Decision Log like every other
      // scoring/classification override.
      setNcSeverity: (id, severity) => {
        // Look in runtime findings AND the seeded register (a seed finding is
        // promoted into customFindings by updateCustomFinding on edit).
        const f = get().customFindings.find((x) => x.id === id)
          ?? (get().seedFindingsLoaded ? FINDINGS.find((x) => x.id === id) : undefined);
        if (!f || resolveFindingType(f) !== "NC") return;
        const prev = resolveNcSeverity(f);
        if (prev === severity && f.classificationManual) return;
        get().updateCustomFinding(id, { ncSeverity: severity, classificationManual: true });
        get().logHumanDecision({
          module: "NC Severity",
          subjectId: id,
          field: "ncSeverity",
          aiOutput: prev ? `AI/rule: ${prev} NC` : "—",
          humanDecision: `${severity} NC`,
          changed: prev !== severity,
          decisionType: "Overridden",
          reason: "Manual Major/Minor NC classification.",
        });
      },

      removeCustomFinding: (id) => {
        // Remove the finding and its closure entry, then sweep EVERY store
        // that holds a savedFindingId back-pointer at it — checklist lines,
        // Option A evidence-assessment rows, PPD-review rows and grouped
        // drafts — so no dead "View finding" link survives and every source
        // row becomes re-compilable ("Draft finding" again).
        set((s) => {
          const { [id]: _dropped, ...remainingClosures } = s.closures;
          return {
            customFindings: s.customFindings.filter((f) => f.id !== id),
            closures: remainingClosures,
            evidenceAssessments: stripFindingBackPointers(s.evidenceAssessments, (fid) => fid === id),
            ppdReviewResults: stripContradictionBackPointers(s.ppdReviewResults, (fid) => fid === id),
            evidenceAssessmentHistory: stripFindingBackPointersHistory(s.evidenceAssessmentHistory, (fid) => fid === id),
            ppdReviewHistory: stripContradictionBackPointersHistory(s.ppdReviewHistory, (fid) => fid === id),
          };
        });
        useChecklistModuleStore.getState().clearSavedFindingId(id);
        useFindingDraftStore.getState().clearSavedFindingId(id);
      },

      clearAllFindings: () => {
        const ids = get().customFindings.map((f) => f.id);
        set((s) => ({
          customFindings: [],
          closures: {},
          seedFindingsLoaded: false,
          // Same back-pointer sweep as removeCustomFinding, for every id.
          evidenceAssessments: stripFindingBackPointers(s.evidenceAssessments, () => true),
          ppdReviewResults: stripContradictionBackPointers(s.ppdReviewResults, () => true),
          evidenceAssessmentHistory: stripFindingBackPointersHistory(s.evidenceAssessmentHistory, () => true),
          ppdReviewHistory: stripContradictionBackPointersHistory(s.ppdReviewHistory, () => true),
        }));
        const cs = useChecklistModuleStore.getState();
        ids.forEach((id) => cs.clearSavedFindingId(id));
        // Confirmed grouped drafts pointed at the findings just wiped —
        // downgrade them back to editable drafts (keeping their bodies)
        // instead of leaving them dangling with dead savedFindingIds.
        useFindingDraftStore.getState().downgradeConfirmedDrafts();
      },

      clearFindingsForSubCriterion: (subCriterionId) => {
        // Same delete + back-pointer sweep as clearAllFindings, but scoped to
        // ONE sub-criterion. A finding's sub-criterion is its GD4 item's parent
        // (falling back to the raw gd4ItemId), matching the Findings register's
        // own grouping. Seed (demo) findings can't be removed individually
        // while the seed flag stays on, so the KEPT set is materialised into
        // customFindings and the flag turned off — leaving every other
        // sub-criterion's findings exactly as they were.
        const subCritOf = (f: Finding) =>
          GD4_REQUIREMENTS.find((r) => r.id === f.gd4ItemId)?.subCriterionId ?? f.gd4ItemId;
        const s = get();
        const seeds = s.seedFindingsLoaded ? FINDINGS : [];
        const allNow: Finding[] = [...seeds, ...s.customFindings];
        const deleteIds = new Set(allNow.filter((f) => subCritOf(f) === subCriterionId).map((f) => f.id));
        if (deleteIds.size === 0) return;
        const kept = allNow.filter((f) => !deleteIds.has(f.id));
        set((st) => {
          const closures = { ...st.closures };
          deleteIds.forEach((id) => { delete closures[id]; });
          return {
            customFindings: kept,
            seedFindingsLoaded: false,
            closures,
            evidenceAssessments: stripFindingBackPointers(st.evidenceAssessments, (fid) => deleteIds.has(fid)),
            ppdReviewResults: stripContradictionBackPointers(st.ppdReviewResults, (fid) => deleteIds.has(fid)),
            evidenceAssessmentHistory: stripFindingBackPointersHistory(st.evidenceAssessmentHistory, (fid) => deleteIds.has(fid)),
            ppdReviewHistory: stripContradictionBackPointersHistory(st.ppdReviewHistory, (fid) => deleteIds.has(fid)),
          };
        });
        const cs = useChecklistModuleStore.getState();
        const fds = useFindingDraftStore.getState();
        // Per-id (scoped) so ONLY drafts pointing at the deleted findings are
        // downgraded — other sub-criteria's confirmed drafts are untouched.
        deleteIds.forEach((id) => { cs.clearSavedFindingId(id); fds.clearSavedFindingId(id); });
      },

      clearAllClosures: () => set({ closures: {} }),

      clearReviewerOverride: (itemId) =>
        set((s) => {
          const { [itemId]: _r, ...reviewer } = s.reviewer;
          const { [itemId]: _j, ...justify } = s.justify;
          const { [itemId]: _c, ...confirmed } = s.confirmed;
          return { reviewer, justify, confirmed };
        }),

      pushAIReviewLog: (entry) =>
        set((s) => {
          const log: AIReviewLogEntry = {
            id: `LOG-${Date.now()}-${++logCounter}`,
            auditCycleId: s.cycle.id,
            agent: entry.agent,
            reviewType: entry.reviewType,
            subjectId: entry.subjectId,
            verdict: entry.verdict,
            confidence: entry.confidence,
            keyConcerns: entry.keyConcerns,
            recommendedAction: entry.recommendedAction,
            evidenceNeeded: entry.evidenceNeeded,
            suggestedScore: entry.suggestedScore,
            suggestedBand: entry.suggestedBand as 1 | 2 | 3 | 4 | 5 | undefined,
            live: entry.live,
            liveError: entry.liveError,
            generatedContent: entry.generatedContent,
            promptSent: entry.promptSent,
            createdAt: new Date().toISOString(),
            runId: entry.runId,
            model: entry.usage?.model,
            promptTokens: entry.usage?.promptTokens,
            completionTokens: entry.usage?.completionTokens,
            totalTokens: entry.usage?.totalTokens,
          };
          return { aiReviewLog: [log, ...s.aiReviewLog].slice(0, 500) };
        }),

      logHumanDecision: (entry) =>
        set((s) => {
          const id = `HDL-${Date.now()}-${++logCounter}`;
          const ts = new Date().toISOString();
          const log: HumanDecisionEntry = { id, timestamp: ts, ...entry };
          const next: ReturnType<typeof Object.assign> = { humanDecisionLog: [log, ...s.humanDecisionLog].slice(0, 2000) };
          // Auto-promote to calibration library when there is a reason and a change
          if (entry.changed && entry.reason.trim()) {
            const cal: CalibrationExample = {
              id: `CAL-${Date.now()}-${++logCounter}`,
              timestamp: ts,
              module: entry.module,
              field: entry.field,
              aiInput: "",
              aiOutput: entry.aiOutput,
              humanCorrection: entry.humanDecision,
              reason: entry.reason,
              used: false,
              included: true,
            };
            next.calibrationExamples = [cal, ...s.calibrationExamples].slice(0, 200);
          }
          return next;
        }),

      clearAIReviewLog: () => set({ aiReviewLog: [] }),
      clearHumanDecisionLog: () => set({ humanDecisionLog: [] }),

      toggleCalibrationIncluded: (id) =>
        set((s) => ({
          calibrationExamples: s.calibrationExamples.map((c) =>
            c.id === id ? { ...c, included: !c.included } : c
          ),
        })),

      markCalibrationUsed: (ids) =>
        set((s) => ({
          calibrationExamples: s.calibrationExamples.map((c) =>
            ids.includes(c.id) ? { ...c, used: true } : c
          ),
        })),

      addCalibrationMemory: (memory) => {
        const id = `MEM-${Date.now()}-${++logCounter}`;
        const mem: CalibrationMemory = {
          ...memory,
          id,
          timestamp: new Date().toISOString(),
          usageCount: 0,
          effectivenessScore: null,
        };
        set((s) => ({ calibrationMemories: [mem, ...s.calibrationMemories].slice(0, 500) }));
        return id;
      },

      updateMemoryStatus: (id, status) =>
        set((s) => ({ calibrationMemories: s.calibrationMemories.map((m) => m.id === id ? { ...m, status } : m) })),

      incrementMemoryUsage: (id) =>
        set((s) => ({ calibrationMemories: s.calibrationMemories.map((m) => m.id === id ? { ...m, usageCount: m.usageCount + 1 } : m) })),
    }),
    // Bumped to v2 so existing sessions pick up the new blank-by-default
    // evidence baseline (previously seeded with sample ratings) instead of
    // silently keeping the old pre-filled state cached under v1.
    //
    // partialize — quota-driven exclusions/caps (Batch 3):
    //  • fileTextCache: full extracted text of every Drive file ever read —
    //    persisting it can blow the localStorage quota and take ALL
    //    persistence down with it. Performance cache, in-memory only.
    //  • changeLog: history now lives in the dedicated append-only
    //    useChangeLogStore; the legacy copy here is kept in memory only for
    //    the one-time migration and no longer persisted.
    //  • promptSent/generatedContent: CAPPED in the persisted view. Full
    //    prompts (which embed school-document text, 40k+ chars each) across
    //    200 log entries, 24 Option A results and 50 version snapshots were a
    //    guaranteed localStorage-quota blowout that killed the offline safety
    //    net — the exact failure mode that wiped the Change Log. The
    //    IN-MEMORY state keeps full prompts, so the AI Review Log shows them
    //    uncut for the session that produced them (and the AI Debug Log keeps
    //    per-call prompts); only what is WRITTEN to storage is truncated.
    {
      name: "ucc-gd4-workspace:v3",
      storage: workspaceStorage,
      // Transient run-state never survives a page load: the JS run that owned
      // it is gone once the tab reloads. These fields (the live drafting /
      // full-audit overlays, the busy marker, per-pass progress, the
      // vision-budget pause) drive in-flight UI ONLY. A run interrupted by a
      // reload/deploy/close persisted them as "running", and on the next load
      // the merge below used to keep that value, resurrecting a ZOMBIE
      // "Drafting…" modal on the Evidence Folder that no live run backs — so its
      // Cancel had nothing to stop and the modal looked stuck (2026-07-19 bug).
      // At rehydration there is NEVER a genuine in-flight run (a run only starts
      // on user action AFTER load), so force every one of these back to its idle
      // null over whatever the persisted blob holds. This replicates zustand's
      // default shallow merge, then overrides the run-state. Does NOT touch the
      // cancel-gate logic (runOptionAFullAuto) — a genuine same-session run sets
      // these in memory and behaves exactly as before.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<WorkspaceState>),
        busy: null,
        bulkAuditStatus: null,
        hybridDraftProgress: null,
        fullAuditProgress: null,
        ppdReviewProgress: null,
        evidenceAssessmentProgress: null,
        outcomeReviewProgress: null,
        visionBudgetPrompt: null,
      }),
      // Schema migrations for the Evidence Folder sub-criterion re-align:
      //   v1 — split 2.1 → 2.1.1/2.1.2 (and 2.3, 2.4, 5.1, 5.2) to match the
      //        GD4 Library's finer breakdown.
      //   v2 — fold 7.2 "Achievement of Outcomes" into 7.1 (its outcome areas
      //        became items 7.1.2–7.1.5); 7.2 removed as an Evidence Folder line.
      //   v3 — reconcile the evidence map to the current item ids. The v2 fold
      //        renamed items (7.2.1→7.1.2, …); a persisted evidence map keyed by
      //        the old ids left the new ids absent, and buildScored indexed them
      //        without a guard → aiScore read `undefined.approach` and white-
      //        screened the app. Ensure every current item id has an entry.
      //   v4 — collapse the four outcome-area items (7.1.2–7.1.5) into 7.1.1;
      //        drop any runtime state still keyed to those removed item ids.
      //   v5 — prune the remaining item-keyed and finding-keyed slices that
      //        earlier versions left untouched (reviewer/confirmed/justify by
      //        current item id; samples/interviewQuestions by gd4ItemId; and
      //        closures whose finding was dropped), so no parentless records
      //        linger. All are read by current-item id anyway, so this is
      //        cleanup, not a behaviour change.
      //   v6 — also prune itemReviews (AI per-item verdicts) by current item id;
      //        it was the one item-keyed slice v5 missed.
      // Persisted workspaces still hold the old folders (and runtime state keyed
      // to removed sub-criterion ids), so reconcile them on rehydrate: drop
      // folders/state for sub-criteria that no longer exist (the user's chosen
      // "discard & re-audit" for those areas) and add fresh empty folders for
      // the new sub-criteria. Everything keyed to an unchanged sub-criterion (or
      // to a surviving item id) is untouched. The reconcile is idempotent, so a
      // workspace at an earlier version is safely brought up to the latest.
      version: 8,
      migrate: (persisted, fromVersion) => {
        let s = persisted as WorkspaceState;
        if (!s) return s;
        if (fromVersion < 6) {
        const validSub = currentSubIds();
        const validItem = currentItemIds();
        // Ids removed by the sub-criterion re-align. The split coarse ids
        // (2.1, 2.3, 2.4, 5.1, 5.2) plus the 7.2 fold into 7.1 (its old item
        // ids 7.2.1–7.2.4 became 7.1.2–7.1.5). Anything keyed to these is
        // discarded; item ids beneath the split ones (2.1.1, 2.3.2, …) survive.
        const removedSub = new Set([
          "2.1", "2.3", "2.4", "5.1", "5.2",           // split into finer sub-criteria
          "7.2", "7.2.1", "7.2.2", "7.2.3", "7.2.4",   // 7.2 folded into 7.1
          "7.1.2", "7.1.3", "7.1.4", "7.1.5",          // outcome areas collapsed into 7.1.1
        ]);
        const reconciled = s.folders ? reconcileFolders(s.folders) : s.folders;
        const keptFolderIds = new Set((reconciled ?? []).map((f) => f.id));
        const pruneBySubCrit = <V,>(rec: Record<string, V> | undefined) =>
          rec ? Object.fromEntries(Object.entries(rec).filter(([k]) => validSub.has(k))) : rec;
        const pruneByFolderId = <V,>(rec: Record<string, V> | undefined) =>
          rec ? Object.fromEntries(Object.entries(rec).filter(([k]) => keptFolderIds.has(k))) : rec;
        const pruneByItem = <V,>(rec: Record<string, V> | undefined) =>
          rec ? Object.fromEntries(Object.entries(rec).filter(([k]) => validItem.has(k))) : rec;
        // Findings dropped by the customFindings filter below — their closures
        // are orphaned and pruned to match.
        const droppedFindingIds = new Set((s.customFindings ?? []).filter((f) => removedSub.has(f.gd4ItemId)).map((f) => f.id));
        // Reconcile the evidence map to the current item ids (see
        // reconcileEvidenceMap): keep surviving ratings, blank-fill new item
        // ids, drop stale keys (e.g. the old 7.2.x ids).
        const evidence = reconcileEvidenceMap(s.evidence);
        s = {
          ...s,
          folders: reconciled,
          evidence,
          // Sub-criterion-keyed Option A / analysis state for removed
          // sub-criteria is dropped so nothing renders under a bare "2.1".
          ppdReviewResults: pruneBySubCrit(s.ppdReviewResults),
          ppdReviewHistory: pruneBySubCrit(s.ppdReviewHistory),
          evidenceAssessments: pruneBySubCrit(s.evidenceAssessments),
          evidenceAssessmentHistory: pruneBySubCrit(s.evidenceAssessmentHistory),
          analysisPath: pruneBySubCrit(s.analysisPath),
          pendingCommits: pruneBySubCrit(s.pendingCommits),
          // Folder-id-keyed audit run history for dropped folders is discarded.
          auditRunHistory: pruneByFolderId(s.auditRunHistory),
          lastAuditRuns: pruneByFolderId(s.lastAuditRuns),
          // Findings tagged with a removed COARSE sub-criterion id (e.g. a
          // finding whose gd4ItemId is literally "2.1") are discarded — item-
          // level findings (gd4ItemId "2.1.1"/"2.1.2") survive and re-home to
          // their new sub-criterion automatically.
          customFindings: s.customFindings
            ? s.customFindings.filter((f) => !removedSub.has(f.gd4ItemId))
            : s.customFindings,
          // Item-keyed reviewer/confirmed/justify scores and AI item reviews
          // for removed items are dropped; those for surviving items are kept.
          reviewer: pruneByItem(s.reviewer),
          confirmed: pruneByItem(s.confirmed),
          justify: pruneByItem(s.justify),
          itemReviews: pruneByItem(s.itemReviews),
          // Closures keyed to a dropped finding are pruned.
          closures: s.closures ? Object.fromEntries(Object.entries(s.closures).filter(([k]) => !droppedFindingIds.has(k))) : s.closures,
          // Samples / interview questions carrying a removed gd4ItemId are dropped.
          samples: s.samples ? s.samples.filter((x) => validItem.has(x.gd4ItemId)) : s.samples,
          interviewQuestions: s.interviewQuestions ? s.interviewQuestions.filter((x) => validItem.has(x.gd4ItemId)) : s.interviewQuestions,
        } as WorkspaceState;
        }
        // v6 -> v7: carry finding refs over the 6.1.1.DS1.c split (see
        // migrateDs1Ref) so a finding raised on the old DS1.d/e/f (e.g. the
        // DS1.e CAP Approval line) follows its content to the new e/f/g rather
        // than resolving to the wrong requirement point. Only the ref labels
        // move; no finding, band or score value is touched.
        if (fromVersion < 7) {
          s = {
            ...s,
            customFindings: s.customFindings?.map((f) => ({
              ...f,
              ...(f.clause ? { clause: migrateDs1Ref(f.clause) } : {}),
              ...(f.linkedSourceRefs ? { linkedSourceRefs: f.linkedSourceRefs.map(migrateDs1Ref) } : {}),
            })),
          } as WorkspaceState;
        }
        if (fromVersion < 8) {
          // 4.2 split into per-item Evidence Folder cards/folders/runs
          // (4.2.1 Student Contract, 4.2.2 Fee Collection & FPS). Replace the
          // persisted single "4.2" folder with two item folders that CARRY OVER
          // its Drive links (so no linked evidence is lost — the user re-points
          // them per item), and DROP the merged "4.2" Option A run results,
          // which cannot be honestly split between the two items and must be
          // re-run per item. The per-item checklist bands/lines are keyed by
          // gd4ItemId in a different store and are untouched.
          const SPLIT_SUB = "4.2";
          const scopes = runScopesForSub(SPLIT_SUB); // ["4.2.1","4.2.2"]
          const dropMerged = <V,>(rec: Record<string, V> | undefined) =>
            rec ? Object.fromEntries(Object.entries(rec).filter(([k]) => k !== SPLIT_SUB)) as Record<string, V> : rec;
          const folders = s.folders ?? [];
          const merged = folders.find((f) => !f.scopeId && f.subCriterionId === SPLIT_SUB);
          const splitFolders = merged
            ? scopes.map((scopeId) => ({
                ...merged,
                id: `FOLD-${scopeId}`,
                scopeId,
                folderName: `${scopeId} ${scopeTitle(scopeId)}`,
                // Links/access/owner carry over; audit stamps reset because the
                // merged run's results are dropped, so each item starts fresh.
                lastAuditAt: undefined, lastAuditSummary: undefined, lastAuditRunId: undefined,
                lastAuditLive: undefined, lastAuditError: undefined, lastAuditNewestModified: undefined,
                lastAuditScope: undefined, lastAuditAuditor: undefined,
              }))
            : [];
          const path42 = s.analysisPath?.[SPLIT_SUB];
          s = {
            ...s,
            folders: merged ? [...folders.filter((f) => f !== merged), ...splitFolders] : folders,
            ppdReviewResults: dropMerged(s.ppdReviewResults),
            evidenceAssessments: dropMerged(s.evidenceAssessments),
            ppdReviewHistory: dropMerged(s.ppdReviewHistory),
            evidenceAssessmentHistory: dropMerged(s.evidenceAssessmentHistory),
            outcomeReviewResults: dropMerged(s.outcomeReviewResults),
            pendingCommits: dropMerged(s.pendingCommits),
            // Carry the A/B path choice to both item scopes; drop the merged key.
            analysisPath: {
              ...dropMerged(s.analysisPath),
              ...(path42 ? Object.fromEntries(scopes.map((sc) => [sc, path42])) : {}),
            },
            // The old merged run record is keyed by the old folder id.
            lastAuditRuns: s.lastAuditRuns
              ? Object.fromEntries(Object.entries(s.lastAuditRuns).filter(([k]) => k !== `FOLD-${SPLIT_SUB}`))
              : s.lastAuditRuns,
          } as WorkspaceState;
          // Order the two new folders correctly / seed any missing scope.
          s = { ...s, folders: s.folders ? reconcileFolders(s.folders) : s.folders } as WorkspaceState;
        }
        return s;
      },
      partialize: (s) => {
        const capLog = (entries: AIReviewLogEntry[]) =>
          entries.map((e) => ({ ...e, promptSent: capPersistedText(e.promptSent), generatedContent: capPersistedText(e.generatedContent) }));
        const capPpd = (r: Record<string, PPDReviewResult>) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, promptSent: capPersistedText(v.promptSent) }]));
        const capEv = (r: Record<string, EvidenceAssessmentResult>) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, promptSent: capPersistedText(v.promptSent) }]));
        const capOr = (r: Record<string, OutcomeReviewPassResult>) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, promptSent: capPersistedText(v.promptSent) }]));
        // Task 2: same promptSent cap, applied to every ARCHIVED run in
        // history — without this, each past run's full prompt would persist
        // uncapped, and OPTION_A_RUN_HISTORY_CAP runs of that is exactly the
        // large-blob-in-persisted-state growth the single-result cap above
        // exists to prevent.
        const capPpdHistory = (r: Record<string, PPDReviewResult[]>) =>
          Object.fromEntries(Object.entries(r).map(([k, arr]) => [k, arr.map((v) => ({ ...v, promptSent: capPersistedText(v.promptSent) }))]));
        const capEvHistory = (r: Record<string, EvidenceAssessmentResult[]>) =>
          Object.fromEntries(Object.entries(r).map(([k, arr]) => [k, arr.map((v) => ({ ...v, promptSent: capPersistedText(v.promptSent) }))]));
        return {
          ...s,
          fileTextCache: {},
          changeLog: [],
          aiReviewLog: capLog(s.aiReviewLog),
          ppdReviewResults: capPpd(s.ppdReviewResults),
          ppdReviewHistory: capPpdHistory(s.ppdReviewHistory),
          evidenceAssessments: capEv(s.evidenceAssessments),
          evidenceAssessmentHistory: capEvHistory(s.evidenceAssessmentHistory),
          outcomeReviewResults: capOr(s.outcomeReviewResults),
          // Historical snapshots: strip the embedded log (new snapshots no
          // longer capture it) and cap embedded Option A prompts.
          versions: s.versions.map((v) => ({
            ...v,
            snapshot: {
              ...v.snapshot,
              aiReviewLog: undefined,
              ppdReviewResults: v.snapshot.ppdReviewResults ? capPpd(v.snapshot.ppdReviewResults) : undefined,
              ppdReviewHistory: v.snapshot.ppdReviewHistory ? capPpdHistory(v.snapshot.ppdReviewHistory) : undefined,
              evidenceAssessments: v.snapshot.evidenceAssessments ? capEv(v.snapshot.evidenceAssessments) : undefined,
              evidenceAssessmentHistory: v.snapshot.evidenceAssessmentHistory ? capEvHistory(v.snapshot.evidenceAssessmentHistory) : undefined,
            },
          })),
        };
      },
    }
  )
);
