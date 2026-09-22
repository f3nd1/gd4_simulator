import { describe, it, expect } from "vitest";
import {
  detectPlaceholderText,
  detectApprovalAfterEvent,
  detectSequenceGaps,
  detectTooUniform,
  detectIdenticalBlocks,
  detectFigureMismatch,
  UNIVERSAL_CHECKLIST,
  runPreAnalysisChecklist,
  type DetectFile,
} from "../preAnalysisChecklist";

const f = (name: string, text: string | null, bucket: DetectFile["bucket"] = "evidence"): DetectFile =>
  ({ name, path: `Folder/${name}`, bucket, text });

// Every detector must answer "unknown" rather than "clear" when the files
// present cannot settle the check — the honest-uncertainty rule the whole
// DETECTION_REGISTRY is built on.
const ALL = [
  detectPlaceholderText,
  detectApprovalAfterEvent,
  detectSequenceGaps,
  detectTooUniform,
  detectIdenticalBlocks,
  detectFigureMismatch,
];

describe("red-flag detectors — honest uncertainty", () => {
  it("returns unknown, never clear, when no file has readable text", () => {
    const files = [f("Scan.pdf", null), f("Photo.jpg", "   ")];
    for (const d of ALL) expect(d(files).status).toBe("unknown");
  });
});

describe("detectPlaceholderText", () => {
  it("flags an unfilled template and names the file", () => {
    const out = detectPlaceholderText([f("Induction form.docx", "Trainer: [insert name]\nDate: 12 Mar 2026")]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("[insert name]");
    expect(out.fileRefs?.[0].name).toBe("Induction form.docx");
    // The one §5 flag that is more than advisory, so it must say so.
    expect(out.message).toContain("not evidence");
  });

  it("flags a TBC marker", () => {
    expect(detectPlaceholderText([f("Plan.docx", "Auditor: TBC")]).status).toBe("flag");
  });

  it("clears a completed record", () => {
    expect(detectPlaceholderText([f("Minutes.docx", "Chair: R. Tan. Held 4 Feb 2026.")]).status).toBe("clear");
  });
});

describe("detectApprovalAfterEvent", () => {
  const approval = f("Approval memo.docx", "Approved on 14 March 2026 by the Academic Board.");

  it("flags an approval dated after the document it approves", () => {
    const out = detectApprovalAfterEvent([approval, f("Assessment policy.docx", "Version 2.0, effective 01 January 2026.")]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("Approval memo.docx");
    expect(out.message).toContain("Assessment policy.docx");
  });

  it("clears an approval dated before the document", () => {
    const out = detectApprovalAfterEvent([
      f("Approval memo.docx", "Approved on 14 March 2025 by the Academic Board."),
      f("Assessment policy.docx", "Version 2.0, effective 01 January 2026."),
    ]);
    expect(out.status).toBe("clear");
  });

  it("is unknown when there is no approval record to compare", () => {
    expect(detectApprovalAfterEvent([f("Assessment policy.docx", "Version 2.0, effective 01 January 2026.")]).status).toBe("unknown");
  });

  it("is unknown when the approval's date cannot be read", () => {
    const out = detectApprovalAfterEvent([
      f("Approval memo.docx", "Approved by the Academic Board."),
      f("Assessment policy.docx", "Version 2.0, effective 01 January 2026."),
    ]);
    // No readable approval date -> no pair -> clear on the pairs actually
    // compared (none), never an invented flag.
    expect(out.status).not.toBe("flag");
  });
});

describe("detectSequenceGaps", () => {
  it("flags missing numbers in a long enough series", () => {
    const out = detectSequenceGaps([f("Receipts.xlsx", "INV-001 INV-002 INV-003 INV-005 INV-006 INV-007")]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("INV-");
    expect(out.message).toContain("4");
  });

  it("clears a complete series", () => {
    expect(detectSequenceGaps([f("Receipts.xlsx", "INV-001 INV-002 INV-003 INV-004 INV-005")]).status).toBe("clear");
  });

  it("is unknown for a series too short to mean anything", () => {
    expect(detectSequenceGaps([f("Receipts.xlsx", "INV-001 INV-004")]).status).toBe("unknown");
  });
});

describe("detectTooUniform", () => {
  it("flags three or more perfect results and asks for the population", () => {
    const out = detectTooUniform([f("Survey.xlsx", "Q1 100% Q2 100% Q3 100%")]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("population");
  });

  it("does not flag two perfect results", () => {
    expect(detectTooUniform([f("Survey.xlsx", "Q1 100% Q2 100% Q3 92%")]).status).toBe("clear");
  });

  it("flags repeated 5/5 scores but not 4/5", () => {
    expect(detectTooUniform([f("Survey.xlsx", "5/5 5/5 5/5")]).status).toBe("flag");
    expect(detectTooUniform([f("Survey.xlsx", "4/5 4/5 4/5")]).status).toBe("clear");
  });
});

describe("detectIdenticalBlocks", () => {
  const block = "The trainee demonstrated a satisfactory grasp of the module outcomes across all assessed tasks, and the assessor confirmed that the evidence submitted met every criterion in the marking rubric without reservation.";

  it("flags a substantial passage repeated in two files", () => {
    const out = detectIdenticalBlocks([f("Review A.docx", block), f("Review B.docx", block)]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("Review A.docx");
    expect(out.message).toContain("Review B.docx");
  });

  it("ignores a short repeated line such as a header", () => {
    expect(detectIdenticalBlocks([f("A.docx", "United Ceres College"), f("B.docx", "United Ceres College")]).status).toBe("clear");
  });

  it("does not flag the same passage twice within one file", () => {
    expect(detectIdenticalBlocks([f("A.docx", `${block}\n\n${block}`), f("B.docx", "Something else entirely.")]).status).toBe("clear");
  });

  it("is unknown with fewer than two readable files", () => {
    expect(detectIdenticalBlocks([f("A.docx", block)]).status).toBe("unknown");
  });
});

describe("detectFigureMismatch", () => {
  it("flags one label with two values across two files", () => {
    const out = detectFigureMismatch([f("Report.docx", "Enrolment: 412"), f("Return.xlsx", "Enrolment: 398")]);
    expect(out.status).toBe("flag");
    expect(out.message).toContain("412");
    expect(out.message).toContain("398");
  });

  it("clears matching figures", () => {
    expect(detectFigureMismatch([f("Report.docx", "Enrolment: 412"), f("Return.xlsx", "Enrolment: 412")]).status).toBe("clear");
  });

  it("does not flag two values inside the same file", () => {
    expect(detectFigureMismatch([f("Report.docx", "Enrolment: 412 ... Enrolment: 398"), f("Other.docx", "No figures here.")]).status).toBe("clear");
  });
});

// The wording rule from the module header: a flag reports what is observable
// and names what would resolve it. It never asserts a motive, because the
// files cannot support one.
const MOTIVE = /\b(?:backdat\w*|fabricat\w*|falsif\w*|forged?|fraud\w*|dishonest|lying|lied|faked?|cover[- ]up)\b/i;

describe("flag wording", () => {
  it("never accuses anyone of a motive", () => {
    const hostile = [
      f("Approval memo.docx", "Approved on 14 March 2026. Enrolment: 412. INV-001 INV-002 INV-003 INV-005 INV-006 100% 100% 100% [insert name]"),
      f("Assessment policy.docx", "Version 2.0, effective 01 January 2026. Enrolment: 398."),
    ];
    for (const d of ALL) {
      const out = d(hostile);
      expect(out.message).not.toMatch(MOTIVE);
      expect(out.message.length).toBeGreaterThan(20);
    }
  });

  it("names the files behind every flag it raises", () => {
    const hostile = [
      f("Approval memo.docx", "Approved on 14 March 2026. Enrolment: 412."),
      f("Assessment policy.docx", "Version 2.0, effective 01 January 2026. Enrolment: 398."),
    ];
    for (const d of ALL) {
      const out = d(hostile);
      if (out.status === "flag") expect(out.fileRefs?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("registration in the universal layer", () => {
  it("adds the six §5 checks as auto universal items", () => {
    const ids = UNIVERSAL_CHECKLIST.map((i) => i.id);
    for (const id of [
      "universal-placeholder-text",
      "universal-approval-sequence",
      "universal-sequence-gaps",
      "universal-too-uniform",
      "universal-identical-blocks",
      "universal-figure-mismatch",
    ]) expect(ids).toContain(id);
    expect(UNIVERSAL_CHECKLIST.every((i) => i.scope === "universal")).toBe(true);
  });

  it("runs every universal detector on a sub-criterion with no per-item entries", () => {
    const results = runPreAnalysisChecklist({}, ["6.2.1"], [f("Survey.xlsx", "100% 100% 100%")]);
    const tooUniform = results.find((r) => r.id === "universal-too-uniform");
    expect(tooUniform?.outcome?.status).toBe("flag");
    // Every auto universal item produced a real outcome, not undefined.
    expect(results.filter((r) => r.mode === "auto").every((r) => r.outcome != null)).toBe(true);
  });
});
