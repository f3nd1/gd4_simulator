import { useEffect, useState } from "react";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useAgentMemoryStore } from "../store/useAgentMemoryStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { useSupabaseSettingsStore } from "../store/useSupabaseSettingsStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { getSupabaseClient, getSupabaseConfig } from "../lib/supabaseClient";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import { listModels } from "../lib/ai/aiClient";

// Re-hydrate every store that uses workspaceStorage so that when Supabase
// credentials are saved mid-session, all previously-saved data (including the
// OpenAI key) loads from the database rather than staying at defaults.
type StoreWithPersist = { persist?: { rehydrate?: () => Promise<void> | void } };
async function rehydrateAllFromSupabase() {
  await new Promise<void>((r) => setTimeout(r, 50)); // let the new Supabase client settle
  const stores: StoreWithPersist[] = [
    useAISettingsStore as unknown as StoreWithPersist,
    useWorkspaceStore as unknown as StoreWithPersist,
    useChecklistModuleStore as unknown as StoreWithPersist,
    useAgentMemoryStore as unknown as StoreWithPersist,
    useScoringConfigStore as unknown as StoreWithPersist,
    useGoogleDriveStore as unknown as StoreWithPersist,
  ];
  for (const store of stores) {
    try { await store.persist?.rehydrate?.(); } catch { /* best-effort */ }
  }
}

// GPT-5 family first (current default). The GPT-4 entries stay as fallbacks
// for anyone whose key/org doesn't yet have GPT-5 access.
// Suggestions only — the model fields are editable, so any newer id OpenAI
// releases (e.g. a gpt-5.x) can simply be typed in. Roughly smartest → cheapest.
const MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"];

export function Settings() {
  const { apiKey, model, utilityModel, enabled, setApiKey, setModel, setUtilityModel, setEnabled, clearApiKey } = useAISettingsStore();
  const memory = useAgentMemoryStore((s) => s.memory);
  const clearMemory = useAgentMemoryStore((s) => s.clearMemory);
  const [draftKey, setDraftKey] = useState(apiKey);
  // apiKey now rehydrates asynchronously (Supabase round-trip, or the
  // timeout fallback), so it can still be the empty default when this
  // component first mounts — keep the draft in sync once it resolves.
  useEffect(() => setDraftKey(apiKey), [apiKey]);

  // Live list of model ids the saved key can access (fetched on demand from
  // OpenAI's /v1/models). Lets the user pick real ids and flags a typo before
  // it fails mid-audit. Falls back to the static suggestions until fetched.
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  async function fetchModels() {
    setModelsBusy(true);
    setModelsError(null);
    try {
      setAvailableModels(await listModels(apiKey));
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setAvailableModels(null);
    } finally {
      setModelsBusy(false);
    }
  }
  // ✓ when the typed model is in the fetched list, ⚠ when it isn't, nothing
  // until the list has been fetched (we can't know before then).
  function modelValidity(m: string): "ok" | "unknown" | null {
    if (!availableModels) return null;
    return availableModels.includes(m) ? "ok" : "unknown";
  }
  const suggestions = availableModels && availableModels.length ? availableModels : MODELS;

  const { clientId, accessToken, connecting, lastError, setClientId, connect, disconnect } = useGoogleDriveStore();
  const [draftClientId, setDraftClientId] = useState(clientId);
  useEffect(() => setDraftClientId(clientId), [clientId]);
  const driveConnected = !!accessToken;

  const { url: dbUrl, publishableKey: dbKey, setUrl, setPublishableKey, clear: clearDb } = useSupabaseSettingsStore();
  const [draftDbUrl, setDraftDbUrl] = useState(dbUrl);
  const [draftDbKey, setDraftDbKey] = useState(dbKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [rehydrating, setRehydrating] = useState(false);
  const [rehydrateResult, setRehydrateResult] = useState<string | null>(null);
  const { url: effectiveUrl, key: effectiveKey } = getSupabaseConfig();
  const dbConfigured = !!effectiveUrl && !!effectiveKey;
  const usingOverride = !!dbUrl || !!dbKey;

  const memoryAgentCount = Object.keys(memory).filter((k) => (memory[k] || []).length > 0).length;

  async function testDbConnection() {
    setTesting(true);
    setTestResult(null);
    const client = getSupabaseClient();
    if (!client) {
      setTestResult({ ok: false, message: "No URL/key configured — save them first." });
      setTesting(false);
      return;
    }
    try {
      const { error } = await client.from("workspace_state").select("id").limit(1);
      if (error) setTestResult({ ok: false, message: error.message });
      else setTestResult({ ok: true, message: "Connected — workspace_state table is reachable." });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
    setTesting(false);
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: "#fff7e6", border: "1px solid #f0c36d" }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: "#92620a" }}>Not production safe — prototype/internal testing only</h3>
        <p style={{ fontSize: 12.5, color: "#7a5208", marginTop: 0, marginBottom: 0 }}>
          Every credential on this page is stored in plaintext — in this browser's local storage, and in the Supabase
          database below if you connect one, since every other store on this page syncs through it. Do not use
          production or shared credentials here. AI output is always advisory — it never sets the official GD4 score or
          band, which is always computed by the deterministic scoring engine.
        </p>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Supabase database</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          When connected, this entire workspace — audit cycle, departments, findings, checklist evidence, closures,
          folders, auditors, AI agent memory, the OpenAI key and the Google Drive Client ID — is read from and written
          to this database, with this browser's local storage kept as an offline cache and fallback if the database is
          unreachable. Leave this blank to keep everything local to this browser only.
        </p>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          <b>Tip — cross-session persistence:</b> if you are running in an environment where the app URL changes between
          sessions (e.g. a cloud dev container), browser local storage will not survive a restart. Add your Supabase
          URL and anon key to a <code>.env.local</code> file in the project root as{" "}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> so they are picked up
          automatically each time the server starts — you will not need to re-enter anything on this page.
        </p>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          Use only the <b>anon / publishable</b> key from your Supabase project's API settings. Never paste the{" "}
          <b>service_role / secret</b> key here — it bypasses row-level security and this key is sent straight from the
          browser. Required table, run once in the Supabase SQL editor:
        </p>
        <pre style={{ fontSize: 11, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, overflowX: "auto" }}>
{`create table if not exists public.workspace_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_state enable row level security;
create policy "anon read/write" on public.workspace_state
  for all using (true) with check (true);`}
        </pre>

        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Project URL</span>
          <input
            value={draftDbUrl}
            onChange={(e) => setDraftDbUrl(e.target.value)}
            placeholder="https://xxxxxxxxxxxx.supabase.co"
            style={{ ...inputStyle, marginTop: 3 }}
            autoComplete="off"
          />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Anon / publishable key</span>
          <input
            type="password"
            value={draftDbKey}
            onChange={(e) => setDraftDbKey(e.target.value)}
            placeholder="eyJ…"
            style={{ ...inputStyle, marginTop: 3 }}
            autoComplete="off"
          />
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={async () => {
              setUrl(draftDbUrl);
              setPublishableKey(draftDbKey);
              setTestResult(null);
              setRehydrateResult(null);
              if (draftDbUrl && draftDbKey) {
                setRehydrating(true);
                await rehydrateAllFromSupabase();
                setRehydrating(false);
                setRehydrateResult("All settings reloaded from Supabase.");
              }
            }}
            style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Save & reload
          </button>
          <button
            disabled={testing}
            onClick={testDbConnection}
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            disabled={rehydrating || !dbConfigured}
            onClick={async () => {
              setRehydrateResult(null);
              setRehydrating(true);
              await rehydrateAllFromSupabase();
              setRehydrating(false);
              setRehydrateResult("All settings reloaded from Supabase.");
            }}
            style={{ cursor: rehydrating || !dbConfigured ? "not-allowed" : "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            {rehydrating ? "Reloading…" : "Reload from Supabase"}
          </button>
          <button
            onClick={() => {
              clearDb();
              setDraftDbUrl("");
              setDraftDbKey("");
              setTestResult(null);
              setRehydrateResult(null);
            }}
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            Clear (use local storage only)
          </button>
          <Pill s={dbConfigured ? "good" : "neutral"}>{dbConfigured ? "Configured" : "Local storage only"}</Pill>
        </div>
        {dbConfigured && (
          <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 8, marginBottom: 0 }}>
            {usingOverride ? "Using the URL/key saved above." : "Using the build's default .env.local URL/key (no override saved above)."}
          </p>
        )}
        {rehydrateResult && (
          <p style={{ fontSize: 12, marginTop: 8, marginBottom: 0, color: "#15803d" }}>{rehydrateResult}</p>
        )}
        {testResult && (
          <p style={{ fontSize: 12, marginTop: 8, marginBottom: 0, color: testResult.ok ? "#15803d" : "#b91c1c" }}>
            {testResult.message}
          </p>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>AI integration (OpenAI)</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12.5 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!apiKey} />
          Enable live AI calls (otherwise AI Agent Review and Closure Review use the offline rule-based simulation)
        </label>

        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>OpenAI API key</span>
          <input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="sk-…"
            style={{ ...inputStyle, marginTop: 3 }}
            autoComplete="off"
          />
        </label>

        {/* Editable model fields (input + datalist) rather than a fixed dropdown:
            OpenAI ships new model ids faster than this list can be hard-coded, and
            the id must match exactly or the API rejects the call. "Fetch available
            models" pulls the real list your key can access so you can pick a valid
            id and see a ✓/⚠ check on what you typed. */}
        <datalist id="openai-models">
          {suggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={fetchModels}
            disabled={!apiKey || modelsBusy}
            style={{ cursor: !apiKey || modelsBusy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: apiKey ? "#1f2733" : "#94a3b8" }}
          >
            {modelsBusy ? "Fetching…" : "Fetch available models"}
          </button>
          {availableModels && <span style={{ fontSize: 11.5, color: "#15803d" }}>{availableModels.length} models available to this key</span>}
          {!apiKey && <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Save your API key first</span>}
          {modelsError && <span style={{ fontSize: 11.5, color: "#b23121" }}>{modelsError}</span>}
        </div>

        {(["analysis", "utility"] as const).map((kind) => {
          const value = kind === "analysis" ? model : utilityModel;
          const setter = kind === "analysis" ? setModel : setUtilityModel;
          const v = modelValidity(value);
          return (
            <label key={kind} style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{kind === "analysis" ? "Analysis model" : "Utility model"}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                <input list="openai-models" value={value} onChange={(e) => setter(e.target.value)} placeholder={kind === "analysis" ? "gpt-5" : "gpt-5-nano"} style={{ ...inputStyle, flex: 1 }} />
                {v === "ok" && <span title="This model is available to your key." style={{ color: "#15803d", fontSize: 16, fontWeight: 700 }}>✓</span>}
                {v === "unknown" && <span title="Not in your key's model list — check the spelling, or your account may not have access." style={{ color: "#b45309", fontSize: 14, fontWeight: 700 }}>⚠</span>}
              </div>
              <span style={{ fontSize: 11, color: v === "unknown" ? "#b45309" : "#94a3b8" }}>
                {v === "unknown"
                  ? `"${value}" isn't in your key's available models — fix the spelling or pick from the list.`
                  : kind === "analysis"
                    ? "Audit verdicts, reviews, banding, checklist & finding drafting, closure review, cross-criterion analysis. Use a smarter model (e.g. gpt-5)."
                    : "Reading evidence images and condensing/drafting metadata. A cheaper model is fine (e.g. gpt-5-nano, gpt-4o-mini, or gpt-4o)."}
              </span>
            </label>
          );
        })}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setApiKey(draftKey)}
            style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Save key
          </button>
          <button
            onClick={() => {
              clearApiKey();
              setDraftKey("");
            }}
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            Clear key
          </button>
          <Pill s={enabled && apiKey ? "good" : "neutral"}>{enabled && apiKey ? "Live AI active" : "Offline simulation"}</Pill>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Google Drive integration</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Connecting your Google account lets the Evidence Folder page's "Check access" and "Run audit" buttons actually
          read files inside the Drive folder pasted into each folder's link field — no separate folder ID field needed.
          This is a prototype, client-side-only OAuth connection: there is no backend, the access token lives only in this
          browser tab's memory (never saved to local storage or the database), and it expires after about an hour.
        </p>
        <p style={{ fontSize: 12.5, color: "#6b7280" }}>
          One-time setup in Google Cloud Console: create an OAuth Client ID (Application type "Web application"), add
          this app's URL to "Authorized JavaScript origins", and enable the Google Drive API for the project. No client
          secret is needed for this flow — paste only the Client ID below.
        </p>

        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Google OAuth Client ID</span>
          <input
            value={draftClientId}
            onChange={(e) => setDraftClientId(e.target.value)}
            placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
            style={{ ...inputStyle, marginTop: 3 }}
            autoComplete="off"
          />
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setClientId(draftClientId)}
            style={{ cursor: "pointer", border: "none", background: GOLD, color: INK, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
          >
            Save Client ID
          </button>
          <button
            disabled={connecting || !clientId}
            onClick={() => connect()}
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            {connecting ? "Connecting…" : "Connect Google Drive"}
          </button>
          <button
            disabled={!driveConnected}
            onClick={() => disconnect()}
            style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
          >
            Disconnect
          </button>
          <Pill s={driveConnected ? "good" : "neutral"}>{driveConnected ? "Connected" : "Not connected"}</Pill>
        </div>
        {lastError && <p style={{ fontSize: 12, color: "#b91c1c", marginBottom: 0 }}>{lastError}</p>}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Agent memory</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Each agent keeps a short rolling history of its own prior turns in this workspace, so a live AI call has context
          from earlier reviews it ran. Syncs through the Supabase database above when connected, otherwise stays local.
        </p>
        <p style={{ fontSize: 12.5 }}>
          {memoryAgentCount === 0 ? "No agent memory recorded yet." : `${memoryAgentCount} agent(s) have recorded memory.`}
        </p>
        <button
          onClick={() => clearMemory()}
          style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}
        >
          Clear all agent memory
        </button>
      </Card>
    </div>
  );
}
