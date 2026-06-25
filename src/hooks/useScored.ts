import { useMemo } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { buildScored } from "../lib/scoring";

export function useScored() {
  const evidence = useWorkspaceStore((s) => s.evidence);
  const reviewer = useWorkspaceStore((s) => s.reviewer);
  const confirmed = useWorkspaceStore((s) => s.confirmed);
  const closures = useWorkspaceStore((s) => s.closures);
  const checklist = useWorkspaceStore((s) => s.checklist);

  return useMemo(
    () => buildScored({ evidence, reviewer, confirmed, closures, checklist }),
    [evidence, reviewer, confirmed, closures, checklist]
  );
}
