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
-- 01-urgent-drop-delete.sql now, 02-after-deploy-require-signin.sql once the
-- sign-in build is live (running it early stops the current app saving
-- anything), then 03-restrict-to-named-people.sql.
--
-- WHO IS ALLOWED: named people, from public.allowed_users below — not
-- everyone on the domain. Students and other staff also have
-- @unitedceres.edu.sg addresses, so the domain alone is too wide. The domain
-- test is kept in front of the list as a cheap first gate, so a mistake in
-- the list cannot open the door to the whole internet.
create table if not exists public.allowed_users (
  email text primary key,
  -- Addresses get typed by hand in the dashboard, so their case cannot be
  -- relied on. Every comparison uses this instead of `email`.
  email_lc text generated always as (lower(email)) stored,
  note text,
  added_at timestamptz not null default now()
);

create unique index if not exists allowed_users_email_lc_idx on public.allowed_users (email_lc);

alter table public.allowed_users enable row level security;

-- You may read YOUR OWN row and nobody else's: enough for the app to decide
-- whether to let you in, and no way to enumerate who else has access. No
-- write policies at all — the list is edited only from the Supabase
-- dashboard, because letting the app grant access would be a permission
-- system this team does not need.
create policy "see only your own row" on public.allowed_users
  for select to authenticated
  using (email_lc = lower(auth.jwt() ->> 'email'));

-- The rule, written once, read by these policies AND (via the same table) by
-- the drive-oauth Edge Function. NOT security definer: the read policy above
-- already exposes exactly the one row this needs, so it needs no elevated
-- rights and cannot be used to probe other addresses.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select (auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg'
     and exists (
       select 1 from public.allowed_users
       where email_lc = lower(auth.jwt() ->> 'email')
     );
$$;

create policy "allowed read" on public.workspace_state
  for select to authenticated
  using (public.is_allowed_user());

create policy "allowed insert" on public.workspace_state
  for insert to authenticated
  with check (public.is_allowed_user());

create policy "allowed update" on public.workspace_state
  for update to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());

-- No delete policy on purpose: nothing in the app deletes a row.

-- Seed the list, so whoever sets this project up is not locked out. Add the
-- rest from the dashboard: Table Editor > allowed_users > Insert row.
insert into public.allowed_users (email, note) values
  ('felix@unitedceres.edu.sg', 'Audit lead')
on conflict (email) do nothing;

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
