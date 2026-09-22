import { describe, it, expect } from "vitest";
import { parseRedFlags } from "../agentRuntime";

const DOC = `C001 Internal Audit Report 2026
The audit was prepared by R. Tan and approved by R. Tan on 14 March 2026.
Attendance for the January intake was 100% across all twelve sessions.
Corrective actions were tracked in the action register.`;

describe("parseRedFlags", () => {
  it("keeps a flag whose quote is verbatim in the evidence", () => {
    const out = parseRedFlags([{
      kind: "role-conflict",
      observation: "The same name appears as preparer and approver; an approval by a different officer would resolve it.",
      quote: "prepared by R. Tan and approved by R. Tan",
      chunkId: "C001",
    }], DOC);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("role-conflict");
    expect(out[0].chunkId).toBe("C001");
  });

  it("drops a flag whose quote is not in the evidence — an invented concern is worse than none", () => {
    expect(parseRedFlags([{
      kind: "role-conflict",
      observation: "The approver signed for the preparer.",
      quote: "approved by someone who never read it",
    }], DOC)).toEqual([]);
  });

  it("drops a flag with no quote at all", () => {
    expect(parseRedFlags([{ kind: "too-perfect", observation: "Everything is 100%.", quote: "" }], DOC)).toEqual([]);
  });

  it("drops a kind outside the fixed list", () => {
    expect(parseRedFlags([{
      kind: "made-up-kind",
      observation: "Something felt wrong.",
      quote: "Attendance for the January intake was 100%",
    }], DOC)).toEqual([]);
  });

  it("drops a flag with no observation", () => {
    expect(parseRedFlags([{
      kind: "too-perfect", observation: "   ",
      quote: "Attendance for the January intake was 100%",
    }], DOC)).toEqual([]);
  });

  it("returns [] for a missing or non-array field, never throws", () => {
    expect(parseRedFlags(undefined, DOC)).toEqual([]);
    expect(parseRedFlags(null, DOC)).toEqual([]);
    expect(parseRedFlags("nope", DOC)).toEqual([]);
    expect(parseRedFlags([null, 7, "x"], DOC)).toEqual([]);
  });

  it("keeps the good flags in a mixed batch and drops the rest", () => {
    const out = parseRedFlags([
      { kind: "too-perfect", observation: "Every session at 100%; the attendance register would resolve it.", quote: "Attendance for the January intake was 100% across all twelve sessions" },
      { kind: "documents-disagree", observation: "Invented.", quote: "the two registers state different totals" },
    ], DOC);
    expect(out.map((f) => f.kind)).toEqual(["too-perfect"]);
  });
});
