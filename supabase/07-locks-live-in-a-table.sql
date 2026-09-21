-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS FIRST, then deploy.
-- The People screen reads and writes the table this creates, and the
-- workspace_state policies must already consult it. Run first and the
-- current build is unaffected: is_admin_only_row() keeps answering the same
-- ten keys, just from a table instead of from its own source.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 7. Move the lock list out of this file and into a table, so the
-- People screen genuinely changes what the database refuses instead of
-- picturing a decision made in SQL.

-- ── The list ──────────────────────────────────────────────────────────────
-- The CHECK constraint is the part to read twice. These five rows are
-- written by the app for EVERY signed-in person: the first three on every
-- page load with no user action at all, the fourth constantly, the fifth by
-- a self-check run. Locking any of them would give every process owner a
-- permanent sync error and break the one page they have.
--
-- It is a CONSTRAINT and not a policy on purpose: a policy binds the caller,
-- a constraint binds EVERYONE, including the admin, including a clever
-- request, and including the Supabase dashboard's own Table Editor. This
-- must not be reachable by a careless click on a tired evening.
--
-- TO AMEND IT (for example if a real self-check run turns out NOT to write
-- ucc-gd4-checklist-verdicts:v1, making it genuinely lockable):
--   alter table public.locked_stores drop constraint locked_stores_never_lockable;
--   alter table public.locked_stores add constraint locked_stores_never_lockable
--     check (store_key <> all (array[...the revised list...]));
create table if not exists public.locked_stores (
  store_key text primary key
    constraint locked_stores_never_lockable check (store_key <> all (array[
      'ucc-gd4-workspace:v3',           -- every page, constantly
      'ucc-gd4-checklist:v2',           -- written on every page load
      'ucc-gd4-finding-drafts:v1',      -- written on every page load
      'ucc-gd4-changelog:v1',           -- written on every page load
      'ucc-gd4-checklist-verdicts:v1'   -- written by a self-check run
    ])),
  locked_at timestamptz not null default now(),
  locked_by text
);

alter table public.locked_stores enable row level security;

-- READABLE BY EVERYONE SIGNED IN, and that is load-bearing rather than
-- careless. is_admin_only_row() below runs as the CALLER, under this policy.
-- If a normal user could not see these rows, the exists() would come back
-- false for them and every lock would silently evaporate for exactly the
-- people it exists to stop. The list is store keys, not secrets.
drop policy if exists "anyone signed in may read the lock list" on public.locked_stores;
create policy "anyone signed in may read the lock list" on public.locked_stores
  for select to authenticated
  using (public.is_allowed_user());

drop policy if exists "only an admin locks" on public.locked_stores;
create policy "only an admin locks" on public.locked_stores
  for insert to authenticated
  with check (public.is_any_admin());

drop policy if exists "only an admin unlocks" on public.locked_stores;
create policy "only an admin unlocks" on public.locked_stores
  for delete to authenticated
  using (public.is_any_admin());

-- No update policy: a lock is present or absent, never edited.

-- ── The rule, now read from the table ─────────────────────────────────────
-- STABLE, not IMMUTABLE. An immutable function that reads a table may be
-- folded to a constant by the planner, which would freeze the lock list at
-- whatever it happened to be the first time and make every later toggle a
-- no-op. The workspace_state policies from 06 are UNCHANGED: they already
-- call this function, so they pick the table up for free.
--
-- No recursion: this is a policy on workspace_state reading locked_stores, a
-- different table, whose own policies read allowed_users and the is_admin()
-- constant. The chain terminates.
create or replace function public.is_admin_only_row(row_id text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.locked_stores where store_key = row_id);
$$;

-- ── Seed with exactly what 06 hard-coded ──────────────────────────────────
-- Same ten keys, so running this changes nothing about who can write what
-- until somebody deliberately toggles one on the People screen.
insert into public.locked_stores (store_key, locked_by) values
  ('ucc-gd4-ai-settings:v1',        'migration 07'),
  ('ucc-gd4-google-drive:v1',       'migration 07'),
  ('ucc-gd4-scoring-config:v1',     'migration 07'),
  ('ucc-gd4-calibration:v1',        'migration 07'),
  ('ucc-gd4-custom-benchmark:v1',   'migration 07'),
  ('ucc-gd4-rule-tuning:v1',        'migration 07'),
  ('ucc-gd4-prompt-review:v1',      'migration 07'),
  ('ucc-gd4-domain-checklist:v1',   'migration 07'),
  ('ucc-gd4-precheck-checklist:v1', 'migration 07'),
  ('profile-of-pei-v2',             'migration 07')
on conflict (store_key) do nothing;

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect the ten rows above, and three policies on locked_stores: one
-- select, one insert, one delete, all {authenticated}, no ALL and no update.
select store_key, locked_by, locked_at from public.locked_stores order by store_key;

select tablename, policyname, cmd, roles::text from pg_policies
where schemaname = 'public' and tablename = 'locked_stores'
order by cmd, policyname;

-- The constraint refuses a never-lockable key. This SHOULD fail with 23514;
-- it is commented out so the script runs clean. Uncomment to see it refuse.
-- insert into public.locked_stores (store_key) values ('ucc-gd4-workspace:v3');

-- And the function still answers from the table.
select 'ucc-gd4-scoring-config:v1' as key, public.is_admin_only_row('ucc-gd4-scoring-config:v1') as locked
union all
select 'ucc-gd4-workspace:v3',            public.is_admin_only_row('ucc-gd4-workspace:v3');
