import { useRef, useState } from "react";
import { Card, inputStyle } from "../components/ui/Card";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import type { BenchmarkFindingPattern, BenchmarkSource } from "../data/benchmarkAFIs";
import { useCustomBenchmarkStore } from "../store/useCustomBenchmarkStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { effectiveSettings } from "../lib/ai/aiClient";
import { extractTextFromFile } from "../lib/uploadedDocText";
import { extractBenchmarkFindings, type ExtractedAFIDraft } from "../lib/ai/benchmarkExtraction";

const PATTERNS: BenchmarkFindingPattern[] = [
  "not documented in PPD",
  "not implemented per PPD",
  "internal contradiction",
  "cross-document mismatch",
  "no timeline/monitoring",
  "other",
];

// Benchmark tab's "upload an audit report" panel: pick a file (internal or
// external audit report), AI extracts each finding as a draft, the human
// reviews/edits every row, and only an explicit "Add N to benchmark set"
// commits them to useCustomBenchmarkStore — nothing here writes to the real
// ground-truth set until that final click. Collapsed by default so it
// doesn't push the scoreboard down for people who never use it.
export function UploadBenchmarkPanel() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<BenchmarkSource>("Internal");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExtractedAFIDraft[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiSettings = useAISettingsStore((s) => s);
  const addEntries = useCustomBenchmarkStore((s) => s.addEntries);

  async function extract() {
    setError(null);
    if (!file) { setError("Choose a file first."); return; }
    if (!aiSettings.enabled || !aiSettings.apiKey) { setError("AI is disabled or no API key is configured in Settings — extraction needs live AI (there's no offline fallback for reading a document)."); return; }
    setRunning(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) { setError("No text could be extracted from this file — it may be a scanned/image-only document, which this upload flow doesn't support yet."); return; }
      const settings = effectiveSettings(aiSettings, { purpose: "analysis" });
      const found = await extractBenchmarkFindings(text, settings);
      if (found.length === 0) { setError("No findings could be extracted from this document."); return; }
      setDraft(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function updateRow(i: number, updates: Partial<ExtractedAFIDraft>) {
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, ...updates } : row)));
  }

  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  function discardDraft() {
    if (draft.length > 0 && !confirm(`Discard ${draft.length} extracted finding${draft.length === 1 ? "" : "s"}? Nothing has been added to the benchmark set yet.`)) return;
    setDraft([]);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function commit() {
    const missingSubCrit = draft.filter((d) => !d.subCriterion).length;
    if (missingSubCrit > 0 && !confirm(`${missingSubCrit} finding${missingSubCrit === 1 ? "" : "s"} has no sub-criterion assigned and will be skipped. Add the remaining ${draft.length - missingSubCrit}?`)) return;
    const toAdd = draft.filter((d) => d.subCriterion);
    if (toAdd.length === 0) return;
    addEntries(toAdd.map(({ confidence: _confidence, ...rest }) => ({ ...rest, source, year })));
    setDraft([]);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(false);
  }

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer", border: "none", background: "transparent", padding: 0, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left" }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>{open ? "▾" : "▸"} Add ground truth from an audit report</h3>
        <span style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 400 }}>upload a PDF/DOCX/XLSX/TXT report — AI extracts findings for you to review</span>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
            Upload an internal or external audit report. AI reads it and extracts each finding as a draft below — nothing
            is added to the benchmark ground-truth set until you review and click "Add to benchmark set". Requires live
            AI (Settings → AI integration) since this needs genuine document comprehension, not a rule-based scan.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 12.5 }}
            />
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              Source
              <select value={source} onChange={(e) => setSource(e.target.value as BenchmarkSource)} style={{ ...inputStyle, width: "auto", padding: "4px 6px" }}>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
              </select>
            </label>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
              Report year
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ ...inputStyle, width: 80, padding: "4px 6px" }} />
            </label>
            <button
              disabled={running || !file}
              onClick={extract}
              style={{ cursor: running || !file ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #4a5a8a", background: "#eaeef6", color: "#4a5a8a", opacity: running || !file ? 0.6 : 1 }}
            >
              {running ? "Extracting…" : "Extract findings"}
            </button>
          </div>

          {error && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 10 }}>{error}</div>}

          {draft.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{draft.length} extracted finding{draft.length === 1 ? "" : "s"} — review before adding</span>
                <button onClick={commit} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d" }}>
                  Add {draft.length} to benchmark set
                </button>
                <button onClick={discardDraft} style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
                  Discard draft
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draft.map((d, i) => (
                  <div key={i} style={{ border: `1px solid ${d.subCriterion ? "#e2e8f0" : "#fca5a5"}`, borderRadius: 8, padding: "9px 12px" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <select data-testid={`draft-subcriterion-${i}`} value={d.subCriterion} onChange={(e) => updateRow(i, { subCriterion: e.target.value })} style={{ ...inputStyle, width: 200, padding: "3px 6px", fontSize: 11.5, borderColor: d.subCriterion ? undefined : "#fca5a5" }}>
                        <option value="">— assign sub-criterion —</option>
                        {GD4_SUB_CRITERIA.map((sc) => <option key={sc.id} value={sc.id}>{sc.id} — {sc.title}</option>)}
                      </select>
                      <input placeholder="GD4 ref (optional)" value={d.gd4Ref ?? ""} onChange={(e) => updateRow(i, { gd4Ref: e.target.value || undefined })} style={{ ...inputStyle, width: 120, padding: "3px 6px", fontSize: 11.5 }} />
                      <select value={d.kind} onChange={(e) => updateRow(i, { kind: e.target.value as ExtractedAFIDraft["kind"] })} style={{ ...inputStyle, width: 110, padding: "3px 6px", fontSize: 11.5 }}>
                        <option value="AFI">AFI</option>
                        <option value="higher-band">higher-band</option>
                        <option value="strength">strength</option>
                      </select>
                      <select value={d.findingPattern} onChange={(e) => updateRow(i, { findingPattern: e.target.value as BenchmarkFindingPattern })} style={{ ...inputStyle, width: 180, padding: "3px 6px", fontSize: 11.5 }}>
                        {PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="checkbox" checked={d.hasNamedExample} onChange={(e) => updateRow(i, { hasNamedExample: e.target.checked })} />
                        named example
                      </label>
                      {d.confidence && <span style={{ fontSize: 10.5, color: d.confidence === "high" ? "#15803d" : d.confidence === "medium" ? "#b45309" : "#b91c1c" }}>AI confidence: {d.confidence}</span>}
                      <button onClick={() => removeRow(i)} style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}>Remove</button>
                    </div>
                    <textarea
                      value={d.findingText}
                      onChange={(e) => updateRow(i, { findingText: e.target.value })}
                      rows={2}
                      style={{ ...inputStyle, width: "100%", fontSize: 12, resize: "vertical", fontFamily: "inherit" }}
                    />
                    {!d.subCriterion && <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 3 }}>No sub-criterion assigned — this finding will be skipped unless you pick one.</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
