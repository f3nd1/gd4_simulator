import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AISettings } from "../../../types";

vi.mock("../aiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiClient")>();
  return { ...actual, chatComplete: vi.fn() };
});

import { chatComplete } from "../aiClient";
import { extractBenchmarkFindings } from "../benchmarkExtraction";
import { GD4_SUB_CRITERIA } from "../../../data/gd4Requirements";

const mockChat = vi.mocked(chatComplete);
const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "m", utilityModel: "m", enabled: true };

beforeEach(() => { mockChat.mockReset(); });

function respond(json: unknown) {
  mockChat.mockResolvedValue(JSON.stringify(json));
}

describe("extractBenchmarkFindings — parsing", () => {
  it("parses a well-formed JSON response into drafts", async () => {
    const validSc = GD4_SUB_CRITERIA[0].id;
    respond({
      findings: [
        { subCriterion: validSc, gd4Ref: null, kind: "AFI", findingText: "It was not evident that X.", findingPattern: "other", hasNamedExample: false, confidence: "high" },
      ],
    });
    const drafts = await extractBenchmarkFindings("some document text", SETTINGS);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subCriterion).toBe(validSc);
    expect(drafts[0].findingText).toBe("It was not evident that X.");
    expect(drafts[0].confidence).toBe("high");
  });

  it("strips ```json code fences before parsing", async () => {
    const validSc = GD4_SUB_CRITERIA[0].id;
    mockChat.mockResolvedValue("```json\n" + JSON.stringify({ findings: [{ subCriterion: validSc, kind: "AFI", findingText: "Fenced finding.", findingPattern: "other", hasNamedExample: false }] }) + "\n```");
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].findingText).toBe("Fenced finding.");
  });

  it("an unparsable response yields an empty array, not a crash", async () => {
    mockChat.mockResolvedValue("not json at all");
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts).toEqual([]);
  });
});

describe("extractBenchmarkFindings — validation", () => {
  it("an invalid subCriterion id is dropped to blank, never silently accepted", async () => {
    respond({ findings: [{ subCriterion: "99.99", kind: "AFI", findingText: "Invented sub-criterion.", findingPattern: "other", hasNamedExample: false }] });
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subCriterion).toBe("");
  });

  it("a finding with no findingText is dropped entirely", async () => {
    const validSc = GD4_SUB_CRITERIA[0].id;
    respond({ findings: [{ subCriterion: validSc, kind: "AFI", findingText: "", findingPattern: "other", hasNamedExample: false }] });
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts).toEqual([]);
  });

  it("an invalid findingPattern falls back to 'other'", async () => {
    const validSc = GD4_SUB_CRITERIA[0].id;
    respond({ findings: [{ subCriterion: validSc, kind: "AFI", findingText: "Text.", findingPattern: "made-up-pattern", hasNamedExample: false }] });
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts[0].findingPattern).toBe("other");
  });

  it("an invalid kind falls back to 'AFI'", async () => {
    const validSc = GD4_SUB_CRITERIA[0].id;
    respond({ findings: [{ subCriterion: validSc, kind: "not-a-kind", findingText: "Text.", findingPattern: "other", hasNamedExample: false }] });
    const drafts = await extractBenchmarkFindings("doc", SETTINGS);
    expect(drafts[0].kind).toBe("AFI");
  });
});

describe("extractBenchmarkFindings — document capping", () => {
  it("truncates and notes documents over the char cap in the outgoing prompt", async () => {
    respond({ findings: [] });
    const longText = "x".repeat(70_000);
    await extractBenchmarkFindings(longText, SETTINGS);
    const userMessage = mockChat.mock.calls[0][0].find((m) => m.role === "user");
    expect(userMessage?.content).toContain("exceeds the 60,000-char limit");
    expect(userMessage?.content.length).toBeLessThan(70_000);
  });

  it("a document under the cap is sent whole, with no truncation note", async () => {
    respond({ findings: [] });
    await extractBenchmarkFindings("short document", SETTINGS);
    const userMessage = mockChat.mock.calls[0][0].find((m) => m.role === "user");
    expect(userMessage?.content).not.toContain("exceeds the");
  });
});
