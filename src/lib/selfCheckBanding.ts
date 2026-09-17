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
  ink: string; mute: string; track: string; on: string; off: string; here: string;
  hatchBg: string; hatchLine: string; line: string; surface: string; edge: string;
  onText: string; hereText: string;
};

export const SCREEN_BAND_PALETTE: BandPalette = {
  ink: "var(--g-ink)", mute: "var(--g-mute)", track: "var(--g-track)", on: "var(--g-on)",
  off: "var(--g-off)", here: "var(--g-here)", hatchBg: "var(--g-hatch-bg)", hatchLine: "var(--g-hatch-line)",
  line: "var(--g-line)", surface: "var(--g-surface)", edge: "var(--g-edge)", onText: "#fff", hereText: "#fff",
};

// Paper is white, always. A dark-mode media query must never reach the printer.
export const PRINT_BAND_PALETTE: BandPalette = {
  ink: "#1f2733", mute: "#475569", track: "#e2e8f0", on: "#6d28d9", off: "#94a3b8",
  here: "#1d4ed8", hatchBg: "#f8fafc", hatchLine: "#cbd5e1", line: "#0f172a",
  surface: "#ffffff", edge: "#e2e8f0", onText: "#fff", hereText: "#fff",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function bandGraphicSvg(g: BandGraphic, sum: string, p: BandPalette, opts: { idSuffix?: string; minWidth?: number } = {}): string {
  const W = 760, H = 264;
  // The left gutter for the dimension names: at 44 it clipped "Approach".
  const AX = 78, AW = W - AX - 16;
  const x = (pct: number) => AX + (pct / 100) * AW;
  const hatchId = `scHatch${opts.idSuffix ?? ""}`;
  let run = 0;
  const bars = g.segments.map((seg) => { const from = run; run += seg.pct; return { ...seg, from }; });
  const t = (xx: number, yy: number, cls: string, txt: string) => `<text x="${xx}" y="${yy}" style="${cls}">${esc(txt)}</text>`;
  const TITLE = `font-size:12px;font-weight:700;fill:${p.ink}`;
  const NOTE = `font-size:11px;fill:${p.mute}`;
  const SMALL = `font-size:10.5px;fill:${p.mute}`;
  const SEG = `font-size:11px;font-weight:700;fill:${p.onText}`;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block;${opts.minWidth ? `min-width:${opts.minWidth}px;` : ""}height:auto;font-family:inherit"
  aria-label="Band ${g.band} of 5. ${esc(sum)}. The highest this check can reach is ${g.ceiling} per cent.">
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" style="fill:${p.surface};stroke:${p.edge}"/>
  <defs>
    <pattern id="${hatchId}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" style="fill:${p.hatchBg}"/>
      <line x1="0" y1="0" x2="0" y2="7" style="stroke:${p.hatchLine}" stroke-width="3"/>
    </pattern>
  </defs>
  ${t(AX, 16, TITLE, "Your total, as the four dimensions add up")}
  <rect x="${AX}" y="24" width="${AW}" height="28" rx="4" style="fill:${p.track}"/>
  <rect x="${x(g.ceiling)}" y="24" width="${AW - (x(g.ceiling) - AX)}" height="28" rx="4" fill="url(#${hatchId})"/>
  ${bars.map((b) => `<rect x="${x(b.from)}" y="24" width="${Math.max(0, x(b.from + b.pct) - x(b.from))}" height="28" ${b.assessedHere ? `style="fill:${p.on}"` : `fill="url(#${hatchId})"`}/>${b.pct > 0 ? t(x(b.from) + 4, 43, SEG, `${b.pct}%`) : ""}`).join("")}
  <line x1="${x(g.ceiling)}" y1="18" x2="${x(g.ceiling)}" y2="58" style="stroke:${p.line};stroke-width:2;stroke-dasharray:3 3"/>
  ${t(AX, 70, NOTE, sum)}
  ${t(Math.min(x(g.ceiling) + 5, W - 210), 70, NOTE, `${g.ceiling}% is the most this check can reach`)}

  ${t(AX, 100, TITLE, "The five bands, and where this lands")}
  ${g.stops.map((st) => {
    const left = x(st.from), right = x(st.to), here = st.band === g.band;
    const fill = here ? `style="fill:${p.here}"` : st.reachable ? `style="fill:${p.track}"` : `fill="url(#${hatchId})"`;
    return `<rect x="${left}" y="108" width="${Math.max(1, right - left - 2)}" height="26" rx="3" ${fill}/>
      ${t(left + 5, 125, `font-size:12px;font-weight:${here ? 800 : 700};fill:${here ? p.hereText : p.ink}`, `${st.band}${here ? " <" : ""}`)}
      ${t(left + 5, 147, SMALL, st.name)}
      ${st.reachable ? "" : t(left + 5, 158, SMALL, "out of reach here")}`;
  }).join("")}

  ${t(AX, 188, TITLE, `Each dimension, out of the ${g.segments[0]?.max ?? 25}% it can earn`)}
  ${g.segments.map((seg, i) => {
    const y = 198 + i * 16, tw = AW * (seg.max / 100);
    return `${t(0, y + 9, SMALL, seg.label.split(" ")[0])}
      <rect x="${AX}" y="${y}" width="${tw}" height="11" rx="2" style="fill:${p.track}"/>
      <rect x="${AX}" y="${y}" width="${(seg.pct / seg.max) * tw}" height="11" rx="2" ${seg.assessedHere ? `style="fill:${p.on}"` : `fill="url(#${hatchId})"`}/>
      ${t(AX + tw + 6, y + 9, SMALL, `${seg.band === undefined ? "not scored" : `Band ${seg.band}`} · ${seg.pct}%${seg.assessedHere ? "" : " · not assessed here"}`)}`;
  }).join("")}
</svg>`;
}
