import { useState } from "react";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useAgentMemoryStore } from "../store/useAgentMemoryStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GOLD, INK } from "../lib/theme";

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];

export function Settings() {
  const { apiKey, model, enabled, setApiKey, setModel, setEnabled, clearApiKey } = useAISettingsStore();
  const memory = useAgentMemoryStore((s) => s.memory);
  const clearMemory = useAgentMemoryStore((s) => s.clearMemory);
  const [draftKey, setDraftKey] = useState(apiKey);

  const memoryAgentCount = Object.keys(memory).filter((k) => (memory[k] || []).length > 0).length;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
      <Card style={{ background: "#fff7e6", border: "1px solid #f0c36d" }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: "#92620a" }}>Not production safe — prototype/internal testing only</h3>
        <p style={{ fontSize: 12.5, color: "#7a5208", marginTop: 0, marginBottom: 0 }}>
          The key below is stored in plaintext in this browser's local storage and is sent directly from the browser to
          OpenAI on every AI Agent Review or Closure Review call. There is no backend proxy. Do not use a production or
          shared API key here. Clear the key when you're done testing. AI output is always advisory — it never sets the
          official GD4 score or band, which is always computed by the deterministic scoring engine.
        </p>
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

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...inputStyle, marginTop: 3 }}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

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
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Agent memory</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Each agent keeps a short rolling history of its own prior turns in this workspace, so a live AI call has context
          from earlier reviews it ran. Stored locally, separate from the workspace and API key.
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
