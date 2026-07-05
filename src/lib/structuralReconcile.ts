// Pure helpers for reconciling persisted item / sub-criterion-keyed workspace
// state to the CURRENT GD4 structure. Shared by the workspace persist
// migration and version restore so a blob or snapshot saved before a
// structural change (sub-criterion split, 7.2 fold, item collapse) can neither
// reintroduce parentless keys nor blank out surviving items.
//
// Kept in this standalone module (not the store) so it is unit-testable —
// importing the store into a test pulls in driveClient, which instantiates a
// pdfjs Worker at module load and is unavailable under Node/Vitest.
import type { ItemEvidence } from "../types";
import { GD4_REQUIREMENTS, GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { blankEvidence } from "../data/seedEvidence";

export const currentItemIds = (): Set<string> => new Set(GD4_REQUIREMENTS.map((r) => r.id));
export const currentSubIds = (): Set<string> => new Set(GD4_SUB_CRITERIA.map((s) => s.id));

// Keep only the record entries whose key is in `valid`. Undefined passes through.
export function pruneRecordByKeys<V>(rec: Record<string, V> | undefined, valid: Set<string>): Record<string, V> | undefined {
  return rec ? (Object.fromEntries(Object.entries(rec).filter(([k]) => valid.has(k))) as Record<string, V>) : rec;
}

// Rebuild the evidence map on the current item ids: keep existing ratings for
// surviving items, add a blank entry for any current item the source lacks (so
// no consumer indexes an undefined entry), and drop stale keys.
export function reconcileEvidenceMap(evidence: Record<string, ItemEvidence> | undefined): Record<string, ItemEvidence> | undefined {
  if (!evidence) return evidence;
  const blank = blankEvidence();
  return Object.fromEntries(Object.keys(blank).map((id) => [id, evidence[id] ?? blank[id]]));
}
