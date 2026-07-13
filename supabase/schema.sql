-- Run this once in the Supabase SQL Editor for your project.
create table if not exists public.workspace_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

-- No login for this app yet, so the publishable key needs full read/write on
-- this one table (requests with that key still hit Postgres as the "anon"
-- role, hence the policy names below). Anyone with the project's publishable
-- key and URL can read/write this table — fine for an internal prototype,
-- but revisit if this ever goes beyond a trusted internal link.
create policy "anon read" on public.workspace_state for select using (true);
create policy "anon insert" on public.workspace_state for insert with check (true);
create policy "anon update" on public.workspace_state for update using (true);
create policy "anon delete" on public.workspace_state for delete using (true);

-- Holds ONE shared Google Drive OAuth refresh token for this whole
-- workspace (this app has no per-user login — see the note above — so there
-- is exactly one Drive connection to persist, not one per person; always a
-- single row with id = 'default'). Written and read ONLY by the drive-oauth
-- Edge Function (supabase/functions/drive-oauth), using the service_role
-- key, which bypasses RLS entirely. Deliberately NO policies are granted
-- here for the anon role — unlike workspace_state above, the whole point of
-- this table is that the publishable key must NEVER be able to read it
-- directly; only the Edge Function (server-side, holding the Google client
-- secret) can mint access tokens from what's stored here.
create table if not exists public.drive_oauth_tokens (
  id text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.drive_oauth_tokens enable row level security;
-- No policies created for drive_oauth_tokens — RLS enabled with zero grants
-- means even the anon/authenticated roles get nothing; only service_role
-- (which bypasses RLS) can touch this table.
