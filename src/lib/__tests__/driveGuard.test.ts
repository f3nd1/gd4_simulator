import { describe, it, expect } from "vitest";
import { checkDriveForRun, driveReadFailureMessage, classifyDriveReadError, classifyFileBucket, analyzeFolderProbe, type ProbeFile } from "../driveGuard";

const pf = (path: string, readable = true, readError?: string): ProbeFile => ({ name: path.split("/").pop() || path, path, bucket: classifyFileBucket(path), readable, readError });

describe("classifyFileBucket", () => {
  it("routes policy-named top segments to policy, everything else to evidence", () => {
    expect(classifyFileBucket("1. Policy & Procedure/PPD-v3.pdf")).toBe("policy");
    expect(classifyFileBucket("Procedures/SOP.docx")).toBe("policy");
    expect(classifyFileBucket("2. Actual Evidence/register.xlsx")).toBe("evidence");
    expect(classifyFileBucket("register.xlsx")).toBe("evidence"); // no subfolder → evidence
  });
});

describe("analyzeFolderProbe — the silent-band-depression warnings", () => {
  it("shared folder with no policy subfolder → warns everything is treated as evidence", () => {
    const r = analyzeFolderProbe([pf("PPD.pdf"), pf("2. Actual Evidence/reg.xlsx")], true);
    expect(r.policyCount).toBe(0);
    expect(r.evidenceCount).toBe(2);
    expect(r.warnings.some((w) => w.includes("treated as EVIDENCE") && w.includes("silently depressed"))).toBe(true);
  });
  it("shared folder with no evidence subfolder → warns nothing counts as evidence", () => {
    const r = analyzeFolderProbe([pf("1. Policy & Procedure/PPD.pdf")], true);
    expect(r.warnings.some((w) => w.includes("NONE are being treated as actual evidence"))).toBe(true);
  });
  it("does NOT raise the bucket warnings when two separate folders are linked", () => {
    const r = analyzeFolderProbe([pf("PPD.pdf"), pf("reg.xlsx")], false);
    expect(r.warnings.some((w) => w.includes("EVIDENCE"))).toBe(false);
  });
  it("flags unreadable files with a count and names", () => {
    const r = analyzeFolderProbe([pf("1. Policy & Procedure/PPD.pdf"), pf("2. Actual Evidence/x.docx", false, "Permission denied")], true);
    expect(r.unreadable).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("could not be read") && w.includes("x.docx"))).toBe(true);
  });
  it("empty folder → warns no files", () => {
    expect(analyzeFolderProbe([], false).warnings[0]).toContain("No files found");
  });
  it("clean split folder → no warnings", () => {
    const r = analyzeFolderProbe([pf("1. Policy & Procedure/PPD.pdf"), pf("2. Actual Evidence/reg.xlsx")], true);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });
});


describe("checkDriveForRun", () => {
  it("blocks with a paste-the-link message when nothing is linked, and offers no Connect", () => {
    const block = checkDriveForRun(false, false);
    expect(block).not.toBeNull();
    expect(block!.reason).toBe("no-link");
    expect(block!.canConnect).toBe(false);
    expect(block!.message).toMatch(/no Google Drive folder is linked/i);
  });

  it("blocks with a Connect affordance when linked but not connected", () => {
    const block = checkDriveForRun(true, false);
    expect(block).not.toBeNull();
    expect(block!.reason).toBe("not-connected");
    expect(block!.canConnect).toBe(true);
    expect(block!.message).toMatch(/isn't connected to Google Drive/i);
  });

  it("allows the run when a link and a live token are both present", () => {
    expect(checkDriveForRun(true, true)).toBeNull();
  });

  it("still blocks on a missing link even if a token happens to be present", () => {
    const block = checkDriveForRun(false, true);
    expect(block?.reason).toBe("no-link");
  });
});

describe("driveReadFailureMessage", () => {
  it("never tells the user to connect — it is the connected-but-read-failed case", () => {
    const msg = driveReadFailureMessage();
    expect(msg).toMatch(/Connected to Google Drive, but couldn't read/i);
    expect(msg).not.toMatch(/connect to google drive/i);
  });

  it("appends an optional detail in parentheses", () => {
    expect(driveReadFailureMessage("403 Forbidden")).toContain("(403 Forbidden)");
  });
});

describe("classifyDriveReadError — the specific 6.1-style cause (Fix 4)", () => {
  it("maps a 403 / insufficient-permissions error to a permission cause", () => {
    const r = classifyDriveReadError("Could not list folder(s): Actual Evidence: Drive API request failed (403): insufficientFilePermissions");
    expect(r.cause).toBe("permission");
    expect(r.detail).toMatch(/Viewer access/i);
    expect(r.detail).toMatch(/Shared Drive/i);
  });

  it("maps a 404 / not-found error to a not-found cause", () => {
    expect(classifyDriveReadError("Drive API request failed (404): File not found").cause).toBe("not-found");
  });

  it("maps a 401 / expired token to an auth cause", () => {
    expect(classifyDriveReadError("Drive API request failed (401): Invalid Credentials").cause).toBe("auth");
  });

  it("maps an empty-folder message to an empty cause", () => {
    expect(classifyDriveReadError("No files found in the linked folder(s).").cause).toBe("empty");
  });

  it("falls back to unknown (no misleading specific claim) when unrecognised", () => {
    const r = classifyDriveReadError("some other network blip");
    expect(r.cause).toBe("unknown");
    expect(r.detail).toBe("");
  });
});
