// The checklist-verdict blob is the one store deliberately not mirrored into
// localStorage: a full sweep is 754 entries and its caps allow a 2000-character
// rationale plus a 1000-character quote each, which can fill a browser's 5 MB
// origin quota on its own. Lowering those caps was the wrong fix - they exist
// because clipped rationales were unreadable and the text is recoverable
// nowhere else.
//
// The exemption is only safe while Supabase is actually available. Without it,
// localStorage IS the persistence, and skipping it would be data loss rather
// than a saving. That condition is what this pins.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSupabaseClient = vi.fn();
vi.mock("../../lib/supabaseClient", () => ({ getSupabaseClient: () => getSupabaseClient() }));

const { workspaceStorage } = await import("../supabaseStorage");

const VERDICTS = "ucc-gd4-checklist-verdicts:v1";
const WORKSPACE = "ucc-gd4-workspace:v3";

let store: Map<string, string>;
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

beforeEach(() => {
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true, writable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
});
afterEach(() => {
  getSupabaseClient.mockReset();
  if (realLocalStorage === undefined) Reflect.deleteProperty(globalThis as object, "localStorage");
  else Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: realLocalStorage });
});

// A Supabase client stub that accepts an upsert and never resolves the network.
const fakeClient = () => ({ from: () => ({ upsert: async () => ({ error: null }) }) });

describe("checklist verdicts are not mirrored into localStorage", () => {
  it("skips the local copy while Supabase is available", () => {
    getSupabaseClient.mockReturnValue(fakeClient());
    void workspaceStorage!.setItem(VERDICTS, { state: { entries: { a: 1 } }, version: 0 });
    expect(store.has(VERDICTS)).toBe(false);
  });

  it("STILL writes it locally when Supabase is not configured, because then local is all there is", () => {
    getSupabaseClient.mockReturnValue(null);
    void workspaceStorage!.setItem(VERDICTS, { state: { entries: { a: 1 } }, version: 0 });
    expect(store.get(VERDICTS)).toContain("entries");
  });

  it("leaves every other store's local cache alone", () => {
    getSupabaseClient.mockReturnValue(fakeClient());
    void workspaceStorage!.setItem(WORKSPACE, { state: { auditors: [{ name: "A" }] }, version: 10 });
    expect(store.get(WORKSPACE)).toContain("auditors");
  });
});
