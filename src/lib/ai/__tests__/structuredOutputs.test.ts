import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatComplete } from "../aiClient";
import { sObj, sArr, sStr, sEnum } from "../schemaHelpers";
import type { AISettings } from "../../../types";

// Exercises the REAL chatComplete request assembly (fetch stubbed) — the
// mocked-chatComplete tests elsewhere never see the request body, so the
// structured-outputs behaviour is pinned here: strict json_schema for verdict
// calls, reasoning-before-verdict key order preserved, one-shot fallback to
// json_object on models that reject json_schema, and plain-text mode for the
// prompt-lab calls whose messages contain no "json".

const SETTINGS: AISettings = { provider: "openai", apiKey: "k", model: "gpt-4o-mini", utilityModel: "gpt-4o-mini", enabled: true };
const OK_REPLY = JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "gpt-4o-mini" });

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

const SCHEMA = { name: "test_verdict", schema: sObj({ results: sArr(sObj({ ref: sStr, note: sStr, covered: sEnum("Yes", "Partial", "No") })) }) };

function sentBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body as string);
}

describe("chatComplete structured outputs (Item 4)", () => {
  it("sends strict json_schema when a schema is provided", async () => {
    fetchMock.mockResolvedValueOnce(new Response(OK_REPLY, { status: 200 }));
    await chatComplete([{ role: "user", content: "assess" }], SETTINGS, { schema: SCHEMA });
    const body = sentBody();
    const rf = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.name).toBe("test_verdict");
  });

  it("schema key order puts reasoning before the verdict (constrained decoding emits in schema order)", () => {
    const item = (SCHEMA.schema as { properties: { results: { items: { properties: Record<string, unknown> } } } }).properties.results.items;
    expect(Object.keys(item.properties)).toEqual(["ref", "note", "covered"]); // note (reasoning) BEFORE covered (verdict)
    expect(item).toMatchObject({ additionalProperties: false, required: ["ref", "note", "covered"] });
  });

  it("falls back ONCE to json_object when the model rejects json_schema with a 400", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("Invalid parameter: 'response_format' of type 'json_schema' is not supported", { status: 400 }))
      .mockResolvedValueOnce(new Response(OK_REPLY, { status: 200 }));
    const content = await chatComplete([{ role: "user", content: "assess json" }], SETTINGS, { schema: SCHEMA });
    expect(content).toBe("{\"ok\":true}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((sentBody(1).response_format as { type: string }).type).toBe("json_object");
  });

  it("does NOT swallow unrelated 400s as a fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Invalid API key provided", { status: 400 }));
    await expect(chatComplete([{ role: "user", content: "assess" }], SETTINGS, { schema: SCHEMA })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("plainText mode sends NO response_format — fixes the prompt-lab calls whose messages never mention json", async () => {
    fetchMock.mockResolvedValueOnce(new Response(OK_REPLY, { status: 200 }));
    await chatComplete([{ role: "user", content: "rewrite this prompt, no json anywhere" }], SETTINGS, { plainText: true });
    expect(sentBody().response_format).toBeUndefined();
  });

  it("default behaviour (no schema, no plainText) stays json_object — legacy calls unchanged", async () => {
    fetchMock.mockResolvedValueOnce(new Response(OK_REPLY, { status: 200 }));
    await chatComplete([{ role: "user", content: "reply with json" }], SETTINGS, {});
    expect((sentBody().response_format as { type: string }).type).toBe("json_object");
  });
});
