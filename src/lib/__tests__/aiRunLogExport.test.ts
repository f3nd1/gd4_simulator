import { describe, it, expect } from "vitest";
import { buildAiRunLog, summariseAiRunLog } from "../aiRunLogExport";
import type { AiCallRecord, PPDReviewResult, EvidenceAssessmentResult } from "../../types";

const call = (seq: number, pass: string, over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  seq, pass, label: `window 1 of 1`, startedAt: 1_700_000_000_000 + seq * 1000, durationMs: 4_000,
  outcome: "ok", promptChars: 104_000, responseChars: 2_100, ...over,
});

const ppd = { subCriterionId: "6.1", rows: [], runAt: "2026-09-27T01:00:00Z", live: true, durationMs: 96_000, aiCallLog: [call(1, "procedure/extract")], fileLedger: [{ path: "p/a.pdf", name: "a.pdf", mimeType: "x", fileKind: "PDF", bucket: "policy" as const, readStatus: "read" as const, auditStatus: "audited" as const, charCount: 9_000 }] } as unknown as PPDReviewResult;
const ev = { subCriterionId: "6.1", rows: [], runAt: "2026-09-27T01:02:00Z", live: true, durationMs: 136_000, aiCallLog: [call(1, "records/extract"), call(2, "records/judge", { outcome: "failed", error: "timed out", responseChars: 0 })] } as unknown as EvidenceAssessmentResult;

describe("the downloadable AI run log", () => {
  it("carries both passes, in order, with their calls and files", () => {
    const log = buildAiRunLog({ area: "6.1 Internal Assessment", ppd, evidence: ev });
    expect(log.passes.map((p) => p.pass)).toEqual(["procedure", "records"]);
    expect(log.passes[0].calls).toHaveLength(1);
    expect(log.passes[0].files[0].name).toBe("a.pdf");
    expect(log.passes[1].calls[1].error).toBe("timed out");
  });

  // The point of the two tiers. Without arming, the file must contain no
  // prompt and no response anywhere in it.
  it("contains NO document text by default, and says so in the file", () => {
    const log = buildAiRunLog({ area: "6.1", ppd, evidence: ev });
    expect(log.fullPromptsIncluded).toBe(false);
    expect(log.fullText).toBeUndefined();
    expect(log.privacyNote).toMatch(/contains NO document text/);
    const json = JSON.stringify(log);
    expect(json).not.toContain("prompt\":\"");
    expect(json).not.toContain("response\":\"");
  });

  it("includes the text only when it was captured, and warns in the file itself", () => {
    const log = buildAiRunLog({ area: "6.1", ppd, evidence: ev, fullText: [{ seq: 1, pass: "records/extract", prompt: "SYSTEM…", response: "{}" }] });
    expect(log.fullPromptsIncluded).toBe(true);
    expect(log.fullText).toHaveLength(1);
    expect(log.privacyNote).toMatch(/CONTAINS THE FULL PROMPTS/);
    expect(log.privacyNote).toMatch(/personal data/);
  });

  it("treats an empty capture as no capture, rather than claiming one", () => {
    const log = buildAiRunLog({ area: "6.1", ppd, evidence: ev, fullText: [] });
    expect(log.fullPromptsIncluded).toBe(false);
    expect(log.fullText).toBeUndefined();
  });

  it("holds only sizes for the prompts, never the prompts", () => {
    const log = buildAiRunLog({ area: "6.1", ppd, evidence: ev });
    expect(log.passes[0].calls[0].promptChars).toBe(104_000);
    expect(Object.keys(log.passes[0].calls[0])).not.toContain("prompt");
  });

  it("survives a run with no passes at all", () => {
    const log = buildAiRunLog({ area: "6.1" });
    expect(log.passes).toEqual([]);
    expect(summariseAiRunLog(log)).toMatch(/No AI calls were recorded/);
  });
});

describe("summariseAiRunLog", () => {
  it("counts the calls, the time in them and what did not succeed", () => {
    const s = summariseAiRunLog(buildAiRunLog({ area: "6.1", ppd, evidence: ev }));
    expect(s).toContain("3 AI calls across 2 passes");
    expect(s).toContain("12s in calls");
    expect(s).toContain("1 not OK");
  });
});

// The breakdown was on the page and absent from the export, so three runs of
// one area could not be compared and the figures could not be checked.
describe("the export carries the timings and the counts, not only the calls", () => {
  const T0 = 1_700_000_000_000;
  const call = (pass: string, ms: number, outcome: AiCallRecord["outcome"] = "ok", seq = 1): AiCallRecord =>
    ({ seq, pass, label: "", startedAt: T0, durationMs: ms, outcome, promptChars: 10, responseChars: 5 });
  const ppdR = { subCriterionId: "5.5", rows: [], live: true, runAt: new Date(T0 + 100_000).toISOString(),
    durationMs: 100_000, stageTimings: { listingMs: 2_000, readMs: 40_000 },
    aiCallLog: [call("procedure/extract", 30_000), call("procedure/ocr", 8_000, "ok", 2), call("procedure/judge", 5_000, "failed", 3)] } as never;
  const evR = { subCriterionId: "5.5", rows: [], live: true, runAt: new Date(T0 + 300_000).toISOString(),
    durationMs: 150_000, stageTimings: { listingMs: 1_000, readMs: 20_000 }, aiCallLog: [call("records/judge", 60_000)] } as never;

  it("reports per-pass call counts by stage and by outcome", () => {
    const log = buildAiRunLog({ area: "5.5", ppd: ppdR, evidence: evR });
    const proc = log.passes.find((p) => p.pass === "procedure")!;
    expect(proc.callCounts.total).toBe(3);
    expect(proc.callCounts.byStage["procedure/ocr"]).toBe(1);
    expect(proc.callCounts.byOutcome.failed).toBe(1);
    expect(proc.callCounts.msInCalls).toBe(43_000);
  });

  it("carries each pass's own two clocks", () => {
    const log = buildAiRunLog({ area: "5.5", ppd: ppdR, evidence: evR });
    expect(log.passes.find((p) => p.pass === "procedure")!.stageTimings).toEqual({ listingMs: 2_000, readMs: 40_000 });
  });

  it("carries the same breakdown the page shows, and its rows sum to the wall clock", () => {
    const log = buildAiRunLog({ area: "5.5", ppd: ppdR, evidence: evR });
    expect(log.timeBreakdown.rows.length).toBeGreaterThan(3);
    expect(log.timeBreakdown.rows.reduce((n, r) => n + r.ms, 0)).toBe(log.timeBreakdown.wallMs);
    expect(log.timeBreakdown.rows.some((r) => r.key === "unaccounted")).toBe(true);
  });

  it("includes the third pass when there is one", () => {
    const or = { subCriterionId: "5.5", rows: [], runId: "OR-1", runAt: new Date(T0 + 500_000).toISOString(),
      durationMs: 200_000, aiCallLog: [call("outcomes/assess", 90_000)] } as never;
    const log = buildAiRunLog({ area: "5.5", ppd: ppdR, evidence: evR, outcome: or });
    expect(log.passes.map((p) => p.pass)).toEqual(["procedure", "records", "outcomes"]);
    expect(log.timeBreakdown.rows.find((r) => r.key === "outcomes")!.ms).toBe(90_000);
  });

  it("still holds no document text once the timings are in it", () => {
    const log = buildAiRunLog({ area: "5.5", ppd: ppdR, evidence: evR });
    expect(JSON.stringify(log)).not.toMatch(/"prompt"\s*:/);
  });
});
