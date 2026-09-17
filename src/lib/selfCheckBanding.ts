// How the band on the self-check page is actually reached, shown rather than
// asserted.
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
// So step 3 can be shown exactly, and step 2 cannot be shown as a sum, because
// it is not one. A single row does not carry a number into the total; it is
// evidence one dimension's diagnosis read. The page says that outright rather
// than drawing an arrow that does not exist.
import { EDUTRUST_BANDS, EDUTRUST_DIMENSIONS, bandLevel } from "../data/edutrustRubric";
import { pctForScore, finalBandFromPct, DEFAULT_APSR_SCALE, type ApsrScale } from "./checklistBanding";
import type { ApsrDimensionScore, ApsrMatrixScores, Band } from "../types";

export type BandDimensionRow = {
  key: "approach" | "processes" | "systemsOutcomes" | "review";
  label: string;
  definition: string;
  // ApsrDimensionScore, not Band: 0 is a real score here ("below Band 1", the
  // auditor example's R=0%), and it has no descriptor.
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
  total: number;
  band: Band;
  // "20% + 10% + 5% + 5% = 40%", the arithmetic written out.
  sum: string;
  // The highest total this check can reach, and the band that maps to.
  ceilingTotal: number;
  ceilingBand: Band;
};

export function buildBandWorking(
  scores: ApsrMatrixScores | undefined,
  reasons: Partial<Record<BandDimensionRow["key"], string>> = {},
  scale: ApsrScale = DEFAULT_APSR_SCALE,
): BandWorking {
  const rows: BandDimensionRow[] = EDUTRUST_DIMENSIONS.map((d) => {
    const key = d.key as BandDimensionRow["key"];
    const band = scores?.[key];
    return {
      key,
      label: d.label,
      definition: d.definition,
      band,
      pct: band === undefined ? 0 : pctForScore(band, scale),
      descriptor: band === undefined || band === 0 ? "" : bandLevel(band as Band)[key],
      reason: (reasons[key] || "").trim(),
      assessedHere: ASSESSED_HERE[key],
    };
  });
  const total = rows.reduce((n, r) => n + r.pct, 0);
  // The best this path can do: full marks on the two dimensions it reads, and
  // the lowest band on the two it does not.
  const ceilingTotal = pctForScore(5, scale) * 2 + pctForScore(1, scale) * 2;
  return {
    rows,
    total,
    band: finalBandFromPct(total, scale),
    sum: `${rows.map((r) => `${r.pct}%`).join(" + ")} = ${total}%`,
    ceilingTotal,
    ceilingBand: finalBandFromPct(ceilingTotal, scale),
  };
}

// The five bands with the descriptor for each dimension, so an auditor can see
// the ladder the result sits on rather than one asserted rung.
export const BAND_LADDER = EDUTRUST_BANDS;

export const ROWS_DO_NOT_SUM_NOTE =
  "No single requirement below carries a score into this band. Each row is evidence that one of the four dimensions was judged on: your procedure verdicts feed Approach, and your combined verdicts feed Processes. The four dimension judgements are what become percentages.";

export function ceilingNote(w: BandWorking): string {
  return `This check reads a written procedure and a set of records, so it can only assess Approach and Processes. Systems & Outcomes and Review are not assessed here and score at the bottom, which holds the total down: the highest this check can reach is ${w.ceilingTotal}%, Band ${w.ceilingBand}. A higher band is not refused, it is simply not something a self-check can establish. Your audit lead assesses those two dimensions.`;
}

export const INFERRED_THRESHOLDS_NOTE =
  "The percentages and cut-offs are internal placeholders reconstructed from a single SSG auditor's worked example, not an auditor-confirmed formula. Do not present this band as an official result.";

// What the band on screen actually covers.
//
// The band is produced for ONE requirement item: suggestBand() is called with
// itemIdsForScope(scope)[0], and the auditor's committed band is likewise the
// first item that has one. Two of the twenty-nine sub-criteria hold more than
// one item (2.2 and 4.2), and on those the number describes one item while the
// table above it describes them all. An auditor cannot tell that from the page,
// so the page says it.
//
// Labelled rather than fixed: banding every item would mean either combining
// item bands into one, which the official model does not define and which lives
// in scoring.ts, or showing a separate panel per item. Neither is proportionate
// to two sub-criteria while the band itself is under review.
export function bandCoverageNote(bandedItemId: string, allItemIds: string[]): string {
  const others = allItemIds.filter((id) => id !== bandedItemId);
  if (others.length === 0) return `This band covers requirement ${bandedItemId}, which is the only requirement item in this area.`;
  return `This band covers requirement ${bandedItemId} ONLY. This area has ${allItemIds.length} requirement items (${allItemIds.join(", ")}), and ${others.length === 1 ? `${others[0]} is` : `${others.join(", ")} are`} not in it. The requirement rows above cover all of them. Your audit lead bands each item separately.`;
}

// ── The graphic's geometry, computed here so the page, the printable page and
// the tests all draw from one place and cannot disagree about what is shown.
//
// Honesty constraint baked into the shape: the FOUR dimension percentages are a
// real sum, so they are drawn as a stacked bar that adds up. The row verdicts
// are NOT a sum and are not drawn as feeding anything. The unreachable portion
// is drawn as what it is, the part of the scale this check cannot speak to.
export type BandGraphic = {
  // One segment per dimension, in order, as percentages of the 0-100 axis.
  segments: { key: BandDimensionRow["key"]; label: string; pct: number; max: number; assessedHere: boolean; band: ApsrDimensionScore | undefined }[];
  total: number;
  ceiling: number;
  band: Band;
  // The five bands as axis stops, with the total range each covers, so the
  // scale can be drawn to the same thresholds the arithmetic uses.
  stops: { band: Band; name: string; from: number; to: number; reachable: boolean }[];
};

export function bandGraphic(w: BandWorking, scale: ApsrScale = DEFAULT_APSR_SCALE): BandGraphic {
  const [t1, t2, t3, t4] = scale.bandThresholds;
  const bounds: [number, number][] = [[0, t1], [t1, t2], [t2, t3], [t3, t4], [t4, 100]];
  return {
    segments: w.rows.map((r) => ({ key: r.key, label: r.label, pct: r.pct, max: scale.maxPctPerDimension, assessedHere: r.assessedHere, band: r.band })),
    total: w.total,
    ceiling: w.ceilingTotal,
    band: w.band,
    stops: EDUTRUST_BANDS.map((b, i) => ({
      band: b.band,
      name: b.name,
      from: bounds[i][0],
      to: bounds[i][1],
      // Reachable means the ceiling total actually LANDS in this band or above
      // it, decided by the same finalBandFromPct the arithmetic uses. Comparing
      // against the band's lower bound was off by one: a 60% ceiling touches
      // Band 4's lower edge but maps to Band 3, because each boundary falls in
      // the lower band.
      reachable: b.band <= w.ceilingBand,
    })),
  };
}
