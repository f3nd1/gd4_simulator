import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { appendFullCall, DOC_TEXT_WARNING, type FullCallText } from "../aiRunLogExport";
import { lastAdminVerdict, noteAdminVerdict } from "../auth/adminGrants";

const text = (n: string) => ({ prompt: `prompt ${n}`, response: `response ${n}` });

describe("appendFullCall", () => {
  it("appends within a pass without dropping anything", () => {
    let e: FullCallText[] = [];
    e = appendFullCall(e, { seq: 1, pass: "procedure/extract" }, text("a"));
    e = appendFullCall(e, { seq: 2, pass: "procedure/extract" }, text("b"));
    e = appendFullCall(e, { seq: 3, pass: "procedure/judge" }, text("c"));
    expect(e.map((x) => x.seq)).toEqual([1, 2, 3]);
  });

  it("keeps the procedure pass when the records pass starts", () => {
    let e: FullCallText[] = [];
    e = appendFullCall(e, { seq: 1, pass: "procedure/extract" }, text("a"));
    e = appendFullCall(e, { seq: 2, pass: "procedure/judge" }, text("b"));
    // A new invocation: the records pass numbers its own calls from 1.
    e = appendFullCall(e, { seq: 1, pass: "records/extract" }, text("c"));
    expect(e.map((x) => x.pass)).toEqual(["procedure/extract", "procedure/judge", "records/extract"]);
  });

  it("drops the previous run of the SAME pass, so two runs never interleave", () => {
    let e: FullCallText[] = [];
    e = appendFullCall(e, { seq: 1, pass: "procedure/extract" }, text("run1-a"));
    e = appendFullCall(e, { seq: 2, pass: "procedure/judge" }, text("run1-b"));
    e = appendFullCall(e, { seq: 1, pass: "records/extract" }, text("run1-c"));
    // The toggle stayed on and the same area is checked again.
    e = appendFullCall(e, { seq: 1, pass: "procedure/extract" }, text("run2-a"));
    expect(e.map((x) => x.prompt)).toEqual(["prompt run1-c", "prompt run2-a"]);
    // And no call number appears twice within a pass family.
    const proc = e.filter((x) => x.pass.startsWith("procedure/"));
    expect(new Set(proc.map((x) => x.seq)).size).toBe(proc.length);
  });

  it("carries the prompt and response text through unchanged", () => {
    const e = appendFullCall([], { seq: 1, pass: "records/judge" }, { prompt: "P", response: "R" });
    expect(e).toEqual([{ seq: 1, pass: "records/judge", prompt: "P", response: "R" }]);
  });
});

describe("lastAdminVerdict", () => {
  // Order matters: the default is the refusal, so a fresh tab captures nothing
  // until useSession has actually confirmed an admin.
  beforeEach(() => { noteAdminVerdict(false); });

  it("defaults to refusing", () => {
    expect(lastAdminVerdict()).toBe(false);
  });

  it("reports what useSession last published, both ways", () => {
    noteAdminVerdict(true);
    expect(lastAdminVerdict()).toBe(true);
    noteAdminVerdict(false);
    expect(lastAdminVerdict()).toBe(false);
  });
});

describe("the warning sentence", () => {
  it("names the document text, because that is the whole point of it", () => {
    expect(DOC_TEXT_WARNING).toMatch(/document text/i);
  });
});

// The point of the gate is that it is NOT the hidden checkbox. Same style of
// pin as the Layout route guard in auth/__tests__/pageAccess.test.ts: if the
// refusal moves out of the store and back onto the page, this fails, because
// hiding a control on a page a process owner is given the address of protects
// nothing.
describe("full capture is refused, not only hidden", () => {
  const STORE = readFileSync("src/store/useWorkspaceStore.ts", "utf8");
  const PAGE = readFileSync("src/pages/SelfCheck.tsx", "utf8");

  it("refuses to collect any text unless the session is admin", () => {
    const collector = STORE.slice(STORE.indexOf("function collectFullText"));
    expect(collector.slice(0, 400)).toMatch(/if \(!lastAdminVerdict\(\)\) return;/);
  });

  it("refuses to arm, so the flag cannot be set another way", () => {
    const arm = STORE.slice(STORE.indexOf("setCaptureFullPrompts: (on)"));
    expect(arm.slice(0, 900)).toMatch(/if \(on && !lastAdminVerdict\(\)\)/);
  });

  it("refuses to hand the text over on download", () => {
    expect(STORE).toMatch(/fullText: lastAdminVerdict\(\) &&/);
  });

  it("never persists the flag, so a reload is the other off switch", () => {
    expect(STORE).toMatch(/captureFullPrompts: false,/);
  });

  it("still hides the control from a process owner, as the explanation", () => {
    expect(PAGE).toMatch(/\{area && sessionIsAdmin && \(/);
  });

  it("says what the download contains on the run banner and the download, not only the toggle", () => {
    // Three uses of the one constant: toggle label, run banner, download card.
    expect([...PAGE.matchAll(/DOC_TEXT_WARNING/g)].length).toBeGreaterThanOrEqual(4);
    expect(PAGE).toMatch(/Recording the full prompts for this check/);
    expect(PAGE).toMatch(/This log includes the full prompts/);
  });
});

// A stale "true" is the dangerous direction: an admin signs out, a process
// owner signs in on the same machine, and the capture is still running. So
// every state that is NOT a confirmed admin has to publish the refusal.
describe("useSession publishes the verdict on every non-admin state", () => {
  const SRC = readFileSync("src/lib/auth/useSession.ts", "utf8");
  const NOT_SIGNED_IN = ["signed-out", "wrong-domain", "not-on-list", "check-failed"];

  it.each(NOT_SIGNED_IN)("sets it false alongside status %s", (status) => {
    // setState lines only: the AuthState union above names the same statuses.
    const lines = SRC.split("\n").filter((l) => l.includes("setState(") && l.includes(`status: "${status}"`));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l.trim()).toContain("noteAdminVerdict(false)");
  });

  it("publishes the real answer on the signed-in state", () => {
    expect(SRC).toMatch(/noteAdminVerdict\(admin\);\s*\n\s*setState\(\{ status: "signed-in"/);
  });
});
