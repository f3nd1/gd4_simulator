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

## Git workflow

Development branch: `claude/prototype-development-y5nqqi`. Commit directly there; the user does `git pull` to pick up changes. Never push to `main` without explicit instruction.

## Architecture

**Stack**: React 19 + Zustand 5 + Vite + TypeScript + HashRouter (`#/` paths). No server — pure client SPA.

**Domain**: GD4 EduTrust audit simulator for UCC (United Ceres College, Singapore). Models a full audit cycle: setup → evidence collection → AI audit → scoring/banding → findings → management review → export.

### Key data flow

1. **GD4 requirements** live in `src/data/gd4Requirements.ts` — `GD4_REQUIREMENTS[]`, `GD4_CRITERIA[]`, `GENERAL_SUPPORTING_DOCS`. The 24 sub-criteria are the backbone every other module refers to by `itemNumber` (e.g. `"1.1"`). Each `GD4Requirement` carries `flatAuditPoints: FlatAuditPoint[]` derived from the official text: Describe/Show bullets with a ": sub1; sub2; sub3" list pattern are split into lettered children (refs like `"6.2.1.DS1.a"`); simple bullets produce one point each. Run `npm run validate:gd4` to verify data integrity.

2. **Scoring pipeline** (`src/lib/scoring.ts`):
   - `aiScore(ev)` → weighted APSR sum → `getBand(score)` → `Band` (1–5)
   - `buildScored()` computes all 24 item scores; `checklistBandOverrides` (from the Sub-Criterion Checklist) replace the evidence-matrix band when present
   - `needsJustification(aiScore, reviewer, gate)` — required for any gate override
   - Award thresholds (provisional/4-year/star) are tunable via `useScoringConfigStore`

3. **Checklist banding** (`src/lib/checklistBanding.ts`):
   - `computeBand(generic, specific, gate)` — maturity ceiling (G1-G4 lenses) × coverage cap × evidence weakest-link rule → `finalBand`
   - `lineSufficiency(line)` — Present / Weak / Missing based on attached evidence
   - `findingDimension(line)` — maps APSR weakness to `FindingDimension` ("Procedure" | "Evidence" | "Outcomes" | "Review" | "Unverified")
   - `buildDraftFinding(req, entry)` — generates a `DraftFindingInfo` from an unmet checklist entry; `issue` field quotes GD4 requirement text verbatim

4. **Stores** (all Zustand, persisted to Supabase + localStorage fallback):
   - `useWorkspaceStore` — main store: audit cycle, school context, evidence folders, `additionalInfo` link, audit run (`auditFolderContents` / `auditFolderStaged` / `auditAllFolders`), busy state, snapshots, `auditRunHistory`. After each folder audit calls `raiseAllUnmetFindings()` automatically.
   - `useChecklistModuleStore` — per-item checklist lines, evidence items, drafts; `raiseAllUnmetFindings()`, `confirmDraftFinding()`, `setSpecificStatus()`, `replaceAuditEvidence()`.
   - `useFindingDraftStore` — grouped finding drafts by sub-criterion; `generateFindingsFromChecklist()`, `confirmGroupedDraft()`, `discardDraft()`, `updateDraftField()`.
   - `useScoringConfigStore` — award thresholds, AI strictness setting.
   - `useAISettingsStore` — OpenAI key + model selection.
   - `useGoogleDriveStore` — Drive OAuth token (never persisted — excluded by `partialize`).
   - `useSaveStatusStore` — "saving…/saved" indicator.
   - `supabaseStorage.ts` — debounced write + `beforeunload` flush.

5. **AI layer** (`src/lib/ai/`):
   - `aiClient.ts` — `fetchWithTimeout()` (90s AbortController), `callAI()`, `summariseText()`.
   - `agentRuntime.ts` — `runLiveFolderAudit()`, `FOLDER_DOC_CAP = 48000`. Also exports `runStagedPolicyAudit`, `runStagedEvidenceAudit`, `runStagedOutcomeReviewAudit`, `buildStagedApsr` for the three-pass staged audit. `runCitationVerifier()` is the second-pass Strict-mode function. Skills injected via `skills()` (capped to `SKILL_CAP = 3000` chars); `skillsFull()` in `findingWriter.ts` is uncapped (used for `regulatoryReferencesSkill` to preserve full clause tables).
   - `simulateAI.ts` — offline fallback keyword-matcher. `FolderAuditLineVerdict` includes an optional `overallReason` field. Also exports `simulateStagedPolicyAudit`, `simulateStagedEvidenceAudit`, `simulateStagedOutcomeReview`.
   - `findingWriter.ts` — `runLiveGroupedFindingWriter()` (AI) and `simulateGroupedFindingWriter()` (offline). The system prompt instructs the AI to quote GD4 requirement text **exactly word-for-word** in the `criteria` field — no paraphrasing. Both inject domain-specialist skill via `domainExpertiseFor()`.
   - `findingGrouper.ts` — groups failing checklist lines by GD4 source ref + APSR dimension into `ChecklistLineGroup[]`.

6. **Skills** (`src/data/skills/`): injected into audit system prompts:
   - Generic skills (15): `apsr-rubric.md`, `evidence-standards.md`, `external-auditor.md`, `finding-specificity.md`, `finding-writing.md`, `evidence-ledger.md`, `source-citation-verification.md`, `spreadsheet-evidence.md`, `scanned-document-evidence.md`, `evidence-retrieval.md`, `regulatory-references.md`, `root-cause-methodology.md`, `interview-and-fieldwork.md`, `sample-testing-methodology.md`, `evidence-timeliness.md`, `benchmarking-and-good-practice.md`
   - Criterion-specific (7): `criterion-{1..7}-*.md` — specialist auditor lenses per criterion (C1 governance/finance, C2 HR/data, C3 agent due-diligence, C4 student-protection, C5 academic QA, C6 QMS, C7 outcomes/data-integrity). Injected as a dedicated block (not capped) via `domainExpertiseFor(subCriterionId)`.
   - `domainExpertise.ts` — `criterionIdOf()`, `domainExpertiseFor()`, `domainExpertiseLabelFor()` (maps any item/sub-criterion/criterion id → skill + display label).

7. **Staged audit** (`auditFolderStaged` in `useWorkspaceStore.ts`): three sequential AI passes — Policy (Approach), Evidence (Processes + Outcomes), Outcome/Review (Review) — then a deterministic `buildStagedApsr()` merger. Progress stages: `listing → reading → policy_audit → evidence_audit → outcome_review → apsr_build → saving → findings_summary → complete`. The `lastAuditSummary` written to the folder includes: specialist lens, band per GD4 item, per-line APSR gap notes, file names read, method description.

8. **Evidence folders** (`src/pages/EvidenceFolder.tsx`):
   - Each sub-criterion has one Drive folder link. Convention: two subfolders — `1. Policy & Procedure` and `2. Actual Evidence`. Audit classifies files by path prefix; `scope` param (`"policy"` | `"evidence"` | `"all"`) controls which bucket is gathered.
   - A single workspace-level `additionalInfo` folder provides school-wide context to all audits (does not bypass evidence-sufficiency caps).
   - Audit completion panel stats (lines assessed, potential issues, files) link to Sub-Criterion Checklist and Findings register pre-filtered to that item.
   - `cancelBusy()` store action releases a stranded audit.

### Types (`src/types/index.ts`)

Key exact-value constraints (TypeScript union types — violations cause TS errors):
- `ApsrBreakdown.approach.status`: `"Meeting" | "Beginning" | "Not evident"`
- `ApsrBreakdown.processes.status`: `"Deployed" | "Weak" | "Not evident"`
- `ApsrBreakdown.systemsOutcomes.status`: `"Evident" | "Limited" | "Not evident"`
- `ApsrBreakdown.review.status`: `"Evident" | "Not evident"`

`Finding` fields: `source?`, `dimension?`, `clause?`, `rootCause?`, `corrective?`, `preventive?`, `createdAt?: string` (ISO string, set on creation), `linkedChecklistLineIds?`, `linkedSourceRefs?`, `linkedSourceTexts?`, `evidenceStatusSummary?`, `groupedFindingId?`.

`SubChecklistEvidenceItem.title` — the correct field name for evidence item descriptions (not `description` or `name`).

`AuditFileRecord.auditStatus` values: `"pending"`, `"audited"`, `"cited"`, `"not_used"`.

`EvidenceChunk` — `{ chunkId, filePath, fileName, bucket, fileKind, sheetName?, rowRange?, text, charCount, evidenceType }`. Chunk IDs are sequential (`C001`, `C002`, …). Citation-gap downgrade: any positive APSR dimension with no `sourceChunkIds` is code-level downgraded to `"Not evident"`.

### Tests (`src/lib/__tests__/`, `src/lib/ai/__tests__/`)

Vitest. Test files must import `classifyPdfTextQuality` and `extractSpreadsheetText` from `src/lib/drive/textUtils` (not `driveClient`) — `driveClient` instantiates a pdfjs Worker at module load time which is unavailable in Node/Vitest.

### Routing

HashRouter — all routes under `#/`. Route list in `src/App.tsx`; nav labels/hints in `src/nav.ts`. Filter pre-selection via `?item=<gd4ItemId>` query param on `/sub-checklist` and `/findings`.

### Persistence & security

- Supabase URL + publishable key from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local`, never committed).
- Drive OAuth token excluded from Zustand `partialize` — never written to storage.
- Writes debounced ~600ms; `beforeunload` flushes the pending write.

### Dev server (Codespaces)

Port 5173 forwarded with `"protocol": "http"` in `.devcontainer/devcontainer.json`. If the browser tries to download instead of render, confirm the port is HTTP (not HTTPS) in the Ports tab and open via the globe icon.
