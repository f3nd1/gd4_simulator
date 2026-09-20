-- Run this once in the Supabase SQL Editor for your project.
create table if not exists public.workspace_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

-- ACCESS RULES. The four "anon" policies that used to sit here gave anyone
-- holding the publishable key full read, write and DELETE on this table, and
-- that key ships in the browser bundle. The table holds audit findings,
-- verbatim excerpts of student documents and the OpenAI key, so that was an
-- open door.
--
-- They are replaced by the three policies below: only a signed-in United
-- Ceres Google account. This is the check that actually protects the data,
-- because it applies to every request, including one made with curl.
--
-- If you are UPGRADING an existing project, do not run this file. Run
-- 01-urgent-drop-delete.sql now and 02-after-deploy-require-signin.sql once
-- the sign-in build is live; running the second one early stops the current
-- app saving anything.
--
-- "like '%@unitedceres.edu.sg'" anchors to the END of the address, so a
-- lookalike domain does not match.
create policy "ucc read" on public.workspace_state
  for select to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg');

create policy "ucc insert" on public.workspace_state
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg');

create policy "ucc update" on public.workspace_state
  for update to authenticated
  using ((auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg')
  with check ((auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg');

-- No delete policy on purpose: nothing in the app deletes a row.

-- Holds ONE shared Google Drive OAuth refresh token for this whole
-- workspace. Sign-in identifies the PERSON; the Drive connection is still one
-- per workspace, not one per person, so this stays a single row with
-- id = 'default'. Written and read ONLY by the drive-oauth
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
