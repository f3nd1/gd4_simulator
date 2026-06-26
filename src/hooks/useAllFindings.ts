import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { FINDINGS } from "../data/findings";
import type { Finding } from "../types";

// Single source for "every finding in the workspace" — the seeded register
// plus anything raised at runtime (e.g. from the Sub-Criterion Checklist).
// Pages must use this instead of importing FINDINGS directly, otherwise
// custom findings silently disappear from counts/gates that read FINDINGS alone.
export function useAllFindings(): Finding[] {
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  return [...FINDINGS, ...customFindings];
}
