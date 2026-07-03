import { describe, it, expect } from "vitest";
import { filterModelSuggestions } from "../modelPicker";

const MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.4-mini", "gpt-5.4-mini-2026-03-17", "gpt-4o"];

describe("filterModelSuggestions", () => {
  it("shows the full list when the field is empty (browsing)", () => {
    expect(filterModelSuggestions(MODELS, "")).toEqual(MODELS);
    expect(filterModelSuggestions(MODELS, "   ")).toEqual(MODELS);
  });
  it("shows the full list when the value is already an exact suggestion — so a picked model can be swapped", () => {
    expect(filterModelSuggestions(MODELS, "gpt-5-mini")).toEqual(MODELS);
    expect(filterModelSuggestions(MODELS, "GPT-5-MINI")).toEqual(MODELS); // case-insensitive exact match
  });
  it("narrows by substring, case-insensitively, while typing", () => {
    expect(filterModelSuggestions(MODELS, "5.4")).toEqual(["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"]);
    expect(filterModelSuggestions(MODELS, "NANO")).toEqual(["gpt-5-nano"]);
  });
  it("returns empty for a brand-new id not in the list (free typing still allowed by the field)", () => {
    expect(filterModelSuggestions(MODELS, "gpt-9-preview")).toEqual([]);
  });
});
