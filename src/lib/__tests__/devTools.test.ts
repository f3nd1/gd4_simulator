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

// The People page is admin-only. The sidebar and the Help page both derive
// from NAV, so listing it to somebody who will be refused is a dead end in
// two places at once. This is convenience, not protection: the insert and
// delete policies on allowed_users are what actually refuse.
describe("admin-only routes in the nav", () => {
  const allPathsOf = (groups: ReturnType<typeof visibleNav>) =>
    groups.flatMap((g) => [...g.items, ...(g.tools ?? [])]).map((i) => i.path);

  it("shows the People page to the admin", () => {
    expect(allPathsOf(visibleNav(true, true))).toContain("/people");
  });

  it("hides it from everybody else, developer tools on or off", () => {
    expect(allPathsOf(visibleNav(true, false))).not.toContain("/people");
    expect(allPathsOf(visibleNav(false, false))).not.toContain("/people");
  });

  it("still hides the developer pages independently of who you are", () => {
    expect(allPathsOf(visibleNav(false, true))).not.toContain("/change-log");
    expect(allPathsOf(visibleNav(false, true))).toContain("/people");
  });
});

// The sidebar's stage label drops the leading number, because the number
// moved into the stage chip. NAV itself is untouched, so the Dashboard
// stepper and the Help page still read g.group and g.step as before.
describe("stage names in the sidebar", () => {
  const stageName = (group: string) => group.replace(/^\d+\s*·\s*/, "");

  it("strips the number from a numbered stage, and leaves the others alone", () => {
    expect(stageName("1 · Set up")).toBe("Set up");
    expect(stageName("4 · Close out")).toBe("Close out");
    expect(stageName("Home")).toBe("Home");
    expect(stageName("Settings")).toBe("Settings");
  });

  it("leaves NAV's own group names carrying their numbers", () => {
    // The Dashboard's getting-started stepper keys off these.
    expect(NAV.filter((g) => g.step != null).map((g) => g.group))
      .toEqual(["1 · Set up", "2 · Audit & evidence", "3 · Findings & review", "4 · Close out"]);
  });
});
