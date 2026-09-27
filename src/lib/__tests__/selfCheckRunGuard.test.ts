import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");
const LAYOUT = readFileSync("src/components/layout/Layout.tsx", "utf8");

// A run is this page's own JavaScript: no server carries it on, and a pass
// writes its result only when it finishes. Four or five minutes of work and of
// OpenAI spend go with the tab. Both halves of the guard are pinned because
// either one alone is a silent regression: the on-screen line only helps
// somebody watching, and the prompt only fires if it is registered.
describe("the self-check guards a run in progress", () => {
  it("asks the browser to confirm a close or reload, but only while running", () => {
    expect(PAGE).toContain('window.addEventListener("beforeunload", onUnload)');
    const handler = PAGE.slice(PAGE.indexOf("const onUnload = (e: BeforeUnloadEvent)"), PAGE.indexOf('window.addEventListener("beforeunload"'));
    // The early return is what keeps the prompt off an idle page.
    expect(handler).toMatch(/if \(!running\) return;/);
    expect(handler).toMatch(/e\.preventDefault\(\)/);
    expect(handler).toMatch(/e\.returnValue = ""/);
  });

  it("flushes pending saves on every unload, not only during a run", () => {
    const handler = PAGE.slice(PAGE.indexOf("const onUnload = (e: BeforeUnloadEvent)"), PAGE.indexOf('window.addEventListener("beforeunload"'));
    // Before the running check, or a close on an idle page loses the debounced
    // write the Layout would have flushed on any other page.
    expect(handler.indexOf("flushPendingSaves")).toBeLessThan(handler.indexOf("if (!running) return;"));
  });

  it("does not rely on the Layout's flush, which this page never gets", () => {
    // /self-check renders outside the Layout on purpose (see pageAccess.ts), so
    // the Layout's own beforeunload never runs for it. If that ever changes,
    // this page's copy becomes a duplicate worth removing.
    expect(LAYOUT).toContain('window.addEventListener("beforeunload", onUnload)');
    expect(readFileSync("src/App.tsx", "utf8").split("<Route element={<Layout />}>")[0]).toContain('path="/self-check"');
  });

  it("says on screen what the prompt cannot: browsers show their own wording", () => {
    expect(PAGE).toMatch(/Keep this tab open\./);
    expect(PAGE).toMatch(/stops the check, and the pass it is on is lost/);
  });

  it("puts that line where a phone still shows it", () => {
    // .sc-proc-hint is display:none below 900px. The warning must not live
    // there, and must not be a third stacked bar competing with the privacy
    // notice.
    const warning = PAGE.slice(PAGE.indexOf('className="sc-keepopen"'));
    expect(warning.slice(0, 400)).not.toContain("sc-proc-hint");
    expect(PAGE).toMatch(/\.sc-keepopen\{[^}]*\}/);
    const css = PAGE.match(/"\.sc-keepopen\{[^}]*\}"/)![0];
    expect(css).not.toContain("display:none");
  });
});

// One is a notice about what is being recorded, the other is how far the run
// has got. They were two stacked rounded boxes and read as one status block.
describe("the privacy notice does not look like progress", () => {
  const privacyCss = PAGE.match(/"\.sc-privacy\{[^}]*\}"/)![0];
  const headCss = PAGE.match(/"\.sc-proc-head\{[^}]*\}"/)![0];

  it("carries a heavy left rule the progress head does not", () => {
    expect(privacyCss).toMatch(/border-left:\d+px solid/);
    expect(headCss).not.toContain("border-left");
  });

  it("names itself as a notice rather than a status line", () => {
    expect(PAGE).toContain('role="note"');
    expect(PAGE).toContain("Privacy notice");
  });

  it("keeps real air between the two, so they do not read as one block", () => {
    const margin = privacyCss.match(/margin-bottom:(\d+)px/);
    expect(margin, privacyCss).not.toBeNull();
    expect(Number(margin![1])).toBeGreaterThanOrEqual(12);
  });

  it("leaves the progress head neutral, with nothing amber borrowed from it", () => {
    expect(headCss).toContain("#f8fafc");
    expect(headCss).not.toMatch(/fffbeb|92400e|b45309/);
  });
});
