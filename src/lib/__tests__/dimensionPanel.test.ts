import { describe, it, expect } from "vitest";
import {
  bandGraphic, bandGraphicSvg, SCREEN_BAND_PALETTE,
  PROCEDURE_FEEDS, OVERALL_FEEDS, RECORDS_FEEDS,
  DIMENSION_TAB_TAG, DIMENSION_TAB_SOURCE,
  segmentBandText, segmentDetailText,
  type BandWorking,
} from "../selfCheckBanding";
import { feedsFor } from "../selfCheck";

const working = (): BandWorking => ({
  maxPct: 25,
  rows: [
    { key: "approach", label: "Approach", pct: 15, band: 3, assessedHere: true, checkedHere: true },
    { key: "processes", label: "Processes", pct: 20, band: 4, assessedHere: true, checkedHere: true },
    { key: "systemsOutcomes", label: "Systems & Outcomes", pct: 10, band: 2, assessedHere: true, checkedHere: true },
    { key: "review", label: "Review", pct: 5, band: 1, assessedHere: true, checkedHere: true },
  ],
} as unknown as BandWorking);

const svgFor = (feeds?: typeof PROCEDURE_FEEDS) =>
  bandGraphicSvg(bandGraphic(working()), SCREEN_BAND_PALETTE, feeds ? { feeds } : { minWidth: 380 });
const ARROW = "← this tab";
const heightOf = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);

describe("each tab marks the dimension it actually feeds", () => {
  // Approach is written from the PROCEDURE verdict; Processes from the
  // COMBINED verdict, which is what the Overall tab shows. The marker used to
  // sit on Records and not on Overall, which was wrong in both directions.
  it("Procedure marks Approach", () => {
    expect(feedsFor("procedure")).toBe(PROCEDURE_FEEDS);
    expect(PROCEDURE_FEEDS.key).toBe("approach");
  });

  it("Overall marks Processes, where it used to mark nothing", () => {
    expect(feedsFor("overview")).toBe(OVERALL_FEEDS);
    expect(OVERALL_FEEDS.key).toBe("processes");
    expect(svgFor(OVERALL_FEEDS)).toContain(ARROW);
  });

  it("Records marks NOTHING, because it feeds nothing on its own", () => {
    expect(feedsFor("records")).toBe(RECORDS_FEEDS);
    expect(RECORDS_FEEDS.key).toBeUndefined();
    // No arrow, but it still explains itself rather than going silent.
    expect(svgFor(RECORDS_FEEDS)).not.toContain(ARROW);
    expect(RECORDS_FEEDS.caption).toMatch(/one half/i);
    expect(RECORDS_FEEDS.caption).toMatch(/Overall tab/);
  });

  it("draws exactly one arrow when a tab feeds a dimension, and none otherwise", () => {
    for (const f of [PROCEDURE_FEEDS, OVERALL_FEEDS]) {
      expect(svgFor(f).split(ARROW).length - 1, f.key).toBe(1);
    }
    expect(svgFor().includes(ARROW)).toBe(false);
  });
});

describe("the rows carry the band, not a paragraph", () => {
  it("no longer prints the source sentence under every dimension", () => {
    const svg = svgFor(OVERALL_FEEDS);
    for (const sentence of Object.values(DIMENSION_TAB_SOURCE)) {
      // The sentences live on, behind the panel's info control; they must not
      // be drawn on the rows, which is what doubled the panel's height.
      expect(svg).not.toContain(sentence);
    }
    expect(svg).not.toContain("a second look at those same documents");
  });

  it("tags only the two dimensions no tab feeds, in three words", () => {
    expect(DIMENSION_TAB_TAG.approach).toBe("");
    expect(DIMENSION_TAB_TAG.processes).toBe("");
    expect(DIMENSION_TAB_TAG.systemsOutcomes).toBe("separate read");
    expect(DIMENSION_TAB_TAG.review).toBe(DIMENSION_TAB_TAG.systemsOutcomes);
    expect(DIMENSION_TAB_TAG.systemsOutcomes.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("keeps the full sentences exported for the info control", () => {
    expect(DIMENSION_TAB_SOURCE.approach).toMatch(/Procedure tab/);
    expect(DIMENSION_TAB_SOURCE.processes).toMatch(/Overall tab/);
    expect(DIMENSION_TAB_SOURCE.systemsOutcomes).toMatch(/second look/);
  });

  it("gives the band its own weight, and is shorter for it", () => {
    const svg = svgFor(OVERALL_FEEDS);
    expect(svg).toMatch(/font-size:13px;font-weight:800[^"]*">Band 3</);
    expect(heightOf(svg)).toBeLessThan(138);   // 138 was the height with the sentences
  });
});

describe("the split band text still says what the one-line version said", () => {
  it("recombines exactly, so the picture and the exports agree", () => {
    for (const seg of bandGraphic(working()).segments) {
      expect(`${segmentBandText(seg)} ${segmentDetailText(seg)}`.trim())
        .toBe(`Band ${seg.band} of 5 · ${seg.pct}% of ${seg.max}%`);
    }
  });

  it("says not-assessed rather than a band when the dimension was not judged", () => {
    const seg = { ...bandGraphic(working()).segments[0], assessedHere: false };
    expect(segmentBandText(seg)).toBe("not assessed");
    expect(segmentDetailText(seg)).toBe("by this check");
  });
});
