import { describe, it, expect } from "vitest";
import { collectBackup, backupFilename, isBackupKey } from "../workspaceBackup";

function fakeStorage(entries: Record<string, string>): Pick<Storage, "length" | "key" | "getItem"> {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  };
}

describe("workspace backup (Batch 3)", () => {
  it("collects only app keys, parsing JSON values", () => {
    const backup = collectBackup(
      fakeStorage({
        "ucc-gd4-workspace:v3": JSON.stringify({ state: { cycle: { id: "cycle-1" } }, version: 0 }),
        "ucc-gd4-changelog:v1": JSON.stringify({ state: { changeLog: [] }, version: 1 }),
        "profile-of-pei-v2": JSON.stringify({ state: { background: "UCC" }, version: 0 }),
        "some-other-app": "not ours",
        "ucc-gd4-broken": "not-json{{",
      }),
      new Date("2026-07-04T10:00:00Z"),
    );
    expect(Object.keys(backup.keys).sort()).toEqual(["profile-of-pei-v2", "ucc-gd4-broken", "ucc-gd4-changelog:v1", "ucc-gd4-workspace:v3"]);
    expect((backup.keys["ucc-gd4-workspace:v3"] as { state: { cycle: { id: string } } }).state.cycle.id).toBe("cycle-1");
    expect(backup.keys["ucc-gd4-broken"]).toBe("not-json{{"); // raw fallback, never dropped
    expect(backup.app).toBe("gd4-workspace");
    expect(backup.exportedAt).toBe("2026-07-04T10:00:00.000Z");
  });

  it("names the file by date and filters keys by prefix", () => {
    expect(backupFilename(new Date("2026-07-04T10:00:00Z"))).toBe("gd4-workspace-backup-2026-07-04.json");
    expect(isBackupKey("ucc-gd4-checklist:v2")).toBe(true);
    expect(isBackupKey("vite-something")).toBe(false);
  });
});
