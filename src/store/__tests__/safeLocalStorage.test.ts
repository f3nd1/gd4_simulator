// A full localStorage must cost persistence, never the session.
//
// zustand's persist calls storage.setItem synchronously inside setState, so a
// QuotaExceededError from a raw `localStorage` adapter propagates out of the
// action and blanks the whole app. Reproduced live: with the quota exhausted,
// useFindingDraftStore's raw adapter threw on load and the page rendered empty,
// which is what hid Felix's auditor even after the row was saved correctly.
import { describe, it, expect, afterEach } from "vitest";
import { safeLocalStorage } from "../supabaseStorage";

// Node environment: there is no DOM Storage, so localStorage is stubbed
// directly. The behaviour under test is the try/catch, not the browser.
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
function installStorage(impl: Partial<Storage>) {
  Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true, writable: true });
}
function workingStorage() {
  const map = new Map<string, string>();
  installStorage({
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } as Partial<Storage>);
}
function fullDisk() {
  installStorage({
    getItem: () => null,
    setItem: () => { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; },
    removeItem: () => {},
  } as Partial<Storage>);
}
afterEach(() => {
  if (realLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis as object, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", { value: realLocalStorage, configurable: true, writable: true });
  }
});

describe("safeLocalStorage", () => {
  it("does not throw when the quota is exhausted", () => {
    fullDisk();
    expect(() => safeLocalStorage.setItem("k", "v")).not.toThrow();
  });

  it("still writes normally when there is room", () => {
    workingStorage();
    safeLocalStorage.setItem("ucc-test-key", "hello");
    expect(safeLocalStorage.getItem("ucc-test-key")).toBe("hello");
    safeLocalStorage.removeItem("ucc-test-key");
    expect(safeLocalStorage.getItem("ucc-test-key")).toBeNull();
  });

  it("survives a storage that throws on read or remove too", () => {
    installStorage({
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => {},
      removeItem: () => { throw new Error("SecurityError"); },
    } as Partial<Storage>);
    expect(safeLocalStorage.getItem("k")).toBeNull();
    expect(() => safeLocalStorage.removeItem("k")).not.toThrow();
  });
});

// The stores that do NOT sync to Supabase must use it, or they reintroduce the
// crash. Asserted against the real source so a new raw adapter is caught.
describe("no store persists through a raw, throwing localStorage", () => {
  it("useFindingDraftStore, useCalibrationStore and useGuidanceStore use the safe adapter", async () => {
    const fs = await import("node:fs/promises");
    for (const f of ["useFindingDraftStore", "useCalibrationStore", "useGuidanceStore"]) {
      const src = await fs.readFile(new URL(`../${f}.ts`, import.meta.url), "utf8");
      expect(src, `${f} still uses a raw localStorage adapter`).not.toMatch(/createJSONStorage\(\(\)\s*=>\s*localStorage\)/);
      expect(src, `${f} does not use safeLocalStorage`).toMatch(/safeLocalStorage/);
    }
  });
});
