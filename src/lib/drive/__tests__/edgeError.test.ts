import { describe, it, expect } from "vitest";
import { readEdgeFunctionError, explainEdgeStatus } from "../edgeError";

const httpError = (status: number, body: string) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(body, { status, headers: { "content-type": "application/json" } }),
});

describe("readEdgeFunctionError", () => {
  it("reports what the function actually said, not the generic sentence", async () => {
    const msg = await readEdgeFunctionError(httpError(403, JSON.stringify({ error: "That account (someone@gmail.com) is not a United Ceres account." })));
    expect(msg).toBe("That account (someone@gmail.com) is not a United Ceres account.");
    expect(msg).not.toContain("non-2xx");
  });

  it("adds what to DO on a 401, which the function cannot know", async () => {
    const msg = await readEdgeFunctionError(httpError(401, JSON.stringify({ error: "Sign in with your United Ceres Google account." })));
    expect(msg).toContain("Sign in with your United Ceres Google account.");
    expect(msg).toContain("Sign out and back in");
  });

  it("passes a configuration failure through in full", async () => {
    const msg = await readEdgeFunctionError(httpError(500, JSON.stringify({ error: "Server not configured: the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set on this Edge Function." })));
    expect(msg).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("names the deploy command when the function is not there at all", async () => {
    expect(await readEdgeFunctionError(httpError(404, ""))).toContain("supabase functions deploy drive-oauth");
    // Even though the platform answers with a body of its own, which is true
    // and useless: "Function not found".
    expect(await readEdgeFunctionError(httpError(404, "Function not found"))).toContain("supabase functions deploy drive-oauth");
  });

  it("uses a non-JSON body, which means the platform answered rather than the function", async () => {
    const msg = await readEdgeFunctionError(httpError(546, "WORKER_LIMIT"));
    expect(msg).toContain("WORKER_LIMIT");
  });

  it("falls back to the original message when there is no Response to read", async () => {
    expect(await readEdgeFunctionError({ message: "Failed to send a request to the Edge Function" }))
      .toBe("Failed to send a request to the Edge Function");
    expect(await readEdgeFunctionError(undefined)).toBe("The drive-oauth Edge Function returned an error.");
  });

  it("explains a bare status with no body", () => {
    expect(explainEdgeStatus(401, "")).toContain("did not recognise your sign-in");
    expect(explainEdgeStatus(403, "")).toContain("refused your account");
    expect(explainEdgeStatus(502, "")).toContain("status 502");
  });
});
