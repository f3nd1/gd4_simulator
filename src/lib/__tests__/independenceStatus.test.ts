import { describe, it, expect } from "vitest";
import { independenceStatus, independenceLabel, independenceNotice } from "../auditorGuard";
import { DEFAULT_AUDITORS } from "../../data/auditors";
import { DEPARTMENT_DIVISION } from "../departments";

describe("independence says what it does not know", () => {
  it("is a conflict when the auditor owns the area", () => {
    expect(independenceStatus("SQ", "SQ")).toBe("conflict");
    expect(independenceStatus("sq", "SQ")).toBe("conflict");
  });

  it("is independent when they differ", () => {
    expect(independenceStatus("HR", "SQ")).toBe("independent");
  });

  it("is UNKNOWN, never independent, when either department is missing", () => {
    // The silent-pass bug: independenceNotice() returns undefined here, which
    // a printed working paper would render as "independent".
    expect(independenceStatus("", "SQ")).toBe("unknown");
    expect(independenceStatus("SQ", "")).toBe("unknown");
    expect(independenceStatus(undefined, undefined)).toBe("unknown");
    expect(independenceNotice({ name: "X", departmentId: "" }, "SQ")).toBeUndefined();
  });

  it("labels the three states without claiming independence it cannot show", () => {
    expect(independenceLabel("unknown")).toMatch(/Cannot check/);
    expect(independenceLabel("conflict", "SGL-SQ")).toMatch(/Conflict/);
    expect(independenceLabel("independent")).toBe("Independent");
  });
});

describe("the seeded roster", () => {
  it("is UCC's real team, not the invented demo names", () => {
    const names = DEFAULT_AUDITORS.map((a) => a.name);
    expect(names).toEqual(["Felix", "Renzo", "Irene", "Wendy", "Zheng Lin", "Dr Yasser Mattar", "Jobelle"]);
    for (const gone of ["Rachel Tan", "Marcus Lim", "Priya Nair", "Faizal Rahman", "Jennifer Wong"]) {
      expect(names).not.toContain(gone);
    }
  });

  it("carries a real department acronym or none at all, never a slashed pair", () => {
    // "ALI / CM" and "AD / AN" are not acronyms, so independenceNotice() could
    // never match them against a folder owner and passed every time.
    const real = new Set([...Object.keys(DEPARTMENT_DIVISION), ...Object.values(DEPARTMENT_DIVISION)]);
    for (const a of DEFAULT_AUDITORS) {
      if (a.departmentId === undefined) continue;
      expect(a.departmentId, `${a.name}`).not.toContain("/");
      expect(real.has(a.departmentId), `${a.name}: ${a.departmentId}`).toBe(true);
    }
  });

  it("leaves every department unset rather than guessing a real colleague's", () => {
    expect(DEFAULT_AUDITORS.every((a) => a.departmentId === undefined)).toBe(true);
  });
});
