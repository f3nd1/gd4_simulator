import { describe, it, expect } from "vitest";
import { runPreAnalysisChecklist, checklistForItems, hasChecklist, extractDates, findDocumentDate, detectDateTimeDiscrepancy, computeFlaggedPreCheckItems, UNIVERSAL_CHECKLIST, DEFAULT_CHECKLISTS, type DetectFile } from "../preAnalysisChecklist";

const f = (name: string, text: string | null, bucket: "policy" | "evidence" = "evidence", driveFileId = name): DetectFile => ({ name, path: `2. Actual Evidence/${name}`, bucket, driveFileId, text });

function outcome(itemIds: string[], files: DetectFile[], id: string) {
  return runPreAnalysisChecklist(DEFAULT_CHECKLISTS, itemIds, files).find((r) => r.id === id)?.outcome;
}

describe("preAnalysisChecklist — definitions", () => {
  it("4.2.2 has its 3 items (NRIC, contract-seq, FPS); 6.2.1 has its 2 (count, timeline)", () => {
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["4.2.2"]).map((i) => i.id)).toEqual(["4.2.2-nric", "4.2.2-contract-seq", "4.2.2-fps-coverage"]);
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["6.2.1"]).map((i) => i.id)).toEqual(["6.2.1-record-count", "6.2.1-action-timeline"]);
  });
  it("4.2.2 and 6.2.1 items are all verified; drafted items elsewhere are not", () => {
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["4.2.2"]).every((i) => i.verified)).toBe(true);
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["6.2.1"]).every((i) => i.verified)).toBe(true);
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["1.1.1"]).every((i) => i.verified === false)).toBe(true);
  });
  it("5.3.1 (Partnerships) deliberately has no draft item — no adequate grounding was found", () => {
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["5.3.1"])).toEqual([]);
  });
  it("an undefined sub-criterion has no PER-ITEM checklist (no placeholder) — but hasChecklist is still true because of the universal layer", () => {
    expect(checklistForItems(DEFAULT_CHECKLISTS, ["9.9.9"])).toEqual([]);
    expect(hasChecklist(DEFAULT_CHECKLISTS, ["9.9.9"])).toBe(true);
  });
  it("manual items carry no detect fn and produce no auto outcome", () => {
    const fps = runPreAnalysisChecklist(DEFAULT_CHECKLISTS, ["4.2.2"], []).find((r) => r.id === "4.2.2-fps-coverage");
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

describe("universal checklist layer — runs for every sub-criterion, additive to any specific items", () => {
  it("a sub-criterion with NO specific items still gets the universal date-discrepancy item", () => {
    const results = runPreAnalysisChecklist(DEFAULT_CHECKLISTS, ["9.9.9"], []);
    expect(results.map((r) => r.id)).toContain("universal-date-discrepancy");
    expect(results.find((r) => r.id === "universal-date-discrepancy")?.scope).toBe("universal");
  });
  it("a sub-criterion WITH specific items (4.2.2) gets universal + specific together, universal first", () => {
    const results = runPreAnalysisChecklist(DEFAULT_CHECKLISTS, ["4.2.2"], []);
    expect(results[0].id).toBe("universal-date-discrepancy");
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(["4.2.2-nric", "4.2.2-contract-seq", "4.2.2-fps-coverage"]));
  });
  it("the universal check is verified (genuine detection logic, not a per-sub-criterion draft guess)", () => {
    expect(UNIVERSAL_CHECKLIST.every((i) => i.verified)).toBe(true);
  });
});

describe("universal date/time discrepancy detector (auto)", () => {
  const NOW = new Date(2026, 5, 1); // 1 June 2026 — fixed "now" so tests are deterministic

  it("flags a policy dated AFTER an evidence record it would logically govern", () => {
    const files: DetectFile[] = [
      { name: "Refund_Policy.pdf", path: "1. Policy & Procedure/Refund_Policy.pdf", bucket: "policy", driveFileId: "p1", text: "Refund Policy. Version dated 10 March 2026." },
      { name: "Refund_Register.xlsx", path: "2. Actual Evidence/Refund_Register.xlsx", bucket: "evidence", driveFileId: "e1", text: "Refund processed. Approved on 1 January 2026." },
    ];
    const o = detectDateTimeDiscrepancy(files, NOW);
    expect(o.status).toBe("flag");
    expect(o.message).toContain("postdates");
    expect(o.fileRefs?.map((r) => r.name)).toEqual(expect.arrayContaining(["Refund_Policy.pdf", "Refund_Register.xlsx"]));
  });

  it("flags a document dated suspiciously close to the review date (within 4 weeks)", () => {
    const files: DetectFile[] = [
      { name: "Management_Review.pdf", path: "2. Actual Evidence/Management_Review.pdf", bucket: "evidence", driveFileId: "e2", text: "Management review minutes, approved on 20 May 2026." },
    ];
    const o = detectDateTimeDiscrepancy(files, NOW);
    expect(o.status).toBe("flag");
    expect(o.message).toMatch(/prepared in anticipation/);
  });

  it("clears when dates are consistent and nothing is close to the review date", () => {
    const files: DetectFile[] = [
      { name: "Refund_Policy.pdf", path: "1. Policy & Procedure/Refund_Policy.pdf", bucket: "policy", driveFileId: "p2", text: "Refund Policy. Version dated 5 January 2025." },
      { name: "Refund_Register.xlsx", path: "2. Actual Evidence/Refund_Register.xlsx", bucket: "evidence", driveFileId: "e3", text: "Refund processed. Approved on 10 March 2025." },
    ];
    const o = detectDateTimeDiscrepancy(files, NOW);
    expect(o.status).toBe("clear");
  });

  it("is honest ('unknown') when no file has any identifiable version/signature date", () => {
    const files: DetectFile[] = [
      { name: "Notes.pdf", path: "2. Actual Evidence/Notes.pdf", bucket: "evidence", driveFileId: "e4", text: "General notes with no dating keyword nearby, though the year 2025 appears in passing." },
    ];
    const o = detectDateTimeDiscrepancy(files, NOW);
    expect(o.status).toBe("unknown");
  });

  it("is honest ('unknown') when no text has been read yet", () => {
    const files: DetectFile[] = [{ name: "Scan.pdf", path: "2. Actual Evidence/Scan.pdf", bucket: "evidence", driveFileId: "e5", text: null }];
    expect(detectDateTimeDiscrepancy(files, NOW).status).toBe("unknown");
  });
});

describe("findDocumentDate", () => {
  it("finds a date next to a broad set of dating/versioning keywords (not just contract-signing ones)", () => {
    expect(findDocumentDate("This policy was last revised on 3 February 2026.")?.getFullYear()).toBe(2026);
    expect(findDocumentDate("Version dated 14 March 2026.")?.getMonth()).toBe(2);
    expect(findDocumentDate("Approved on 2026-01-05.")).not.toBeNull();
  });
  it("never guesses from a random date with no dating keyword nearby", () => {
    expect(findDocumentDate("The previous policy from 2020 was superseded. No further dates mentioned here at all in 2026.")).toBeNull();
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

describe("computeFlaggedPreCheckItems — the single definition of 'flagged' shared by runEvidenceAssessment's prompt injection and the Evidence tab's arrival panel", () => {
  it("counts an auto item's 'flag' outcome, regardless of any manual tick", () => {
    const files = [f("Management Review 2026.pdf", null)]; // triggers 6.2.1-record-count's flag (only 1 record found)
    const { totalCount, flagsByItemId } = computeFlaggedPreCheckItems(DEFAULT_CHECKLISTS, {}, "6.2", ["6.2.1"], files);
    expect(totalCount).toBeGreaterThan(0);
    expect(flagsByItemId["6.2.1"]?.[0]).toContain("Current + preceding year's review records present");
  });

  it("counts a manual item ONLY when the auditor has ticked it (preAnalysisChecks[subCriterionId::itemId] === true)", () => {
    const files: DetectFile[] = [];
    const untouched = computeFlaggedPreCheckItems(DEFAULT_CHECKLISTS, {}, "4.2", ["4.2.2"], files);
    // 4.2.2-fps-coverage is manual — untouched (no tick) contributes nothing.
    expect(untouched.flagsByItemId["4.2.2"]?.some((m) => m.includes("FPS certificate"))).toBeFalsy();

    const ticked = computeFlaggedPreCheckItems(DEFAULT_CHECKLISTS, { "4.2::4.2.2-fps-coverage": true }, "4.2", ["4.2.2"], files);
    expect(ticked.flagsByItemId["4.2.2"]?.some((m) => m.includes("FPS certificate"))).toBe(true);
    expect(ticked.totalCount).toBeGreaterThan(untouched.totalCount);
  });

  it("zero flags when nothing is flagged (empty checklist scope, no ticks)", () => {
    const { totalCount, flagsByItemId } = computeFlaggedPreCheckItems(DEFAULT_CHECKLISTS, {}, "9.9", ["9.9.9"], []);
    // The universal date-discrepancy check itself returns "unknown" with no files — not a flag.
    expect(totalCount).toBe(0);
    expect(flagsByItemId).toEqual({});
  });
});
