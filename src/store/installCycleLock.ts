// Installs the Locked-cycle write barrier on all three data stores.
//
// Kept in its own module, imported once from main.tsx, so the patching happens
// after every store module has finished initialising — useWorkspaceStore and
// useChecklistModuleStore already import each other, and doing this inside
// either of them would run the patch mid-cycle.
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useChecklistModuleStore } from "./useChecklistModuleStore";
import { useFindingDraftStore } from "./useFindingDraftStore";
import {
  installCycleLock,
  LOCKED_CYCLE_MESSAGE,
  LOCKED_WORKSPACE_ACTIONS,
  LOCKED_CHECKLIST_ACTIONS,
  LOCKED_FINDING_DRAFT_ACTIONS,
} from "../lib/cycleLock";

// installCycleLock patches the actions in with setState. setState is exactly
// what zustand's persist middleware writes on, and it writes the WHOLE
// persisted slice — so calling it at module load, before the async storage
// adapter has finished hydrating, serialised the store's DEFAULT state and
// pushed it to Supabase, permanently overwriting the real row. The local cache
// hid it (it is written and re-read on the same device), so the damage only
// showed on a device that had to fall back to the remote copy: a second
// browser, a cleared cache, or a full localStorage. That is how a created
// auditor could vanish while the page that created it still showed it.
//
// Waiting for hydration is also more correct, not just safer: `locked()` reads
// cycle.status, which before hydration is the default "Draft", so a lock
// installed early could not have been enforcing a real Locked cycle anyway.
type Hydratable = { persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => void } };

function whenHydrated(store: unknown, run: () => void): void {
  const p = (store as Hydratable).persist;
  // Defensive: a store without the persist API (or a test double) still gets
  // its guards, just immediately.
  if (!p?.onFinishHydration) { run(); return; }
  if (p.hasHydrated()) run();
  else p.onFinishHydration(run);
}

export function installCycleLockGuards(): void {
  const locked = () => useWorkspaceStore.getState().cycle.status === "Locked";
  const onBlocked = () => useWorkspaceStore.setState({ lockBlockedReason: LOCKED_CYCLE_MESSAGE });
  whenHydrated(useWorkspaceStore, () => installCycleLock(useWorkspaceStore, LOCKED_WORKSPACE_ACTIONS, locked, onBlocked));
  whenHydrated(useChecklistModuleStore, () => installCycleLock(useChecklistModuleStore, LOCKED_CHECKLIST_ACTIONS, locked, onBlocked));
  whenHydrated(useFindingDraftStore, () => installCycleLock(useFindingDraftStore, LOCKED_FINDING_DRAFT_ACTIONS, locked, onBlocked));
}
