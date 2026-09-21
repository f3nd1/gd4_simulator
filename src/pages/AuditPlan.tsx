import { useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useAllFindings } from "../hooks/useAllFindings";
import { Card, inputStyle } from "../components/ui/Card";
import { GOLD, INK } from "../lib/theme";
import { GD4_SUB_CRITERIA } from "../data/gd4Requirements";
import { runScopesForSub, scopeTitle } from "../lib/evidenceScope";
import { departmentForScope, departmentPair } from "../lib/departments";
import {
  emptySession, sortedSessions, sessionSlot, dayNumbers, sessionScopes, planWarnings,
  type AuditSession,
} from "../lib/auditPlan";
import { buildAuditWorkbook, workbookBytes, workbookFileName, XLSX_MIME, SHEET_NAMES } from "../lib/auditWorkbook";
import { downloadBinary } from "../lib/auditCsvExport";

const ALL_SCOPES = GD4_SUB_CRITERIA.flatMap((s) => runScopesForSub(s.id));

// The human-led internal audit plan: the header block and the timed schedule,
// and the one button that exports all three documents as a single workbook.
//
// Nothing on this page produces or reads a verdict. It records who is
// auditing what, when; the areas, requirement references, owning departments
// and controlled documents are all derived from data the app already holds.
export function AuditPlan() {
  const cycle = useWorkspaceStore((s) => s.cycle);
  const header = useWorkspaceStore((s) => s.auditPlan);
  const setAuditPlan = useWorkspaceStore((s) => s.setAuditPlan);
  const sessions = useWorkspaceStore((s) => s.auditSessions);
  const addAuditSession = useWorkspaceStore((s) => s.addAuditSession);
  const updateAuditSession = useWorkspaceStore((s) => s.updateAuditSession);
  const removeAuditSession = useWorkspaceStore((s) => s.removeAuditSession);
  const auditors = useWorkspaceStore((s) => s.auditors);
  const departments = useWorkspaceStore((s) => s.departments);
  const closures = useWorkspaceStore((s) => s.closures);
  const policyDocEdits = useWorkspaceStore((s) => s.policyDocEdits);
  const findings = useAllFindings();
  const [exported, setExported] = useState<string | null>(null);

  const ordered = useMemo(() => sortedSessions(sessions), [sessions]);
  const days = useMemo(() => dayNumbers(sessions), [sessions]);
  const warnings = useMemo(() => planWarnings(header, sessions), [header, sessions]);
  const divisionOf = (a: string) => departments.find((d) => d.acronym === a)?.divisionId;

  function exportWorkbook() {
    const name = workbookFileName(cycle);
    downloadBinary(
      workbookBytes(buildAuditWorkbook({ cycle, header, sessions, auditors, departments, findings, closures, policyDocEdits })),
      name,
      XLSX_MIME,
    );
    setExported(name);
  }

  return (
    <div className="grid gap-3">
      <Card>
        <h3 style={{ margin: 0, fontSize: 14 }}>Audit plan and schedule</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          The human-led internal audit: who is auditing what, and when. The areas, requirement references, owning
          departments and controlled documents are filled in from data the app already holds, so nothing here is typed
          twice. Nothing on this page produces or changes a verdict, a band or a score.
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <label style={{ fontSize: 11, color: "#475569" }}>Organisation
            <input aria-label="Organisation" value={header.organisation} onChange={(e) => setAuditPlan({ organisation: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: "#475569" }}>Lead auditor
            <input aria-label="Lead auditor" placeholder="Name" value={header.leadAuditor} onChange={(e) => setAuditPlan({ leadAuditor: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: "#475569" }}>Audit hours
            <input aria-label="Audit hours" placeholder="e.g. 16" value={header.auditHours} onChange={(e) => setAuditPlan({ auditHours: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
          </label>
        </div>
        <label style={{ fontSize: 11, color: "#475569", display: "block", marginTop: 8 }}>Exclusions
          <input aria-label="Exclusions" placeholder="Anything deliberately outside this audit" value={header.exclusions} onChange={(e) => setAuditPlan({ exclusions: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11, color: "#475569", display: "block", marginTop: 8 }}>Notes
          <input aria-label="Plan notes" placeholder="Opening meeting, distribution, anything else" value={header.notes} onChange={(e) => setAuditPlan({ notes: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <p style={{ fontSize: 11.5, color: "#6b7280", marginTop: 10, marginBottom: 0 }}>
          Cycle dates, scope and type come from Audit Cycle: <b>{cycle.name || "unnamed cycle"}</b>
          {cycle.periodStart && <> · {cycle.periodStart} to {cycle.periodEnd}</>}. The auditor list comes from Auditor
          Creation ({auditors.length} auditor{auditors.length === 1 ? "" : "s"}).
        </p>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Schedule ({sessions.length} session{sessions.length === 1 ? "" : "s"})</h3>
          <button onClick={() => addAuditSession(emptySession())} style={{ cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
            Add session
          </button>
        </div>
        {warnings.length > 0 && (
          <ul style={{ fontSize: 11.5, color: "#6b7280", margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {ordered.length === 0 && (
          <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>No sessions yet. Add one to start the schedule.</p>
        )}
        {ordered.map((s, idx) => (
          <SessionRow
            key={s.id}
            session={s}
            index={idx + 1}
            dayLabel={s.day ? `Day ${days.get(s.day)}` : ""}
            divisionOf={divisionOf}
            onChange={(patch) => updateAuditSession(s.id, patch)}
            onRemove={() => removeAuditSession(s.id)}
          />
        ))}
      </Card>

      <Card>
        <h3 style={{ margin: 0, fontSize: 14 }}>Export the audit set</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          One Excel workbook with three sheets, matching the format your ISO audits already use:
          {" "}{SHEET_NAMES.join(", ")}. The three sheets cross-reference each other by session number, which is why
          this is one file and not three. The findings log carries acknowledgement rather than an Official / Unofficial
          column, so an accepted nonconformity is still printed as a nonconformity.
        </p>
        <button onClick={exportWorkbook} style={{ cursor: "pointer", border: "none", background: INK, color: "#fff", fontWeight: 700, padding: "9px 16px", borderRadius: 8 }}>
          ⬇ Download workbook (.xlsx)
        </button>
        {exported && <div style={{ fontSize: 11.5, color: "#166534", marginTop: 8 }}>Saved {exported}</div>}
        <p style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 10, marginBottom: 0 }}>
          The existing CSV exports are unchanged. Use those for anything that comes back into the app: the Audit
          Checklist Library's CSV imports, this workbook does not.
        </p>
      </Card>
    </div>
  );
}

function SessionRow({ session: s, index, dayLabel, divisionOf, onChange, onRemove }: {
  session: AuditSession;
  index: number;
  dayLabel: string;
  divisionOf: (a: string) => string | undefined;
  onChange: (patch: Partial<AuditSession>) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const scopes = sessionScopes(s);
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, marginTop: 10, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Session {index}{dayLabel && ` · ${dayLabel}`}{sessionSlot(s) && ` · ${sessionSlot(s)}`}</span>
        <button onClick={onRemove} style={{ marginLeft: "auto", cursor: "pointer", fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}>Remove</button>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <label style={{ fontSize: 11, color: "#475569" }}>Date
          <input aria-label={`Date for session ${index}`} type="date" value={s.day} onChange={(e) => onChange({ day: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>Start
          <input aria-label={`Start time for session ${index}`} type="time" value={s.startTime} onChange={(e) => onChange({ startTime: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>Minutes
          <input aria-label={`Duration for session ${index}`} type="number" min={0} value={s.durationMins} onChange={(e) => onChange({ durationMins: Number(e.target.value) || 0 })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>Auditee function
          <input aria-label={`Auditee for session ${index}`} placeholder="e.g. Admissions" value={s.auditeeFunction} onChange={(e) => onChange({ auditeeFunction: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>Auditors
          <input aria-label={`Auditors for session ${index}`} placeholder="Names" value={s.auditorNames} onChange={(e) => onChange({ auditorNames: e.target.value })} style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
        </label>
      </div>

      <div style={{ marginTop: 8 }}>
        <button onClick={() => setPickerOpen((o) => !o)} style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", color: INK }}>
          {pickerOpen ? "▾" : "▸"} Areas to audit ({s.scopeIds.length})
        </button>
        {scopes.length > 0 && (
          <div style={{ fontSize: 11.5, color: "#475569", marginTop: 6, lineHeight: 1.6 }}>
            {scopes.map((x) => (
              <div key={x.scopeId}>
                <b>{x.scopeId}</b> {x.title} · {departmentPair(x.department, divisionOf)} · {x.documentCodes.join(", ") || "no controlled document"}
              </div>
            ))}
          </div>
        )}
        {pickerOpen && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 4, marginTop: 8, maxHeight: 260, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
            {ALL_SCOPES.map((id) => (
              <label key={id} style={{ fontSize: 11.5, color: "#334155", display: "flex", gap: 6, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  aria-label={`Area ${id} in session ${index}`}
                  checked={s.scopeIds.includes(id)}
                  onChange={(e) => onChange({ scopeIds: e.target.checked ? [...s.scopeIds, id] : s.scopeIds.filter((x) => x !== id) })}
                />
                <span><b>{id}</b> {scopeTitle(id)} <span style={{ color: "#94a3b8" }}>({departmentForScope(id)})</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
