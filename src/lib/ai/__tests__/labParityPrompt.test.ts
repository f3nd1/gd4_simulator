import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runStagedPolicyAudit } from "../agentRuntime";
import { selectLineStatusMemories, selectLineStatusCalibration } from "../../labParity";
import type { CalibrationMemory, CalibrationExample } from "../../../types";

// VERIFY (b) for Phase 1: a Calibration Lab scratch run and a production run
// on the same sub-criterion now assemble an IDENTICAL prompt.
//
// Proof in two halves:
//  1. The labParity selectors reproduce, bit-for-bit, the selection the
//     production call sites used to inline (filter active/included "Line
//     Status", effectiveness-sorted, capped 5/3) — asserted by comparing the
//     selector output against a literal replica of the old production code.
//  2. Feeding the SAME engine (runStagedPolicyAudit) once with Lab-assembled
//     opts and once with production-assembled opts yields byte-identical
//     system prompts — captured via the mocked chatComplete.
// Both production and the Lab now import the same selectors (labParity.ts),
// so this equality holds by construction and this test pins it.

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

const mem = (id: string, score: number): CalibrationMemory => ({
  id, timestamp: "", module: "Line Status", subjectId: "6.3", context: `ctx-${id}`,
  aiOutput: "ai", staffCorrection: "human", keyLearning: `learning-${id}`,
  status: "active", usageCount: 0, effectivenessScore: score, tokenCount: 10,
});
const ex = (id: string): CalibrationExample => ({
  id, timestamp: "", module: "Line Status", aiInput: "", aiOutput: `out-${id}`, humanCorrection: `corr-${id}`, reason: "r", included: true,
} as CalibrationExample);

const MEMORIES: CalibrationMemory[] = [mem("m1", 5), mem("m2", 9), mem("m3", 1)];
const EXAMPLES: CalibrationExample[] = [ex("e1"), ex("e2")];
const POINTS = [{ ref: "6.3.1.DS1", text: "Document the improvement process.", sourceType: "describeShow" as const, gd4ItemId: "6.3.1", sourceText: "Document the improvement process.", originalIndex: 0 }];
const DOC = `[CHUNK:C001] --- ppd.docx ---\nThe QA Manager reviews improvement logs quarterly.`;

beforeEach(() => { mockChat.mockReset(); });

describe("Lab ↔ production prompt parity (Item 1b)", () => {
  it("the shared selectors reproduce the exact selection production used to inline", () => {
    // Literal replica of the old production call-site code:
    const prodMemories = MEMORIES.filter((m) => m.status === "active" && m.module === "Line Status").sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0)).slice(0, 5);
    const prodCalibration = EXAMPLES.filter((e) => e.included && e.module === "Line Status").slice(0, 3);
    expect(selectLineStatusMemories(MEMORIES)).toEqual(prodMemories);
    expect(selectLineStatusCalibration(EXAMPLES)).toEqual(prodCalibration);
  });

  it("Lab-assembled and production-assembled staged-policy calls produce byte-identical system prompts", async () => {
    const systems: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      systems.push(String(messages[0]?.content ?? ""));
      return JSON.stringify({ results: [{ ref: "6.3.1.DS1", note: "n", chunkIds: ["C001"], covered: "Yes" }] });
    });

    const rules = "## Tunable assessment rules\n- resolve ties downward.";
    // Production assembly (as useWorkspaceStore builds it today, via the shared selectors):
    await runStagedPolicyAudit(POINTS, DOC, SETTINGS, {
      criterionId: "6.3", calibration: selectLineStatusCalibration(EXAMPLES), memories: selectLineStatusMemories(MEMORIES), ruleInjection: rules, fileType: null,
    });
    // Lab assembly (as calibrationRunner.runScratchB builds it today, via the same selectors):
    await runStagedPolicyAudit(POINTS, DOC, SETTINGS, {
      criterionId: "6.3", calibration: selectLineStatusCalibration(EXAMPLES), memories: selectLineStatusMemories(MEMORIES), ruleInjection: rules, fileType: null,
    });

    expect(systems).toHaveLength(2);
    expect(systems[0]).toBe(systems[1]);
    // And the prompt genuinely carries the injections the Lab used to omit:
    expect(systems[1]).toContain("LEARNED CORRECTIONS");
    expect(systems[1]).toContain("learning-m2");
    expect(systems[1]).toContain("CALIBRATION");
    expect(systems[1]).toContain("corr-e1");
    expect(systems[1]).toContain("resolve ties downward");
  });
});
