# UI Findings — Compiled List

A flat, compiled list of every "known confusing/awkward bit" identified in `docs/ui-structure-reference.md`, pulled out of the page-by-page reference into one findings document for quick scanning. **These are redesign opportunities, not a deletion list** — each finding describes a real, working piece of functionality that is currently hard to discover or easy to misread, not something to remove. See `docs/ui-structure-reference.md` for full page context (Purpose/Structure/Key functions/Connections) behind each finding.

Findings are numbered sequentially and grouped by nav area, in the same order as the reference doc: Home → 1 · Set up → 2 · Audit & evidence → 3 · Findings & review → 4 · Close out → Settings.

---

## Priority: pages with the most hidden functionality

1. **Sub-Criterion Checklist** is the densest, most redesign-critical page in the app: two identically-labelled "AI first pass" buttons doing unrelated things, a cosmetic dimension selector styled identically to the load-bearing verdict selector, a legacy frozen-snapshot verdict that can silently disagree with the live one, three eras of re-assessment warning copy, and the app's one official scoring control rendered as a 7-9px dense grid.
2. **AI Calibration → Rule Tuning tab** is the only one of four near-identical tabs that can change real audit behaviour (via "Make Champion"), signalled today only by text, not colour/icon.
3. **Evidence Folder's "⋯" overflow menu and Path A/B toggle** hide the pre-flight diagnostic, the no-audit-needed reference view, and a mode where the primary button silently becomes an unattended multi-minute AI run.
4. **The four developer Log pages** have a real, fixable gap: `runId`/`aiRunId` cross-references exist as data but render as unclickable text everywhere except Run Log.
5. **"Official requirements" tab vs. "Requirement coverage" matrix** in the PPD+Evidence Review modal look almost identical but mean opposite things (unassessed reference text vs. completed result).

---

## Home

### Dashboard (`/`)
1. Four-to-six score-header action buttons share nearly identical pill styling, differing only by text colour — easy to conflate a destructive/AI-cost-incurring action ("Audit all folders → score") with a harmless read-only one ("Recheck all evidence").
2. "Use demo data" overwrites existing evidence/scores/closures behind a text-only `confirm()`, with no visible undo on this page.
3. "Strategic AI analysis" only appears when AI is enabled with a key configured — otherwise the button doesn't exist, which could look like dead/missing code.
4. The Quick-win calculator and Forensic integrity flags cards disappear entirely with no data — invisible in an empty/demo workspace.
5. The "Getting started" 4-step guide is generated from `nav.ts`; a redesign that hardcodes 4 boxes here would silently break that coupling.

### Draft Workspace (`/draft-workspace`)
6. "Restore this version" has no confirmation dialog while "Create new (blank) cycle" does — both replace in-progress work, only one warns.
7. "Duplicate cycle" also has no confirm dialog and no destructive-looking styling, sitting right next to "Save as new version."
8. Five buttons of similar visual weight in one row; only "Create new (blank) cycle" is red-tinted, despite very different consequences (versioning vs. destructive wipe vs. file download vs. navigation).
9. "Unlock (admin)" has no confirm dialog and no visible access control beyond conditional rendering.
10. The Duplicate-vs-Create-new explanatory paragraph is small, low-contrast text, easy to miss.

### Analytics / "Data Dashboard" (`/analytics`)
11. Naming mismatch: route `/analytics`, file `Analytics.tsx`, but the nav label and on-page heading both say "Data Dashboard."
12. Entirely non-interactive — a redesign is free to restructure without preserving click logic, unusual relative to the rest of the app.
13. Not linked from Dashboard itself despite containing valuable overview data.

### Help & Guide (`/help`)
14. The Developers tab sits one equally-weighted tab click away from the Users tab — a redesign must not make it feel "in the way" for real auditors.
15. The `DETAILS` prose map is hand-maintained by route path; a renamed/removed route silently falls back to the shorter nav hint rather than erroring, so page *content* can drift even though the page *list* can't.
16. The lifecycle diagram is a bespoke inline SVG with absolute-positioned coordinates — reflowing it means hand-editing geometry, not CSS.

---

## 1 · Set up

### Profile of PEI (`/profile-of-pei`)
17. Two textareas both feed the AI context in overlapping ways (Background tab, auto-synced every keystroke; "Extra AI context from Drive," a separate card) — a user could reasonably expect one source and miss that both compose together.
18. The "AI audit context strip" (toggle + token estimate) sits in the header card, visually separated from the Background tab it actually governs by the whole tab bar.
19. "Extra AI context from Drive" and "Audit Journal" are leftovers moved from a retired page — functionally unrelated to the 8-tab profile above them, easy to strand in a redesign since nothing in the tab UI hints they exist.
20. "Read from Drive" requires Google Drive connected in Settings — only mentioned in small print, not enforced/disabled in the UI.

### Audit Cycle (`/audit-cycle`)
21. "Duplicate this cycle" has no confirmation while "Create new (blank) cycle" does — side by side, very different risk levels.
22. The status-button row doubles as the sole lock/unlock mechanism, with nothing visually distinguishing "Locked" among six equal-looking buttons.
23. "Reset to defaults" for Departments is a full replace; the button label alone doesn't convey that current custom departments are deleted.
24. The Departments card is functionally unrelated to "cycle setup" (shared master data used by 4 other pages) but bolted on with no visual separation beyond its own card border.

### Auditor Creation (`/auditors`)
25. Two visually near-identical "auditor list" surfaces (table's inline-editable Perspective/Strictness vs. Review Panel membership toggles) — different actions on the same auditor names, easy to mistake for one control.
26. The top form uses an explicit Create/Save flow, but the same fields are also instantly editable per-row below with no save step — two edit paradigms for the same data.
27. "Load preset auditors" silently disappears while editing an auditor — could read as a bug.
28. The four "Simulated AI agent roles" are a completely separate system from the human/AI "auditors" above (different store slice) despite near-identical UI, disambiguated only by one line of body copy.
29. Review Panel buttons closely resemble a plain multi-select but cap out and grey — could read as a rendering glitch without reading the tooltip.

### GD4 Library (`/gd4-library`)
30. The "Intent" field is a `readOnly` textarea styled identically to editable inputs elsewhere — a user might try to type in it before noticing nothing happens.

### Pre-check Checklist Setup (`/pre-check-setup`)
31. Draft vs. Verified gate is only partially visually clear: the Add-item form's "starts as draft" fact is buried in small footnote text, not next to the Add button; "Approve"/"Revert to draft" render as ordinary same-size buttons alongside Edit/Remove/reorder, with nothing flagging them as more consequential despite the underlying code explicitly calling for this to be "unmissable."
32. The "All items" filter view hides the Add/Edit form entirely (replaced by a placeholder) — easy to miss that this is deliberate.
33. Single-row Remove has no confirmation; bulk Delete does.
34. The "Recurring findings" card only appears conditionally — a whole feature that can be entirely invisible depending on data state.
35. A page-level note calls out a separate, always-on "universal" date/time-discrepancy layer that isn't editable anywhere on this page — the page implies it lists "all checklist items," but it's incomplete by design.

---

## 2 · Audit & evidence

### Start Audit (`/start-audit`)
36. The page explicitly disclaims that Option A/B path selection is *not* chosen here — worth preserving as a callout, since users conflate "mode" (AI automation level) with "path" (A/B analysis method).

### Evidence Folder (`/evidence-folder`)
37. Path A/B toggle is view state, not a filter that discards data — switching it changes which "View results" reopens but does not delete the other path's saved results; a user could easily believe switching "loses" the other path's results.
38. The exact same primary button silently changes what it does ("Run review" opens a modal vs. "Run audit →" runs a multi-minute unattended pipeline after one `confirm()`) purely based on mode+setting — the label is the only signal.
39. The "⋯" overflow menu hides consequential, mode-gated actions: 3 of ~7 items only appear in Hybrid mode; the pre-flight check is the card's only zero-cost diagnostic; "Official requirements" is the only entry point to reference text needing no folders/run at all — all easy to bury or drop as "just a junk drawer."
40. Very high control density per card, deliberately packed per code comments — a redesign compressing this further risks conflating the Path toggle (semantic selector) with the Progress chips (read-only status), since both render as similarly-sized pills.
41. Multiple "View results" entry points render identically in different DOM locations — functionally redundant, worth consolidating conceptually.
42. Ephemeral vs. persistent dismiss states look visually identical (mode-chip ✕ resets on reload; access-note/audit-result ✕ are ephemeral but content-keyed; pre-flight ✕ hides the panel but the result persists across reloads) — no visual cue for which "comes back."
43. `VisionBudgetPromptModal` is invisible to anyone only reading this file — it can appear mid-run, blocking, purely because it's globally mounted in `Layout.tsx`; a redesign of this page's overlay/z-index stack must account for it.
44. `AuditProgressModal` is suppressed during full-auto sweeps (folded into `FullAuditOverlay` instead) — the "same" step-by-step UI is implemented twice for two different container overlays.

### PPD + Evidence Review modal (Option A, opened from Evidence Folder)
45. "Official requirements" tab vs. the "Requirement coverage" matrix genuinely look alike and mean opposites — pre-audit static text vs. post-audit assessed verdicts, differentiated today only by an amber disclaimer and a header string.
46. The Official-requirements tab's ⬇ CSV/⬇ PDF have no Options/Compact/columns system behind them at all, despite looking visually identical to the matrix version's much richer export — three different "3-ish column" CSV shapes exist across this one modal.
47. The active Compact/Full-detail export choice is sticky but invisible once the Options panel is closed — no indicator on the ⬇ buttons of which mode is currently active.
48. The `HybridGatePanel` contains a legacy-drain-only explanatory box that only appears for old Option-A pending runs — dead-code-adjacent UI for a deprecated flow, possibly safe to drop once no legacy runs remain.
49. The tab bar's Evidence "⏸ N" badge and the `HybridGatePanel` header count are the same number rendered in two places with different styling.
50. The auditor-gate and Drive-connect blocking banners are literally copy-pasted blocks between the PPD tab and the Evidence tab rather than a shared subcomponent.

### Sub-Criterion Checklist (`/sub-checklist`)
51. Two different "AI first pass" buttons, both labelled identically, ~130px apart, doing unrelated things (line generation vs. band-score suggestion).
52. The line-generation "AI first pass" button silently forks behaviour by audit mode (auto-confirms in hybrid/full-auto, stops for review in manual) with no UI signal of which will happen.
53. A cosmetic control (the per-line "Dimension" select, display-only) sits visually identical in weight to a load-bearing one (the "Verdict" select that drives the band) right next to it — the "never changes the band" fact is only in a hover tooltip.
54. A legacy dual-verdict system is stacked on the current one: the editable live "Verdict" select coexists with read-only "Policy verdict"/"Combined verdict" fields pulled from a frozen AI-run snapshot that can literally disagree with the current editable verdict.
55. Reassessment/band-source warning language has accumulated three eras of terminology from two separate historical rescoring migrations, never consolidated into one consistent banner.
56. The APSR matrix — the page's one official scoring control — is a dense 6-column × 4-row table down to 7-9px font, with a permanent "reconstructed formula, not confirmed" disclaimer directly above it.
57. Multiple independent "stale/pending" warning banners repeat the same underlying fact (a newer unapproved evidence run) at up to four separate places for one line.
58. The manual-mode explanatory banner only shows while a line count is zero — vanishes forever once the first line is added, even though manual mode's behaviour hasn't changed.
59. A raw-array display-dedup exists purely in the view layer; band/scoring still reads the undeduped array — a data-quality issue papered over visually rather than fixed at the source.

### Sampling (`/sampling`)
60. No on-page link back to the pages whose data feeds this (Evidence Folder, Checklist) or forward to where its output is consumed — a cold-landing user has no context.
61. The regenerate button silently overwrites all existing tested outcomes/notes if confirmed, behind an easily-dismissed `confirm()`.
62. `generateSamples` hard-caps at 12 with no UI indication of the cap or how many risky items were excluded.

### Interview (`/interview`)
63. Same missing-context issue as Sampling — no on-page link to the pages whose data feeds it or where its output goes.
64. Regenerating silently discards all recorded readiness ratings/notes if confirmed.
65. "Expected answer" text is a static hard-coded template, not personalised or AI-generated, though nothing on the page clarifies this.

### Evidence Intelligence (`/evidence-intelligence`)
66. A real discrepancy between framing and UI: the page insists "no AI call" (true of the 12 deterministic checks), but the "By item" view also surfaces live "run AI" buttons that trigger a real/simulated AI call, visually part of the same page.
67. No on-page link back to the data-source pages or forward to Findings for a "Fail" result.
68. Criterion/item selections are local state only — not persisted or URL-addressable, so no deep link to a specific item's checks is possible.

---

## 3 · Findings & review

### Findings (`/findings`)
69. Two separate "generate findings" pipelines that look similar but produce different structures: "Generate from gaps" (gold, ungrouped, one finding per line) vs. "Generate grouped findings" (indigo, AI-consolidated multi-line drafts requiring a confirm step) — easy to use the wrong one.
70. Duplicate filter mechanisms: dimension/risk-category set both via dropdown and via clickable pills, with no visual link between the two.
71. "Compile findings from the last PPD + Evidence run" only appears buried inside an empty-state message for a scoped filter — the code comment itself acknowledges the primary version lives elsewhere.
72. The finding-row click target overloads three behaviours (expand, collapse, delete) tightly packed into one compact row.
73. "Delete all findings" (global) vs. per-sub-criterion "Delete all" — same label at two different scopes.
74. Dimension-filter labels are inconsistent between the pill row (e.g. "Procedure (policy)") and the plain dropdown ("Procedure") for the same underlying value.

### Clarification round (`/clarification`)
75. Two similarly-styled buttons do very different things: "Re-check selected" spends AI and changes verdicts; "Check for updated evidence" is a free metadata refresh with no AI — mitigated only by an in-app legend a user could skip.
76. "Select all changed" depends on having already run "Check for updated evidence" first (drift badges are empty until then) — the sequencing isn't visually indicated as a numbered flow; clicking it first silently selects nothing.
77. No on-page mapping between badge states (Met/Partial/Not met colours) and what "resolved" precisely means — only visible in the Round History detail.
78. Seed/demo findings are silently excluded from this page with no on-page explanation of why counts might not match the Findings register total.

### Quality Action / AFI (`/afi-closure`)
79. The closure gate is text-only, not shown on the fields themselves — the disabled "Accept closure" tooltip lists missing fields, but the textareas have no red border/asterisk/required-field indicator.
80. Two similarly-worded, similarly-styled AI buttons side by side do conceptually different things: "Suggest actions (AI)" fills fields, "AI closure review" judges the filled fields.
81. The override-reason input only appears conditionally, inserted inline rather than visually tied to the AI-verdict panel below it — easy to miss.
82. "Accept closure" and "Closed ✓" are the same toggle button — clicking it again reopens the finding with no confirmation, unlike delete.
83. Effectiveness confirmation shows a due date only as plain text — no reminder/highlight for overdue, unlike the finding's own Overdue pill which does get distinct red treatment.
84. The "Act" box's amber→green border is the only per-step visual progress cue on the whole page — every other field looks identical whether empty or filled.

### AI Review Log (`/ai-review`)
85. A code comment notes a past "View file ledger" deep-link was deliberately removed as redundant — evidence of past redesign churn.
86. The `runId`'s cross-page meaning is promised by a tooltip but is not actually clickable.
87. Purpose distinctness: this page's filterable/expandable table is nearly identical in shape to Human Decision Log's Decision Log tab and Run Log's row list — nothing in title/icon/colour distinguishes them before a row is expanded and read.

### AI Debug Log (`/ai-debug`)
88. By name alone, "AI Debug Log" vs. "AI Review Log" is a very easy mix-up, though the content and layout (accordion, not a data-grid) genuinely differ once seen.
89. Its description leans on the internal function name `buildSystemPrompt()`, which means nothing to a non-developer.
90. No indication in the page itself that the data is ephemeral beyond one description line.
91. No search/filter at all, unlike the other three log pages.

### Human Decision Log (`/human-decision-log`)
92. Purpose distinctness: the Decision Log tab is structurally near-identical to AI Review Log's table — the key semantic difference (human action vs. AI run) is only conveyed via column headers and pill labels.
93. "Linked AI Run" (`aiRunId`) is shown as plain monospace text, not a clickable link to the AI Review Log entry it references — same gap as AI Review Log's own `runId`.
94. Two tabs bundled onto one route (Decision Log + Calibration Library) is a different content model from the other three single-purpose log pages.
95. The "AI Review Log Feedback" module (populated by AI Review Log's own 👍/👎 buttons) is a non-obvious coupling between two pages, undocumented on-screen in either.

### Run Log (`/run-log`)
96. The collapsed row still looks like "yet another log table" alongside the other three until expanded, where the distinguishing sections and real cross-page links appear.
97. It has export buttons (CSV/JSON/full-AI-CSV) none of the other three log pages have — an inconsistency worth normalising or deliberately preserving.
98. Per-row delete (✕) sits in the same column as the item count, inline with the row-expand click target.

### Cross-cutting — all four log pages
99. None of the four use a distinct icon or colour accent to signal their category (AI-generated vs. human-decision vs. run-orchestration vs. raw-debug) — differentiation today is 100% textual.
100. `runId`/`aiRunId` cross-references exist as real data in AI Review Log and Human Decision Log but render as plain text, not clickable links — Run Log, by contrast, does link out. A natural, low-risk thing to add in a redesign since it requires no store changes.
101. All four are silently redirected to the Dashboard with no error message when "Show developer tools" is off, and removed from the sidebar entirely (not just route-blocked).

---

## 4 · Close out

### Criterion Scorecard (`/scorecard`)
102. Three numeric columns (AI/Reviewer/Confirmed) plus a separate derived Band column can be hard to parse at a glance.
103. The "Re-check candidates" card duplicates the main table's confirm/reopen mechanic under different framing — a new developer may not realise "Reopen for re-score" and "Confirm" are the same store action.
104. Items marked "via Checklist" still show editable AI/Reviewer/Confirm columns "for the record" even though they don't affect the actual band — visually indistinguishable at a glance other than a small pill.

### Final Report (`/final-report`)
105. Easily the densest page in the app — one item block can stack up to ~6 pieces of AI-authored prose per dimension group, distinguished from each other only by label text and light background tinting.
106. Two different "regenerate" surfaces per item ("Generate AI summary" whole-report vs. "Regenerate report text" per-item) both hit AI, easy to conflate.
107. `EvidenceCell` has a three-way rendering duality (concise synthesis, raw entries, raw entries with "Show N more") depending on hidden state, with no visible flag for which mode is active.
108. AFI band-jump pills are parsed out of free-text AI output via a specific regex pattern — a brittle coupling a redesign must not assume is freely restylable.
109. `it.needsReassessment` overrides the Band pill entirely with "Needs re-assessment" — a fifth possible header state beyond Band 0-5, easy to miss.

### Finalisation Checklist (`/finalisation`)
110. Two of the 11 checklist checks are textually different but logically identical ("All GD4 criteria scored" and "Human reviewer confirmed scores on overridden items" test the same condition) — worth flagging to a developer, not silently merging in a visual pass.
111. The Lock button's disabled state has two independent reasons (not-all-pass vs. already-locked) collapsed into one boolean + a label swap as the only distinguishing signal.

### Export Centre (`/export`)
112. The two on-screen warning boxes (zero-evidence items, AI-auto-band items) deliberately mirror content already inside the generated Markdown pack — intentional per code comments, both copies should be preserved.

### Rubric Banding (`/rubric-banding`)
113. Its total absence of `CloseoutStepper` is easy to overlook when treating "the closeout pages" as one visual family — a naive redesign pass could mistakenly add a stepper here.
114. The view-mode toggle reads `?view=` on load but doesn't write it back on click — sharing the URL after manually switching tabs gives a stale view parameter.
115. Uses a third, bespoke `?view=`/`?scrollTo=` deep-link scheme distinct from both the `?item=`/`?from=` pattern used elsewhere and the plain `?from=` pattern `DeepLinkBackBar` handles.

---

## Settings

### Settings (`/settings`)
116. The page mixes three genuinely different concerns (real integrations, unrelated feature toggles, a developer toggle) with zero visual separation beyond card borders — a plain linear scroll, and the nav hint undersells more than half the page's actual content.
117. No distinct "reconnect" flow for Google Drive — the same "Connect" button is reused; an auth failure shows only small red error text below the button row, the 6th of 8 stacked cards.
118. The Supabase card front-loads an unusually dense wall of explanatory text before any input, visually dominating the page and pushing OpenAI/Drive further down.
119. "Verdict consistency (temperature)" sits deep inside the OpenAI card as if OpenAI-specific, though it's a general AI-repeatability behaviour toggle.

### GD4 Scoring Setup (`/gd4-scoring-setup`)
120. The auto-score-bands card has an unusually long inline explanation compared to its terser neighbours — visually heavier despite being "just a checkbox."
121. "Reset to reconstructed default" only appears conditionally, paired with a small pill in the card header rather than a dedicated action area — easy to miss.
122. The "worked example" panel is informational-only but styled like a callout, which could read as interactive.
123. The two reference tables use plain unstyled `<table>` markup, visually different from the styled editable cards around them.

### AI Memories (`/ai-memories`)
124. "Accuracy Rate by Module" is a dead-end card — a heading suggesting a chart, containing only a sentence pointing elsewhere with no actual link.
125. Status-change buttons only appear once a row is expanded — an extra click for a common action.
126. The 5-card stat row and the two Analytics-tab ranked-list panels present overlapping data in different tab contexts with no cross-navigation between them.

### AI Calibration (`/ai-calibration`)
127. The safety mechanisms are text-only and easy to visually flatten in a redesign — "human-override-wins" shows only as a small neutral pill plus one line of grey helper text, no persistent visual language marking a cell as protected from AI overwrite.
128. The one-click-safe vs. advisory-only distinction in the Tuning Advisor hinges entirely on whether the card renders a button or a textarea — nothing in the card's outer chrome separates "this changes live behaviour now" from "this is just measurement."
129. Champion-gating is buried at the bottom of a long tab, explained in one paragraph plus a small ★ + pill per version row — no persistent global indicator elsewhere in the app shows which Rule version is currently live.
130. "Champion" vs. "Active" vs. "latest saved version" are three distinct concepts differentiated only by badge text on the same version list.
131. A vs B has no history stack (overwrite) while Consistency has full append-only history — visually near-identical "Delete"/"Re-run" controls carry very different data-loss risk depending on tab.
132. "Reset to original 59 findings" appears twice with slightly different confirm-dialog wording each time.
133. Cost-warning inconsistency: Consistency/A-vs-B/Rule-Tuning all show an inline AI-cost warning near their run buttons; Benchmark's "Run match analysis" — which can loop over many sub-criteria's AI calls — has none.
134. The tab bar gives no visual distinction between the three read-only measurement tabs and the one tab (Rule Tuning) that can change live audit behaviour.

### Prompt Review (`/prompt-review`)
135. The "needs correction" trigger condition is entirely implicit — the only on-screen signal is a red-tinted border on the specific select plus a banner that appears only once triggered.
136. Two visually similar "Save" buttons with very different consequences sit side by side once a revision exists — colour is the only thing preventing an accidental live-promotion click.
137. "Make live" appears in two places with inconsistent confirmation — the review-log table version confirms, the step-5 flow does not.
138. Status vocabulary is distinguished only by pill colour, no icon/lock — easy to lose in a monochrome redesign.
139. No indicator anywhere on this page (or elsewhere in the app) showing when a prompt's live text has drifted from what was last reviewed.

### Change Log (`/change-log`)
140. Two overlapping "change log" data sources exist in the codebase (the build-time git log this page actually renders, and a separately-recorded push-event store used elsewhere) — a naive reader could assume the whole page is driven by the second store, but it isn't.
141. A user who bookmarks `/change-log` with developer tools off gets silently bounced to the Dashboard with no explanation on this page itself.
142. No "expand all"/"collapse all" for long histories, only per-row toggles.
