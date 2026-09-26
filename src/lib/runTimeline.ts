import type { EvidenceRunLogLine } from "../types";

// Turns a stored run log into a readable timeline.
//
// The log entries carry only absolute timestamps, which say nothing on their
// own about where a 25-minute run went. What answers that is the GAP between
// consecutive entries: the step that started at the earlier entry and was
// still running at the later one. So each row reports the time since the
// previous entry, and the slowest row is the step worth looking at.
//
// Deliberately no attempt to classify entries into stages by matching their
// wording. That would be a second, drifting copy of the log's phrasing, and a
// mis-parse would report a confident wrong breakdown — worse than none. The
// entry text is shown as written.

export type TimelineStep = {
  /** Milliseconds since the first entry. */
  offsetMs: number;
  /** Milliseconds since the PREVIOUS entry: how long this step took. */
  deltaMs: number;
  text: string;
  tone?: EvidenceRunLogLine["tone"];
  /** True for the single longest step, when one is longer than the rest. */
  slowest?: boolean;
};

export type RunTimeline = {
  steps: TimelineStep[];
  /** First entry to last. Not the whole pass: work happens before the first log line. */
  spanMs: number;
};

export function buildRunTimeline(log: EvidenceRunLogLine[] | undefined): RunTimeline {
  const entries = (log ?? [])
    .filter((e) => e && typeof e.at === "number" && isFinite(e.at) && typeof e.text === "string")
    .slice()
    .sort((a, b) => a.at - b.at);
  if (entries.length === 0) return { steps: [], spanMs: 0 };

  const first = entries[0].at;
  const steps: TimelineStep[] = entries.map((e, i) => ({
    offsetMs: Math.max(0, e.at - first),
    deltaMs: i === 0 ? 0 : Math.max(0, e.at - entries[i - 1].at),
    text: e.text,
    tone: e.tone,
  }));

  // Only mark a slowest step when it is genuinely the single longest; a tie
  // would make the marker arbitrary, and a run of equal steps has no outlier.
  const max = Math.max(...steps.map((s) => s.deltaMs));
  if (max > 0 && steps.filter((s) => s.deltaMs === max).length === 1) {
    (steps.find((s) => s.deltaMs === max) as TimelineStep).slowest = true;
  }

  return { steps, spanMs: entries[entries.length - 1].at - first };
}

/** "1.4s", "2m 05s" — same shape as the live progress panel's elapsed label. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}
