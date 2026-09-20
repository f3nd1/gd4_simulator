-- STEP 2 of 2. RUN THIS ONLY AFTER the sign-in build is deployed and you have
-- signed in successfully. Running it before will stop the live app saving
-- anything, because today's app has no session to present.
--
-- It replaces "anybody with the publishable key" with "a signed-in United
-- Ceres account". This is the check that actually protects the data: it
-- applies to every request, including one made with curl outside the app.
--
-- auth.jwt() ->> 'email' is the signed-in user's address, taken from the
-- token Supabase itself issued. It cannot be forged by the browser.

drop policy if exists "anon read"   on public.workspace_state;
drop policy if exists "anon insert" on public.workspace_state;
drop policy if exists "anon update" on public.workspace_state;
drop policy if exists "anon delete" on public.workspace_state;

-- One named condition, used by all three policies, so the domain is written
-- once. "like '%@unitedceres.edu.sg'" anchors to the END of the address, so
-- neither "someone@unitedceres.edu.sg.attacker.com" nor
-- "notunitedceres.edu.sg" matches.
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

-- Deliberately NO delete policy. Nothing in the app deletes a row, so
-- granting it would only widen what a mistake or a stolen session can do.

-- Check it worked: three policies, all "authenticated", none "anon".
select policyname, cmd, roles::text from pg_policies
where schemaname = 'public' and tablename = 'workspace_state'
order by policyname;
