import { describe, it, expect } from "vitest";
import { BUILD_HASH, buildLabel, buildStamp } from "../buildInfo";

// The point of this module is that there is nothing to keep up to date: the
// value comes from the build, not from a string in the repo. These pin that it
// resolves to something real under the real vite define, and that it degrades
// to "unknown" rather than throwing if the define is ever absent.
describe("the build label", () => {
  it("reads the build-time git constant, not a literal in the source", () => {
    expect(BUILD_HASH).toBeTruthy();
    expect(BUILD_HASH).toBe(__GIT_INFO__.hash);
    // A short hash, or the honest fallback. Never a hand-written version.
    expect(BUILD_HASH === "unknown" || /^[0-9a-f]{7,40}$/.test(BUILD_HASH)).toBe(true);
  });

  it("is short enough for a footer and a spreadsheet cell", () => {
    expect(buildLabel().length).toBeLessThanOrEqual(30);
  });

  it("names the app in the export stamp, so a filed copy identifies itself", () => {
    const stamp = buildStamp();
    expect(stamp).toContain("gd4_simulator");
    expect(stamp).toContain(BUILD_HASH);
  });
});
