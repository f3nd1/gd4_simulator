import { describe, it, expect } from "vitest";
import { classifyRunWarning, splitRunWarnings } from "../selfCheck";
import { partialReadWarning } from "../partialRead";
import { windowCoverageNote } from "../coverageNote";
import { misfiledWarning, findMisfiledFiles } from "../driveGuard";
import type { AuditFileRecord } from "../../types";

const capped: AuditFileRecord = { path: "a.xlsx", name: "a.xlsx", mimeType: "x", fileKind: "Excel", bucket: "evidence", readStatus: "read", auditStatus: "pending", partialRead: { kind: "rows", read: 200, total: 5000 } };

describe("classifying a run warning", () => {
  // Pinned against the REAL helpers, not against strings copied here: if a
  // helper's wording changes, this fails instead of silently reclassifying
  // its warning as a failed run.
  it("classifies the partial-read warning the helper actually writes", () => {
    expect(classifyRunWarning(partialReadWarning([capped]) as string)).toBe("readLess");
  });

  it("classifies the coverage note the helper actually writes", () => {
    const note = windowCoverageNote({ label: "Evidence", windowsProcessed: 3, windowsTotal: 5, docChars: 250_000, notAssessedLines: 0, totalLines: 12 }) as string;
    expect(classifyRunWarning(note)).toBe("readLess");
  });

  it("classifies the misfiled warning the helper actually writes", () => {
    const w = misfiledWarning(findMisfiledFiles([{ path: "1. Policy & Procedure/Attendance register.xlsx", bucket: "policy" }])) as string;
    expect(classifyRunWarning(w)).toBe("misfiled");
  });

  it("treats a genuine failure as incomplete", () => {
    expect(classifyRunWarning("Evidence extract window 2/5 failed — OpenAI request timed out after 90s")).toBe("incomplete");
    expect(classifyRunWarning("3 of 8 evidence file(s) could not be read (Drive errors) and were NOT assessed")).toBe("incomplete");
  });

  it("treats anything unrecognised as incomplete, never softened", () => {
    expect(classifyRunWarning("something nobody has seen before")).toBe("incomplete");
  });
});

describe("splitRunWarnings", () => {
  it("keeps every warning, in its own bucket", () => {
    const out = splitRunWarnings([
      "Evidence extract window 2/5 failed — timed out",
      partialReadWarning([capped]),
      misfiledWarning(findMisfiledFiles([{ path: "1. Policy & Procedure/Attendance register.xlsx", bucket: "policy" }])),
    ]);
    expect(out.incomplete).toHaveLength(1);
    expect(out.readLess).toHaveLength(1);
    expect(out.misfiled).toHaveLength(1);
  });

  it("drops empties without throwing on a hostile list", () => {
    expect(splitRunWarnings([undefined, "", "   "])).toEqual({ incomplete: [], readLess: [], misfiled: [] });
    expect(splitRunWarnings(undefined)).toEqual({ incomplete: [], readLess: [], misfiled: [] });
  });
});
