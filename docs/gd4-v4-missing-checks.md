# GD4 v4 coverage gaps — Checklist Library import

`gd4-v4-missing-checks.csv` in this folder adds **31 checks** and **edits 2** existing
ones in the Audit Checklist Library, closing gaps found by comparing the shipped
155 checks against the official GD4 Version 4 guidance text.

## How to load it

1. Open **Audit Checklist Library** (`#/checklist-library`).
2. Click **⬆ Import CSV** and choose `docs/gd4-v4-missing-checks.csv`.
3. The import report should read **31 added, 2 updated, 0 errors**.
4. The 31 added checks land as **Draft**. They reach no AI prompt until you press
   **Approve** on each one. The 2 edits to built-in lines apply immediately, which
   is how the Library treats every edit to an existing check.

**Import this file once.** Its 31 new rows carry a blank `item_id`, which is what
marks them as new. Importing the same file twice therefore creates 31 duplicates
rather than recognising them. To bulk-approve after importing, use
**⬇ Export CSV** (the exported rows now carry real ids), change `status` from
`custom-draft` to `custom-active`, and re-import that file.

## Why a CSV and not an edit to the markdown

The criterion markdown files under `src/data/skills/` are the shipped seed. The
Library stores only a **diff** over that seed, in the browser and Supabase
(`ucc-gd4-domain-checklist:v1`) — there is no way to put an entry in that store
from the repository, so a CSV the user imports is the one route that adds checks
through the Library's own mechanism. The consequence is that these checks live in
the workspace, not in git: **Reset all** on the Library page removes them, and a
brand-new workspace will not have them until this file is imported again.

## Where each check went

All 31 fit sections that already exist. **No addition needed a new section.**

| Criterion | Added | Sections used |
|---|---|---|
| 1 | 2 | What a finance/governance specialist verifies · Strategic planning specifics (1.2) |
| 2 | 6 | Human Resource (2.1.1–2.1.2) · Data, Information & Knowledge Management … and Feedback |
| 3 | 1 | Selection & Appointment (3.1) |
| 4 | 12 | Pre-Course Counselling … (4.1) · Student Contract, Fee Collection & FPS (4.2) · Transfer, Deferment, Withdrawal (4.3) and Refund (4.4) · Support, Conduct & Attendance (4.5, 4.6) |
| 5 | 4 | Student Assessment (5.5) — the technical heart |
| 6 | 2 | Internal Assessment (6.1) · Management Review (6.2) |
| 7 | 4 | Measurement of Outcomes (7.1) |

The Criterion 7 indicator checks were deliberately **not** filed under
"Achievement of outcomes — four aspects to evidence under 7.1": that section is a
numbered list of exactly four aspects, and appending to it would produce a fifth,
sixth and seventh "aspect" contradicting its own heading.

## Sourcing

Every check except the Criterion 7 indicator names is grounded in the official
GD4 text already carried in `src/data/gd4Requirements.ts` (`describeShow` and
`notes` for the relevant item), so the wording can be checked against the source
in the app rather than taken on trust.

The four Criterion 7 checks name indicators from GD4 7.2.1–7.2.4 (liquidity and
debt-equity ratios, attrition/passing rate/quality of passes, graduation rate and
graduate achievements, GES for External Degree Programme graduates, complaint-
resolution SLA, average training hours including part-time academic staff). The
app's own record for 7.1.1 does **not** carry those indicator tables — its only
note says the framework "is provided in the official GD4 document" — and there
are no 7.2.x items in `GD4_REQUIREMENTS` at all. Those indicator names therefore
come from the published GD4 document and could not be cross-checked against
anything in this repository. They are tagged to 7.1.1, which is where this PEI's
outcome achievement is assessed.

## Also carrying the superseded "2–3 cycles" wording

The two edits in this file correct Criterion 7's "2–3 cycles" phrasing to the
GD4-mandated three-year trend. The same phrasing survives in two places the
Library cannot reach, and would need a code change:

- `src/data/skills/benchmarking-and-good-practice.md` (a BASE skill, not a
  criterion file, so it is not parsed into editable items)
- `src/lib/preAnalysisChecklist.ts`, the `7.1.1` outcome-denominators item (the
  Pre-check checklist is a separate store with its own editor at
  `#/pre-check-setup`)

## Guard

`src/lib/__tests__/gd4MissingChecksCsv.test.ts` imports this CSV against the real
markdown on every test run and asserts 31 added / 2 updated / 0 errors, that all
31 land as drafts, that a draft stays out of the composed prompt until approved,
and that every section named still exists. The two edits address built-in lines
by content-derived id, so rewording either source line in
`criterion-7-outcomes.md` breaks that id — the test is what catches it.
