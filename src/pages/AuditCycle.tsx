import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { GOLD, INK } from "../lib/theme";
import type { CycleStatus, Department } from "../types";
import { departmentPair, policyDocumentViews, codeParts, type PolicyDocumentView } from "../lib/departments";
import { scopeTitle } from "../lib/evidenceScope";

const STATUSES: CycleStatus[] = ["Draft", "Under Review", "Returned for Amendment", "Ready for Management Review", "Finalised", "Locked"];

const EMPTY_DEPT_FORM = { acronym: "", fullName: "", personInCharge: "" };

export function AuditCycle() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const updateCycle = useWorkspaceStore((s) => s.updateCycle);
  const duplicateCycle = useWorkspaceStore((s) => s.duplicateCycle);
  const createNewCycle = useWorkspaceStore((s) => s.createNewCycle);
  const departments = useWorkspaceStore((s) => s.departments);
  const addDepartment = useWorkspaceStore((s) => s.addDepartment);
  const updateDepartment = useWorkspaceStore((s) => s.updateDepartment);
  const removeDepartment = useWorkspaceStore((s) => s.removeDepartment);
  const resetDepartments = useWorkspaceStore((s) => s.resetDepartments);
  const policyDocEdits = useWorkspaceStore((s) => s.policyDocEdits);
  const setPolicyDocEdit = useWorkspaceStore((s) => s.setPolicyDocEdit);
  const clearPolicyDocEdit = useWorkspaceStore((s) => s.clearPolicyDocEdit);
  const locked = cycle.status === "Locked";

  const [deptForm, setDeptForm] = useState(EMPTY_DEPT_FORM);
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);

  function submitDept() {
    const acronym = deptForm.acronym.trim();
    if (!acronym) return;
    const collision = departments.find((d) => d.acronym.toLowerCase() === acronym.toLowerCase() && d.id !== editingDeptId);
    if (collision) {
      window.alert(`A department with acronym "${collision.acronym}" already exists (${collision.fullName}). Use a different acronym.`);
      return;
    }
    if (editingDeptId) {
      updateDepartment(editingDeptId, deptForm);
      setEditingDeptId(null);
    } else {
      const d: Department = { id: acronym, ...deptForm, acronym };
      addDepartment(d);
    }
    setDeptForm(EMPTY_DEPT_FORM);
  }

  function startEditDept(d: Department) {
    setEditingDeptId(d.id);
    setDeptForm({ acronym: d.acronym, fullName: d.fullName, personInCharge: d.personInCharge });
  }

  function cancelEditDept() {
    setEditingDeptId(null);
    setDeptForm(EMPTY_DEPT_FORM);
  }

  function createNew() {
    if (window.confirm("Start a new blank cycle? This clears all evidence, findings, checklist entries and other current workspace data (saved versions are not affected). This cannot be undone.")) {
      createNewCycle();
    }
  }

  return (
    <div className="flex flex-col gap-3">
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Audit cycle setup</h3>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Name</span>
          <input disabled={locked} value={cycle.name} onChange={(e) => updateCycle({ name: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Audit type</span>
          <input disabled={locked} value={cycle.type} onChange={(e) => updateCycle({ type: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ display: "block", marginBottom: 10, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Period start</span>
            <input disabled={locked} type="date" value={cycle.periodStart} onChange={(e) => updateCycle({ periodStart: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
          </label>
          <label style={{ display: "block", marginBottom: 10, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Period end</span>
            <input disabled={locked} type="date" value={cycle.periodEnd} onChange={(e) => updateCycle({ periodEnd: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Evidence cut-off date</span>
          <input disabled={locked} type="date" value={cycle.evidenceCutOffDate} onChange={(e) => updateCycle({ evidenceCutOffDate: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Scope</span>
          <textarea disabled={locked} rows={2} value={cycle.scope} onChange={(e) => updateCycle({ scope: e.target.value })} style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Audit owner</span>
          <input disabled={locked} value={cycle.owner} onChange={(e) => updateCycle({ owner: e.target.value })} style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Google Drive root folder URL</span>
          <input disabled={locked} value={cycle.driveRoot || ""} onChange={(e) => updateCycle({ driveRoot: e.target.value })} placeholder="https://drive.google.com/…" style={{ ...inputStyle, marginTop: 3 }} />
        </label>
        {cycle.driveRoot && (
          <a href={cycle.driveRoot} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            Open Drive root folder
          </a>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Status &amp; lifecycle</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={locked && s !== "Locked"}
              onClick={() => updateCycle({ status: s })}
              style={{
                cursor: "pointer",
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 7,
                border: "1px solid #cbd5e1",
                background: cycle.status === s ? INK : "#fff",
                color: cycle.status === s ? "#fff" : "#1f2733",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#6b7280" }}>
          Version <b>{cycle.version}</b> · last saved {cycle.lastSavedAt}
        </p>
        <p style={{ fontSize: 12, color: "#6b7280" }}>
          Created {new Date(cycle.createdAt).toLocaleDateString()} · updated {new Date(cycle.updatedAt).toLocaleDateString()}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={duplicateCycle} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff" }}>
            Duplicate this cycle
          </button>
          <button onClick={createNew} style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#b23121" }}>
            Create new (blank) cycle
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
          Duplicate copies all current data as-is (real or demo). Create new wipes evidence, findings and checklist
          data back to a blank workspace.
        </p>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 14 }}>
          Use Draft Workspace to save progress and review version history. Locked cycles cannot be edited except by unlocking from the Finalisation Checklist screen.
        </div>
      </Card>
    </div>

    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Departments</h3>
        <button
          onClick={() => { if (confirm("Reset departments to the default UCC list? This will replace all current departments.")) resetDepartments(); }}
          style={{ cursor: "pointer", fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#475569" }}
        >
          Reset to defaults
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        Shared department directory for this workspace. Auditor Creation, Auditor Checklist, Dashboard and the Export
        Centre all reference these records instead of free-typed department names.
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <input placeholder="Acronym (e.g. SQ)" value={deptForm.acronym} onChange={(e) => setDeptForm({ ...deptForm, acronym: e.target.value })} style={inputStyle} />
        <input placeholder="Full name" value={deptForm.fullName} onChange={(e) => setDeptForm({ ...deptForm, fullName: e.target.value })} style={inputStyle} />
        <input placeholder="Person in charge" value={deptForm.personInCharge} onChange={(e) => setDeptForm({ ...deptForm, personInCharge: e.target.value })} style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={submitDept} style={{ cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          {editingDeptId ? "Save changes" : "Add department"}
        </button>
        {editingDeptId && (
          <button onClick={cancelEditDept} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontWeight: 600, padding: "8px 14px", borderRadius: 8 }}>
            Cancel
          </button>
        )}
      </div>

      <table style={{ marginTop: 14 }}>
        <thead><tr><th>Acronym</th><th>With division</th><th>Full name</th><th>Person in charge</th><th></th></tr></thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id} className="rowh">
              <td><b>{d.acronym}</b></td>
              {/* UCC's own form. Composed from the division, never from a
                  document code: PPD-OE-FN-1.1.1 spells the same division
                  differently from every other OEE code, so a code built here
                  would be wrong some of the time and look authoritative. */}
              <td style={{ color: "#475569" }}>{departmentPair(d.acronym, (a) => departments.find((x) => x.acronym === a)?.divisionId) || "—"}</td>
              <td>{d.fullName || "—"}</td>
              <td style={{ color: "#6b7280" }}>{d.personInCharge || "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => startEditDept(d)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", marginRight: 6 }}>
                  Edit
                </button>
                <button onClick={() => removeDepartment(d.id)} style={{ cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>

    <PolicyRegisterCard
      edits={policyDocEdits}
      onEdit={setPolicyDocEdit}
      onClear={clearPolicyDocEdit}
      divisionOf={(a) => departments.find((x) => x.acronym === a)?.divisionId}
    />
    </div>
  );
}

// ── UCC's master Policy and Procedure register ───────────────────────────
//
// Version and date live here, on the setup page beside the department
// directory, because both are workspace-level registers set up once and read
// everywhere else. They are NOT on the Evidence Folder card, which shows them
// read-only: a version is a property of the document, not of one audit, and
// editing it in thirty places invites thirty different answers.
// Says so plainly when a code's own division differs from the directory's, so
// the one code that spells it "OE" is explained rather than looking like a bug.
function tipForOwner(parts: { division: string; unit: string }, divisionOf: (a: string) => string | undefined): string {
  const dir = divisionOf(parts.unit);
  return dir && dir !== parts.division
    ? `As written in the document code. The department directory records this division as "${dir}".`
    : "As written in the document code.";
}

function PolicyRegisterCard({ edits, onEdit, onClear, divisionOf }: {
  edits: Record<string, { version?: string; updatedAt?: string }>;
  onEdit: (code: string, patch: { version?: string; updatedAt?: string }) => void;
  onClear: (code: string) => void;
  divisionOf: (acronym: string) => string | undefined;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const views = useMemo(() => policyDocumentViews(edits), [edits]);
  const sections = useMemo(() => {
    const by = new Map<string, PolicyDocumentView[]>();
    for (const v of views) {
      if (!by.has(v.section)) by.set(v.section, []);
      by.get(v.section)!.push(v);
    }
    return [...by.entries()];
  }, [views]);
  const recorded = views.filter((v) => v.edited).length;

  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: 14 }}>Policy and Procedure register</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
        UCC's master list of controlled documents, {views.length} in total. This is where the app gets the owning
        department for each GD4 area: the department comes from the document code, so the app can only claim what your
        own filing claims. Enter a version and date here and every screen that shows the document shows them too.
        Version and date recorded on {recorded} of {views.length}.
      </p>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
        The ISMS, PDPA, AIMS and HIRA series are held here but are deliberately not attached to any GD4 area, because
        they are not GD4 audit scopes. Nothing in this app ever makes up a document code.
      </p>
      {sections.map(([section, docs]) => {
        const open = openSections[section] ?? section.startsWith("Criterion");
        return (
          <div key={section} style={{ marginTop: 12 }}>
            <button
              onClick={() => setOpenSections((o) => ({ ...o, [section]: !open }))}
              style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#f8fafc", color: INK, fontWeight: 700, fontSize: 12, padding: "6px 10px", borderRadius: 6, width: "100%", textAlign: "left" }}
            >
              {open ? "▾" : "▸"} {section} ({docs.length})
            </button>
            {open && (
              <table style={{ marginTop: 6 }}>
                <thead><tr><th>Document code</th><th>Title</th><th>GD4 area</th><th>Owner</th><th>Version</th><th>Last updated</th><th></th></tr></thead>
                <tbody>
                  {docs.map((d) => {
                    // Straight off the code, not composed from the department
                    // directory. PPD-OE-FN-1.1.1 says OE where the directory
                    // says OEE, and showing "OEE-FN" beside a code reading
                    // "OE-FN" reads as a contradiction. The register shows what
                    // the document says; the directory shows the org chart.
                    const parts = d.scopeId ? codeParts(d.code) : null;
                    return (
                      <tr key={d.code} className="rowh">
                        <td style={{ whiteSpace: "nowrap" }}><b>{d.code}</b>{d.primary && <span title="The owning document for this area" style={{ marginLeft: 6, fontSize: 10, color: "#475569" }}>primary</span>}</td>
                        <td>{d.title}</td>
                        <td style={{ whiteSpace: "nowrap", color: d.scopeId ? INK : "#94a3b8" }}>
                          {d.scopeId ? `${d.scopeId} ${scopeTitle(d.scopeId)}` : "Not a GD4 area"}
                        </td>
                        <td style={{ whiteSpace: "nowrap", color: "#475569" }} title={parts ? tipForOwner(parts, divisionOf) : undefined}>
                          {parts ? `${parts.division}-${parts.unit}` : "—"}
                        </td>
                        <td>
                          <input
                            aria-label={`Version for ${d.code}`}
                            placeholder="not recorded"
                            value={d.version}
                            onChange={(e) => onEdit(d.code, { version: e.target.value })}
                            style={{ ...inputStyle, width: 90, padding: "3px 6px", fontSize: 11 }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Last updated for ${d.code}`}
                            type="date"
                            value={d.updatedAt}
                            onChange={(e) => onEdit(d.code, { updatedAt: e.target.value })}
                            style={{ ...inputStyle, width: 140, padding: "3px 6px", fontSize: 11 }}
                          />
                        </td>
                        <td>
                          {d.edited && (
                            <button
                              onClick={() => onClear(d.code)}
                              title="Clear the version and date recorded for this document"
                              style={{ cursor: "pointer", fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                            >
                              Clear
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </Card>
  );
}
