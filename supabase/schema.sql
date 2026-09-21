-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS FIRST, on a brand new project, then deploy.
-- It creates every table the app reads. Nothing works before it.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

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

-- WHO MANAGES THE LIST: one admin, named as a CONSTANT in a function rather
-- than as a column or a row. Admin-ness is therefore not data, so nothing
-- that can write data can grant it, and there is no "last admin row" to
-- delete. It reads no table, which also keeps the policies below from
-- recursing into the table they protect.
--
-- TO CHANGE THE ADMIN: edit the address and run this block again. Keep
-- src/lib/auth/domain.ts's ADMIN_EMAIL in step; a test pins them together.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select lower(auth.jwt() ->> 'email') = 'felix@unitedceres.edu.sg';
$$;

-- Your own row and nobody else's, so a signed-in person cannot enumerate who
-- has access. The admin sees all of it, because the People screen has to show
-- a list.
create policy "see your own row, or all of them if admin" on public.allowed_users
  for select to authenticated
  using (email_lc = lower(auth.jwt() ->> 'email') or public.is_admin());

-- THIS is the control on who may change the list. The screen is convenience:
-- anyone signed in can call this table directly with the publishable key,
-- which ships in the browser bundle.
create policy "only the admin adds" on public.allowed_users
  for insert to authenticated
  with check (public.is_admin());

-- The second clause refuses the admin's OWN row, so "remove yourself" is
-- impossible through the API and not merely discouraged in the screen.
create policy "only the admin removes" on public.allowed_users
  for delete to authenticated
  using (public.is_admin() and email_lc <> lower(auth.jwt() ->> 'email'));

-- NO update policy, deliberately: without it nobody can rename an existing
-- row into somebody else's address.

-- The rule, written once, read by these policies AND (via the same table) by
-- the drive-oauth Edge Function. NOT security definer: the read policy above
-- already exposes exactly the row this needs, so it needs no elevated rights.
--
-- The admin short-circuits BEFORE the row lookup, so emptying allowed_users
-- entirely costs everyone else their access and costs the admin nothing.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select public.is_admin()
      or ((auth.jwt() ->> 'email') ilike '%@unitedceres.edu.sg'
          and exists (
            select 1 from public.allowed_users
            where email_lc = lower(auth.jwt() ->> 'email')
          ));
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
