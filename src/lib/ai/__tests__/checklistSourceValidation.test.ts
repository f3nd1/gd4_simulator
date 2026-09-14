import { describe, it, expect, vi, beforeEach } from "vitest";
import { GD4_REQUIREMENTS } from "../../../data/gd4Requirements";

const chatComplete = vi.fn();
vi.mock("../aiClient", () => ({
  chatComplete,
  effectiveSettings: (s: unknown) => s,
  aiOfflineReason: () => null,
}));

const { runLiveChecklistGeneration } = await import("../agentRuntime");
const settings = { enabled: true, apiKey: "k", model: "m", utilityModel: "m" } as never;

// A real requirement with real flat audit points, so "allowed ref" means the
// genuine GD4 source list rather than a fixture.
const req = GD4_REQUIREMENTS.find((r) => r.id === "6.2.1")!;
const realPoint = req.flatAuditPoints![0];

const reply = (lines: unknown[]) => JSON.stringify({ lines, rejectedIdeas: [] });
const goodLine = () => ({
  text: "Verify that: " + realPoint.text,
  clause: `GD4 ${req.id}`,
  sourceRef: realPoint.ref,
  sourceType: realPoint.sourceType,
  sourceText: realPoint.text,
  apsrDimension: "Processes",
});

beforeEach(() => { chatComplete.mockReset(); });

describe("generated checklist lines must cite a real GD4 source", () => {
  it("accepts a line whose ref, text and type all match an official point", async () => {
    chatComplete.mockResolvedValue(reply([goodLine()]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(1);
    expect(res.rejectedCount).toBe(0);
  });

  it("rejects an invented ref that is not in the official source list", async () => {
    chatComplete.mockResolvedValue(reply([{ ...goodLine(), sourceRef: `${req.id}.DS9.z` }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(0);
    expect(res.rejectedCount).toBe(1);
    expect(JSON.stringify(res.rejectedIdeas)).toContain("not an official GD4 source point");
  });

  it("rejects a real ref carrying invented source text", async () => {
    chatComplete.mockResolvedValue(reply([{ ...goodLine(), sourceText: "The PEI shall benchmark its fees annually against competitors." }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(0);
    expect(JSON.stringify(res.rejectedIdeas)).toContain("not the official wording");
  });

  it("rejects a source type that contradicts the point it cites", async () => {
    const wrong = realPoint.sourceType === "describeShow" ? "expectedEvidence" : "describeShow";
    chatComplete.mockResolvedValue(reply([{ ...goodLine(), sourceType: wrong }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(0);
    expect(JSON.stringify(res.rejectedIdeas)).toContain("but");
  });

  it("still rejects an incomplete line, and says why", async () => {
    chatComplete.mockResolvedValue(reply([{ ...goodLine(), sourceText: "" }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(0);
    expect(JSON.stringify(res.rejectedIdeas)).toContain("incomplete");
  });

  it("matches refs case-insensitively, so ordinary echo drift is not a rejection", async () => {
    chatComplete.mockResolvedValue(reply([{ ...goodLine(), sourceRef: realPoint.ref.toLowerCase() }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(1);
  });

  it("rejectedCount equals the number of lines dropped", async () => {
    chatComplete.mockResolvedValue(reply([goodLine(), { ...goodLine(), sourceRef: "9.9.9.DS1" }, { ...goodLine(), sourceText: "invented" }]));
    const res = await runLiveChecklistGeneration(req, settings);
    expect(res.lines).toHaveLength(1);
    expect(res.rejectedCount).toBe(2);
  });
});
