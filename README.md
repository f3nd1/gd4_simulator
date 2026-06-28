# GD4 EduTrust Audit Simulator — UCC Internal Tool

A browser-only React application for preparing United Colleges of Commerce (UCC) internal audits
against the Singapore EduTrust GD4 standard. It models the full audit cycle — evidence collection,
AI-assisted assessment, APSR scoring, findings management, management review, and export — without
requiring a custom backend.

> **Prototype — internal use only.** This tool is not affiliated with or endorsed by SSG or ITE.
> All scores and verdicts are simulations for preparation purposes. Do not share login credentials,
> NRIC/FIN details, or sensitive student data via this tool.

---

## What it does

| Module | What it helps you do |
|---|---|
| Audit Cycle | Set up the audit year, cycle ID, and school context |
| Evidence Folders | Link Google Drive folders per sub-criterion; run AI audit to auto-fill the checklist |
| Sub-Criterion Checklist | Review and adjust AI verdicts; attach evidence links; see APSR gap summary |
| Rubric Banding | Simulate the 5-band APSR scoring across all 24 sub-criteria |
| Findings & AFI Closure | Track, classify, and close Areas for Improvement |
| Management Review | Record decisions and sign-off |
| Export | Download a PDF/CSV summary for internal review |

The AI audit reads every supported file (PDF, Word, Google Docs, images) from your linked Drive
folder, judges each checklist line against the official GD4 standard, and writes verdicts back to
the checklist automatically. A second "strict challenge" pass is available for gate-sensitive items.

---

## Running locally

### Prerequisites

- Node.js 22 (the devcontainer provides this automatically)
- An `.env.local` file in the project root (see [Environment variables](#environment-variables))

### Steps

```bash
npm install
npm run dev        # starts Vite on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

> **HMR note (local dev):** `vite.config.ts` sets `hmr.clientPort: 443` for Codespaces
> compatibility. In pure local development this causes the HMR WebSocket to target
> `localhost:443`, which will fail silently — hot reload won't work but the app runs normally
> with full-page reloads. If you need live HMR locally, temporarily remove the `hmr` block.

---

## Running in GitHub Codespaces

1. Open the repository in Codespaces.
2. Codespaces will run `npm install` automatically (`postCreateCommand`).
3. In the terminal: `npm run dev`
4. Go to the **Ports** tab in VS Code.
5. Find port **5173**. Check its **Protocol** column:
   - If it says **HTTP** — click the globe icon to open the app. ✓
   - If it says **HTTPS** — right-click the port → **Change Port Protocol → HTTP**, then open.
6. The app loads at `https://<codespace-name>-5173.preview.app.github.dev`.

### Why port 5173 must be HTTP

Vite's dev server sends JavaScript as `text/javascript`. When Codespaces forwards the port as
**HTTPS**, some browsers receive the response with the wrong MIME type hint and trigger a file
download instead of rendering the page. Forcing the protocol to **HTTP** prevents this.

The `devcontainer.json` already sets `"protocol": "http"` for port 5173, so this should be
automatic on first open. If you see a download, check the Ports tab protocol and correct it.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for more common issues.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon / publishable key>
```

**Use only the `anon` / `publishable` key** from your Supabase project's API settings
(`Project Settings → API → Project API keys → anon public`).
Never put the `service_role` / secret key here — it is sent in the browser bundle.

All other credentials (OpenAI API key, Google OAuth Client ID) are entered at runtime in the
app's **Settings** page and stored in the browser's `localStorage` only. They are never
committed to the repository.

### When `.env.local` is not set

The app falls back to reading URL and key from the Settings page (stored in `localStorage`).
Without Supabase configured the workspace is still fully functional — data saves to
`localStorage` only and will be lost when the Codespace is rebuilt.

---

## Available commands

```bash
npm run dev      # start Vite dev server (http, port 5173)
npm run build    # tsc + Vite production build → dist/
npm run test     # run Vitest unit tests
npm run lint     # oxlint check
npx tsc -b       # type-check only, no emit
```

---

## Security limitations (prototype)

- No authentication or row-level security is enforced at the application layer. Anyone with
  the Supabase URL and anon key can read and write all rows. Use a dedicated project for testing.
- The OpenAI API key and Google OAuth Client ID are stored in `localStorage` and sent directly
  from the browser. Visible to anyone with browser dev tools access on the same machine.
- The Google Drive OAuth access token is intentionally **never** persisted — held in memory only
  and must be re-acquired on each page load.
- Do not upload student personal data (NRIC/FIN, health records) to linked Drive folders.

---

## Architecture overview

- `src/data/` — GD4 requirements, scoring config, seed data
- `src/lib/` — scoring engine (`scoring.ts`), APSR banding (`checklistBanding.ts`), AI layer (`ai/`)
- `src/store/` — Zustand stores (workspace, checklist, AI settings, Google Drive, scoring config)
- `src/pages/` — one file per route; no shared state outside Zustand stores
- `src/lib/drive/driveClient.ts` — all Google Drive interaction (token + API)
- Routing: React Router v7 HashRouter (`#/` prefix)
- Persistence: Supabase (primary) + localStorage fallback; Drive OAuth token excluded from both

See `CLAUDE.md` for the full architecture reference.
