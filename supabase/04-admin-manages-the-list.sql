-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS FIRST, then deploy.
-- The new People screen writes to allowed_users, and today NO insert or
-- delete policy exists, so those writes are denied outright. It also lists
-- everyone, which the current read policy refuses. Deployed first, the
-- screen would appear and do nothing.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 4. Let the audit lead manage the allow-list from inside the app,
-- instead of the Supabase dashboard.
--
-- Running this before the deploy is safe for the live build: it only ADDS
-- permissions the current app never uses, and widens a read that the current
-- app only ever makes for its own row.

-- ── Who the admin is ──────────────────────────────────────────────────────
-- A CONSTANT in a function, deliberately not a column and not a table.
--
-- Admin-ness is therefore not data. Nothing that can write data can grant it,
-- delete it or edit it, so nobody can promote themselves and there is no
-- "last admin row" that could be removed and lock everyone out. It also reads
-- no table, which matters: a policy ON allowed_users that decided admin-ness
-- by SELECTing allowed_users would recurse into itself ("infinite recursion
-- detected in policy for relation"), and the usual fix, a security definer
-- function that bypasses RLS, is more machinery with a wider blast radius.
--
-- TO CHANGE THE ADMIN: edit the address below and run this block again. That
-- is on purpose. Changing who controls access should need the dashboard, and
-- there is no path to it from inside the app.
-- Keep src/lib/auth/domain.ts's ADMIN_EMAIL in step; a test pins them
-- together, and that copy only decides what is drawn.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select lower(auth.jwt() ->> 'email') = 'felix@unitedceres.edu.sg';
$$;

-- ── The admin can never be locked out of the app ──────────────────────────
-- Short-circuits BEFORE the row lookup, so emptying allowed_users entirely
-- costs everyone else their access and costs the admin nothing. Without this,
-- deleting one row from a screen would be enough to lock the person who owns
-- the screen out of the app that contains it.
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

-- ── Reading the list ──────────────────────────────────────────────────────
-- Unchanged for everybody except the admin: your own row and nobody else's,
-- so a signed-in person still cannot enumerate who has access. The admin sees
-- all of it, because the screen has to show a list.
drop policy if exists "see only your own row" on public.allowed_users;
drop policy if exists "see your own row, or all of them if admin" on public.allowed_users;
create policy "see your own row, or all of them if admin" on public.allowed_users
  for select to authenticated
  using (email_lc = lower(auth.jwt() ->> 'email') or public.is_admin());

-- ── Writing the list ──────────────────────────────────────────────────────
-- THIS is the control. The screen is convenience: anyone signed in can call
-- this table directly with the publishable key, which ships in the browser
-- bundle, so hiding a page protects nothing.
drop policy if exists "only the admin adds" on public.allowed_users;
create policy "only the admin adds" on public.allowed_users
  for insert to authenticated
  with check (public.is_admin());

-- The second clause refuses the admin's OWN row, so "remove yourself" is
-- impossible through the API and not merely discouraged in the screen. The
-- admin keeps app access either way (is_allowed_user short-circuits above),
-- but a row that vanishes from the list it is supposed to pin reads as a bug
-- and invites exactly the wrong kind of experiment.
drop policy if exists "only the admin removes" on public.allowed_users;
create policy "only the admin removes" on public.allowed_users
  for delete to authenticated
  using (public.is_admin() and email_lc <> lower(auth.jwt() ->> 'email'));

-- NO update policy, deliberately. Add and remove is the whole feature, and
-- without update nobody can rename an existing row into somebody else's
-- address. One fewer thing that has to be right.

-- ── The admin's own row ───────────────────────────────────────────────────
-- Pinned on screen and now unremovable above; make sure it is there at all.
insert into public.allowed_users (email, note) values
  ('felix@unitedceres.edu.sg', 'Audit lead')
on conflict (email) do nothing;

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect three policies on allowed_users: one select, one insert, one delete,
-- all "authenticated", and NO update. Then the admin address, as the database
-- itself computes it.
select tablename, policyname, cmd, roles::text from pg_policies
where schemaname = 'public' and tablename = 'allowed_users'
order by policyname;

select public.is_admin() as you_are_the_admin, public.is_allowed_user() as you_are_allowed;
