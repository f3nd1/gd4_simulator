import { describe, it, expect, vi } from "vitest";

// A migration runs against whatever is ACTUALLY in storage, which is untyped
// and years old. If it throws, zustand swallows the error, the store keeps its
// DEFAULT state, and the next write publishes those defaults over the real row:
// the whole workspace, gone. That is not a hypothetical — the v10 -> v11
// migration dereferenced `v.snapshot` on a `versions` entry that had none, and
// a live run lost an auditor and two saved versions to it.
//
// So every migration must be TOTAL over plausible stored data. These payloads
// are deliberately hostile in the ways real stored blobs are: fields absent
// because they post-date the blob, fields null, wrong container types, and
// records whose values are null.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { useCalibrationStore } = await import("../useCalibrationStore");
const { useWorksheetQuestionStore } = await import("../useWorksheetQuestionStore");

type Persisted = { persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown; version?: number } } };
const migrateOf = (store: unknown) => (store as unknown as Persisted).persist.getOptions().migrate;
const versionOf = (store: unknown) => (store as unknown as Persisted).persist.getOptions().version ?? 0;

// A version entry as the RESTORE path and the v11 migration both expect it,
// and the three ways a stored one can fall short.
const versionEntries = [
  { id: "V1", name: "n", version: "v1", date: "d", status: "Draft", note: "", snapshot: { evidenceAssessments: {}, customFindings: [] } },
  { id: "V2", name: "n", version: "v2", date: "d", status: "Draft", note: "" },          // no snapshot at all
  { id: "V3", name: "n", version: "v3", date: "d", status: "Draft", note: "", snapshot: null },
  null,
];

const HOSTILE: Record<string, unknown>[] = [
  {},
  { versions: versionEntries },
  { versions: null },
  { versions: {} },
  { evidenceAssessments: null, evidenceAssessmentHistory: null },
  { evidenceAssessments: { "5.4": null }, evidenceAssessmentHistory: { "5.4": [null] } },
  { evidenceAssessments: { "5.4": { rows: null } } },
  { evidenceAssessments: { "5.4": { rows: [{ gdRef: "5.4.1.DS1" }] } } },
  { cycle: null, customFindings: null, folders: null, auditors: null },
  { entries: null },
  { entries: { "6.1.1": null } },
  { closures: null, calibrationMemories: null, priorCycleFindings: null },
  { versions: versionEntries, evidenceAssessments: { "5.4": { rows: [{ gdRef: "x", verdict: "Partial", ppdVerdict: "Not assessed", evidenceChunkIds: [] }] } } },
];

const STORES: [string, unknown][] = [
  ["workspace", useWorkspaceStore],
  ["checklist", useChecklistModuleStore],
  ["calibration", useCalibrationStore],
  ["worksheet questions", useWorksheetQuestionStore],
];

describe("every migration survives whatever is actually in storage", () => {
  for (const [label, store] of STORES) {
    it(`${label}: never throws, for any stored version or shape`, () => {
      const migrate = migrateOf(store);
      if (!migrate) return; // a store with no migration cannot fail this way
      const current = versionOf(store);
      for (let from = 0; from <= current; from++) {
        for (const payload of HOSTILE) {
          expect(
            () => migrate(structuredClone(payload), from),
            `${label} migrate(from=${from}) threw on ${JSON.stringify(payload).slice(0, 90)}`,
          ).not.toThrow();
        }
        // The two shapes zustand itself can hand over.
        expect(() => migrate(undefined, from), `${label} migrate(undefined, ${from})`).not.toThrow();
        expect(() => migrate(null, from), `${label} migrate(null, ${from})`).not.toThrow();
      }
    });
  }

  // partialize is the other total function on this path, and the more dangerous
  // one: it runs inside setState on EVERY write, so a throw there updates the
  // in-memory state, shows the change on screen, and silently saves nothing —
  // for the rest of that workspace's life. That is what "the auditor is not
  // saving" looked like from the outside.
  it("every partialize survives the same hostile state", () => {
    for (const [label, store] of STORES) {
      const partialize = (store as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => unknown } } })
        .persist.getOptions().partialize;
      if (!partialize) continue;
      const base = (store as unknown as { getState: () => Record<string, unknown> }).getState();
      for (const payload of HOSTILE) {
        expect(
          () => partialize({ ...base, ...structuredClone(payload) }),
          `${label} partialize threw on ${JSON.stringify(payload).slice(0, 90)}`,
        ).not.toThrow();
      }
    }
  });

  // The exact payload that caused the live loss, kept as its own case so the
  // reason it exists cannot be edited away by accident.
  it("workspace: a saved version with no snapshot does not break the v10 to v11 step", () => {
    const migrate = migrateOf(useWorkspaceStore)!;
    const payload = {
      auditors: [{ id: "A1", name: "Felix" }],
      versions: [{ id: "V0", name: "Older", version: "v0.0", date: "2026-08-01", status: "Draft", note: "" }],
      evidenceAssessments: {},
    };
    const out = migrate(structuredClone(payload), 10) as { auditors: { name: string }[]; versions: unknown[] };
    expect(out.auditors.map((a) => a.name)).toEqual(["Felix"]);
    expect(out.versions).toHaveLength(1);
  });
});
