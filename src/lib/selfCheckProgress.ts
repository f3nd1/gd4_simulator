// The live progress panel's logic, for the self-check page.
//
// Split out of the component for the reason the rest of this codebase splits
// such things out: anything reaching useWorkspaceStore pulls in driveClient,
// which builds a pdfjs Worker at import time and cannot be loaded in vitest. So
// the decisions live here and are tested here; the component only renders them.
//
// It reads the progress objects the two Option A passes ALREADY emit. It adds
// no events, changes no run behaviour, and computes nothing the engine does not
// already count.
//
// It deliberately ignores the engine's own `pct` field. That field clamps the
// reading stage at 24 (useWorkspaceStore.ts:2106) and then jumps to a literal 99
// (:2335), so it both understates and parks at 99 - the two failure modes a
// progress indicator must never have.
import type { AuditFileRecord } from "../types";

// "outcomes" is the optional third pass over the results-and-review folder. It
// emits no per-line progress object of its own, so it falls through to the
// indeterminate indicator alongside "folder" and "band".
export type StageKey = "folder" | "policy" | "records" | "outcomes" | "band";

// Only the fields this panel reads, so a test does not have to build a whole
// PPDReviewProgress/EvidenceAssessmentProgress.
export type RunProgress = {
  heartbeatAt?: number;
  filesTotal?: number;
  filesFound?: AuditFileRecord[];
  currentFile?: string;
  canSkipCurrentFile?: boolean;
  window?: { current: number; total: number };
  lineRefs?: string[];
  lineStatus?: Record<string, "waiting" | "assessing" | "done">;
  // Which source files the AI call in flight right now is reading from, so a
  // stuck stage can name the documents rather than "the checking service".
  currentWindowFiles?: string[];
  // Everything the run has said so far, oldest first. The page showed only the
  // line in flight, so a reader could see what was happening now and nothing
  // about what had already been read.
  log?: { at: number; text: string; tone?: "info" | "good" | "warn" | "bad" }[];
  // The requirement lines the call in flight covers, and which pass it is.
  currentRefs?: string[];
  passStage?: "extract" | "judge";
  // The Outcomes & Review pass emits only a prose detail line ("Reading X…"),
  // no file ledger and no per-line map, so that stage shows this verbatim.
  detail?: string;
};

// A counted denominator, or null. Null means "show an indeterminate indicator",
// never "show 0%" and never "estimate".
export type Counted = { done: number; total: number; pct: number } | null;

// A denominator of 1 is not progress: it can only ever read 0% and then vanish,
// and a bar parked at 0% for a whole stage is the same defect as one parked at
// 99%. Those stages fall through to the indeterminate indicator instead.
const counted = (done: number, total: number): Counted =>
  total > 1 ? { done, total, pct: Math.min(100, Math.round((done / total) * 100)) } : null;

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export type FileTally = { read: number; skipped: number; failed: number; total: number; skippedNames: string[] };

// Skipped and unreadable files are counted AND named. A file that was never
// read must never disappear into a "7 files read" that implies it was.
export function tallyFiles(files: AuditFileRecord[] | undefined): FileTally {
  const f = files ?? [];
  const isRead = (r: AuditFileRecord) => r.readStatus === "read" || r.readStatus === "condensed";
  const notRead = f.filter((r) => r.readStatus === "skipped" || r.readStatus === "failed");
  return {
    read: f.filter(isRead).length,
    skipped: f.filter((r) => r.readStatus === "skipped").length,
    failed: f.filter((r) => r.readStatus === "failed").length,
    total: f.length,
    skippedNames: notRead.map((r) => r.name),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One line, shown under a stage that has finished.
export function fileStageSummary(files: AuditFileRecord[] | undefined): string {
  const t = tallyFiles(files);
  if (t.total === 0) return "";
  const parts = [`${plural(t.read, "file read", "files read")}`];
  if (t.skipped > 0) parts.push(`${t.skipped} skipped`);
  if (t.failed > 0) parts.push(`${t.failed} could not be read`);
  let line = parts.join(", ");
  // Naming them is the point: a count alone hides WHICH document was missed.
  if (t.skippedNames.length > 0) line += ` (${t.skippedNames.join(", ")})`;
  return line;
}

// What the run is doing right now, in words a process owner uses. Returns "" when
// the run genuinely cannot say, so the caller falls back to "Still working".
export function activityLine(stage: StageKey, p: RunProgress | undefined): string {
  if (!p) return "";
  if (stage === "outcomes") return p.detail ?? "";
  if (stage === "policy" || stage === "records") {
    if (p.currentFile) {
      const done = tallyFiles(p.filesFound);
      const idx = Math.min(done.read + done.skipped + done.failed + 1, p.filesTotal ?? 0);
      return p.filesTotal ? `Reading ${p.currentFile} (file ${idx} of ${p.filesTotal})` : `Reading ${p.currentFile}`;
    }
    // Requirement lines before document parts: the line is the unit of work the
    // reader actually cares about, and there are usually more of them, so it
    // moves where a one-part window never would.
    const lines = lineCounted(p);
    if (lines) return `Checking requirement ${Math.min(lines.done + 1, lines.total)} of ${lines.total}`;
    if (p.window && p.window.total > 1) {
      return `Working through your documents (part ${p.window.current} of ${p.window.total})`;
    }
  }
  return "";
}

function lineCounted(p: RunProgress | undefined): Counted {
  if (!p?.lineRefs?.length || !p.lineStatus) return null;
  const done = p.lineRefs.filter((r) => p.lineStatus![r] === "done").length;
  return counted(done, p.lineRefs.length);
}

// The ONLY three counted denominators on this page, each a real count the engine
// already keeps: files read of filesTotal, window.current of window.total, and
// finished requirement lines of lineRefs.length. "Opening your folder" and
// "Working out your result" have none and must stay indeterminate.
export function countedFor(stage: StageKey, p: RunProgress | undefined): Counted {
  if (!p) return null;
  if (stage === "folder" || stage === "outcomes" || stage === "band") return null;
  if (p.currentFile && p.filesTotal) {
    const t = tallyFiles(p.filesFound);
    return counted(t.read + t.skipped + t.failed, p.filesTotal);
  }
  // Same ordering as the activity line: whichever real counter has the finer
  // resolution, never a coarser one that would sit still.
  const lines = lineCounted(p);
  if (lines) return lines;
  if (p.window) return counted(p.window.current - 1, p.window.total);
  return null;
}

// Stall detection, from the heartbeat the engine already bumps on every event.
export const SLOW_AFTER_MS = 60_000;
export const STUCK_AFTER_MS = 300_000;

export type StallState =
  | { level: "none" }
  | {
      level: "slow" | "stuck";
      // What it is waiting on, named rather than guessed.
      waitingOn: string;
      // A file read can be skipped for real, and so can the AI call in flight
      // (the engine races every one against a skip). "cancel" is the last
      // resort, for a stall with neither in progress, and a control must never
      // be dressed as something it is not.
      control: "skip" | "skip-call" | "cancel";
      controlLabel: string;
      controlNote: string;
    };

export function stallState(now: number, p: RunProgress | undefined, startedAt: number, canSkipCall = false): StallState {
  const last = p?.heartbeatAt ?? startedAt;
  const quiet = now - last;
  if (quiet < SLOW_AFTER_MS) return { level: "none" };
  const level = quiet >= STUCK_AFTER_MS ? "stuck" : "slow";
  if (p?.canSkipCurrentFile && p.currentFile) {
    return {
      level,
      waitingOn: `It is still reading ${p.currentFile}.`,
      control: "skip",
      controlLabel: "Skip this file",
      controlNote: "The rest of your documents will still be checked. The skipped file is named in your result.",
    };
  }
  // A stuck AI call CAN be abandoned on its own: the engine races every call
  // against a skip (raceCallSkip), which is what the Evidence Folder's "skip
  // this call" control uses. This page used to offer only Stop, so a single
  // hung call meant losing the whole run — a user sat on one for 50 minutes.
  const files = p?.currentWindowFiles?.length ? ` It is reading from ${p.currentWindowFiles.slice(0, 3).join(", ")}${p.currentWindowFiles.length > 3 ? ` and ${p.currentWindowFiles.length - 3} more` : ""}.` : "";
  if (canSkipCall) {
    return {
      level,
      waitingOn: `It is waiting for the checking service to answer.${files}`,
      control: "skip-call",
      controlLabel: "Skip this step and carry on",
      controlNote: "Only this one request is abandoned. The check moves on to the next batch of documents, and any requirement it never reached is reported as not checked rather than as a fault in your area.",
    };
  }
  return {
    level,
    waitingOn: `It is waiting for the checking service to answer.${files}`,
    control: "cancel",
    controlLabel: "Stop the check",
    controlNote: "There is no way to skip just this step, so stopping ends the whole check. Nothing you have already is lost.",
  };
}

// Copy that rotates while a single requirement is being read.
//
// One requirement takes 15 to 25 seconds, and every engine-driven indicator
// holds completely still for that whole time. Two real screenshots 29 seconds
// apart showed the bar move 0% to 25% and the line change from "requirement 1
// of 8" to "requirement 3 of 8", with nothing moving in between, which reads as
// a freeze. These lines change on their own clock so the card is never static.
//
// None of them claims progress. They say what the wait IS, which is the only
// honest thing available between two engine events.
export const WAITING_MESSAGES = [
  "Each requirement takes a little while to read through.",
  "Still reading your documents. This is the slow part of the check.",
  "Working through one requirement at a time.",
  "This is normal. A full check usually takes a few minutes.",
];

// Eight seconds: long enough not to twitch, short enough that a person who
// looks away and back sees a different line.
export const MESSAGE_ROTATE_MS = 8_000;

export function waitingMessage(elapsedMs: number): string {
  const i = Math.floor(Math.max(0, elapsedMs) / MESSAGE_ROTATE_MS) % WAITING_MESSAGES.length;
  return WAITING_MESSAGES[i];
}

// A rough finish estimate, derived ONLY from the pace already observed: the
// time this stage has actually taken divided by the requirements it has
// actually finished. No timer, no constant, no guess before there is something
// to measure.
//
// Returns null until at least one requirement is done, because before that
// there is no denominator and any number would be invented.
export function roughRemaining(done: number, total: number, msSinceStageStart: number): string | null {
  if (done < 1 || total <= done || msSinceStageStart <= 0) return null;
  const perItem = msSinceStageStart / done;
  const remainingMs = (total - done) * perItem;
  const secs = Math.round(remainingMs / 1000);
  if (secs <= 20) return "nearly done";
  // Rounded coarsely on purpose. A figure like "about 1m 47s left" reads as a
  // countdown the run cannot honour; "about 2 minutes" reads as the estimate it
  // actually is.
  if (secs < 90) return `about ${Math.round(secs / 30) * 30} seconds left`;
  const mins = Math.max(2, Math.round(secs / 60));
  return `about ${mins} minutes left`;
}

export const SLOW_TITLE = "This step is taking longer than usual";


// ── What the run can honestly say about itself while it is still running ────
//
// NOT the verdicts. A line's verdict is emitted by the judge loop as the raw
// model answer, and four code-level gates run AFTER that loop: the Approach
// hard-gate cap, the uncited-positive downgrade, the promise hard-gate and
// the verdict/comment consistency guard. Measured on a live run: the model
// said "Met" for 6.3.1.DS1 and the stored result says "Partial". Showing the
// mid-run answer would be a judgement the run has not made, which is the
// defect this page has had removed three times.
//
// What IS stable is where each line has got to. A line goes waiting →
// being checked → checked and never goes back, so none of it can be
// contradicted later.
export type LiveLineState = "waiting" | "checking" | "checked";
export type LiveLine = { ref: string; state: LiveLineState };

export type LineProgress = {
  total: number;
  checked: number;
  checking: number;
  waiting: number;
  lines: LiveLine[];
};

// WHICH pass these counts belong to. The two passes keep separate progress
// objects and separate line maps, so the board legitimately restarts at zero
// when the run moves from the procedure to the records. Measured on a live
// run: without this the counts read 13 checked and then 13 still to do, which
// looks like the check undoing its own work. Naming the pass makes the reset
// mean what it is.
export function linePassLabel(phase: string): string {
  if (phase === "policy") return "Against your written procedure";
  if (phase === "records" || phase === "band") return "Against your records";
  return "Requirements";
}

export function lineProgress(p: RunProgress | undefined): LineProgress | null {
  const refs = p?.lineRefs ?? [];
  if (refs.length === 0) return null;
  const lines: LiveLine[] = refs.map((ref) => {
    const st = p?.lineStatus?.[ref];
    return { ref, state: st === "done" ? "checked" : st === "assessing" ? "checking" : "waiting" };
  });
  return {
    total: lines.length,
    checked: lines.filter((l) => l.state === "checked").length,
    checking: lines.filter((l) => l.state === "checking").length,
    waiting: lines.filter((l) => l.state === "waiting").length,
    lines,
  };
}

// What the call in flight is for, in the words of the pass that is running.
// "extract" reads the documents looking for passages; "judge" decides the
// lines from what was found. Null when no call is in flight, rather than a
// guess.
export type NowDoing = { verb: string; refs: string[] } | null;

export function nowDoing(p: RunProgress | undefined): NowDoing {
  const refs = p?.currentRefs ?? [];
  if (refs.length === 0) return null;
  return {
    verb: p?.passStage === "judge"
      ? "Deciding these requirements from the passages it found"
      : "Reading your documents, looking for anything that speaks to",
    refs,
  };
}

// Failures, pulled out of the run log rather than invented: the engine
// already logs every failed batch with tone "bad", and those lines are the
// thing a reader most needs while there is still time to act.
export function failureLines(p: RunProgress | undefined, cap = 4): { rows: string[]; more: number } {
  const bad = (p?.log ?? []).filter((l) => l.tone === "bad").map((l) => l.text);
  return { rows: bad.slice(-cap), more: Math.max(0, bad.length - cap) };
}
