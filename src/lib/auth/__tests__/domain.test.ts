import { describe, it, expect } from "vitest";
import { emailIsAllowed, ALLOWED_EMAIL_DOMAIN } from "../domain";

describe("emailIsAllowed", () => {
  it("lets a UCC address in, whatever the case", () => {
    expect(emailIsAllowed("felix@unitedceres.edu.sg")).toBe(true);
    expect(emailIsAllowed("Felix.Tan@UnitedCeres.Edu.SG")).toBe(true);
  });

  it("keeps everyone else out", () => {
    for (const e of ["someone@gmail.com", "felix@unitedceres.edu", "", null, undefined, "felix", "@unitedceres.edu.sg"]) {
      expect(emailIsAllowed(e)).toBe(false);
    }
  });

  it("is not fooled by a lookalike domain", () => {
    // The tail must be the whole domain, not a substring of it: a "contains"
    // check would let both of these through.
    expect(emailIsAllowed("attacker@unitedceres.edu.sg.example.com")).toBe(false);
    expect(emailIsAllowed("attacker@notunitedceres.edu.sg")).toBe(false);
    expect(emailIsAllowed("unitedceres.edu.sg@gmail.com")).toBe(false);
  });

  it("uses an address with more than one @ by its LAST one, as mail does", () => {
    expect(emailIsAllowed('"odd@name"@unitedceres.edu.sg')).toBe(true);
    expect(emailIsAllowed('"a@unitedceres.edu.sg"@gmail.com')).toBe(false);
  });

  it("names the domain once", () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe("unitedceres.edu.sg");
  });
});
