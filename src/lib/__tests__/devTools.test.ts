import { describe, it, expect } from "vitest";
import { NAV, visibleNav, devToolsRedirect, DEFAULT_SHOW_DEVELOPER_TOOLS, DEVELOPER_TOOL_PATHS } from "../../nav";

describe("developer-tools visibility", () => {
  it("defaults to ON", () => {
    expect(DEFAULT_SHOW_DEVELOPER_TOOLS).toBe(true);
  });

  it("ON: nav is unchanged and includes Change Log", () => {
    expect(visibleNav(true)).toBe(NAV);
    expect(visibleNav(true).some((g) => g.items.some((i) => i.path === "/change-log"))).toBe(true);
  });

  it("OFF: Change Log is removed from the nav and no other item is touched", () => {
    const filtered = visibleNav(false);
    expect(filtered.some((g) => g.items.some((i) => i.path === "/change-log"))).toBe(false);
    const countAll = NAV.reduce((a, g) => a + g.items.length, 0);
    const countFiltered = filtered.reduce((a, g) => a + g.items.length, 0);
    expect(countFiltered).toBe(countAll - DEVELOPER_TOOL_PATHS.length);
    // No empty group stubs left behind.
    expect(filtered.every((g) => g.items.length > 0)).toBe(true);
  });

  it("route guard: hidden → redirect to the dashboard, visible → render", () => {
    expect(devToolsRedirect(false)).toBe("/");
    expect(devToolsRedirect(true)).toBeNull();
  });
});
