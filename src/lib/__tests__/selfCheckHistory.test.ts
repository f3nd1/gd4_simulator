import { describe, it, expect } from "vitest";
import { selfCheckRuns, diffRuns, diffSummary, runTimingNote } from "../selfCheckHistory";
import { runDuration, runDurationShort, sameFolderLink, SAME_LINK_WARNING, passFileRows, fileCheckMark, toFileRows } from "../selfCheckEvidence";
import { buildSelfCheckCsv, buildSelfCheckHtml, toSelfCheckRows, countSelfCheck, tallySlices, SELF_CHECK_FILE_HEADERS } from "../selfCheck";
import { reviewShapedRows, REVIEW_FINDINGS_HEADING, REVIEW_FINDINGS_INTRO } from "../selfCheckImprove";
import { buildBandWorking, bandGraphic, bandGraphicSvg, tallyBarSvg, tallyHeadline, PRINT_BAND_PALETTE } from "../selfCheckBanding";
import { summariseRun, appendRunSummary, SELF_CHECK_RUN_LOG_CAP, type SelfCheckRunSummary } from "../selfCheckRunLog";
import { GD4_REQUIREMENTS } from "../../data/gd4Requirements";
import type { AuditFileRecord, EvidenceAssessmentResult, PPDReviewResult } from "../../types";

const ev = (over: Partial<EvidenceAssessmentResult> = {}): EvidenceAssessmentResult => ({
  subCriterionId: "6.1", rows: [], runAt: "2026-09-17T02:00:00.000Z", live: true, ...over,
} as EvidenceAssessmentResult);
const ppd = (over: Partial<PPDReviewResult> = {}): PPDReviewResult => ({
  subCriterionId: "6.1", rows: [], runAt: "2026-09-17T02:00:00.000Z", live: true, ...over,
} as PPDReviewResult);
const row = (gdRef: string, verdict: string) => ({ gdRef, verdict });

describe("previous runs are kept, and it is obvious which one you are looking at", () => {
  it("lists the current run first and the stored history behind it", () => {
    const runs = selfCheckRuns(
      ev({ runAt: "2026-09-17T05:00:00.000Z", durationMs: 74_000 }),
      [ev({ runAt: "2026-08-10T05:00:00.000Z", durationMs: 120_000 })],
      ppd({ runAt: "2026-09-17T04:58:00.000Z", durationMs: 60_000 }),
      [ppd({ runAt: "2026-08-10T04:57:00.000Z", durationMs: 30_000 })],
    );
    expect(runs.map((r) => [r.index, r.current])).toEqual([[0, true], [1, false]]);
    // A run is BOTH passes, so the headline figure is their sum.
    expect(runs[0].duration).toBe("2 minutes 14 seconds");
    expect(runs[1].duration).toBe("2 minutes 30 seconds");
    expect(runs[0].procedureDuration).toBe("1 minute 0 seconds");
    expect(runs[0].recordsDuration).toBe("1 minute 14 seconds");
  });

  // The two passes finish seconds apart and are pushed to their own arrays by
  // the same run, so they pair by POSITION. Pairing by timestamp would drift.
  it("pairs the two passes by position, not by matching timestamps", () => {
    const runs = selfCheckRuns(
      ev({ runAt: "2026-09-17T05:00:09.000Z", durationMs: 1000 }), [],
      ppd({ runAt: "2026-09-17T04:58:41.000Z", durationMs: 2000 }), [],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].procedureDuration).toBe("2 seconds");
    expect(runs[0].recordsDuration).toBe("1 second");
  });

  it("handles a procedure-only history, where there is no evidence result at all", () => {
    const runs = selfCheckRuns(undefined, undefined, ppd({ durationMs: 5000 }), [ppd({ runAt: "2026-08-01T00:00:00.000Z" })]);
    expect(runs).toHaveLength(2);
    expect(runs[0].duration).toBe("5 seconds");
  });

  // A run from before durations were recorded must say so, not show zero.
  it("says a time was not recorded rather than showing an instant run", () => {
    expect(runDuration(undefined)).toBe("");
    expect(runDuration(0)).toBe("");
    expect(runDuration(-5)).toBe("");
    expect(runDuration(Number.NaN)).toBe("");
    expect(selfCheckRuns(ev(), [], ppd(), [])[0].duration).toBe("");
  });

  // The table column is 62px wide. "2 minutes 14 seconds" wrapped to two lines
  // there and made every row 45px instead of 22px, which is what stopped ten
  // runs fitting in the box.
  it("gives the table column a form short enough not to wrap", () => {
    expect(runDurationShort(134_000)).toBe("2m 14s");
    expect(runDurationShort(45_000)).toBe("45s");
    expect(runDurationShort(500)).toBe("<1s");
    expect(runDurationShort(undefined)).toBe("");
    expect(runDurationShort(0)).toBe("");
    expect(runDurationShort(Number.NaN)).toBe("");
    // The same run, both ways: the short form never contradicts the prose one.
    const runs = selfCheckRuns(ev({ durationMs: 74_000 }), [], ppd({ durationMs: 60_000 }), []);
    expect(runs[0].duration).toBe("2 minutes 14 seconds");
    expect(runs[0].durationShort).toBe("2m 14s");
    for (const r of runs) expect(r.durationShort.length).toBeLessThanOrEqual(8);
  });

  it("reports the previous run's time as a benchmark, and judges nothing", () => {
    const runs = selfCheckRuns(ev({ durationMs: 10_000 }), [ev({ runAt: "2026-08-01T00:00:00.000Z", durationMs: 90_000 })], undefined, undefined);
    expect(runTimingNote(runs, 0)).toBe("The run before this one took 1 minute 30 seconds.");
    expect(runTimingNote(runs, 1)).toBe("");
    expect(runTimingNote(runs, 0)).not.toMatch(/slow|worse|better|degrad/i);
  });
});

describe("what changed between two runs", () => {
  const here = [row("6.1.1.DS1", "Met"), row("6.1.1.DS2", "Not met"), row("6.1.1.DS3", "Partial"), row("6.1.1.DS4", "Met")];
  const there = [row("6.1.1.DS1", "Partial"), row("6.1.1.DS2", "Partial"), row("6.1.1.DS3", "Partial"), row("6.1.1.DS5", "Met")];

  it("counts improvements and regressions from the runs' own verdicts", () => {
    const d = diffRuns(here, there);
    expect(d.improved.map((c) => c.ref)).toEqual(["6.1.1.DS1"]);
    expect(d.worsened.map((c) => c.ref)).toEqual(["6.1.1.DS2"]);
    expect(d.unchanged).toBe(1);
    expect(d.onlyHere).toEqual(["6.1.1.DS4"]);
    expect(d.onlyThere).toEqual(["6.1.1.DS5"]);
    expect(diffSummary(d)).toBe("1 improved · 1 went backwards · 1 unchanged · 1 only in this run · 1 only in the earlier run");
  });

  // "Not assessed" is neither a pass nor a fail, so a move to or from it has no
  // direction and must never be reported as an improvement or a regression.
  it("refuses to call a move to or from Not assessed a direction", () => {
    const d = diffRuns([row("a", "Met")], [row("a", "Not assessed")]);
    expect(d.improved).toEqual([]);
    expect(d.worsened).toEqual([]);
    expect(d.unchanged).toBe(1);
    const e = diffRuns([row("a", "Not assessed")], [row("a", "Not met")]);
    expect(e.improved).toEqual([]);
    expect(e.worsened).toEqual([]);
  });

  it("is empty rather than wrong when a run is missing", () => {
    expect(diffRuns(undefined, undefined)).toEqual({ improved: [], worsened: [], unchanged: 0, onlyHere: [], onlyThere: [] });
  });
});

describe("every file a pass read, tickable", () => {
  const rec = (over: Partial<AuditFileRecord> = {}): AuditFileRecord => ({
    name: "Procedure.docx", bucket: "policy", readStatus: "read", auditStatus: "pending", charCount: 1200, ...over,
  } as AuditFileRecord);

  // Merging the two ledgers here would be the same class of error as merging
  // the two passes' chunk maps: a file the records pass read is not evidence
  // the procedure pass read it.
  it("never merges the two passes, unlike the overall list which deliberately does", () => {
    const policy = [rec({ name: "Shared.docx", bucket: "policy" })];
    const evidence = [rec({ name: "Shared.docx", bucket: "evidence" })];
    expect(toFileRows(policy, evidence)).toHaveLength(1);
    expect(toFileRows(policy, evidence)[0].bucket).toBe("Both folders");
    expect(passFileRows(policy)).toHaveLength(1);
    expect(passFileRows(evidence)).toHaveLength(1);
    expect(passFileRows(policy)[0].bucket).toBe("Written procedure");
    expect(passFileRows(evidence)[0].bucket).toBe("Records");
  });

  it("gives every row a tick, a cross or a flag, never colour alone", () => {
    expect(fileCheckMark(passFileRows([rec()])[0])).toMatchObject({ mark: "✓", label: "Read" });
    expect(fileCheckMark(passFileRows([rec({ readStatus: "failed", failReason: "x" })])[0])).toMatchObject({ mark: "✗", label: "Not read" });
    expect(fileCheckMark(passFileRows([rec({ readMethod: "vision" })])[0])).toMatchObject({ mark: "!", label: "Check this one" });
  });

  it("carries the tick column into both exports", () => {
    expect(SELF_CHECK_FILE_HEADERS[0]).toBe("Read?");
    const rows = toSelfCheckRows([]);
    const files = passFileRows([rec({ name: "Broken.pdf", readStatus: "failed", failReason: "Drive read error" }), rec()]);
    const csv = buildSelfCheckCsv("6.1", rows, { kind: "none" }, "procedure", files);
    expect(csv).toContain("Every file this tab read");
    expect(csv).toContain("✗,Broken.pdf");
    expect(csv).toContain("✓,Procedure.docx");
    const html = buildSelfCheckHtml({
      areaLabel: "6.1", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "procedure", files,
    });
    expect(html).toContain("Every file this tab read");
    expect(html).toContain("<th>Read?</th>");
    expect(html).toContain("<td><b>✗</b></td>");
  });
});

describe("the same folder link in both boxes", () => {
  // Established by running it, not by reading: with one link in both boxes and
  // a folder holding the documented subfolders, BOTH passes take every file,
  // so the procedure is read as a record and the record as a procedure.
  it("is detected on the pasted links and on the stored folder", () => {
    const L = "https://drive.google.com/drive/folders/1ABC";
    expect(sameFolderLink(L, L)).toBe(true);
    expect(sameFolderLink(` ${L}/ `, `${L}?usp=sharing`)).toBe(true);
    expect(sameFolderLink(L, "https://drive.google.com/drive/folders/1XYZ")).toBe(false);
    expect(sameFolderLink("", "")).toBe(false);
    expect(sameFolderLink(undefined, L)).toBe(false);
    // Two links to ONE folder differ by a share suffix, a trailing slash or a
    // /view, and are still one folder. Comparing normalised URLs instead of
    // folder ids got "different folder" wrong and would have warned on every
    // run: caught by this test before it reached a screen.
    expect(sameFolderLink(`${L}/view`, `${L}?usp=drive_link`)).toBe(true);
    expect(sameFolderLink("https://drive.google.com/open?id=1ABC", L)).toBe(true);
    expect(sameFolderLink("not a link", "also not a link")).toBe(false);
  });

  it("warns in words that name the consequence, not just the fact", () => {
    expect(SAME_LINK_WARNING).toMatch(/SAME folder link/);
    expect(SAME_LINK_WARNING).toMatch(/written procedure AND as your records/);
    expect(SAME_LINK_WARNING).toMatch(/not because a record shows it happening/);
  });

  it("rides into both exports, above the file list", () => {
    const rows = toSelfCheckRows([]);
    const files = passFileRows([{ name: "Policy.docx", bucket: "policy", readStatus: "read", auditStatus: "pending", charCount: 10 } as AuditFileRecord]);
    const csv = buildSelfCheckCsv("6.1", rows, { kind: "none" }, "overview", files, undefined, undefined, [], "12 seconds", true);
    expect(csv).toContain("SAME folder link");
    expect(csv).toContain("This check took 12 seconds.");
    const html = buildSelfCheckHtml({
      areaLabel: "6.1", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", files, timing: "12 seconds", sameLink: true,
    });
    expect(html).toContain("SAME folder link");
    expect(html).toContain("took 12 seconds");
    // Silent when the two links differ, which is the normal case.
    expect(buildSelfCheckCsv("6.1", rows, { kind: "none" }, "overview", files)).not.toContain("SAME folder link");
  });
});

describe("what this run already found about Review", () => {
  // The one thing this check produces that bears on an unassessed dimension.
  // Measured, not asserted: 42 of the 200 official Describe/Show lines name a
  // process review, and every one of the 31 requirement items has at least one.
  it("picks the official review-shaped lines, and nothing else", () => {
    const rows = [
      { ref: "6.1.1.DS1.a", requirement: "Defining assessment scope" },
      { ref: "6.1.1.DS2", requirement: "Review the internal assessment process for continual improvement" },
      { ref: "4.1.1.DS5", requirement: "Review the pre-course counselling procedures for continual improvement" },
      { ref: "4.1.1.DS1", requirement: "Ensure counsellors are trained" },
    ];
    expect(reviewShapedRows(rows).map((r) => r.ref)).toEqual(["6.1.1.DS2", "4.1.1.DS5"]);
  });

  // Refs are joined through gd4Refs everywhere in this app, so a stored ref
  // with different spacing or case still resolves.
  it("matches through the app's own ref normalisation", () => {
    expect(reviewShapedRows([{ ref: " 6.1.1.ds2 " }]).map((r) => r.ref)).toEqual([" 6.1.1.ds2 "]);
    expect(reviewShapedRows([{ ref: "9.9.9.DS9" }])).toEqual([]);
  });

  it("covers every requirement item, which is why it is worth showing at all", () => {
    const items = new Set<string>();
    for (const r of GD4_REQUIREMENTS) {
      const refs = (r.flatAuditPoints ?? []).filter((p) => p.sourceType === "describeShow").map((p) => ({ ref: p.ref }));
      if (reviewShapedRows(refs).length > 0) items.add(r.id);
    }
    expect(items.size).toBe(GD4_REQUIREMENTS.length);
  });

  // It is NOT a band and must never read as one. Turning line verdicts into a
  // dimension verdict is scoring, and this page produces no band by any path.
  it("says in words that it is not a score and does not add up to one", () => {
    expect(REVIEW_FINDINGS_INTRO).toMatch(/not a Review score and do not add up to one/);
    expect(REVIEW_FINDINGS_INTRO).toMatch(/your audit lead/);
    expect(REVIEW_FINDINGS_HEADING).not.toMatch(/band|score/i);
    expect(REVIEW_FINDINGS_INTRO).not.toMatch(/Band \d/);
  });

  it("repeats the run's own verdicts into both exports, and invents none", () => {
    const rows = toSelfCheckRows([{
      gdRef: "6.1.1.DS2", gd4ItemId: "6.1.1", requirementText: "Review the internal assessment process for continual improvement",
      ppdExtract: "", ppdVerdict: "Adequate", evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [],
      verdict: "Not met", comment: "No review record was found.",
    } as never]);
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    const csv = buildSelfCheckCsv("6.1", rows, { kind: "none" }, "overview", [], w, undefined, ["6.1.1"]);
    expect(csv).toContain("What this run already found about Review");
    expect(csv).toContain("6.1.1.DS2,Does not comply");
    const html = buildSelfCheckHtml({
      areaLabel: "6.1", areaDescription: "d", counts: countSelfCheck(rows),
      band: { kind: "none" }, rows, ranAt: "x", view: "overview", itemIds: ["6.1.1"], bandWorking: w,
    });
    expect(html).toContain("What this run already found about Review");
    expect(html).toContain("✗ Does not comply");
    // No band anywhere near it.
    expect(html).not.toMatch(/Review[\s\S]{0,400}Band \d of 5/);
  });

  // Deliberately absent for Systems & Outcomes: the words that would catch
  // outcome lines also catch "Ensure the confidentiality and security of all
  // data", which is a process.
  it("offers nothing equivalent for Systems & Outcomes", () => {
    const rows = toSelfCheckRows([]);
    const w = buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 });
    const csv = buildSelfCheckCsv("6.1", rows, { kind: "none" }, "overview", [], w, undefined, ["6.1.1"]);
    expect(csv).not.toMatch(/already found about Systems/i);
    expect(csv).toContain("does not itemise outcome evidence");
  });
});

describe("the long tail: summaries outlive the full runs", () => {
  const sum = (at: string, over: Partial<SelfCheckRunSummary> = {}): SelfCheckRunSummary =>
    ({ at, ms: 60_000, c: 2, p: 3, d: 1, u: 0, n: 6, ...over });

  // The cap is chosen from measured bytes, not an illustration: 75 bytes per
  // summary, 150 per run across both logs, 17.8 KB per area at 120.
  it("keeps a summary small enough that the cap is not the binding constraint", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(sum("2026-09-17T22:35:56.123Z"))).length;
    expect(bytes).toBeLessThan(100);
    expect(SELF_CHECK_RUN_LOG_CAP).toBe(120);
    // Worst case across all 29 sub-criteria, both logs, against a 5 MB budget.
    const worst = bytes * 2 * SELF_CHECK_RUN_LOG_CAP * 29;
    expect(worst).toBeLessThan(0.7 * 1024 * 1024);
  });

  it("caps newest-first, and survives a log that is missing or not an array", () => {
    let log = [] as SelfCheckRunSummary[];
    for (let i = 0; i < SELF_CHECK_RUN_LOG_CAP + 5; i++) log = appendRunSummary(log, sum(`r${i}`));
    expect(log).toHaveLength(SELF_CHECK_RUN_LOG_CAP);
    expect(log[0].at).toBe(`r${SELF_CHECK_RUN_LOG_CAP + 4}`);
    expect(appendRunSummary(undefined, sum("a"))).toHaveLength(1);
    expect(appendRunSummary("corrupt" as never, sum("a"))).toHaveLength(1);
  });

  it("counts a run the same way whether it is summarised or read from its rows", () => {
    const rows = [{ gdRef: "a", verdict: "Met" }, { gdRef: "b", verdict: "Partial" }, { gdRef: "c", verdict: "Not met" }];
    const s = summariseRun("x", 1000, rows, "records");
    expect([s.c, s.p, s.d, s.u, s.n]).toEqual([1, 1, 1, 0, 3]);
    // Via selfCheckRuns, the full-result path must agree with the summary path.
    const full = selfCheckRuns(ev({ rows } as never), [], undefined, undefined)[0];
    const tail = selfCheckRuns(undefined, [], undefined, undefined, [s], [])[0];
    expect(tail.counts).toEqual(full.counts);
  });

  // A procedure-only run is counted on its PPD verdicts, mapped as
  // toProcedureRows maps them.
  it("maps a procedure-only run onto the same axis", () => {
    const s = summariseRun("x", 0, [{ verdict: "Adequate" }, { verdict: "Partial" }, { verdict: "Not documented" }, { verdict: "Not assessed" }], "procedure");
    expect([s.c, s.p, s.d, s.u, s.n]).toEqual([1, 1, 1, 1, 4]);
  });

  it("lists an aged-out run with its figures, and marks it as not openable", () => {
    const runs = selfCheckRuns(
      ev({ runAt: "2026-09-17T05:00:00.000Z", durationMs: 10_000 }), [],
      ppd({ runAt: "2026-09-17T04:59:00.000Z", durationMs: 20_000 }), [],
      [sum("2026-09-17T05:00:00.000Z", { ms: 10_000 }), sum("2026-01-01T00:00:00.000Z", { ms: 90_000, c: 5, p: 0, d: 1, u: 0, n: 6 })],
      [sum("2026-09-17T04:59:00.000Z", { ms: 20_000 }), sum("2026-01-01T00:00:00.000Z", { ms: 30_000 })],
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].openable).toBe(true);
    // Still on the timeline, with everything a comparison needs.
    expect(runs[1].openable).toBe(false);
    expect(runs[1].label).toContain("2026");
    expect(runs[1].duration).toBe("2 minutes 0 seconds");
    expect(runs[1].counts).toEqual({ complies: 5, partly: 0, doesNot: 1, couldNotCheck: 0, total: 6 });
  });

  it("prefers the full result's own figures while it still exists", () => {
    const runs = selfCheckRuns(
      ev({ runAt: "2026-09-17T05:00:00.000Z", durationMs: 10_000, rows: [{ gdRef: "a", verdict: "Met" }] } as never), [],
      undefined, undefined,
      // A summary that disagrees must never win over the run it describes.
      [sum("2026-09-17T05:00:00.000Z", { ms: 999_000, c: 99, n: 99 })], [],
    );
    expect(runs[0].counts.complies).toBe(1);
    expect(runs[0].duration).toBe("10 seconds");
  });

  it("is empty, not broken, with no logs at all", () => {
    expect(selfCheckRuns(undefined, undefined, undefined, undefined, undefined, undefined)).toEqual([]);
  });
});

describe("the bar says what the reader is looking at", () => {
  const c = (complies: number, partly: number, doesNot: number, couldNotCheck: number) =>
    ({ complies, partly, doesNot, couldNotCheck, total: complies + partly + doesNot + couldNotCheck });

  // The old heading read "The shape of this tab, 8 requirement lines", which
  // names the axis. On the reported 6.1 run every line came out the same way,
  // so it sat over one block of one colour and said nothing at all.
  it("states the finding when every line lands in one state", () => {
    expect(tallyHeadline(tallySlices(c(0, 0, 8, 0), "overview"))).toBe("All 8 requirement lines do not comply");
    expect(tallyHeadline(tallySlices(c(8, 0, 0, 0), "overview"))).toBe("All 8 requirement lines comply");
  });

  // Worst first, because that is what an auditor acts on.
  it("leads with the worst state that actually occurred", () => {
    expect(tallyHeadline(tallySlices(c(3, 2, 3, 0), "overview"))).toBe("3 of 8 requirement lines do not comply");
    expect(tallyHeadline(tallySlices(c(6, 2, 0, 0), "overview"))).toBe("2 of 8 requirement lines partly comply");
    expect(tallyHeadline(tallySlices(c(4, 0, 0, 4), "overview"))).toBe("4 of 8 requirement lines could not be checked");
  });

  // Each tab counts in its own vocabulary, and the heading has to follow it.
  it("speaks each tab's own language", () => {
    expect(tallyHeadline(tallySlices(c(0, 0, 8, 0), "procedure"))).toBe("All 8 requirement lines are not documented");
    expect(tallyHeadline(tallySlices(c(8, 0, 0, 0), "records"))).toBe("All 8 requirement lines have records");
    expect(tallyHeadline(tallySlices(c(0, 0, 8, 0), "records"))).toBe("All 8 requirement lines have no records");
  });

  it("stays grammatical on a single line, and says nothing when there is nothing", () => {
    expect(tallyHeadline(tallySlices(c(0, 1, 0, 0), "overview"))).toBe("The only requirement line partly complies");
    expect(tallyHeadline(tallySlices(c(0, 0, 0, 0), "overview"))).toBe("");
  });

  it("puts the same sentence in the drawing and in its aria-label, and no longer names the axis", () => {
    const svg = tallyBarSvg(tallySlices(c(0, 0, 8, 0), "overview"), PRINT_BAND_PALETTE);
    expect(svg).toContain("All 8 requirement lines do not comply");
    expect(svg).not.toContain("The shape of this tab");
    expect(svg).toMatch(/aria-label="All 8 requirement lines do not comply/);
  });

  // The sibling heading named its axis too.
  it("says how many dimensions were judged rather than describing the chart", () => {
    const g = bandGraphic(buildBandWorking({ approach: 2, processes: 2, systemsOutcomes: 1, review: 1 }));
    const svg = bandGraphicSvg(g, PRINT_BAND_PALETTE);
    expect(svg).toContain("2 of the 4 EduTrust dimensions were judged here");
    // The two judged dimensions are named on their own rows, not in the
    // subtitle: with them there as well the line ran off the right edge.
    expect(svg).toContain("Approach");
    expect(svg).toContain("not added up into a band");
    expect(svg).not.toContain("Each dimension on its own");
  });
});
