# Database changes, and the order they go in

Every file here is half of a pair. The other half is a deploy. Running them
in the wrong order has broken this app twice, so the order is stated at the
top of every `.sql` file in this folder and repeated here.

## The rule, every time

> **Whichever one breaks if it arrives alone goes first.**

- New **code** that needs a **new table** → **SQL first**, then deploy.
  The build queries a table that is not there, and everybody is locked out.
- New **SQL** that needs **new code** → **deploy first**, then SQL.
  The policy demands something only the new build sends, and the live app
  stops saving.

When it is genuinely unclear, **run the SQL first**. A policy change that
only *narrows* who is accepted is safe against the old build, as long as you
are in the list yourself. A missing table never is.

## What is in here

| File | When to run it | What it does |
|---|---|---|
| `schema.sql` | **First**, on a brand new project, then deploy | Creates every table the app reads |
| `01-urgent-drop-delete.sql` | Any time, no deploy involved | Removes the ability to wipe the workspace with the publishable key |
| `02-after-deploy-require-signin.sql` | **After** the sign-in build | Requires a signed-in United Ceres account on every request |
| `03-restrict-to-named-people.sql` | **Before** the allow-list build | Narrows that to the named people in `allowed_users` |
| `04-admin-manages-the-list.sql` | **Before** the People-screen build | Lets the admin add and remove people from inside the app |
| `functions/drive-oauth/` | Deployed separately, see below | Mints Google Drive tokens; also reads `allowed_users` |

`01` → `02` → `03` → `04` is the upgrade path for a project that already exists.
`schema.sql` is the same thing for a project that does not.

## Running one, click by click

1. Go to `supabase.com/dashboard` and sign in.
2. Click your project.
3. Left sidebar → **SQL Editor**.
4. **New query**.
5. Paste the whole file.
6. **Run** (or Ctrl and Enter).

Every file ends with a `select` that prints what it just did, so the results
panel at the bottom tells you whether it worked without you having to go
looking.

## The Edge Function

`supabase functions deploy drive-oauth` is its own step and is not covered by
a `git pull && npm run build`. It reads `allowed_users` too, so it needs
`03` to have been run first, exactly like the app does. Deployed before
`03`, it refuses callers with an error naming the file to run — deliberately,
because a check that cannot run is not permission to pass.
