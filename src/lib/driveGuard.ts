// Drive-connection guard — pure, store-free, so the block decision and its
// exact messages are unit-testable. Every audit entry point checks this before
// starting so a not-connected folder is never a raw error or a silent no-op;
// the Evidence Folder page renders the same messages with a Connect action.

export const DRIVE_CONNECT_PATH = "/settings"; // where the Client ID is set

export type DriveRunBlock = {
  reason: "no-link" | "not-connected";
  message: string;
  canConnect: boolean; // whether to offer a "Connect to Google Drive" button
};

// Blocks a run when the folder can't be read: no Drive link at all, or a link
// but no live Drive connection. Returns null when the run may proceed (a link
// is present AND a token is available). A genuine read failure AFTER this
// (permissions/empty/network) is a separate, in-run case — see
// driveReadFailureMessage.
export function checkDriveForRun(hasAnyLink: boolean, hasToken: boolean): DriveRunBlock | null {
  if (!hasAnyLink) {
    return {
      reason: "no-link",
      message: "Can't run the audit — no Google Drive folder is linked for this sub-criterion yet. Paste the Policy and/or Actual Evidence folder link on its Evidence Folder row, then run again.",
      canConnect: false,
    };
  }
  if (!hasToken) {
    return {
      reason: "not-connected",
      message: "Can't run the audit — the evidence folder isn't connected to Google Drive. Connect it to continue.",
      canConnect: true,
    };
  }
  return null;
}

// Fix 5 — the folder IS connected but the read genuinely failed. Distinct from
// "not connected": never tells the user to connect something already connected.
export function driveReadFailureMessage(detail?: string): string {
  const base = "Connected to Google Drive, but couldn't read this folder. Check that the connected account has at least Viewer access (for a Shared Drive, that it's a member of that drive), and that the folder actually contains files.";
  return detail ? `${base} (${detail})` : base;
}

// Shown when the Drive session expires mid-run and cannot be refreshed
// silently. The run must HARD-STOP on this — proceeding would silently skip
// every remaining file and let the AI score "no evidence found" against
// evidence it never saw.
export const DRIVE_EXPIRED_MID_RUN =
  "Google Drive session expired mid-run and could not be refreshed automatically. The run was stopped so no verdicts were produced from unread files. Reconnect Google Drive and run again.";

// The specific underlying cause of a "connected but couldn't read" failure,
// parsed from the Drive API error string that the audit surfaces in
// AuditProgressState.errorMessage (e.g. "…Drive API request failed (403):
// insufficientFilePermissions"). Lets the error dialog tell the user WHICH of
// the suggested checks is the real problem instead of a generic message.
export type DriveReadCause = "permission" | "not-found" | "auth" | "empty" | "unknown";

export function classifyDriveReadError(message?: string): { cause: DriveReadCause; detail: string } {
  const m = (message || "").toLowerCase();
  if (/\b403\b|permission|insufficient|forbidden/.test(m))
    return {
      cause: "permission",
      detail: "Permission denied — the connected Google account doesn't have at least Viewer access to this folder. If the folder lives in a Shared Drive, the account must be a MEMBER of that Shared Drive, not just have the link.",
    };
  if (/\b404\b|not found|notfound/.test(m))
    return {
      cause: "not-found",
      detail: "Folder not found — the link may point to a wrong, moved, or deleted folder (or to a file rather than a folder). Open folder settings and re-check the link.",
    };
  if (/\b401\b|unauthor|invalid credentials|token|expired/.test(m))
    return {
      cause: "auth",
      detail: "Authorisation has expired — reconnect Google Drive to refresh access, then run the audit again.",
    };
  if (/\bempty\b|no files found|no readable/.test(m))
    return {
      cause: "empty",
      detail: "The folder was reachable but has no readable files. Add the evidence documents, or check you linked the intended folder.",
    };
  return { cause: "unknown", detail: "" };
}

// ── Folder pre-flight probe ──────────────────────────────────────────────
// Classifies a scanned file into the policy vs evidence bucket by its
// top-level path segment (the audit's own convention: "1. Policy & Procedure"
// / "2. Actual Evidence"). Files not under a policy-named subfolder default to
// evidence — same rule the audit uses. Moved here (from the store) so the
// probe UI and the audit share ONE definition. Pure + store-free = testable.
export function classifyFileBucket(path: string): "policy" | "evidence" {
  const topSegment = path.split("/")[0]?.toLowerCase() || "";
  return /polic|procedure/.test(topSegment) ? "policy" : "evidence";
}

export type ProbeFile = { name: string; path: string; bucket: "policy" | "evidence"; readable: boolean; readError?: string };

export type FolderProbeResult = {
  ok: boolean;             // false when the folder itself could not be listed
  listError?: string;      // classifyDriveReadError detail when listing failed
  sharedFolder: boolean;   // true when one folder is linked for BOTH tabs
  files: ProbeFile[];
  policyCount: number;
  evidenceCount: number;
  unreadable: ProbeFile[];
  warnings: string[];      // plain-English problems found, worst first
};

// Turns a listed-and-read-checked file set into the plain-English warnings the
// probe shows — the silent-band-depression traps made loud. Pure so the exact
// warning rules are unit-tested; the store action does the Drive I/O and calls
// this. `sharedFolder` = the same folder linked for the Policy and Evidence
// tabs, which is the only case where subfolder naming decides bucketing.
export function analyzeFolderProbe(files: ProbeFile[], sharedFolder: boolean): FolderProbeResult {
  const policy = files.filter((f) => f.bucket === "policy");
  const evidence = files.filter((f) => f.bucket === "evidence");
  const unreadable = files.filter((f) => !f.readable);
  const warnings: string[] = [];

  if (files.length === 0) {
    warnings.push("No files found in this folder (including subfolders). Add the documents, or check you linked the intended folder.");
  }
  // The mis-bucketing trap: only meaningful when ONE folder feeds both tabs.
  if (sharedFolder && files.length > 0 && policy.length === 0) {
    warnings.push('No files are under a "Policy & Procedure" subfolder, so ALL files are being treated as EVIDENCE. If this folder holds policies, put them in a subfolder named exactly "1. Policy & Procedure" — otherwise the documented approach earns no credit and the band is silently depressed.');
  }
  if (sharedFolder && files.length > 0 && evidence.length === 0) {
    warnings.push('Every file is under a policy-named subfolder, so NONE are being treated as actual evidence. Implementation records should sit in a subfolder named exactly "2. Actual Evidence".');
  }
  if (unreadable.length > 0) {
    warnings.push(`${unreadable.length} of ${files.length} file${files.length === 1 ? "" : "s"} could not be read and would be skipped by the audit: ${unreadable.slice(0, 3).map((f) => f.name).join(", ")}${unreadable.length > 3 ? ", …" : ""}. Fix access before running so the audit isn't judging incomplete evidence.`);
  }

  return {
    ok: true,
    sharedFolder,
    files,
    policyCount: policy.length,
    evidenceCount: evidence.length,
    unreadable,
    warnings,
  };
}
