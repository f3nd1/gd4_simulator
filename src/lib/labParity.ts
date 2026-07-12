// The ONE definition of which learned corrections feed a live assessment
// call, shared by every production run path AND the Calibration Lab's
// scratch runs — so the Lab measures the SAME prompt assembly a real run
// sends, by construction. Before this existed, the Lab passed no memories
// and no calibration examples while production runs passed both, meaning
// every consistency/A-vs-B number was measured against a different pipeline
// than the one users actually run.
//
// Pure functions over plain arrays (no store imports) so they are
// unit-testable and usable from calibrationRunner (which cannot be imported
// by tests — it pulls the pdfjs Worker via driveClient).

import type { CalibrationMemory, CalibrationExample } from "../types";

// Active "Line Status" memories, best-performing first, capped at 5 — the
// exact selection every verdict-assessing production call makes (PPD review,
// evidence assessment, staged passes, legacy folder audit).
export function selectLineStatusMemories(all: CalibrationMemory[]): CalibrationMemory[] {
  return all
    .filter((m) => m.status === "active" && m.module === "Line Status")
    .sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0))
    .slice(0, 5);
}

// Included "Line Status" calibration examples, capped at 3 — passed by the
// Option B paths (staged + legacy). Option A's production calls do NOT pass
// calibration examples (only memories), so Lab parity for path A means
// passing memories but NOT examples — parity is per-path, matching what the
// real run sends, not a superset.
export function selectLineStatusCalibration(all: CalibrationExample[]): CalibrationExample[] {
  return all.filter((e) => e.included && e.module === "Line Status").slice(0, 3);
}
