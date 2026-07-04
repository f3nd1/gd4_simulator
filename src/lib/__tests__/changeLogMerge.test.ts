import { describe, it, expect } from "vitest";
import { appendChangeLogEntry, dedupeChangeLog, mergeChangeLogs, changeLogKey } from "../changeLogMerge";
import type { ChangeLogEntry } from "../../types";

function entry(over: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: over.id ?? `CL-${over.commitHash ?? "abc"}-${over.action ?? "push"}-${Math.random().toString(36).slice(2)}`,
    timestamp: over.timestamp ?? "2026-07-01T10:00:00.000Z",
    action: over.action ?? "push",
    commitHash: over.commitHash ?? "abc123",
    branch: over.branch ?? "main",
    commitMessage: over.commitMessage ?? "msg",
    summary: over.summary ?? "did a thing",
    filesChanged: over.filesChanged,
  };
}

describe("changeLogKey", () => {
  it("is one identity per commit+action", () => {
    expect(changeLogKey({ commitHash: "a", action: "push" })).toBe("push:a");
    expect(changeLogKey({ commitHash: "a", action: "pull" })).not.toBe(changeLogKey({ commitHash: "a", action: "push" }));
  });
});

describe("appendChangeLogEntry — append-only, dedupe by commit+action", () => {
  it("prepends a new entry (newest first)", () => {
    const list = [entry({ commitHash: "old" })];
    const next = appendChangeLogEntry(list, entry({ commitHash: "new" }));
    expect(next).toHaveLength(2);
    expect(next[0].commitHash).toBe("new");
  });

  it("returns the SAME reference for a duplicate commit+action (no-op)", () => {
    const list = [entry({ commitHash: "dup", action: "push" })];
    const next = appendChangeLogEntry(list, entry({ commitHash: "dup", action: "push", id: "different-id" }));
    expect(next).toBe(list); // same ref → caller skips the persist
  });

  it("a pull of the same commit is a distinct entry from its push", () => {
    const list = [entry({ commitHash: "x", action: "push" })];
    const next = appendChangeLogEntry(list, entry({ commitHash: "x", action: "pull" }));
    expect(next).toHaveLength(2);
  });
});

describe("mergeChangeLogs — UNION never shrinks, the durability guarantee", () => {
  it("keeps every unique entry from both sides", () => {
    const a = [entry({ commitHash: "a1" }), entry({ commitHash: "a2" })];
    const b = [entry({ commitHash: "b1" })];
    expect(mergeChangeLogs(a, b)).toHaveLength(3);
  });

  it("a stale/empty write can never shrink a fuller log", () => {
    const full = [entry({ commitHash: "a" }), entry({ commitHash: "b" }), entry({ commitHash: "c" })];
    // Simulate a stale hydrate producing an empty outgoing log:
    expect(mergeChangeLogs(full, [])).toHaveLength(3);
    expect(mergeChangeLogs([], full)).toHaveLength(3);
  });

  it("dedupes overlapping commits, keeping the most recent timestamp", () => {
    const older = entry({ commitHash: "same", timestamp: "2026-07-01T00:00:00.000Z", summary: "older" });
    const newer = entry({ commitHash: "same", timestamp: "2026-07-02T00:00:00.000Z", summary: "newer" });
    const merged = mergeChangeLogs([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].summary).toBe("newer");
  });

  it("returns entries newest-first", () => {
    const merged = mergeChangeLogs(
      [entry({ commitHash: "old", timestamp: "2026-07-01T00:00:00.000Z" })],
      [entry({ commitHash: "new", timestamp: "2026-07-03T00:00:00.000Z" })],
    );
    expect(merged.map((e) => e.commitHash)).toEqual(["new", "old"]);
  });
});

describe("dedupeChangeLog", () => {
  it("collapses a legacy log that recorded the same build many times", () => {
    const many = [
      entry({ commitHash: "z", timestamp: "2026-07-01T00:00:00.000Z" }),
      entry({ commitHash: "z", timestamp: "2026-07-01T01:00:00.000Z" }),
      entry({ commitHash: "z", timestamp: "2026-07-01T02:00:00.000Z" }),
    ];
    const out = dedupeChangeLog(many);
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe("2026-07-01T02:00:00.000Z");
  });
});
