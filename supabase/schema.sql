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
