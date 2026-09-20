// The sign-in landing URL, cleaned before Supabase ever looks at it.
//
// THE BUG THIS EXISTS FOR, reproduced live before it was written:
//
//   .../gd4_simulator/?error=server_error&error_description=Unable+to+exchange
//     +external+code#access_token=<valid session>&refresh_token=...
//
// A stale error from an EARLIER failed attempt sat in the query string while a
// perfectly good session arrived in the fragment. The app showed the sign-in
// screen, stored nothing, and never called the auth API at all.
//
// The cause is in auth-js (2.110.2, lib/helpers.js parseParametersFromURL): it
// reads the fragment, then the query, and lets the query WIN:
//
//     // search parameters take precedence over hash parameters
//     url.searchParams.forEach((value, key) => { result[key] = value; });
//
// So both the valid access_token and the stale error_description land in one
// bag, _isImplicitGrantCallback says "yes, a callback", and _getSessionFromURL
// then rejects the whole thing on the error and throws the session away.
//
// WHY DROPPING THE QUERY ERROR IS SAFE, and not swallowing a real failure:
// the two flows put their errors in different places. Implicit failures come
// back in the FRAGMENT; a PKCE failure comes back in the query, and a PKCE
// success carries ?code= with no fragment token. So a query-string error
// arriving ALONGSIDE a fragment access_token cannot belong to this callback.
// It is left over from a previous redirect. Every other error is kept and
// shown.

type Params = Record<string, string>;

function parse(search: string): Params {
  const out: Params = {};
  try {
    new URLSearchParams(search).forEach((v, k) => { out[k] = v; });
  } catch { /* not a query string */ }
  return out;
}

export type CallbackUrlPlan = {
  // The href to replace the current one with, or null to leave it alone.
  cleanedHref: string | null;
  // The stale error that was dropped, for the console note. Never shown to
  // the user: it did not happen on this sign-in.
  staleErrorRemoved: string | null;
  // A real failure to put on the sign-in screen. Previously these produced a
  // blank sign-in card with no explanation.
  signInError: string | null;
};

const NOTHING: CallbackUrlPlan = { cleanedHref: null, staleErrorRemoved: null, signInError: null };

export function planCallbackUrl(href: string): CallbackUrlPlan {
  let url: URL;
  try { url = new URL(href); } catch { return NOTHING; }

  const frag = parse(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const query = parse(url.search);

  // What a SUCCESSFUL callback looks like, in either flow.
  const hasSession = !!frag.access_token || !!query.code;
  const queryError = query.error_description || query.error || "";
  const fragError = frag.error_description || frag.error || "";

  if (hasSession && queryError) {
    for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
    return { cleanedHref: url.toString(), staleErrorRemoved: pretty(queryError), signInError: null };
  }
  if (!hasSession && (fragError || queryError)) {
    return { cleanedHref: null, staleErrorRemoved: null, signInError: pretty(fragError || queryError) };
  }
  return NOTHING;
}

// "Unable+to+exchange+external+code" is how it arrives when the value was
// form-encoded; URLSearchParams decodes %XX but leaves the plus signs.
function pretty(s: string): string {
  return s.replace(/\+/g, " ").trim();
}
