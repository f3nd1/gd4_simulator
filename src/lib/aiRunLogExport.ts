import type { AiCallRecord, AuditFileRecord, PPDReviewResult, EvidenceAssessmentResult, OutcomeReviewPassResult } from "../types";
import { buildRunStages } from "./runStages";
import { buildStamp } from "./buildInfo";

// The downloadable record of one area's run.
//
// TWO TIERS, and the split is a privacy decision rather than a size one.
//
// The metadata tier is always kept and holds NO document text: which call, in
// which pass, over which window, how long it took, what it produced, what
// failed. That is what makes it safe to persist — the prompts contain the
// evidence itself (names, NRIC/FIN, fees, grades) and every signed-in person
// on this app can read everything, so a debugging trace must not put student
// data in the shared database.
//
// The full tier — the prompts and the raw responses — is captured only when a
// person explicitly arms it for one run, lives in memory for that session
// alone, and reaches a file only by being downloaded. It is never written to
// Supabase, localStorage or anywhere else.

export type FullCallText = { seq: number; pass: string; prompt: string; response: string };

// Said on the toggle, on the run banner while it is on, and beside the
// download. One constant so the three cannot drift apart: the sentence is the
// only thing standing between a person and emailing their students' records.
export const DOC_TEXT_WARNING =
  "The file you download will contain your document text, so treat it as you would the documents.";

/**
 * Adds one call's text to the capture, dropping that pass's EARLIER text when
 * the pass starts again.
 *
 * The toggle stays on until it is switched off, so the same area can be
 * re-checked several times while it is armed. Without this the second run
 * appends to the first and the download hands over two runs interleaved under
 * repeated call numbers, which is worse than useless for diagnosing one of
 * them. A pass numbers its own calls from 1 (agentRuntime's aiSeq), so seq === 1
 * is that pass starting, and only its own family ("procedure/…" or "records/…")
 * is dropped: the records pass must not wipe the procedure pass it follows.
 */
export function appendFullCall(
  entries: FullCallText[],
  rec: { seq: number; pass: string },
  text: { prompt: string; response: string },
): FullCallText[] {
  const family = rec.pass.split("/")[0];
  const kept = rec.seq === 1 ? entries.filter((e) => e.pass.split("/")[0] !== family) : entries;
  return [...kept, { seq: rec.seq, pass: rec.pass, prompt: text.prompt, response: text.response }];
}

export type AiRunLogPass = {
  pass: "procedure" | "records" | "outcomes";
  runAt?: string;
  durationMs?: number;
  model?: string;
  warnings?: string[];
  calls: AiCallRecord[];
  /** Call counts by stage and by outcome, so three runs can be compared without re-deriving them. */
  callCounts: { total: number; byStage: Record<string, number>; byOutcome: Record<string, number>; msInCalls: number };
  /** The two clocks the pass measures itself, in ms. Absent on a run from before they existed. */
  stageTimings?: { listingMs: number; readMs: number };
  files: {
    name: string; path: string; bucket: string; readStatus: string; readMethod?: string;
    charCount?: number; chunkIds?: string[]; skipReason?: string; failReason?: string;
    partialRead?: AuditFileRecord["partialRead"];
  }[];
};

export type AiRunLog = {
  kind: "gd4-ai-run-log";
  // 2: every OCR read now appears in `calls` (pass "<pass>/ocr", input
  // "image", promptChars 0), the stage timings are carried on each pass, and
  // an empty answer is no longer logged as a success. A v1 reader would
  // under-report the call count and mis-read those outcomes.
  version: 2;
  exportedAt: string;
  build: string;
  area: string;
  /** False when the person did not arm full capture — the normal case. */
  fullPromptsIncluded: boolean;
  /** Says in the file itself what the file does and does not contain. */
  privacyNote: string;
  /** What a verdict in this log IS. The log is the artefact most likely to be
   *  quoted back later, and it travels without the page's caveats. */
  caveat: string;
  passes: AiRunLogPass[];
  /** THE SAME breakdown the page shows, in the file. It was on screen and
   *  absent from the export, so a reader could not check the figures or
   *  compare three runs of one area. Rows sum to wallMs, and the residual is
   *  signed: see runStages.ts. */
  timeBreakdown: { wallMs: number; wallMeasured: boolean; note?: string; rows: { key: string; label: string; ms: number; pct: number }[] };
  fullText?: FullCallText[];
};

// One pass is one reading. Verdicts in this file are not a fixed property of
// the documents: two runs on the same 39 documents moved two of them.
const RUN_LOG_CAVEAT =
  "Verdicts in this log are one reading of the documents. A second run on the same documents can reach a different verdict on some lines. This is an internal practice check, never an official SSG or EduTrust result.";

const NO_TEXT_NOTE =
  "This log contains NO document text: no prompts, no AI responses, no evidence. Only which calls ran, over which window, how long they took and what they produced. Nothing in it should identify a student.";
const WITH_TEXT_NOTE =
  "THIS LOG CONTAINS THE FULL PROMPTS AND AI RESPONSES, which include the text of your evidence documents and may therefore contain personal data (names, NRIC/FIN, fees, grades). It was produced because full capture was switched on for this run. Treat it as you would the documents themselves: do not post it anywhere public, and delete it when it has served its purpose.";

// Counts a reader would otherwise have to derive by hand from `calls`, which
// is the whole reason the breakdown could not be checked against the page.
function countsOf(calls: AiCallRecord[]): AiRunLogPass["callCounts"] {
  const byStage: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  let msInCalls = 0;
  for (const c of calls) {
    byStage[c.pass] = (byStage[c.pass] ?? 0) + 1;
    byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
    msInCalls += c.durationMs;
  }
  return { total: calls.length, byStage, byOutcome, msInCalls };
}

function filesOf(ledger: AuditFileRecord[] | undefined): AiRunLogPass["files"] {
  return (ledger ?? []).map((f) => ({
    name: f.name, path: f.path, bucket: f.bucket, readStatus: f.readStatus,
    readMethod: f.readMethod, charCount: f.charCount, chunkIds: f.chunkIds,
    skipReason: f.skipReason, failReason: f.failReason, partialRead: f.partialRead,
  }));
}

export function buildAiRunLog(args: {
  area: string;
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
  // The third pass, so its calls and its clock reach the file too.
  outcome?: OutcomeReviewPassResult;
  fullText?: FullCallText[];
}): AiRunLog {
  const passes: AiRunLogPass[] = [];
  if (args.ppd) {
    passes.push({
      pass: "procedure", runAt: args.ppd.runAt, durationMs: args.ppd.durationMs, model: args.ppd.model,
      warnings: args.ppd.runWarnings, calls: args.ppd.aiCallLog ?? [], files: filesOf(args.ppd.fileLedger),
      callCounts: countsOf(args.ppd.aiCallLog ?? []), ...(args.ppd.stageTimings ? { stageTimings: args.ppd.stageTimings } : {}),
    });
  }
  if (args.evidence) {
    passes.push({
      pass: "records", runAt: args.evidence.runAt, durationMs: args.evidence.durationMs, model: args.evidence.model,
      warnings: args.evidence.runWarnings, calls: args.evidence.aiCallLog ?? [], files: filesOf(args.evidence.fileLedger),
      callCounts: countsOf(args.evidence.aiCallLog ?? []), ...(args.evidence.stageTimings ? { stageTimings: args.evidence.stageTimings } : {}),
    });
  }
  if (args.outcome) {
    passes.push({
      pass: "outcomes", runAt: args.outcome.runAt, durationMs: args.outcome.durationMs, model: args.outcome.model,
      warnings: args.outcome.runWarnings, calls: args.outcome.aiCallLog ?? [], files: [],
      callCounts: countsOf(args.outcome.aiCallLog ?? []),
    });
  }
  const full = args.fullText && args.fullText.length > 0 ? args.fullText : undefined;
  return {
    kind: "gd4-ai-run-log", version: 2,
    exportedAt: new Date().toISOString(),
    build: buildStamp(),
    area: args.area,
    fullPromptsIncluded: !!full,
    privacyNote: full ? WITH_TEXT_NOTE : NO_TEXT_NOTE,
    caveat: RUN_LOG_CAVEAT,
    passes,
    timeBreakdown: (() => {
      const st = buildRunStages({ ppd: args.ppd, evidence: args.evidence, outcome: args.outcome });
      return { wallMs: st.wallMs, wallMeasured: st.wallMeasured, ...(st.note ? { note: st.note } : {}),
        rows: st.rows.map((r) => ({ key: r.key, label: r.label, ms: r.ms, pct: r.pct })) };
    })(),
    ...(full ? { fullText: full } : {}),
  };
}

/** One line per call, for a quick read without opening the JSON. */
export function summariseAiRunLog(log: AiRunLog): string {
  const total = log.passes.reduce((n, p) => n + p.calls.length, 0);
  if (total === 0) return "No AI calls were recorded for this run.";
  const failed = log.passes.reduce((n, p) => n + p.calls.filter((c) => c.outcome !== "ok").length, 0);
  const ms = log.passes.reduce((n, p) => n + p.calls.reduce((m, c) => m + c.durationMs, 0), 0);
  return `${total} AI call${total === 1 ? "" : "s"} across ${log.passes.length} pass${log.passes.length === 1 ? "" : "es"}, ${Math.round(ms / 1000)}s in calls${failed > 0 ? `, ${failed} not OK` : ""}.`;
}
