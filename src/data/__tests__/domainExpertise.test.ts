import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { domainExpertiseFor, PARSED_DOMAIN_FILES } from "../skills/domainExpertise";
import { useDomainChecklistStore } from "../../store/useDomainChecklistStore";
import { makeCustomDomainItem, EMPTY_DOMAIN_OVERRIDES } from "../../lib/domainChecklist";

const SKILLS = join(__dirname, "..", "skills");
const read = (f: string) => readFileSync(join(SKILLS, f), "utf8");

const FILES: Record<string, string> = {
  "1": "criterion-1-leadership-finance.md",
  "2": "criterion-2-corporate-admin.md",
  "3": "criterion-3-recruitment-agents.md",
  "4": "criterion-4-student-protection.md",
  "5": "criterion-5-academic.md",
  "6": "criterion-6-quality-assurance.md",
  "7": "criterion-7-outcomes.md",
};

describe("domainExpertiseFor after the editable-checklist rework", () => {
  beforeEach(() => useDomainChecklistStore.setState({ overrides: EMPTY_DOMAIN_OVERRIDES }));

  // The migration guarantee at the level the AI actually sees: with no edits,
  // every prompt gets the identical bytes it got before the checklist became
  // editable — including Criterion 4's three appended regulatory supplements.
  it("returns exactly the pre-rework text for every criterion when nothing is edited", () => {
    for (const [cid, file] of Object.entries(FILES)) {
      const expected =
        cid === "4"
          ? [read(file), read("ssg-refund-and-withdrawal-rules.md"), read("standard-student-contract.md"), read("fps-rules.md")].join("\n\n---\n\n")
          : read(file);
      expect(domainExpertiseFor(cid), `criterion ${cid}`).toBe(expected);
    }
  });

  it("resolves an item or sub-criterion id to its criterion, unchanged", () => {
    expect(domainExpertiseFor("4.2.1")).toBe(domainExpertiseFor("4"));
    expect(domainExpertiseFor("2.1")).toBe(domainExpertiseFor("2"));
    expect(domainExpertiseFor("nonsense")).toBeUndefined();
    expect(domainExpertiseFor(undefined)).toBeUndefined();
  });

  it("an approved added check reaches the prompt; a draft one does not", () => {
    const section = PARSED_DOMAIN_FILES["5"].sections[0].key;
    const text = "Teacher deployment approved by the Academic Board, with the approval date minuted.";

    useDomainChecklistStore.getState().addItem({ criterionId: "5", sectionKey: section, text });
    expect(domainExpertiseFor("5")).not.toContain(text);

    const draftId = useDomainChecklistStore.getState().overrides.added[0].id;
    useDomainChecklistStore.getState().setVerified(draftId, true);
    expect(domainExpertiseFor("5")).toContain(text);
  });

  it("an edit and a removal reach the prompt, and revert restores the seed", () => {
    const item = PARSED_DOMAIN_FILES["1"].items[0];
    const store = useDomainChecklistStore.getState();

    store.editItem(item.id, "Edited check.");
    expect(domainExpertiseFor("1")).toContain("- Edited check.");
    expect(domainExpertiseFor("1")).not.toContain(item.text);

    useDomainChecklistStore.getState().revertItem(item.id);
    expect(domainExpertiseFor("1")).toBe(read(FILES["1"]));

    useDomainChecklistStore.getState().setRemoved(item.id, true);
    expect(domainExpertiseFor("1")).not.toContain(item.text);

    useDomainChecklistStore.getState().setRemoved(item.id, false);
    expect(domainExpertiseFor("1")).toBe(read(FILES["1"]));
  });

  it("editing one criterion never disturbs another", () => {
    const item = PARSED_DOMAIN_FILES["6"].items[0];
    useDomainChecklistStore.getState().editItem(item.id, "Only criterion 6 changes.");
    for (const [cid, file] of Object.entries(FILES)) {
      if (cid === "6" || cid === "4") continue;
      expect(domainExpertiseFor(cid), `criterion ${cid} drifted`).toBe(read(file));
    }
  });

  it("a custom item filed against one criterion cannot leak into another", () => {
    const custom = { ...makeCustomDomainItem({ criterionId: "3", sectionKey: PARSED_DOMAIN_FILES["3"].sections[0].key, text: "C3 only." }), verified: true };
    useDomainChecklistStore.setState({ overrides: { edits: {}, removed: [], added: [custom] } });
    expect(domainExpertiseFor("3")).toContain("C3 only.");
    expect(domainExpertiseFor("5")).toBe(read(FILES["5"]));
  });
});
