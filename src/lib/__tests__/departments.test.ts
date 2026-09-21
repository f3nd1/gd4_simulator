import { describe, it, expect } from "vitest";
import {
  DEPARTMENT_DIVISION, departmentForScope, departmentPair,
  documentsForScope, primaryDocumentForScope, codeParts,
  policyDocumentViews, scopeDocumentViews, documentStamp,
} from "../departments";
import { POLICY_DOCUMENTS } from "../../data/policyDocuments";
import { GD4_SUB_CRITERIA } from "../../data/gd4Requirements";
import { runScopesForSub } from "../evidenceScope";
import { seedFolders } from "../../data/folders";

const ALL_SCOPES = GD4_SUB_CRITERIA.flatMap((s) => runScopesForSub(s.id));

describe("the register is the source of ownership", () => {
  it("covers all 30 run scopes from real document codes", () => {
    expect(ALL_SCOPES.length).toBe(30);
    for (const scope of ALL_SCOPES) {
      expect(primaryDocumentForScope(scope), `no document for ${scope}`).toBeDefined();
      expect(departmentForScope(scope)).not.toBe("");
    }
  });

  it("maps no document to a scope that is not a real GD4 run scope", () => {
    // A stale scopeId would silently own an area that does not exist.
    const scopes = new Set(ALL_SCOPES);
    for (const d of POLICY_DOCUMENTS) {
      if (d.scopeId) expect(scopes.has(d.scopeId), `${d.code} -> ${d.scopeId}`).toBe(true);
    }
  });

  it("holds the ISMS, PDPA, AIMS and HIRA series without mapping them", () => {
    const unmapped = POLICY_DOCUMENTS.filter((d) => !d.scopeId);
    for (const series of ["ISMS", "PDPA", "AIMS", "HIRA"]) {
      expect(unmapped.some((d) => d.section === series), series).toBe(true);
      expect(POLICY_DOCUMENTS.filter((d) => d.section === series).every((d) => !d.scopeId)).toBe(true);
    }
    // Provider Accreditation and the HIRA head are filed under Criterion 6 in
    // UCC's register, but GD4 Criterion 6 stops at 6.3.
    expect(POLICY_DOCUMENTS.find((d) => d.code === "PPD-OEE-FN-6.4.1")?.scopeId).toBeUndefined();
    expect(POLICY_DOCUMENTS.find((d) => d.code === "PPD-SGL-SQ-6.5.3")?.scopeId).toBeUndefined();
  });

  it("supports more than one document per scope, primary first", () => {
    const docs = documentsForScope("1.1");
    expect(docs.map((d) => d.code)).toEqual(["PPD-SGL-CG-1.1.1", "PPD-OE-FN-1.1.1"]);
    expect(departmentForScope("1.1")).toBe("CG");
  });

  it("keeps PPD-OE-FN-1.1.1 spelled exactly as UCC writes it", () => {
    // The one code that says OE rather than OEE. Normalising it here would
    // stop it matching the document on the shelf.
    expect(POLICY_DOCUMENTS.some((d) => d.code === "PPD-OE-FN-1.1.1")).toBe(true);
    expect(codeParts("PPD-OE-FN-1.1.1")).toEqual({ division: "OE", unit: "FN" });
  });

  it("holds the whole register, and loses no row silently", () => {
    // 62 documents as supplied by the audit lead: 31 cover the 30 GD4 scopes
    // (1.1 has two), and 31 are controlled documents that are not GD4 areas.
    expect(POLICY_DOCUMENTS.length).toBe(62);
    const mapped = POLICY_DOCUMENTS.filter((d) => d.scopeId);
    expect(mapped.length).toBe(31);
    expect(new Set(mapped.map((d) => d.scopeId)).size).toBe(30);
  });

  it("no code is duplicated", () => {
    const codes = POLICY_DOCUMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("puts Partnerships with Curriculum Development, per PPD-ALI-CD-5.3.1", () => {
    // Inferred from the GD4 text this looked like Global Expansion. The
    // document says otherwise, and the document wins.
    expect(departmentForScope("5.3")).toBe("CD");
  });

  it("gives GEP and IG no GD4 scope at all", () => {
    for (const scope of ALL_SCOPES) expect(["GEP", "IG"]).not.toContain(departmentForScope(scope));
  });
});

describe("the seeded folders take those owners", () => {
  it("replaces the old blanket SQ", () => {
    const owners = seedFolders().map((f) => f.owner);
    expect(owners.length).toBe(30);
    expect(owners.every((o) => !!o)).toBe(true);
    // The bug this replaced: 30 of 30 were "SQ", so independenceNotice()
    // warned an SQ auditor everywhere and everyone else nowhere.
    expect(owners.filter((o) => o === "SQ").length).toBe(8);
  });

  it("stores the bare department acronym, never a division pair or a code", () => {
    // independenceNotice() compares this against AuditorProfile.departmentId,
    // which is a bare acronym. A pair or a code here would never match.
    for (const f of seedFolders()) {
      expect(f.owner).not.toContain("-");
      expect(f.owner).not.toMatch(/^PPD/);
    }
  });
});

describe("the division pair", () => {
  it("renders UCC's own form for a department inside a division", () => {
    expect(departmentPair("CG")).toBe("SGL-CG");
    expect(departmentPair("AD")).toBe("SSO-AD");
    expect(departmentPair("HR")).toBe("OEE-HR");
  });

  it("renders a top-level unit alone, which is how UCC writes GEP", () => {
    expect(departmentPair("GEP")).toBe("GEP");
    expect(DEPARTMENT_DIVISION.GEP).toBeUndefined();
  });

  it("is blank for no owner rather than inventing one", () => {
    expect(departmentPair("")).toBe("");
    expect(departmentPair(undefined)).toBe("");
  });

  it("takes the division from the live directory when one is passed", () => {
    expect(departmentPair("CG", () => "XX")).toBe("XX-CG");
    expect(departmentPair("CG", () => undefined)).toBe("CG");
  });

  it("never composes anything shaped like a document code", () => {
    for (const scope of ALL_SCOPES) expect(departmentPair(departmentForScope(scope))).not.toMatch(/^PPD/);
  });
});

describe("version and date are a diff, not a copy", () => {
  it("shows nothing rather than inventing a version", () => {
    const [v] = policyDocumentViews({}, [POLICY_DOCUMENTS[0]]);
    expect(v.version).toBe("");
    expect(v.edited).toBe(false);
    expect(documentStamp(v)).toBe("");
  });

  it("applies an entered version and date to the shipped row", () => {
    const edits = { "PPD-SGL-CG-1.1.1": { version: "V2", updatedAt: "2026-03-14" } };
    const v = policyDocumentViews(edits).find((d) => d.code === "PPD-SGL-CG-1.1.1")!;
    expect(v.title).toBe("Leadership And Corporate Governance");
    expect(v.edited).toBe(true);
    expect(documentStamp(v)).toBe("V2 · 14 Mar 2026");
  });

  it("shows whichever half is filled", () => {
    expect(documentStamp({ version: "V1", updatedAt: "" })).toBe("V1");
    expect(documentStamp({ version: "", updatedAt: "2026-03-14" })).toBe("14 Mar 2026");
  });

  it("carries an edit for a code that is no longer shipped without crashing", () => {
    // The register is data in the bundle; a code removed upstream must not
    // take the whole panel down with it.
    const views = policyDocumentViews({ "PPD-GONE-XX-9.9.9": { version: "V4" } });
    expect(views.length).toBe(POLICY_DOCUMENTS.length);
  });

  it("gives a scope its own documents, primary first, with their stamps", () => {
    const docs = scopeDocumentViews("1.1", { "PPD-OE-FN-1.1.1": { version: "V3" } });
    expect(docs.map((d) => d.code)).toEqual(["PPD-SGL-CG-1.1.1", "PPD-OE-FN-1.1.1"]);
    expect(docs[1].version).toBe("V3");
  });
});
