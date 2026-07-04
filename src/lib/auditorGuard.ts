// Auditor-selection guard — pure, store-free, so the blocking rules and their
// exact messages are unit-testable. Every audit entry point (Option A, Option
// B staged, Full auto, Audit-all) calls checkAuditorForRun() before starting;
// the pages render the same messages proactively around their run buttons.

import type { AuditorProfile, PanelReviewMode } from "../types";
import { assemblePanel, perspectiveOf, perspectiveLabel, MIN_PANEL } from "./reviewPanel";

export const AUDITOR_CREATION_PATH = "/auditors";

export const MSG_NO_AUDITORS_EXIST =
  "No auditors have been created yet. Go to Auditor Creation to add at least one auditor before running an audit.";
export const MSG_NO_AUDITOR_SELECTED =
  "Please select an auditor before running the audit. Choose one in 'Run audit as' above, or create one in Auditor Creation.";
export const MSG_PANEL_UNDER_MIN =
  `The Auditor Review Panel needs at least ${MIN_PANEL} auditors. Add more in Auditor Creation, or set the panel to Off in Settings.`;

// Same resolution order the run pipeline has always used: the explicit
// "Run audit as" pick, else the Audit Lead, else the first profile. The
// Evidence Folder selector displays this same resolution, so whatever this
// returns is what the user sees selected.
export function resolveRunAuditor(auditors: AuditorProfile[], activeAuditorId: string | null): AuditorProfile | undefined {
  return auditors.find((a) => a.id === activeAuditorId) || auditors.find((a) => a.role === "Audit Lead") || auditors[0];
}

export type AuditorGuardResult =
  | { ok: true; auditor: AuditorProfile }
  | { ok: false; reason: "none-exist" | "none-selected"; message: string };

export function checkAuditorForRun(auditors: AuditorProfile[], activeAuditorId: string | null): AuditorGuardResult {
  if (auditors.length === 0) return { ok: false, reason: "none-exist", message: MSG_NO_AUDITORS_EXIST };
  const auditor = resolveRunAuditor(auditors, activeAuditorId);
  if (!auditor) return { ok: false, reason: "none-selected", message: MSG_NO_AUDITOR_SELECTED };
  return { ok: true, auditor };
}

// Part 3 — non-blocking notice: the review panel is switched on but cannot
// run with fewer than MIN_PANEL assigned auditors. Never blocks an audit.
export function panelUnderMinNotice(mode: PanelReviewMode, auditors: AuditorProfile[], panelIds: string[]): string | undefined {
  if (mode === "off") return undefined;
  return assemblePanel(auditors, panelIds).length < MIN_PANEL ? MSG_PANEL_UNDER_MIN : undefined;
}

// ISO 19011 §5.4.2 objectivity — a non-blocking independence notice raised
// when the auditor running a folder audit belongs to the department that OWNS
// the audited folder (auditing one's own work). Both sides are department
// acronyms ("EXCO", "ACAD", …); comparison is case-insensitive and the notice
// is undefined when either side is unset (nothing to compare).
export function independenceNotice(auditor: Pick<AuditorProfile, "name" | "departmentId"> | undefined, folderOwner: string | undefined): string | undefined {
  const dept = (auditor?.departmentId || "").trim().toLowerCase();
  const owner = (folderOwner || "").trim().toLowerCase();
  if (!dept || !owner || dept !== owner) return undefined;
  return `Independence risk: this audit was run by ${auditor!.name} of ${folderOwner}, the department that owns this evidence — the auditor is assessing their own department's work. ISO 19011 expects auditors independent of the area audited; have a different department's auditor re-run or review this result.`;
}

// Part 4 — "who will this run as" display: name + perspective, or an
// explicit unassigned marker the pages style as a warning.
export function runAuditorDisplay(auditors: AuditorProfile[], activeAuditorId: string | null): { text: string; unassigned: boolean } {
  const a = resolveRunAuditor(auditors, activeAuditorId);
  if (!a) return { text: "Unassigned — no auditor selected", unassigned: true };
  return { text: `${a.name} · ${perspectiveLabel(perspectiveOf(a))}`, unassigned: false };
}
