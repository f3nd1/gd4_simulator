import { createClient } from "@supabase/supabase-js";

// Both vars come from .env.local (see .env.example) and are not committed.
// The anon key is the public, RLS-protected key Supabase expects to ship to
// the browser — it is not a secret.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Null when not configured, so the app can fall back to browser-local
// storage instead of crashing (see store/supabaseStorage.ts).
export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
