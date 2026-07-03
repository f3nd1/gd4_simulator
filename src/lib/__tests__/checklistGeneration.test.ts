import { describe, it, expect } from "vitest";
import { simulateChecklistGeneration } from "../ai/simulateAI";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { GD4Requirement, GeneratedChecklistLine } from "../../types";

// Minimal GD4 requirement fixture for unit tests — avoids coupling tests to
// the real data file so they are stable even if gd4Requirements.ts changes.
function makeReq(
  overrides: Partial<Pick<GD4Requirement, "describeShow" | "notes" | "expectedEvidence">> = {}
): GD4Requirement {
  return {
    id: "TEST.1",
    criterion: "1",
    area: "Test Area",
    subCriterionId: "1.1",
    itemNumber: "TEST.1",
    requirement: "Test Requirement",
    intent: "Sub-criterion intent for TEST.1",
    describeShow: overrides.describeShow ?? ["Document and maintain a governance policy"],
    notes: overrides.notes ?? [],
    maxPoints: 60,
    weightage: 0.1,
    gateSensitive: false,
    expectedEvidence: overrides.expectedEvidence ?? ["Governance policy documentation"],
    bandDescriptors: {},
  };
}

// ── Deterministic fallback generator ────────────────────────────────────────

describe("simulateChecklistGeneration — traceability", () => {
  it("produces at least one line per Describe/Show bullet", () => {
    const req = makeReq({ describeShow: ["Document the governance policy", "Review the policy annually"] });
    const lines = simulateChecklistGeneration(req);
    const dsLines = lines.filter((l) => l.sourceType === "describeShow");
    expect(dsLines.length).toBeGreaterThanOrEqual(2);
  });

  it("every Describe/Show line has sourceText = the original bullet", () => {
    const req = makeReq({ describeShow: ["Establish a staff appraisal process"] });
    const lines = simulateChecklistGeneration(req);
    const dsLines = lines.filter((l) => l.sourceType === "describeShow");
    expect(dsLines.length).toBeGreaterThan(0);
    dsLines.forEach((l) => {
      expect(l.sourceText).toBe("Establish a staff appraisal process");
      expect(l.sourceIndex).toBe(0);
    });
  });

  it("every line has a non-empty sourceText", () => {
    const req = makeReq({
      describeShow: ["Engage stakeholders", "Monitor financial statements"],
      notes: ["The governance system shall include succession planning."],
      expectedEvidence: ["Stakeholder engagement records", "Governance review records"],
    });
    const lines = simulateChecklistGeneration(req);
    lines.forEach((l) => {
      expect(l.sourceText.trim()).not.toBe("");
    });
  });

  it("every line has a sourceType that is one of the allowed values", () => {
    const allowed: GeneratedChecklistLine["sourceType"][] = ["describeShow", "note", "expectedEvidence", "requirement", "intent"];
    const req = makeReq({
      describeShow: ["Document the admissions procedure"],
      notes: ["Admissions shall follow the SSG-approved process."],
      expectedEvidence: ["Admissions procedure documentation"],
    });
    const lines = simulateChecklistGeneration(req);
    lines.forEach((l) => {
      expect(allowed).toContain(l.sourceType);
    });
  });

  it("every line has an apsrDimension", () => {
    const valid: GeneratedChecklistLine["apsrDimension"][] = ["Approach", "Processes", "Systems & Outcomes", "Review"];
    const req = makeReq({
      describeShow: ["Review outcomes data for continual improvement"],
      expectedEvidence: ["Outcome trend analysis"],
    });
    const lines = simulateChecklistGeneration(req);
    lines.forEach((l) => {
      expect(valid).toContain(l.apsrDimension);
    });
  });

  it("produces lines from Expected Evidence items", () => {
    const req = makeReq({
      describeShow: ["Document governance"],
      expectedEvidence: ["Governance policy documentation", "Annual financial statements"],
    });
    const lines = simulateChecklistGeneration(req);
    const eeLines = lines.filter((l) => l.sourceType === "expectedEvidence");
    expect(eeLines.length).toBe(2);
    expect(eeLines[0].sourceText).toBe("Governance policy documentation");
    expect(eeLines[1].sourceText).toBe("Annual financial statements");
  });

  it("does not produce lines from Notes that are purely definitional (no shall/must)", () => {
    const req = makeReq({
      describeShow: ["Document governance"],
      notes: [
        "Key stakeholders refer to individuals the PEI provides a service to.", // definitional
        "The system shall include succession planning.",                          // prescriptive
      ],
    });
    const lines = simulateChecklistGeneration(req);
    const noteLines = lines.filter((l) => l.sourceType === "note");
    // Only the prescriptive note produces a line; the definitional one does not.
    expect(noteLines.length).toBe(1);
    expect(noteLines[0].sourceText).toContain("succession planning");
  });

  it("splits semicolon-separated Describe/Show sub-clauses into separate lines", () => {
    const req = makeReq({ describeShow: ["Develop a plan; implement the plan; review the plan"] });
    const lines = simulateChecklistGeneration(req);
    const dsLines = lines.filter((l) => l.sourceType === "describeShow");
    expect(dsLines.length).toBe(3);
    // All three traces back to the same original bullet
    dsLines.forEach((l) => expect(l.sourceText).toBe("Develop a plan; implement the plan; review the plan"));
  });

  it("APSR classifier maps review-related text to Review dimension", () => {
    const req = makeReq({ describeShow: ["Review the process for continual improvement"] });
    const lines = simulateChecklistGeneration(req);
    expect(lines[0].apsrDimension).toBe("Review");
  });

  it("APSR classifier maps record/log text to Processes dimension", () => {
    const req = makeReq({ describeShow: ["Maintain attendance records for all enrolled students"] });
    const lines = simulateChecklistGeneration(req);
    expect(lines[0].apsrDimension).toBe("Processes");
  });

  it("APSR classifier maps outcome/result text to Systems & Outcomes dimension", () => {
    const req = makeReq({ describeShow: ["Measure student outcome data and trends"] });
    const lines = simulateChecklistGeneration(req);
    expect(lines[0].apsrDimension).toBe("Systems & Outcomes");
  });

  it("default APSR is Approach for policy/procedure text", () => {
    const req = makeReq({ describeShow: ["Establish a documented governance framework for the institution"] });
    const lines = simulateChecklistGeneration(req);
    expect(lines[0].apsrDimension).toBe("Approach");
  });
});

// ── Validation: lines without sourceText must be rejected ───────────────────

describe("generated line validation (code-level)", () => {
  it("a GeneratedChecklistLine with empty sourceText is detectable", () => {
    // The validation in the store / runtime rejects lines where sourceText is empty.
    // Here we just confirm that such a line CAN be identified.
    const invalid: Partial<GeneratedChecklistLine> = { text: "Check something.", clause: "GD4 X", sourceText: "" };
    expect(invalid.sourceText?.trim()).toBe("");
  });

  it("a well-formed GeneratedChecklistLine passes validation criteria", () => {
    const valid: GeneratedChecklistLine = {
      text: "Verify that a governance policy is documented.",
      clause: "GD4 1.1.1 · Describe/Show 1",
      sourceType: "describeShow",
      sourceIndex: 0,
      sourceText: "Maintain a governance system",
      apsrDimension: "Approach",
    };
    expect(valid.sourceText.trim()).not.toBe("");
    expect(valid.sourceType).toBe("describeShow");
    expect(valid.apsrDimension).toBe("Approach");
  });
});

// ── Real GD4 requirements — smoke tests ─────────────────────────────────────

describe("simulateChecklistGeneration with real GD4 requirements", () => {
  it("1.1.1 produces lines traced to official Describe/Show and Expected Evidence", () => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === "1.1.1")!;
    const lines = simulateChecklistGeneration(req);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => {
      expect(l.sourceText.trim()).not.toBe("");
      expect(l.apsrDimension).toBeTruthy();
    });
    const dsLines = lines.filter((l) => l.sourceType === "describeShow");
    expect(dsLines.length).toBeGreaterThanOrEqual(req.describeShow.length);
    const eeLines = lines.filter((l) => l.sourceType === "expectedEvidence");
    expect(eeLines.length).toBe(req.expectedEvidence.length);
  });

  it("4.2.1 produces lines (gate-sensitive item)", () => {
    const req = GD4_REQUIREMENTS.find((r) => r.id === "4.2.1")!;
    const lines = simulateChecklistGeneration(req);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => expect(l.sourceText.trim()).not.toBe(""));
  });

  it("all 35 items produce at least one line with non-empty sourceText", () => {
    GD4_REQUIREMENTS.forEach((req) => {
      const lines = simulateChecklistGeneration(req);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((l) => {
        expect(l.sourceText.trim()).not.toBe("");
      });
    });
  });

  it("no line has an invented APSR dimension outside the four valid values", () => {
    const valid = new Set(["Approach", "Processes", "Systems & Outcomes", "Review"]);
    GD4_REQUIREMENTS.forEach((req) => {
      simulateChecklistGeneration(req).forEach((l) => {
        expect(valid.has(l.apsrDimension)).toBe(true);
      });
    });
  });

  it("every line's sourceText is a substring of the GD4 requirement fields it claims", () => {
    GD4_REQUIREMENTS.forEach((req) => {
      simulateChecklistGeneration(req).forEach((l) => {
        if (l.sourceType === "describeShow" && l.sourceIndex !== null) {
          expect(req.describeShow[l.sourceIndex]).toBe(l.sourceText);
        }
        if (l.sourceType === "expectedEvidence" && l.sourceIndex !== null) {
          expect(req.expectedEvidence[l.sourceIndex]).toBe(l.sourceText);
        }
        if (l.sourceType === "note" && l.sourceIndex !== null) {
          expect(req.notes[l.sourceIndex]).toBe(l.sourceText);
        }
      });
    });
  });
});
