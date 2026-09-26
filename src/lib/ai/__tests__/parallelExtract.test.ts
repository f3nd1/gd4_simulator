import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";
import type { EvidenceAssessmentInput } from "../agentRuntime";

// A window's extract batches now run together instead of one after another.
// Three things must stay true, and they are the reason this file exists:
//   1. They really do overlap (otherwise the change bought nothing).
//   2. One batch failing does NOT cancel its siblings, and its own lines are
//      still reported as failed rather than silently dropped.
//   3. What the judge receives is unchanged: a ref's candidates come only from
//      its own batch, so parallelism cannot reorder or lose them.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runEvidenceAssessment, makeCallSkip, raceSkip, CALL_SKIPPED } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

// One chunk per line so every quote verifies against the source.
const QUOTES = Array.from({ length: 12 }, (_, i) => `Record ${i + 1} was completed and signed on 4 February 2026.`);
const DOC = QUOTES.map((q, i) => `[CHUNK:C${String(i + 1).padStart(3, "0")}] --- log.pdf ---\n${q}`).join("\n\n");

const lines: EvidenceAssessmentInput[] = QUOTES.map((_, i) => ({
  ref: `6.2.1.DS${i + 1}`,
  requirementText: `Requirement line ${i + 1}`,
  ppdExtract: "the register is maintained",
  ppdVerdict: "Adequate",
}));

const extractReply = (refs: string[]) => JSON.stringify({
  results: refs.map((ref) => {
    const i = Number(ref.replace("6.2.1.DS", "")) - 1;
    return { ref, candidates: [{ aspect: "record", quote: QUOTES[i], kind: "record", chunkId: `C${String(i + 1).padStart(3, "0")}` }] };
  }),
});

const judgeReply = (refs: string[]) => JSON.stringify({
  results: refs.map((ref) => ({
    ref, evidenceSummary: "Records found.", verdict: "Met", comment: "Evidenced.",
    promiseChecks: [], chunkIds: ["C001"], evidenceQuote: "", suggestedAction: "", redFlags: [],
  })),
});

const refsIn = (user: string) => lines.map((l) => l.ref).filter((r) => user.includes(`[${r}]`));

beforeEach(() => { mockChat.mockReset(); });

describe("extract batches within a window", () => {
  it("overlap instead of running one after another", async () => {
    let inFlight = 0, peak = 0;
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      const user = String(messages[1]?.content ?? "");
      if (!system.includes("EXTRACTION pass")) return judgeReply(refsIn(user));
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return extractReply(refsIn(user));
    });
    await runEvidenceAssessment(lines, DOC, SETTINGS);
    // 12 lines at REQ_BATCH_SIZE 8 = two batches; sequential would peak at 1.
    expect(peak).toBe(2);
  });

  it("keeps a sibling batch's results when one batch fails, and reports the failure", async () => {
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      const user = String(messages[1]?.content ?? "");
      if (!system.includes("EXTRACTION pass")) return judgeReply(refsIn(user));
      // The batch carrying line 9 onward blows up; lines 1-8 must survive.
      if (user.includes("[6.2.1.DS9]")) throw new Error("batch exploded");
      return extractReply(refsIn(user));
    });
    const out = await runEvidenceAssessment(lines, DOC, SETTINGS);
    const byRef = new Map(out.rows.map((r) => [r.ref, r]));
    expect(byRef.get("6.2.1.DS1")?.verdict).toBe("Met");
    expect(byRef.get("6.2.1.DS8")?.verdict).toBe("Met");
    // The failed batch's lines are honestly unassessed, never a fabricated gap.
    expect(byRef.get("6.2.1.DS9")?.verdict).toBe("Not assessed");
    expect(out.windowErrors?.join(" ")).toContain("batch exploded");
  });

  it("gives the judge each ref's own candidates, unreordered", async () => {
    const judgeUsers: string[] = [];
    mockChat.mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      const user = String(messages[1]?.content ?? "");
      if (system.includes("EXTRACTION pass")) return extractReply(refsIn(user));
      judgeUsers.push(user);
      return judgeReply(refsIn(user));
    });
    await runEvidenceAssessment(lines, DOC, SETTINGS);
    // Every line's quote reaches the judge, under its own ref. The judge is
    // batched too, so check across all its calls.
    const all = judgeUsers.join("\n");
    for (let i = 0; i < QUOTES.length; i++) {
      expect(all, `line ${i + 1}`).toContain(QUOTES[i]);
      // Exactly once: parallelism must not duplicate a candidate.
      expect(all.split(QUOTES[i]).length - 1, `line ${i + 1} occurrences`).toBe(1);
    }
  });
});

describe("makeCallSkip", () => {
  it("one Skip abandons every call in the group", async () => {
    let registered: (() => void) | null = null;
    const group = makeCallSkip((fn) => { registered = fn as (() => void) | null; });
    const never = new Promise<string>(() => {});
    const a = raceSkip(group.skip, never), b = raceSkip(group.skip, never);
    (registered as unknown as () => void)();
    expect(await a).toBe(CALL_SKIPPED);
    expect(await b).toBe(CALL_SKIPPED);
    group.release();
    expect(registered).toBeNull();
  });

  it("passes calls straight through when no skip is registered", async () => {
    const group = makeCallSkip(undefined);
    expect(await raceSkip(group.skip, Promise.resolve("done"))).toBe("done");
  });
});
