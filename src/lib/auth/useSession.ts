// The signed-in session, watched.
//
// Supabase keeps the session in this browser's localStorage and refreshes it
// in the background; this hook only reflects it. Nothing here is a security
// boundary: it decides what to RENDER. The data is protected by the row-level
// security policy in Postgres and by the drive-oauth function's own check,
// both of which apply to a request made outside this app entirely.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, getSupabaseConfig } from "../supabaseClient";
import { emailIsAllowed } from "./domain";

export type AuthState =
  // Supabase URL/key are missing, so there is nobody to ask. The app cannot
  // verify anyone and therefore must not open.
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "signed-out" }
  // Signed in with a Google account that is not ours. Kept as its own state
  // rather than folded into signed-out, so the screen can say WHY.
  | { status: "wrong-domain"; email: string }
  | { status: "signed-in"; email: string; session: Session };

export function useSession(): AuthState {
  const { url, key } = getSupabaseConfig();
  const [state, setState] = useState<AuthState>(url && key ? { status: "loading" } : { status: "unconfigured" });

  useEffect(() => {
    if (!url || !key) { setState({ status: "unconfigured" }); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setState({ status: "unconfigured" }); return; }
    let live = true;
    const apply = (session: Session | null) => {
      if (!live) return;
      const email = session?.user?.email ?? "";
      if (!session) setState({ status: "signed-out" });
      else if (!emailIsAllowed(email)) setState({ status: "wrong-domain", email });
      else setState({ status: "signed-in", email, session });
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session)).catch(() => live && setState({ status: "signed-out" }));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session));
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, [url, key]);

  return state;
}

export async function signInWithGoogle(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return "This app is not connected to its database yet, so sign-in cannot run.";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Sends the browser back to THIS page. The app is a HashRouter SPA at a
      // subpath, so the redirect target is the document URL without its hash.
      redirectTo: window.location.href.split("#")[0],
      // A hint only: it pre-selects the UCC account in Google's chooser. It
      // does NOT stop a consumer account completing the flow, which is why
      // the domain is also enforced in Postgres and in the Edge Function.
      queryParams: { hd: "unitedceres.edu.sg", prompt: "select_account" },
    },
  });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase?.auth.signOut();
}
