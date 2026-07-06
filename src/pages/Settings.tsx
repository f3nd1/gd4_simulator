import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useAgentMemoryStore } from "../store/useAgentMemoryStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { useSupabaseSettingsStore } from "../store/useSupabaseSettingsStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useChecklistModuleStore } from "../store/useChecklistModuleStore";
import { useScoringConfigStore } from "../store/useScoringConfigStore";
import { useGuidanceStore } from "../store/useGuidanceStore";
import { assemblePanel, isValidPanel, panelCostEstimate, MIN_PANEL, MAX_PANEL } from "../lib/reviewPanel";
import type { PanelReviewMode } from "../types";
import { getSupabaseClient, getSupabaseConfig } from "../lib/supabaseClient";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";
import { listModels, verdictTemp } from "../lib/ai/aiClient";
import { filterModelSuggestions } from "../lib/modelPicker";

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

// Master switch for the guidance layer: next-step banners, guidance
// tooltips and the first-time walkthroughs all hide together when off.
function GuidanceToggle() {
  const enabled = useGuidanceStore((s) => s.enabled);
  const setEnabled = useGuidanceStore((s) => s.setEnabled);
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Show guidance and tips
      </label>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>
        When on, the app shows a "what to do now" banner on the main workflow pages, tooltips on key controls, and a
        short first-time walkthrough on Start Audit and Evidence Folder. Turn it off once you know your way around.
      </p>
    </div>
  );
}

// Cycle-level trigger for the auditor review panel + a scaled cost warning.
const PANEL_MODES: Array<{ value: PanelReviewMode; label: string; desc: string; heavy?: boolean }> = [
  { value: "off", label: "Off", desc: "No panel. The existing single-pass finding writer is used." },
  { value: "on-demand", label: "On-demand only", desc: "A 'Panel review' button on each finding runs the panel when you click it." },
  { value: "nc-major-auto", label: "Auto for NC / Major only", desc: "The panel runs automatically for NC / Major findings; on-demand for the rest.", heavy: true },
  { value: "all", label: "Auto for all findings", desc: "The panel runs on every finding.", heavy: true },
];

function PanelModeSettings() {
  const mode = useWorkspaceStore((s) => s.reviewPanelMode);
  const setMode = useWorkspaceStore((s) => s.setReviewPanelMode);
  const panelIds = useWorkspaceStore((s) => s.reviewPanelAuditorIds);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const findingCount = useWorkspaceStore((s) => s.customFindings.length);
  const panelSize = assemblePanel(auditors, panelIds).length;
  const cost = panelCostEstimate(panelSize || MIN_PANEL, findingCount || 35);
  const validPanel = isValidPanel(auditors, panelIds);

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        A panel of your auditor profiles reviews each finding from their assigned perspectives, then combines into one
        balanced, evidence-based conclusion. Choose the panel members on the <a href="#/auditors" style={{ color: "#2563eb" }}>Auditor Creation</a> page.
      </p>
      {!validPanel && mode !== "off" && (
        <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 11px", marginBottom: 8 }}>
          ⚠ No valid panel yet — select {MIN_PANEL} to {MAX_PANEL} auditors on Auditor Creation for panel reviews to run.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {PANEL_MODES.map((m) => (
          <label key={m.value} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: `1px solid ${mode === m.value ? "#7c3aed" : "#e2e8f0"}`, background: mode === m.value ? "#faf5ff" : "#fff" }}>
            <input type="radio" name="panel-mode" checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginTop: 2 }} />
            <span>
              <b>{m.label}</b>{m.value === "on-demand" ? " (default)" : ""}
              <div style={{ color: "#6b7280", marginTop: 1 }}>{m.desc}</div>
            </span>
          </label>
        ))}
      </div>
      {(mode === "nc-major-auto" || mode === "all") && (
        <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "8px 11px", marginTop: 8 }}>
          {cost.text}
        </div>
      )}
    </div>
  );
}

export function Settings() {
  const { apiKey, model, utilityModel, visionModel, enabled, setApiKey, setModel, setUtilityModel, setVisionModel, setEnabled, clearApiKey, setVerdictTemperature } = useAISettingsStore();
  const verdictTemperature = useAISettingsStore((s) => verdictTemp(s));
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
          Every credential on this page is stored in plaintext — in this browser's local storage, and (with one
          exception — the Supabase URL/key pair itself, see below) in the Supabase database if you connect one, since
          every other store on this page syncs through it. Do not use production or shared credentials here. AI output
          is always advisory — it never sets the official GD4 score or band, which is always computed by the
          deterministic scoring engine.
        </p>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Guidance</h3>
        <GuidanceToggle />
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Auditor Review Panel</h3>
        <PanelModeSettings />
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

        <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
          ⚠ <b>These two fields never sync anywhere — not even to Supabase.</b> They're what the app needs in order to
          reach Supabase in the first place, so they can't be stored inside it (that would be circular). Whatever you
          type below is saved only to this browser's local storage on this one device. Set them up on another
          machine/browser and they'll be blank there too — you'll need to re-enter them, or (better, for anything you
          use regularly) add them once to a <code>.env.local</code> file as <code>VITE_SUPABASE_URL</code> /{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> so every device/session picks them up automatically with nothing
          to re-enter here.
        </div>

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
        <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
          ⚠ Your API key is <b>synced to Supabase</b> so it follows you across devices. Because the workspace table uses
          an open access policy, anyone with your project's anon key can read it. Use a key scoped/limited to this
          prototype, and don't connect a shared Supabase project you don't control. Leave Supabase unconfigured to keep
          the key on this browser only.
        </div>
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

        {(["analysis", "utility", "vision"] as const).map((kind) => {
          const value = kind === "analysis" ? model : kind === "utility" ? utilityModel : (visionModel || utilityModel);
          const setter = kind === "analysis" ? setModel : kind === "utility" ? setUtilityModel : setVisionModel;
          const label = kind === "analysis" ? "Analysis model" : kind === "utility" ? "Utility model" : "Image (vision) model";
          const placeholder = kind === "analysis" ? "gpt-5" : "gpt-5-nano";
          const v = modelValidity(value);
          return (
            <div key={kind} style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                <ModelPicker
                  value={value}
                  onSelect={setter}
                  suggestions={suggestions}
                  placeholder={placeholder}
                  testId={`model-${kind}`}
                />
                {v === "ok" && <span title="This model is available to your key." style={{ color: "#15803d", fontSize: 16, fontWeight: 700 }}>✓</span>}
                {v === "unknown" && <span title="Not in your key's model list — check the spelling, or your account may not have access." style={{ color: "#b45309", fontSize: 14, fontWeight: 700 }}>⚠</span>}
              </div>
              <span style={{ fontSize: 11, color: v === "unknown" ? "#b45309" : "#94a3b8" }}>
                {v === "unknown"
                  ? `"${value}" isn't in your key's available models — fix the spelling or pick from the list.`
                  : kind === "analysis"
                    ? "Audit verdicts, reviews, banding, checklist & finding drafting, closure review, cross-criterion analysis. Use a smarter model (e.g. gpt-5)."
                    : kind === "utility"
                      ? "Link-metadata drafting and other light text work. A cheaper model is fine (e.g. gpt-5-nano, gpt-4o-mini, or gpt-4o)."
                      : "Transcribes evidence images and scanned/image-only PDFs. Must be a multimodal (vision-capable) model. A stronger vision model reads scans and photos more accurately but costs more per image (e.g. gpt-5-mini or gpt-4o); a cheaper one (gpt-5-nano) is fine for clean scans."}
              </span>
            </div>
          );
        })}

        {/* Verdict consistency (temperature) — governs reproducibility of all
            assessment/verdict AI calls. */}
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Verdict consistency (temperature)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <input
              type="range" min={0} max={1} step={0.05}
              value={verdictTemperature}
              onChange={(e) => setVerdictTemperature(Number(e.target.value))}
              data-testid="verdict-temperature"
              style={{ flex: 1, maxWidth: 320, accentColor: "#4338ca" }}
            />
            <input
              type="number" min={0} max={1} step={0.05}
              value={verdictTemperature}
              onChange={(e) => setVerdictTemperature(Number(e.target.value))}
              style={{ width: 66, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12.5 }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: verdictTemperature <= 0.2 ? "#15803d" : verdictTemperature <= 0.5 ? "#b45309" : "#b23121" }}>
              {verdictTemperature <= 0.2 ? "Highly consistent" : verdictTemperature <= 0.5 ? "Somewhat varied" : "Highly varied"}
            </span>
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            Lower = the same input gives the same verdicts (recommended for audits — default 0.10). Higher = more varied wording but less repeatable results.
            Applies to all assessment calls: staged audit passes, PPD review, evidence assessment, and auditor-panel classification. Generative prose (finding/closure drafting, roll-up narratives) keeps its own fixed setting.
            {" "}Verify the effect with the <Link to="/ai-calibration" style={{ color: "#4338ca", fontWeight: 600 }}>AI Calibration → Consistency</Link> test.
          </span>
        </div>

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

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Display</h3>
        <DisplayThemeSettings />
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Developer</h3>
        <DeveloperToolsSettings />
      </Card>
    </div>
  );
}

// Editable model field with a DOM dropdown of suggestions. Replaces the
// native <input list>/<datalist> combo, whose picker rendered but committed
// nothing on click (native popup selection never reached the controlled
// React input in some Chromium builds — and it can't be driven by tests
// either). This popover is ordinary DOM: options select on MOUSEDOWN, which
// fires before the input's blur, so the "popover closes before the click
// lands" race cannot happen. Free typing still works for brand-new model ids.
function ModelPicker({ value, onSelect, suggestions, placeholder, testId }: {
  value: string;
  onSelect: (model: string) => void;
  suggestions: string[];
  placeholder: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const shown = filterModelSuggestions(suggestions, value);

  const pick = (m: string) => {
    onSelect(m);
    setOpen(false);
    setHighlight(-1);
  };

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        data-testid={testId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onSelect(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setHighlight(-1); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && highlight >= 0 && shown[highlight]) { e.preventDefault(); pick(shown[highlight]); }
          else if (e.key === "Escape") { setOpen(false); setHighlight(-1); }
        }}
        style={{ ...inputStyle, width: "100%" }}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
      />
      {open && shown.length > 0 && (
        <div
          role="listbox"
          data-testid={`${testId}-list`}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40, marginTop: 2, maxHeight: 220, overflowY: "auto", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 8px 22px rgba(15,23,42,.14)" }}
        >
          {shown.map((m, i) => (
            <div
              key={m}
              role="option"
              aria-selected={m === value}
              // Mousedown (not click): commits BEFORE the input blurs, and
              // preventDefault keeps focus in the field.
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setHighlight(i)}
              style={{ padding: "6px 10px", fontSize: 12.5, cursor: "pointer", fontFamily: "ui-monospace,monospace", background: i === highlight ? "#eef2ff" : m === value ? "#faf5ff" : "#fff", color: "#1e293b" }}
            >
              {m}{m === value ? "  ✓" : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Whole-app display theme — "Default" is the original look; "Bold" is a
// larger, less saturated, heavier-weight look meant to be easier to read at
// a glance (bigger text, warmer/duller card and pill colours, a touch more
// font-weight on plain text). See the "Bold" theme block in index.css and
// TONE_BOLD in lib/theme.ts. Synced with the workspace so the choice
// follows the user across devices.
function DisplayThemeSettings() {
  const uiTheme = useWorkspaceStore((s) => s.uiTheme);
  const setUiTheme = useWorkspaceStore((s) => s.setUiTheme);
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        Switch the whole app's look. <b>Bold</b> is bigger text, calmer/less bright colours, and a touch heavier
        weight — meant to be easier to read at a glance without looking like a formal redesign. Takes effect
        immediately everywhere, and follows you to other devices.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {(["default", "bold"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setUiTheme(t)}
            style={{
              cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 16px", borderRadius: 8, textTransform: "capitalize",
              border: `1px solid ${uiTheme === t ? "#7c3aed" : "#cbd5e1"}`,
              background: uiTheme === t ? "#7c3aed" : "#fff",
              color: uiTheme === t ? "#fff" : "#374151",
            }}
          >
            {t}{uiTheme === t ? "  ✓" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// Show/hide the developer diagnostic surfaces (commit footer bar + Change Log
// page). Synced with the workspace (Supabase) so the choice follows the user
// across devices; the change-log DATA keeps recording either way — only the
// UI is hidden.
function DeveloperToolsSettings() {
  const show = useWorkspaceStore((s) => s.showDeveloperTools);
  const setShow = useWorkspaceStore((s) => s.setShowDeveloperTools);
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 12.5 }}>
      <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        <b>Show developer tools (commit footer and Change Log)</b>
        <div style={{ color: "#6b7280", marginTop: 2 }}>
          Shows the git commit footer bar and the Change Log page. Turn off before sharing the app with
          non-developer users. History keeps recording in the background either way — switching this back on
          shows the full log, including entries from while it was hidden.
        </div>
      </span>
    </label>
  );
}
