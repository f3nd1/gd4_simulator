-- ═══════════════════════════════════════════════════════════════════════
-- ORDER: RUN THIS NOW. No deploy needed, before or after.
-- It only removes a permission nothing in the app uses, so no build depends on it.
--
-- The rule, every time: whichever one BREAKS IF IT ARRIVES ALONE goes
-- first. New code that needs a new table -> SQL first. New SQL that needs
-- new code -> deploy first. See supabase/README.md.
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 1 of 3. RUN THIS NOW. It is safe on the version of the app that is
-- live today: nothing in the app ever deletes a workspace_state row.
--
-- (Checked in the code: the only delete is in supabaseStorage.removeItem,
-- which zustand calls from persist.clearStorage(), and nothing in this app
-- calls that.)
--
-- What it removes: the ability for anyone holding the publishable key to
-- WIPE the whole workspace. Read and write stay open until step 2, which
-- must wait for the sign-in build to be deployed. Step 3 narrows it again,
-- from the whole domain to named people.

drop policy if exists "anon delete" on public.workspace_state;

-- Check it worked: this should list read, insert and update only.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'workspace_state'
order by policyname;
