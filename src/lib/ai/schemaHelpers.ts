// Tiny builders for OpenAI strict Structured Outputs schemas, so each verdict
// call site can declare its response shape compactly. Strict mode's rules are
// encoded once here: every property is required, additionalProperties is
// false, and property KEY ORDER is preserved (constrained decoding emits
// fields in schema order — every verdict schema lists its reasoning fields
// BEFORE its verdict field so the model reasons before it decides).
//
// These schemas mirror the response shapes the prompts already describe —
// adding one must never change what the model is asked to assess, only how
// the reply is structured. The downstream parse/verification code is kept
// unchanged as defence in depth (a schema guarantees shape, not truth).

export const sStr = { type: "string" } as const;
export const sBool = { type: "boolean" } as const;

export function sEnum(...values: string[]): Record<string, unknown> {
  return { type: "string", enum: values };
}

export function sArr(items: Record<string, unknown> | typeof sStr): Record<string, unknown> {
  return { type: "array", items };
}

export function sObj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
