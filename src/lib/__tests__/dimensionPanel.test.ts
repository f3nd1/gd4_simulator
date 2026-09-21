import { describe, it, expect } from "vitest";
import {
  bandGraphic, bandGraphicSvg, SCREEN_BAND_PALETTE,
  PROCEDURE_FEEDS, OVERALL_FEEDS, RECORDS_FEEDS,
  DIMENSION_TAB_SOURCE,
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

  it("Overall names Processes, where it used to name nothing", () => {
    expect(feedsFor("overview")).toBe(OVERALL_FEEDS);
    expect(OVERALL_FEEDS.key).toBe("processes");
    // Recorded as data and said in the caption; no longer drawn as an arrow.
    expect(OVERALL_FEEDS.caption).toMatch(/Processes is judged on/);
  });

  it("Records names NOTHING, because it feeds nothing on its own", () => {
    expect(feedsFor("records")).toBe(RECORDS_FEEDS);
    expect(RECORDS_FEEDS.key).toBeUndefined();
    expect(RECORDS_FEEDS.caption).toMatch(/one half/i);
    expect(RECORDS_FEEDS.caption).toMatch(/Overall tab/);
  });

  it("draws NO arrow on any tab, including the two that feed a dimension", () => {
    for (const f of [PROCEDURE_FEEDS, OVERALL_FEEDS, RECORDS_FEEDS, undefined]) {
      expect(svgFor(f).includes(ARROW), String(f?.key)).toBe(false);
    }
  });

  it("every caption still reads as a whole sentence with no arrow beside it", () => {
    for (const f of [PROCEDURE_FEEDS, OVERALL_FEEDS, RECORDS_FEEDS]) {
      expect(f.caption, f.key).toMatch(/^[A-Z].*\.$/s);
      // Nothing in them points AT anything: they name the dimension instead.
      expect(f.caption, f.key).not.toMatch(/\u2190|this tab feeds|marked|arrow/i);
    }
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

  it("carries no per-row tag at all, on any tab", () => {
    // "separate read" repeated the caption under the panel, and "not read"
    // repeated the band column's own "not assessed by this check".
    for (const feeds of [OVERALL_FEEDS, PROCEDURE_FEEDS, RECORDS_FEEDS]) {
      // Only what is DRAWN. The Overall caption legitimately uses the words
      // "a separate read", and it is repeated into the aria-label.
      const drawn = [...svgFor(feeds).matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(" | ");
      expect(drawn).not.toContain("separate read");
      expect(drawn).not.toContain("not read");
    }
  });

  it("keeps the full sentences exported for the info control", () => {
    expect(DIMENSION_TAB_SOURCE.approach).toMatch(/Procedure tab/);
    expect(DIMENSION_TAB_SOURCE.processes).toMatch(/Overall tab/);
    expect(DIMENSION_TAB_SOURCE.systemsOutcomes).toMatch(/second look/);
  });

  it("sets every word in the rows at ONE size, and leans on weight instead", () => {
    const svg = svgFor(OVERALL_FEEDS);
    // The band was 13px against 9.5px neighbours, which read as uneven. It is
    // now uniform AND large enough to read: 10px was consistent but too small.
    // Not one size in the ROWS: one size in the whole panel, title included.
    const sizes = new Set([...svg.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
    expect([...sizes]).toEqual(["13"]);
    expect(svg).toMatch(/font-size:13px;font-weight:800[^"]*">Band 3</);
    // One line per row still. A second line under each name would put a
    // four-row panel past 200px; the sentences that used to be there did.
    expect(heightOf(svg)).toBeLessThan(160);
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
