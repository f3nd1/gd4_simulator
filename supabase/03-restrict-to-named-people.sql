-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS FIRST, then deploy.
-- The app and the drive-oauth function both query allowed_users. A build that ships before the table exists locks everybody out, including you. That happened on a43c855.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 3. Restrict sign-in to NAMED PEOPLE, not everyone with a
-- @unitedceres.edu.sg address.
--
-- Running this before the deploy is safe for the old build: it only narrows
-- who the policies accept, and the people seeded below are accepted either
-- way. That is why "SQL first" is the safe default whenever it is unclear.
--
-- WHY THIS EXISTS: students and other staff also have @unitedceres.edu.sg
-- addresses, so the domain test in 02 is too wide. It is kept as a first gate
-- (it costs nothing and means a mistake in the list below cannot open the
-- door to the whole internet), with the list as the real answer.
--
-- WHY IT IS A TABLE AND NOT A LIST IN THE CODE: the same rule has to be
-- honoured by the row-level policies here AND by the drive-oauth Edge
-- Function, and an allow-list in the app's source would be a third copy of
-- something that must never drift, plus a rebuild and a deploy every time
-- somebody joins. One table, two readers, no copies.

-- ── The list ──────────────────────────────────────────────────────────────
create table if not exists public.allowed_users (
  email text primary key,
  -- Addresses get typed by hand in the dashboard, so the case they arrive in
  -- cannot be relied on. Every comparison below and in the Edge Function uses
  -- this generated column instead of `email`, so "Jane.Tan@..." matches
  -- "jane.tan@..." without anybody having to remember.
  email_lc text generated always as (lower(email)) stored,
  note text,
  added_at timestamptz not null default now()
);

create unique index if not exists allowed_users_email_lc_idx on public.allowed_users (email_lc);

alter table public.allowed_users enable row level security;

-- You may read YOUR OWN row and nobody else's. That is all the app needs to
-- decide whether to let you in, and it means a signed-in person cannot
-- enumerate who else has access. No insert/update/delete policies exist at
-- all, so the list can only be edited from the Supabase dashboard, which is
-- deliberate: giving the app the power to grant access would be a permission
-- system, and this team does not need one.
drop policy if exists "see only your own row" on public.allowed_users;
create policy "see only your own row" on public.allowed_users
  for select to authenticated
  using (email_lc = lower(auth.jwt() ->> 'email'));

-- ── The rule, written once ────────────────────────────────────────────────
-- Deliberately NOT security definer: the caller's own read policy above
-- already lets them see exactly the one row this needs, so the function works
-- with no elevated rights and cannot be used to probe other addresses.
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

-- ── Point the workspace policies at it ────────────────────────────────────
-- Same three policies as 02, same shape, with the domain test replaced by the
-- rule above. Still no delete policy: nothing in the app deletes a row.
drop policy if exists "ucc read"   on public.workspace_state;
drop policy if exists "ucc insert" on public.workspace_state;
drop policy if exists "ucc update" on public.workspace_state;

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

-- ── Seed, so you are not locked out of your own app ───────────────────────
-- Add the rest from the dashboard: Table Editor > allowed_users > Insert row.
insert into public.allowed_users (email, note) values
  ('felix@unitedceres.edu.sg',  'Audit lead'),
  ('renzo@unitedceres.edu.sg',  null),
  ('irene@unitedceres.edu.sg',  null),
  ('admin@unitedceres.edu.sg',  null)
on conflict (email) do nothing;

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect four rows, then three "allowed ..." policies on workspace_state and
-- one on allowed_users, all of them "authenticated" and none of them "anon".
select email, note, added_at from public.allowed_users order by email;

select tablename, policyname, cmd, roles::text from pg_policies
where schemaname = 'public' and tablename in ('workspace_state', 'allowed_users')
order by tablename, policyname;
