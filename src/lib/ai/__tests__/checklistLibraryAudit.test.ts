import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

// The Audit Checklist Library pass runs on BOTH audit paths through this one
// function, so these gates are the gates for Option A and Option B alike.
//
// The gate that matters most: a positive verdict whose quote cannot be verified
// in the documents is an EXTRACTION DEFECT, and must land on "Not assessed" —
// never "Not met". "Not met" is a claim that the material was looked at and the
// thing was missing; degrading a failed extraction into that claim would
// manufacture gaps out of model error, which is the one outcome this feature
// must not produce.
vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { runChecklistLibraryAudit, type ChecklistAuditInput } from "../agentRuntime";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

const DOC = `[CHUNK:C001] --- QA Manual.pdf ---\nThe internal audit schedule covers all seven criteria across the certification cycle.`;
const REAL_QUOTE = "The internal audit schedule covers all seven criteria across the certification cycle.";

const ITEM: ChecklistAuditInput = { ref: "6-abc123", text: "Internal audit must be planned and evidenced.", kind: "What to check" };

const reply = (r: Record<string, unknown>) => JSON.stringify({ results: [{ ref: ITEM.ref, ...r }] });

// Block body, not an implicit return: returning the mock from the hook makes
// vitest await it, which surfaces the deliberately-rejecting implementation as
// an unhandled error and fails the test that is exercising it.
beforeEach(() => { mockChat.mockReset(); });

describe("runChecklistLibraryAudit — the citation gate", () => {
  it("keeps a Met whose quote really is in the documents", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Met", note: "The schedule is in the QA manual.", quote: REAL_QUOTE, chunkIds: ["C001"] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Met");
    expect(rows[0].quote).toBe(REAL_QUOTE);
    expect(rows[0].chunkIds).toEqual(["C001"]);
  });

  it("downgrades a Met with an INVENTED quote to Not assessed, never Not met", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Met", note: "Looks covered.", quote: "The board reviews the audit schedule every quarter without fail.", chunkIds: ["C001"] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not assessed");
    expect(rows[0].quote).toBeUndefined();
  });

  it("downgrades a Partial with NO quote to Not assessed", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Partial", note: "Partly there.", quote: "", chunkIds: ["C001"] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not assessed");
  });

  it("downgrades a Met whose quote is too short to prove anything (quoteExistsInSource auto-passes under 20 chars)", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Met", note: "n", quote: "audit", chunkIds: ["C001"] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not assessed");
  });
});

describe("runChecklistLibraryAudit — negative and non-applicable verdicts pass through unquoted", () => {
  it("keeps Not met as returned (no quote required for a gap)", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Not met", note: "No audit schedule appears anywhere in the manual.", quote: "", chunkIds: [] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not met");
    expect(rows[0].rationale).toMatch(/No audit schedule/);
  });

  it("keeps Not applicable — the honest answer for band-level guidance checks", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Not applicable", note: "This is band-level guidance, not a testable requirement.", quote: "", chunkIds: [] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not applicable");
  });

  it("treats an unrecognised verdict string as Not assessed rather than guessing", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Probably fine", note: "n", quote: "", chunkIds: [] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    expect(rows[0].verdict).toBe("Not assessed");
  });
});

describe("runChecklistLibraryAudit — failures never become gaps", () => {
  it("an AI call that fails in every window leaves the check Not assessed, not Not met", async () => {
    mockChat.mockImplementation(async () => { throw new Error("boom"); });
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "evidence", SETTINGS);
    expect(rows[0].verdict).toBe("Not assessed");
    expect(rows[0].rationale).toMatch(/Not assessed/);
  });

  it("no documents at all means Not assessed with a stated reason, and no AI call", async () => {
    const { rows } = await runChecklistLibraryAudit([ITEM], "   ", "evidence", SETTINGS);
    expect(mockChat).not.toHaveBeenCalled();
    expect(rows[0].verdict).toBe("Not assessed");
    expect(rows[0].rationale).toMatch(/No evidence documents/);
  });

  it("a stopped run does not fabricate a verdict", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Met", note: "n", quote: REAL_QUOTE, chunkIds: ["C001"] }));
    const { rows } = await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS, { shouldStop: () => true });
    expect(mockChat).not.toHaveBeenCalled();
    expect(rows[0].verdict).toBe("Not assessed");
  });
});

describe("runChecklistLibraryAudit — the checks are identified, and both buckets are asked different questions", () => {
  it("sends each check with its own id so the verdict can be attributed back", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Not met", note: "n", quote: "", chunkIds: [] }));
    await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    const user = mockChat.mock.calls[0][0][1].content;
    expect(user).toContain(`[${ITEM.ref}]`);
    expect(user).toContain(ITEM.text);
    expect(user).toContain("[What to check]");
  });

  it("names the bucket in the system prompt, so policy and evidence are not the same question", async () => {
    mockChat.mockResolvedValue(reply({ verdict: "Not met", note: "n", quote: "", chunkIds: [] }));
    await runChecklistLibraryAudit([ITEM], DOC, "policy", SETTINGS);
    const policySystem = mockChat.mock.calls[0][0][0].content;
    mockChat.mockReset();
    mockChat.mockResolvedValue(reply({ verdict: "Not met", note: "n", quote: "", chunkIds: [] }));
    await runChecklistLibraryAudit([ITEM], DOC, "evidence", SETTINGS);
    const evidenceSystem = mockChat.mock.calls[0][0][0].content;
    expect(policySystem).toContain("POLICY & PROCEDURE documents");
    expect(evidenceSystem).toContain("ACTUAL EVIDENCE documents");
    expect(policySystem).not.toBe(evidenceSystem);
  });
});
