import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { FINDINGS } from "../data/findings";
import type { Finding } from "../types";

// Single source for "every finding in the workspace" — the seeded register
// (only once "Use demo data" has loaded it — see seedFindingsLoaded) plus
// anything raised at runtime (e.g. from the Sub-Criterion Checklist). Pages
// must use this instead of importing FINDINGS directly, otherwise custom
// findings silently disappear from counts/gates that read FINDINGS alone.
export function useAllFindings(): Finding[] {
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  // Dedupe by id, custom winning: editing a seeded demo finding promotes a
  // patched copy into customFindings (see updateCustomFinding), so without this
  // the same id would appear twice — once seeded, once edited.
  const byId = new Map<string, Finding>();
  for (const f of seedFindingsLoaded ? FINDINGS : []) byId.set(f.id, f);
  for (const f of customFindings) byId.set(f.id, f);
  return [...byId.values()];
}
