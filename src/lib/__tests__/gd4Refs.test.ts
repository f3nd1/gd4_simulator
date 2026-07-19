import { describe, it, expect } from "vitest";
import { normalizeAuditRef, findingDedupeKey, findingKeyOf, migrateDs1Ref } from "../gd4Refs";
import { buildDraftFinding } from "../checklistBanding";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { SpecificChecklistLine } from "../../types";

describe("normalizeAuditRef", () => {
  it("strips label prefixes, whitespace and case", () => {
    expect(normalizeAuditRef("DS: 6.1.1.DS1.a")).toBe("6.1.1.DS1.A");
    expect(normalizeAuditRef("  ref# 1.2.1.ds2 ")).toBe("1.2.1.DS2");
    expect(normalizeAuditRef("1.1.1.DS1")).toBe("1.1.1.DS1");
  });

  it("matches the same ref written in the two pipelines' formats", () => {
    // Option A rows carry the clean FlatAuditPoint ref; checklist lines carry
    // an AI-echoed sourceRef that can drift — both must normalize identically.
    expect(normalizeAuditRef("1.1.1.DS1")).toBe(normalizeAuditRef("ds: 1.1.1.ds1"));
    expect(normalizeAuditRef("6.2.1.DS1.a")).toBe(normalizeAuditRef("6.2.1. DS1. a"));
  });
});

describe("migrateDs1Ref — 6.1.1.DS1.c split carry-over", () => {
  it("shifts ONLY the renumbered refs (old d/e/f -> new e/f/g)", () => {
    expect(migrateDs1Ref("6.1.1.DS1.d")).toBe("6.1.1.DS1.e"); // defining owners
    expect(migrateDs1Ref("6.1.1.DS1.e")).toBe("6.1.1.DS1.f"); // CAP Approval
    expect(migrateDs1Ref("6.1.1.DS1.f")).toBe("6.1.1.DS1.g"); // monitoring
  });

  it("leaves unchanged refs (a/b/c and the new d) exactly as they are", () => {
    for (const ref of ["6.1.1.DS1.a", "6.1.1.DS1.b", "6.1.1.DS1.c", "6.1.1.DS2", "6.1.1.EE1"]) {
      expect(migrateDs1Ref(ref)).toBe(ref);
    }
  });

  it("never touches any OTHER item's refs (the remap is scoped to 6.1.1.DS1)", () => {
    for (const ref of ["6.2.1.DS1.e", "1.1.1.DS1.f", "6.1.2.DS1.d", "6.1.1.EE2"]) {
      expect(migrateDs1Ref(ref)).toBe(ref);
    }
  });

  it("carries over prefixed / mixed-case stored variants too (normalised match)", () => {
    // Old CAP Approval line stored as "DS: 6.1.1.DS1.E" still lands on new f.
    expect(migrateDs1Ref("DS: 6.1.1.DS1.E")).toBe("6.1.1.DS1.f");
    expect(migrateDs1Ref("6.1.1. DS1. e")).toBe("6.1.1.DS1.f");
  });

  it("every shifted target resolves to a REAL current DS1 point (no orphans)", () => {
    const ds1Refs = new Set(
      GD4_REQUIREMENTS.find((r) => r.id === "6.1.1")!.flatAuditPoints!.map((p) => p.ref)
    );
    for (const target of ["6.1.1.DS1.e", "6.1.1.DS1.f", "6.1.1.DS1.g"]) {
      expect(ds1Refs.has(target)).toBe(true);
    }
    // The prior-task CAP Approval line lands on the point whose text is the
    // approval obligation, not "defining owners".
    const capApproval = GD4_REQUIREMENTS.find((r) => r.id === "6.1.1")!.flatAuditPoints!.find((p) => p.ref === migrateDs1Ref("6.1.1.DS1.e"));
    expect(capApproval!.text).toMatch(/Approving all CAPs/i);
  });
});

describe("6.1.1.DS1 split into distinct audit points (2026-07-19)", () => {
  it("DS1 now has seven lettered points a-g, each a distinct obligation", () => {
    const ds1 = GD4_REQUIREMENTS.find((r) => r.id === "6.1.1")!.flatAuditPoints!.filter((p) => /^6\.1\.1\.DS1\.[a-z]$/.test(p.ref));
    expect(ds1.map((p) => p.ref)).toEqual([
      "6.1.1.DS1.a", "6.1.1.DS1.b", "6.1.1.DS1.c", "6.1.1.DS1.d", "6.1.1.DS1.e", "6.1.1.DS1.f", "6.1.1.DS1.g",
    ]);
    const byRef = Object.fromEntries(ds1.map((p) => [p.ref, p.text]));
    expect(byRef["6.1.1.DS1.c"]).toMatch(/^Compiling all strengths and Areas for Improvement \(AFIs\)$/);
    expect(byRef["6.1.1.DS1.d"]).toMatch(/^Developing Corrective Action Plans \(CAPs\) for all AFIs$/);
    expect(byRef["6.1.1.DS1.f"]).toMatch(/^Approving all CAPs/);
  });
});

describe("findingDedupeKey", () => {
  it("builds a composite key of item + normalized ref + finding type", () => {
    expect(findingDedupeKey("1.1.1", "ds: 1.1.1.ds1", "NC")).toBe("1.1.1::1.1.1.DS1::NC");
  });

  it("the same requirement raised by both pipelines produces ONE key", () => {
    const fromChecklist = findingDedupeKey("1.1.1", "DS: 1.1.1.DS1", "NC"); // line.sourceRef
    const fromCompile = findingDedupeKey("1.1.1", "1.1.1.DS1", "NC"); // row.gdRef
    expect(fromChecklist).toBe(fromCompile);
  });

  it("different finding types on the same ref are distinct findings", () => {
    expect(findingDedupeKey("1.1.1", "1.1.1.DS1", "NC")).not.toBe(findingDedupeKey("1.1.1", "1.1.1.DS1", "OFI"));
  });

  it("returns null with no usable ref, so ref-less findings never collide on an empty key", () => {
    expect(findingDedupeKey("1.1.1", undefined, "NC")).toBeNull();
    expect(findingDedupeKey("1.1.1", "   ", "NC")).toBeNull();
  });
});

describe("findingKeyOf", () => {
  it("prefers linkedSourceRefs[0], falling back to clause", () => {
    expect(findingKeyOf({ gd4ItemId: "1.1.1", linkedSourceRefs: ["1.1.1.DS1"], clause: "other", findingType: "NC" })).toBe(
      "1.1.1::1.1.1.DS1::NC"
    );
    expect(findingKeyOf({ gd4ItemId: "1.1.1", clause: "1.1.1.DS1", findingType: "NC" })).toBe("1.1.1::1.1.1.DS1::NC");
    expect(findingKeyOf({ gd4ItemId: "1.1.1", findingType: "NC" })).toBeNull();
  });

  it("a finding created from a checklist line matches the key of the Option A row for the same gap", () => {
    const findingFromLine = { gd4ItemId: "1.1.1", linkedSourceRefs: ["ds: 1.1.1.ds1"], findingType: "NC" as const };
    expect(findingKeyOf(findingFromLine)).toBe(findingDedupeKey("1.1.1", "1.1.1.DS1", "NC"));
  });
});

describe("Option A synthetic-line seed parity (buildDraftFinding)", () => {
  const req = GD4_REQUIREMENTS[0];

  function syntheticLine(status: SpecificChecklistLine["status"]): SpecificChecklistLine {
    return {
      id: `EVROW-${req.id}.DS1`,
      text: "The institution documents its strategic plan.",
      clause: `${req.id}.DS1`,
      sourceRef: `${req.id}.DS1`,
      status,
      generatedBy: "ai",
      evidence: [],
    };
  }

  it("a Not met Option A row yields the same rootCause/corrective/preventive scaffold a checklist line gets", () => {
    const draft = buildDraftFinding(req, syntheticLine("Not met"));
    expect(draft.rootCause).toBeTruthy();
    expect(draft.corrective).toBeTruthy();
    expect(draft.preventive).toBeTruthy();
    expect(draft.observation).toBeTruthy();
    expect(draft.criteria).toContain(req.requirement);
    expect(draft.effect).toBeTruthy();
    expect(draft.findingType).toBe("NC");
  });

  it("a Partial row yields an OFI with the closure seed", () => {
    const draft = buildDraftFinding(req, syntheticLine("Partial"));
    expect(draft.findingType).toBe("OFI");
    expect(draft.rootCause).toBeTruthy();
    expect(draft.corrective).toBeTruthy();
    expect(draft.preventive).toBeTruthy();
  });

  it("the observation uses the SSG assessor register (Technique 5), not the old flat template", () => {
    const draft = buildDraftFinding(req, syntheticLine("Not met"));
    // Opens with the official negative register and names the requirement…
    expect(draft.observation).toMatch(/^It was not evident that the PEI had /);
    expect(draft.observation).toContain(`GD4 ${req.id}`);
    // …and does not use the old "<line> — status: X. Auditor AI notes:" shape.
    expect(draft.observation).not.toContain("Auditor AI notes:");
    expect(draft.observation).not.toMatch(/— status: /);
  });
});
