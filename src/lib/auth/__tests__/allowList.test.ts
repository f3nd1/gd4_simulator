import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAllowList, notOnListMessage } from "../allowList";

// A stand-in for the one query checkAllowList makes, capturing the filter so
// the lower-casing is pinned: addresses are typed by hand into the dashboard,
// and a case mismatch here would lock out a person who IS on the list.
function client(answer: { data: unknown; error: { message: string } | null }) {
  const seen: { column?: string; value?: string } = {};
  const c = {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => {
          seen.column = column; seen.value = value;
          return { maybeSingle: () => Promise.resolve(answer) };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { c, seen };
}

describe("checking the allow-list", () => {
  it("lets in a person whose row comes back", async () => {
    const { c } = client({ data: { email: "felix@unitedceres.edu.sg" }, error: null });
    expect(await checkAllowList(c, "felix@unitedceres.edu.sg")).toEqual({ allowed: true });
  });

  it("refuses a UCC address with no row — zero rows is the answer, not an error", async () => {
    const { c } = client({ data: null, error: null });
    expect(await checkAllowList(c, "student@unitedceres.edu.sg")).toEqual({ allowed: false });
  });

  it("asks about the lower-cased address, against the generated column", async () => {
    const { c, seen } = client({ data: null, error: null });
    await checkAllowList(c, "  Felix@UnitedCeres.edu.SG ");
    expect(seen.column).toBe("email_lc");
    expect(seen.value).toBe("felix@unitedceres.edu.sg");
  });

  it("says 'unknown' rather than 'refused' when the question could not be asked", async () => {
    const { c } = client({ data: null, error: { message: "network down" } });
    expect(await checkAllowList(c, "felix@unitedceres.edu.sg")).toEqual({ allowed: "unknown", reason: "network down" });
  });

  it("treats a thrown error the same way", async () => {
    const c = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    expect(await checkAllowList(c, "felix@unitedceres.edu.sg")).toEqual({ allowed: "unknown", reason: "boom" });
  });
});

describe("what a refused person reads", () => {
  const msg = notOnListMessage("student@unitedceres.edu.sg");

  it("names the address they used, so they can tell they picked the wrong account", () => {
    expect(msg).toContain("student@unitedceres.edu.sg");
  });

  it("never promises an approval that is not coming", () => {
    expect(msg.toLowerCase()).not.toContain("pending");
    expect(msg.toLowerCase()).not.toContain("waiting");
    expect(msg.toLowerCase()).not.toContain("request");
  });

  it("reveals nothing about what is inside", () => {
    for (const leak of ["finding", "student record", "evidence", "audit cycle", "scorecard", "drive"]) {
      expect(msg.toLowerCase()).not.toContain(leak);
    }
  });
});
