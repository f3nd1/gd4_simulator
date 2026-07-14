import { useMemo } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { buildScored } from "../lib/scoring";
import { computeChecklistOverrides } from "../lib/checklistBanding";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";

export function useScored() {
  const evidence = useWorkspaceStore((s) => s.evidence);
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const confirmed = useWorkspaceStore((s) => s.confirmed);
  const closures = useWorkspaceStore((s) => s.closures);
  const customFindings = useWorkspaceStore((s) => s.customFindings);
  const seedFindingsLoaded = useWorkspaceStore((s) => s.seedFindingsLoaded);
  const checklistEntries = useChecklistModuleStore((s) => s.entries);
  const awardThresholds = useScoringConfigStore((s) => s.awardThresholds);
  const apsrScale = useScoringConfigStore((s) => s.apsrScale);

  // Scale is a dep: editing the %-scale on Setup re-bands every item live.
  const checklistBandOverrides = useMemo(() => computeChecklistOverrides(checklistEntries, GD4_REQUIREMENTS, apsrScale), [checklistEntries, apsrScale]);

  return useMemo(
    () => buildScored({ evidence, reviewer, confirmed, closures, checklistBandOverrides, customFindings, seedFindingsLoaded, awardThresholds }),
    [evidence, reviewer, confirmed, closures, checklistBandOverrides, customFindings, seedFindingsLoaded, awardThresholds]
  );
}
