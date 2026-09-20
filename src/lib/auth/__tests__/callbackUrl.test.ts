import { describe, it, expect } from "vitest";
import { planCallbackUrl } from "../callbackUrl";

const APP = "https://apps.unitedceres.edu.sg/gd4_simulator/";
const TOKEN = "access_token=eyJhbGc.eyJzdWI.sig&refresh_token=r&token_type=bearer&expires_in=3600";

describe("planCallbackUrl", () => {
  it("drops a stale query error when a real session arrived in the fragment", () => {
    // The exact URL Felix landed on.
    const plan = planCallbackUrl(`${APP}?error=server_error&error_description=Unable+to+exchange+external+code#${TOKEN}`);
    expect(plan.cleanedHref).toBe(`${APP}#${TOKEN}`);
    expect(plan.staleErrorRemoved).toBe("Unable to exchange external code");
    // Not shown to the user: it did not happen on this sign-in.
    expect(plan.signInError).toBeNull();
  });

  it("keeps every other query parameter while dropping the error", () => {
    const plan = planCallbackUrl(`${APP}?keep=yes&error=server_error&error_description=x#${TOKEN}`);
    expect(plan.cleanedHref).toBe(`${APP}?keep=yes#${TOKEN}`);
  });

  it("does the same for a PKCE success, where the code is in the query", () => {
    const plan = planCallbackUrl(`${APP}?code=abc123&error=server_error&error_description=stale`);
    expect(plan.cleanedHref).toBe(`${APP}?code=abc123`);
    expect(plan.signInError).toBeNull();
  });

  it("SHOWS a real failure, which is one with no session alongside it", () => {
    // Implicit failures come back in the fragment.
    expect(planCallbackUrl(`${APP}#error=access_denied&error_description=User+refused`).signInError).toBe("User refused");
    // A PKCE failure comes back in the query, with no code.
    expect(planCallbackUrl(`${APP}?error=server_error&error_description=Unable+to+exchange+external+code`).signInError)
      .toBe("Unable to exchange external code");
    // And neither rewrites the URL: there is nothing to rescue.
    expect(planCallbackUrl(`${APP}#error=access_denied`).cleanedHref).toBeNull();
  });

  it("leaves an ordinary URL completely alone", () => {
    for (const href of [APP, `${APP}#/self-check`, `${APP}#/findings?item=6.3.1`, `${APP}?x=1`]) {
      expect(planCallbackUrl(href)).toEqual({ cleanedHref: null, staleErrorRemoved: null, signInError: null });
    }
  });

  it("does not choke on a hash that is not a query string", () => {
    expect(planCallbackUrl(`${APP}#/evidence-folder?run=EV-6.3-XXXX`).cleanedHref).toBeNull();
    expect(planCallbackUrl("not a url")).toEqual({ cleanedHref: null, staleErrorRemoved: null, signInError: null });
  });

  it("prefers error_description, falling back to error when there is no description", () => {
    expect(planCallbackUrl(`${APP}#error=access_denied`).signInError).toBe("access_denied");
    expect(planCallbackUrl(`${APP}?error=bad#${TOKEN}`).staleErrorRemoved).toBe("bad");
  });
});
