import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildRunStages } from "../runStages";
import type { AiCallRecord, EvidenceAssessmentResult, PPDReviewResult } from "../../types";

const RUNTIME = readFileSync("src/lib/ai/agentRuntime.ts", "utf8");
const CLIENT = readFileSync("src/lib/ai/aiClient.ts", "utf8");

// THE FIND. Extract batches run in parallel and addCandidate appends in
// COMPLETION order, so the judge's prompt differed between runs on network
// timing alone, with identical documents and identical passages. The prompt
// numbers the passages, and models are order sensitive.
describe("the judge sees the passages in a stable order", () => {
  it("orders the pool before building either judge prompt", () => {
    expect([...RUNTIME.matchAll(/stableCandidateOrder\(candByRef\.get\(r\.ref\) \?\? \[\], \w+DocText\)/g)]).toHaveLength(2);
  });

  it("never reads the raw pool straight into a prompt again", () => {
    const judgeBlocks = [...RUNTIME.matchAll(/const cands = [^\n]+/g)].map((m) => m[0]);
    expect(judgeBlocks.length).toBeGreaterThan(0);
    for (const b of judgeBlocks) expect(b, b).toContain("stableCandidateOrder");
  });

  it("orders by chunk, then position, then the quote, so the comparison is total", () => {
    const fn = RUNTIME.slice(RUNTIME.indexOf("function stableCandidateOrder"), RUNTIME.indexOf("function chunkIdsInWindow"));
    expect(fn).toMatch(/chunkId \?\? ""\)\.localeCompare/);
    expect(fn).toMatch(/at\.get\(a\)! - at\.get\(b\)!/);
    expect(fn).toMatch(/quote\.localeCompare/);
  });
});

describe("the seed is sent, and nothing promises it works", () => {
  it("sends one fixed seed on every call", () => {
    expect(CLIENT).toMatch(/body\.seed = REQUEST_SEED;/);
    expect(CLIENT).toMatch(/const REQUEST_SEED = \d+;/);
  });

  it("drops the seed rather than failing when a model refuses it", () => {
    expect(CLIENT).toMatch(/\/seed\/i\.test\(got\.text\)/);
    expect(CLIENT).toMatch(/noSeed = true;/);
  });

  // THE CONDITION, enforced rather than remembered. A promise of stability
  // this cannot keep is worse than the variance it is trying to reduce.
  it("makes no reproducibility claim in any user-facing copy", () => {
    const files = [
      "src/lib/tuningAdvisor.ts", "src/lib/selfCheckBanding.ts", "src/lib/selfCheck.ts",
      "src/lib/runStages.ts", "src/lib/aiRunLogExport.ts", "src/lib/runTranscript.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Only what is shown: strings, not comments explaining the rule.
      const copy = [...src.matchAll(/"([^"\\]{20,})"|`([^`\\]{20,})`/g)].map((m) => m[1] ?? m[2]).join(" | ");
      expect(copy, `${f} must not promise a repeatable result`).not.toMatch(/is reproducible|will be the same|same result every|guaranteed to match/i);
    }
  });
});

describe("a read is split at the seam that matters", () => {
  const base = (over: Partial<PPDReviewResult>) => ({
    subCriterionId: "5.5", rows: [], live: true, runAt: new Date(1_700_000_100_000).toISOString(),
    durationMs: 100_000, aiCallLog: [] as AiCallRecord[], ...over,
  } as PPDReviewResult);

  it("reports waiting for Drive apart from parsing", () => {
    const s = buildRunStages({ ppd: base({ stageTimings: { listingMs: 0, readMs: 60_000, driveMs: 20_000, pagesRead: 58 } }) });
    expect(s.rows.find((r) => r.key === "download")!.ms).toBe(20_000);
    expect(s.rows.find((r) => r.key === "reading")!.ms).toBe(40_000);
  });

  it("names the page count, so a slow read divides by something real", () => {
    const s = buildRunStages({ ppd: base({ stageTimings: { listingMs: 0, readMs: 60_000, driveMs: 20_000, pagesRead: 58 } }) });
    expect(s.rows.find((r) => r.key === "reading")!.detail).toContain("58 PDF pages");
  });

  it("puts a run from before the split entirely in parsing, inventing nothing", () => {
    const s = buildRunStages({ ppd: base({ stageTimings: { listingMs: 0, readMs: 60_000 } }) });
    expect(s.rows.find((r) => r.key === "download")!.ms).toBe(0);
    expect(s.rows.find((r) => r.key === "reading")!.ms).toBe(60_000);
    expect(s.rows.find((r) => r.key === "reading")!.detail).not.toContain("PDF pages");
  });

  it("still sums to the wall clock with the row split in two", () => {
    const ev = { subCriterionId: "5.5", rows: [], live: true, runAt: new Date(1_700_000_400_000).toISOString(),
      durationMs: 200_000, stageTimings: { listingMs: 1_000, readMs: 90_000, driveMs: 30_000, pagesRead: 12 }, aiCallLog: [] } as unknown as EvidenceAssessmentResult;
    const s = buildRunStages({ ppd: base({ stageTimings: { listingMs: 0, readMs: 60_000, driveMs: 20_000, pagesRead: 58 } }), evidence: ev });
    expect(s.rows.reduce((n, r) => n + r.ms, 0)).toBe(s.wallMs);
  });
});
