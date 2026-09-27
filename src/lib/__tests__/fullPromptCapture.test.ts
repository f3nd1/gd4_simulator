import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { appendFullCall, buildAiRunLog, DOC_TEXT_WARNING, type FullCallText } from "../aiRunLogExport";
import type { AiCallRecord, PPDReviewResult } from "../../types";
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

  // This USED to assert a per-call `if (!lastAdminVerdict()) return;` inside
  // collectFullText, and that check was the bug: lastAdminVerdict starts false
  // and only turns true after useSession has awaited two network calls, so a
  // run begun before that resolves captured nothing and said nothing. Measured
  // on three real 6.2 runs: 20 of 43 calls, missing every judge call. The
  // contract now is that the collector is unconditional and the gate lives at
  // the two places that are reliable: arming and download.
  it("does NOT re-check the admin verdict per call, because that check lost text", () => {
    const collector = STORE.slice(STORE.indexOf("function collectFullText"));
    // Code lines only: the comment in there quotes the check it removed.
    const code = collector.slice(0, collector.indexOf("\n}")).split("\n")
      .filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/lastAdminVerdict/);
  });

  it("collects only while the flag is on, at every call site", () => {
    const sites = [...STORE.matchAll(/^.*collectFullText\(subCriterionId.*$/gm)].map((m) => m[0]);
    expect(sites.length).toBeGreaterThanOrEqual(5);
    for (const l of sites) expect(l, l.trim()).toContain("get().captureFullPrompts");
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

// The shortfall that cost the diagnosis. An incomplete capture looks exactly
// like a complete one until somebody tries to use it, so the file has to count
// itself and say so.
describe("the export counts its own capture", () => {
  const call = (seq: number, pass: string): AiCallRecord => ({
    seq, pass, label: "l", startedAt: 1759000000000, durationMs: 10,
    outcome: "ok", promptChars: 1, responseChars: 1,
  });
  const ppd = (calls: AiCallRecord[]) => ({ aiCallLog: calls } as unknown as PPDReviewResult);

  it("says nothing when every call's text is present", () => {
    const calls = [call(1, "procedure/extract"), call(2, "procedure/judge")];
    const log = buildAiRunLog({
      area: "6.2", ppd: ppd(calls),
      fullText: calls.map((c) => ({ seq: c.seq, pass: c.pass, prompt: "p", response: "r" })),
    });
    expect(log.passes[0].textCaptured).toEqual({ of: 2, captured: 2, missing: 0 });
    expect(log.captureShortfall).toBeUndefined();
  });

  it("names the missing calls and the pass they belong to", () => {
    const calls = [call(1, "procedure/extract"), call(2, "procedure/judge")];
    const log = buildAiRunLog({
      area: "6.2", ppd: ppd(calls),
      fullText: [{ seq: 1, pass: "procedure/extract", prompt: "p", response: "r" }],
    });
    expect(log.passes[0].textCaptured).toEqual({ of: 2, captured: 1, missing: 1 });
    expect(log.captureShortfall).toMatch(/1 of 2 calls have no text/);
    expect(log.captureShortfall).toMatch(/procedure 1/);
    expect(log.captureShortfall).toMatch(/not.*complete record/i);
  });

  it("reports no capture counts at all when capture was off", () => {
    const log = buildAiRunLog({ area: "6.2", ppd: ppd([call(1, "procedure/extract")]) });
    expect(log.fullPromptsIncluded).toBe(false);
    expect(log.passes[0].textCaptured).toBeUndefined();
    expect(log.captureShortfall).toBeUndefined();
  });
});

// Same fault as an empty answer logged as ok: a record asserting completeness
// it does not have. The PPD extract stage logged its skips and its failures
// and never its successes, so a run that went perfectly recorded nothing there
// and its whole duration fell into "Unaccounted".
describe("every extract stage logs its successes", () => {
  const SRC = readFileSync("src/lib/ai/agentRuntime.ts", "utf8");

  it("logs ok on both extract paths, not only on the records one", () => {
    expect([...SRC.matchAll(/log\("ok", content\);/g)].length).toBe(2);
  });

  it("logs it after the parse guard, so an unreadable reply is still failed", () => {
    for (const m of SRC.matchAll(/log\("ok", content\);/g)) {
      const before = SRC.slice(Math.max(0, m.index! - 400), m.index!);
      expect(before).toContain('log("failed", content, "The AI reply was empty or not valid JSON.");');
    }
  });
});
