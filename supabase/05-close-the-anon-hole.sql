-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS NOW. No deploy needed first, and do not wait for one.
-- It only REMOVES permissions that the live app has not used since the
-- sign-in build went out, so it is safe against the build running today.
-- A separate deploy (Settings page) stops the hole being reopened, but
-- that deploy does not have to land before this runs.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 5. Close an open policy that scripts 01 and 02 could not remove.
--
-- WHAT WAS WRONG: workspace_state carried a policy named "anon read/write",
-- cmd ALL, role {public}, using (true) with check (true). Policies are
-- PERMISSIVE and combine with OR, so that one policy granted the whole
-- workspace — findings, quoted student documents, the OpenAI key — to anyone
-- holding the publishable key, which ships inside the browser bundle. None of
-- the sign-in, allow-list or admin work protected anything while it existed.
--
-- WHERE IT CAME FROM: this app's own Settings page printed that exact SQL as
-- the "required table" snippet and told the reader to run it once. It has
-- never been in any of the scripts in this folder, which is precisely why
-- scripts 01 and 02 missed it: every DROP in them names a policy, and
--   drop policy if exists "anon read" ...
-- silently does nothing when the policy on the database is called something
-- else. The Settings page is fixed in the same commit as this file.
--
-- THE LESSON, built into the sweep below: dropping by name only removes the
-- names you thought of. This drops everything that is NOT on the expected
-- list instead, so a policy added by hand in the dashboard, under any name,
-- is caught.

do $$
declare
  p record;
  missing text;
begin
  -- FIRST, refuse to run at all if the policies that are supposed to survive
  -- are not there. Sweeping a table down to zero policies denies everybody,
  -- including the audit lead, and this project has already had one lockout
  -- from a migration that ran out of order. Nothing is dropped before this.
  select string_agg(want, ', ') into missing
  from (
    select unnest(array['allowed read', 'allowed insert', 'allowed update']) as want
  ) w
  where not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'workspace_state' and policyname = w.want
  );
  if missing is not null then
    raise exception
      'Refusing to run: workspace_state is missing the policies that must survive (%). Run 03-restrict-to-named-people.sql and 04-admin-manages-the-list.sql first, then run this again. Nothing has been changed.',
      missing;
  end if;

  -- workspace_state: exactly three policies, all admin/allow-list gated.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'workspace_state'
      and policyname not in ('allowed read', 'allowed insert', 'allowed update')
  loop
    execute format('drop policy %I on public.workspace_state', p.policyname);
    raise notice 'dropped stray policy "%" on workspace_state', p.policyname;
  end loop;

  -- allowed_users: exactly three, from 04.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'allowed_users'
      and policyname not in ('see your own row, or all of them if admin', 'only the admin adds', 'only the admin removes')
  loop
    execute format('drop policy %I on public.allowed_users', p.policyname);
    raise notice 'dropped stray policy "%" on allowed_users', p.policyname;
  end loop;

  -- drive_oauth_tokens: NONE, ever. RLS on with zero policies means even the
  -- authenticated role gets nothing; only the Edge Function's service_role
  -- key, which bypasses RLS, may touch the Google refresh token.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'drive_oauth_tokens'
  loop
    execute format('drop policy %I on public.drive_oauth_tokens', p.policyname);
    raise notice 'dropped stray policy "%" on drive_oauth_tokens', p.policyname;
  end loop;
end $$;

-- Belt and braces: RLS itself must be ON. A policy set is worth nothing on a
-- table where row-level security was switched off.
alter table public.workspace_state     enable row level security;
alter table public.allowed_users       enable row level security;
alter table public.drive_oauth_tokens  enable row level security;

-- ── Check it worked ───────────────────────────────────────────────────────
-- EXPECTED, exactly, and nothing else:
--
--   workspace_state      allowed read                              SELECT  {authenticated}
--   workspace_state      allowed insert                            INSERT  {authenticated}
--   workspace_state      allowed update                            UPDATE  {authenticated}
--   allowed_users        see your own row, or all of them if admin SELECT  {authenticated}
--   allowed_users        only the admin adds                       INSERT  {authenticated}
--   allowed_users        only the admin removes                    DELETE  {authenticated}
--   drive_oauth_tokens   (no rows at all)
--
-- Any row saying {public} or {anon}, or any cmd saying ALL, is a hole.
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('workspace_state', 'allowed_users', 'drive_oauth_tokens')
order by tablename, cmd, policyname;

-- And that row-level security is actually on for all three.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('workspace_state', 'allowed_users', 'drive_oauth_tokens')
order by relname;
