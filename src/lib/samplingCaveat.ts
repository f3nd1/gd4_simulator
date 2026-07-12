// The sampling-basis caveat — the app's version of ISO 19011's closing-meeting
// rule that audit conclusions rest on a sample "not necessarily fully
// representative" of the whole. Here the "sample" is the set of files the
// user actually provided: the engines read everything given to them, but
// they cannot see records that were never uploaded, and every result/export
// must say so rather than read as a verdict on the institution's full records.
// One builder so the sentence is identical on run results, findings and
// CSV/PDF exports.

export function samplingCaveat(fileCount: number | undefined, runAtISO: string | undefined): string {
  const n = typeof fileCount === "number" && fileCount > 0 ? `the ${fileCount} file${fileCount === 1 ? "" : "s"}` : "the files";
  const d = runAtISO ? new Date(runAtISO) : undefined;
  const date = d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : undefined;
  return `Assessed only ${n} provided${date ? ` on ${date}` : ""}. Conclusions do not cover records that were not uploaded.`;
}

// Findings-register variant: a finding doesn't carry its run's file count, so
// the register states the principle rather than a number.
export const FINDINGS_SAMPLING_CAVEAT =
  "Findings reflect only the records provided at the time of each audit run — they say nothing about records that were never uploaded.";
