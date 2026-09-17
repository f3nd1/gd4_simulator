// What the self-check can honestly say about the four EduTrust dimensions, and
// what it deliberately refuses to say.
//
// The real chain, traced through the code rather than assumed:
//
//   1. Each requirement line's two verdicts are written onto a checklist line
//      (optionAChecklistWrite.ts:29-45): the PROCEDURE verdict becomes the
//      line's Approach status, the COMBINED verdict becomes its Processes
//      status, and Systems & Outcomes and Review are written "Not evident"
//      with a note saying this path did not assess them.
//   2. suggestBand() sends those lines to the model as an evidence digest, and
//      it DIAGNOSES each of the four dimensions separately against the §23
//      descriptors. Its own prompt says this is a judgement and "NOT the
//      average, sum, or any calculation" (agentRuntime.ts:428).
//   3. Only then is there arithmetic: each dimension band becomes a percentage
//      (band N → N × 5% by default), the four are summed, and the total maps to
//      the final band (checklistBanding.ts, pctForScore/finalBandFromPct).
//
// This page stops after step 2, and only for the two dimensions step 1 actually
// wrote a real status onto. It shows NO overall band from a self-check run.
//
// Why, measured against the app's own apsrMatrixResult: because S&O and Review
// are scored at the bottom for never having been opened, a self-check of an
// area that is genuinely Band 3 reads Band 2, and one that is genuinely Band 4
// or Band 5 reads Band 3. The error is one to two bands, always downward, and
// it grows with how good the area is. That is an absence of assessment
// presented as a judgement, which is the same defect as the two banding models
// this app has already removed. The auditor's OWN committed band still shows:
// that is a recorded fact about the area, not a reading of this run.
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS, bandLevel } from "../data/edutrustRubric";
import { pctForScore, DEFAULT_APSR_SCALE, type ApsrScale } from "./checklistBanding";
import type { ApsrDimensionScore, ApsrMatrixScores, Band } from "../types";

export type BandDimensionRow = {
  key: "approach" | "processes" | "systemsOutcomes" | "review";
  label: string;
  definition: string;
  // ApsrDimensionScore, not Band: 0 is a real score here ("below Band 1", the
  // auditor example's R=0%), and it has no descriptor. undefined means no score
  // at all, which is what the two unassessed dimensions always carry.
  band: ApsrDimensionScore | undefined;
  pct: number;
  // The official descriptor for THIS dimension at the band it was given,
  // verbatim from the Guidance Document.
  descriptor: string;
  reason: string;
  // Whether this self-check assessed the dimension at all.
  assessedHere: boolean;
};

// Option A writes Systems & Outcomes and Review as "Not evident" on every line
// it produces, because it reads a procedure and a set of records and nothing
// else. They are not a finding about the area; they are two dimensions this
// check does not cover.
const ASSESSED_HERE: Record<BandDimensionRow["key"], boolean> = {
  approach: true, processes: true, systemsOutcomes: false, review: false,
};

export const DIMENSION_SOURCE: Record<BandDimensionRow["key"], string> = {
  approach: "From your written procedure: what the Your written procedure tab found.",
  processes: "From your records: what the Overall tab concluded for each requirement.",
  systemsOutcomes: "Not assessed by this check. It needs outcome data your audit lead reviews separately.",
  review: "Not assessed by this check. It needs your review and improvement records, which this check does not read.",
};

export type BandWorking = {
  rows: BandDimensionRow[];
  // The configured ceiling per dimension (25% by default, tunable in
  // useScoringConfigStore). Carried on the result rather than re-derived by
  // each consumer: the exports have no access to the store, and were quietly
  // printing the DEFAULT 25% beside percentages computed from the configured
  // scale.
  maxPct: number;
};

export function buildBandWorking(
  scores: ApsrMatrixScores | undefined,
  reasons: Partial<Record<BandDimensionRow["key"], string>> = {},
  scale: ApsrScale = DEFAULT_APSR_SCALE,
): BandWorking {
  const rows: BandDimensionRow[] = EDUTRUST_DIMENSIONS.map((d) => {
    const key = d.key as BandDimensionRow["key"];
    const assessedHere = ASSESSED_HERE[key];
    // The model still returns a band for all four, diagnosed from lines that
    // say outright it did not look. Dropped HERE, at the one place the rows are
    // built, so no surface downstream can print it: a screen, a CSV or a PDF
    // that showed "Systems and outcomes are non-existent" next to a dimension
    // nobody opened would be asserting a judgement out of an absence.
    const band = assessedHere ? scores?.[key] : undefined;
    return {
      key,
      label: d.label,
      definition: d.definition,
      band,
      pct: band === undefined ? 0 : pctForScore(band, scale),
      descriptor: band === undefined || band === 0 ? "" : bandLevel(band as Band)[key],
      reason: (reasons[key] || "").trim(),
      assessedHere,
    };
  });
  return { rows, maxPct: scale.maxPctPerDimension };
}

// The five bands with the descriptor for each dimension, so an auditor can read
// the two dimension bands above against the official scale. No row is marked as
// "this result": a self-check produces no overall band to mark.
export const BAND_LADDER = EDUTRUST_BANDS;

export const ROWS_DO_NOT_SUM_NOTE =
  "No single requirement below carries a score into these dimensions. Each row is evidence that a dimension was judged on: your procedure verdicts feed Approach, and your combined verdicts feed Processes. The dimension judgements are made from the rows as a whole, not counted up from them.";

export const TWO_DIMENSIONS_NOTE =
  "This check reads a written procedure and a set of records, so it can only assess Approach and Processes. It gives no overall band. Systems & Outcomes and Review are not assessed here, and scoring them low for not having been looked at would have understated a well-run area by one to two bands. Your audit lead assesses all four and sets the band.";

export const INFERRED_THRESHOLDS_NOTE =
  "The percentages are internal placeholders reconstructed from a single SSG auditor's worked example, not an auditor-confirmed formula. Nothing on this page is an official result.";

// What the dimension assessment on screen actually covers.
//
// It is produced for ONE requirement item: suggestBand() is called with
// itemIdsForScope(scope)[0], and the auditor's committed band is likewise the
// first item that has one. Two of the twenty-nine sub-criteria hold more than
// one item (2.2 and 4.2), and on those the panel describes one item while the
// table above it describes them all. An auditor cannot tell that from the page,
// so the page says it.
//
// `subject` exists because this same note captions two different things: the
// auditor's committed band on the result card, and the dimension assessment in
// the panel below it. Naming the wrong one would misreport which is which.
export function bandCoverageNote(bandedItemId: string, allItemIds: string[], subject = "This band"): string {
  const others = allItemIds.filter((id) => id !== bandedItemId);
  if (others.length === 0) return `${subject} covers requirement ${bandedItemId}, which is the only requirement item in this area.`;
  return `${subject} covers requirement ${bandedItemId} ONLY. This area has ${allItemIds.length} requirement items (${allItemIds.join(", ")}), and ${others.length === 1 ? `${others[0]} is` : `${others.join(", ")} are`} not in it. The requirement rows above cover all of them. Your audit lead bands each item separately.`;
}

// ── The graphic's geometry, computed here so the page, the printable page and
// the tests all draw from one place and cannot disagree about what is shown.
//
// Honesty constraint baked into the shape: it draws FOUR independent dimension
// tracks and nothing else. It used to carry a stacked total bar and the
// five-band scale with the result marked on it; both are gone with the overall
// band, because a total whose bottom half was never assessed is not a total.
// An unassessed dimension is hatched across its whole track, which reads as
// unknown, rather than left empty, which reads as zero.
export type BandGraphic = {
  segments: { key: BandDimensionRow["key"]; label: string; pct: number; max: number; assessedHere: boolean; band: ApsrDimensionScore | undefined }[];
};

export function bandGraphic(w: BandWorking): BandGraphic {
  return {
    segments: w.rows.map((r) => ({ key: r.key, label: r.label, pct: r.pct, max: w.maxPct, assessedHere: r.assessedHere, band: r.band })),
  };
}

// ── The graphic itself, as one builder used by BOTH the page and the printed
// document.
//
// It was a React component drawing the SVG and a separate table in the PDF.
// The printed page is what gets filed as working paper, so it needs the
// picture more than the screen does, and two drawings of one result is exactly
// the drift this repo has been bitten by before. One builder, two palettes.
//
// The palette is passed as style values rather than classes because the
// printed document carries none of this page's CSS: the screen passes CSS
// custom properties so dark mode still works through the media query, and the
// print palette passes literal colours so paper is always light.
export type BandPalette = {
  ink: string; mute: string; track: string; on: string;
  hatchBg: string; hatchLine: string; surface: string; edge: string;
};

export const SCREEN_BAND_PALETTE: BandPalette = {
  ink: "var(--g-ink)", mute: "var(--g-mute)", track: "var(--g-track)", on: "var(--g-on)",
  hatchBg: "var(--g-hatch-bg)", hatchLine: "var(--g-hatch-line)",
  surface: "var(--g-surface)", edge: "var(--g-edge)",
};

// Paper is white, always. A dark-mode media query must never reach the printer.
export const PRINT_BAND_PALETTE: BandPalette = {
  ink: "#1f2733", mute: "#475569", track: "#e2e8f0", on: "#6d28d9",
  hatchBg: "#f8fafc", hatchLine: "#cbd5e1", surface: "#ffffff", edge: "#e2e8f0",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The words beside each track. Every state is carried in text as well as in
// pattern, so the picture survives greyscale printing and a screen reader.
function segmentText(seg: BandGraphic["segments"][number]): string {
  if (!seg.assessedHere) return "not assessed by this check";
  if (seg.band === undefined) return "not scored";
  return `Band ${seg.band} of 5 · ${seg.pct}% of ${seg.max}%`;
}

export function bandGraphicSvg(g: BandGraphic, p: BandPalette, opts: { idSuffix?: string; minWidth?: number } = {}): string {
  // Name, then words, then bar. The words ARE the content and the bar only
  // pictures them, so on a phone the part that scrolls off the right edge is
  // the decoration rather than the meaning. With the bar last the drawing was
  // also unreadable at a phone's width when the words sat beyond it.
  const VX = 144, AX = 302, TW = 170, ROW = 24, TOP = 48, BARH = 13;
  const W = AX + TW + 10;
  const H = TOP + g.segments.length * ROW + 6;
  const hatchId = `scHatch${opts.idSuffix ?? ""}`;
  const t = (xx: number, yy: number, cls: string, txt: string) => `<text x="${xx}" y="${yy}" style="${cls}">${esc(txt)}</text>`;
  const TITLE = `font-size:12.5px;font-weight:700;fill:${p.ink}`;
  const NAME = `font-size:11.5px;fill:${p.ink}`;
  const SMALL = `font-size:10.5px;fill:${p.mute}`;
  const max = g.segments[0]?.max ?? 25;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block;${opts.minWidth ? `min-width:${opts.minWidth}px;` : ""}height:auto;font-family:inherit"
  aria-label="What this check assessed, by dimension. ${esc(g.segments.map((s) => `${s.label}: ${segmentText(s)}`).join(". "))}. No overall band is given.">
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" style="fill:${p.surface};stroke:${p.edge}"/>
  <defs>
    <pattern id="${hatchId}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" style="fill:${p.hatchBg}"/>
      <line x1="0" y1="0" x2="0" y2="7" style="stroke:${p.hatchLine}" stroke-width="3"/>
    </pattern>
  </defs>
  ${t(12, 19, TITLE, "Each dimension on its own")}
  ${t(12, 34, SMALL, `out of the ${max}% it can earn · they are not added up into a band here`)}
  ${g.segments.map((seg, i) => {
    const y = TOP + i * ROW;
    // Unassessed: the WHOLE track is hatched, which reads as unknown. An empty
    // track would read as a score of zero, which is the claim being refused.
    const fill = seg.assessedHere
      ? `<rect x="${AX}" y="${y}" width="${(seg.pct / seg.max) * TW}" height="${BARH}" rx="2" style="fill:${p.on}"/>`
      : `<rect x="${AX}" y="${y}" width="${TW}" height="${BARH}" rx="2" fill="url(#${hatchId})"/>`;
    return `${t(12, y + 10, NAME, seg.label)}
      ${t(VX, y + 10, SMALL, segmentText(seg))}
      <rect x="${AX}" y="${y}" width="${TW}" height="${BARH}" rx="2" style="fill:${p.track}"/>
      ${fill}`;
  }).join("")}
</svg>`;
}
