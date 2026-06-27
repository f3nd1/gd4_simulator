# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start Vite dev server on 0.0.0.0:5173
npm run build        # tsc -b && vite build
npm run test         # vitest run (all tests once)
npm run lint         # oxlint
npx tsc -b           # type-check only, no emit
```

Run a single test file: `npx vitest run src/lib/__tests__/scoring.test.ts`

## Architecture

**Stack**: React 19 + Zustand 5 + Vite + TypeScript + HashRouter (`#/` paths). No server — pure client SPA.

**Domain**: GD4 EduTrust audit simulator for UCC. Models a full audit cycle: setup → evidence collection → AI audit → scoring/banding → findings → management review → export.

### Key data flow

1. **GD4 requirements** live in `src/data/gd4Requirements.ts` — `GD4_REQUIREMENTS[]`, `GD4_CRITERIA[]`, `GENERAL_SUPPORTING_DOCS`. The 24 sub-criteria are the backbone every other module refers to by `itemNumber` (e.g. `"1.1"`).

2. **Scoring pipeline** (`src/lib/scoring.ts`):
   - `aiScore(ev)` → weighted APSR sum → `getBand(score)` → `Band` (1–5)
   - `buildScored()` computes all 24 item scores; `checklistBandOverrides` (from the Sub-Criterion Checklist) replace the evidence-matrix band when present
   - `needsJustification(aiScore, reviewer, gate)` — required for any gate override
   - Award thresholds (provisional/4-year/star) are tunable via `useScoringConfigStore`

3. **Checklist banding** (`src/lib/checklistBanding.ts`):
   - `computeBand(generic, specific, gate)` — maturity ceiling (G1-G4 lenses) × coverage cap × evidence weakest-link rule → `finalBand`
   - `lineSufficiency(line)` — Present / Weak / Missing based on attached evidence
   - `findingDimension(line)` — maps APSR weakness to `FindingDimension` ("Procedure" | "Evidence" | "Outcomes" | "Review" | "Unverified")
   - `buildDraftFinding(req, entry)` — generates a `DraftFindingInfo` from an unmet checklist entry

4. **Stores** (all Zustand, persisted to Supabase + localStorage fallback):
   - `useWorkspaceStore` — the main store: audit cycle, school context, evidence folders, `additionalInfo` link, audit run (`auditFolderContents`/`auditAllFolders`), busy state, snapshots. After each folder audit, calls `raiseAllUnmetFindings()` automatically.
   - `useChecklistModuleStore` — per-item checklist lines, evidence items, drafts; `raiseAllUnmetFindings()`, `confirmDraftFinding()`.
   - `useScoringConfigStore` — award thresholds, AI strictness setting.
   - `useAISettingsStore` — OpenAI key + model selection.
   - `useGoogleDriveStore` — Drive OAuth token (never persisted — excluded by `partialize`).
   - `useAgentMemoryStore` — AI agent memory stubs.
   - `useSaveStatusStore` — "saving…/saved" indicator.
   - `supabaseStorage.ts` — debounced write + `beforeunload` flush.

5. **AI layer** (`src/lib/ai/`):
   - `aiClient.ts` — `fetchWithTimeout()` (90s AbortController), `callAI()`, `summariseText()`.
   - `agentRuntime.ts` — `runLiveFolderAudit()`, `FOLDER_DOC_CAP = 48000` (shared with store).
   - `simulateAI.ts` — offline fallback keyword-matcher used when no OpenAI key.

6. **Evidence folders** (`src/pages/EvidenceFolder.tsx`):
   - Each sub-criterion has one Drive folder link. Convention: organise into two subfolders — `1. Policy & Procedure` and `2. Actual Evidence`. The audit classifies files by path prefix.
   - A single workspace-level `additionalInfo` folder provides school-wide context to all audits (read once, passed as labeled context; does not bypass evidence-sufficiency caps).
   - `cancelBusy()` store action releases a stranded audit.

### Types (`src/types/index.ts`)

Core types: `GD4Requirement`, `AuditCycle`, `Finding` (with `source?`, `dimension?`, `clause?`, `rootCause?`, `corrective?`, `preventive?`), `FindingDimension`, `SubCriterionChecklistEntry`, `SpecificChecklistLine`, `GenericChecklistLine`, `SubChecklistEvidenceItem`, `ApsrBreakdown`, `DraftFindingInfo`, `ChecklistOverride`.

### Tests (`src/lib/__tests__/`, `src/lib/ai/__tests__/`)

Vitest. 6 test files covering: `scoring.ts`, `checklistBanding.ts`, checklist→scoring integration, AFI overlay, APSR logic, finding analysis. Run `npm test` to execute all.

### Routing

HashRouter — all routes under `#/`. Route list in `src/App.tsx`; nav labels/hints in `src/nav.ts`.

### Persistence & security

- Supabase URL + anon key come from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`.env.local`, never committed).
- No service-role key anywhere in the client bundle.
- Drive OAuth token excluded from Zustand `partialize` — never written to storage.
- Writes are debounced ~600ms; `beforeunload` flushes the pending write.

### Dev server (Codespaces)

Port 5173 forwarded with `"protocol": "http"` in `.devcontainer/devcontainer.json`. If the browser tries to download instead of render, confirm the port is set to HTTP (not HTTPS) in the Ports tab and open via the globe icon.
