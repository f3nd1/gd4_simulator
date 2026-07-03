// Benchmark of REAL SSG EduTrust assessment findings for UCC, used by the
// AI Calibration page (Settings → AI Calibration) to measure the app's AI
// assessments against what real assessors actually raised.
//
// ⚠ SEED DATA REQUIRED — this file is intentionally EMPTY of findings.
// The two real reports' AFI sections were not supplied when the harness was
// built, and real SSG finding text must never be invented. Paste each AFI
// from:
//   • July 2025 report: 35 AFIs (B1–B35) + 1 higher-band opportunity (C1)
//   • June 2026 report: 19 AFIs (B1–B19) + 3 higher-band (C1–C3) + 1 strength (A1)
// as one BenchmarkAFI entry each, following the template below. The
// Calibration page works as soon as entries exist — no code changes needed.

// How the finding catches its gap — used by the scoreboard to show WHICH
// kinds of gap the app's AI catches or misses (e.g. "catches 'not documented'
// gaps but misses 'not implemented per PPD' gaps").
export type BenchmarkFindingPattern =
  | "not documented in PPD"
  | "not implemented per PPD"
  | "internal contradiction"
  | "cross-document mismatch"
  | "no timeline/monitoring"
  | "other";

// Higher-band opportunities (C-series) and strengths (A-series) are kept in
// the same array, distinguished by kind, so the page can show them without
// counting them as gaps the AI should have raised.
export type BenchmarkAFIKind = "AFI" | "higher-band" | "strength";

export type BenchmarkAFI = {
  id: string;                    // e.g. "2025-B4", "2026-C1"
  year: 2025 | 2026;
  kind: BenchmarkAFIKind;
  subCriterion: string;          // e.g. "2.1" — the GD4 sub-criterion it falls under
  gd4Ref?: string;               // finer ref where inferable, e.g. "2.1.1" or "2.1.1.DS3"
  findingText: string;           // VERBATIM text from the report — never paraphrase
  findingPattern: BenchmarkFindingPattern;
  hasNamedExample: boolean;      // does the real finding cite a concrete document/date/record?
};

// TEMPLATE (copy per AFI):
// {
//   id: "2025-B1",
//   year: 2025,
//   kind: "AFI",
//   subCriterion: "1.1",
//   gd4Ref: "1.1.1",
//   findingText: "It was not evident that the PEI had …",
//   findingPattern: "not documented in PPD",
//   hasNamedExample: false,
// },
export const BENCHMARK_AFIS: BenchmarkAFI[] = [];

export function benchmarkForSubCriterion(subCriterionId: string): BenchmarkAFI[] {
  return BENCHMARK_AFIS.filter((a) => a.subCriterion === subCriterionId);
}

// Sub-criteria that appear anywhere in the benchmark — drives the page's
// selector and the over-rating sweep.
export function benchmarkSubCriteria(): string[] {
  return [...new Set(BENCHMARK_AFIS.map((a) => a.subCriterion))].sort();
}
