import { describe, it, expect } from "vitest";
import {
  PLAIN_VERDICT, toSelfCheckRows, countSelfCheck, mostlyUnchecked, buildSelfCheckCsv,
  buildSelfCheckHtml, selfCheckFilename, describeBlock, plainRunError, plainWhy, plainDetail, COULD_NOT_CHECK_NOTE,
  unjudgedNoteFor, MOSTLY_UNCHECKED_NOTE,
  planFor, toProcedureRows, PPD_PLAIN_VERDICT, PROCEDURE_ONLY_NOTE, bandLineOf, NO_BAND_LINE,
  unjudgedBothSides, toRecordsRows, NO_EVIDENCE_FIRST_STEP,
  combinationOf, countCombinations, VIEW_TALLY, VIEW_NOTE, VIEW_LABEL, COMBINATION_LABEL, UNJUDGED_BOTH_SIDES_WHY,
  SELF_CHECK_DISCLAIMER, SELF_CHECK_HEADERS,
} from "../selfCheck";
import type { EvidenceAssessmentRow, EvidenceVerdict, PPDReviewRow } from "../../types";

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

  // Narrowed: a gap the engine DID reason about (it cited records) and still
  // suggested nothing for is left silent, because inventing a fix there would
  // be guessing. A gap where nothing was found at all now gets the one honest
  // first step instead, which is asserted in its own block below.
  it("invents no fix when the engine reasoned about records and suggested none", () => {
    expect(toSelfCheckRows([row({ verdict: "Not met", evidenceChunkIds: ["C001"], suggestedAction: undefined })])[0].fix).toBe("");
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
  const someBand = { kind: "auditor", band: 3, name: "Meeting Expectation", totalPct: 50 } as const;
  it("writes the agreed CSV header and quotes a comma so columns cannot shift", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, someBand);
    expect(csv.split("\r\n")[0]).toBe(SELF_CHECK_HEADERS.join(","));
    expect(csv).toContain('"Nothing found, and a comma."');
  });
  // A spreadsheet gets forwarded and printed on its own. Without these two it
  // reads like a bare verdict list somebody could pass off as an outcome.
  it("carries the auditor's band and the disclaimer in the CSV, not just on screen", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, someBand);
    expect(csv).toContain("Band 3 of 5");
    expect(csv).toContain("Band set by your auditor");
    expect(csv).toContain(SELF_CHECK_DISCLAIMER);
  });
  it("says in the CSV that the check gives no band, rather than leaving it blank", () => {
    expect(buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" })).toContain(NO_BAND_LINE);
  });
  it("carries the disclaimer into the printable version", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "5.4 Student Learning", areaDescription: "d",
      counts: countSelfCheck(rows), band: someBand,
      rows, ranAt: "x",
    });
    expect(html).toContain(SELF_CHECK_DISCLAIMER);
    expect(html).toContain("Band set by your auditor");
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

const ppdRow = (over: Partial<PPDReviewRow> = {}): PPDReviewRow => ({
  ref: "5.4.1.DS1", gd4ItemId: "5.4.1", requirementText: "Implement a learning support process.",
  verdict: "Adequate", shortComment: "Section 3 sets this out.", fullComment: "Section 3 sets this out.",
  chunkIds: [], ...over,
});

describe("two folders: what will and will not be checked", () => {
  it("runs the full check only when both are given", () => {
    const p = planFor(true, true);
    expect(p.canRun).toBe(true);
    expect(p.kind).toBe("full");
    if (p.kind === "full") expect(p.button).toBe("Check my area");
  });

  // The engine falls back to the OTHER folder when one link is blank
  // (useWorkspaceStore.ts:1525, 2025), so "nothing there" is never what a blank
  // field means. Both half-filled cases are therefore handled explicitly.
  it("offers a procedure-only check, and says the records are not checked", () => {
    const p = planFor(true, false);
    expect(p.canRun).toBe(true);
    expect(p.kind).toBe("procedure-only");
    if (p.kind === "procedure-only") {
      expect(p.button).toBe("Check my written procedure");
      expect(p.note).toMatch(/NOT check whether it actually happens/);
      expect(p.note).toMatch(/records/i);
    }
  });

  it("refuses evidence on its own, and says why rather than failing mid-run", () => {
    const p = planFor(false, true);
    expect(p.canRun).toBe(false);
    expect(p.note).toMatch(/need your written procedure/i);
    // The reason is the engine's, not a preference: the procedure is what
    // everything is measured against.
    expect(p.note).toMatch(/nothing to check your records against/i);
  });

  it("says nothing at all when both are empty", () => {
    const p = planFor(false, false);
    expect(p.canRun).toBe(false);
    expect(p.note).toBe("");
  });

  it("never promises a band on a procedure-only check", () => {
    expect(PROCEDURE_ONLY_NOTE).toMatch(/not a band/i);
    expect(PROCEDURE_ONLY_NOTE).toMatch(/does not say whether any of it actually happens/i);
  });
});

describe("a procedure check answers a different question, in different words", () => {
  it("never says Complies about a run that read no records", () => {
    for (const v of Object.values(PPD_PLAIN_VERDICT)) {
      expect(v.label).not.toMatch(/complies|comply/i);
    }
    expect(PPD_PLAIN_VERDICT.Adequate.label).toBe("Documented");
    expect(PPD_PLAIN_VERDICT.Partial.label).toBe("Partly documented");
    expect(PPD_PLAIN_VERDICT["Not documented"].label).toBe("Not documented");
  });

  it("keeps Could not check neutral here too", () => {
    expect(PPD_PLAIN_VERDICT["Not assessed"].label).toBe("Could not check");
    expect(PPD_PLAIN_VERDICT["Not assessed"].tone).toBe("neutral");
    expect(PPD_PLAIN_VERDICT["Not assessed"].isGap).toBe(false);
  });

  it("copies the procedure pass's rows rather than inventing any", () => {
    const [r] = toProcedureRows([ppdRow({ requirementText: "Do the thing.", shortComment: "Clause 4." })]);
    expect(r.requirement).toBe("Do the thing.");
    expect(r.ref).toBe("5.4.1.DS1");
    expect(r.label).toBe("Documented");
  });

  it("takes the fix from the suggested rewrite only, never writing one", () => {
    expect(toProcedureRows([ppdRow({ verdict: "Not documented", suggestedRewrite: "Add a clause naming the reviewer." })])[0].fix)
      .toBe("Add a clause naming the reviewer.");
    expect(toProcedureRows([ppdRow({ verdict: "Not documented" })])[0].fix).toBe("");
  });

  it("translates an unjudged procedure line the same way as the evidence one", () => {
    const [r] = toProcedureRows([ppdRow({
      verdict: "Not assessed",
      fullComment: "Not assessed — the run was stopped before this requirement line was reviewed. Re-run the PPD review to assess it.",
    })]);
    expect(r.why).toMatch(/stopped before/i);
    expect(r.why).not.toMatch(/PPD/);
  });
});

describe("a procedure-only download says so", () => {
  const rows = toProcedureRows([ppdRow({ verdict: "Not documented" })]);
  it("puts the procedure-only note in the CSV where the band would be", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" }, "procedure-only");
    expect(csv).toContain("not a band");
    expect(csv).not.toContain("No band yet for this area.");
    expect(csv).toContain(SELF_CHECK_DISCLAIMER);
  });
  it("marks the printable copy in its own title", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "5.4 Student Learning", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "procedure-only",
    });
    expect(html).toContain("written procedure only");
    expect(html).toContain("not documented");
    expect(html).not.toContain("does not comply");
  });
});

// An earlier check downloaded before it is replaced. There is no self-check
// band to have lost: this page derives none, so the document says what every
// self-check document says. The auditor's committed band is a stored fact and
// still travels.
describe("downloading an earlier check", () => {
  const rows = toSelfCheckRows([row({ verdict: "Met" })]);

  it("states on the band line that the check gives no band", () => {
    expect(bandLineOf({ kind: "none" })).toBe(NO_BAND_LINE);
    expect(NO_BAND_LINE).toMatch(/Approach and Processes/);
    expect(NO_BAND_LINE).toMatch(/your audit lead assesses all four/);
  });

  it("puts that sentence in the CSV where the band would be", () => {
    const csv = buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" });
    expect(csv).toContain(NO_BAND_LINE);
    expect(csv).toContain(SELF_CHECK_DISCLAIMER);
  });

  it("puts it in the printable copy too", () => {
    const html = buildSelfCheckHtml({
      areaLabel: "5.4 Student Learning", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x",
    });
    expect(html).toContain("This check gives no band");
  });

  it("still reports a band that WAS saved, because the auditor's one survives", () => {
    expect(bandLineOf({ kind: "auditor", band: 3, name: "Meeting Expectation", totalPct: 60 }))
      .toContain("Band set by your auditor");
  });
});

// The engine's zero-evidence branch (agentRuntime.ts:3550-3553) sends BOTH a
// real "PPD Partial" judgement and an absent "PPD Not assessed" one down the
// same `else verdict = "Partial"`. A real run on 6.1 surfaced the second as
// "Partly complies", which turns two absences into a partial pass.
describe("an unjudged pair is never shown as a partial pass", () => {
  const unjudged = row({ verdict: "Partial", ppdVerdict: "Not assessed", evidenceChunkIds: [] });

  it("detects the case: no PPD judgement and nothing cited from the records", () => {
    expect(unjudgedBothSides(unjudged)).toBe(true);
  });

  it("shows it as Could not check, not Partly complies", () => {
    const [r] = toSelfCheckRows([unjudged]);
    expect(r.label).toBe("Could not check");
    expect(r.tone).toBe("neutral");
  });

  it("counts it as could-not-check, so the tally agrees with the label", () => {
    const c = countSelfCheck(toSelfCheckRows([unjudged]));
    expect(c.couldNotCheck).toBe(1);
    expect(c.partly).toBe(0);
  });

  // PPD "Partial" IS a judgement, so capping the line at Partial is defensible
  // and must be left exactly as the engine decided it.
  it("leaves a genuine PPD Partial alone", () => {
    const real = row({ verdict: "Partial", ppdVerdict: "Partial", evidenceChunkIds: [] });
    expect(unjudgedBothSides(real)).toBe(false);
    expect(toSelfCheckRows([real])[0].label).toBe("Partly complies");
  });

  it("leaves a Partial that the records DID support alone", () => {
    const supported = row({ verdict: "Partial", ppdVerdict: "Not assessed", evidenceChunkIds: ["C001"] });
    expect(unjudgedBothSides(supported)).toBe(false);
    expect(toSelfCheckRows([supported])[0].label).toBe("Partly complies");
  });
});

describe("engine jargon never reaches the Why column", () => {
  const ENGINE_ZERO_EXTRACTION =
    'It was not evident that the PEI had implemented this requirement, in accordance with its documented PPD. ' +
    'The extraction pass read every provided evidence document and returned no candidate passage for this line (0 extracted). PPD verdict was "Not assessed".';

  it("translates the zero-extraction evidence comment", () => {
    const out = plainWhy(ENGINE_ZERO_EXTRACTION);
    expect(out).toContain("Nothing in your records spoke to this requirement");
    expect(out).not.toMatch(/extraction|0 extracted|PPD|PEI|candidate passage/i);
  });

  it("drops the trailing PPD verdict, which belongs in the procedure view", () => {
    expect(plainWhy(ENGINE_ZERO_EXTRACTION)).not.toMatch(/Not assessed|verdict/i);
  });

  it("reaches the rendered row, not just the helper", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", comment: ENGINE_ZERO_EXTRACTION })]);
    expect(r.why).toContain("Nothing in your records");
  });
});

describe("a gap with nothing found still gets an honest first step", () => {
  it("replaces silence with the one thing the row itself proves", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", evidenceChunkIds: [], suggestedAction: undefined })]);
    expect(r.fix).toBe(NO_EVIDENCE_FIRST_STEP);
    expect(r.fix).toMatch(/keep a record of it happening/);
  });

  it("never overwrites a fix the engine did produce", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", evidenceChunkIds: [], suggestedAction: "Add dates to the register." })]);
    expect(r.fix).toBe("Add dates to the register.");
  });

  it("stays silent on a Met row, which needs no fix", () => {
    expect(toSelfCheckRows([row({ verdict: "Met", evidenceChunkIds: [] })])[0].fix).toBe("");
  });

  // A gap the engine DID reason about and still said nothing about should not
  // be handed generic advice in place of its own silence.
  it("stays silent on a gap where records WERE found", () => {
    expect(toSelfCheckRows([row({ verdict: "Not met", evidenceChunkIds: ["C001"] })])[0].fix).toBe("");
  });
});

describe("the records-only view reports what the records pass found, and nothing more", () => {
  it("says records were found when the row cited one", () => {
    const [r] = toRecordsRows([row({ verdict: "Met", evidenceChunkIds: ["C001"], evidenceSummary: "The log shows this." })]);
    expect(r.label).toBe("Records found");
    expect(r.why).toBe("The log shows this.");
  });

  it("says nothing was found when the row cited none", () => {
    const [r] = toRecordsRows([row({ verdict: "Not met", evidenceChunkIds: [] })]);
    expect(r.label).toBe("No records found");
    expect(r.why).toMatch(/none of them mentioned this requirement/);
  });

  it("says could not check rather than guessing, on a row nothing was decided for", () => {
    expect(toRecordsRows([row({ assessmentFailed: true })])[0].label).toBe("Could not check");
    expect(toRecordsRows([row({ verdict: "Not assessed", evidenceChunkIds: [] })])[0].label).toBe("Could not check");
  });

  // The pair that the OVERALL view has to call "Could not check" is not unknown
  // on this side: the procedure half is what could not be decided, and the
  // records half read everything and found nothing.
  it("still reports the records half of an unjudged pair", () => {
    const r = row({ verdict: "Partial", ppdVerdict: "Not assessed", evidenceChunkIds: [] });
    expect(toRecordsRows([r])[0].label).toBe("No records found");
    expect(toSelfCheckRows([r])[0].label).toBe("Could not check");
  });

  // The combined verdict is a PPD-plus-evidence judgement, so it must not leak
  // into a view that claims to describe the records alone.
  it("does not inherit the combined verdict's label", () => {
    const [r] = toRecordsRows([row({ verdict: "Partial", ppdVerdict: "Adequate", evidenceChunkIds: [] })]);
    expect(r.label).toBe("No records found");
    expect(r.label).not.toBe("Partly complies");
  });
});

describe("the two passes are separable, and each is counted in its own words", () => {
  it("puts every requirement in one of the four combinations", () => {
    expect(combinationOf(row({ ppdVerdict: "Adequate", evidenceChunkIds: ["C001"] }))).toBe("both");
    expect(combinationOf(row({ ppdVerdict: "Partial", evidenceChunkIds: [] }))).toBe("written-only");
    expect(combinationOf(row({ ppdVerdict: "Not documented", evidenceChunkIds: ["C002"] }))).toBe("records-only");
    expect(combinationOf(row({ ppdVerdict: "Not documented", evidenceChunkIds: [] }))).toBe("neither");
  });

  // A missing judgement on either side is its own answer. Folding it into one
  // of the four would be the same defect as reporting an unjudged pair as a
  // partial pass.
  it("reports an unknown side as unknown rather than picking a combination", () => {
    expect(combinationOf(row({ ppdVerdict: "Not assessed", evidenceChunkIds: [] }))).toBe("unknown");
    expect(combinationOf(row({ ppdVerdict: "Adequate", assessmentFailed: true, evidenceChunkIds: ["C001"] }))).toBe("unknown");
  });

  it("counts them all, and the counts add up to the rows", () => {
    const rows = [
      row({ ppdVerdict: "Adequate", evidenceChunkIds: ["C001"] }),
      row({ ppdVerdict: "Adequate", evidenceChunkIds: [] }),
      row({ ppdVerdict: "Not documented", evidenceChunkIds: [] }),
      row({ ppdVerdict: "Not assessed", evidenceChunkIds: [] }),
    ];
    const c = countCombinations(rows);
    expect(c).toEqual({ both: 1, "written-only": 1, "records-only": 0, neither: 1, unknown: 1 });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(rows.length);
    for (const k of Object.keys(c)) expect(COMBINATION_LABEL[k as keyof typeof COMBINATION_LABEL]).toBeTruthy();
  });

  // The records pass never produced a middle state, so no view may offer one:
  // "partly evidenced" would be a judgement nobody made.
  it("gives the records view no 'partly' bucket", () => {
    expect(VIEW_TALLY.records.partly).toBeNull();
    expect(VIEW_TALLY.overview.partly).toBe("partly complies");
    expect(VIEW_TALLY.procedure.partly).toBe("partly documented");
  });

  // The run that never opened a record and the procedure half of a full run
  // read the same, and must not: only one of them is missing its other half.
  it("keeps the procedure-only note separate from the procedure tab's", () => {
    expect(VIEW_NOTE["procedure-only"]).toBe(PROCEDURE_ONLY_NOTE);
    expect(VIEW_NOTE.procedure).not.toBe(PROCEDURE_ONLY_NOTE);
    // Each half points at its counterpart BY NAME, so a reader does not have
    // to count tabs to find the other answer.
    expect(VIEW_NOTE.procedure).toContain(`${VIEW_LABEL.records} tab`);
    expect(VIEW_NOTE.records).toContain(`${VIEW_LABEL.procedure} tab`);
    expect(VIEW_NOTE.overview).toBe("");
  });

  it("exports each view in that view's own words, with no band on half an answer", () => {
    const rows = toRecordsRows([row({ verdict: "Not met", evidenceChunkIds: [] })]);
    const csv = buildSelfCheckCsv("6.1 Internal Assessment", rows, { kind: "none" }, "records");
    expect(csv).toContain("No records found");
    expect(csv).toContain(VIEW_NOTE.records);
    expect(csv).not.toContain("No band yet for this area.");
    const html = buildSelfCheckHtml({
      areaLabel: "6.1 Internal Assessment", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "records",
    });
    expect(html).toContain(VIEW_LABEL.records);
    expect(html).toContain("no records found");
    // The records view has no middle state, so the tally must not offer one.
    expect(html).not.toContain("partly complies");
  });

  // The overall view is the historic export, byte for byte: the tabs are added
  // beside it, they do not rewrite what a previous download looked like.
  it("leaves the overall export exactly as it was", () => {
    const rows = toSelfCheckRows([row({})]);
    expect(buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" }, "overview"))
      .toBe(buildSelfCheckCsv("5.4 Student Learning", rows, { kind: "none" }));
    const base = { areaLabel: "5.4 Student Learning", areaDescription: "d", counts: countSelfCheck(rows), band: { kind: "none" } as const, rows, ranAt: "x" };
    expect(buildSelfCheckHtml({ ...base, view: "overview" })).toBe(buildSelfCheckHtml(base));
  });
});

describe("an unjudged pair explains both halves, not just the records", () => {
  // The engine's comment for this row is about the records alone, so under a
  // "Could not check" verdict it read as a definite finding the page then
  // refused to act on.
  it("names the procedure half as well", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Partial", ppdVerdict: "Not assessed", evidenceChunkIds: [], comment: "It was not evident that the PEI had implemented this requirement. The extraction pass read every provided evidence document and returned no candidate passage for this line (0 extracted)." })]);
    expect(r.label).toBe("Could not check");
    expect(r.why).toBe(UNJUDGED_BOTH_SIDES_WHY);
    expect(r.why).toContain("written procedure");
    expect(r.why).toContain("records");
  });

  // A records-side gap the procedure pass DID judge keeps the engine's own
  // translated reason: only the pair with nothing on either side changes.
  it("leaves a judged-procedure gap with its own reason", () => {
    const [r] = toSelfCheckRows([row({ verdict: "Not met", ppdVerdict: "Adequate", evidenceChunkIds: [], comment: "The extraction pass read every provided evidence document and returned no candidate passage for this line (0 extracted)." })]);
    expect(r.why).not.toBe(UNJUDGED_BOTH_SIDES_WHY);
    expect(r.why).toContain("Nothing in your records spoke to this requirement");
  });
});

// Which unjudged note applies. The screen and both exports ask this one
// function, so a run with nothing unjudged cannot end up carrying a paragraph
// about "Could not check" on one surface and not the other.
describe("unjudgedNoteFor", () => {
  const counts = (couldNotCheck: number, total: number) =>
    ({ complies: total - couldNotCheck, partly: 0, doesNot: 0, couldNotCheck, total });

  it("says nothing at all when nothing came back unjudged", () => {
    expect(unjudgedNoteFor(counts(0, 6))).toBe("");
  });

  it("explains the count when a few lines are unjudged", () => {
    expect(unjudgedNoteFor(counts(1, 6))).toBe(COULD_NOT_CHECK_NOTE);
  });

  it("switches to the whole-run note when most of the run is unjudged", () => {
    expect(unjudgedNoteFor(counts(6, 6))).toBe(MOSTLY_UNCHECKED_NOTE);
  });
});
