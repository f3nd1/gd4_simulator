// Pure planner for the Full-auto "Run full audit" sweep: which sub-criteria
// run (and via which path), and which are marked "Not assessed / no evidence"
// because they have no folder links. The Drive link parser is injected so
// this stays store-free and unit-testable (driveClient loads pdfjs, which is
// unavailable under Vitest).

// Default path (2026-07-19, Felix): Option A (PPD + Evidence, the deepest,
// assessor-grade check) is the default; Option B (staged, single-pass) is the
// opt-in for a faster first sweep. Every read of analysisPath must go through
// resolveAnalysisPath so the default lives in exactly one place.
export const DEFAULT_ANALYSIS_PATH: "A" | "B" = "A";

export function resolveAnalysisPath(analysisPath: Record<string, "A" | "B">, subCriterionId: string): "A" | "B" {
  return analysisPath[subCriterionId] ?? DEFAULT_ANALYSIS_PATH;
}

export type FullAuditPlanEntry = {
  folderId: string;
  subCriterionId: string;
  folderName: string;
  path: "A" | "B";
  // False -> no Drive links: still listed (never skipped silently), marked
  // "Not assessed / no evidence" instead of run.
  hasLinks: boolean;
};

export function buildFullAuditPlan(
  folders: Array<{ id: string; subCriterionId: string; folderName: string; scopeId?: string; folderLink?: string; policyLink?: string }>,
  analysisPath: Record<string, "A" | "B">,
  isLink: (link?: string) => boolean
): FullAuditPlanEntry[] {
  return folders.map((f) => {
    // Plan by the folder's RUN SCOPE (its scopeId for a per-item split folder
    // like 4.2.1/4.2.2, else its sub-criterion — same rule as folderScopeId).
    // Planning by f.subCriterionId put two merged "4.2" entries in the sweep;
    // runPPDReview("4.2") then found no folder with that scope and silently
    // returned, so both 4.2 items showed "done" while nothing actually ran.
    const scope = f.scopeId ?? f.subCriterionId;
    return {
      folderId: f.id,
      subCriterionId: scope,
      folderName: f.folderName,
      // Respect each row's Option A/B choice; PPD + Evidence (A) when unset.
      // analysisPath is keyed by scope (the Evidence Folder card's toggle).
      path: resolveAnalysisPath(analysisPath, scope),
      hasLinks: isLink(f.folderLink) || isLink(f.policyLink),
    };
  });
}

// One row of the full-audit live log, colour-coded by status in the overlay:
// done (green) / skipped, no folder links (amber) / error (red) /
// waiting (grey) / running (accent, "assessing…").
export type FullAuditEntryStatus = "waiting" | "running" | "done" | "skipped" | "error";
export type FullAuditEntry = {
  subCriterionId: string;
  label: string;           // display label, number shown ONCE (see fullAuditLabel)
  status: FullAuditEntryStatus;
  note?: string;           // e.g. "no folder links", the error message, "Option A"
};

// Folder names often already start with the sub-criterion number
// ("6.2 Management Review"); naive `${id} ${name}` doubled it
// ("6.2 6.2 Management Review"). Prefix the id only when it is missing.
export function fullAuditLabel(subCriterionId: string, folderName: string): string {
  const name = folderName.trim();
  return name.startsWith(subCriterionId) ? name : `${subCriterionId} ${name}`;
}

// Live progress of the full audit, rendered by the full-screen overlay.
export type FullAuditProgress = {
  status: "running" | "complete" | "cancelled";
  current: number;         // 1-based index of the sub-criterion being audited
  total: number;
  currentSubCriterionId: string;
  currentName: string;
  // Epoch ms when the current sub-criterion started — drives the live
  // elapsed indicator so a long step never looks frozen.
  currentStartedAt?: number;
  // One entry per planned sub-criterion, in run order, statuses updated live.
  entries: FullAuditEntry[];
  // One-line wrap-up shown when the run ends.
  summary?: string;
  // Populated only when the "Auto-score bands" setting was ON for this run:
  // how many item bands the AI set automatically, and which items it could
  // not score cleanly (left blank for manual attention, never guessed).
  // Stays undefined when the setting is OFF — the overlay is then identical
  // to before this feature existed.
  autoScore?: { set: number; skipped: { itemId: string; reason: string }[] };
};

// Hard per-sub-criterion ceiling for the Full auto sweep. A single stalled
// assessment (hung network call, unreadable file) is aborted at this point,
// marked "error — timed out", and the sweep continues — one stuck
// sub-criterion must never block the remaining ones.
export const FULL_AUDIT_ITEM_TIMEOUT_MS = 10 * 60_000;

export type FullAuditDeps = {
  // Runs one linked sub-criterion end to end (Option A chain or staged audit).
  run: (entry: FullAuditPlanEntry) => Promise<void>;
  // Records "Not assessed / no evidence" on a link-less folder.
  markNoLinks: (entry: FullAuditPlanEntry) => void;
  // True once the user cancelled (auditRunToken bumped).
  cancelled: () => boolean;
  // Aborts whatever run is currently in flight (run-level AbortController +
  // per-file abort) WITHOUT counting as a user cancel of the whole sweep.
  abortActiveRun: () => void;
  // Called whenever entries/current change so the store can publish progress.
  onUpdate: (current: number, entry: FullAuditPlanEntry) => void;
  timeoutMs?: number;
};

// The Full auto loop, extracted pure so the resilience rules are testable:
// every sub-criterion terminates (success, error, timeout or skip) and the
// loop ALWAYS reaches the end of the plan unless the user cancels.
export async function runFullAuditPlan(
  plan: FullAuditPlanEntry[],
  entries: FullAuditEntry[],
  deps: FullAuditDeps
): Promise<{ cancelled: boolean }> {
  const timeoutMs = deps.timeoutMs ?? FULL_AUDIT_ITEM_TIMEOUT_MS;
  let cancelled = false;
  for (let i = 0; i < plan.length; i++) {
    if (deps.cancelled()) { cancelled = true; break; }
    const entry = plan[i];
    entries[i].status = "running";
    deps.onUpdate(i + 1, entry);
    if (!entry.hasLinks) {
      deps.markNoLinks(entry);
      entries[i].status = "skipped";
      entries[i].note = "no folder links";
      deps.onUpdate(i + 1, entry);
      continue;
    }
    try {
      // Race the run against the per-item ceiling. On timeout the in-flight
      // run is actively aborted (so it stops burning calls) and the sweep
      // moves on; a late resolution from the loser is ignored.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol("timedOut");
      const runPromise = deps.run(entry);
      runPromise.catch(() => { /* ignored if it loses the race */ });
      const winner = await Promise.race([
        runPromise,
        new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => resolve(timedOut), timeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      if (winner === timedOut) {
        deps.abortActiveRun();
        entries[i].status = "error";
        entries[i].note = `timed out after ${Math.round(timeoutMs / 60_000)} min — aborted, continuing with the next sub-criterion`;
        deps.onUpdate(i + 1, entry);
        continue;
      }
      if (deps.cancelled()) { cancelled = true; entries[i].status = "error"; entries[i].note = "cancelled"; deps.onUpdate(i + 1, entry); break; }
      entries[i].status = "done";
      entries[i].note = `Option ${entry.path}`;
    } catch (err) {
      entries[i].status = "error";
      entries[i].note = err instanceof Error ? err.message : String(err);
    }
    deps.onUpdate(i + 1, entry);
  }
  return { cancelled };
}
