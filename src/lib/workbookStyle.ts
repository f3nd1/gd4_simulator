// The approved workbook's palette and type, read out of
// GD4_IQA_2026_Workbook_DRAFT.xlsx rather than chosen here. Kept in one module
// so the five sheet builders cannot drift apart, and so a future change to the
// approved file is one edit.

export const FONT = "Arial";

export const C = {
  navy: "FF1F3864",      // title bars, section bars, body text
  midBlue: "FF2E75B6",   // column headers
  paleBlue: "FFBDD7EE",  // day banners, area banners, subtitle text
  rowA: "FFDEEAF1",      // alternating body row A
  rowB: "FFEBF3FB",      // alternating body row B
  white: "FFFFFFFF",
  grey: "FFF2F2F2",      // lunch and legend rows
  greyText: "FF7F7F7F",
  amberBg: "FFFFF2CC",   // TENTATIVE strip, review days, Partly
  amberText: "FF7F6000",
  redText: "FFC00000",   // Maj NC, RPN >= 15, Not provided text
  // Activity-type colours on the Programme sheet
  selfCheck: "FFE2EFDA",
  priorityIqa: "FFF8CBAD",
  otherIqa: "FFFCE4D6",
  review: "FFFFF2CC",
  cap: "FFDDEBF7",
  closure: "FFE4DFEC",
  buffer: "FFEDEDED",
  // Status fills on the checklist
  sightedBg: "FFE2EFDA", sightedText: "FF375623",
  partlyBg: "FFFFF2CC", partlyText: "FF7F6000",
  notProvidedBg: "FFFCE4D6", notProvidedText: "FFC00000",
  notApplicableBg: "FFEDEDED", notApplicableText: "FF7F7F7F",
  // Finding-type text colours
  majNc: "FFC00000", minNc: "FFFF0000", nc: "FFFF0000", obs: "FFFF9900", ofi: "FF0070C0",
  rpnHigh: "FFC00000", rpnMid: "FFFF9900",
} as const;

// Row colour per Activity type on the Programme sheet. Matched on the leading
// words of the calendar's own Activity type, because that text is UCC's and
// will change; an unknown type falls back to plain white rather than guessing.
export function programmeFill(activityType: string): string | undefined {
  const t = (activityType || "").toLowerCase();
  if (t.startsWith("self-check")) return C.selfCheck;
  if (t.startsWith("priority iqa")) return C.priorityIqa;
  if (t.startsWith("other iqa")) return C.otherIqa;
  if (t.startsWith("ppd") || t.includes("findings review")) return C.review;
  if (t.startsWith("rectification") || t.includes("cap")) return C.cap;
  if (t.startsWith("closure")) return C.closure;
  if (t.startsWith("buffer")) return C.buffer;
  return undefined;
}

// A day belongs on the Audit Schedule only when its activity type is an IQA
// type. This is the approved file's own split and it reconciles exactly: 17
// audit days and 75 sessions, with the two timed review rows on 9 Nov staying
// on the Programme sheet.
export function isAuditDayType(activityType: string): boolean {
  return /\biqa\b/i.test(activityType || "") && !/findings review/i.test(activityType || "");
}

export const DROPDOWN = {
  status: '"Sighted,Partly,Not provided,Not applicable"',
  findingType: '"OBS,OFI,NC,Min NC,Maj NC"',
  findingStatus: '"Open,In Progress,Resolved"',
  resolved: '"✔,X"',
} as const;

// S x L, blank until both are entered. A stored number would go stale the
// moment either input changed, which is why the approved file holds a formula.
export function rpnFormula(sRef: string, lRef: string): string {
  return `IF(AND(ISNUMBER(${sRef}),ISNUMBER(${lRef})),${sRef}*${lRef},"")`;
}

export const LEGEND_CHECKLIST =
  "Status: Sighted | Partly | Not provided | Not applicable.  Sighted is not Met.     " +
  "Finding Type: OBS | OFI | NC | Min NC | Maj NC.  A nonconformity with no severity recorded is exported as Min NC.     " +
  "S = Severity, L = Likelihood (1 to 5).  RPN = S x L, calculated.";

export const LEGEND_FINDINGS =
  "One row per finding line. Repeat the Standards and Procedure on each line of the same item. " +
  "Type: OBS | OFI | NC | Min NC | Maj NC.  A nonconformity with no severity recorded is exported as Min NC.  " +
  "S = Severity, L = Likelihood (1 to 5).  RPN = S x L, calculated.  " +
  "Acknowledging a finding never changes it: an NC stays an NC.";
