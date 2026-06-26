import { createClient } from "@supabase/supabase-js";

// Both vars come from .env.local (see .env.example) and are not committed.
// The publishable key is the public, RLS-protected key Supabase expects to
// ship to the browser — it is not a secret. The secret key must never be
// referenced from this codebase: every VITE_* var is inlined into the
// client JS bundle, and the secret key bypasses RLS entirely.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Null when not configured, so the app can fall back to browser-local
// storage instead of crashing (see store/supabaseStorage.ts).
export const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
