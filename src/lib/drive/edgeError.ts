// What the drive-oauth function actually said.
//
// supabase-js reports every non-2xx from an Edge Function as the same
// sentence: "Edge Function returned a non-2xx status code". The real reason
// is in the Response it carries on `context` (FunctionsHttpError), and the
// function always answers with a JSON body explaining itself. Dropping that
// body has now cost a debugging round: the app said only that something was
// non-2xx while the function was saying, in full, which account it had
// refused or which secret was missing.
//
// Pure apart from reading the Response, so the mapping is testable.

// A FunctionsHttpError carries the Response; other error types do not.
type MaybeHttpError = { message?: string; context?: unknown };

function isResponse(v: unknown): v is Response {
  return !!v && typeof v === "object" && typeof (v as Response).status === "number" && typeof (v as Response).text === "function";
}

// Said when the function refused the caller. The status is what distinguishes
// "you are not signed in" from "your account is not allowed", and both are
// worth telling apart out loud.
export function explainEdgeStatus(status: number, fromFunction: string): string {
  // 404 first, and whatever the body says: the platform answers "Function not
  // found", which is true and useless. The command to fix it is the point.
  if (status === 404) return "The drive-oauth server function is not deployed on this project. Deploy it with: supabase functions deploy drive-oauth";
  if (fromFunction) {
    if (status === 401) return `${fromFunction} Your sign-in did not reach the Google Drive service. Sign out and back in, then try again.`;
    return fromFunction;
  }
  if (status === 401) return "The Google Drive service did not recognise your sign-in. Sign out and back in, then try again.";
  if (status === 403) return "The Google Drive service refused your account.";
  return `The drive-oauth server function failed (status ${status}).`;
}

export async function readEdgeFunctionError(err: unknown): Promise<string> {
  const e = err as MaybeHttpError;
  const res = isResponse(e?.context) ? e.context : null;
  if (!res) return e?.message || "The drive-oauth Edge Function returned an error.";
  let fromFunction = "";
  try {
    const body = await res.clone().text();
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") fromFunction = parsed.error.trim();
    } catch {
      // Not JSON: the platform itself answered, not our function.
      fromFunction = body.trim().slice(0, 200);
    }
  } catch { /* body already consumed or unreadable */ }
  return explainEdgeStatus(res.status, fromFunction);
}
