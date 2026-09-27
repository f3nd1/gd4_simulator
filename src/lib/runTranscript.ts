import type { AiCallRecord, AuditFileRecord, EvidenceAssessmentResult, PPDReviewResult } from "../types";
import { normalizeAuditRef } from "./gd4Refs";

// What the check actually did, as a record you can read on screen after it has
// finished.
//
// THE SPINE IS aiCallLog + fileLedger, NOT runLog. The running commentary is
// capped at RUN_LOG_CAP_PER_PASS lines per pass, so a folder of 38 files
// overflows it and the pass loses its own beginning. The other two are
// uncapped, so a chronology built from them is complete. The commentary is
// carried as colour, in its own block, with the truncation said out loud
// rather than left as a silent gap.
//
// NO DOCUMENT TEXT. Every field here is a file name, a count, a duration, a
// ref or a verdict. The opt-in full-prompt capture stays where it is: admin
// only, in memory, download only. A process owner sees this in full.

export const RUN_LOG_CAP_PER_PASS = 60;

export type TranscriptPass = "procedure" | "records" | "run";
export type TranscriptTone = "info" | "good" | "warn" | "bad";

export type TranscriptVerdict = {
  ref: string;
  /** What the model answered in that call. */
  model: string;
  /** What the check RECORDED for that line, once the code-level gates had run. */
  final?: string;
  /** The two differ: a gate moved it. Worth seeing, never hidden. */
  changed: boolean;
};

export type TranscriptRow = {
  id: string;
  pass: TranscriptPass;
  kind: "pass" | "step" | "file" | "call" | "narrative" | "gap";
  label: string;
  detail?: string;
  /** Wall clock, ONLY where one is genuinely recorded. Files carry none. */
  at?: number;
  durationMs?: number;
  tone?: TranscriptTone;
  verdicts?: TranscriptVerdict[];
};

// The two passes named as the page names them, not as the engine does.
const PASS_TITLE: Record<"procedure" | "records", string> = {
  procedure: "Reading your written procedure",
  records: "Checking your records against it",
};

// Plain English for each engine stage. An unknown stage falls back to its raw
// name rather than a guess: a wrong plain-English label would be worse than an
// ugly true one.
const STAGE_LABEL: Record<string, string> = {
  "procedure/extract": "Read part of your written procedure, looking for anything that speaks to these requirements",
  "procedure/contradiction-hunt": "Checked that part for statements that contradict each other",
  "procedure/judge": "Decided these requirements from what it had found",
  "records/extract": "Read part of your records, looking for anything that speaks to these requirements",
  "records/judge": "Decided these requirements from what it had found",
};

const OUTCOME_TONE: Record<AiCallRecord["outcome"], TranscriptTone> = {
  ok: "good", empty: "info", skipped: "warn", failed: "bad",
};

function fmtSecs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// What the ledger says happened to one file, in the vocabulary the File Ledger
// already uses, plus the two disclosures a reader most needs: how much was
// read, and what was NOT.
export function fileLine(f: AuditFileRecord): { label: string; detail: string; tone: TranscriptTone } {
  const bits: string[] = [];
  if (f.charCount) bits.push(`${f.charCount.toLocaleString("en-SG")} characters`);
  if (f.readMethod === "vision") bits.push("read as images (scanned)");
  else if (f.readMethod === "text") bits.push("read as text");
  if (f.partialRead) bits.push(`ONLY ${f.partialRead.read.toLocaleString("en-SG")} of ${f.partialRead.total.toLocaleString("en-SG")} ${f.partialRead.kind} read`);
  if (f.chunkIds?.length) bits.push(`${f.chunkIds.length} part${f.chunkIds.length === 1 ? "" : "s"}`);

  if (f.readStatus === "skipped") {
    return { label: `Skipped ${f.name}`, detail: f.skipReason || "No reason was recorded.", tone: "warn" };
  }
  if (f.readStatus === "failed") {
    return { label: `Could not read ${f.name}`, detail: f.failReason || "No reason was recorded.", tone: "bad" };
  }
  if (f.readStatus === "found" || f.readStatus === "reading") {
    // The run ended before this file was reached. Saying "read" would be the
    // silent evidence loss this whole page exists to prevent.
    return { label: `Never opened ${f.name}`, detail: "The check ended before it reached this document.", tone: "warn" };
  }
  return {
    label: `Read ${f.name}`,
    detail: bits.join(" · ") || "Read.",
    tone: f.partialRead ? "warn" : "good",
  };
}

function callRow(pass: "procedure" | "records", c: AiCallRecord, finals: Map<string, string>): TranscriptRow {
  const stage = STAGE_LABEL[c.pass] ?? c.pass;
  const bits = [c.label];
  if (c.refs?.length) bits.push(`${c.refs.length} requirement line${c.refs.length === 1 ? "" : "s"}`);
  bits.push(
    c.outcome === "ok" ? `answered in ${fmtSecs(c.durationMs)}`
      : c.outcome === "empty" ? `answered with nothing to report, in ${fmtSecs(c.durationMs)}`
      : c.outcome === "skipped" ? "skipped before it answered"
      : `FAILED after ${fmtSecs(c.durationMs)}`,
  );
  if (c.error) bits.push(c.error);
  const verdicts = (c.verdicts ?? []).map((v) => {
    const final = finals.get(normalizeAuditRef(v.ref));
    return { ref: v.ref, model: v.verdict, final, changed: !!final && final !== v.verdict };
  });
  return {
    id: `${pass}-call-${c.seq}`,
    pass, kind: "call",
    label: `${c.seq}. ${stage}`,
    detail: bits.join(" · "),
    at: c.startedAt,
    durationMs: c.durationMs,
    tone: OUTCOME_TONE[c.outcome],
    ...(verdicts.length ? { verdicts } : {}),
  };
}

function passRows(
  pass: "procedure" | "records",
  res: PPDReviewResult | EvidenceAssessmentResult | undefined,
  finals: Map<string, string>,
): TranscriptRow[] {
  if (!res) return [];
  const rows: TranscriptRow[] = [];
  const startedAt = Date.parse(res.runAt);
  const head: string[] = [];
  if (Number.isFinite(startedAt)) head.push(new Date(startedAt).toLocaleString("en-SG"));
  if (res.durationMs) head.push(`took ${fmtSecs(res.durationMs)}`);
  if (res.model) head.push(res.model);
  rows.push({
    id: `${pass}-head`, pass, kind: "pass",
    label: PASS_TITLE[pass],
    detail: head.join(" · "),
    ...(Number.isFinite(startedAt) ? { at: startedAt } : {}),
  });

  const files = res.fileLedger ?? [];
  if (files.length > 0) {
    rows.push({
      id: `${pass}-files-head`, pass, kind: "step",
      label: `${files.length} document${files.length === 1 ? "" : "s"}, in the order they were opened`,
      // Said rather than implied: the ledger records order, not a clock, so
      // putting a time on these rows would be an invented one.
      detail: "Every document is read before any of it is sent to be checked, so these all come first. The ledger records their order, not the time of each one.",
    });
    files.forEach((f, i) => {
      const { label, detail, tone } = fileLine(f);
      rows.push({ id: `${pass}-file-${i}`, pass, kind: "file", label: `${i + 1}. ${label}`, detail, tone });
    });
  }

  const calls = res.aiCallLog ?? [];
  if (calls.length > 0) {
    const bad = calls.filter((c) => c.outcome !== "ok").length;
    rows.push({
      id: `${pass}-calls-head`, pass, kind: "step",
      label: `${calls.length} request${calls.length === 1 ? "" : "s"} to the checking service`,
      detail: bad > 0 ? `${bad} did not come back cleanly.` : "All came back cleanly.",
    });
    for (const c of [...calls].sort((a, b) => a.seq - b.seq)) rows.push(callRow(pass, c, finals));
  } else {
    rows.push({
      id: `${pass}-calls-missing`, pass, kind: "gap", tone: "warn",
      label: "No record of the individual requests was kept for this pass.",
      detail: "Only the run you are on now keeps that record. An older run, or one you have scrolled back to in the history, keeps its documents and its result but not its requests.",
    });
  }

  const log = res.runLog ?? [];
  if (log.length === 0) {
    rows.push({
      id: `${pass}-log-missing`, pass, kind: "gap", tone: "warn",
      label: "No running commentary was kept for this pass.",
      detail: "The document list and the request list above are the complete record.",
    });
  } else {
    if (log.length >= RUN_LOG_CAP_PER_PASS) {
      // THE POINT OF THIS ROW: the commentary is the one capped source, and a
      // reader must not mistake a truncated log for a short pass.
      rows.push({
        id: `${pass}-log-cut`, pass, kind: "gap", tone: "warn",
        label: `The earliest commentary lines for this pass were dropped.`,
        detail: `Only the last ${RUN_LOG_CAP_PER_PASS} are kept, and this pass filled that. Nothing else is missing: the documents and the requests above are complete, and they are what this record is built from.`,
      });
    }
    rows.push({
      id: `${pass}-log-head`, pass, kind: "step",
      label: `Running commentary${log.length >= RUN_LOG_CAP_PER_PASS ? ` (last ${log.length} lines)` : ` (${log.length} line${log.length === 1 ? "" : "s"})`}`,
      detail: "What the check said to itself as it went. Kept as colour beside the record above, never as the record itself.",
    });
    for (const [i, l] of [...log].sort((a, b) => a.at - b.at).entries()) {
      rows.push({ id: `${pass}-log-${i}`, pass, kind: "narrative", label: l.text, at: l.at, tone: l.tone });
    }
  }
  return rows;
}

// Documents whose text reached the model but which no verdict ever quoted.
//
// Not a fault on its own, and it must not be presented as one: an area that
// simply does not need a document will leave it uncited. What it IS is the one
// place a missed passage would show up, because a requirement judged "not met"
// against a file nobody quoted is either a real gap or a read the check failed
// to use. Measured on a real 5.5 run: 4 of 42 chunks were never cited, one of
// them a duplicate copy of a file already read twice over.
//
// "Cited" is taken from the rows' own chunk ids, the same ones the verdicts
// carry, so this cannot drift from what the result actually quotes.
export type UncitedFile = {
  name: string;
  path: string;
  charCount?: number;
  readMethod?: AuditFileRecord["readMethod"];
  chunkIds: string[];
  bucket: AuditFileRecord["bucket"];
};

export function uncitedFiles(args: {
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
}): UncitedFile[] {
  const cited = new Set<string>();
  for (const r of args.ppd?.rows ?? []) for (const c of r.chunkIds ?? []) cited.add(c);
  for (const r of args.evidence?.rows ?? []) {
    for (const c of r.evidenceChunkIds ?? []) cited.add(c);
    for (const pc of r.promiseChecks ?? []) for (const c of pc.chunkIds ?? []) cited.add(c);
  }
  const out: UncitedFile[] = [];
  const seen = new Set<string>();
  for (const f of [...(args.ppd?.fileLedger ?? []), ...(args.evidence?.fileLedger ?? [])]) {
    // Only a file whose text actually reached the model can be "never quoted".
    // A skipped or failed file is already reported as skipped or failed, and
    // listing it here again would read as a second, different fault.
    const ids = f.chunkIds ?? [];
    if (ids.length === 0 || f.readStatus !== "read") continue;
    if (ids.some((c) => cited.has(c))) continue;
    const key = `${f.bucket}::${f.driveFileId || f.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: f.name, path: f.path, charCount: f.charCount, readMethod: f.readMethod, chunkIds: ids, bucket: f.bucket });
  }
  return out;
}

export const UNCITED_NOTE =
  "These documents were read but no requirement quoted them. Either this area does not need them, or the check missed something in them.";

export function buildRunTranscript(args: {
  ppd?: PPDReviewResult;
  evidence?: EvidenceAssessmentResult;
}): { rows: TranscriptRow[]; summary: string } {
  // Final verdicts, per pass, so a judge call can show what the check RECORDED
  // beside what the model answered. Both sides normalised, as every ref
  // comparison in this app must be (gd4Refs.ts).
  const ppdFinals = new Map((args.ppd?.rows ?? []).map((r) => [normalizeAuditRef(r.ref), String(r.verdict)]));
  const evFinals = new Map((args.evidence?.rows ?? []).map((r) => [normalizeAuditRef(r.gdRef), String(r.verdict)]));

  const rows = [
    ...passRows("procedure", args.ppd, ppdFinals),
    ...passRows("records", args.evidence, evFinals),
  ];

  const files = (args.ppd?.fileLedger?.length ?? 0) + (args.evidence?.fileLedger?.length ?? 0);
  const calls = (args.ppd?.aiCallLog?.length ?? 0) + (args.evidence?.aiCallLog?.length ?? 0);
  const failed = [...(args.ppd?.aiCallLog ?? []), ...(args.evidence?.aiCallLog ?? [])].filter((c) => c.outcome !== "ok").length;
  const changed = rows.reduce((n, r) => n + (r.verdicts?.filter((v) => v.changed).length ?? 0), 0);

  const summary = rows.length === 0
    ? "There is no record for this run."
    : [
        `${files} document${files === 1 ? "" : "s"} opened`,
        `${calls} request${calls === 1 ? "" : "s"} to the checking service`,
        failed > 0 ? `${failed} did not come back cleanly` : null,
        changed > 0 ? `${changed} verdict${changed === 1 ? "" : "s"} changed after the answer came back` : null,
      ].filter(Boolean).join(" · ");

  return { rows, summary };
}
