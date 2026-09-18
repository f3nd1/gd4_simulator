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

// Said INSTEAD when the optional results-and-review folder was linked and read.
// The dimension still carries no band here — that decision is separate and is
// deliberately not taken by this page — but "not assessed" would be untrue once
// the pass has read a folder and reported what it found.
export const DIMENSION_SOURCE_CHECKED: Partial<Record<BandDimensionRow["key"], string>> = {
  systemsOutcomes: "Checked against your results and review folder. What it found is below. It is not turned into a band here.",
  review: "Checked against your results and review folder. What it found is below. It is not turned into a band here.",
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

// The counterpart to TWO_DIMENSIONS_NOTE for a run that read the third folder.
export const THREE_FOLDERS_NOTE =
  "This check read your written procedure, your records, and your results and review records. It still gives no overall band: turning four dimensions into one band is your audit lead's judgement, not this page's. What the results and review check found is reported below, requirement by requirement for Review, and as a whole for Systems & Outcomes.";

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

// Which dimension a tab's own verdicts feed, per optionAChecklistWrite.ts:31-41:
// Approach is written from the PROCEDURE verdict (row.ppdVerdict) and Processes
// from the COMBINED verdict (row.verdict). So the procedure tab feeds Approach
// outright, while the records tab is one HALF of what becomes Processes — the
// other half is the procedure verdict. The captions say which, because a tab
// that claimed to produce a dimension on its own would be overstating itself.
export type TabFeeds = { key: BandDimensionRow["key"]; caption: string };

export const PROCEDURE_FEEDS: TabFeeds = {
  key: "approach",
  caption: "This tab's verdicts are what Approach is judged on. The other three dimensions are not this tab's to answer.",
};

export const RECORDS_FEEDS: TabFeeds = {
  key: "processes",
  caption: "Processes is judged on the combined verdict shown on the Overall tab. This tab is one half of that: the other half is what your written procedure says.",
};

export function bandGraphicSvg(g: BandGraphic, p: BandPalette, opts: { idSuffix?: string; minWidth?: number; feeds?: TabFeeds } = {}): string {
  // Name, then words, then bar. The words ARE the content and the bar only
  // pictures them, so on a phone the part that scrolls off the right edge is
  // the decoration rather than the meaning. With the bar last the drawing was
  // also unreadable at a phone's width when the words sat beyond it.
  // Deliberately small. These two pictures orient the auditor; the findings
  // table is the content, and at the previous size the panel pushed it below
  // the fold. The type sits at the page's own scale (11px/10px) rather than
  // above every other heading on it.
  const VX = 132, AX = 280, TW = 140, ROW = 17, TOP = 34, BARH = 9;
  const W = AX + TW + (opts.feeds ? 66 : 8);
  const H = TOP + g.segments.length * ROW + 4;
  const hatchId = `scHatch${opts.idSuffix ?? ""}`;
  const t = (xx: number, yy: number, cls: string, txt: string) => `<text x="${xx}" y="${yy}" style="${cls}">${esc(txt)}</text>`;
  const TITLE = `font-size:11px;font-weight:700;fill:${p.ink}`;
  const NAME = `font-size:10.5px;fill:${p.ink}`;
  const SMALL = `font-size:10px;fill:${p.mute}`;
  const max = g.segments[0]?.max ?? 25;
  const judged = g.segments.filter((s) => s.assessedHere).map((s) => s.label);

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block;max-width:${W}px;${opts.minWidth ? `min-width:${opts.minWidth}px;` : ""}height:auto;font-family:inherit"
  aria-label="${opts.feeds ? `Which dimension this tab feeds: ${esc(g.segments.find((s) => s.key === opts.feeds!.key)?.label ?? "")}. ${esc(opts.feeds.caption)} ` : "What this check assessed, by dimension. "}${esc(g.segments.map((s) => `${s.label}: ${segmentText(s)}`).join(". "))}. No overall band is given.">
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" style="fill:${p.surface};stroke:${p.edge}"/>
  <defs>
    <pattern id="${hatchId}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" style="fill:${p.hatchBg}"/>
      <line x1="0" y1="0" x2="0" y2="7" style="stroke:${p.hatchLine}" stroke-width="3"/>
    </pattern>
  </defs>
  ${t(10, 14, TITLE, `${judged.length} of the ${g.segments.length} EduTrust dimensions ${judged.length === 1 ? "was" : "were"} judged here`)}
  ${/* Kept short: the rows below already name which two were judged, and with
       the names prefixed as well the line ran off the right edge of the
       drawing and lost "not added up into a band", which is the honest part. */ ""}
  ${t(10, 27, SMALL, `out of the ${max}% each can earn · not added up into a band`)}
  ${g.segments.map((seg, i) => {
    const y = TOP + i * ROW;
    // Unassessed: the WHOLE track is hatched, which reads as unknown. An empty
    // track would read as a score of zero, which is the claim being refused.
    const fill = seg.assessedHere
      ? `<rect x="${AX}" y="${y}" width="${(seg.pct / seg.max) * TW}" height="${BARH}" rx="2" style="fill:${p.on}"/>`
      : `<rect x="${AX}" y="${y}" width="${TW}" height="${BARH}" rx="2" fill="url(#${hatchId})"/>`;
    // The marker is a word as well as a position, so which dimension the tab
    // feeds survives greyscale and a screen reader.
    const fed = opts.feeds?.key === seg.key;
    return `${t(10, y + 8, fed ? `${NAME};font-weight:700` : NAME, seg.label)}
      ${t(VX, y + 8, SMALL, segmentText(seg))}
      <rect x="${AX}" y="${y}" width="${TW}" height="${BARH}" rx="2" style="fill:${p.track}"/>
      ${fill}
      ${fed ? t(AX + TW + 6, y + 8, `font-size:10px;font-weight:700;fill:${p.ink}`, "\u2190 this tab") : ""}`;
  }).join("")}
</svg>`;
}

// ── The shape of the verdicts on one tab, drawn ──────────────────────────
//
// The counts are already printed in words above the table. This draws the SAME
// four numbers as one proportional bar so the shape of the result is legible
// before a single row is read. It is a picture of the tally and nothing more:
// no weighting, no score, no inference. Each band carries its own count and
// its own label in the tab's vocabulary, so it reads in greyscale.
export type TallySlice = { label: string; n: number; tone: "good" | "medium" | "critical" | "neutral" };

// The SAME four tones the verdict badges under the bar use, so the bar reads
// as those badges counted up rather than as a second colour language. Literal
// hexes, not theme variables: they have to be legible on white paper and on a
// dark card, and they must never invert between the bar and the badges.
// Colour never carries the meaning on its own — each slice has a swatch, a
// count and its label in words underneath.
const TALLY_FILL: Record<TallySlice["tone"], string> = {
  good: "#16a34a", medium: "#d97706", critical: "#dc2626", neutral: "#94a3b8",
};

// The heading over the bar. It used to read "The shape of this tab, 8
// requirement lines", which names the axis rather than the finding, and on a
// run where every line came out the same way it sat over a single block of one
// colour saying nothing at all.
//
// It now leads with the WORST state that actually occurred, because that is
// what an auditor acts on, and it falls out correctly when everything lands in
// one state: "All 8 requirement lines do not comply". Counted, never inferred:
// every number and every label comes from the slices themselves.
export function tallyHeadline(slices: TallySlice[]): string {
  const shown = slices.filter((s) => s.n > 0);
  const total = shown.reduce((n, s) => n + s.n, 0);
  if (total === 0) return "";
  // Worst first: critical, then medium, then the neutral "could not check",
  // and only then the good state, which is the one case with nothing to act on.
  const order: TallySlice["tone"][] = ["critical", "medium", "neutral", "good"];
  const lead = order.map((t) => shown.find((s) => s.tone === t)).find(Boolean)!;
  // A single line keeps the tally's own third-person wording, which is already
  // singular: "All 1 requirement line partly comply" was the alternative.
  if (total === 1) return `The only requirement line ${lead.label}`;
  const lines = `${total} requirement lines`;
  if (shown.length === 1) return `All ${lines} ${verbFor(lead.label)}`;
  return `${lead.n} of ${lines} ${verbFor(lead.label)}`;
}

// The tally labels are written as third-person singular ("complies", "does not
// comply") because they caption a count. Leading a sentence with a number
// needs the plural, and only for the counts that are not already plural.
function verbFor(label: string): string {
  return label
    .replace(/^complies$/, "comply")
    .replace(/^partly complies$/, "partly comply")
    .replace(/^does not comply$/, "do not comply")
    .replace(/^documented$/, "are documented")
    .replace(/^partly documented$/, "are partly documented")
    .replace(/^not documented$/, "are not documented")
    .replace(/^records found$/, "have records")
    .replace(/^no records found$/, "have no records")
    .replace(/^could not check$/, "could not be checked");
}

export function tallyBarSvg(slices: TallySlice[], p: BandPalette): string {
  const shown = slices.filter((s) => s.n > 0);
  const total = shown.reduce((n, s) => n + s.n, 0);
  if (total === 0) return "";
  const W = 470, BX = 10, BW = W - 20, BARY = 18, BARH = 12, ROW = 13;
  const H = BARY + BARH + 8 + shown.length * ROW;
  let run = 0;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block;max-width:${W}px;min-width:300px;height:auto;font-family:inherit"
  aria-label="${esc(tallyHeadline(slices))}. ${esc(shown.map((s) => `${s.n} ${s.label}`).join(", "))}.">
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" style="fill:${p.surface};stroke:${p.edge}"/>
  ${`<text x="${BX}" y="12" style="font-size:11px;font-weight:700;fill:${p.ink}">${esc(tallyHeadline(slices))}</text>`}
  ${shown.map((s) => {
    const x = BX + (run / total) * BW, w = (s.n / total) * BW;
    run += s.n;
    return `<rect x="${x}" y="${BARY}" width="${Math.max(1, w - 1)}" height="${BARH}" style="fill:${TALLY_FILL[s.tone]}"/>`;
  }).join("")}
  ${shown.map((s, i) => {
    const y = BARY + BARH + 8 + i * ROW;
    return `<rect x="${BX}" y="${y}" width="8" height="8" rx="2" style="fill:${TALLY_FILL[s.tone]}"/>
      <text x="${BX + 13}" y="${y + 8}" style="font-size:10px;fill:${p.mute}"><tspan style="font-weight:700;fill:${p.ink}">${s.n}</tspan> ${esc(s.label)}</text>`;
  }).join("")}
</svg>`;
}
