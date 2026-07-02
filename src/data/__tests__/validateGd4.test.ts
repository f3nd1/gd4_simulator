import { describe, it, expect } from "vitest";
import { GD4_REQUIREMENTS, GD4_CRITERIA, GD4_SUB_CRITERIA } from "../gd4Requirements";

const EXPECTED_ITEM_COUNT = 35;
const EXPECTED_SUB_CRITERION_COUNT = 24;
const EXPECTED_CRITERION_COUNT = 7;
const VALID_SOURCE_TYPES = new Set(["describeShow", "note", "expectedEvidence"]);

describe("GD4 requirement data integrity", () => {
  it("has exactly 7 criteria", () => {
    expect(GD4_CRITERIA).toHaveLength(EXPECTED_CRITERION_COUNT);
  });

  it("has exactly 24 sub-criteria", () => {
    expect(GD4_SUB_CRITERIA).toHaveLength(EXPECTED_SUB_CRITERION_COUNT);
  });

  it("has exactly 35 items", () => {
    expect(GD4_REQUIREMENTS).toHaveLength(EXPECTED_ITEM_COUNT);
  });

  it("all item IDs are unique", () => {
    const ids = GD4_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all items have a non-empty describeShow array", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      expect(r.describeShow.length).toBeGreaterThan(0);
      r.describeShow.forEach((ds) => {
        expect(ds.trim()).not.toBe("");
      });
    });
  });

  it("all items have a non-empty expectedEvidence array", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      expect(r.expectedEvidence.length).toBeGreaterThan(0);
      r.expectedEvidence.forEach((ev) => {
        expect(ev.trim()).not.toBe("");
      });
    });
  });

  it("all items reference a valid subCriterionId that exists in GD4_SUB_CRITERIA", () => {
    const subIds = new Set(GD4_SUB_CRITERIA.map((s) => s.id));
    GD4_REQUIREMENTS.forEach((r) => {
      expect(subIds.has(r.subCriterionId), `${r.id} references unknown sub-criterion ${r.subCriterionId}`).toBe(true);
    });
  });

  it("all item IDs match their sub-criterion prefix", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      expect(r.id.startsWith(r.subCriterionId + "."), `${r.id} does not start with its sub-criterion id ${r.subCriterionId}`).toBe(true);
    });
  });

  it("all items have flatAuditPoints", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      expect(r.flatAuditPoints, `${r.id} missing flatAuditPoints`).toBeDefined();
      expect(r.flatAuditPoints!.length, `${r.id} has empty flatAuditPoints`).toBeGreaterThan(0);
    });
  });

  it("all flatAuditPoint refs are unique per item", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      const refs = r.flatAuditPoints!.map((p) => p.ref);
      expect(new Set(refs).size, `${r.id} has duplicate flatAuditPoint refs`).toBe(refs.length);
    });
  });

  it("all flatAuditPoint refs globally unique", () => {
    const all = GD4_REQUIREMENTS.flatMap((r) => r.flatAuditPoints!.map((p) => p.ref));
    expect(new Set(all).size).toBe(all.length);
  });

  it("all flatAuditPoints have non-empty sourceText", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!.forEach((p) => {
        expect(p.sourceText.trim(), `${p.ref} has empty sourceText`).not.toBe("");
      });
    });
  });

  it("all flatAuditPoints have a valid sourceType", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!.forEach((p) => {
        expect(VALID_SOURCE_TYPES.has(p.sourceType), `${p.ref} has invalid sourceType "${p.sourceType}"`).toBe(true);
      });
    });
  });

  it("DS sub-item refs follow the pattern itemId.DS{n}.{letter}", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!
        .filter((p) => p.sourceType === "describeShow" && p.originalIndex === null)
        .forEach((p) => {
          expect(/\.\w+$/.test(p.ref), `Sub-item ref ${p.ref} should end with a letter`).toBe(true);
        });
    });
  });

  it("DS simple-point refs follow the pattern itemId.DS{n} with correct originalIndex", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!
        .filter((p) => p.sourceType === "describeShow" && p.originalIndex !== null)
        .forEach((p) => {
          expect(/\.DS\d+$/.test(p.ref), `Simple DS ref ${p.ref} should match *.DS{n}`).toBe(true);
          const n = parseInt(p.ref.split(".DS")[1], 10);
          expect(p.originalIndex).toBe(n - 1);
          expect(r.describeShow[p.originalIndex!]).toBe(p.sourceText);
        });
    });
  });

  it("EE point refs and originalIndex are consistent with req.expectedEvidence", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!
        .filter((p) => p.sourceType === "expectedEvidence")
        .forEach((p) => {
          expect(/\.EE\d+$/.test(p.ref), `EE ref ${p.ref} should match *.EE{n}`).toBe(true);
          const n = parseInt(p.ref.split(".EE")[1], 10);
          expect(p.originalIndex).toBe(n - 1);
          expect(r.expectedEvidence[p.originalIndex!]).toBe(p.sourceText);
        });
    });
  });

  it("Note point refs and originalIndex are consistent with req.notes", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      r.flatAuditPoints!
        .filter((p) => p.sourceType === "note")
        .forEach((p) => {
          expect(/\.N\d+$/.test(p.ref), `Note ref ${p.ref} should match *.N{n}`).toBe(true);
          const n = parseInt(p.ref.split(".N")[1], 10);
          expect(p.originalIndex).toBe(n - 1);
          expect(r.notes[p.originalIndex!]).toBe(p.sourceText);
        });
    });
  });

  it("items with DS sub-items have at least 2 children per parent", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      const subItems = r.flatAuditPoints!.filter((p) => p.sourceType === "describeShow" && p.parentText);
      if (subItems.length === 0) return;
      // Group by parent
      const byParent = new Map<string, number>();
      subItems.forEach((p) => {
        const key = p.parentText!;
        byParent.set(key, (byParent.get(key) ?? 0) + 1);
      });
      byParent.forEach((count, parent) => {
        expect(count, `${r.id} parent "${parent.slice(0, 40)}..." has only ${count} child`).toBeGreaterThanOrEqual(2);
      });
    });
  });

  it("items with DS sub-items have sequential letters starting at 'a'", () => {
    GD4_REQUIREMENTS.forEach((r) => {
      const subItems = r.flatAuditPoints!.filter((p) => p.sourceType === "describeShow" && p.parentText);
      if (subItems.length === 0) return;
      // Group by DS parent ref prefix (e.g. "1.1.1.DS1")
      const byDsPrefix = new Map<string, string[]>();
      subItems.forEach((p) => {
        const prefix = p.ref.slice(0, p.ref.lastIndexOf("."));
        if (!byDsPrefix.has(prefix)) byDsPrefix.set(prefix, []);
        byDsPrefix.get(prefix)!.push(p.ref.split(".").at(-1)!);
      });
      byDsPrefix.forEach((letters, prefix) => {
        letters.forEach((letter, idx) => {
          expect(letter, `${prefix} child ${idx + 1} should be letter '${String.fromCharCode(97 + idx)}', got '${letter}'`).toBe(String.fromCharCode(97 + idx));
        });
      });
    });
  });

  it("gate-sensitive items are from sub-criteria 4.2, 4.6, or criterion 5", () => {
    GD4_REQUIREMENTS.filter((r) => r.gateSensitive).forEach((r) => {
      const isGate = r.subCriterionId === "4.2" || r.subCriterionId === "4.6" || r.criterion === "5";
      expect(isGate, `${r.id} is marked gate-sensitive but is not in expected sub-criteria`).toBe(true);
    });
  });
});
