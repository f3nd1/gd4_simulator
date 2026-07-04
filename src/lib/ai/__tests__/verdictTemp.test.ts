import { describe, it, expect } from "vitest";
import { verdictTemp } from "../aiClient";
import { DEFAULT_VERDICT_TEMPERATURE } from "../../../store/useAISettingsStore";

describe("verdictTemp — the tunable temperature for verdict-deciding calls", () => {
  it("returns the configured value when in [0,1]", () => {
    expect(verdictTemp({ verdictTemperature: 0 })).toBe(0);
    expect(verdictTemp({ verdictTemperature: 0.1 })).toBe(0.1);
    expect(verdictTemp({ verdictTemperature: 0.7 })).toBe(0.7);
    expect(verdictTemp({ verdictTemperature: 1 })).toBe(1);
  });
  it("falls back to 0.1 when unset or out of range (older persisted settings)", () => {
    expect(verdictTemp({ verdictTemperature: undefined })).toBe(0.1);
    expect(verdictTemp({})).toBe(0.1);
    expect(verdictTemp({ verdictTemperature: -0.5 })).toBe(0.1);
    expect(verdictTemp({ verdictTemperature: 2 })).toBe(0.1);
  });
  it("its fallback matches the store's default constant", () => {
    expect(verdictTemp({})).toBe(DEFAULT_VERDICT_TEMPERATURE);
  });
});
