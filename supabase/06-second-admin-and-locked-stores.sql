-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS FIRST, then deploy.
-- The People screen gains a grant-admin section that reads and writes a
-- table this creates, and the build expects the locked-row policies below.
-- Run first and the old build is unaffected: it only narrows who may write
-- ten configuration rows, and the audit lead is not narrowed.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 6. A second admin, and admin-only writes on the configuration rows.

-- ── The root admin, unchanged, now written once ──────────────────────────
-- Split out so the delete policy on allowed_users can ask "is THIS ROW the
-- root's?" without a second copy of the address.
create or replace function public.is_admin_email(addr text)
returns boolean
language sql
immutable
as $$
  select lower(addr) = 'felix@unitedceres.edu.sg';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.is_admin_email(auth.jwt() ->> 'email');
$$;

-- ── Additional admins ────────────────────────────────────────────────────
-- A SEPARATE table, deliberately, and not a column on allowed_users. Three
-- properties follow from that shape and none of them survive a column:
--
--   1. No recursion. Policies on allowed_users may ask is_any_admin(), which
--      reads THIS table; policies on THIS table ask only is_admin(), which
--      reads no table at all. A column would mean a policy on allowed_users
--      selecting from allowed_users, which Postgres refuses.
--   2. Grants are NOT transitive. Only the root writes this table, so a
--      granted admin can manage the sign-in list but cannot make more
--      admins. There is no escalation chain.
--   3. "The last admin was removed" still cannot happen. The root is a
--      constant above, not a row, so emptying this table costs nothing.
create table if not exists public.admin_grants (
  email text primary key,
  email_lc text generated always as (lower(email)) stored,
  granted_at timestamptz not null default now()
);

create unique index if not exists admin_grants_email_lc_idx on public.admin_grants (email_lc);

alter table public.admin_grants enable row level security;

-- Your own row, or all of them if you are the ROOT. Deliberately is_admin()
-- and not is_any_admin(): a policy on this table that consulted a function
-- reading this table would recurse. A granted admin therefore sees only that
-- they themselves are one, which is all the screen needs them to know.
drop policy if exists "see your own grant, or all of them if root" on public.admin_grants;
create policy "see your own grant, or all of them if root" on public.admin_grants
  for select to authenticated
  using (email_lc = lower(auth.jwt() ->> 'email') or public.is_admin());

drop policy if exists "only the root grants admin" on public.admin_grants;
create policy "only the root grants admin" on public.admin_grants
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "only the root revokes admin" on public.admin_grants;
create policy "only the root revokes admin" on public.admin_grants
  for delete to authenticated
  using (public.is_admin());

-- No update policy: a grant is present or absent, never edited.

-- ── "Is the caller any kind of admin?" ───────────────────────────────────
-- Reads admin_grants under the CALLER's own policy above, which returns
-- their row and nobody else's, so this needs no elevated rights. A
-- non-admin sees no rows and gets false.
create or replace function public.is_any_admin()
returns boolean
language sql
stable
as $$
  select public.is_admin()
      or exists (
        select 1 from public.admin_grants
        where email_lc = lower(auth.jwt() ->> 'email')
      );
$$;

-- ── The sign-in list: any admin may manage it ────────────────────────────
drop policy if exists "only the admin adds" on public.allowed_users;
create policy "only the admin adds" on public.allowed_users
  for insert to authenticated
  with check (public.is_any_admin());

-- Neither your own row nor the ROOT's may be removed. Your own, because a
-- row that vanishes from the list it pins reads as a bug; the root's,
-- because a granted admin must not be able to strike the person who granted
-- them out of the list. The root keeps app access regardless
-- (is_allowed_user short-circuits), so this is about coherence, not rescue.
drop policy if exists "only the admin removes" on public.allowed_users;
create policy "only the admin removes" on public.allowed_users
  for delete to authenticated
  using (
    public.is_any_admin()
    and email_lc <> lower(auth.jwt() ->> 'email')
    and not public.is_admin_email(email_lc)
  );

-- ── Configuration rows: admin writes only ────────────────────────────────
-- The workspace is one row per store key, so "which pages can a normal user
-- actually change" is decidable per row. These ten were measured, not
-- assumed: a normal user signing in and using the app writes none of them.
-- The rows they DO write on every page load, with no action at all
-- (ucc-gd4-workspace:v3, ucc-gd4-checklist:v2, ucc-gd4-finding-drafts:v1,
-- ucc-gd4-changelog:v1) are absent on purpose, and so is
-- ucc-gd4-checklist-verdicts:v1, which a self-check RUN writes. Locking any
-- of those would give every normal user a permanent sync error for no gain.
--
-- Every page that owns a row below is also admin-only in the sidebar
-- (src/lib/auth/pageAccess.ts, pinned by a test), so a normal user never
-- reaches a screen whose save would be silently refused.
create or replace function public.is_admin_only_row(row_id text)
returns boolean
language sql
immutable
as $$
  select row_id = any (array[
    'ucc-gd4-ai-settings:v1',        -- Settings: the OpenAI key and models
    'ucc-gd4-google-drive:v1',       -- Settings: the Drive Client ID
    'ucc-gd4-scoring-config:v1',     -- GD4 Scoring Setup
    'ucc-gd4-calibration:v1',        -- AI Calibration
    'ucc-gd4-custom-benchmark:v1',   -- AI Calibration
    'ucc-gd4-rule-tuning:v1',        -- AI Calibration
    'ucc-gd4-prompt-review:v1',      -- Prompt Review
    'ucc-gd4-domain-checklist:v1',   -- Audit Checklist Library
    'ucc-gd4-precheck-checklist:v1', -- Pre-check Checklist Setup
    'profile-of-pei-v2'              -- Profile of PEI
  ]);
$$;

-- READS are unchanged and stay open to everyone on the list. That is not an
-- oversight: every store is read on page load by every signed-in person, so
-- restricting reads per row would break the app, and hiding a page has never
-- hidden its data. The OpenAI key in particular CANNOT be read-locked while
-- a normal user's self-check has to make OpenAI calls with it.
drop policy if exists "allowed insert" on public.workspace_state;
create policy "allowed insert" on public.workspace_state
  for insert to authenticated
  with check (public.is_allowed_user() and (public.is_any_admin() or not public.is_admin_only_row(id)));

drop policy if exists "allowed update" on public.workspace_state;
create policy "allowed update" on public.workspace_state
  for update to authenticated
  using (public.is_allowed_user() and (public.is_any_admin() or not public.is_admin_only_row(id)))
  with check (public.is_allowed_user() and (public.is_any_admin() or not public.is_admin_only_row(id)));

-- ── Check it worked ───────────────────────────────────────────────────────
-- EXPECTED: three policies on workspace_state, three on allowed_users, three
-- on admin_grants, none on drive_oauth_tokens. All {authenticated}, no ALL.
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('workspace_state', 'allowed_users', 'admin_grants', 'drive_oauth_tokens')
order by tablename, cmd, policyname;

-- You should be both. A granted admin would show false, true.
select public.is_admin() as you_are_the_root, public.is_any_admin() as you_are_an_admin;

-- The locked list, as the database itself computes it.
select id, public.is_admin_only_row(id) as admin_only
from public.workspace_state order by id;
