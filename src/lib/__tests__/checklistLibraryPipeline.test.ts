import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// End-to-end through the real library data: scope selection -> prompt -> parse
// -> citation gate -> store write, for BOTH audit paths. Only the HTTP call is
// stubbed. This is the test that would catch "Option B quietly writes somewhere
// else", which is the failure the one-store design exists to prevent.
vi.mock("../ai/aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../ai/aiClient";
import { runChecklistLibraryPass, checklistRowsForScope } from "../checklistLibraryRun";
import { useChecklistVerdictStore, verdictKey } from "../../store/useChecklistVerdictStore";
import type { AISettings } from "../../types";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };
const REAL_LINE = "Management review minutes dated 12 March 2026 record the annual review of the whole system.";
const DOC = `[CHUNK:C001] --- Management Review.pdf ---\n${REAL_LINE}`;

// Answers every check in the batch: the first Met (with a genuine quote), the
// rest spread across the honest non-positive verdicts.
function answerAll(refs: string[]) {
  return JSON.stringify({
    results: refs.map((ref, i) => i === 0
      ? { ref, verdict: "Met", note: "The minutes record the review.", quote: REAL_LINE, chunkIds: ["C001"] }
      : i === 1
        ? { ref, verdict: "Not applicable", note: "Band-level guidance, not a testable requirement.", quote: "", chunkIds: [] }
        : { ref, verdict: "Not assessed", note: "Nothing in these documents speaks to this check.", quote: "", chunkIds: [] }),
  });
}

beforeEach(() => {
  mockChat.mockReset();
  useChecklistVerdictStore.setState({ entries: {} });
});

describe("both audit paths write into the one verdict store", () => {
  it("Option A's policy bucket files a verdict for every in-scope check of 6.2", async () => {
    const scope = checklistRowsForScope("6.2");
    mockChat.mockImplementation(async (messages) => {
      const user = String((messages as { content: string }[])[1].content);
      return answerAll(scope.map((r) => r.id).filter((id) => user.includes(`[${id}]`)));
    });

    const res = await runChecklistLibraryPass({ subCriterionId: "6.2", docText: DOC, bucket: "policy", path: "A", settings: SETTINGS, runId: "PPD-6.2-TEST" });
    expect(res.stored).toBe(scope.length);
    expect(res.skippedReason).toBeUndefined();

    const entries = useChecklistVerdictStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(scope.length);
    const first = entries[verdictKey(scope[0].id, "6.2", "policy")];
    expect(first).toMatchObject({ verdict: "Met", path: "A", runId: "PPD-6.2-TEST", bucket: "policy" });
    expect(first.quote).toBe(REAL_LINE);
  });

  it("Option B's evidence bucket lands beside it, not on top of it", async () => {
    const scope = checklistRowsForScope("6.2");
    mockChat.mockImplementation(async (messages) => {
      const user = String((messages as { content: string }[])[1].content);
      return answerAll(scope.map((r) => r.id).filter((id) => user.includes(`[${id}]`)));
    });

    await runChecklistLibraryPass({ subCriterionId: "6.2", docText: DOC, bucket: "policy", path: "A", settings: SETTINGS });
    await runChecklistLibraryPass({ subCriterionId: "6.2", docText: DOC, bucket: "evidence", path: "B", settings: SETTINGS, runId: "FOLD-6.2" });

    const entries = useChecklistVerdictStore.getState().entries;
    expect(Object.keys(entries)).toHaveLength(scope.length * 2);
    expect(entries[verdictKey(scope[0].id, "6.2", "policy")].path).toBe("A");
    expect(entries[verdictKey(scope[0].id, "6.2", "evidence")].path).toBe("B");
  });

  it("the honest verdicts survive the round trip rather than collapsing to a gap", async () => {
    const scope = checklistRowsForScope("6.2");
    mockChat.mockImplementation(async (messages) => {
      const user = String((messages as { content: string }[])[1].content);
      return answerAll(scope.map((r) => r.id).filter((id) => user.includes(`[${id}]`)));
    });
    await runChecklistLibraryPass({ subCriterionId: "6.2", docText: DOC, bucket: "policy", path: "A", settings: SETTINGS });
    const verdicts = Object.values(useChecklistVerdictStore.getState().entries).map((v) => v.verdict);
    expect(verdicts).toContain("Met");
    expect(verdicts).toContain("Not applicable");
    expect(verdicts).toContain("Not assessed");
    expect(verdicts).not.toContain("Not met"); // nothing here claimed a gap
  });

  it("stores nothing, and says why, when the bucket read no documents", async () => {
    const res = await runChecklistLibraryPass({ subCriterionId: "6.2", docText: "", bucket: "evidence", path: "A", settings: SETTINGS });
    expect(mockChat).not.toHaveBeenCalled();
    expect(res).toMatchObject({ stored: 0 });
    expect(res.skippedReason).toMatch(/no documents/);
    expect(Object.keys(useChecklistVerdictStore.getState().entries)).toHaveLength(0);
  });
});

// Both writers must go through the shared pass. A path that grew its own copy
// could quietly relax the citation gate, which is exactly what parity forbids.
describe("both call sites are wired to the shared pass", () => {
  const store = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
  it("Option A calls it for the policy bucket and the evidence bucket", () => {
    expect(store).toContain('bucket: "policy", path: "A"');
    expect(store).toContain('bucket: "evidence", path: "A"');
  });
  it("Option B calls it for both buckets from the staged audit", () => {
    expect(store).toContain('path: "B"');
    expect(store).toContain('[["policy", policyDocText], ["evidence", evidenceDocText]]');
  });
  it("there is exactly one engine implementation behind them", () => {
    const engine = readFileSync("src/lib/ai/agentRuntime.ts", "utf8");
    expect(engine.match(/export async function runChecklistLibraryAudit/g)).toHaveLength(1);
  });
});
