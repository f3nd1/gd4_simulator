import { describe, it, expect } from "vitest";
import { runPreAnalysisChecklist, checklistForItems, hasChecklist, extractDates, type DetectFile } from "../preAnalysisChecklist";

const f = (name: string, text: string | null, bucket: "policy" | "evidence" = "evidence", driveFileId = name): DetectFile => ({ name, path: `2. Actual Evidence/${name}`, bucket, driveFileId, text });

function outcome(itemIds: string[], files: DetectFile[], id: string) {
  return runPreAnalysisChecklist(itemIds, files).find((r) => r.id === id)?.outcome;
}

describe("preAnalysisChecklist — definitions", () => {
  it("4.2.2 has its 3 items (NRIC, contract-seq, FPS); 6.2.1 has its 2 (count, timeline)", () => {
    expect(checklistForItems(["4.2.2"]).map((i) => i.id)).toEqual(["4.2.2-nric", "4.2.2-contract-seq", "4.2.2-fps-coverage"]);
    expect(checklistForItems(["6.2.1"]).map((i) => i.id)).toEqual(["6.2.1-record-count", "6.2.1-action-timeline"]);
  });
  it("undefined sub-criteria have no checklist (no placeholder)", () => {
    expect(hasChecklist(["1.1.1", "3.4.1"])).toBe(false);
    expect(checklistForItems(["1.1.1"])).toEqual([]);
  });
  it("manual items carry no detect fn and produce no auto outcome", () => {
    const fps = runPreAnalysisChecklist(["4.2.2"], []).find((r) => r.id === "4.2.2-fps-coverage");
    expect(fps?.mode).toBe("manual");
    expect(fps?.outcome).toBeUndefined();
  });
});

describe("NRIC/FIN detection (auto)", () => {
  it("genuinely catches an unredacted NRIC/FIN pattern", () => {
    const o = outcome(["4.2.2"], [f("Receipt_001.pdf", "Official Receipt. Student: John Tan, NRIC S1234567D. Amount: $500.")], "4.2.2-nric");
    expect(o?.status).toBe("flag");
    expect(o?.fileRefs?.[0].name).toBe("Receipt_001.pdf");
    expect(o?.message).not.toContain("S1234567D"); // never surfaces the raw NRIC
  });
  it("clears when no NRIC pattern is present", () => {
    expect(outcome(["4.2.2"], [f("Receipt_002.pdf", "Official Receipt. Student ref: STU-0012. Amount: $500.")], "4.2.2-nric")?.status).toBe("clear");
  });
  it("is honest ('unknown') when no text is available to scan", () => {
    expect(outcome(["4.2.2"], [f("Scan.pdf", null)], "4.2.2-nric")?.status).toBe("unknown");
  });
});

describe("contract-before-fee date sequencing (auto)", () => {
  it("flags a receipt dated before the contract signature date", () => {
    const files = [
      f("Student_Contract.pdf", "STUDENT CONTRACT. This agreement is signed on 14 March 2026 by the student."),
      f("Receipt_Jan.pdf", "Official Receipt. Payment received 5 January 2026. Amount $2,000."),
    ];
    const o = outcome(["4.2.2"], files, "4.2.2-contract-seq");
    expect(o?.status).toBe("flag");
    expect(o?.message).toMatch(/before the contract signature/i);
  });
  it("clears when the receipt is on/after the contract signature date", () => {
    const files = [
      f("Student_Contract.pdf", "STUDENT CONTRACT signed on 5 January 2026."),
      f("Receipt.pdf", "Official Receipt. Payment received 14 March 2026."),
    ];
    expect(outcome(["4.2.2"], files, "4.2.2-contract-seq")?.status).toBe("clear");
  });
  it("says 'check manually' when dates can't be reliably extracted (no false positive)", () => {
    const files = [f("Student_Contract.pdf", "STUDENT CONTRACT. No dates here."), f("Receipt.pdf", "Official Receipt. No dates.")];
    expect(outcome(["4.2.2"], files, "4.2.2-contract-seq")?.status).toBe("unknown");
  });
  it("says 'check manually' when a contract or receipt file can't be identified", () => {
    expect(outcome(["4.2.2"], [f("SomeDoc.pdf", "signed on 14 March 2026")], "4.2.2-contract-seq")?.status).toBe("unknown");
  });
});

describe("management-review record count (auto, name-based)", () => {
  it("flags when fewer than 2 review records are found", () => {
    expect(outcome(["6.2.1"], [f("Management Review 2026.pdf", null)], "6.2.1-record-count")?.status).toBe("flag");
  });
  it("clears when current + preceding year records are present", () => {
    const files = [f("Management Review 2025.pdf", null), f("Management Review 2026.pdf", null)];
    expect(outcome(["6.2.1"], files, "6.2.1-record-count")?.status).toBe("clear");
  });
  it("flags honestly (not a false 'absent') when nothing matches the name pattern", () => {
    const o = outcome(["6.2.1"], [f("Board_Notes.pdf", null)], "6.2.1-record-count");
    expect(o?.status).toBe("flag");
    expect(o?.message).toMatch(/recognised as management-review/i);
  });
});

describe("extractDates", () => {
  it("parses common SG date formats (day-first)", () => {
    expect(extractDates("14 March 2026")[0].getFullYear()).toBe(2026);
    expect(extractDates("05/01/2026")[0].getMonth()).toBe(0);   // Jan (day-first)
    expect(extractDates("2026-03-14")[0].getMonth()).toBe(2);   // Mar
    expect(extractDates("no dates here")).toHaveLength(0);
  });
});
