// The wording rules must reach BOTH judge prompts, and the examples inside them
// must obey the rules they teach.
//
// A few-shot example that breaks its own rule is the likeliest reason a live
// model ignores the rule, so the exemplars are asserted here rather than
// trusted. The prompts are read from the built source because the prompt
// strings are assembled inside functions that need a live run to call.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../agentRuntime.ts", import.meta.url), "utf8");
const RULES = SRC.slice(
  SRC.indexOf("const NARRATIVE_STYLE_RULES"),
  SRC.indexOf("const POSITIVE_CONCLUSION_PATTERNS"),
);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function examples(kind: "GOOD" | "BAD"): { label: string; text: string }[] {
  return [...RULES.matchAll(/(GOOD|BAD)([^:]*): "(.+?)"\n/g)]
    .filter((m) => m[1] === kind)
    .map((m) => ({ label: m[2].trim(), text: m[3] }));
}

describe("the wording rules reach both judges", () => {
  // Injected by reference, so a rename or a deletion fails here rather than
  // silently dropping the rules from a prompt nobody re-reads.
  it("is injected into the evidence judge prompt", () => {
    const judge = SRC.slice(SRC.indexOf("deciding whether a PEI IMPLEMENTS"));
    const contract = judge.indexOf('{"results": [{"ref": string, "evidenceSummary"');
    expect(contract).toBeGreaterThan(-1);
    expect(judge.slice(0, contract)).toContain("${NARRATIVE_STYLE_RULES}");
  });

  it("is injected into the PPD judge prompt", () => {
    const judge = SRC.slice(SRC.indexOf("suggestedRewrite: for Partial/Not documented ONLY"));
    expect(judge.slice(0, 3000)).toContain("${NARRATIVE_STYLE_RULES.replace(");
  });

  it("is injected exactly twice, so a third copy cannot drift", () => {
    expect(SRC.split("${NARRATIVE_STYLE_RULES").length - 1).toBe(2);
  });

  // Scoping is load-bearing: evidenceSummary and shortComment feed the band
  // digest's 160-character note, so putting them under these rules would change
  // what the band sees, which is a scoring change.
  it("names only the four fields it is scoped to", () => {
    expect(RULES).toContain('"comment" and "suggestedAction"');
    expect(RULES).not.toContain("evidenceSummary");
    expect(RULES).not.toContain("shortComment");
  });
});

describe("the exemplars obey the rules they teach", () => {
  it("every GOOD 'Why' example sits in the 35 to 75 word range", () => {
    for (const e of examples("GOOD").filter((x) => words(x.text) > 30)) {
      expect(words(e.text), `${e.label}: ${words(e.text)} words`).toBeGreaterThanOrEqual(35);
      expect(words(e.text), `${e.label}: ${words(e.text)} words`).toBeLessThanOrEqual(75);
    }
  });

  it("every GOOD 'What to fix' example sits in the 20 to 55 word range", () => {
    for (const e of examples("GOOD").filter((x) => words(x.text) <= 30)) {
      expect(words(e.text), `${e.label}: ${words(e.text)} words`).toBeGreaterThanOrEqual(20);
      expect(words(e.text), `${e.label}: ${words(e.text)} words`).toBeLessThanOrEqual(55);
    }
  });

  it("no GOOD example opens with a clause the rules ban", () => {
    for (const e of examples("GOOD")) {
      expect(e.text).not.toMatch(/^(Although|While|Despite|With the PPD assessed as)\b/i);
    }
  });

  it("no GOOD example supplies a copyable invented document code", () => {
    for (const e of examples("GOOD")) {
      expect(e.text, e.label).not.toMatch(/\b[A-Z]{2,}-[A-Z0-9-]{2,}\b/);
    }
  });

  it("the rules contain no em dash, which they themselves forbid", () => {
    expect(RULES).not.toContain("—");
  });

  it("a stated word count in an example label matches the example", () => {
    for (const e of examples("GOOD")) {
      const stated = e.label.match(/(\d+)\s+words/);
      if (stated) expect(words(e.text), e.label).toBe(Number(stated[1]));
    }
  });

  it("still shows a BAD example for each field, so the contrast survives", () => {
    expect(examples("BAD").length).toBeGreaterThanOrEqual(2);
  });
});
