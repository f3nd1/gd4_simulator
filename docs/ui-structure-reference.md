# UI Structure Reference — gd4_simulator

**Purpose of this document: visual/information-architecture redesign only.**

This document exists so that a different AI or developer can redesign the *visual layout* and *information architecture* of this app — spacing, grouping, typography, navigation, card boundaries, colour, discoverability — **without accidentally deleting or breaking any existing function**. Every button, toggle, deep link and data flow described below is real, current, working behaviour, confirmed against the actual code (file:line citations throughout) and, for the highest-traffic/most-recently-changed pages, against live screenshots of the running app.

**The hard rule for whoever redesigns from this document: every function, button and data flow named here must still work, and still be reachable, after the redesign.** Nothing here is a suggestion to remove — sections titled "Known confusing/awkward bits" are diagnostic (this is *why* a redesign is worth doing), not a deletion list. If a redesign collapses two visually-similar controls into one, the two different underlying actions must both still be reachable and distinguishable. If a control's real function isn't obvious from this document, treat that as a documentation gap to raise, not licence to guess.

This is documentation of the app **as it exists today**. No application code was changed to produce it.

---

## How this document is organised

Pages are grouped in the same order as the app's own sidebar (`src/nav.ts`), which is itself the definitive map of every page: **Home → 1 · Set up → 2 · Audit & evidence → 3 · Findings & review → 4 · Close out → Settings**. Within each group, "core" pages (the numbered steps) come first, then that group's "Tools & reference" tail (visually demoted in the real sidebar, but functionally full pages). Modals/overlays are documented immediately after the page that opens them.

Every page section follows the same five-part structure the task asked for:

1. **Purpose** — what it's for, in plain language.
2. **Structure** — what's on it, top to bottom / left to right, as it is laid out today.
3. **Key functions** — every real button/toggle/control, and exactly what it does (verified in code, not guessed).
4. **How it connects to other pages** — deep links in, links out.
5. **Known confusing/awkward bits** — genuinely flagged points of visual/discoverability confusion. These are redesign *opportunities*, not permission to cut functionality.

File:line citations are relative to `src/` unless a full path is given. Route paths are confirmed against `src/App.tsx`.

A closing section, **"Pages with the most hidden functionality"**, names the pages most worth prioritising in a redesign because their current layout most understates what they actually do.

---

# Home

## Dashboard (`src/pages/Dashboard.tsx`, route `/`)

### 1. Purpose
The app's home base and landing route: overall readiness score, EduTrust award projection, score-gate status, quick bulk-audit actions, a "pick up where you left off" resume panel, and a step-by-step guide through the app's 4 audit stages. Confirmed live via screenshot — the rendered page matches this structure exactly (score header, resume panel, "Getting started" 4-step card, Draft status / Risk alerts / Finalisation readiness cards).

### 2. Structure
All cards sit in a CSS grid (`repeat(auto-fit,minmax(220px,1fr))`), top to bottom:
1. **Score header card** (dark background, full-width) — score `total/1000`, EduTrust award, gate-pass message, `ThreePillarNote` (the "this tool assesses Process Quality only" disclosure), then a row of action buttons (`Dashboard.tsx:206-284`).
2. **Resume panel** "Pick up where you left off" — only rendered if there is unfinished work (`:287-301`).
3. **Strategic analysis (AI) result card** — only rendered after "Strategic AI analysis" has been run successfully (`:303-359`).
4. **Evidence recheck report card** — only rendered after "Recheck all evidence" has been run (`:361-408`).
5. **"Getting started — the audit workflow" card** — full-width, one sub-card per nav step-group 1–4 with a progress bar (`:410-451`).
6. **"Draft status" card** — cycle status pill, version, last-saved, "Save draft" button (`:453-469`).
7. **"Risk alerts" card** — items below Band 3, open AFIs, open critical findings, gate-at-risk counts (`:471-482`).
8. **"Finalisation readiness" card** — ready/blocked pill + link to Finalisation (`:484-492`).
9. **"Quick-win calculator" card** — full-width table, only shown if quick wins exist (`:495-530`).
10. **"Forensic integrity flags" card** — full-width, only shown if flags exist (`:532-554`).
11. `FeedbackModal` — hidden unless a thumbs-down is clicked on an AI analysis line (`:555-567`).

### 3. Key functions
- **"Use demo data"** — `confirm()` then `loadDemoDataset()`; overwrites existing evidence/scores/closures (`:219-226`).
- **"Recheck all evidence"** — `runEvidenceAudit(...)`; a pure read-only report, changes nothing else (`:227-232`).
- **"Audit all folders → score"** — `confirm()` then `auditAllFolders()`, refreshes the evidence report, navigates to `/scorecard` (`:233-246`).
- **"Re-audit changed only"** — `auditChangedFolders()`, shows an `alert()` with audited/skipped/unlinked counts, navigates to `/scorecard` only if something was audited (`:247-258`).
- **"Raise findings from gaps"** — `confirm()` then `raiseAllUnmetFindings()`, `alert()` with the count, navigates to `/findings` if any were raised (`:259-270`).
- **"Strategic AI analysis"** — only rendered when AI is enabled with a key configured; calls `runStrategicAnalysis()` → `runLiveCrossCriterionAnalysis(...)`, logs to the AI Review Log, auto-scrolls the result into view (`:271-280`, `:74-131`).
- **Thumbs up/down** on each priority/systemic-issue/immediate-action line in the AI analysis result — Accept logs an "Accepted" human decision; Reject opens `FeedbackModal`, which on submit logs "Overridden" and, if the AI was wrong, adds a calibration memory (`:317,332,352`, `:559-566`).
- **"Close"** on the Evidence recheck report card — dismisses it (`:368-370`).
- **Item links in the evidence report table** — `<Link to="/evidence-folder?sub=<subCriterionId>">` (`:391-393`).
- **"Save draft"** — `saveAsNewVersion("", "Quick save from dashboard")` (`:463-468`).
- **Workflow step "Open [Label] →"** links — one per nav step-group, deep-linking to `/profile-of-pei`, `/start-audit`, `/findings`, `/scorecard` respectively (`:444-446`).
- **"Open finalisation checklist →"** — `<Link to="/finalisation">` (`:489-491`).
- **Quick-win item links** — `<Link to="/sub-checklist?item=<id>">` (`:517-519`).

### 4. Connections to other pages
Outbound: `/scorecard`, `/findings`, `/evidence-folder?sub=<id>`, `/finalisation`, `/sub-checklist?item=<id>`, `/afi-closure`, `/findings?subCrit=<id>` (all from the resume panel — `src/lib/resumePanel.ts`, a pure function driven by `lastAuditRuns`, pending commits, draft counts, findings and closures — the main cross-page "unfinished work" hub). Inbound: none — Dashboard is `/`, nothing deep-links into it with query params.

### 5. Known confusing/awkward bits
- Four-to-six action buttons in the score-header row ("Use demo data", "Recheck all evidence", "Audit all folders → score", "Re-audit changed only", plus conditionally "Raise findings from gaps"/"Strategic AI analysis") all share nearly identical pill styling, differing only by text colour — easy to conflate a destructive/bulk, AI-cost-incurring action with a harmless read-only one.
- "Use demo data" overwrites existing evidence/scores/closures behind a text-only `confirm()`, with no visible undo on this page (undo path is restoring a saved version from Draft Workspace).
- "Strategic AI analysis" only appears when AI is enabled and a key is configured — without that, the button simply doesn't exist, which could look like dead/missing code to a developer or redesigner testing without a key.
- The Quick-win calculator and Forensic integrity flags cards disappear entirely with no data — a redesigner working from an empty/demo workspace may never see them.
- The "Getting started" 4-step guide is generated from `nav.ts` (`workflowSteps = NAV.filter((g) => g.step != null)`) — if `nav.ts` changes, this card's step count/labels change too. A redesign that hardcodes 4 boxes here would silently break that coupling.

---

## Draft Workspace (`src/pages/DraftWorkspace.tsx`, route `/draft-workspace`)

### 1. Purpose
Save/restore versioned snapshots of the entire workspace, download a full local JSON backup, duplicate or reset the current audit cycle, and view an immutable log of every restore.

### 2. Structure
Two-column grid (`1fr 1fr`) plus one full-width conditional card:
1. **"Draft workspace" card** (left) — status pill + version, timestamps, "Version name"/"Note" inputs, an explanatory note about Duplicate vs. Create new, then a button row: Save as new version / Duplicate cycle / Download backup (JSON) / Create new (blank) cycle / Unlock (admin) or "Go to Finalisation to lock →" (`:47-110`).
2. **"Saved versions (N)" card** (right) — list of saved versions, each with a "Restore this version" button (`:112-134`).
3. **"Restore audit log (N)" card** (full-width, conditional) — table of every restore event, most recent first (`:136-161`).

### 3. Key functions
- **"Save as new version"** — disabled when locked; `saveAsNewVersion(name, note)` — bumps the version number, snapshots nearly all workspace state including the checklist module, caps history at 50 entries (`:77-83`).
- **"Duplicate cycle"** — `duplicateCycle()` directly, **no confirm dialog** (`:84-86`).
- **"Download backup (JSON)"** — bundles every persisted app key (workspace, checklist, drafts, profile, settings — including saved API keys) into a downloaded JSON file, **no confirm dialog** (`:87-93`).
- **"Create new (blank) cycle"** — `confirm()` then `createNewCycle()` — wipes evidence/findings/checklist to blank but preserves saved versions and carries forward still-open findings (`:94-96`).
- **"Unlock (admin)"** — shown only when locked; `unlockCycle()`, **no confirm dialog** despite being an admin override of a lock (`:97-100`).
- **"Go to Finalisation to lock →"** — `<Link to="/finalisation">`, shown only when not locked (`:102-107`).
- **"Restore this version"** — `restoreVersion(v.id)` directly, **no confirm dialog**, rolls back cycle + checklist state to the snapshot (`:125-130`).

### 4. Connections to other pages
Outbound: `<Link to="/finalisation">` when not locked. Inbound: none found.

### 5. Known confusing/awkward bits
- **"Restore this version" has no confirmation dialog, while "Create new (blank) cycle" does** — both replace current in-progress work, but only one warns.
- **"Duplicate cycle" also has no confirm dialog** and no destructive-looking styling, yet silently creates a whole new unsaved cycle copy — sits right next to "Save as new version."
- Five buttons of visually similar weight in one row; only "Create new (blank) cycle" is red-tinted to hint at danger — the rest look equivalent despite very different consequences (versioning vs. destructive wipe vs. file download vs. navigation).
- "Unlock (admin)" has no confirm dialog and no visible access control beyond conditional rendering.
- The Duplicate-vs-Create-new explanatory paragraph is small, low-contrast text easy to miss.

---

## Analytics — nav label "Data Dashboard" (`src/pages/Analytics.tsx`, route `/analytics`)

### 1. Purpose
A read-only visual dashboard summarising scores, bands, gates, findings and evidence/checklist progress — pure charts derived from live workspace data. Nothing to fill in.

### 2. Structure
Grid of cards (`repeat(auto-fit,minmax(280px,1fr))`), top to bottom:
1. "Data dashboard" header card (`:33-36`).
2. "Overall readiness & EduTrust attainment" — `Gauge` + `AttainmentLadder` + gate-pass pill (`:38-47`).
3. "Findings" — `Gauge` (closed/total) + severity bars (`:49-58`).
4. "Items by band" — bar chart, Not started/Band 1-5 (`:60-63`).
5. "Band by criterion" — one bar per criterion (`:65-68`).
6. "Critical gates (need Band 3+)" — bars + pass/fail pills (`:70-76`).
7. "Evidence & audit progress" — 4 percentage metrics (`:78-90`).
8. "Checklist line status" — stacked bar, Met/Partial/Not met/Not started/N-A (`:92-103`).

### 3. Key functions
**None.** No buttons, links, toggles or click handlers anywhere in the file — confirmed by grep. Entirely derived, read-only output of `buildAnalytics(...)` (`src/lib/analytics.ts`).

### 4. Connections to other pages
None either direction — reached only via the sidebar's "Tools & reference" tail.

### 5. Known confusing/awkward bits
- **Naming mismatch**: route `/analytics`, file `Analytics.tsx`, but the nav label and the on-page heading both say "Data Dashboard" — a developer searching the codebase for "Analytics" won't find "Data Dashboard" in the UI and vice versa.
- Entirely non-interactive, so a redesign is free to restructure the charts/cards without preserving any click logic — unusual relative to the rest of the app, worth confirming explicitly so no one hunts for hidden interactivity.
- Not linked from Dashboard itself (no "View analytics" link there) despite containing valuable overview data — a step further from the main workflow than its value would suggest.

---

## Help & Guide (`src/pages/Help.tsx`, route `/help`)

### 1. Purpose
In-app documentation: a two-tab reference — a full audit-workflow walkthrough for end users, and a separate architecture/working-rules reference for developers.

### 2. Structure
Header card (title, blurb, "For Users"/"For Developers" tab buttons) then one of two tab bodies.

**Users tab**, in order: lifecycle diagram (inline SVG, 6 stages: Setup → Run → Review → Clarify → Finalise → Export, with a dashed "re-check until resolved" loop back from Clarify to Review) → "1 · Set up" card → "2 · Run an audit — the three modes" card → "3 · Evidence Folder" card → "4 · Checklist, band and findings" card → "5 · Clarification round" card → "6 · Final Report" card → "7 · AI Calibration" card → "8 · Export Centre" card → "9 · Pre-check" card → three "Worked example" cards → a **"Page-by-page reference"** section listing every page in `NAV`, each linked, with What/How text.

**Developers tab**, in order: "Standing working rules" card (red — includes the list of files that must never be modified without explicit approval: `scoring.ts`, `checklistBanding.ts`'s override computation, `gd4Requirements.ts`, `consistencyChecker.ts`) → "Architecture in one breath" → "Feature map with reasoning not obvious from the code" → "Known limitations / parked items" → "Where to look first when something breaks."

### 3. Key functions
- **"For Users"/"For Developers"** tab buttons — local state only.
- Every other interactive element is a plain `<Link>` — no button anywhere on this page mutates store state, runs AI, or performs any action beyond navigation (confirmed by grep).
- The "Page-by-page reference" list is generated live from `visibleNav(showDeveloperTools)`, so it can never structurally drift from the real page list — its What/How prose is separately maintained in a `DETAILS` map keyed by route, falling back to the nav `hint` text if a route is missing from `DETAILS`.

### 4. Connections to other pages
Dozens of outbound `<Link>`s, effectively a full sitemap of the app. No inbound query-param deep links.

### 5. Known confusing/awkward bits
- The Developers tab is aimed at engineers/AI agents, not real auditors — a purely visual redesign must not make it feel "in the way," since it's one click away behind an equally-weighted tab button.
- The `DETAILS` map (the What/How prose) is a hand-maintained object keyed by route path — a renamed/removed route silently falls back to the shorter nav `hint` rather than erroring, so page *content* can drift out of sync even though the page *list* can't.
- The lifecycle diagram is a bespoke inline SVG with absolute-positioned coordinates (not CSS/flex) — a redesign that wants to reflow it needs to hand-edit SVG geometry.

---

# 1 · Set up

## Profile of PEI (`src/pages/ProfileOfPei.tsx`, route `/profile-of-pei`)

### 1. Purpose
Structured record of the school's (PEI's) background, status, personnel, finances, courses and demographics — and doubles as the free-text briefing injected into every AI audit call.

### 2. Structure
- Header card: title + editable "provided on" date, plus an "AI audit context strip" — checkbox "Inject as AI audit context" + On/Off pill + live sent-size/token estimate, with a possible truncation warning (`:499-526`).
- 8-tab bar: Background, ERF & EduTrust Status, Key Personnel, Facilities, Financial Health, Courses Offered, Student Profile, Staff Profile (`:530-551`). Only one tab renders at a time.
  - Background: free-text textarea, also writes to AI context.
  - ERF & EduTrust Status: editable status-row table.
  - Key Personnel: 4 sub-tables (Shareholders/Owners with a live %-sum-to-100 warning, Board of Directors, Management Team, Academic & Examination Board).
  - Facilities, Financial Health, Courses Offered, Student Profile, Staff Profile: plain fields, markdown textareas, or a wide table.
- "Extra AI context from Drive" card (`ContextDriveCard`) — moved here from a retired "School Context" page.
- "Audit Journal — running findings log" card (`AuditJournalCard`) — also moved from the retired page.

### 3. Key functions
- Tab buttons — local state only.
- "Inject as AI audit context" checkbox — `setSchoolContextEnabled(checked)`.
- Background textarea `onChange` — writes to **both** `useProfileOfPeiStore().setBackgroundMarkdown` and `useWorkspaceStore().setSchoolContextText` — i.e. editing Background live-syncs into the AI context.
- "+ Add row"/"✕" delete buttons throughout the tables — call the matching `useProfileOfPeiStore()` setter with no confirmation dialog.
- "Read from Drive" (ContextDriveCard) — `readSchoolContextFromDrive()`; disabled while reading.
- "Open" link next to the Drive folder input — plain external link, shown only when a link is set.
- "View journal"/"Hide" — local toggle only.
- "Clear journal" — `confirm()` then `clearAuditJournal()`.
- "provided on" date input — free text, not a native date picker.

### 4. Connections to other pages
No `<Link>`, `navigate()`, or `useSearchParams` in the file — a pure leaf page. Its data feeds AI calls elsewhere via the store, not via routing.

### 5. Known confusing/awkward bits
- Two textareas both feed the AI context in overlapping ways: the Background tab (auto-synced every keystroke) and the separate "Extra AI context from Drive" card lower on the page — a user could reasonably expect one "AI context" source and miss that both compose together.
- The "AI audit context strip" (toggle + token estimate) sits in the header card, visually separated from the Background tab it actually governs by the whole tab bar.
- "Extra AI context from Drive" and "Audit Journal" are explicitly noted in code comments as leftovers "moved from the retired School Context page" — functionally unrelated to the 8-tab profile above them, easy to strand in a redesign since nothing in the tab UI hints they exist.
- "Read from Drive" requires Google Drive connected in Settings — only mentioned in small print, not enforced/disabled in the UI if Drive isn't connected.

---

## Audit Cycle (`src/pages/AuditCycle.tsx`, route `/audit-cycle`)

### 1. Purpose
Set up the audit cycle's dates/scope/owner/Drive root and lifecycle status, and maintain the shared department directory used across the app.

### 2. Structure
Two-column grid: **left** "Audit cycle setup" card (Name, Audit type, Period start/end, Evidence cut-off date, Scope, Audit owner, Drive root URL + "Open Drive root folder" link); **right** "Status & lifecycle" card (status buttons, version/timestamps, "Duplicate this cycle"/"Create new (blank) cycle", explanatory note). Below both, full-width "Departments" card — Reset-to-defaults button, add/edit form (Acronym/Full name/Person in charge), and a table with per-row Edit/Remove.

### 3. Key functions
- All setup fields — `updateCycle({...})` per field, all disabled when `cycle.status === "Locked"`.
- Six status buttons (Draft/Under Review/Returned for Amendment/Ready for Management Review/Finalised/Locked) — `updateCycle({status})`; once Locked, every other button disables — **clicking a status button is also how the whole page's lock state changes.**
- "Duplicate this cycle" — `duplicateCycle()`, **no confirmation.**
- "Create new (blank) cycle" — `confirm()` then `createNewCycle()`.
- "Reset to defaults" (Departments) — `confirm()` then `resetDepartments()` — full replace, not merge.
- "Add department"/"Save changes" — validates non-empty acronym + case-insensitive collision check (`window.alert` on collision).
- Per-row "Edit"/"Remove" — Remove has **no confirmation.**

### 4. Connections to other pages
No `<Link>`/`navigate()` in the file — only text pointers ("Use Draft Workspace to save progress...", "...unlocking from the Finalisation Checklist screen") with no actual links. The Departments card explicitly documents that Auditor Creation, Auditor Checklist, Dashboard and Export Centre all read this same department list — a real cross-page dependency with no navigational link.

### 5. Known confusing/awkward bits
- "Duplicate this cycle" has no confirmation while "Create new (blank) cycle" does — sitting side by side with very different risk levels.
- The status-button row doubles as the sole lock/unlock mechanism, with nothing visually distinguishing "Locked" as special among six equal-looking buttons.
- "Reset to defaults" is a full replace; the button label alone doesn't convey that current custom departments are deleted.
- The Departments card is functionally unrelated to "cycle setup" (shared master data used by 4 other pages) but is bolted onto the bottom of this page with no visual separation beyond its own card border.

---

## Auditor Creation (`src/pages/AuditorCreation.tsx`, route `/auditors`)

### 1. Purpose
Create/edit the roster of auditors (human or AI) who will work the audit, pick which sit on the Review Panel, and view/tune the four simulated AI agent roles.

### 2. Structure
Four cards: (1) "Create auditor"/"Edit auditor" form (Name, Type, Department, Role, Focus area, Checklist template, Review Perspective, Strictness slider, Create/Save + Cancel, "Load preset auditors"); (2) "Auditor profiles (N)" table with inline-editable Perspective/Strictness per row + Edit/Remove; (3) "Review Panel" — toggle-buttons per auditor + a "Panel ready"/"Select N-M auditors" status pill; (4) "Simulated AI agent roles" — 4 agent cards each with a strictness slider.

### 3. Key functions
- "Create auditor"/"Save changes" — requires non-empty name+role; `addAuditor`/`updateAuditor`.
- "Load preset auditors" — if roster empty, seeds immediately; otherwise shows an in-page confirm panel with "Add presets" (adds the 5 missing presets, adds to review panel) vs. "Replace existing with presets" (wipes and replaces the whole roster) vs. "Cancel."
- Per-row table Edit/Remove — Remove has **no confirmation.**
- Per-row inline Perspective select/Strictness slider — save **instantly** on change, bypassing the top form's Create/Save flow entirely.
- Review Panel buttons — toggle membership, disabled once `MAX_PANEL` is reached.
- "Simulated AI agent roles" strictness sliders — a **separate store slice** (`agents`) from the human/AI auditor profiles above.

### 4. Connections to other pages
No `<Link>`/`navigate()` — only unlinked text pointers to "Settings, Auditor Review Panel" and "AI Agent Review" (the actual route is `/ai-review`, labelled "AI Review Log" in nav).

### 5. Known confusing/awkward bits
- Two visually near-identical "auditor list" surfaces on one page: the table's inline-editable Perspective/Strictness (Card 2) vs. Review Panel membership toggles (Card 3) — different actions on the same auditor names, easy to mistake for one control.
- The top form uses an explicit Create/Save-then-submit flow, but the same fields (Perspective, Strictness) are also instantly editable per-row below — two different edit paradigms for the same data.
- "Load preset auditors" silently disappears while editing an auditor — could read as a bug rather than deliberate state.
- The four "Simulated AI agent roles" are a completely separate system from the human/AI "auditors" above (different store slice) despite near-identical UI (name + strictness slider) — the only disambiguation is one line of body copy.
- Review Panel buttons closely resemble a plain multi-select but cap out at `MAX_PANEL` and grey out — could read as a rendering glitch without reading the tooltip.

---

## GD4 Library (`src/pages/GD4Library.tsx`, route `/gd4-library`)

### 1. Purpose
Read-only reference of the full GD4 requirement text (item list + detail), including the official EduTrust band rubric, for auditors to consult.

### 2. Structure
Two-column grid: left card, a scrollable table of every GD4 requirement (Item/Area, clickable rows, gate badge on gate-sensitive items); right card, detail panel for the selected item — heading, meta line, "Intent" (read-only textarea), "Expected evidence" bullets, "Official band rubric" (`EdutrustBandTable`), optional scoring notes.

### 3. Key functions
Table row click selects which item's detail shows on the right — purely local state. Everything else is read-only display; no store mutation anywhere in the file.

### 4. Connections to other pages
None — no deep-link-in to a specific item, no outbound navigation.

### 5. Known confusing/awkward bits
Genuinely simple, nothing confusing: a pure master-detail reference with no writes and no destructive actions. Minor note: the "Intent" field is a `readOnly` textarea styled identically to editable inputs elsewhere — a user might try to type in it before noticing nothing happens.

---

## Pre-check Checklist Setup (`src/pages/PreCheckChecklistSetup.tsx`, route `/pre-check-setup`)

### 1. Purpose
CRUD editor for the per-GD4-item "pre-analysis checklist" shown to auditors during a run's Pre-check step — the live, editable copy of the seed data in `src/lib/preAnalysisChecklist.ts`.

### 2. Structure
Four cards: (1) intro + draft/verify explanation + a note about the separate "universal" date/time-discrepancy layer that always runs, plus cascading Criterion → Sub-criterion → GD4 item filters; (2) "Recurring findings not yet on the checklist" — conditional, only when patterns exist — each with an "Already covered" pill or a "Promote to checklist item" button; (3) "Checklist items [scope] (N)" — search box, a bulk-action bar (Approve/Revert/Delete selected/Clear selection) that appears once rows are checked, and the main table (checkbox, item, title+description, mode, detection, source, status, per-row ↑/↓/Edit/Approve-or-Revert/Remove); (4) "Add item"/"Edit item" form, usable only when a specific GD4 item is selected.

### 3. Key functions
- **"Promote to checklist item"** — creates a new **unverified draft** item citing the source findings; never auto-approves.
- Bulk bar: "Approve selected" / "Revert to draft" / **"Delete selected" (confirm-gated)** / "Clear selection" (local only).
- Per-row **"Remove" has no confirmation** — unlike the bulk delete, which does.
- Per-row "Approve"/"Revert to draft" — toggles the draft/verified gate for that single item.
- Add/Edit form — requires the item filter to be a specific item (not "All"); new/edited items **always start `verified:false`** regardless of anything typed in the form.

### 4. Connections to other pages
No `<Link>`/`navigate()`/`useSearchParams`. Reads findings via `useAllFindings()` to compute recurring patterns, but has no navigational link to Findings. Its store is read by the run-flow's Pre-check step — a data-only connection, no route link either way.

### 5. Known confusing/awkward bits
- **Draft vs. Verified gate is only partially visually clear.** The Status column does show a distinct "⚠ Draft" badge vs. a green "Verified" pill — but on the Add-item form itself, the "starts as draft" fact is buried in small grey footnote text below the form, not next to the primary Add button. "Approve"/"Revert to draft" render as ordinary same-size text buttons alongside Edit/Remove/reorder, with nothing visually flagging them as more consequential — despite the underlying data comments explicitly calling for this distinction to be "unmissable."
- The "All items" filter view hides the Add/Edit form entirely (replaced by a placeholder) — easy to miss that this mode-dependent disappearance is deliberate.
- Single-row Remove has no confirmation; bulk Delete does — the same inconsistency pattern seen on Audit Cycle (Duplicate vs. Create-new).
- The "Recurring findings" card only appears conditionally — a whole feature that can be entirely invisible depending on data state.
- A page-level note calls out a separate, always-on "universal" date/time-discrepancy layer that isn't editable anywhere on this page — the page implies it lists "all checklist items," but it's incomplete by design.

---

# 2 · Audit & evidence

## Start Audit (`src/pages/StartAudit.tsx`, route `/start-audit`)

### 1. Purpose
One cycle-level setting: how much the AI does for the whole audit cycle (Full auto / Hybrid / Manual). Explicitly distinct from the per-sub-criterion Option A/B **path** chosen later, on Evidence Folder.

### 2. Structure
Walkthrough overlay → `NextStepBanner` → blocking auditor-guard banner (red, if no auditor assigned, with a "Go to Auditor Creation →" link) → review-panel-under-minimum notice (amber) → a single card: header ("Runs as: …" pill) → explanatory paragraph → a 3-card mode grid (Full auto ⚡ / Hybrid 🤝 / Manual ✍️, each with icon, "Selected" pill when active, description, "best for" line) → footer row ("Continue to Evidence Folder →" + "Current mode: …" text).

### 3. Key functions
- **Mode card button** (×3) — `setAuditMode(m.value)`; selecting doesn't navigate, just persists the mode.
- **"Go to Auditor Creation →"** (×2, guard banner + panel notice) — `<Link>`.
- **"Continue to Evidence Folder →"** — the page's only forward-navigation control.
- **WalkthroughLink** — replays the 3-step onboarding walkthrough.

### 4. Connections to other pages
→ `/evidence-folder` (Continue), → Auditor Creation (guard banners). No query params read or produced by this page itself; Evidence Folder links back here via its own "Change mode →" control.

### 5. Known confusing/awkward bits
The page explicitly disclaims that Option A/B path selection is *not* chosen here — worth preserving as a callout in any redesign, since users conflate "mode" (AI automation level) with "path" (A/B analysis method); Evidence Folder repeats this distinction in its own "Which mode?" popover. Otherwise this is the simplest, lowest-redesign-risk page relative to Evidence Folder.

---

## Evidence Folder (`src/pages/EvidenceFolder.tsx`, route `/evidence-folder`)

### 1. Purpose
The main audit-execution surface: link each sub-criterion's Google Drive folders (Policy + Evidence), choose an analysis path (A or B) per sub-criterion, run the audit, and review/reopen results — all without leaving the page (results open in modals layered over this page). Confirmed live via screenshot — one card per sub-criterion, matching the structure below.

### 2. Structure
Overlays (highest to lowest, only one "run" overlay ever visible at once): `AuditProgressModal` (Option B single-folder run) → `AuditRunModal` (reopened saved Option B run) → `OptionAReviewModal` (Option A PPD+Evidence review) → `FullAuditOverlay`/`HybridDraftOverlay` (full-auto sweep / hybrid draft, highest z-index). `VisionBudgetPromptModal` is **not** rendered here at all — it's mounted once, globally, in `Layout.tsx` (see its own entry below).

Inside the main card: header + Show/Hide help toggle → collapsible help block (usage text, folder-naming conventions, file-text cache panel) → "Additional info" school-wide Drive-link box → filter row (Criterion/Sub-criterion selects + Clear + count) → blocking guards (no-auditor banner, Drive-not-connected banner) → auditor+scope selector bar ("Run audit as" dropdown, panel-notice, "Scope" dropdown) → `NextStepBanner`/`Walkthrough` → `RunModeBanner` → mode chip strip (current mode + "Change mode →"; in full-auto mode this same strip hosts "⚡ Run full audit") → `PathGuidance` collapsible explainer → the **card list** (one per folder/sub-criterion), the page's core repeating unit.

**Per-sub-criterion card**: header row (chevron, folder name, Status chip → dropdown, Owner chip → dropdown) → two-column body: **left** (Policy/Evidence link chips + open-in-Drive links + file-count/duration estimate; Path A/B toggle chips, each ✓ if that path has saved results, with a 3-step PPD→Evidence→Compile sub-progress when A is selected) → **right** (progress chips for the *currently selected path only*; the primary action button, "View results", and the "⋯" overflow menu) → expandable detail (same-folder-link warning, access notes, audit-result summary, pre-flight probe panel).

### 3. Key functions — page-level
- **Show/Hide help** — local toggle only.
- **View files / Clear cache** — `clearFileTextCache()`, `confirm()`-guarded.
- **Additional info "Check access"** — `checkAdditionalInfoAccess()`.
- **Filter selects + Clear** — local state only, no store writes.
- **"Connect to Google Drive"/"Reconnect"** — `connectDrive()`; appears in multiple places (blocked banner, per-card link chips, run overlays).
- **"Run audit as" select** — `setActiveAuditor(id)`.
- **"Scope" select** — `setAuditScope(value)`, shows a partial-scope warning for non-"both" values.
- **"Change mode →"** — `<Link to="/start-audit">`.
- **"⚡ Run full audit"** (full-auto mode only) — `runFullAudit()`; disabled while busy/running/no auditors.
- **Mode-chip dismiss ✕** (non-full-auto only) — ephemeral local state, reappears on reload.

### 3. Key functions — per-card
- **Status chip / Owner chip** — click opens a `<select>`, writes `setFolderField(...)`.
- **Policy/Evidence link chip** — toggles inline editing mode (2 URL inputs, per-link Remove buttons, Done button); Remove/Done flush the debounced save.
- **Path A/B toggle buttons** — `setAnalysisPath(scope, "A"|"B")` — this is a **view + assessment-method selector**, not itself a run trigger; it changes which saved result "View results" opens and which run button appears.
- **Primary action button** (label/behaviour depends on mode + path):
  - Full-auto mode → disabled "Locked" (per-card runs blocked; must use the top "Run full audit").
  - Manual mode → "Open checklist →" (`/sub-checklist?item=<firstItemId>`).
  - Path A → "Run review" (opens `OptionAReviewModal`); **if Hybrid mode AND auto-score-bands is on, the SAME button instead runs the whole item end-to-end after a `confirm()`**, and its label changes to "Run audit →" — same position/style, very different behaviour.
  - Path B → "Run audit →" (`auditFolderStaged(f.id, "all")`).
  - **"Auditing…"/"Cancel"** replaces the button cluster while this card's run is in flight.
- **"View results"** — shown only when the currently-selected path has a saved result; opens the matching modal instantly, no AI call. A second, identical link exists inside the expanded detail block.
- **"⋯" overflow menu** — exhaustive list, in order: **"📋 Official requirements (no audit needed)"** (always present — opens `OptionAReviewModal` on the Requirements tab, zero files/run needed); "Run staged audit (Option B)" / "Policy check only (Option B)" / "Evidence check only (Option B)" (Hybrid mode only, lets a user get a fast B-path result even while Path A is selected); "Check policy access" / "Check evidence access"; **"🔎 Check folder before auditing"** — the only zero-AI, zero-cost diagnostic action on the card (expands the row, calls `probeFolder(...)`, persists the result).
- Expanded-row dismiss ✕ buttons (Access-Policy note, Access-Evidence note, Audit-result block) — local, keyed so a new result "un-dismisses" it.
- "Show full result"/"Show less" — local toggle for the truncated result text.
- Pre-flight panel "Show pre-flight check"/hide ✕ — the toggle is local, but the underlying probe result persists in the store and survives reload.

### 4. Connections to other pages
Deep links in: `?sub=<subCriterionId>` (expands/scrolls/highlights that card), `?run=<runId>` (opens the matching Option A or B result modal), `?review=<subCriterionId>` (opens `OptionAReviewModal` directly — used by the Manual-mode banner on Sub-Criterion Checklist). Outbound: `/start-audit` (Change mode), `/sub-checklist?item=<id>` (Manual-mode primary button and the no-stored-result View-results fallback), `/final-report` (Full-auto/Hybrid overlay completion links).

### 5. Known confusing/awkward bits
- **Path A/B toggle is view state, not a filter that discards data**: switching it changes which "View results" reopens and which primary button/label shows, but does not delete the other path's saved results — both coexist. A user could easily believe switching "loses" the other path's results.
- **The exact same primary button silently changes what it does** ("Run review" opens a modal vs. "Run audit →" runs a multi-minute unattended pipeline after one `confirm()`) purely based on mode+setting — the label is the only signal.
- **The overflow menu hides consequential, mode-gated actions**: 3 of ~7 items only appear in Hybrid mode; the pre-flight check is the card's only zero-cost diagnostic; "Official requirements" is the only entry point to reference text needing no folders/run at all — all easy to bury or drop in a visual redesign that treats "⋯" as a junk drawer.
- **Very high control density per card** (Status chip, Owner chip, 2 link chips + editor mode, file-count text, 2 Path toggles + sub-progress, 4 Progress chips, 1-2 primary buttons, View results, "⋯") deliberately packed per code comments — a redesign compressing this further risks conflating the Path toggle (semantic selector) with the Progress chips (read-only status), since both render as similarly-sized pills.
- Multiple "View results" entry points render identically in different DOM locations — functionally redundant, not buggy, but worth consolidating conceptually.
- Ephemeral vs. persistent dismiss states look visually identical (mode-chip ✕ resets on reload; access-note/audit-result ✕ are ephemeral but content-keyed; pre-flight ✕ hides the panel but the underlying result persists across reloads) — no visual cue for which "comes back."
- **`VisionBudgetPromptModal` is invisible to anyone only reading this file** — it can appear mid-run, blocking, purely because it's globally mounted in `Layout.tsx`. A redesign of this page's overlay/z-index stack must account for it even though it's not part of this page's own render tree.
- `AuditProgressModal` is suppressed during full-auto sweeps (its content is folded into `FullAuditOverlay` instead) — the "same" step-by-step UI is implemented twice, for two different container overlays.

---

### Modal: Audit Progress (`AuditProgressModal`, in `EvidenceFolder.tsx:1233-1520`)

**Triggers**: shown when a single-folder Option B run is in progress (not during a full-auto sweep, where its content is folded into `FullAuditOverlay` instead).

**Shows**: header (folder name, scope badge, mode badge, "Folder X of Y" if batch); a 5-step visual pipeline (Connect → Read files → Ask AI/Audit → Save → Complete); a "stuck" warning if no heartbeat for >100s; progress bars; a clickable step timeline with per-step detail panels.

**Buttons**: "Skip pass →" (AI/Audit step only) → `skipCurrentAuditStage`; "Cancel audit" → `cancelBusy`; per-file "Skip" inside the Read-files detail; export buttons inside detail panels ("Export file ledger CSV", "Export AI summary CSV"); "View results →" (opens the appropriate result modal and clears the progress) or a fallback link; "Dismiss" (errors only); "Close." The `×` close button confirms before closing if still running.

---

### Modal: Audit Run — Option B result (`AuditRunModal`, in `EvidenceFolder.tsx:1524-1641`)

**Triggers**: a card's "View results" (path B), the expanded-row "View results →" link, a `?run=` deep link resolving to an Option B run, or `AuditProgressModal`'s "View results →" for path B.

**Shows**: read-only record of a completed/saved Option B run — title, run ID, timestamp, scope/status badges, sampling caveat; metadata row (auditor, specialist lens, AI model, live/offline, chunks, batches, lines assessed); verdict summary counts; `HybridGatePanel` (per-verdict accept/reject/edit gate for Hybrid runs still pending); `FileLedger`; `VerdictTable`; `ResultNavLinks` (jump to Checklist/Findings for this sub-criterion).

**Buttons**: "⬇ Export AI summary CSV", "⬇ File ledger CSV", "Close" (× and bottom button, both close).

---

### Panel: Folder pre-flight check (`FolderProbePanel`, in `EvidenceFolder.tsx:1697-1755`)

Not a floating modal — an inline panel inside an expanded card's detail area, shown after "🔎 Check folder before auditing" completes. Zero AI calls. **Shows**: file/policy/evidence counts, unreadable count; a warning list (mis-named subfolders etc.) or a green "No problems found"; a scrollable per-file list with Drive deep-link, bucket tag, "via vision" tag for scanned PDFs, and an "unreadable" flag with tooltip reason. **Buttons**: a single "✕" that hides the panel — the underlying stored result is retained and reopenable.

---

### Modal: PPD + Evidence Review — Option A (`OptionAReviewModal`, in `EvidenceFolder.tsx:1653-1692`, embeds `PpdReviewContent` from `src/pages/PPDReview.tsx`)

This is the complete Option A review workflow for one GD4 sub-criterion, opened over the Evidence Folder page. It has **four tabs**. Confirmed live via screenshot (Evidence tab) — the rendered layout matches the structure below exactly, including the nav/export row, coverage matrix with its CSV/PDF/Options controls, and the "Also assess Outcomes & Review →" panel.

#### 1. Purpose
- **Official requirements** — read-only reference: the published EduTrust GD4 wording for this sub-criterion, zero audit/verdict data.
- **PPD Review** — the AI's policy-document review: one verdict per requirement line, judged against policy text only.
- **Pre-check** — a per-sub-criterion pre-analysis checklist gate between PPD and Evidence, reusing files already read; non-blocking.
- **Evidence** — the AI's evidence-folder assessment (reuses the PPD verdict + reads Actual Evidence files for a combined verdict), the hybrid approval gate, findings compile, and the optional Outcomes & Review pass.

#### 2. Structure
Modal chrome: full-screen dim backdrop, near-fullscreen white panel, z-index 110 (above per-row modals at 100, below the Full-auto overlay at 120). Fixed header: title, a "↻ Re-run" button (PPD only — Evidence has its own separate re-run button inside), and a ✕ close that keeps everything saved. Body renders `PpdReviewContent` — **the exact same component used by the retired standalone `/ppd-review` page**, so page and modal cannot drift.

`PpdReviewContent` body, top to bottom: consolidated status bar (`RunModeBanner`, a "Last reviewed…" summary line with separately-labelled PPD counts and Evidence counts, plus links to Sub-Criterion Checklist & Scorecard, and state-aware next-step guidance) → nav/export row (`ResultNavLinks` + `OptionAExportButtons`: "⬇ Line summary CSV", "⬇ File ledger CSV") → a one-line scope caption → the **4-tab bar** (Official requirements → PPD Review → Pre-check → Evidence; the Evidence tab carries a "⏸ N" badge when hybrid-gate verdicts are queued) → tab content.

- **Official requirements tab**: header row (label, line/item count, "⬇ CSV"/"⬇ PDF") → pop-up-blocked warning banner if applicable → a persistent amber "nothing here has been checked against any document" notice → per-item bordered tables (Ref | Section | Official requirement text, lettered sub-items indented) → footer source line. **No verdict, tick, status pill, evidence, or run-state anywhere — deliberately.**
- **PPD Review tab**: Run/Cancel → guard banners → live progress → cancelled/no-review/stale states → Policy `FileLedger` → run-warnings → collapsible "Overall PPD assessment" panel → internal-contradictions panel → run-metadata + historical-run picker → the `LineageDiagram` "Requirement coverage — policy" matrix → `FeedbackModal`.
- **Pre-check tab**: either a plain "no checklist defined" message + "Continue to Evidence →", or `PreAnalysisChecklistPanel` fed the combined file ledgers, with its own "Continue to Evidence" button. Never triggers an AI run.
- **Evidence tab**: guard banner → `EvidenceArrivalPanel` (state-branching: not-ready/checking/ready/ready-with-flags/staged/existing/changed) → action row (Run/Re-run, run-metadata + historical picker, "Compile findings →(N)", "Findings register →") → failed-lines retry banner → live progress → Evidence `FileLedger` → "Reused from staged audit" notice (when applicable) → compile-result message → **`HybridGatePanel`** (the per-verdict approval queue) → the `LineageDiagram` "Requirement coverage — evidence" matrix → **`OutcomeReviewPanel`** ("Also assess Outcomes & Review →") → `FeedbackModal`.

#### 3. Key functions
- **⬇ CSV / ⬇ PDF** (Official requirements tab) — call the export function directly, immediately, no picker at all.
- **Run/Re-run PPD review** / **Cancel** — `runPPDReview(id)` / `cancelBusy()`.
- **"Overall PPD assessment" expand/collapse**, **"Run: [select]" history picker** (read-only viewer of a past run).
- Per-line (both PPD and Evidence tabs): "Show/Hide the AI's written comment" toggle; `ThumbsButtons` — Accept logs acceptance, Reject opens `FeedbackModal` which on submit logs the override and adds a calibration memory.
- **"Continue to Evidence →"** (Pre-check tab) — switches tab, never triggers an AI run.
- **Run/Re-run evidence assessment** / **retry N failed lines** / **"Compile findings → (N)"** (disabled until the hybrid gate is clear) / **"Findings register →"** link.
- **HybridGatePanel**: "Accept all remaining" (confirm-gated) / "Discard run" (confirm-gated) / per-item verdict select + Accept/Accept-as-X / Reject. It processes gates **one at a time** even though its header shows the full pending count "(N)" — intentional, but could read as a mismatch to a first-time user.
- **OutcomeReviewPanel**: "Also assess Outcomes & Review →" / "Re-run Outcomes & Review pass" / Cancel / per-row thumbs / **"Apply to checklist →"** — writes **only** the Systems & Outcomes and Review APSR legs onto matched checklist lines; never touches verdicts or the band.
- **`LineageDiagram` matrix controls** (shared identically by PPD and Evidence tabs — this is the same component documented under Export Centre-adjacent pages):
  - Header click expands/collapses the whole matrix.
  - **⬇ CSV / ⬇ PDF** — call the export **immediately**, one click, using whatever the Options panel currently holds. Confirmed one-click in code: a comment explicitly documents the historical bug ("They used to only open the picker... reported as 'the buttons are not working'").
  - **⚙ Options ▼/▲** — a settings panel that does **not** gate the export buttons (a code comment states this explicitly: "NOT a gate"). Inside: a Compact(3 columns)/Full-detail view toggle, tickable columns (Full detail only), a "clause-by-clause detail" checkbox, and a live preview table computed from the exact same row-assembly function the real export uses.
  - Per-row click expands a clause-by-clause detail table plus the tab-specific comment/thumbs.
  - "Show more/less" toggles on long-text cells; "+N more files" toggle in the file-list cell.

#### 4. Connections to other pages
`ResultNavLinks` → `/sub-checklist?item=<firstItemId>` and `/findings?subCrit=<id>`; Evidence tab's own link → `/findings?item=<id>`; per-line "View →" → `/findings?item=<gd4ItemId>`; saved-state banner → `/scorecard`; auditor-gate banner → Auditor Creation; Drive-blocked banner → Drive Connect. **`?review=<subCriterionId>`** deep link opens this modal directly (used by the Manual-mode banner on Sub-Criterion Checklist). **`?run=<runId>`** deep link resolves Option A run ids (`EV-<subCriterionId>-<base36>`) to this modal, or Option B run ids (`AR-<subCriterionId>-<4-char base36>`) to `AuditRunModal`. The overflow menu's "📋 Official requirements" item opens this modal directly on the requirements tab.

#### 5. Known confusing/awkward bits
- **"Official requirements" tab vs. the "Requirement coverage" matrix genuinely look alike and mean opposites.** Both are tables of GD4 requirement lines with monospace refs, similarly grouped/ordered. Official requirements is pre-audit static text (3 columns, no verdicts, "not yet assessed," reads zero run state); the coverage matrix (same `LineageDiagram` component, inside the PPD/Evidence tabs) is post-audit assessed verdicts (coverage dots, verdict pills, citations, expandable clause detail). The amber disclaimer and the "Requirement coverage" header text are the *only* differentiators today — nothing about layout signals "static reference" vs. "assessed result" at a glance. This is exactly the kind of thing worth making structurally distinct in a redesign, while preserving that `OfficialRequirements` architecturally reads zero run state — that separation must not be broken.
- Confirmed the ⬇ CSV/⬇ PDF export buttons in the matrix are genuinely one-click today (not gated behind Options) — but the Official-requirements tab's own ⬇ CSV/⬇ PDF pair has **no** Options/Compact/columns system behind it at all, despite looking visually identical (same icon/label/colour) to the matrix version's much richer export. Three different "3-ish column" CSV shapes exist across this one modal (Official-requirements static export, Lineage Compact preset, Lineage Full-detail-with-some-columns-unchecked) — worth naming/distinguishing more clearly if export UI is unified.
- The active Compact/Full-detail choice is **sticky but invisible once the Options panel is closed** — the ⬇ buttons carry no indicator of which mode is currently active, so a user who set Compact once and closed the panel gets a silently-compact export later with no reminder.
- The `HybridGatePanel` also contains a **legacy-drain-only explanatory box** that only appears for old Option-A pending runs — dead-code-adjacent UI for a deprecated flow, worth flagging as possibly safe to drop entirely once no legacy runs remain (currently still live).
- The tab bar's Evidence "⏸ N" badge and the `HybridGatePanel` header count are the same number rendered in two places with different styling.
- The auditor-gate and Drive-connect blocking banners are near-identical, literally copy-pasted blocks between the PPD tab and the Evidence tab rather than a shared subcomponent — a maintainability note more than a visual one, but a redesign touching either should touch both.

---

### Modal: Vision-budget prompt (`VisionBudgetPromptModal`, `src/components/ui/VisionBudgetPromptModal.tsx`)

Mounted **once, globally**, in `src/components/layout/Layout.tsx:54` — deliberately not scoped to any one page, because a prior bug had it scoped to the PPD Review page only, causing 6-hour hangs when a Hybrid/Full-auto run was launched from Evidence Folder instead.

**Triggered by**: the store's vision-budget state being set during an Option A evidence-assessment read pass, when the run's vision-image budget (for scanned/image PDFs) is exhausted; it blocks that pass until answered.

**Shows**: which sub-criterion, how many images were read before the cap, the blocked file names, and the estimated extra image count/cost if the user proceeds.

**Buttons**: **"Skip the rest"** → leaves those files unread; **"Proceed with all →"** → raises the budget and re-reads the blocked files. No backdrop-dismiss and no default choice — the run pauses until answered. Because it's mounted at the `Layout` level (z-index 9999), it can appear over *any* page overlay including Evidence Folder's own run overlays (z-index 100-120).

---

## Sub-Criterion Checklist (`src/pages/SubCriterionChecklist.tsx`, route `/sub-checklist`)

### 1. Purpose
Nav hint: "Source of truth for scoring — break each item into testable lines and attach evidence." The per-GD4-item workspace: pick an item (e.g. `1.1.1`), break it into testable checklist lines, verdict each line, attach evidence per line, then roll everything up into an official EduTrust APSR percentage-matrix band. Confirmed live via screenshot — the item picker, quadrant chart, APSR matrix and line-management toolbar all render exactly as described below. This is the single largest and densest page in the app (~1660 lines).

### 2. Structure
`DeepLinkBackBar` → `NextStepBanner` → a two-column grid (item picker + main content) when the picker is open, else single-column.

**Left column — item picker** (collapsible): header ("23 sub-criteria · N items" + Hide button) → Criterion filter → per criterion, a grey label row then "parent groups" with clickable child-item buttons showing id + requirement text + a Gate pill if applicable + a band pill / needs-reassessment glyph / dash.

**Right column, stacked cards**:
1. Re-assessment banner (conditional) — jump buttons to every item needing re-assessment.
2. "Line completion vs band status" card — a 2×2 quadrant chart plotting every item with ≥1 line by completion% and band≥3, each quadrant listing clickable item-id chips.
3. **Main item card** (the dense one): cross-link row (conditional "← Rubric Banding" only if `?from=rubric-banding`, "← Evidence Folder", "Findings for {id} →", "Quality Action / AFI →", "Final Report for {id} →") → item header + requirement text + optional Gate pill → sub-criterion title/description → conditional banners (partial-audit-scope warning, manual-mode empty-state, "Expected evidence" box) → band status block (three mutually exclusive states) → pending-run warning → **APSR band section**: heading + "AI first pass" button, explanatory paragraph with live completeness counts, conditional AI-suggestion review card, the APSR matrix selector grid, required justification textarea, "Save band" button, conditional band-improvement panel → **line-management toolbar**: "AI first pass" (line generation), manual "+ Add line", "Remove all" → pending-generated-lines review box (while AI-generated lines await confirm) → **the checklist-lines list**, each line a 3-row card (row 1: expand caret + ref + text + dimension pill; row 2: verdict select, dimension override select, AI thumbs, Evidence toggle, finding link, remove; row 3: conditional stale-warning; expanded panel: PPD/Evidence tabs, evidence table, "Add evidence" row, sampling register row).
4. `EvidenceGapPanel` card — 4-column APSR dimension gap tally + a "Likely: {finding type}" callout.
5. "Band result" card — 3 metric tiles, justification echo, advisories, pending-run warning, evidence-audit-gap box.
6. Two `FeedbackModal` instances (line-verdict feedback, band-suggestion feedback), invisible unless triggered.

### 3. Key functions
- **Item picker buttons / quadrant chips** — `selectItem(id)`.
- **"Clear/re-assess" band button** — `confirm()` then `clearHolisticBand(id)`.
- **"AI first pass (suggest scores)"** — `suggestBand(id)`, populates the APSR matrix per dimension.
- **"× Remove AI scores"** — only exists in the unsaved state; once saved, the only undo is the destructive "Clear/re-assess" on the whole band (which also wipes the rationale and reverts to "not started" — **no partial-undo path**).
- Thumbs on the AI band suggestion — Accept logs; Reject opens `FeedbackModal`.
- **"Accept AI scores & save"** — saves with `source:"ai-accepted"` and auto-classifies untagged lines by content.
- APSR matrix cells — `setApsrMatrix(id, dim, score)`.
- **"Save band"** — disabled unless the matrix is complete.
- **"AI first pass" (line generation)** — `generateSpecific(id)`; **auto-confirms in hybrid/full-auto mode, but stops for human review in manual mode** — this mode-dependence is only explained in a code comment, not the UI.
- **"+ Add line"**, **"Remove all"** (confirm-gated).
- Pending-line review box: per-line text/clause edit, Remove, "+ Add"; **"Confirm into checklist"** / **"Discard."**
- **Per-line verdict `<select>`** — "the field that drives the band" (per code comment) — `setSpecificStatus`.
- **Per-line dimension override `<select>`** — display/grouping only, **never changes the band** (per code comment) — sits visually identical in weight to the verdict select right next to it.
- Per-line AI thumbs (AI-generated lines only).
- "Evidence (n)"/"Evidence: Missing" toggle, "View finding →", "Raise observation →"/"Draft finding →", "×" remove line.
- PPD/Evidence tab buttons inside the expanded panel — local display toggle only, both read the same frozen AI-run snapshot.
- Evidence table: checkboxes/selects (Approved/Reviewed/Sufficiency), per-row Reuse/Remove, an archived read-only note (AI-run evidence) vs. a live editable note (manually-added evidence) depending on invisible provenance.
- "Reuse in another item" mini-form — item/line selects + Copy/Cancel.
- "Add evidence" row — includes "AI fill from link" (auto-fills the draft, then diff-logs if the human edits the AI-filled fields before saving).
- Sampling register row — population/sample size/sample IDs + "Save sampling."
- Draft-finding/observation Save button — `confirmDraftFinding(...)`.

### 4. Connections to other pages
`?item=<gd4ItemId>` seeds the selected item and is stripped from the URL once consumed. `?from=rubric-banding` (handled directly by this page, **not** by the shared `DeepLinkBackBar`, deliberately per its own comment) shows a bespoke "← Rubric Banding" link back to `/rubric-banding?view=item&scrollTo=<id>`. Outbound: `/evidence-folder`, `/evidence-folder?run=<id>` (pending-run warnings, appears in at least 4 separate places on this page), `/evidence-folder?review=<id>` (manual-mode banner), `/findings?item=<id>`, `/afi-closure`/`/afi-closure?item=<id>`, `/final-report?item=<id>&from=sub-checklist`, `#/gd4-scoring-setup` ("Edit percentage scale →").

### 5. Known confusing/awkward bits — the highest-density page in the app
- **Two different "AI first pass" buttons doing unrelated things**, both labelled "AI first pass," both blue-bordered, roughly 130px apart vertically: one generates checklist lines, one suggests APSR band scores.
- **The line-generation "AI first pass" button silently forks behaviour by audit mode** — auto-confirms in hybrid/full-auto, stops for review in manual — with no UI signal of which will happen.
- **A cosmetic control sits visually identical in weight to a load-bearing one**: the per-line "Verdict" select drives the band; the adjacent "Dimension" select is display-only and "never changes the band" per the code's own comment — nothing in the rendered UI (only a hover tooltip) says so.
- **A legacy dual-verdict system is stacked on top of the current one**: the editable "Verdict — drives the band" select coexists with read-only "Policy verdict"/"Combined verdict" fields inside the expanded PPD/Evidence tabs, pulled from a *frozen* AI-run snapshot that can literally disagree with the current editable verdict (flagged in-app: "differs from the current verdict above (edited after this run)").
- **Reassessment/band-source warning language has accumulated three eras of terminology** from two separate historical rescoring migrations (ladder→holistic, holistic→matrix) that were never consolidated into one consistent banner.
- **The APSR matrix itself is a dense 6-column × 4-row table down to 7-9px font**, verbatim rubric text packed into small clickable cells — explicitly "deliberately compact" per code comment, and it's the page's single load-bearing scoring control despite being the hardest part of the page to read. It also permanently displays a "reconstructed formula, not confirmed" disclaimer directly above itself.
- Multiple independent "stale/pending" warning banners for the same underlying fact (a newer, unapproved evidence run) repeat at up to four separate places for one line.
- The manual-mode explanatory banner only shows while a line count is zero — vanishes forever once the first line is added, even though manual mode's behaviour hasn't changed.
- A raw-array display-dedup exists purely in the view layer (comment explains an audit-generated+verdicted line copy can coexist with a fresh "Not Started" regenerated copy) — band/scoring still reads the undeduped array; a data-quality issue papered over visually rather than fixed at the source.

---

## Sampling (`src/pages/Sampling.tsx`, route `/sampling`)

### 1. Purpose
Generate a risk-based sample of records (gate-sensitive or low-band items) and record a tested outcome (Pass/Partial/Fail) + notes per sample, for evidence testing.

### 2. Structure
Single card: header + "Generate sample from gate & weak items" button → subtitle → empty-state message → one table (Selected checkbox, Reference, GD4 item, Type, Risk reason, Tested outcome select+pill, Notes text input).

### 3. Key functions
- **"Generate sample from gate & weak items"** — filters items to `band < 3 || gate` (**hard-capped at 12**, with no UI indication of the cap or how many risky items were excluded); if samples already exist, `confirm()`-warns that regenerating **replaces the whole array**, discarding any recorded outcomes/notes.
- **Selected checkbox** — `toggleSample(id)`.
- **Tested outcome select** — `setSampleOutcome(id, outcome, notes)`, colour-coded pill.
- **Notes input** — same action, updates notes only.

### 4. Connections to other pages
None — no `<Link>`/`navigate`/`useNavigate` anywhere in the file (confirmed by grep).

### 5. Known confusing/awkward bits
The page gives no indication of where its output is consumed downstream — no link back to Evidence Folder/Checklist or forward to Findings/Scorecard, so a cold-landing user has no on-page context. The 12-sample cap is invisible. Regenerating silently discards recorded work behind an easily-dismissed `confirm()`.

---

## Interview (`src/pages/Interview.tsx`, route `/interview`)

### 1. Purpose
Auto-generate likely auditor interview questions for items with weak evidence dimensions, then let the user rate staff readiness and record practice-interview notes.

### 2. Structure
Single card: header + "Generate likely auditor questions" button → subtitle → empty-state message → list of question blocks (GD4 item id, question text, readiness select+pill, "Expected:" answer line, notes input).

### 3. Key functions
- **"Generate likely auditor questions"** — filters items with any weak dimension, picks the worst dimension per item, builds a question from a fixed template bank; same confirm-before-overwrite pattern as Sampling — regenerating **replaces all recorded readiness ratings/notes**.
- **Readiness select** — `setQuestionReadiness(id, readiness, notes)`.
- **Notes input** — same action, notes only.

### 4. Connections to other pages
None.

### 5. Known confusing/awkward bits
Same missing-context issue as Sampling — nothing on-page explains this is an optional tools page tied to Step 2, no forward/back links. Regenerating silently discards recorded work. "Expected answer" text is a static hard-coded template, not personalised or AI-generated, though nothing on the page claims otherwise — worth being explicit about in any redesign copy.

---

## Evidence Intelligence (`src/pages/EvidenceIntelligence.tsx`, route `/evidence-intelligence`)

### 1. Purpose
Nav hint: "...computed from your data — deterministic, no AI call." A read-only evidence-quality dashboard: 12 per-item checks rolled up at three levels (Overall / By criterion / By item).

### 2. Structure
View-switcher card (3 toggle buttons: Overall / By criterion / By item) → **Overall view**: 5-tile stat card + a rollup table of all 12 checks aggregated across all items → **By-criterion view**: criterion select + scoped rollup table + item-id buttons (with Band pills) that jump to item view → **By-item view**: item select + Band pill + a row of per-agent "run AI" buttons + an optional AI-verdict summary box + a table of the 12 individual checks with status pill + detail text.

### 3. Key functions
- View toggle / criterion select / item select — all local state, no store writes.
- Item-id buttons in criterion view — jump to item view (in-page state change, not a route change).
- **Per-agent "run AI" buttons (By-item view)** — **this is the one control on the page that genuinely calls AI**, via `runItemAI(agentId, itemId)`, storing the verdict in `itemReviews`.

### 4. Connections to other pages
None — no `<Link>`/`navigate`/`useNavigate` anywhere (confirmed by grep).

### 5. Known confusing/awkward bits
- **A real discrepancy between framing and UI**: the page's nav hint and subtitle both insist "no AI call," and that is true of the 12 deterministic checks (`computeChecks`, a pure function) — but the same "By item" view also surfaces live "run AI" buttons that trigger a real/simulated AI call, visually part of the same page. A user could reasonably read the whole page as AI-powered despite the copy. Worth explicitly separating the AI buttons from the deterministic section in a redesign, or qualifying the "no AI call" claim.
- No on-page link back to the data-source pages (Evidence Folder, Sub-Criterion Checklist) or forward to Findings for a "Fail" result.
- Criterion/item selections are local `useState` only — not persisted or URL-addressable, so no deep link to a specific item's checks is possible.

---

# 3 · Findings & review

## Findings (`src/pages/Findings.tsx`, route `/findings`)

### 1. Purpose
Nav hint: "Raise and track AFIs / quality actions." Register where audit gaps are raised, generated, grouped, filtered and inspected. Confirmed live via screenshot.

### 2. Structure
`DeepLinkBackBar` (conditional) → `NextStepBanner` → cross-module nav row (link to Checklist, conditional "← Back to {item}", right-aligned "Quality Action / AFI →") → **90-day remediation roadmap card** (conditional, only with open findings) — 3 columns bucketing open findings by urgency → **"Grouped findings from checklist" card** — AI-drafted, sub-criterion-grouped drafts pending review, each expandable → **"Findings register" card** (the main card): header (open-count, conditional "Delete all findings", "Generate from gaps", "Raise finding" toggle) → "By dimension" pill-filter row → "By risk category" pill-filter row → manual "Raise finding" form (conditional) → 7-select filter row (Criterion/Sub-crit/Dimension/Risk cat/Type/Severity/date-range) → summary bar → **grouped findings list** (collapsible per-sub-criterion rows, each expanding to individual finding rows) → footer + "Manage closure →" link → **finding detail modal** (true overlay, 70vw×85vh) opened by clicking a row → `FeedbackModal`.

### 3. Key functions
- **7 filter selects** — no explicit sort control; sort is fixed (groups by sub-criterion id, findings newest-first within a group).
- **"By dimension"/"By risk category" pill rows** — a **second, redundant** way to set filters already present in the dropdowns; no visual link connects a clicked pill to the corresponding dropdown's now-changed value.
- **"Generate from gaps"** — `raiseAllUnmetFindings()`; turns every Not-met/unverified checklist line into a deduped finding. Also runs automatically after each folder audit.
- **"Generate grouped findings"/"Regenerate drafts"** — `generateGroupedFindings()`; consolidates failing lines sharing the same GD4 source-ref + APSR dimension into one AI draft (with root cause/corrective/preventive). "Remove all" discards all pending drafts (confirm-gated).
- **"Compile findings from the last PPD + Evidence run"** — appears **only** inside the empty-state message when a sub-criterion filter is active with an existing assessment; the code comment itself calls this a deliberate duplicate of the review modal's own Compile action, placed here so deep-linked users don't have to leave the page.
- **"Raise finding" toggle** — opens/closes the manual form.
- **"Delete all findings"** (header) vs **per-sub-criterion "Delete all"** — same label, different scope, both confirm-gated with scope-specific dialog text.
- **Per-finding delete** — ✕ → inline Delete/Cancel confirm.
- **Detail modal**: Major/Minor NC severity override buttons (NC types only); "Re-check this finding →" (re-reads the evidence folder, re-assesses only this finding's line, never auto-closes); "Manage closure →"/"View checklist →" links.
- **Grouped draft detail**: editable title/observation/criteria/effect/root-cause/corrective/preventive fields, "Confirm → add to register", "Discard draft," per-draft thumbs shown even before expanding.

### 4. Connections to other pages
`?item=<gd4ItemId>` pre-selects the sub-criterion filter (sources: Sub-Criterion Checklist, PPD Review, Run Log via `?subCrit=`). `?subCrit=<id>` directly pre-selects. `?from=<key>` drives `DeepLinkBackBar` (values: `final-report`, `sub-checklist`, `findings`, `afi-closure`, `clarification`). Outbound: `/afi-closure` (plain and `?item=`), `/sub-checklist?item=`, `/evidence-folder?run=<id>` (detail-modal run link).

### 5. Known confusing/awkward bits
- **Two separate "generate findings" pipelines that look similar and produce different structures**: "Generate from gaps" (gold-styled, ungrouped, one finding per line) vs. "Generate grouped findings" (indigo-styled, AI-consolidated multi-line drafts requiring an explicit confirm step) — easy to use the wrong one without realising the structural difference.
- **Duplicate filter mechanisms**: dimension/risk-category set both via dropdown and via clickable pills, with no visual link between the two.
- **"Compile findings from the last PPD + Evidence run" only appears buried inside an empty-state message** for a scoped filter — the code comment itself acknowledges the primary version of this action lives elsewhere.
- **The finding-row click target overloads three behaviours**: click toggles expand/collapse, a second click on the same row collapses it again, and a ✕ delete icon shares the row (protected by `stopPropagation` but visually cramped).
- "Delete all findings" (global) vs. per-sub-criterion "Delete all" — same label at two scopes.
- Dimension-filter labels are inconsistent between the pill row (e.g. "Procedure (policy)") and the plain dropdown ("Procedure") for the exact same underlying filter value.

---

## Clarification round (`src/pages/Clarification.tsx`, route `/clarification`)

### 1. Purpose
Batch re-check open findings after new evidence has been added to Drive, tracked as numbered "rounds." Explicitly human-gated: a resolved finding is **never** auto-closed here — closure happens on AFI Closure. Confirmed live via screenshot.

### 2. Structure
`DeepLinkBackBar` → **"Clarification round" card**: intro paragraph, an action-button row (3 buttons + conditional "Clear selection"), a `ControlLegend` explaining the two main buttons, a running-progress banner, a result-message banner → **"Open findings" card**: header + count + (if deep-linked) "Show all open findings" reset; findings grouped by sub-criterion, each a checkbox row (id, clause/item id, drift badge, issue text, "Open Evidence folder ↗" link or "No folder linked") → **"Round history" card**: collapsible per-round `<details>` showing resolved/still-open counts, per-finding before→after verdict pills, blockers/skipped lists.

### 3. Key functions — the two similarly-worded buttons is the area worth flagging carefully
- **Selection**: per-finding checkbox, row-label click also toggles; **"Select all changed (N)"** auto-ticks findings whose evidence-drift is "changed"; **"Clear selection"** appears once ≥1 is selected.
- **"Re-check selected (Round N) — {count}"** — `runClarificationRound(selected)` — this is the button that **spends AI** and re-assesses the ticked findings' evidence. Disabled while nothing is selected or busy.
- **"Check for updated evidence"** — `checkDrift()` — does **not** re-check any finding and does **not** use AI; only re-lists each open finding's Drive folder and compares file lists, setting "Evidence changed"/"no change" badges. Purely advisory, never gates which findings can be ticked.
- These two sit side by side, similarly sized; only "Re-check selected" is gold-filled — the other two ("Check for updated evidence," "Select all changed") are both plain white-with-border, visually reading as a matched pair despite only one of the three spending AI. The app already ships a `ControlLegend` directly under them spelling out the distinction in plain words — evidence the developers already anticipated this confusion.
- **Drift badge** — "Evidence changed" pill / "no change" / nothing (unknown/error, still selectable).
- **Round history** — read-only, expand/collapse only.

### 4. Connections to other pages
`?item=<gd4ItemId>` narrows the list and highlights the matching row — the **only known caller of this deep link in the codebase** is Final Report (`/clarification?item=...&from=final-report`). "Show all open findings" clears it. Outbound: "Open Evidence folder ↗" opens the linked Drive folder in a **new tab, external, not in-app** — this app is explicitly read-only against Drive, no in-app upload exists. No direct link to `/findings` or `/afi-closure` from this page — closure of a resolved finding requires separately navigating to AFI Closure.

### 5. Known confusing/awkward bits
- The two-button confusion is real, mitigated only by the `ControlLegend` text, which a user could easily skip.
- **"Select all changed" depends on having already run "Check for updated evidence" first** (drift badges are empty until then) — the drift-check → select-all-changed → re-check sequencing is not visually indicated as a numbered flow; clicking "Select all changed" first silently selects nothing.
- No on-page mapping between the badge states (Met/Partial/Not met pill colours) and what "resolved" precisely means — that mapping only lives in the Round History detail.
- Seed/demo findings are silently excluded from this page (backed only by `customFindings`) with no on-page explanation of why counts might not match the Findings register total.

---

## Quality Action / AFI (`src/pages/AFIClosure.tsx`, route `/afi-closure`)

### 1. Purpose
Where a reviewer decides whether a finding can be closed (root cause → corrective/preventive actions → closure) and then separately confirms the closure's effectiveness after the fact — an ISO 9001 10.2-style PDCA closure workflow (explicitly named as such in code comments). Confirmed live via screenshot.

### 2. Structure
`DeepLinkBackBar` → nav row ("← Findings register", "← Sub-Criterion Checklist") → header (title, open-count, conditional "Clear closures") → filter row (Criterion/Sub-criterion/date-range) → demo-data note (conditional) → **list of findings**, each a collapsible card:
- Collapsed header: id, type pill, GD4 item id, issue text, created date, NC-severity pill, Overdue pill (conditional), closed/AI-verdict pill.
- Expanded body: nav links ("← View in Findings," "← Checklist") → **Owner + Target close date** (directly editable inline — the one place these can be seen/edited post-creation) → `PanelReviewSection` → PDCA fields in order: Root cause → Immediate correction (containment) → a visually emphasised **"▶ Act — this closes the loop"** box (border/background flips amber→green once Corrective action has text; code comment calls this "the stage schools most often skip past") containing Corrective + Preventive action → Closure evidence → "Evidence satisfies:" ISO 9001 / EduTrust toggle pills → action row (Suggest actions (AI), AI closure review, conditional override-reason input, Accept closure/Closed ✓, Remove finding with inline confirm) → **post-closure block** (shown only once accepted): "Closed by X on date," then either an effectiveness-confirmed line or a pending-review input + "Confirm effective" button → AI verdict panel with 👍/👎.

No numbered steps, wizard, or progress indicator connects the fields — they're a stacked list; the "Act" box is the only one given colour treatment, and effectiveness confirmation is the only step gated behind a separate top-level condition (must already be accepted).

### 3. Key functions
- **Owner / Target close date** — directly editable via `updateCustomFinding`, visible only when expanded.
- **"Act" box** — Corrective action + Preventive action textareas.
- **"Suggest actions (AI)"** — drafts root/corrective/preventive; won't overwrite already-filled fields.
- **"AI closure review"** — produces an Acceptable/Partial/Maintain Finding/Escalate verdict.
- **"Accept closure"** — the actual close action; **gated**: disabled with a tooltip listing what's missing (root cause, corrective action, evidence link all required) and — if the AI verdict was "Maintain Finding"/"Escalate" — requires a typed override reason. Becomes "Closed ✓" once accepted and **toggles back open with no confirmation if clicked again.**
- **"Confirm effective"** — a distinct, later gate; disabled until the note is non-empty. Closing a finding does **not** by itself mark it effective.
- **"Remove finding"** — inline confirm.

### 4. Connections to other pages
`?item=<gd4ItemId>` pre-filters and scrolls/expands the matching finding (sources: Sub-Criterion Checklist "Manage closure →", Findings' "Quality Action / AFI →" and "Manage closure →"). Outbound: `/findings` (plain), `/sub-checklist`, per-finding "← View in Findings" (`?item=...&from=afi-closure`) and "← Checklist" (`?item=...&from=afi-closure`) — these carry `from=afi-closure` so the destination's `DeepLinkBackBar` can link back here. Deleting a finding here also removes it from Findings (shared data); "Clear closures" only clears closure decisions, not findings themselves.

### 5. Known confusing/awkward bits
- **The closure gate is text-only, not shown on the fields themselves** — the disabled "Accept closure" tooltip lists missing fields, but the actual textareas have no red border/asterisk/required-field indicator; a user must hover/click Accept to discover what's missing.
- **Two similarly-worded, similarly-styled AI buttons side by side** doing conceptually different things: "Suggest actions (AI)" fills fields, "AI closure review" judges the filled fields.
- The override-reason input only appears conditionally, inserted inline between the two AI buttons and Accept, rather than visually tied to the AI-verdict panel below it — easy to miss.
- **"Accept closure" and "Closed ✓" are the same toggle button** — clicking it again reopens the finding with **no confirmation**, unlike delete.
- Effectiveness confirmation shows a due date only as a plain text label — no reminder/highlight distinguishing an overdue effectiveness review from a fresh one, unlike the finding's own Overdue pill which does get a distinct red treatment.
- The "Act" box's amber→green border is the only per-step visual progress cue on the whole page — every other field looks identical whether empty or filled.

---

## AI Review Log (`src/pages/AIReview.tsx`, route `/ai-review`) — developer tool

### 1. Purpose
The full log of every AI agent invocation across the app — scoring, line generation, finding drafting, closure review, cross-criterion analysis, etc. Each entry records agent, module, verdict/output, prompt sent, token usage and cost. Gated behind the Settings "Show developer tools" toggle (see cross-cutting note at the end of this section).

### 2. Structure
Header ("AI agent review log" + "Clear log") → explanatory paragraph → summary pills (total/live/simulated/failed-fell-back runs) → "By agent" breakdown → **Period** date-range bar (Today/7d/30d/All) → token & cost estimate panel → "Which model runs what?" static legend → empty state → filter/sort bar (Agent, Module, free-text search, Sort, Clear, count) → main table (Agent | Module | Subject | Summary verdict pill | Model | Tokens | When), each row expanding inline into Output/Prompt-Sent tabs plus, if linked, an inline File Ledger → `FeedbackModal` → pagination (50/page).

### 3. Key functions
- **Clear log** — `confirm()`-gated.
- Agent/Module filters, free-text search, Sort (Newest/Oldest/Most tokens), Clear filters.
- Date-scope presets driving the cost calculator and the visible rows together.
- **Row expand/collapse** — Output/Prompt Sent sub-tabs, inline File Ledger reveal.
- **👍 "Mark AI output as correct"** — logs directly. **👎 "Mark AI output as incorrect"** — opens `FeedbackModal`; on submit adds a calibration memory (if applicable) and logs an "Overridden" decision — **this is the direct bridge from AI Review Log into the Human Decision Log / calibration library.**
- Pagination (50/page). No CSV/JSON export on this page (unlike Run Log).

### 4. Connections to other pages
Each row shows a `runId` with a tooltip explaining it matches the Evidence Folder result / checklist evidence / journal entry from that run — but it is **plain text, not a clickable link**. 👍/👎 feedback writes into the Human Decision Log and Calibration Library stores (data linkage, not a UI link). No `?run=` support on this page — it's the leaf log other pages link into (Run Log links here).

### 5. Known confusing/awkward bits
A code comment notes a past "View file ledger" deep-link was deliberately removed as redundant — evidence of past redesign churn. The `runId`'s cross-page meaning is promised by a tooltip but not actually clickable. **Purpose distinctness**: this page's filterable/expandable table is nearly identical in shape to Human Decision Log's Decision Log tab and to Run Log's row list — nothing in title/icon/colour distinguishes "what the AI did" from "what a human decided" or "what an automated run did" before a row is expanded and read.

---

## AI Debug Log (`src/pages/AIDebugLog.tsx`, route `/ai-debug`) — developer tool

### 1. Purpose
A raw, **in-memory, non-persistent** log of every low-level `buildSystemPrompt()` call — the actual system-prompt text assembled for any AI call. Explicitly "(dev only). Clears on page reload."

### 2. Structure
Header (title + description + "Clear log") → empty state → entry count line → a list of native `<details>`/`<summary>` accordion entries (**not a table**), each summary showing timestamp, `functionName`, module badge, criterion-skill badge, and a truncated preview → expanded body shows the full system-prompt text.

### 3. Key functions
- **Clear log** — from a **separate, dedicated store** (`useAIDebugLogStore`), not the main workspace store — this data is not persisted or exported anywhere else.
- Expand/collapse — native `<details>`, no React state.
- **No filters, no search, no sort, no pagination, no export.** By far the simplest of the four log pages.

### 4. Connections to other pages
None — no links out, no runId correlation, no deep links in or out. The only one of the four fully self-contained.

### 5. Known confusing/awkward bits
Visually it's the most distinguishable of the four log pages once loaded (accordion, not a data-grid) — but by **name** alone, "AI Debug Log" vs. "AI Review Log" is a very easy mix-up. Its description leans on the internal function name `buildSystemPrompt()`, which means nothing to a non-developer. No indication in the page itself that the data is ephemeral beyond one description line. No search/filter at all, unlike the other three.

---

## Human Decision Log (`src/pages/HumanDecisionLog.tsx`, route `/human-decision-log`) — developer tool

### 1. Purpose
Audit trail of every human override or acceptance of an AI output, plus a second tab managing the "Calibration Library" — the auto-generated few-shot examples fed back into AI prompts when a human corrects the AI.

### 2. Structure
Header ("Human Decision Log" + Clear log) → description → **two tabs**: "Decision Log" (with count badge) and "Calibration Library" (with included/total badge).

**Decision Log tab**: summary cards (Total/Accepted/Edited/Overridden) → filter bar (Module — 12 options incl. "AI Review Log Feedback"; Decision-type; From/To date; Clear) → grid-based table (Timestamp | Module | AI Output | Human Decision | Changed? | Decision pill | Memory? 🧠 icon) → row expand → AI Output/Human Decision detail boxes → metadata grid including **"Linked AI Run" = `entry.aiRunId`** → reason-for-override box or "⚠ No reason recorded" → footer note ("Capped at 500 entries").

**Calibration Library tab**: summary cards (Total/Included/Used/Excluded) → explanation box → module filter → grid table (Date | Module | AI Output | Human Correction | Reason | Field | Used | **Include in prompts** toggle) → footer note ("Capped at 200 examples").

### 3. Key functions
- **Clear log** (Decision Log data only) — confirm-gated.
- Module/decision-type/date filters, local to `DecisionLogTab`.
- **"Included ✓"/"Excluded" toggle** per calibration example — `toggleIncluded(id)` — this is the one write action on the whole page besides Clear log; only examples toggled Include are injected into prompts.
- No sort, no pagination (relies on the 500/200 caps), no export.

### 4. Connections to other pages
**"Linked AI Run" (`aiRunId`) is shown as plain monospace text — not a clickable link** to the AI Review Log entry it references (same gap as AI Review Log's own `runId`). The 12 module values conceptually map to other pages (AFI Closure, Findings, Checklist, Final Report) but nothing here links to them — filtering only. Calibration examples created here feed the prompt text visible in AI Debug Log — an indirect pipeline (Human Decision Log → Calibration Library → prompt text → AI Debug Log), not a UI link.

### 5. Known confusing/awkward bits
**Purpose distinctness**: the Decision Log tab is structurally near-identical to AI Review Log's table — the key semantic difference (this logs a *human's* action, not the AI run itself) is only conveyed via column headers and pill labels, easy to conflate at a glance. Two tabs bundled onto one route is a different content model from the other three single-purpose log pages. The "AI Review Log Feedback" module (populated by AI Review Log's own 👍/👎 buttons) is a non-obvious coupling between two of the four pages, undocumented on-screen in either.

---

## Run Log (`src/pages/RunLog.tsx`, route `/run-log`) — developer tool

### 1. Purpose
Records what an automated multi-step *run* (Full Auto sweep, or Hybrid per-item hands-off draft) actually did — steps taken/skipped and why, bands auto-set. Explicitly scoped in-app copy: "A record of what happened, never an input to scoring. For individual AI-call prompts/outputs, see the AI Review Log."

### 2. Structure
Header (title + description + export/delete button cluster: Export CSV, Export JSON, Export full AI log, Delete all) → summary stat cards (Total runs, Full Auto sweeps, Hybrid runs, Bands auto-scored) → filter bar (Mode, From/To date, Clear, count) → grid-based table (Started+duration | Mode pill | Status pill | Summary | Items count + per-row ✕) → row expand: "Sub-criteria covered" (with **Findings** and, for Option A, **Evidence** deep-links) → "Steps" (hybrid runs only, done/skipped with real reason) → "Band auto-scoring" (bands set, with **Checklist** + **Final Report** links, and bands skipped with reason) → `RunAiCalls` (reads live from the AI Review Log, correlated by time-window + sub-criterion id — **not a shared runId**, an explicitly heuristic link per its own code comments — each call expandable, plus a real link to `/ai-review`) → footer note ("Capped at 50 runs").

### 3. Key functions
- **Export CSV / Export JSON / Export full AI log** — the last is the one true cross-log export, joining Run Log + AI Review Log data into a single downloadable file.
- **Delete all** — confirm-gated, explicitly does not touch AI Review Log/findings/scoring data.
- **Per-row delete (✕)** — confirm-gated, `stopPropagation`'d so it doesn't also expand the row.
- Mode filter, date range, Clear filters, row expand/collapse.

### 4. Connections to other pages
By far the **most connected** of the four log pages — real clickable links to `/findings?subCrit=<id>`, `/evidence-folder`, `/sub-checklist?item=<id>`, `/final-report`, and `/ai-review`.

### 5. Known confusing/awkward bits
The collapsed row (Started/Mode/Status/Summary/Items) still looks like "yet another log table" alongside the other three until expanded, where the distinguishing Steps/Band-auto-scoring sections and real cross-page links appear. It has export buttons none of the other three log pages have — an inconsistency worth normalising or deliberately preserving. Per-row delete (✕) sits in the same column as the item count, inline with the row-expand click target.

### Cross-cutting note on the four log pages
All four are gated behind the same **Settings → "Show developer tools"** toggle (`DEVELOPER_TOOL_PATHS` in `nav.ts`, wrapped by `DevToolsRoute` in `App.tsx`). With the toggle off, a user hitting any of these four URLs directly is **silently redirected to the Dashboard** with no error message, and the sidebar removes the entries entirely (not just route-blocked). The toggle **defaults ON**, so out of the box all four are visible. None of the four use a distinct icon or colour accent to signal their category (AI-generated vs. human-decision vs. run-orchestration vs. raw-debug) — differentiation today is 100% textual. Cross-references (`runId`, `aiRunId`) exist as real data in two of the four (AI Review Log, Human Decision Log) but render as plain text, not clickable links — a genuine, consistent functional gap (Run Log, by contrast, does link out) worth flagging as a natural "make it obviously navigable" redesign target that requires no store changes.

---

# 4 · Close out

## Criterion Scorecard (`src/pages/CriterionScorecard.tsx`, route `/scorecard`)

### 1. Purpose
"Official band per item, criterion and overall" — closeout step 1. AI proposes a band, a reviewer can override with a numeric score, then a score must be explicitly confirmed. Confirming a large AI/reviewer gap, or upgrading a gate item, requires a typed justification. Confirmed live via screenshot.

### 2. Structure
`CloseoutStepper` → conditional "Re-check candidates" card (only if closed findings exist or items sit below Band 3) — "Closed findings — item should be re-scored" (each with a "Reopen for re-score" button) and "Items still below Band 3" (plain table) → main "Criterion scorecard — three score types" card: explanatory paragraph → provenance strip → blue "via Checklist" info banner → main item table (Item | AI | Reviewer | Confirmed | Band | confirm action, each row also carrying gate/ai-auto/via-checklist pills and an audited-date stamp) → criterion summary tiles grid → `FeedbackModal`.

### 3. Key functions
- 👍/👎 on each row's AI column — same accept/log-override pattern as elsewhere.
- Reviewer-score numeric input (0-100) + a "Reset override" button once set, resetting reviewer score + justification back to the AI value.
- "Justify…" input — shown only when justification is required and the item isn't yet confirmed.
- **"Confirm"/"Confirmed"/"Justify to confirm"** — blocked from confirming until justification text is present when required; **reuses the same `confirmScore` action as the "Reopen for re-score" button in the re-check panel above.**

### 4. Connections to other pages
Link to `/sub-checklist` (no `?item=`, generic) from the "via Checklist" banner. Reached via `CloseoutStepper` from the other three closeout pages.

### 5. Known confusing/awkward bits
Three numeric columns (AI/Reviewer/Confirmed) plus a separate derived Band column can be hard to parse at a glance. The "Re-check candidates" card duplicates the main table's confirm/reopen mechanic under different framing — its own code comment says it was "relocated from the retired Re-audit and Re-score page" — a new developer may not realise "Reopen for re-score" and "Confirm" are literally the same store action. Items marked "via Checklist" still show editable AI/Reviewer/Confirm columns "for the record" even though they don't affect the actual band — visually indistinguishable at a glance other than a small pill.

---

## Final Report (`src/pages/FinalReport.tsx`, route `/final-report`)

### 1. Purpose
"Overall + per-item banding, strengths, AFIs and how to reach a higher band" — closeout step 2, the full narrative/print-ready report. Confirmed live via screenshot — hero score card, visual summary charts, and per-item findings tables all render as described.

### 2. Structure
`DeepLinkBackBar` (only if `?from=`) → `CloseoutStepper` → in-page jump nav ("Summary ↓"/"Banding by item ↓") → **hero card** (`#fr-summary`, dark background): cycle metadata, provenance line, `ThreePillarNote`, "Print / Save as PDF" (`window.print()`), "Generate AI summary" (disabled unless AI enabled+keyed), big score/award, gate-pass line, `AttainmentLadder` → conditional AI-error card → conditional "Executive summary (AI)" card (👍/👎, editable textarea + "Save edits," per-criterion narrative cards) → "Visual summary" card (Gauge, VBars, HBars ×2) → "Banding by criterion" card (header with confirm-gated "Delete all findings," By-Criterion/By-Sub-criterion tab toggle) → `#fr-items` "Banding by item" card: Criterion + cascading Sub-criterion filters → one `ItemBlock` per filtered item → `FeedbackModal`.

**`ItemBlock`** (one per GD4 item): collapses to a placeholder when unstarted/no checklist/no findings (a deliberate space-saving measure — the code comment notes "with 29 such placeholders the page was dominated by empty cards"). Full card otherwise: header (Band pill or "Needs re-assessment," "Already run by AI" pill, Gate pill, checklist-completeness summary, "Sub-Criterion Checklist →" link, "Regenerate report text" button) → findings/AFI table grouped by APSR dimension (each group: per-line rows, a lead-in explanatory row when dimension is "leg-derived," an AI-suggestion row with thumbs, an AI-narrative row with thumbs) → "Clarify / strengthen these findings →" link (if open findings exist) → collapsed "Findings: root cause, gap & closure" details → collapsed "Full band justification" details → per-item `FeedbackModal`.

### 3. Key functions
- **"Generate AI summary"** — one AI call producing the executive summary + per-criterion narratives.
- **"Print / Save as PDF"** — native `window.print()`; many elements carry a `no-print` class.
- Section-jump buttons, banding tab toggle, "Delete all findings" (confirm-gated), cascading Criterion/Sub-criterion filters.
- **`?item=` deep-link effect** — pre-sets filters, gold-highlights and smooth-scrolls to that item for 2.5 seconds.
- Per-item: "Regenerate report text" (narrative + suggestions together), individual thumbs on the AI-suggestion and AI-narrative rows, per-finding delete.

### 4. Connections to other pages
`?item=` focuses/scrolls/filters to one item. `DeepLinkBackBar` reads `?from=` (supports `final-report`, `sub-checklist`, `findings`, `afi-closure`, `clarification`). Each item card links to `/sub-checklist?item=<id>&from=final-report` and, if open findings exist, `/clarification?item=<id>&from=final-report` (the **only known source** of that particular deep link, confirmed from Clarification's own investigation). Is itself a link target from Evidence Folder's completion overlay and (indirectly, via consistency-check "Go to" links) from Finalisation.

### 5. Known confusing/awkward bits
- **Easily the densest page in the app** — one `ItemBlock` can stack up to ~6 pieces of AI-authored prose per dimension group (evidence cell, AI-suggestion row, AI-narrative row with 4 sub-fields, plus the collapsed band justification), distinguished from each other only by label text and light background tinting.
- Two different "regenerate" surfaces exist per item: the report-level "Generate AI summary" (whole report) vs. per-item "Regenerate report text" (narrative+suggestion) — both hit AI, easy to conflate.
- `EvidenceCell` has a **three-way rendering duality** (concise AI synthesis with expand, 1-2 raw entries shown directly, or raw entries with "Show N more") depending on hidden state, with no visible flag for which mode is active.
- AFI band-jump pills are parsed out of free-text AI output via a specific regex pattern — a brittle coupling between report-generation text and rendering; a redesign must not assume this text is freely restylable without preserving the contract.
- `it.needsReassessment` overrides the Band pill entirely with "Needs re-assessment" — a fifth possible header state beyond Band 0-5, easy to miss.

---

## Finalisation Checklist (`src/pages/Finalisation.tsx`, route `/finalisation`)

### 1. Purpose
"Final checks before locking the audit" — closeout step 3, a hard gate before the cycle can be locked.

### 2. Structure
`CloseoutStepper` → "Finalisation checklist" card — a table of 11 deterministic checks (Check | Status Met/Blocked | If blocked hint), covering scope confirmed, period defined, folders created, all GD4 criteria scored, score gate at Band 3+, no open Cat A findings, no open Critical findings, no open AFIs, reviewer-confirmed overridden scores, no out-of-period evidence, cycle status Ready-for-Review-or-Locked → "Lock final version" card — explanatory text, a Lock/Already-locked button (disabled unless all checks pass and not already locked), status pill → "Consistency check" card — explanatory text ("read-only... changes nothing"), a "Run consistency check" button against the **same** `buildFinalReport` output Final Report itself uses, and a result list (rule id, message, "Go to <itemId> →" link) or a success line.

### 3. Key functions
- **"Lock final version"** — gated by all-checks-pass and not-already-locked; calls `lockCycle()`.
- **"Run consistency check"** — populates `issues` from `runConsistencyChecks`; starts `null` so the empty-state text is suppressed until first run.
- Each issue resolves its reference to a GD4 item id and links to `/sub-checklist?item=<id>` when resolvable, else shows the raw reference.

### 4. Connections to other pages
Consistency-check issue rows link to `/sub-checklist?item=<id>` — **no `?from=` param**, so `DeepLinkBackBar` will not show a "back" link on the destination page from here. `CloseoutStepper` links to the other three closeout pages.

### 5. Known confusing/awkward bits
Two of the 11 checks are textually different but **logically identical** — "All GD4 criteria scored" and "Human reviewer confirmed scores on overridden items" both test the exact same underlying condition. A redesign consolidating "duplicate-looking" checks would actually be removing a real duplicate condition — worth flagging to a developer rather than silently merging in a purely visual pass. The Lock button's disabled state has two independent reasons (not-all-pass vs. already-locked) collapsed into one boolean + a label swap as the only distinguishing signal.

---

## Export Centre (`src/pages/ExportCentre.tsx`, route `/export`)

### 1. Purpose
"Export the finished audit pack" — closeout step 4, final deliverables. Confirmed live via screenshot.

### 2. Structure
`CloseoutStepper` (spanning both columns of a `1fr 1fr` grid) → **left** "Export centre" card: projected score/award line, gate/open-findings line, **5 export buttons** (Management pack MD, Findings register CSV, Board summary MD, Internal QA appendix MD, Traceability matrix CSV — the last disabled with a tooltip when zero traceability lines exist), a traceability-matrix explanatory note, a coverage/provenance note, a conditional orange "unverified scored items" warning, a conditional yellow "AI-run bands" warning, a disclaimer line, `ThreePillarNote` → **right** "Export log (N)" card — reverse list of past exports (name, format, timestamp, exportedBy) or "No exports yet."

### 3. Key functions
Each of the 5 export buttons calls its export helper directly (one click) and appends to the visible export log via `addExportLogEntry`. No filters/toggles beyond the traceability button's disabled/enabled state.

### 4. Connections to other pages
No `?item=`-style deep links — a terminal page in the flow, no outbound links besides the stepper.

### 5. Known confusing/awkward bits
The two warning boxes (zero-evidence items, AI-auto-band items) deliberately mirror content already present inside the generated Markdown pack — this duplication is intentional per code comments (screen and file should stay consistent), not an accident, and both copies should be preserved in any redesign.

---

## Rubric Banding (`src/pages/RubricBanding.tsx`, route `/rubric-banding`) — tool

### 1. Purpose
Reference page: "the official EduTrust §23 band rubric and each item's applied band." Lives in the Close-out group's "Tools & reference" tail, but is **not** one of the 4 closeout steps and does **not** render `CloseoutStepper` at all (confirmed by reading the file — no import/usage anywhere).

### 2. Structure
"Official EduTrust band rubric (para. 23)" card — explanatory text + `EdutrustBandTable`, a 4-dimension × 5-band read-only reference grid (verbatim rubric text, hover for dimension definitions) → "Applied banding" card — a "Overall by criterion"/"By item (sub-criterion detail)" toggle (synced from `?view=` on load, but **not written back to the URL on click**); Criterion view = a simple summary table; Item view = a nested table grouped by criterion → sub-criterion (clickable) → items (clickable), each with a per-criterion total row.

### 3. Key functions
- View-mode toggle — one-way `?view=` sync (reads on load, doesn't write on click, so manually switching views doesn't produce a shareable/bookmarkable URL).
- Row click on a sub-criterion or item — `goToItem()` → `/sub-checklist?item=<id>&from=rubric-banding`.
- `?scrollTo=<id>` effect — on mount, if in item view, scrolls to and highlights that item, then strips the param from the URL.

### 4. Connections to other pages
Every sub-criterion/item row links to `/sub-checklist?item=<id>&from=rubric-banding`. Deliberately **excluded** from the shared `DeepLinkBackBar`'s source map (per that component's own comment: "it has its own bespoke scrollTo back link on the Sub-Criterion Checklist") — meaning Sub-Criterion Checklist links back here via its own page-specific `?from=rubric-banding` handling, not the generic mechanism every other `?from=` flow uses.

### 5. Known confusing/awkward bits
Its total absence of `CloseoutStepper` is easy to overlook when treating "the closeout pages" as one visual family for a redesign — a naive pass could mistakenly add a stepper here, misrepresenting it as a step in the 4-stage flow. The view toggle not writing back to `?view=` means sharing the URL after manually switching tabs gives a stale view parameter — likely unintentional, worth fixing alongside any redesign. It uses a **third**, bespoke `?view=`/`?scrollTo=` deep-link scheme distinct from both the `?item=`/`?from=` pattern used everywhere else and the plain `?from=` pattern `DeepLinkBackBar` handles.

---

# Settings

## Settings (`src/pages/Settings.tsx`, route `/settings`)

### 1. Purpose
Configure Supabase, OpenAI and Google Drive integrations — per the nav hint — but the page actually renders 8 distinct sections, several unrelated to that description. Confirmed live via screenshot.

### 2. Structure
Eight stacked cards, single column, no tabs/grouping beyond card borders:
1. "Not production safe" warning banner.
2. **Guidance** — a toggle.
3. **Auditor Review Panel** — 4-mode radio group (off/on-demand/nc-major-auto/all).
4. **Supabase database** — URL/key fields, an SQL snippet, Save & reload / Test connection / Reload from Supabase / Clear buttons.
5. **AI integration (OpenAI)** — API key, enable toggle, 3 model pickers (Analysis/Utility/Vision), verdict-temperature slider.
6. **Google Drive integration** — Client ID + Connect/Disconnect.
7. **Display** — theme buttons (Default/Bold).
8. **Developer** — "Show developer tools (commit footer and Change Log)" toggle.

So: two integrations named in the nav hint (Supabase, OpenAI, Drive) are sections 4-6; Guidance and Auditor Review Panel (2-3) and Display/Developer (7-8) are unrelated to that description.

### 3. Key functions
- Guidance checkbox, Auditor Review Panel radio group — straightforward store toggles.
- **Supabase**: "Save & reload" (sets URL/key then rehydrates everything from Supabase), "Test connection," "Reload from Supabase," "Clear (use local storage only)."
- **OpenAI**: "Enable live AI calls" checkbox, "Fetch available models," 3 model pickers, verdict-temperature slider + number input, "Save key"/"Clear key."
- **Google Drive**: "Save Client ID," **"Connect Google Drive"** (reused for both first-connect and reconnect — there is no separate reconnect button/flow), "Disconnect."
- Display theme buttons, Developer toggle.

### 4. Connections to other pages
Auditor Review Panel section links to `/auditors` to pick panel members. Verdict-temperature note links to `/ai-calibration` (Consistency test). The Developer toggle here is read by Change Log (redirects when off), `Layout.tsx` (hides the git footer), and `visibleNav()` (hides `/change-log`, `/ai-review`, `/ai-debug`, `/human-decision-log`, `/run-log`, `/ai-calibration` from the sidebar).

### 5. Known confusing/awkward bits
- **The page mixes three genuinely different concerns with zero visual separation beyond card borders**: real external-service integrations, unrelated feature toggles, and a developer/diagnostics toggle — a plain linear scroll, and the nav hint undersells more than half the page's actual content.
- **No distinct "reconnect" flow for Google Drive** — the same "Connect" button is reused; page copy claims the connection "survives page reloads... you should only ever need to click 'Connect Google Drive' once," but an auth failure shows only small red error text below the button row, the 6th of 8 stacked cards — easy to miss.
- The Supabase card front-loads an unusually dense wall of explanatory text (5 paragraphs + a SQL block + a warning box) before any input, visually dominating the page and pushing OpenAI/Drive further down.
- "Verdict consistency (temperature)" sits deep inside the OpenAI card as if OpenAI-specific, though it's really a general AI-repeatability behaviour toggle.

---

## GD4 Scoring Setup (`src/pages/GD4ScoringSetup.tsx`, route `/gd4-scoring-setup`)

### 1. Purpose
Tune scoring weights, award (certification tier) thresholds, and criteria points — everything that maps raw evidence scores to the certification band.

### 2. Structure
Four cards: (1) "Difficulty — EduTrust tier cut-offs & AI strictness" — preset buttons, 3 numeric threshold inputs, AI-strictness dropdown; (2) "Band auto-scoring — Full Auto/Hybrid first draft" — a single checkbox with a long explanation, gated by `confirm()`; (3) "APSR percentage scale" — max-%-per-dimension input, derived band-step display, 4 band-threshold inputs, a live worked-example panel; (4) "GD4 scoring setup" — two read-only reference tables (Criterion → max points; Requirement/Item → criterion/weightage/gate-sensitive).

### 3. Key functions
- Preset buttons — `applyPreset(name)`.
- 3 threshold inputs, AI-strictness select.
- **Auto-score-bands checkbox** — turning **ON** requires passing a `confirm()` dialog with detailed warning text; turning **off** is unconditional (an asymmetric gate).
- "Reset to reconstructed default" (APSR scale, only shown when the scale differs from default).
- Max-%-per-dimension input, 4 band-threshold inputs.
- Both reference tables are fully read-only, sourced from `GD4_CRITERIA`/`GD4_REQUIREMENTS`.

### 4. Connections to other pages
No outbound links — only unlinked text pointers to docs and to "the score, Final Report and Data Dashboard" / "the Scorecard, Final Report and Sub-Criterion Checklist" as downstream-affected pages.

### 5. Known confusing/awkward bits
The auto-score-bands card has an unusually long inline explanation compared to its terser neighbours — visually heavier despite being "just a checkbox." The "Reset to reconstructed default" button only appears conditionally, paired with a small pill in the card header rather than a dedicated action area — easy to miss. The "worked example" panel is informational-only but styled like a callout, which could read as interactive. The two reference tables use plain unstyled `<table>` markup, visually different from the styled editable cards around them.

---

## AI Memories (`src/pages/AIMemories.tsx`, route `/ai-memories`) — tool

### 1. Purpose
Manage calibration memories used to guide AI audit outputs — memories generated from staff corrections of AI outputs.

### 2. Structure
Header → tab bar ("Memories Library"/"Analytics"). **Memories Library**: 5-card stat row (Total/Active/Pending Review/Archived/Token Budget Used) → filter bar (Module + Status) → a table (Module/Context/Key Learning/Status/Usage/Effectiveness/Created), each row click-expandable. **Analytics**: module filter → 2×2 grid — "Accuracy Rate by Module" (a pointer sentence to Human Decision Log, no chart), "Module Correction Counts" ranked list, "Most Effective Memories (Top 5)" ranked list, "Token Budget" gauge.

### 3. Key functions
- Row click — expands to a 4-panel detail grid (Context/AI Output/Staff Correction/Key Learning) plus effectiveness score and **status-change buttons** ("Mark Active"/"Mark Pending Review"/"Archive," shown only for the two statuses the memory is *not* currently in) — `updateMemoryStatus`.
- **No create/delete controls anywhere on this page** — memories are read from the store and only their status is mutable here.
- Token budget: a fixed 8,000-token cap, colour-coded gauge at 70%/90% thresholds.

### 4. Connections to other pages
The Analytics tab explicitly defers per-module accuracy detail to the Human Decision Log — as plain text, **not a link**. No `<Link>`/`<a>` elements anywhere in the file.

### 5. Known confusing/awkward bits
"Accuracy Rate by Module" is a dead-end card — a heading suggesting a chart, containing only a sentence pointing elsewhere with no actual link. Status-change buttons only appear once a row is expanded — an extra click for a common action. The 5-card stat row and the two Analytics-tab ranked-list panels present overlapping data in different tab contexts with no cross-navigation between them.

---

## AI Calibration (`src/pages/AICalibration.tsx`, route `/ai-calibration`) — developer tool, plus `CalibrationLab.tsx` and `RuleTuningTab.tsx`

### 1. Purpose
A measurement/tuning workspace checking whether the app's AI assessments agree with (a) real SSG EduTrust ground-truth findings and (b) themselves, run to run — and offers a bounded, human-gated way to adjust assessment rules. Explicitly never changes real audit results on its own except via one specific tab (see below). Confirmed live via screenshot.

Four tabs:
- **Benchmark** — compares the app's current results for a sub-criterion against real SSG assessor findings, scoring caught/partially caught/missed.
- **Consistency** — runs ONE path (A or B) N times on the same folders and scores per-line verdict agreement (repeatability).
- **A vs B** — runs BOTH paths on the same folders, judges each against benchmark truth to say which is more accurate.
- **Rule Tuning** — edits a bounded "Met/Partial" rules layer, saves versions, tests their effect, then explicitly promotes a version to "Champion" (the version that actually runs on real audits).

### 2. Structure
A 4-button tab row (Benchmark/Consistency/A vs B/Rule Tuning) directly in `AICalibration.tsx`; three tabs live in `CalibrationLab.tsx`, one in `RuleTuningTab.tsx`; `AICalibration.tsx` itself is purely the shell + the Benchmark tab.

**Benchmark tab**: `UploadBenchmarkPanel` (collapsed, "Add ground truth from an audit report") → filter/action bar (criterion/sub-criterion/source filters, Run match analysis, Export CSV, Reset to original 59 findings) → scoreboard card → charts card → Tuning Advisor panel (shown once run) → over-rating check card (conditional) → per-AFI comparison list grouped by criterion.

**Consistency tab**: setup card (sub-criterion picker, path selector, repeat-runs input, Run test/Export/Clear, temperature notice, live progress) → saved-result history → heat chart → Tuning Advisor → other sub-criteria's past tests.

**A vs B tab**: setup card (sub-criterion picker, Run A vs B, tally banner, Export/Clear) → side-by-side A/B/real-findings result → head-to-head chart → win-pattern chart → Tuning Advisor → other tests list.

**Rule Tuning tab**: editor card (global textarea, per-criterion tabs with override+guidance textareas, injection preview, Save as new version) → post-save "test its effect?" banner → version history list (per version: Edit this / Revert to this / ★ Make Champion / Test consistency / Test benchmark) → change log → a link to AI Debug Log to see where injected rules actually land in the prompt.

### 3. Key functions
- **Run match analysis** — judges caught/partial/missed per sub-criterion; writes matches with `setAiMatch`, which **refuses to overwrite a human-set match** (human-override-wins, checked in code); stamps a scoreboard snapshot.
- **Export CSV**, **Reset to original 59 findings** (confirm-gated, appears twice — once in the empty state, once in the filter bar).
- Per-AFI: manual Edit/Remove, and a manual status select + justification input that write `setMatch(..., humanOverride=true)` directly — **this is the human-override path.**
- Upload panel: "Extract findings" (AI draft) → "Add N to benchmark set" (the only commit) → "Discard draft."
- **Consistency**: "Run test (N runs)" loops the same scratch audit N times, computes agreement, **always appends** to history (never overwrites). "Retry run N" on a failure.
- **A vs B**: "Run A vs B" runs both paths, judges each, **overwrites per sub-criterion — no history stack**, unlike Consistency's append-only history. "Show what each path actually raised, line by line" toggle.
- **Shared "Tuning Advisor" panel** (used by all three of Benchmark/Consistency/A-vs-B): a recommendation either carries an **"Apply" button** (temperature or path-default change — one click, immediately effective, reversible, disabled once applied) **or** a **copy-paste textarea** with a "Copy" button (advisory only — the human must go make that change themselves, e.g. in the codebase). Benchmark-derived recommendations show a standing "⚠ Overfitting caution" banner.
- **Rule Tuning**: "Save as new version" (always creates a **new** version; not live until champion-promoted) → "Test consistency"/"Test against benchmark" (scratch-only measurement) → **"★ Make Champion"** — confirms if the candidate scored worse than the current champion, then promotes it — **this is the only action anywhere on this page that changes what real audits actually use** (the champion injection is read live at real audit time). "Revert to this" clones an old version into a new active version without touching the champion. "Edit this" switches the active-editing version.

### 4. Connections to other pages
Every scratch run needs a sub-criterion's Drive folders connected first — a `PrereqNotice` links to Evidence Folder when not connected. Consistency tab links to Settings to lower verdict temperature. Rule Tuning links to AI Debug Log. Every real AI call from a test run is logged in the AI Review Log (referenced in copy, but this page doesn't deep-link there). Production audit runs (which this page measures) separately inject calibration memories via `buildSystemPrompt(...)` — the Rule Tuning champion injection and AI-memory injection are two separate, parallel systems both feeding the same production prompt.

### 5. Known confusing/awkward bits
- **The safety mechanisms are text-only and easy to visually flatten in a redesign.** "Human-override-wins" (Benchmark) shows only as a small neutral pill plus one line of grey helper text — no persistent visual language (lock icon, distinct border) marking a cell as protected from AI overwrite.
- **The one-click-safe vs. advisory-only distinction in the Tuning Advisor hinges entirely on whether the card renders a button or a textarea** — nothing in the card's outer chrome (colour/icon) separates "this changes live behaviour now" from "this is just measurement." A uniform "primary button" restyle would blur that boundary.
- **Champion-gating is buried at the bottom of a long tab**, explained in one paragraph of body copy plus a small ★ + pill per version row — there is **no persistent global indicator elsewhere in the app** showing which Rule version is currently live, so a user could easily lose track of what's actually affecting real audits.
- **"Champion" vs. "Active" vs. "latest saved version"** are three distinct concepts differentiated only by badge text on the same version list, not by layout/position.
- **A vs B has no history stack (overwrite) while Consistency has full append-only history** — visually near-identical "Delete"/"Re-run" controls carry very different data-loss risk depending on which tab you're on.
- **"Reset to original 59 findings" appears twice** with slightly different confirm-dialog wording each time.
- **Cost-warning inconsistency**: Consistency/A-vs-B/Rule-Tuning all show an inline "⚠ Real AI calls: cost ≈ …" warning near their run buttons; the Benchmark tab's "Run match analysis" — which can loop over many sub-criteria's worth of AI calls — has no equivalent warning.
- **The tab bar gives no visual distinction between the three read-only measurement tabs and the one tab (Rule Tuning) that can change live audit behaviour** — worth adding an icon/colour cue in a redesign, since this is a genuine safety-relevant distinction, not a cosmetic one.

---

## Prompt Review (`src/pages/PromptReview.tsx`, route `/prompt-review`) — tool

### 1. Purpose
Lets a user review an AI output against a saved, **user-authored** prompt, rate it on 4 quality dimensions + compliance risk, and — only if rated Weak on any dimension or High compliance risk — have the AI draft an improved version of the prompt, which the human must explicitly promote to "live" before it takes effect. Note: this only edits the user's own saved prompts here, not the app's built-in audit prompts.

### 2. Structure
Numbered cards, top to bottom: intro + offline-AI warning → **"1 · Pick a prompt to review"** (dropdown + "New prompt" form + preview panel with Edit text/Delete) → **"2 · The AI output to review"** ("Generate output with AI" or manual paste) → **"3 · Rate the output"** (4 quality selects + compliance-risk select + optional textareas + a trigger banner) → **"4 · Improve the prompt"** (only rendered when triggered — "Add correction details" opens `FeedbackModal`, "Draft an improved prompt," editable revised-draft textarea) → **"5 · Save this review"** ("Save review" keeps the current prompt live; "Save & make the improved prompt live," shown only when a revised draft exists) → **Review log table** (all saved reviews for the selected/all prompts, with a "Make live" button on any not-yet-promoted revision row).

### 3. Key functions
- New prompt / Save prompt, Edit text (native `prompt()` dialog), Delete (confirm-gated, also deletes its review records).
- "Generate output with AI" — runs the prompt's raw text through the model with plain-text output (works even for prompts that never mention JSON).
- "Add correction details" → `FeedbackModal`; "Draft an improved prompt" — disabled until feedback is captured.
- **"Save review (keep current prompt live)"** vs. **"Save & make the improved prompt live"** — the second is "the champion gate — explicit human confirmation" per an inline code comment; it's the only path (besides the table's own "Make live") that overwrites the live prompt text.
- **"Make live"** in the review-log table (any `revision_drafted` row) — same action, **confirm-gated in the table**, but the step-5 button that does the same thing has **no separate confirm beyond its own label.**
- Both save paths also mirror the decision into the app-wide Human Decision Log.

### 4. Connections to other pages
Uses the same shared `AiOutputView`/`FeedbackModal` components as elsewhere in the app. Writes into the Human Decision Log (surfaces there, not here). **Not a tab of AI Calibration** — a fully separate top-level route, despite implementing the identical "AI recommends → human corrects → explicit go-live" pattern as Rule Tuning.

### 5. Known confusing/awkward bits
- **The "needs correction" trigger condition is entirely implicit** — it fires on any Weak rating or High risk, but the only on-screen signal is a red-tinted border on the specific `<select>` plus a banner that appears only once triggered. A redesign that drops the conditional border tint (a very "form validation" look, easy to cut for aesthetics) would remove the only per-field cue for why the flow branched.
- **Two visually similar "Save" buttons with very different consequences** sit side by side once a revision exists: "Save review" (grey/neutral) vs. "Save & make the improved prompt live" (solid green) — colour is the *only* thing preventing an accidental live-promotion click; this contrast must survive any redesign.
- **"Make live" appears in two places with inconsistent confirmation** — the table version confirms, the step-5 flow does not.
- Status vocabulary (`reviewed_ok`/`needs_revision`/`revision_drafted`/`revision_live`) is distinguished only by pill colour, no icon/lock — easy to lose in a monochrome redesign.
- **No indicator anywhere on this page (or elsewhere in the app) showing when a prompt's live text has drifted from what was last reviewed** — worth flagging since a space-saving redesign of the Review log table could accidentally hide this gap further rather than fix it.

---

## Change Log (`src/pages/ChangeLog.tsx`, route `/change-log`) — developer tool

### 1. Purpose
Read-only history of every push/pull the app recorded, with a plain-English summary of what changed — built directly from git history embedded at build time.

### 2. Structure
Route guard at the top of the component: if developer tools are off, hard-redirects to `/` — **the page is fully inaccessible, not just hidden from nav, when the toggle is off**, and shows no explanatory message before bouncing. Single card: header + description → filter row (Search, From/To date) → result-count line → empty states (no git history embedded vs. no filter matches) → **day-grouped commit list** — each commit card shows subject/author/time/short hash plus two independently-collapsible sections, "Description" (commit body) and "N files changed" (file list).

### 3. Key functions
Search filters by subject/body substring. From/To date filters by commit day. Per-commit Description/Files toggles are local state only. **This page has no store-mutating actions at all** — purely a filtered read view over a build-time-embedded git log global.

### 4. Connections to other pages
The **deployed commit hash** shown by this same build-time mechanism is separately surfaced by a footer bar (`GitFooter`, in `Layout.tsx`) shown app-wide when developer tools are on — this is how the user is meant to confirm which commit is actually live before debugging "the fix doesn't work" claims (per CLAUDE.md's own guidance). Visibility of this route is controlled by the same Settings toggle documented in the four-log-page cross-cutting note above.

### 5. Known confusing/awkward bits
There are **two overlapping "change log" data sources** in the codebase: the full git log embedded at build time (what this page actually renders) and a separately-recorded push-event store that a background component in `Layout.tsx` writes to (used for the footer and a one-time legacy migration) — a naive reader could assume the whole page is driven by that second store, but it isn't; only the build-time git log is. A user who bookmarks `/change-log` with developer tools off gets silently bounced to the Dashboard with no explanation on this page itself. No "expand all"/"collapse all" for long histories, only per-row toggles.

---

# Pages with the most hidden functionality

The task asked for a note on which pages have **significantly more hidden functionality than their current layout suggests** — the strongest candidates to prioritise in a redesign, without removing anything:

1. **Sub-Criterion Checklist** (`/sub-checklist`) is the clearest case in the whole app. It is the single densest, most interconnected page (~1660 lines), and it packs in: two same-labelled "AI first pass" buttons that do completely unrelated things; a purely cosmetic dimension selector rendered with the exact same visual weight as the load-bearing verdict selector right next to it; a legacy dual-verdict system where a frozen AI-run snapshot can silently disagree with the live editable verdict; three eras of re-assessment warning copy from two separate historical rescoring migrations; and the app's single official scoring control (the APSR matrix) rendered as a 7-9px dense reference grid with a permanent "not fully confirmed" disclaimer sitting directly above it. None of this is visible from a glance at the page — it only surfaces by reading every control's actual wiring.

2. **AI Calibration → Rule Tuning tab** (`/ai-calibration`) carries real safety weight that the layout doesn't signal at all: it's the *only* tab, among four nearly-identical-looking tabs, that can change what real audits actually do (via "★ Make Champion"). The distinction between a one-click-reversible "Apply" action and an advisory-only copy-paste recommendation, the difference between "Champion" / "Active" / "latest saved version," and the fact that three of the four tabs are pure measurement while one is not — all of this is conveyed today only through small text differences, not through any icon, colour, or layout cue. A uniform visual redesign is the single most likely way to accidentally erase a safety-relevant distinction in this entire app.

3. **The Evidence Folder per-sub-criterion card** (`/evidence-folder`) hides a genuinely large amount of behaviour behind its "⋯" overflow menu and its Path A/B toggle: the primary action button silently becomes a different, much bigger action (an unattended multi-minute AI run instead of opening a review modal) purely based on mode+setting, with only the button's own label as a signal; and the overflow menu is the sole entry point to the zero-cost pre-flight diagnostic and to the "no audit needed" Official Requirements reference — both easy to treat as "just another menu item" and demote or cut in a visual pass.

4. **The four developer-tools Log pages** (AI Review Log, AI Debug Log, Human Decision Log, Run Log) collectively hide a real, consistent functional gap rather than functionality that exists but is hard to find: `runId`/`aiRunId` cross-references are genuine data links between these pages, but render as plain unclickable text everywhere except Run Log. This is called out separately from the other three items above because it's not "don't break this" — it's "this is a natural, low-risk thing to *add* while redesigning," since restoring/adding that linkage requires no store changes at all.

5. **PPD + Evidence Review modal → "Official requirements" tab vs. the "Requirement coverage" matrix** look almost identical (same table shape, similar column count, monospace refs) but mean opposite things — one is unassessed reference text, the other is a completed audit result. Today the only differentiator is a text disclaimer and a header string. This is exactly the kind of pair a redesign should make structurally obvious at a glance, while preserving the architectural fact that the reference tab reads zero run state.
