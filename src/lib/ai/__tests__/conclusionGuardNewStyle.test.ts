// The self-consistency guard must still catch a contradictory narrative written
// in the NEW concise style.
//
// The old detector keyed on "assessed as X" / "rated X". The new wording rules
// end a narrative "Therefore, the requirement is not met.", which matched
// neither that pattern nor the loose fallback ("is not met" is not "does not
// meet"). Adopting the style without widening the lead-in would have blinded the
// guard on exactly the sentence the rules mandate.
import { describe, it, expect, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { verdictNarrativeMismatch } = await import("../agentRuntime");

describe("the guard catches contradictions written in the new concise style", () => {
  it("flags a stored Met whose narrative concludes the requirement is not met", () => {
    const narrative =
      "The PPD does not define the competence and independence requirements for internal assessors. " +
      "The records also do not show assessor qualifications or training. Therefore, the requirement is not met.";
    expect(verdictNarrativeMismatch("Met", narrative)).toBeTruthy();
  });

  it("flags a stored Not met whose narrative concludes it is met", () => {
    const narrative =
      "The PPD defines the review cycle and the records show each review taking place. " +
      "Therefore, the requirement is met.";
    expect(verdictNarrativeMismatch("Not met", narrative)).toBeTruthy();
  });

  it("tells Partial apart from Not met in the new style", () => {
    const partialTail = "Therefore, implementation is only partially evidenced. The requirement is partially met.";
    expect(verdictNarrativeMismatch("Not met", partialTail)).toBeTruthy();
    expect(verdictNarrativeMismatch("Partial", partialTail)).toBeUndefined();
  });

  it("stays silent on a coherent new-style narrative", () => {
    const coherent =
      "The PPD requires CAPs for all AFIs, and Quality Actions are used to address findings. " +
      "However, the evidence does not show that every AFI has a corresponding CAP. " +
      "Therefore, implementation is only partially evidenced.";
    expect(verdictNarrativeMismatch("Partial", coherent)).toBeUndefined();
  });

  // The phrasings it already caught must keep matching.
  it("still catches the old explicit phrasings", () => {
    expect(verdictNarrativeMismatch("Partial", "... this requirement is assessed as Met.")).toBeTruthy();
    expect(verdictNarrativeMismatch("Not met", "... the line was rated Partial.")).toBeTruthy();
    expect(verdictNarrativeMismatch("Met", "... the PEI does not meet this requirement.")).toBeTruthy();
  });

  it("never flags a Not assessed row, which asserts nothing", () => {
    expect(verdictNarrativeMismatch("Not assessed", "Therefore, the requirement is not met.")).toBeUndefined();
  });
});
