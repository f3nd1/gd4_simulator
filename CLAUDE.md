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

Validate GD4 data integrity (35 items, flatAuditPoints consistency): `npm run validate:gd4`

## Architecture

**Stack**: React 19 + Zustand 5 + Vite + TypeScript + HashRouter (`#/` paths). No server — pure client SPA.

**Domain**: GD4 EduTrust audit simulator for UCC. Models a full audit cycle: setup → evidence collection → AI audit → scoring/banding → findings → management review → export.

### Key data flow

1. **GD4 requirements** live in `src/data/gd4Requirements.ts` — `GD4_REQUIREMENTS[]`, `GD4_CRITERIA[]`, `GENERAL_SUPPORTING_DOCS`. The 24 sub-criteria are the backbone every other module refers to by `itemNumber` (e.g. `"1.1"`). Each `GD4Requirement` now carries a `flatAuditPoints: FlatAuditPoint[]` array automatically derived from the official text: Describe/Show bullets that contain a ": sub1; sub2; sub3" list pattern are split into lettered children (refs like `"6.2.1.DS1.a"`); simple bullets produce one point each (e.g. `"1.1.1.DS2"`). Run `npm run validate:gd4` to verify data integrity (21 checks).

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
   - `agentRuntime.ts` — `runLiveFolderAudit()`, `FOLDER_DOC_CAP = 48000` (shared with store). Imports 8 skill files (see below) and passes them to the system prompt via `skills()`. Each APSR dimension in the JSON response now includes `sourceChunkIds: string[]`. `runCitationVerifier()` is a second-pass Strict-mode function that re-checks whether the cited chunk IDs actually support the claimed verdict.
   - `simulateAI.ts` — offline fallback keyword-matcher used when no OpenAI key. `FolderAuditLineVerdict` includes an optional `overallReason` field.
   - Skills (`src/data/skills/`): 8 skill files injected into the system prompt via `skills(...)` (capped to 3000 chars total):
     - `apsr-rubric.md` — APSR rubric definitions
     - `evidence-standards.md` — evidence quality standards
     - `external-auditor.md` — auditor persona
     - `finding-specificity.md` — AFI writing guidelines
     - `evidence-ledger.md` — file lifecycle states (found→reading→read→cited/not_used/skipped/failed)
     - `source-citation-verification.md` — per-dimension citation rules and downgrade logic
     - `spreadsheet-evidence.md` — Excel/CSV evidence assessment (row coverage, structure)
     - `scanned-document-evidence.md` — scanned PDF detection and audit cues
     - `evidence-retrieval.md` — per-dimension chunk retrieval strategy
   - **Criterion-specific domain expertise** (`src/data/skills/criterion-{1..7}-*.md` + `domainExpertise.ts`): seven specialist auditor skill files, one per GD4 criterion (C1 corporate governance/finance, C2 HR/marketing/data, C3 agent due-diligence, C4 student-protection/fee-safeguarding, C5 pedagogy/assessment QA, C6 QMS/continual-improvement, C7 performance measurement/data-integrity). `domainExpertise.ts` exposes `criterionIdOf()`, `domainExpertiseFor()` and `domainExpertiseLabelFor()` (maps any item/sub-criterion/criterion id → its criterion number → skill/label). The folder audit (`runLiveFolderAuditBatch`, via `FolderAuditOpts.criterionId`) and the grouped finding writer inject the matching skill as a dedicated prompt block (not capped by `SKILL_CAP`) so the audit and findings reason like a domain specialist. The active "Specialist lens" label is shown in the live audit progress and the audit-run modal.

6. **Evidence folders** (`src/pages/EvidenceFolder.tsx`):
   - Each sub-criterion has one Drive folder link. Convention: organise into two subfolders — `1. Policy & Procedure` and `2. Actual Evidence`. The audit classifies files by path prefix.
   - A single workspace-level `additionalInfo` folder provides school-wide context to all audits (read once, passed as labeled context; does not bypass evidence-sufficiency caps).
   - `cancelBusy()` store action releases a stranded audit.

### Types (`src/types/index.ts`)

Core types: `GD4Requirement`, `AuditCycle`, `Finding` (with `source?`, `dimension?`, `clause?`, `rootCause?`, `corrective?`, `preventive?`), `FindingDimension`, `SubCriterionChecklistEntry`, `SpecificChecklistLine`, `GenericChecklistLine`, `SubChecklistEvidenceItem`, `ApsrBreakdown`, `DraftFindingInfo`, `ChecklistOverride`.

`AuditFileRecord` extended fields: `suspectedScannedPdf?`, `extractedTextQuality?` (`"none"|"low"|"medium"|"high"`), `summaryCharCount?`, `skipReason?`, `chunkIds?`, `citedByLineIds?`, `usedForDimensions?`. `auditStatus` now includes `"cited"` and `"not_used"` in addition to `"pending"` and `"audited"`.

`ApsrBreakdown` dimensions each carry `sourceChunkIds?: string[]` — the chunk IDs the AI cited as evidence for that dimension's verdict.

`EvidenceChunk` — represents a single piece of evidence passed to the AI: `{ chunkId, filePath, fileName, bucket, fileKind, sheetName?, rowRange?, text, charCount, evidenceType }`. Chunks are assigned sequential IDs (`C001`, `C002`, …) before the AI call; after verdicts return, `sourceChunkIds` are mapped back to `AuditFileRecord` entries to mark files as `cited` or `not_used`.

Citation-gap downgrade (code-level, no AI call): any APSR dimension that returns a positive status (`"Meeting"` or `"Beginning"`) with no `sourceChunkIds` (absent or empty array) is downgraded to `"Not evident"` with a note appended.

### Tests (`src/lib/__tests__/`, `src/lib/ai/__tests__/`)

Vitest. 8 test files covering: `scoring.ts`, `checklistBanding.ts`, checklist→scoring integration, AFI overlay, APSR logic, finding analysis, evidence ledger (PDF quality classification, chunk ID format, citation downgrade logic, spreadsheet extraction, skill file keyword verification), and Excel extraction edge cases (multi-sheet, 200-row cap, blank row filtering). Run `npm test` to execute all.

Note: test files must import `classifyPdfTextQuality` and `extractSpreadsheetText` from `src/lib/drive/textUtils` (not `driveClient`) — `driveClient` instantiates a pdfjs Worker at module load time, which is unavailable in Node/Vitest.

### Routing

HashRouter — all routes under `#/`. Route list in `src/App.tsx`; nav labels/hints in `src/nav.ts`.

### Persistence & security

- Supabase URL + publishable key come from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local`, never committed).
- No service-role key anywhere in the client bundle.
- Drive OAuth token excluded from Zustand `partialize` — never written to storage.
- Writes are debounced ~600ms; `beforeunload` flushes the pending write.

### Dev server (Codespaces)

Port 5173 forwarded with `"protocol": "http"` in `.devcontainer/devcontainer.json`. If the browser tries to download instead of render, confirm the port is set to HTTP (not HTTPS) in the Ports tab and open via the globe icon.
