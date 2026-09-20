import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useSupabaseSettingsStore } from "../store/useSupabaseSettingsStore";
import { planCallbackUrl } from "./auth/callbackUrl";

// .env.local (see .env.example) supplies a deploy-time default. Whatever the
// user types into Settings > Supabase database is saved in this browser's
// localStorage and takes priority over that default, so the same build can
// be pointed at different projects per browser without a rebuild.
//
// Only ever the public, RLS-protected anon/publishable key belongs here or
// in Settings — it is not a secret. The service_role secret key must never
// be referenced from this codebase: every VITE_* var is inlined into the
// client JS bundle, and the secret key bypasses RLS entirely.
const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let cachedClient: SupabaseClient | null = null;
let cachedUrl = "";
let cachedKey = "";

export function getSupabaseConfig() {
  const { url, publishableKey } = useSupabaseSettingsStore.getState();
  return {
    url: url || ENV_URL || "",
    key: publishableKey || ENV_KEY || "",
  };
}

// Lazily created and recreated only when the resolved url/key actually
// change, so every store's storage adapter can call this on every
// read/write without paying for a new client each time.
export function getSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    cachedClient = null;
    cachedUrl = "";
    cachedKey = "";
    return null;
  }
  if (cachedClient && cachedUrl === url && cachedKey === key) return cachedClient;
  // BEFORE createClient, because the client reads window.location during its
  // own construction and a stale query-string error makes it throw the
  // arriving session away. Called here rather than in main.tsx so it cannot
  // be missed whichever code path creates the client first.
  cleanCallbackUrl();
  cachedClient = createClient(url, key);
  cachedUrl = url;
  cachedKey = key;
  return cachedClient;
}

// The last genuine sign-in failure seen in the landing URL, for the sign-in
// screen to show. Module state rather than a store: it is read once, on the
// render that follows the redirect, and it must survive being captured before
// React mounts.
let lastSignInError: string | null = null;
export function consumeSignInError(): string | null {
  const e = lastSignInError;
  lastSignInError = null;
  return e;
}

let cleaned = false;
export function cleanCallbackUrl(): void {
  if (cleaned || typeof window === "undefined") return;
  cleaned = true;
  const plan = planCallbackUrl(window.location.href);
  if (plan.signInError) lastSignInError = plan.signInError;
  if (!plan.cleanedHref) return;
  // replaceState, not assign: reloading here would send the browser back to
  // the server and lose the fragment holding the session.
  window.history.replaceState(window.history.state, "", plan.cleanedHref);
  console.warn(
    "[auth] A sign-in session arrived with a stale error left in the address from an earlier attempt. " +
    `The error was dropped so the session could be used: ${plan.staleErrorRemoved}`
  );
}
