# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

GD4 EduTrust audit simulator for UCC (United Ceres College, Singapore) — a pure client-side SPA (no server) that models a full internal audit cycle: setup → evidence collection (Google Drive) → AI audit → scoring/banding → findings → management review → export. The user is non-technical staff running real audit prep on real documents; correctness and honest uncertainty matter more than polish. Internal simulation only — never present output as an official SSG result.

**Stack**: React 19 + Zustand 5 + Vite (rolldown) + TypeScript + HashRouter (`#/` paths). Persistence: Supabase (synced) + localStorage fallback. AI: OpenAI via user-supplied key.

## Commands

```bash
npm run dev          # Vite dev server on 0.0.0.0:5173
npm run build        # tsc -b && vite build
npm run test         # vitest run (all tests once)
npm run lint         # oxlint
npx tsc -b           # type-check only, no emit
npm run validate:gd4 # GD4 data-integrity tests (counts, flatAuditPoints consistency)
```

Run a single test file: `npx vitest run src/lib/__tests__/scoring.test.ts`

Run a one-off script against src/ TypeScript (e.g. to probe a pure function with real data): write a `.mjs` importing by absolute path, then `npx vite-node <file>`. (`vite-node -e` does not exist.)

## Git workflow

All work happens directly on `main`: commit there and push with `git push -u origin main`; the user does `git pull` on `main` to pick up changes. The user has given standing permission to push to `main` (2026-07-03) — no per-push confirmation needed. After every push, verify it landed: `git rev-parse HEAD` must equal `git rev-parse origin/main`. Old `claude/*` branches are retired; do not commit to them even if a task template names one — if a task designates a different branch, confirm with the user first (they have always chosen `main`).

Write commit messages with a full body: what changed, why, which mechanism was reused, and what was verified. The Change Log page renders every commit's subject + body + file list to the user, so the body is user-facing documentation, not just history.

## Deployment (production)

- Live at `https://apps.unitedceres.edu.sg/gd4_simulator/` — nginx `alias` to `/var/www/gd4_simulator/dist/` on the user's server, a subpath deployment.
- To update, the user runs on the server: `cd /var/www/gd4_simulator && git pull && npm run build`. **Never add a `--base` flag** — `vite.config.ts` sets `base: './'` precisely so one build works at any subpath; overriding it re-breaks the asset-404 bug it fixed.
- After deploying, the browser may cache the old bundle: tell the user to hard-refresh (Ctrl/Cmd+Shift+R) or use incognito. The Change Log page shows the deployed commit hash (`__GIT_INFO__`, baked at build time) — use it to confirm which commit is actually live before debugging "the fix doesn't work".
- Deploying new code does NOT recompute old audit results — the user must re-run the audit to see new engine behavior.

## Architecture

### Key data

- **GD4 requirements** live in `src/data/gd4Requirements.ts` — `GD4_CRITERIA` (7), `GD4_SUB_CRITERIA` (29), `GD4_REQUIREMENTS` (31 items), `GENERAL_SUPPORTING_DOCS`. Sub-criteria are the backbone every module refers to by id (e.g. `"6.2"`); items by `id` (e.g. `"6.2.1"`). Each `GD4Requirement` carries `flatAuditPoints: FlatAuditPoint[]` derived from the official text: Describe/Show bullets with a ": sub1; sub2; sub3" list pattern are split into lettered children (refs like `"6.2.1.DS1.a"`); simple bullets produce one point each. Run `npm run validate:gd4` after touching this file.
- **Refs are joined everywhere** through `src/lib/gd4Refs.ts` — `normalizeAuditRef()` must be applied to BOTH sides of any ref comparison; `findingDedupeKey()`/`findingKeyOf()` define finding identity; `carryoverKey()` (`src/lib/cycleCarryover.ts`) defines "the same recurring gap" across cycles. Never invent a second matching scheme — reuse these.

### Scoring pipeline (`src/lib/scoring.ts`)

- `aiScore(ev)` → weighted APSR sum → `getBand(score)` → `Band` (1–5)
- `buildScored()` computes per-item scores; `checklistBandOverrides` (from the Sub-Criterion Checklist) replace the evidence-matrix band when present
- `needsJustification(aiScore, reviewer, gate)` — required for any gate override
- Award thresholds (provisional/4-year/star) are tunable via `useScoringConfigStore`

### Checklist banding (`src/lib/checklistBanding.ts`)

- `computeBand(generic, specific, gate)` — maturity ceiling (G1–G4 lenses) × coverage cap × evidence weakest-link rule → `finalBand`
- `lineSufficiency(line)` — Present / Weak / Missing; `findingDimension(line)` — maps APSR weakness to `FindingDimension` ("Procedure" | "Evidence" | "Outcomes" | "Review" | "Unverified")
- `buildDraftFinding(req, entry)` — generates a `DraftFindingInfo` from an unmet checklist entry; `issue` quotes GD4 requirement text verbatim

### Two audit paths — know which one you're on

- **Option B (staged / full audit)** — `auditFolderStaged` / `auditFolderContents` in `useWorkspaceStore.ts`: three sequential AI passes — Policy (Approach), Evidence (Processes + Outcomes), Outcome/Review (Review) — merged by deterministic `buildStagedApsr()`. Progress stages: `listing → reading → policy_audit → evidence_audit → outcome_review → apsr_build → saving → findings_summary → complete`.
- **Option A (PPD-first)** — `runPPDReview` + `runEvidenceAssessment` in `useWorkspaceStore.ts`, UI in `src/pages/PPDReview.tsx` (3 tabs: PPD Review · Pre-check · Evidence), also embedded as a modal in EvidenceFolder. The PPD pass reads ONLY the policy bucket and verdicts each requirement line (Adequate/Partial/Not documented, per-sub-clause); the Evidence pass reuses those verdicts, reads the evidence bucket fresh, and produces combined Met/Partial/Not met with promise checks. `compileEvidenceFindings` raises findings. Results live in `ppdReviewResults` / `evidenceAssessments` keyed by sub-criterion; run ids look like `EV-6.2-XXXX`; `/evidence-folder?run=<runId>` deep-links to the result modal.
- Both paths must stay at capability parity for **file reading**: the three-tier read (typed text + Office embedded-image vision → scanned-PDF page-image vision → standalone-image vision) exists as the shared `readDriveFileWithVision()` helper (used by Option A) and as inline copies in the full/staged paths. If you improve reading, improve all paths or extend the shared helper — a path that silently reads less produces false "no evidence found" gaps (this was a real bug).

### Bucket routing (policy vs evidence)

`classifyFileBucket(path)` in `src/lib/driveGuard.ts`: tests only the FIRST path segment against `/polic|procedure/`; everything else defaults to evidence. Convention: subfolders `1. Policy & Procedure` and `2. Actual Evidence`. A dedicated `folderLink` (evidence) or `policyLink` (policy) makes ALL listed files that bucket; only a shared single link triggers subfolder classification. Mis-bucketing is one-directional (evidence under a policy-named top folder vanishes from the evidence read) — the pre-flight probe warns about it, the run itself does not. A single workspace-level `additionalInfo` folder provides school-wide context to all audits (text-only, capped; never bypasses evidence-sufficiency rules). `cancelBusy()` releases a stranded audit.

### Stores (Zustand). Persist key ≠ version number — see table

All persisted via `workspaceStorage` (Supabase-synced adapter in `src/store/supabaseStorage.ts`, localStorage fallback + offline cache; writes debounced ~600ms, `beforeunload` flush) unless noted.

| Store | Purpose | Persist key | `version` |
|---|---|---|---|
| `useWorkspaceStore` | Main store: cycle, auditors, folders, audit runs (`auditRunHistory`), Option A results, findings (`customFindings`), closures, calibration memories, human-decision log, `fileTextCache`, snapshots | `ucc-gd4-workspace:v3` | **6** |
| `useChecklistModuleStore` | Per-item checklist lines/evidence/drafts; `raiseAllUnmetFindings()`, `confirmDraftFinding()`, `replaceAuditEvidence()` | `ucc-gd4-checklist:v2` | 1 |
| `useAISettingsStore` | OpenAI key + model selection (the key DOES sync via Supabase) | `ucc-gd4-ai-settings:v1` | 1 |
| `useBenchmarkAfiStore` | Full benchmark AFI list (67 seeded + uploads); scoped `resetToDefaults` preserves `CUST-*` uploads | `ucc-gd4-custom-benchmark:v1` | 1 |
| `useCalibrationStore` | Benchmark match assessments (human-override-wins) | `ucc-gd4-calibration:v1` | 1 |
| `usePreCheckChecklistStore` | Live editable pre-check checklist (seeded from `DEFAULT_CHECKLISTS`); Approve/Revert is the only way `verified` changes | `ucc-gd4-precheck-checklist:v1` | 0 |
| `useFindingDraftStore` | Grouped finding drafts; `generateFindingsFromChecklist()`, `confirmGroupedDraft()` | `ucc-gd4-finding-drafts:v1` | 0 |
| `useRuleTuningStore` | Rule injections; champion-vs-active gate (`championInjection()`) | `ucc-gd4-rule-tuning:v1` | 0 |
| `usePromptReviewStore` | Prompt Review prompts + connected review records | `ucc-gd4-prompt-review:v1` | 0 |
| `useScoringConfigStore` | Award thresholds, AI strictness | `ucc-gd4-scoring-config:v1` | 0 |
| `useGoogleDriveStore` | Drive OAuth token — **token excluded by `partialize`, never persisted** | `ucc-gd4-google-drive:v1` | 0 |
| `useProfileOfPeiStore` / `useSupabaseSettingsStore` / `useChangeLogStore` / `useGuidanceStore` | PEI profile / Supabase creds / change-log cache / guidance dismissals | own `ucc-gd4-*` keys | 0–1 |
| `useAIDebugLogStore` | System prompt per `buildSystemPrompt()` call — in-memory only, 100-cap, cleared on reload | — | — |
| `useSaveStatusStore` | "saving…/saved" indicator — not persisted | — | — |

Hard rules: renaming a store NEVER changes its persist key (existing user data depends on it). Migrations use zustand `persist` `version`+`migrate` (proven in `useChecklistModuleStore`/`useAISettingsStore`/`useWorkspaceStore`) — never a hand-rolled flag. `useWorkspaceStore.partialize` empties `fileTextCache`/`changeLog` and caps stored prompts — don't add large blobs to persisted state without capping.

### AI layer (`src/lib/ai/`)

- `aiClient.ts` — `fetchWithTimeout()` (90s AbortController), `chatComplete(messages, settings, { temperature?, onUsage?, timeoutMs?, signal? })`, `describeImage()`, `effectiveSettings(base, { purpose: "analysis"|"utility"|"vision", context? })`, `aiOfflineReason(settings)`. Never fabricate output when AI is unavailable — gate on `aiOfflineReason` and say so.
- `agentRuntime.ts` — `runLiveFolderAudit()`, `FOLDER_DOC_CAP = 60_000` (staged/full paths only — Option A has no doc cap; it slides 55k-char windows with 5k overlap, 8 lines per batch, best-verdict merge across windows, F1 grounding tie-break on verdict ties). Exports the staged passes (`runStagedPolicyAudit` / `runStagedEvidenceAudit` / `runStagedOutcomeReviewAudit` + `buildStagedApsr`) and Option A (`runPPDRequirementsReview` / `runEvidenceAssessment`). Citation-gap downgrade: any positive verdict with no cited chunk is code-level downgraded, never trusted.
- `simulateAI.ts` — offline keyword-matcher fallback (Option B only; Option A requires live AI).
- `findingWriter.ts` — `runLiveGroupedFindingWriter()` (AI) and `simulateGroupedFindingWriter()` (offline); system prompt requires GD4 requirement text quoted **exactly word-for-word** in `criteria`. `findingGrouper.ts` groups failing checklist lines by GD4 source ref + APSR dimension.
- Chunks: `EvidenceChunk` with sequential ids `C001…`; Option A splits files at `MAX_PART_CHARS = 24_000` per part.

### Skills (`src/data/skills/`, injection map in `src/lib/ai/skills.ts`)

- BASE (every AI call): `external-auditor.md`, `evidence-standards.md`, `apsr-rubric.md`, `sg-pei-context.md` (SSG hard requirements: FPS, contracts, refund table).
- Per-module via `MODULE_SKILLS`; per-skill cap `SKILL_CAP = 7000` chars (`regulatoryReferencesSkill` uncapped to preserve full clause tables); file-type bonus skills for scanned docs / spreadsheets.
- Criterion-specific (7): `criterion-{1..7}-*.md`, injected uncapped via `domainExpertiseFor(subCriterionId)` (`domainExpertise.ts` maps any id → skill + label).
- Calibration memories inject as a "LEARNED CORRECTIONS" block via `buildSystemPrompt(..., memories, ...)`; rule-tuning champions inject via `ruleInjection`.

### Feedback → learning loop (must stay closed on BOTH ends)

- **Write side**: `ThumbsButtons` + `FeedbackModal` (both in `src/components/ui/`) on AI outputs; a 👎 with a correction calls `addCalibrationMemory({ module, ... })` and `logHumanDecision(...)`. Line-level verdicts use `module: "Line Status"`. Reuse these two components for any new feedback surface — do not invent a new pattern.
- **Read side**: every AI engine call that assesses lines must select active memories (`calibrationMemories.filter(m => m.status === "active" && m.module === "Line Status")`, sort by `effectivenessScore`, slice 5), pass them as `memories:`, and call `incrementMemoryUsage`. The staged path and Option A both do this — a new engine call that omits it silently breaks learning (this was a real bug on Option A).

### Pre-check checklist system

- Definitions: `src/lib/preAnalysisChecklist.ts` (`ChecklistItemDef`, `DEFAULT_CHECKLISTS` seed, `UNIVERSAL_CHECKLIST` — the date-discrepancy scan that runs for every sub-criterion). Live editable copy: `usePreCheckChecklistStore`; CRUD on the Setup page (`PreCheckChecklistSetup.tsx`); the run-flow Pre-check step reads the same store — no parallel config.
- **Draft/verified is the human gate**: new/edited/promoted items ALWAYS land `verified: false` (unmissable "Draft" badge everywhere); only the Setup page's explicit Approve flips it. `updateItem`'s type deliberately omits `verified`.
- Auto items reference the fixed `DETECTION_REGISTRY` by `detectionKey` (functions aren't serialisable); detection returns honest `"unknown"` ("check manually") rather than asserting false positives.
- Flags are ADVISORY only — `computeFlaggedPreCheckItems` is the single definition of "flagged" (an auto flag OR a ticked manual item); flags ride into AI prompts as context, never gate or override a verdict; nothing in Pre-check ever blocks "Continue".
- Recurring-finding promotion (`src/lib/recurringFindings.ts`): detects a gap recurring across ≥2 distinct audit identities (reuses `carryoverKey`; exact-normalized-text fallback for ref-less findings — deliberately NO fuzzy matching), surfaces candidates on the Setup page; a human clicks Promote → the same `addItem` → draft, citing real finding IDs/dates. Never auto-add.

### Calibration / measurement (`AICalibration.tsx`, `CalibrationLab.tsx`)

Benchmark tab compares app findings against `useBenchmarkAfiStore` ground truth (67 real SSG findings + user uploads via `UploadBenchmarkPanel` → AI extraction → review-before-commit). `useCalibrationStore` match assessments are human-override-wins: `setAiMatch` refuses to overwrite a human `setMatch`. Rule tuning is champion-vs-active: drafts never go live without an explicit `setChampion`. Prompt Review (`PromptReview.tsx`) applies the same gates to user-authored prompts (rate → correct → AI-revise → explicit "Make live").

### Findings

`customFindings` in `useWorkspaceStore` (+ 22 demo seeds from `data/findings.ts` gated by `seedFindingsLoaded`); always read the combined list via the `useAllFindings()` hook. Cross-cycle PDCA: `createNewCycle` archives to `priorCycleFindings`; `applyCarryover` marks `repeatFinding` and escalates a repeat Minor NC → Major. `removeCustomFinding` sweeps `savedFindingId` back-pointers in every store — mirror that sweep if you add a new back-pointer.

## Types (`src/types/index.ts`)

Key exact-value constraints (TypeScript union types — violations cause TS errors):
- `ApsrBreakdown.approach.status`: `"Meeting" | "Beginning" | "Not evident"`
- `ApsrBreakdown.processes.status`: `"Deployed" | "Weak" | "Not evident"`
- `ApsrBreakdown.systemsOutcomes.status`: `"Evident" | "Limited" | "Not evident"`
- `ApsrBreakdown.review.status`: `"Evident" | "Not evident"`
- `EvidenceVerdict`: `"Met" | "Partial" | "Not met" | "Not assessed"` — "Not assessed" is neutral (excluded from the findings compile, never returned by the AI)

`SubChecklistEvidenceItem.title` is the evidence-description field (not `description`/`name`). `AuditFileRecord.auditStatus`: `"pending" | "audited" | "cited" | "not_used"`; `readStatus`: `"found" | "read" | "skipped" | "failed"`; `readMethod`: `"text" | "vision"` — the File Ledger built from these is the authoritative record of what a run actually read.

## How I want you to work (hard rules)

1. **Ground everything.** Before asserting how code behaves, read it. Before saying data exists, query it (`vite-node` a probe script if needed). Never present speculation as fact; label runtime-only facts (browser localStorage/Supabase state) as unverifiable from the repo and name the exact surface (File Ledger, AI Debug Log, AI Memories…) where the user can check them.
2. **Reuse, don't duplicate.** Before building, grep for the existing mechanism (ref matching: `gd4Refs`/`carryoverKey`; feedback: `ThumbsButtons`+`FeedbackModal`; gating: champion-vs-active, draft/verified, human-override-wins; output rendering: `AiOutputView`). Extract a shared helper rather than writing a third copy. If reuse would require restructuring the original, ask before duplicating.
3. **Human gate on AI writes.** The AI recommends; a human commits. Nothing auto-promotes, auto-approves, auto-verifies, or silently adds items. Every AI-derived artifact cites its real sources (finding IDs, chunk IDs, file names, dates) — no invented grounding.
4. **Prefer conservative matching.** When grouping/deduping text, exact-normalized match beats fuzzy similarity: a false "already covered/duplicate" that hides a real gap is worse than a missed match.
5. **Keep both audit paths at parity** for reading/learning capability, and never change verdict/scoring logic as a side effect of an infrastructure fix.
6. **Comments state constraints the code can't show** (why a cap exists, what a guard prevents, which real bug motivated it) — match the existing density; no "what the next line does" noise.
7. **When a task is investigate/report, do not fix.** Report a verdict per issue (genuine bug / correct-but-confusing / feature missing) with file:line evidence, and wait for the user's decision.

## Definition of done — run before calling anything finished

1. `npx tsc -b` — zero errors.
2. `npm run test` — all pass (692 tests / 63 files as of `fb3eaca`; your change should only ever raise the count).
3. `npm run lint` — no NEW warnings. Pre-existing (ignore, don't drive-by fix): jsx-key in `ProfileOfPei.tsx`, no-unused-expressions in `EvidenceFolder.tsx`/`PPDReview.tsx`, exhaustive-deps in `SubCriterionChecklist.tsx`, unused `GD4_SUB_CRITERIA` import in `useWorkspaceStore.ts`.
4. `npm run build` — clean (the chunk-size warning is pre-existing).
5. **Live verification in the browser** for any UI/flow change (cookbook below). State honestly what you could and could not exercise (real Drive/OpenAI don't exist in the sandbox) and give the user the exact click-path to confirm the rest themselves.
6. New pure logic gets a unit test in the adjacent `__tests__/` dir.
7. Commit with a full body; push to `main`; verify `origin/main` equals local HEAD.

## Live-verification cookbook (Playwright)

- Only `playwright-core` is installed. Import: `import pw from '<repo>/node_modules/playwright-core/index.js'; const { chromium } = pw;` and launch with `executablePath: '/opt/pw-browsers/chromium'`.
- Start the dev server in the background; ignore WebSocket/HMR console noise. `pkill -f vite` exits 144 (kills the shell) — run it as its own command and ignore the exit code.
- **Seeding state**: write localStorage under the EXACT persist key from the stores table, as `{ state: {...}, version: N }` where N is the table's `version` column — the `:vN` suffix in the key name is NOT the version number (`ucc-gd4-workspace:v3` needs `version: 6`; a wrong version silently discards your seed via `migrate`). After `localStorage.setItem`, a hash-only `page.goto` does NOT re-hydrate — you must `page.reload()`.
- Partial `ucc-gd4-workspace:v3` seeds can crash render (cross-field derivations expect coherent state, e.g. `Cannot read properties of undefined (reading '1.1.1')`). Seed minimal-but-coherent fields, and prefer proving pure logic via `vite-node` + unit tests, using the browser only for wiring/visibility checks.
- No OpenAI key in the sandbox: mock `https://api.openai.com/v1/chat/completions` with `page.route`, and seed `ucc-gd4-ai-settings:v1` (`version: 1`, `enabled: true`, any `apiKey`) so `aiOfflineReason` is null.
- Prefer role/heading-scoped locators — a bare `text=` selector often matches both the nav link and the page heading (strict-mode violation).

## Tests

Vitest, colocated in `__tests__/` dirs. Test files must import `classifyPdfTextQuality` and `extractSpreadsheetText` from `src/lib/drive/textUtils` (not `driveClient`) — `driveClient` instantiates a pdfjs Worker at module load time which is unavailable in Node/Vitest. Store tests reset state in `afterEach` via `useXStore.setState(...)`; the "Local save failed … localStorage may be full" stderr noise in store tests is benign.

## Routing

HashRouter — all routes under `#/`. Route list in `src/App.tsx`; nav labels/hints in `src/nav.ts` (the Help page derives its structure from `NAV`, so nav changes propagate automatically). Diagnostic pages in `DEVELOPER_TOOL_PATHS` are hidden when the Settings developer-tools toggle is off (route guard `DevToolsRoute`). Adding a page = component + route in App.tsx + entry in NAV (+ `DEVELOPER_TOOL_PATHS` if diagnostic). Filter pre-selection via `?item=<gd4ItemId>` on `/sub-checklist` and `/findings` (`/findings` also accepts `?subCrit=`); `/evidence-folder?run=<runId>` deep-links into the matching run's result modal.

## Persistence & security

- Supabase URL + publishable key from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local`, never committed) or entered in-app on Settings.
- Drive OAuth token excluded from Zustand `partialize` — never written to storage or logs. Mask NRIC/FIN values in any UI (`maskNric`).
- Known stale message: `aiClient.ts` (~line 61) claims the OpenAI key "never syncs between devices" — it actually syncs via Supabase with the rest of `ucc-gd4-ai-settings:v1`. Don't propagate that claim.

## Communicating with the user

The user is non-technical (they ask for "TLDR in non-technical" terms — give it to them). For anything they must do themselves — deploy, verify a fix, click through a flow — give a numbered, plain-English, click-by-click checklist with an explicit "✅ Pass if:" per step. Report failures and unverifiable steps honestly; never claim a fix works because the code looks right. When they paste screenshots/output showing old behavior, first check they're on the latest deployed commit (Change Log hash) AND looking at a FRESH run — a stale build and stale results are the two most common false alarms.

## Dev server (Codespaces)

Port 5173 forwarded with `"protocol": "http"` in `.devcontainer/devcontainer.json`. If the browser tries to download instead of render, confirm the port is HTTP (not HTTPS) in the Ports tab and open via the globe icon. HMR `clientPort: 443` in `vite.config.ts` is for the Codespaces proxy; in plain local dev it just means full-page refreshes instead of hot reload.
