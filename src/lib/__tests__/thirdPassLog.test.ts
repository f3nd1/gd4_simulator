import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildRunStages, passSpans } from "../runStages";
import type { AiCallRecord, EvidenceAssessmentResult, OutcomeReviewPassResult, PPDReviewResult } from "../../types";

const T0 = 1_700_000_000_000;
const c = (pass: string, ms: number, seq = 1): AiCallRecord =>
  ({ seq, pass, label: "", startedAt: T0, durationMs: ms, outcome: "ok", promptChars: 0, responseChars: 0 });

const ppd = { subCriterionId: "5.5", rows: [], live: true, runAt: new Date(T0 + 186_500).toISOString(), durationMs: 186_500,
  stageTimings: { listingMs: 2_000, readMs: 131_700 }, aiCallLog: [c("procedure/extract", 52_800)] } as PPDReviewResult;
const ev = { subCriterionId: "5.5", rows: [], live: true, runAt: new Date(T0 + 188_600 + 553_200).toISOString(), durationMs: 553_200,
  stageTimings: { listingMs: 3_000, readMs: 150_500 }, aiCallLog: [c("records/extract", 399_700)] } as EvidenceAssessmentResult;
// The pass that produced no log rows at all: 533.8s of a measured run that
// could only be described as "after the records pass".
const or = { subCriterionId: "5.5", rows: [], runAt: new Date(T0 + 188_600 + 553_200 + 480_000).toISOString(), runId: "OR-1",
  durationMs: 480_000, aiCallLog: [c("outcomes/assess", 430_000)] } as OutcomeReviewPassResult;

describe("the results-and-review pass is now on the clock", () => {
  it("extends the wall clock to the end of the third pass", () => {
    const withOut = passSpans(ppd, ev, or).wallMs!;
    const without = passSpans(ppd, ev).wallMs!;
    expect(withOut - without).toBe(480_000);
  });

  it("places it by subtracting its own duration, like the other two", () => {
    const s = passSpans(ppd, ev, or);
    expect(s.oStart).toBe(s.eEnd);
  });

  it("gets its own row rather than being folded into model time", () => {
    const s = buildRunStages({ ppd, evidence: ev, outcome: or });
    const row = s.rows.find((r) => r.key === "outcomes")!;
    expect(row.ms).toBe(430_000);
    expect(s.rows.find((r) => r.key === "model")!.ms).toBe(52_800 + 399_700);
  });

  it("still sums to the wall clock with three passes in play", () => {
    const s = buildRunStages({ ppd, evidence: ev, outcome: or });
    expect(s.rows.reduce((n, r) => n + r.ms, 0)).toBe(s.wallMs);
  });

  it("shrinks Unaccounted by exactly what the third pass explains", () => {
    const blind = buildRunStages({ ppd, evidence: ev, outcome: { ...or, aiCallLog: undefined } });
    const seeing = buildRunStages({ ppd, evidence: ev, outcome: or });
    expect(blind.rows.find((r) => r.key === "unaccounted")!.ms
         - seeing.rows.find((r) => r.key === "unaccounted")!.ms).toBe(430_000);
  });
});

describe("the third pass and the skip are wired in the source", () => {
  const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
  const RUNTIME = readFileSync("src/lib/ai/agentRuntime.ts", "utf8");

  it("collects a record for every staged call", () => {
    expect(RUNTIME).toMatch(/const recordStaged = \(/);
    expect(RUNTIME).toMatch(/sLog\("failed", "", msg\);/);
    // ok / empty / failed, decided after the parse, as in Option A.
    expect(RUNTIME).toMatch(/results\.length > 0 \? "ok" : "empty"/);
  });

  it("stores the pass's calls and its own clock on the result", () => {
    expect(STORE).toMatch(/const OR_CALLS: AiCallRecord\[\] = \[\];/);
    expect(STORE).toMatch(/passName: "outcomes\/assess"/);
    expect(STORE).toMatch(/durationMs: Date\.now\(\) - orStartedAtMs/);
  });

  it("does not re-read a file the records pass already gave up on", () => {
    // This pass has vision disabled, so a scanned PDF cannot read better on a
    // second attempt: the re-download only buys the same answer.
    expect(STORE).toMatch(/const alreadyUnreadable = rec\.readStatus === "skipped" \|\| rec\.readStatus === "failed";/);
    expect(STORE).toMatch(/&& rec\.driveFileId && !alreadyUnreadable\)/);
  });

  it("still reports such a file by name rather than dropping it", () => {
    const passStart = STORE.indexOf("runOutcomeReviewPass: async");
    const pass = STORE.slice(passStart, STORE.indexOf("applyOutcomeReviewToChecklist", passStart));
    expect(pass).toMatch(/missing\.push\(rec\.name\)/);
  });
});
