import type { EvidenceAssessmentResult, OutcomeReviewPassResult, PPDReviewResult } from "../types";

// Where the time in a check actually went, accounting for the WHOLE wall clock
// rather than only the part that talked to the model.
//
// The old panel summed AI call durations, so it could only ever report that the
// model was the slow part. Measured on a real 5.5 run: 7m 33s of logged call
// time inside an 18m 28s check, which is 41% of the truth. Worse, the OCR reads
// were not logged at all, so the single largest stage was invisible.
//
// THE RULE HERE: the rows must sum to the wall clock. Whatever the measured
// stages do not explain is reported as "Unaccounted", never hidden and never
// fudged to zero. A residual is a fact about the instrumentation, and hiding it
// would make the panel lie in exactly the way it already did.

export type StageRow = {
  key: "listing" | "download" | "reading" | "ocr" | "model" | "outcomes" | "between" | "unaccounted";
  label: string;
  detail: string;
  ms: number;
  /** Share of the wall clock, 0-100. */
  pct: number;
};

export type RunStages = {
  rows: StageRow[];
  wallMs: number;
  /** True when the two passes' own clocks could be placed on one timeline. */
  wallMeasured: boolean;
  note?: string;
};

const sumCalls = (r: PPDReviewResult | EvidenceAssessmentResult | OutcomeReviewPassResult | undefined, ocr: boolean) =>
  (r?.aiCallLog ?? []).filter((c) => c.pass.endsWith("/ocr") === ocr).reduce((n, c) => n + c.durationMs, 0);

/**
 * The wall clock of the whole check, and the gap between its two passes.
 *
 * `runAt` is stamped when a pass FINISHES, not when it starts (finish() in
 * useWorkspaceStore). Treating it as a start time places each pass one
 * durationMs too late and invents an inter-pass gap of exactly
 * (records duration - procedure duration). That is not a hypothetical: it is
 * how a 2-second gap reads as six minutes.
 */
export function passSpans(ppd?: PPDReviewResult, evidence?: EvidenceAssessmentResult, outcome?: OutcomeReviewPassResult) {
  const end = (r?: { runAt?: string }) => {
    const t = r?.runAt ? Date.parse(r.runAt) : NaN;
    return Number.isFinite(t) ? t : undefined;
  };
  const pEnd = end(ppd), eEnd = end(evidence);
  // The third pass stamps runAt at its own finish too, so it is placed the
  // same way: end minus its own duration.
  const oEnd = end(outcome);
  const oStart = oEnd !== undefined && outcome?.durationMs ? oEnd - outcome.durationMs : undefined;
  const pStart = pEnd !== undefined && ppd?.durationMs ? pEnd - ppd.durationMs : undefined;
  const eStart = eEnd !== undefined && evidence?.durationMs ? eEnd - evidence.durationMs : undefined;
  const betweenMs = pEnd !== undefined && eStart !== undefined ? Math.max(0, eStart - pEnd) : undefined;
  const first = pStart ?? eStart ?? oStart;
  const last = oEnd ?? eEnd ?? pEnd;
  return { pStart, pEnd, eStart, eEnd, oStart, oEnd, betweenMs, wallMs: first !== undefined && last !== undefined ? Math.max(0, last - first) : undefined };
}

export function buildRunStages(args: { ppd?: PPDReviewResult; evidence?: EvidenceAssessmentResult; outcome?: OutcomeReviewPassResult }): RunStages {
  const { ppd, evidence, outcome } = args;
  const span = passSpans(ppd, evidence, outcome);
  // Falls back to the sum of the two pass durations when the timestamps cannot
  // be placed, and says so rather than presenting a guess as a measurement.
  const wallMs = span.wallMs ?? ((ppd?.durationMs ?? 0) + (evidence?.durationMs ?? 0) + (outcome?.durationMs ?? 0));
  const wallMeasured = span.wallMs !== undefined;

  const listing = (ppd?.stageTimings?.listingMs ?? 0) + (evidence?.stageTimings?.listingMs ?? 0);
  const readTotal = (ppd?.stageTimings?.readMs ?? 0) + (evidence?.stageTimings?.readMs ?? 0);
  const ocr = sumCalls(ppd, true) + sumCalls(evidence, true) + sumCalls(outcome, true);
  const model = sumCalls(ppd, false) + sumCalls(evidence, false);
  // Its own row, not folded into the model total: by call count this is the
  // largest caller in a check, and burying it would answer none of the
  // question the panel exists to answer.
  const outcomes = sumCalls(outcome, false);
  // OCR happens INSIDE the read loop, so it is carved out of it rather than
  // added on top. Double-counting it would push the residual negative.
  // Now split at the seam that matters: waiting for Google, against parsing
  // what came back. A run from before the split reports driveMs 0, so the
  // whole of it stays in the parsing row rather than being invented.
  const driveMs = (ppd?.stageTimings?.driveMs ?? 0) + (evidence?.stageTimings?.driveMs ?? 0);
  const parseMs = Math.max(0, readTotal - ocr - driveMs);
  const between = span.betweenMs ?? 0;
  const pagesRead = (ppd?.stageTimings?.pagesRead ?? 0) + (evidence?.stageTimings?.pagesRead ?? 0);

  const measured = listing + driveMs + parseMs + ocr + model + outcomes + between;
  // SIGNED on purpose. Clamping at zero would break the one contract this
  // panel has, that its rows add up to the total in its header: when the
  // measured stages overlap they total MORE than the wall clock, and the only
  // honest way to show that is a negative row saying so.
  const unaccounted = wallMs - measured;

  const pct = (ms: number) => (wallMs > 0 ? Math.round((ms / wallMs) * 1000) / 10 : 0);
  const rows: StageRow[] = [
    { key: "listing", label: "Listing your Drive folders", detail: "Asking Google what is in each folder.", ms: listing, pct: pct(listing) },
    { key: "download", label: "Waiting for Google Drive", detail: "Downloading each file. Nothing in this row is work this app does.", ms: driveMs, pct: pct(driveMs) },
    { key: "reading", label: "Pulling the text out of documents", detail: `Reading each file's text once it has arrived. Excludes the scanned pages below, which are counted separately.${pagesRead > 0 ? ` ${pagesRead.toLocaleString("en-SG")} PDF pages were walked, one at a time.` : ""}`, ms: parseMs, pct: pct(parseMs) },
    { key: "ocr", label: "Reading scanned pages and images", detail: "Sending page images to the vision model because no text could be extracted.", ms: ocr, pct: pct(ocr) },
    { key: "model", label: "Checking against the requirements", detail: "Every other request to the model: looking for passages, then deciding each requirement.", ms: model, pct: pct(model) },
    { key: "outcomes", label: "Checking results and review records", detail: "The third pass, over the same documents again, looking for outcome data and records of review.", ms: outcomes, pct: pct(outcomes) },
    { key: "between", label: "Between the passes", detail: "After the procedure pass finished and before the records pass began.", ms: between, pct: pct(between) },
    {
      key: "unaccounted",
      label: unaccounted < 0 ? "Overlap between stages" : "Unaccounted",
      detail: unaccounted < 0
        ? "The measured stages add up to MORE than the wall clock, so two of them are counting the same time. Shown as a negative rather than trimmed away, because the rows above are then overstated."
        : "Wall clock left over after the stages above. It is whatever this check does not yet measure, and it is shown rather than hidden.",
      ms: unaccounted, pct: pct(unaccounted),
    },
  ];
  return {
    rows, wallMs, wallMeasured,
    note: wallMeasured ? undefined : "The passes' own clocks could not be placed on one timeline, so this total is the two pass durations added together rather than a measured wall clock.",
  };
}
