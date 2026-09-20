import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { emailIsAllowed, ALLOWED_EMAIL_DOMAIN } from "../domain";

// The Edge Function is deployed on its own and cannot import from src/, so it
// carries its own copy of the domain rule. Two copies of a security check are
// exactly how one of them quietly stops matching, so this test reads the real
// deployed file and pins them together.
const SRC = readFileSync("supabase/functions/drive-oauth/index.ts", "utf8");

describe("the Edge Function's copy of the domain rule", () => {
  it("names the same domain", () => {
    expect(SRC).toContain(`const ALLOWED_EMAIL_DOMAIN = "${ALLOWED_EMAIL_DOMAIN}";`);
  });

  it("is the same implementation, character for character", () => {
    const body = SRC.slice(SRC.indexOf("export function emailIsAllowed"));
    const deployed = body.slice(0, body.indexOf("\n}") + 2);
    expect(deployed).toBe(`export function emailIsAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}`);
    // And the shared one still behaves that way, so the pinned text is not
    // pinning something stale.
    expect(emailIsAllowed("felix@unitedceres.edu.sg")).toBe(true);
    expect(emailIsAllowed("attacker@unitedceres.edu.sg.example.com")).toBe(false);
  });

  it("checks the caller before reaching Google or any secret", () => {
    const authAt = SRC.indexOf("supabase.auth.getUser(bearer)");
    const secretAt = SRC.indexOf('Deno.env.get("GOOGLE_CLIENT_SECRET")', SRC.indexOf("Deno.serve"));
    const googleAt = SRC.indexOf("callGoogleToken({", SRC.indexOf("Deno.serve"));
    expect(authAt).toBeGreaterThan(0);
    expect(authAt).toBeLessThan(secretAt);
    expect(authAt).toBeLessThan(googleAt);
  });

  it("refuses a caller with no bearer token, and one whose domain is wrong", () => {
    expect(SRC).toContain('if (!bearer) return json({ error: "Sign in with your United Ceres Google account." }, 401);');
    expect(SRC).toMatch(/if \(!emailIsAllowed\(email\)\) \{[\s\S]*?\}, 403\);/);
  });
});
