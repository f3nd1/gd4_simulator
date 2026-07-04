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
