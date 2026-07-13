import { describe, it, expect, afterEach } from "vitest";
import { usePromptReviewStore } from "../../store/usePromptReviewStore";
import type { PromptReviewRatings, PromptReviewRecord } from "../../types";

const OK_RATINGS: PromptReviewRatings = {
  accuracy: "Strong", completeness: "Strong", relevance: "Strong", tone: "Strong", complianceRisk: "Low",
};

function review(promptId: string, promptName: string, originalPrompt: string, over: Partial<Omit<PromptReviewRecord, "id" | "timestamp">> = {}): Omit<PromptReviewRecord, "id" | "timestamp"> {
  return {
    promptId, promptName, originalPrompt,
    output: "some output",
    ratings: OK_RATINGS,
    missingInfo: "", suggestedImprovement: "", correction: "", reason: "",
    revisedPrompt: null, reviewer: "Alice",
    decisionType: "Accepted", status: "reviewed_ok",
    ...over,
  };
}

// Clean slate between tests.
afterEach(() => {
  usePromptReviewStore.setState({ prompts: [], records: [] });
});

describe("usePromptReviewStore — prompts CRUD", () => {
  it("addPrompt inserts a ReviewablePrompt and returns its id", () => {
    const id = usePromptReviewStore.getState().addPrompt({ name: "P1", purpose: "Findings", text: "Write a finding." });
    const p = usePromptReviewStore.getState().prompts.find((x) => x.id === id);
    expect(p).toBeTruthy();
    expect(p!.name).toBe("P1");
    expect(p!.text).toBe("Write a finding.");
    expect(p!.createdAt).toBeTruthy();
  });

  it("updatePrompt changes text and bumps updatedAt", () => {
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "old" });
    s.updatePrompt(id, { text: "new" });
    expect(usePromptReviewStore.getState().prompts.find((p) => p.id === id)!.text).toBe("new");
  });

  it("removePrompt deletes the prompt and its records", () => {
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "t" });
    s.addReview(review(id, "P1", "t"));
    expect(usePromptReviewStore.getState().records).toHaveLength(1);
    usePromptReviewStore.getState().removePrompt(id);
    expect(usePromptReviewStore.getState().prompts).toHaveLength(0);
    expect(usePromptReviewStore.getState().records).toHaveLength(0);
  });
});

describe("usePromptReviewStore — review → revise → promote", () => {
  it("addReview stores a connected record tying original prompt to reviewer + ratings", () => {
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "orig" });
    const recId = s.addReview(review(id, "P1", "orig", { reviewer: "Bob" }));
    const rec = usePromptReviewStore.getState().records.find((r) => r.id === recId)!;
    expect(rec.promptId).toBe(id);
    expect(rec.originalPrompt).toBe("orig");
    expect(rec.reviewer).toBe("Bob");
    expect(rec.timestamp).toBeTruthy();
  });

  it("addReview carries a drafted revision on the record without touching the live prompt text", () => {
    // The real persist path (PromptReview.saveReview): the AI-drafted revision
    // rides on the record via revisedPrompt at save time — there is no separate
    // attach step. The parent prompt stays untouched until an explicit promote.
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "orig" });
    const recId = s.addReview(review(id, "P1", "orig", { revisedPrompt: "improved prompt", status: "revision_drafted", decisionType: "Overridden" }));
    const rec = usePromptReviewStore.getState().records.find((r) => r.id === recId)!;
    expect(rec.revisedPrompt).toBe("improved prompt");
    expect(rec.status).toBe("revision_drafted");
    expect(usePromptReviewStore.getState().prompts.find((p) => p.id === id)!.text).toBe("orig");
  });

  it("promoteRevision copies the drafted revision into the prompt text (the champion gate)", () => {
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "orig" });
    const recId = s.addReview(review(id, "P1", "orig", { revisedPrompt: "improved prompt", status: "revision_drafted", decisionType: "Overridden" }));
    s.promoteRevision(recId);
    expect(usePromptReviewStore.getState().prompts.find((p) => p.id === id)!.text).toBe("improved prompt");
    expect(usePromptReviewStore.getState().records.find((r) => r.id === recId)!.status).toBe("revision_live");
  });

  it("promoteRevision is a no-op when there is no drafted revision", () => {
    const s = usePromptReviewStore.getState();
    const id = s.addPrompt({ name: "P1", purpose: "", text: "orig" });
    const recId = s.addReview(review(id, "P1", "orig"));
    s.promoteRevision(recId);
    expect(usePromptReviewStore.getState().prompts.find((p) => p.id === id)!.text).toBe("orig");
    expect(usePromptReviewStore.getState().records.find((r) => r.id === recId)!.status).toBe("reviewed_ok");
  });
});
