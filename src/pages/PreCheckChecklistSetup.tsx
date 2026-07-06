import { useEffect, useMemo, useState } from "react";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { GD4_CRITERIA, GD4_SUB_CRITERIA, GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { usePreCheckChecklistStore } from "../store/usePreCheckChecklistStore";
import type { ChecklistItemDef, ChecklistMode, ChecklistSourceKind, DetectionKey } from "../lib/preAnalysisChecklist";

// CRUD setup page for the per-sub-criterion pre-analysis checklist — the SAME
// data (usePreCheckChecklistStore) the run-flow's Pre-check step reads via
// PreAnalysisChecklistPanel. There is no parallel config: adding/editing/
// removing an item here changes exactly what the next run shows.
//
// Items are keyed by GD4 ITEM id (e.g. "4.2.2"), not sub-criterion id — most
// sub-criteria have exactly one item, but 2.2 and 4.2 each have two. The
// picker below lists every item grouped by its sub-criterion so both cases
// are handled uniformly.
//
// Three cascading filters (Criterion → Sub-criterion → GD4 item) narrow the
// table; each can be left on "All" so the table can show every checklist
// item across the whole GD4 library at once, tagged with which item it
// belongs to. That flat "All" view is what makes bulk actions useful — a
// row-selection + Approve/Revert/Delete bar operates across whatever the
// three filters currently show, spanning as many different GD4 items as
// needed in one shot.

const ALL = "all";

const SOURCE_KIND_LABEL: Record<ChecklistSourceKind, string> = {
  regulatory: "Regulatory (PDPA, etc.)",
  fps: "FPS Instruction Manual",
  contract: "Standard Student Contract",
  gd4: "GD4 requirement text",
  "finding-pattern": "Known SSG finding pattern",
};

const DETECTION_LABEL: Record<DetectionKey, string> = {
  "nric": "NRIC/FIN pattern scan",
  "date-sequencing": "Contract-vs-receipt date sequencing",
  "record-count": "Management-review record count (by file name)",
  "date-discrepancy": "Date/time discrepancy scan (policy-vs-evidence, audit-proximity)",
  "none": "No automated detection — manual only",
};

type FormState = {
  title: string;
  description: string;
  source: string;
  sourceKind: ChecklistSourceKind;
  mode: ChecklistMode;
  detectionKey: DetectionKey;
};

const EMPTY_FORM: FormState = { title: "", description: "", source: "", sourceKind: "gd4", mode: "manual", detectionKey: "none" };

// A checklist row plus which GD4 item it belongs to — needed once rows from
// several different items are flattened into one "All" table.
type FlatRow = { itemId: string; def: ChecklistItemDef; index: number; siblingCount: number };
type RowKey = string; // `${itemId}::${defId}`
const rowKey = (itemId: string, defId: string): RowKey => `${itemId}::${defId}`;

export function PreCheckChecklistSetup() {
  const checklists = usePreCheckChecklistStore((s) => s.checklists);
  const addItem = usePreCheckChecklistStore((s) => s.addItem);
  const updateItem = usePreCheckChecklistStore((s) => s.updateItem);
  const removeItem = usePreCheckChecklistStore((s) => s.removeItem);
  const reorderItem = usePreCheckChecklistStore((s) => s.reorderItem);
  const setVerified = usePreCheckChecklistStore((s) => s.setVerified);
  const removeItemsBatch = usePreCheckChecklistStore((s) => s.removeItemsBatch);
  const setVerifiedBatch = usePreCheckChecklistStore((s) => s.setVerifiedBatch);

  const [criterionFilter, setCriterionFilter] = useState<string>(ALL);
  const [subCritFilter, setSubCritFilter] = useState<string>(ALL);
  const [itemFilter, setItemFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<RowKey>>(new Set());

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingDefId, setEditingDefId] = useState<string | null>(null);

  // Sub-criterion options narrow to the chosen criterion; GD4 item options
  // narrow to the chosen sub-criterion. Reset a downstream filter whenever
  // its upstream choice no longer includes the current value.
  const subCritOptions = useMemo(
    () => (criterionFilter === ALL ? GD4_SUB_CRITERIA : GD4_SUB_CRITERIA.filter((sc) => sc.criterionId === criterionFilter)),
    [criterionFilter]
  );
  useEffect(() => {
    if (subCritFilter !== ALL && !subCritOptions.some((sc) => sc.id === subCritFilter)) setSubCritFilter(ALL);
  }, [subCritOptions, subCritFilter]);

  const itemOptions = useMemo(
    () => (subCritFilter === ALL ? GD4_REQUIREMENTS.filter((r) => subCritOptions.some((sc) => sc.id === r.subCriterionId)) : GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCritFilter)),
    [subCritFilter, subCritOptions]
  );
  useEffect(() => {
    if (itemFilter !== ALL && !itemOptions.some((r) => r.id === itemFilter)) setItemFilter(ALL);
  }, [itemOptions, itemFilter]);

  // Clear the bulk selection whenever the visible scope changes — a
  // selection made under one filter shouldn't silently carry into another.
  useEffect(() => { setSelected(new Set()); }, [criterionFilter, subCritFilter, itemFilter, search]);

  const selectedReq = itemFilter !== ALL ? GD4_REQUIREMENTS.find((r) => r.id === itemFilter) : undefined;
  const selectedSubCrit = GD4_SUB_CRITERIA.find((s) => s.id === selectedReq?.subCriterionId);

  // Flattened, filtered rows. In single-item mode this is exactly that
  // item's rows (siblingCount/index preserved for the up/down reorder
  // controls); in "All" mode it's every matching item's rows concatenated,
  // each tagged with itemId so the table can show + act on the source item.
  const flatRows: FlatRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = itemFilter !== ALL ? itemOptions.filter((r) => r.id === itemFilter) : itemOptions;
    const out: FlatRow[] = [];
    for (const req of items) {
      const defs = checklists[req.id] ?? [];
      defs.forEach((def, index) => {
        if (q && !def.title.toLowerCase().includes(q) && !def.description.toLowerCase().includes(q) && !def.source.toLowerCase().includes(q)) return;
        out.push({ itemId: req.id, def, index, siblingCount: defs.length });
      });
    }
    return out;
  }, [checklists, itemOptions, itemFilter, search]);

  const showItemColumn = itemFilter === ALL;
  const allVisibleSelected = flatRows.length > 0 && flatRows.every((r) => selected.has(rowKey(r.itemId, r.def.id)));

  function toggleRow(itemId: string, defId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = rowKey(itemId, defId);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      flatRows.forEach((r) => next.add(rowKey(r.itemId, r.def.id)));
      return next;
    });
  }

  function selectedPairs() {
    return Array.from(selected).map((k) => {
      const [pItemId, pDefId] = k.split("::");
      return { itemId: pItemId, defId: pDefId };
    });
  }

  function bulkApprove() {
    setVerifiedBatch(selectedPairs(), true);
    setSelected(new Set());
  }

  function bulkRevert() {
    setVerifiedBatch(selectedPairs(), false);
    setSelected(new Set());
  }

  function bulkDelete() {
    const n = selected.size;
    if (!confirm(`Remove ${n} checklist item${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
    removeItemsBatch(selectedPairs());
    setSelected(new Set());
  }

  function startEdit(itemId: string, d: ChecklistItemDef) {
    setItemFilter(itemId);
    setEditingDefId(d.id);
    setForm({ title: d.title, description: d.description, source: d.source, sourceKind: d.sourceKind, mode: d.mode, detectionKey: d.detectionKey });
  }

  function cancelEdit() {
    setEditingDefId(null);
    setForm(EMPTY_FORM);
  }

  function submit() {
    if (itemFilter === ALL) return;
    if (!form.title.trim() || !form.description.trim() || !form.source.trim()) return;
    const payload = { ...form, detectionKey: form.mode === "auto" ? form.detectionKey : ("none" as DetectionKey) };
    if (editingDefId) {
      updateItem(itemFilter, editingDefId, payload);
      setEditingDefId(null);
    } else {
      addItem(itemFilter, payload);
    }
    setForm(EMPTY_FORM);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Pre-check checklist setup</h3>
        <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
          Manage the pre-analysis checklist shown during a run's "Pre-check" step, per GD4 item. This is the same data
          the run flow reads — changes here take effect on the next run immediately. Items you add here always start as
          an unverified <b>draft</b> (see the badge in the checklist panel) until approved below.
        </p>
        <p style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 4 }}>
          Note: this page manages per-item checks only. A separate <b>🌐 universal</b> layer (currently: the date/time
          discrepancy scan) always runs on every sub-criterion in addition to whatever's listed here — see
          preAnalysisChecklist.ts's <code>UNIVERSAL_CHECKLIST</code>.
        </p>

        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Criterion</span>
            <select value={criterionFilter} onChange={(e) => setCriterionFilter(e.target.value)} style={{ ...inputStyle, marginTop: 3, width: "100%" }}>
              <option value={ALL}>All criteria</option>
              {GD4_CRITERIA.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.title}</option>)}
            </select>
          </label>

          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Sub-criterion</span>
            <select value={subCritFilter} onChange={(e) => setSubCritFilter(e.target.value)} style={{ ...inputStyle, marginTop: 3, width: "100%" }}>
              <option value={ALL}>All sub-criteria</option>
              {subCritOptions.map((sc) => <option key={sc.id} value={sc.id}>{sc.id} — {sc.title}</option>)}
            </select>
          </label>

          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>GD4 item</span>
            <select value={itemFilter} onChange={(e) => { setItemFilter(e.target.value); cancelEdit(); }} style={{ ...inputStyle, marginTop: 3, width: "100%" }}>
              <option value={ALL}>All items{subCritFilter !== ALL || criterionFilter !== ALL ? " (in scope above)" : ""}</option>
              {itemOptions.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.requirement}</option>)}
            </select>
          </label>
        </div>

        {selectedSubCrit && (
          <p style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 8, marginBottom: 0 }}>{selectedSubCrit.description}</p>
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>
            Checklist items {itemFilter === ALL ? `— all matching (${flatRows.length})` : `for ${itemFilter} (${flatRows.length})`}
          </h3>
          <input
            placeholder="Search title, description or source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, marginLeft: "auto", width: 240, padding: "5px 8px" }}
          />
        </div>

        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "#eef2ff", border: "1px solid #c7d2fe" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3730a3" }}>{selected.size} selected</span>
            <button onClick={bulkApprove} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #86efac", background: "#fff", color: "#15803d", fontWeight: 600 }}>Approve selected</button>
            <button onClick={bulkRevert} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #fde68a", background: "#fff", color: "#b45309", fontWeight: 600 }}>Revert to draft</button>
            <button onClick={bulkDelete} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", fontWeight: 600 }}>Delete selected</button>
            <button onClick={() => setSelected(new Set())} style={{ cursor: "pointer", fontSize: 11.5, padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#475569", marginLeft: "auto" }}>Clear selection</button>
          </div>
        )}

        {flatRows.length === 0 && (
          <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
            {search ? "No checklist items match the current search." : "No checklist items defined for this scope yet — add one below."}
          </p>
        )}
        {flatRows.length > 0 && (
          <table style={{ marginBottom: 4 }}>
            <thead>
              <tr>
                <th style={{ width: 26 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title="Select all visible rows" style={{ cursor: "pointer" }} />
                </th>
                {showItemColumn && <th>Item</th>}
                <th>Title</th>
                <th>Mode</th>
                <th>Detection</th>
                <th>Source</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flatRows.map(({ itemId, def: d, index: i, siblingCount }) => {
                const key = rowKey(itemId, d.id);
                const isSelected = selected.has(key);
                return (
                  <tr key={key} className="rowh" style={isSelected ? { background: "#eef2ff" } : undefined}>
                    <td>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(itemId, d.id)} style={{ cursor: "pointer" }} />
                    </td>
                    {showItemColumn && (
                      <td style={{ fontSize: 11.5, fontWeight: 700, color: "#4338ca", whiteSpace: "nowrap" }}>{itemId}</td>
                    )}
                    <td style={{ maxWidth: 240 }}>
                      <b>{d.title}</b>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{d.description}</div>
                    </td>
                    <td>{d.mode === "auto" ? "Auto" : "Manual"}</td>
                    <td style={{ fontSize: 11.5 }}>{DETECTION_LABEL[d.detectionKey]}</td>
                    <td style={{ fontSize: 11.5, color: "#6b7280" }}>{d.source} <span style={{ color: "#94a3b8" }}>({SOURCE_KIND_LABEL[d.sourceKind]})</span></td>
                    <td>
                      {d.verified
                        ? <Pill s="good">Verified</Pill>
                        : <span title="Drafted from official GD4 text / a skill file, NOT yet human-reviewed against a real finding." style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: "#fef2f2", color: "#b91c1c", border: "1px dashed #fca5a5" }}>⚠ Draft</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => reorderItem(itemId, d.id, "up")} disabled={i === 0} title="Move up" style={{ cursor: i === 0 ? "default" : "pointer", fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 3, opacity: i === 0 ? 0.4 : 1 }}>↑</button>
                      <button onClick={() => reorderItem(itemId, d.id, "down")} disabled={i === siblingCount - 1} title="Move down" style={{ cursor: i === siblingCount - 1 ? "default" : "pointer", fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 6, opacity: i === siblingCount - 1 ? 0.4 : 1 }}>↓</button>
                      <button onClick={() => startEdit(itemId, d)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 6 }}>Edit</button>
                      {d.verified ? (
                        <button
                          onClick={() => setVerified(itemId, d.id, false)}
                          title="Revert to draft — re-flag this item for review; it will show the 'Draft — not yet reviewed' badge again."
                          style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #fde68a", background: "#fff", color: "#b45309", marginRight: 6 }}
                        >
                          Revert to draft
                        </button>
                      ) : (
                        <button
                          onClick={() => setVerified(itemId, d.id, true)}
                          title="Approve — confirms you've reviewed this item against a real source/finding; it will display the same as the grounded 4.2.2/6.2.1 items, no more draft badge."
                          style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #86efac", background: "#fff", color: "#15803d", marginRight: 6 }}
                        >
                          Approve
                        </button>
                      )}
                      <button onClick={() => { if (editingDefId === d.id) cancelEdit(); removeItem(itemId, d.id); }} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c" }}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        {itemFilter === ALL ? (
          <>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Add item</h3>
            <p style={{ fontSize: 12.5, color: "#94a3b8" }}>
              Pick a specific GD4 item above (narrow the Sub-criterion filter, then the GD4 item filter) to add a new
              checklist item to it. "All items" is a read/bulk-action view only.
            </p>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>{editingDefId ? `Edit item — ${itemFilter}` : `Add item — ${itemFilter}`}</h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <input placeholder="Title (e.g. 'Cooling-off period is 7+ working days')" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} />
              <select value={form.sourceKind} onChange={(e) => setForm({ ...form, sourceKind: e.target.value as ChecklistSourceKind })} style={inputStyle}>
                {(Object.keys(SOURCE_KIND_LABEL) as ChecklistSourceKind[]).map((k) => <option key={k} value={k}>{SOURCE_KIND_LABEL[k]}</option>)}
              </select>
              <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as ChecklistMode, detectionKey: e.target.value === "manual" ? "none" : form.detectionKey })} style={inputStyle}>
                <option value="manual">Manual check (human judgement)</option>
                <option value="auto">Auto-detected (runs a scan)</option>
              </select>
              {form.mode === "auto" && (
                <select value={form.detectionKey} onChange={(e) => setForm({ ...form, detectionKey: e.target.value as DetectionKey })} style={inputStyle}>
                  {(["nric", "date-sequencing", "record-count", "date-discrepancy"] as DetectionKey[]).map((k) => <option key={k} value={k}>{DETECTION_LABEL[k]}</option>)}
                </select>
              )}
            </div>
            <textarea
              placeholder="Description — what to check and why"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              style={{ ...inputStyle, marginTop: 8, width: "100%", resize: "vertical", fontFamily: "inherit" }}
            />
            <input
              placeholder="Source label (e.g. 'GD4 4.2.1 describeShow — cooling-off period')"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              style={{ ...inputStyle, marginTop: 8, width: "100%" }}
            />
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "6px 0 0" }}>
              Auto-detected items reuse one of the app's existing detection functions (no code needed) — pick "Manual check"
              for anything else; a human ticks it during the run instead. New/edited items here always start as an unverified
              <b> draft</b> — use the <b>Approve</b> button in the table above once you've reviewed one against a real source or
              finding, which removes its draft badge everywhere. Approving is reversible at any time via <b>Revert to draft</b>.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={submit} style={{ cursor: "pointer", border: "none", background: "#7c3aed", color: "#fff", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
                {editingDefId ? "Save changes" : "Add item"}
              </button>
              {editingDefId && (
                <button onClick={cancelEdit} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontWeight: 600, padding: "8px 14px", borderRadius: 8 }}>
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
