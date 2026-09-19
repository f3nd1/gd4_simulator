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
import { pctForScore, finalBandFromPct, DEFAULT_APSR_SCALE, type ApsrScale } from "./checklistBanding";
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
  // Whether this self-check SCORES the dimension. Always false for Systems &
  // Outcomes and Review: turning what the results-and-review pass found into a
  // band is a separate decision this page does not take.
  assessedHere: boolean;
  // Whether this RUN looked at the dimension at all. Different from
  // assessedHere, and the difference is the whole point: a dimension that was
  // checked and not scored must not be described as "not assessed", and one
  // that was never looked at must not be described as checked. The two used to
  // come from one hardcoded constant, so the same row could say "not assessed"
  // in one column and "checked against your own documents" in the next.
  checkedHere: boolean;
};

// Which dimensions this page turns into a band. Approach and Processes always;
// the other two only when the results-and-review pass actually ran and read
// something, which is what `checked` carries. A dimension nobody looked at is
// never scored, because "Not evident" is the bottom of the official scale and
// scoring an absence understated a genuinely Band 4 area as Band 3 (9f63527).
const ALWAYS_SCORED: Record<BandDimensionRow["key"], boolean> = {
  approach: true, processes: true, systemsOutcomes: false, review: false,
};

// Which dimensions THIS RUN looked at. Approach and Processes always; the other
// two only when the results-and-review pass actually produced verdicts.
export type OutcomeChecked = { systemsOutcomes: boolean; review: boolean };

export const DIMENSION_SOURCE: Record<BandDimensionRow["key"], string> = {
  approach: "From your written procedure: what the Procedure tab found.",
  processes: "From your records: what the Overall tab concluded for each requirement.",
  systemsOutcomes: "Not assessed by this check. It needs outcome data your audit lead reviews separately.",
  review: "Not assessed by this check. It needs your review and improvement records, which this check does not read.",
};

// Said for the two dimensions once the results-and-review pass HAS produced
// verdicts, which is also when they are scored.
export const DIMENSION_SOURCE_CHECKED: Partial<Record<BandDimensionRow["key"], string>> = {
  systemsOutcomes: "From the second look at your own documents for results and review records. What it found is reported below.",
  review: "From the second look at your own documents for results and review records. What it found is reported below.",
};

// Where each dimension's judgement comes from, in a few words, for the matrix
// row itself. The long form below is the same fact in a sentence.
//
// It exists because the page shows three tabs and four dimensions, and a
// reader reasonably hunts for the missing two. There is no tab for them
// because there is no separate document set: the results-and-review pass
// re-reads the SAME documents. Adding a fourth tab would imply a folder that
// does not exist.
export const DIMENSION_TAB_SOURCE: Record<BandDimensionRow["key"], string> = {
  approach: "From the Procedure tab",
  processes: "From the Overall tab: procedure and records combined",
  systemsOutcomes: "From a second read of the same documents. No tab of its own",
  review: "From a second read of the same documents. No tab of its own",
};

// Said instead when the second read produced no verdicts, so the dimension was
// never scored.
export const DIMENSION_NOT_READ = "The second read produced no verdicts on this run";

// The same fact at graphic scale. The four dimensions are listed in TWO places
// (this drawing in the result hero, and the matrix in the support panel), and
// a source line on only one of them leaves the question unanswered wherever
// the reader happens to be looking.
export const DIMENSION_TAB_TAG: Record<BandDimensionRow["key"], string> = {
  approach: "from the Procedure tab",
  processes: "from the Overall tab",
  systemsOutcomes: "from a second read, no tab",
  review: "from a second read, no tab",
};
export const DIMENSION_TAG_NOT_READ = "not read on this run";

// The Earned column for a dimension this run did not look at.
export const NOT_ASSESSED_HERE = "not assessed";

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
  // Defaults to "the pass did not run", so an OLD stored result, or an export
  // built without it, says the two dimensions were not looked at rather than
  // claiming a pass that may never have happened.
  checked: OutcomeChecked = { systemsOutcomes: false, review: false },
): BandWorking {
  const rows: BandDimensionRow[] = EDUTRUST_DIMENSIONS.map((d) => {
    const key = d.key as BandDimensionRow["key"];
    const checkedHere = ALWAYS_SCORED[key] || (key === "systemsOutcomes" ? checked.systemsOutcomes : key === "review" ? checked.review : false);
    // Scored exactly when it was checked: a dimension this run looked at gets
    // its band, and one it did not gets nothing at all.
    const assessedHere = checkedHere;
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
      checkedHere,
    };
  });
  return { rows, maxPct: scale.maxPctPerDimension };
}

// ── The band, and the one condition under which this page shows one ─────────
//
// ALL FOUR dimensions must carry a real band from THIS run. That means the
// results-and-review pass ran and read something: with no pass, or a pass that
// read nothing, two of the four are missing and a total of the other two is not
// a total. It is the same gate `complete` expresses on the human APSR matrix,
// but it cannot reuse that function: apsrMatrixResult's `complete` describes a
// human-entered ApsrMatrixScores and counts a scored 0 as complete, and neither
// is true of this working. The suggester only ever returns 1 to 5, so a 0 can
// never reach here.
export type SelfCheckTotal = { band: Band; totalPct: number; maxPct: number; parts: { label: string; pct: number }[] };

export function selfCheckTotal(w: BandWorking | undefined, scale: ApsrScale = DEFAULT_APSR_SCALE): SelfCheckTotal | null {
  if (!w) return null;
  if (!w.rows.every((r) => r.assessedHere && r.band !== undefined && r.band > 0)) return null;
  const totalPct = w.rows.reduce((n, r) => n + r.pct, 0);
  return {
    band: finalBandFromPct(totalPct, scale),
    totalPct,
    maxPct: scale.maxPctPerDimension * 4,
    parts: w.rows.map((r) => ({ label: r.label, pct: r.pct })),
  };
}

// The official band's name. It lived as a private helper on the page, which is
// why the exports could not use it.
export function bandName(b: number): string {
  return EDUTRUST_BANDS.find((x) => x.band === b)?.name ?? "";
}

// The arithmetic, written out, because a band nobody can check is a number to
// be argued with rather than read.
export function selfCheckTotalWorking(t: SelfCheckTotal): string {
  return `${t.parts.map((p) => `${p.pct}%`).join(" + ")} = ${t.totalPct}% of ${t.maxPct}%`;
}

// The five bands with the descriptor for each dimension, so an auditor can read
// the two dimension bands above against the official scale. No row is marked as
// "this result": a self-check produces no overall band to mark.
export const BAND_LADDER = EDUTRUST_BANDS;

export const ROWS_DO_NOT_SUM_NOTE =
  "No single requirement below carries a score into these dimensions. Each row is evidence that a dimension was judged on: your procedure verdicts feed Approach, and your combined verdicts feed Processes. The dimension judgements are made from the rows as a whole, not counted up from them.";

// The counterpart to TWO_DIMENSIONS_NOTE for a run that assessed all four.
export const THREE_FOLDERS_NOTE =
  "This check read your written procedure and your records, then read the same documents again looking for results and review records. All four dimensions were assessed, so a band is given: it is the four percentages added up, and the arithmetic is shown beside it. It is still this tool's reading of your own documents, not an SSG result, and your audit lead sets the band that counts.";

export const NO_BAND_WITHOUT_FOUR_NOTE =
  "No band is shown for this check. A band is a total of all four dimensions, and two of them were not assessed on this run, so there is no total to give. Your audit lead assesses all four in the full audit and sets the band.";

export const TWO_DIMENSIONS_NOTE =
  "Only Approach and Processes were assessed on this run, so no band is given. Scoring the other two low for not having been looked at would understate a well-run area by one to two bands, which is exactly what a band built on half the dimensions does. Your audit lead assesses all four and sets the band.";

// Which of the two notes a result gets, read off the WORKING rather than off a
// caller's own idea of what ran. One decision, so the screen, the CSV and the
// printed page cannot disagree about whether the pass happened.
export function dimensionsNote(w: BandWorking | undefined): string {
  return w?.rows.every((r) => r.assessedHere) ? THREE_FOLDERS_NOTE : TWO_DIMENSIONS_NOTE;
}

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
  segments: { key: BandDimensionRow["key"]; label: string; pct: number; max: number; assessedHere: boolean; checkedHere: boolean; band: ApsrDimensionScore | undefined; source: string }[];
};

export function bandGraphic(w: BandWorking): BandGraphic {
  return {
    segments: w.rows.map((r) => ({ key: r.key, label: r.label, pct: r.pct, max: w.maxPct, assessedHere: r.assessedHere, checkedHere: r.checkedHere, band: r.band, source: r.checkedHere ? DIMENSION_TAB_TAG[r.key] : DIMENSION_TAG_NOT_READ })),
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
  const VX = 132, AX = 280, TW = 140, ROW = 25, TOP = 34, BARH = 9;
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
      ${/* Where this dimension's judgement came from, on the drawing itself. */ ""}
      ${t(10, y + 19, `font-size:9px;fill:${p.mute}`, seg.source)}
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

// ── The rubric matrix: four dimensions down the side, the five official bands
// across, the Guidance Document's own descriptor in every cell.
//
// One builder for the screen, the CSV and the printed page, for the same reason
// the graphic has one: three hand-written copies of a 20-cell table is three
// chances to print a descriptor against the wrong dimension. Every string in a
// cell comes from EDUTRUST_BANDS unchanged; nothing here is written out again.
//
// The states are the honesty rule made explicit. A dimension nobody looked at,
// and a dimension that was looked at but carries no band, must each read as
// themselves. Neither may land on the Band 1 cell: "No organised approach is
// evident" is a finding about the area, and an absence of assessment is not.
export type RubricCellState = "achieved" | "next" | "plain";

export type RubricMatrixRow = {
  key: BandDimensionRow["key"];
  label: string;
  definition: string;
  state: "scored" | "checked-not-scored" | "not-assessed";
  // What the row marker says instead of a highlighted cell when there is no
  // band to highlight.
  stateLabel: string;
  band: ApsrDimensionScore | undefined;
  // Where this dimension's judgement came from: a few words for the row, and
  // the full sentence for the expanded detail.
  source: string;
  sourceDetail: string;
  // The model's own reason for the band. Empty on a dimension it did not score.
  // This is the ONE thing the matrix's grid has no room for, and it is why the
  // rows open rather than the old second table existing.
  reason: string;
  cells: { band: Band; descriptor: string; state: RubricCellState }[];
};

export type RubricMatrix = {
  bands: { band: Band; name: string }[];
  rows: RubricMatrixRow[];
};

export const RUBRIC_ACHIEVED_MARK = "✓ This check";
export const RUBRIC_NEXT_MARK = "→ Next band";

export function rubricMatrix(w: BandWorking): RubricMatrix {
  return {
    bands: EDUTRUST_BANDS.map((b) => ({ band: b.band as Band, name: b.name })),
    rows: w.rows.map((r) => {
      // Scored means a band on the official 1 to 5 scale. A 0 is a real score
      // (the auditor example's R=0%) but sits below Band 1 and has no
      // descriptor, so it highlights nothing and says so in words.
      const scored = r.checkedHere && r.band !== undefined && r.band > 0;
      const state: RubricMatrixRow["state"] = !r.checkedHere
        ? "not-assessed"
        : scored ? "scored" : "checked-not-scored";
      const stateLabel = state === "not-assessed"
        ? "Not assessed by this check"
        : state === "scored"
          ? `Band ${r.band} of 5 · ${r.pct}% of ${w.maxPct}%`
          : r.band === 0
            ? "Checked, scored 0% — below Band 1, so no descriptor applies"
            : "Checked, but no band was produced";
      return {
        key: r.key,
        label: r.label,
        definition: r.definition,
        state,
        stateLabel,
        band: r.band,
        source: r.checkedHere ? DIMENSION_TAB_SOURCE[r.key] : DIMENSION_NOT_READ,
        sourceDetail: r.checkedHere ? (DIMENSION_SOURCE_CHECKED[r.key] || DIMENSION_SOURCE[r.key]) : DIMENSION_SOURCE[r.key],
        reason: r.reason,
        cells: EDUTRUST_BANDS.map((b) => ({
          band: b.band as Band,
          descriptor: b[r.key],
          state: !scored ? "plain" : b.band === r.band ? "achieved" : b.band === (r.band as number) + 1 ? "next" : "plain",
        })),
      };
    }),
  };
}

// ── What the next band needs, computed rather than narrated ────────────────
//
// The one thing a process owner actually wants from this page: how far short
// the total is, how many band steps that is, and which dimensions have the
// headroom to take them. Every part of it is derived: the shortfall from the
// configured thresholds, the target wording from the official descriptor at
// the band above, and the named requirement lines from the run's own verdicts.
// Nothing here promises a band, and nothing invents a route.
// One requirement line behind a dimension's band, carrying the run's OWN
// "What to do" for that line. The action is copied from the row the verdict
// came from and never rewritten, merged or shortened: a to-do that says
// something different from the requirement row it came from is worse than no
// to-do at all.
export type DimensionStepLine = {
  ref: string;
  // Verbatim from the row. Empty where the run recorded none, which is real:
  // on a line where extraction found nothing the judge never runs, so there is
  // no suggested action to copy.
  action: string;
  // Which pass judged it, so the page can say where the action came from.
  from: "procedure" | "combined";
  // The OTHER dimensions this same line also holds down. One fix clearing two
  // dimensions is the cheapest work on the page, and it used to be invisible.
  alsoBlocks: string[];
};

export type BandStepOption = {
  key: BandDimensionRow["key"];
  label: string;
  from: Band;
  to: Band;
  // The official descriptor at the band this step reaches, verbatim.
  descriptor: string;
  // Requirement lines from THIS run that hold this dimension down. Empty where
  // the run has no line-level source for the dimension, which is the honest
  // answer for Systems & Outcomes.
  lines: DimensionStepLine[];
};

export const NO_ACTION_RECORDED = "No action was recorded for this line on this run.";

export type NextBandRoute =
  // Fewer than four dimensions scored, so there is no total to be short of.
  | { kind: "no-total" }
  | { kind: "top"; totalPct: number }
  | {
      kind: "route";
      band: Band; nextBand: Band; nextBandName: string;
      totalPct: number; maxPct: number;
      // The total this band's range tops out at: the next band starts ABOVE it.
      thresholdPct: number;
      steps: number; stepPct: number; reachedPct: number;
      options: BandStepOption[];
    };

export function nextBandRoute(
  w: BandWorking | undefined,
  refs: Partial<Record<BandDimensionRow["key"], Omit<DimensionStepLine, "alsoBlocks">[]>> = {},
  scale: ApsrScale = DEFAULT_APSR_SCALE,
): NextBandRoute {
  const total = selfCheckTotal(w, scale);
  if (!w || !total) return { kind: "no-total" };
  if (total.band >= 5) return { kind: "top", totalPct: total.totalPct };
  const thresholdPct = scale.bandThresholds[total.band - 1];
  const stepPct = pctForScore(1, scale);
  // The next band starts ABOVE the threshold, and a total only moves in whole
  // band steps, so this is the number of steps that actually clears it. Stated
  // as steps rather than as "+1%", which is not a move this scale can make.
  const steps = Math.floor((thresholdPct - total.totalPct) / stepPct) + 1;
  const nextBand = (total.band + 1) as Band;
  return {
    kind: "route",
    band: total.band, nextBand, nextBandName: bandName(nextBand),
    totalPct: total.totalPct, maxPct: total.maxPct, thresholdPct,
    steps, stepPct, reachedPct: total.totalPct + steps * stepPct,
    // Lowest-banded dimension first: that is where the headroom is, not a
    // claim that it is the easiest work.
    options: withCrossLinks(w.rows
      .filter((r) => r.band !== undefined && r.band > 0 && r.band < 5)
      .sort((a, b) => (a.band as number) - (b.band as number))
      .map((r) => {
        const to = ((r.band as number) + 1) as Band;
        return {
          key: r.key, label: r.label, from: r.band as Band, to, descriptor: bandLevel(to)[r.key],
          lines: (refs[r.key] ?? []).map((l) => ({ ...l, alsoBlocks: [] })),
        };
      })),
  };
}

// A line that appears under more than one dimension says so on every one of
// them. Done here rather than in the refs builder because it is a fact about
// the OPTIONS actually offered: a dimension already at Band 5 is not on the
// list, so its lines are not blocking anything you can still move.
function withCrossLinks(options: BandStepOption[]): BandStepOption[] {
  const seen = new Map<string, string[]>();
  for (const o of options) for (const l of o.lines) seen.set(l.ref, [...(seen.get(l.ref) ?? []), o.label]);
  return options.map((o) => ({
    ...o,
    lines: o.lines.map((l) => ({ ...l, alsoBlocks: (seen.get(l.ref) ?? []).filter((x) => x !== o.label) })),
  }));
}

// One sentence of arithmetic, shared by the screen and both exports so they
// cannot state different shortfalls.
export function nextBandWorking(r: Extract<NextBandRoute, { kind: "route" }>): string {
  // The "any mix" claim is safe by construction: reaching one step past the
  // threshold can never exceed the ceiling, so the headroom for that many
  // steps always exists somewhere in the four.
  const spread = r.steps === 1
    ? "Any one of the dimensions below would clear it."
    : `Any ${r.steps} band steps across the dimensions below would clear it, and one dimension can move more than one band.`;
  return `Band ${r.nextBand} starts above ${r.thresholdPct}%. This check totals ${r.totalPct}% of ${r.maxPct}%. ${r.steps} band step${r.steps === 1 ? "" : "s"} of ${r.stepPct}% would reach ${r.reachedPct}%. ${spread}`;
}

export const NEXT_BAND_CAVEAT =
  "This is arithmetic on this tool's own reconstructed percentages, not a route an auditor has agreed. Moving a dimension up means meeting the official wording below in your documents and records; nothing here promises a band.";

export const NEXT_BAND_TOP_NOTE =
  "This check's own total is already at the top band, so there is no next band to work towards on its reading. That is this tool's arithmetic, not an SSG result, and your audit lead sets the band that counts.";
