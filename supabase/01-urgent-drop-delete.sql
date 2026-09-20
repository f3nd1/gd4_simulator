-- STEP 1 of 2. RUN THIS NOW. It is safe on the version of the app that is
-- live today: nothing in the app ever deletes a workspace_state row.
--
-- (Checked in the code: the only delete is in supabaseStorage.removeItem,
-- which zustand calls from persist.clearStorage(), and nothing in this app
-- calls that.)
--
-- What it removes: the ability for anyone holding the publishable key to
-- WIPE the whole workspace. Read and write stay open until step 2, which
-- must wait for the sign-in build to be deployed.

drop policy if exists "anon delete" on public.workspace_state;

-- Check it worked: this should list read, insert and update only.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'workspace_state'
order by policyname;
