// refLabel/refWithLabel pair a bare GD4 ref code with its official plain-English
// text at every display site. The label text must be the verbatim GD4 source
// (flatAuditPoints / item / sub-criterion), and an unrecognised ref must fall
// back to the bare code, never "undefined".
import { describe, it, expect } from "vitest";
import { refLabel, refWithLabel, GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "../gd4Requirements";

describe("refLabel", () => {
  it("returns a flatAuditPoint's verbatim text for its ref", () => {
    const req = GD4_REQUIREMENTS.find((r) => (r.flatAuditPoints?.length ?? 0) > 0)!;
    const point = req.flatAuditPoints![0];
    expect(refLabel(point.ref)).toBe(point.text);
  });

  it("returns the item title for an item id and the sub-criterion title for a sub-criterion id", () => {
    const req = GD4_REQUIREMENTS[0];
    expect(refLabel(req.id)).toBe(req.requirement);
    const sc = GD4_SUB_CRITERIA[0];
    expect(refLabel(sc.id)).toBe(sc.title);
  });

  it("matches a drifted ref (lower case / label prefix) via the normalised fallback", () => {
    const point = GD4_REQUIREMENTS.find((r) => (r.flatAuditPoints?.length ?? 0) > 0)!.flatAuditPoints![0];
    expect(refLabel(point.ref.toLowerCase())).toBe(point.text);
    expect(refLabel(`Ref: ${point.ref}`)).toBe(point.text);
  });

  it("returns undefined for an unknown ref", () => {
    expect(refLabel("99.9.9.ZZ1")).toBeUndefined();
  });
});

describe("refWithLabel", () => {
  it("formats 'code - label' for a known ref", () => {
    const point = GD4_REQUIREMENTS.find((r) => (r.flatAuditPoints?.length ?? 0) > 0)!.flatAuditPoints![0];
    expect(refWithLabel(point.ref)).toBe(`${point.ref} - ${point.text}`);
  });

  it("falls back to the bare code (no 'undefined') for an unknown ref", () => {
    expect(refWithLabel("99.9.9.ZZ1")).toBe("99.9.9.ZZ1");
  });
});
