import { describe, it, expect } from "vitest";
import { NAV, visibleNav, devToolsRedirect, DEFAULT_SHOW_DEVELOPER_TOOLS, DEVELOPER_TOOL_PATHS, type NavGroup } from "../../nav";

// Diagnostic pages now live in each stage's demoted `tools` tail, so count
// across items + tools when checking visibility.
const allPaths = (groups: NavGroup[]) => groups.flatMap((g) => [...g.items, ...(g.tools ?? [])].map((i) => i.path));

describe("developer-tools visibility", () => {
  it("defaults to ON", () => {
    expect(DEFAULT_SHOW_DEVELOPER_TOOLS).toBe(true);
  });

  it("ON: nav is unchanged and includes Change Log (in the tools tail)", () => {
    expect(visibleNav(true)).toBe(NAV);
    expect(allPaths(visibleNav(true))).toContain("/change-log");
  });

  it("OFF: Change Log is removed from the nav and no other item is touched", () => {
    const filtered = visibleNav(false);
    expect(allPaths(filtered)).not.toContain("/change-log");
    const countAll = allPaths(NAV).length;
    const countFiltered = allPaths(filtered).length;
    expect(countFiltered).toBe(countAll - DEVELOPER_TOOL_PATHS.length);
    // No empty group stubs left behind (a group must keep at least one link).
    expect(filtered.every((g) => g.items.length > 0 || (g.tools?.length ?? 0) > 0)).toBe(true);
  });

  it("route guard: hidden → redirect to the dashboard, visible → render", () => {
    expect(devToolsRedirect(false)).toBe("/");
    expect(devToolsRedirect(true)).toBeNull();
  });
});
