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

export function installCycleLockGuards(): void {
  const locked = () => useWorkspaceStore.getState().cycle.status === "Locked";
  const onBlocked = () => useWorkspaceStore.setState({ lockBlockedReason: LOCKED_CYCLE_MESSAGE });
  installCycleLock(useWorkspaceStore, LOCKED_WORKSPACE_ACTIONS, locked, onBlocked);
  installCycleLock(useChecklistModuleStore, LOCKED_CHECKLIST_ACTIONS, locked, onBlocked);
  installCycleLock(useFindingDraftStore, LOCKED_FINDING_DRAFT_ACTIONS, locked, onBlocked);
}
