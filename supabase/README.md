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
| `05-close-the-anon-hole.sql` | **Now.** No deploy needed either side | Removes any policy that is not on the expected list, including one an earlier Settings page told people to create |
| `06-second-admin-and-locked-stores.sql` | **Before** the roles build | Adds `admin_grants` (root grants a second admin) and makes ten configuration rows admin-write-only |
| `functions/drive-oauth/` | Deployed separately, see below | Mints Google Drive tokens; also reads `allowed_users` |

`01` → `02` → `03` → `04` → `05` → `06` is the upgrade path for a project that already exists.
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

## The policies that should exist, once everything is applied

Anything not on this list is a hole. `05` prints exactly this at the end, so
you can compare without having to remember it.

| Table | Policy | Command | Role |
|---|---|---|---|
| `workspace_state` | `allowed read` | SELECT | authenticated |
| `workspace_state` | `allowed insert` | INSERT | authenticated |
| `workspace_state` | `allowed update` | UPDATE | authenticated |
| `allowed_users` | `see your own row, or all of them if admin` | SELECT | authenticated |
| `allowed_users` | `only the admin adds` | INSERT | authenticated |
| `allowed_users` | `only the admin removes` | DELETE | authenticated |
| `admin_grants` | `see your own grant, or all of them if root` | SELECT | authenticated |
| `admin_grants` | `only the root grants admin` | INSERT | authenticated |
| `admin_grants` | `only the root revokes admin` | DELETE | authenticated |
| `drive_oauth_tokens` | none at all | | |

No DELETE on `workspace_state`: nothing in the app deletes a row, so granting
it would only widen what a mistake or a stolen session can do. No UPDATE on
`allowed_users`: without it nobody can rename a row into somebody else's
address. `drive_oauth_tokens` has RLS on and zero policies, so only the Edge
Function's service-role key reaches the Google refresh token.

No UPDATE on `admin_grants`: a grant is present or absent, never edited. Its
policies ask `is_admin()` (the root constant) and never `is_any_admin()`,
because a policy on a table cannot consult a function that reads that same
table without recursing — which is also why additional admins live in their
own table rather than as a column on `allowed_users`.

**Any row showing `{public}` or `{anon}`, or a command of `ALL`, is a hole.**
Policies are permissive and combine with OR, so one of those grants access
regardless of how strict every other policy is.

## The Edge Function

`supabase functions deploy drive-oauth` is its own step and is not covered by
a `git pull && npm run build`. It reads `allowed_users` too, so it needs
`03` to have been run first, exactly like the app does. Deployed before
`03`, it refuses callers with an error naming the file to run — deliberately,
because a check that cannot run is not permission to pass.
