import { describe, it, expect } from "vitest";
import { effectiveSettings } from "../aiClient";
import type { AISettings } from "../../../types";

const base: AISettings = {
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-5-mini",
  utilityModel: "gpt-5-nano",
  visionModel: "gpt-5-nano",
  enabled: true,
};

describe("effectiveSettings — per-call model routing", () => {
  it("analysis uses the smart model; utility uses the utility model", () => {
    expect(effectiveSettings(base, { purpose: "analysis" }).model).toBe("gpt-5-mini");
    expect(effectiveSettings(base, { purpose: "utility" }).model).toBe("gpt-5-nano");
  });

  it("vision uses the explicit visionModel when set", () => {
    const s = { ...base, visionModel: "gpt-4o" };
    expect(effectiveSettings(s, { purpose: "vision" }).model).toBe("gpt-4o");
  });

  it("vision falls back to the utility model when visionModel is unset (behaviour unchanged from before the setting existed)", () => {
    const { visionModel: _omit, ...noVision } = base;
    void _omit;
    expect(effectiveSettings(noVision as AISettings, { purpose: "vision" }).model).toBe("gpt-5-nano");
  });

  it("vision falls back to the analysis model when neither vision nor utility is set", () => {
    const s: AISettings = { provider: "openai", apiKey: "sk", model: "gpt-5", utilityModel: "", enabled: true };
    expect(effectiveSettings(s, { purpose: "vision" }).model).toBe("gpt-5");
  });

  it("merges the School Context briefing without mutating the base", () => {
    const s = effectiveSettings(base, { purpose: "vision", context: "UCC background" });
    expect(s.context).toBe("UCC background");
    expect(base.context).toBeUndefined();
  });
});
