import { describe, it, expect } from "vitest";
import {
  PLAIN_VERDICT, toSelfCheckRows, countSelfCheck, mostlyUnchecked, buildSelfCheckCsv,
  buildSelfCheckHtml, selfCheckFilename, describeBlock, plainRunError, plainWhy, plainDetail, COULD_NOT_CHECK_NOTE,
  SELF_CHECK_DISCLAIMER, SELF_CHECK_HEADERS,
} from "../selfCheck";
import type { EvidenceAssessmentRow, EvidenceVerdict } from "../../types";

const row = (over: Partial<EvidenceAssessmentRow> = {}): EvidenceAssessmentRow => ({
  gdRef: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "Describe how you monitor student learning.",
  ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
  verdict: "Met", comment: "The intervention records show this happening.", ...over,
});

describe("the four engine states in a process owner's words", () => {
  it("names each one without collapsing Partial into a fail", () => {
    expect(PLAIN_VERDICT.Met.label).toBe("Complies");
    expect(PLAIN_VERDICT.Partial.label).toBe("Partly complies");
    expect(PLAIN_VERDICT["Not met"].label).toBe("Does not comply");
    expect(PLAIN_VERDICT["Not assessed"].label).toBe("Could not check");
  });

  // The single most misleading thing this page could do is colour an unjudged
  // line as a failure. "Not assessed" is a gap in what was supplied, not a
  // verdict on the area.
  it("never gives 'Could not check' a fail colour, and never counts it as a gap", () => {
    expect(PLAIN_VERDICT["Not assessed"].tone).toBe("neutral");
    expect(PLAIN_VERDICT["Not assessed"].isGap).toBe(false);
    expect(PLAIN_VERDICT["Not met"].tone).toBe("critical");
  });

  it("covers every verdict the engine can return, so none can fall through", () => {
    const all: EvidenceVerdict[] = ["Met", "Partial", "Not met", "Not assessed"];
    for (const v of all) expect(PLAIN_VERDICT[v]).toBeDefined();
    expect(Object.keys(PLAIN_VERDICT).sort()).toEqual([...all].sort());
  });
});

describe("rows are copied from the engine, never written here", () => {
  it("takes the reason and the fix straight from the row", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", comment: "No record was found.", suggestedAction: "Add the intervention log." })]);
    expect(r.why).toBe("No record was found.");
    expect(r.fix).toBe("Add the intervention log.");
    expect(r.label).toBe("Does not comply");
  });

  it("invents no fix when the engine suggested none", () => {
    expect(toSelfCheckRows([row({ verdict: "Not met", suggestedAction: undefined })])[0].fix).toBe("");
  });

  it("falls back to the evidence summary rather than showing an empty reason", () => {
    expect(toSelfCheckRows([row({ comment: "", evidenceSummary: "Records were found." })])[0].why).toBe("Records were found.");
  });

  // A failed AI call must read as "could not check", never as a silent blank
  // that looks like there was nothing to say.
  it("says so when the row's own assessment did not complete", () => {
    expect(toSelfCheckRows([row({ assessmentFailed: true })])[0].why).toMatch(/did not answer/i);
  });
});

describe("counts and the mostly-unchecked callout", () => {
  const mk = (v: EvidenceVerdict[]) => countSelfCheck(toSelfCheckRows(v.map((verdict) => row({ verdict }))));
  it("counts each state separately", () => {
    expect(mk(["Met", "Met", "Partial", "Not met", "Not assessed"]))
      .toEqual({ complies: 2, partly: 1, doesNot: 1, couldNotCheck: 1, total: 5 });
  });
  it("flags a run that mostly could not be judged", () => {
    expect(mostlyUnchecked(mk(["Not assessed", "Not assessed", "Met"]))).toBe(true);
    expect(mostlyUnchecked(mk(["Met", "Met", "Not assessed"]))).toBe(false);
    expect(mostlyUnchecked(mk([]))).toBe(false);
  });
});

describe("downloads", () => {
  const rows = toSelfCheckRows([row({ verdict: "Not met", comment: "Nothing found, and a comma.", suggestedAction: "Add it." })]);
  const someBand = { kind: "indicative", band: 3, name: "Meeting Expectation", totalPct: 50 } as const;
  it("writes the agreed CSV header and quotes a comma so columns cannot shift", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, someBand);
    expect(csv.split("\r\n")[0]).toBe(SELF_CHECK_HEADERS.join(","));
    expect(csv).toContain('"Nothing found, and a comma."');
  });
  // A spreadsheet gets forwarded and printed on its own. Without these two it
  // reads like a bare verdict list somebody could pass off as an outcome.
  it("carries the band and the disclaimer in the CSV, not just on screen", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, someBand);
    expect(csv).toContain("Band 3 of 5");
    expect(csv).toContain("not yet confirmed by your auditor");
    expect(csv).toContain(SELF_CHECK_DISCLAIMER);
  });
  it("says so in the CSV when there is no band, rather than leaving it blank", () => {
    expect(buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" })).toContain("No band yet for this area.");
  });
  it("carries the disclaimer into the printable version", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "5.4 Student Learning", areaDescription: "d",
      counts: countSelfCheck(rows), band: { kind: "indicative", band: 3, name: "Meeting Expectation", totalPct: 50 },
      rows, ranAt: "x",
    });
    expect(html).toContain(SELF_CHECK_DISCLAIMER);
    expect(html).toContain("not yet confirmed by your auditor");
  });
  // The printable copy used to explain "Could not check" on every run,
  // including one where nothing was unjudged — a warning about a result that
  // is not there. It now follows the same condition as the screen.
  it("only explains Could not check when the run actually has one", () => {
    const base = { areaLabel: "a", areaDescription: "d", band: { kind: "none" } as const, ranAt: "x" };
    const clean = toSelfCheckRows([row({ verdict: "Met" })]);
    expect(buildSelfCheckHtml({ ...base, rows: clean, counts: countSelfCheck(clean) })).not.toContain("is not a fail");
    const unjudged = toSelfCheckRows([row({ verdict: "Met" }), row({ verdict: "Met" }), row({ verdict: "Not assessed" })]);
    expect(buildSelfCheckHtml({ ...base, rows: unjudged, counts: countSelfCheck(unjudged) }))
      .toContain(COULD_NOT_CHECK_NOTE.slice(COULD_NOT_CHECK_NOTE.indexOf("is not a fail")).split(".")[0]);
  });
  it("escapes html so a document name cannot break the printable page", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "<script>x</script>", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("names the file after the area and the date", () => {
    expect(selfCheckFilename("Student Learning", "csv")).toMatch(/^self-check-student-learning-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

// Every blocker a process owner can hit must be explained in words they can act
// on. None of these may send them to a page written for the audit lead.
describe("blockers speak to a process owner, not an auditor", () => {
  const ok = { cycleLocked: false, hasAuditor: true, aiOffline: null, driveConnected: true };
  it("lets a ready workspace run", () => {
    expect(describeBlock(ok)).toEqual({ canRun: true });
  });
  it("explains a locked cycle without telling them to unlock it", () => {
    const b = describeBlock({ ...ok, cycleLocked: true });
    expect(b.canRun).toBe(false);
    if (b.canRun === false) {
      expect(b.detail).toMatch(/audit lead/i);
      expect(b.detail).not.toMatch(/unlock \(admin\)|draft workspace/i);
    }
  });
  it("explains a workspace with no audit team without sending them to Auditor Creation", () => {
    const b = describeBlock({ ...ok, hasAuditor: false });
    expect(b.canRun).toBe(false);
    if (b.canRun === false) expect(b.detail).not.toMatch(/auditor creation/i);
  });
  it("reports the lock ahead of everything else, since nothing can run at all", () => {
    const b = describeBlock({ cycleLocked: true, hasAuditor: false, aiOffline: "off", driveConnected: false });
    if (b.canRun === false) expect(b.title).toMatch(/paused/i);
  });
  it("covers AI off and Drive disconnected", () => {
    expect(describeBlock({ ...ok, aiOffline: "no key" }).canRun).toBe(false);
    expect(describeBlock({ ...ok, driveConnected: false }).canRun).toBe(false);
  });
});

describe("engine error strings translated, never swallowed", () => {
  it("turns the policy-files stop into folder advice", () => {
    expect(plainRunError("No Policy & Procedure files found in the linked folder.")).toMatch(/could not find any documents/i);
  });
  it("explains an unreadable scan", () => {
    expect(plainRunError("No readable text could be extracted from the Policy & Procedure files.")).toMatch(/scanned images/i);
  });
  it("passes an unrecognised error through rather than hiding it", () => {
    expect(plainRunError("Something nobody anticipated (503)")).toBe("Something nobody anticipated (503)");
  });
  it("returns undefined for no error", () => {
    expect(plainRunError(undefined)).toBeUndefined();
  });
});

// The strings below are copied VERBATIM from agentRuntime.ts (lines 1813,
// 2843-2846, 2862-2863, 2904, 3462, 3485-3487). If the engine rewords one of
// its "Not assessed" reasons, the matching case here stops matching and the
// page silently starts printing engine diagnostics at a process owner again —
// which is exactly the defect these tests were written for.
describe("the engine's own unjudged-line diagnostics, in plain English", () => {
  const ENGINE = {
    stoppedSweep: "Not assessed — the run was stopped before this audit point was reviewed. No verdict was produced.",
    failedSweep: "Not assessed — the AI call for this audit point failed in every window it was sent to. No verdict was produced.",
    stoppedPpd: "Not assessed — the run was stopped before this requirement line was reviewed. Re-run the PPD review to assess it.",
    failedPpd: "Not assessed — the AI call covering this requirement line failed. Re-run the PPD review to assess it.",
    extraction: "Not assessed — the extraction pass returned 1 candidate passage for this line, but none could be verified as an exact excerpt of the evidence documents, so no verdict was reached. This usually means the model paraphrased its quotes instead of copying them, or the document text reached the app in a form the verifier cannot match (e.g. OCR/vision artifacts). Re-run the evidence assessment; if it persists, this is an extraction defect — NOT evidence that the requirement is unimplemented.",
    mismatch: 'Not assessed — the model\'s verdict ("Partial") and its own comment\'s stated conclusion ("Met") disagreed. Re-run to get a consistent assessment.',
  };

  it("leaves a real judged comment completely alone", () => {
    const real = "The intervention records show this happening for all three cohorts.";
    expect(plainWhy(real)).toBe(real);
  });

  it("never leaks engine jargon into any of the real cases", () => {
    for (const raw of Object.values(ENGINE)) {
      const out = plainWhy(raw);
      expect(out).not.toMatch(/extraction pass|verbatim|OCR|chunk|verdict was produced|PPD/i);
      expect(out).not.toMatch(/Not assessed/);
    }
  });

  it("tells a stopped run to run again, on both paths", () => {
    expect(plainWhy(ENGINE.stoppedSweep)).toMatch(/stopped before/i);
    expect(plainWhy(ENGINE.stoppedPpd)).toMatch(/stopped before/i);
  });

  it("blames the service, not the area, when the call failed", () => {
    expect(plainWhy(ENGINE.failedSweep)).toMatch(/did not answer/i);
    expect(plainWhy(ENGINE.failedPpd)).toMatch(/did not answer/i);
  });

  it("says an extraction defect is the tool's limit, not the area's problem", () => {
    const out = plainWhy(ENGINE.extraction);
    expect(out).toMatch(/limit of the tool/i);
    expect(out).toMatch(/tell your audit lead/i);
  });

  it("explains a self-contradicting check without quoting its two verdicts", () => {
    const out = plainWhy(ENGINE.mismatch);
    expect(out).toMatch(/contradicted itself/i);
    expect(out).not.toContain('"Partial"');
  });

  it("falls back honestly on a reason it does not recognise, and still does not imply a fail", () => {
    const out = plainWhy("Not assessed — some future reason nobody has written yet.");
    expect(out).toMatch(/not a fail/i);
    expect(out).not.toContain("some future reason");
  });

  it("is applied to the rows the page renders, not just available", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not assessed", comment: ENGINE.extraction })]);
    expect(r.why).toMatch(/limit of the tool/i);
  });

  it("leaves an empty comment empty rather than inventing a reason", () => {
    expect(plainWhy("   ")).toBe("");
  });
});

// Real onProgress strings from agentRuntime.ts (2684 and the detail: sites).
describe("progress detail keeps document names and drops engine phases", () => {
  it("shows a file the run is actually reading", () => {
    expect(plainDetail("Reading Student Support Policy.docx…")).toBe("Reading Student Support Policy.docx…");
    expect(plainDetail("Re-reading Intervention Log.xlsx…")).toBe("Re-reading Intervention Log.xlsx…");
  });
  it("hides the engine's own phase names", () => {
    for (const raw of [
      "PPD contradiction hunt — window 1/1",
      "Verifying citations…",
      "Working through the audit checklist library…",
      "Assessing evidence against each requirement line…",
      "Starting PPD requirements review…",
    ]) expect(plainDetail(raw)).toBe("");
  });
});
