import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { inputStyle } from "./Card";
import { GOLD, INK } from "../../lib/theme";
import {
  CALENDAR_HEADERS, rowsFromCsv, rowsFromGrid, buildImportPreview, applyImportPreview,
  calendarRowsOut, countsByKind, type ImportPreview,
} from "../../lib/iqaCalendar";
import { toCsv, downloadCsv } from "../../lib/auditCsvExport";
import { sessionKind } from "../../lib/auditPlan";

// Import the tentative IQA calendar, preview it, and only then write it.
//
// Nothing is saved until the preview is confirmed, and rows that do not fit
// are listed with their reason rather than dropped. The five columns the app
// owns (Criterion, Area title, Owning department, Document code, Auditor must
// be) are compared against the register and the independence rule but never
// imported, so the file cannot become a second source of truth.
export function CalendarImportPanel() {
  const sessions = useWorkspaceStore((s) => s.auditSessions);
  const setAuditSessions = useWorkspaceStore((s) => s.setAuditSessions);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [applied, setApplied] = useState<string | null>(null);
  const [rowsRead, setRowsRead] = useState(0);

  async function onFile(file: File) {
    setError(null); setApplied(null); setPreview(null); setMissing([]);
    setFileName(file.name);
    try {
      const isSheet = /\.(xlsx|xls)$/i.test(file.name);
      const read = isSheet
        ? rowsFromGrid(sheetGrid(await file.arrayBuffer()))
        : rowsFromCsv(await file.text());
      if (read.missingHeaders.length) setMissing(read.missingHeaders);
      if (!read.rows.length) { setError("That file has no rows under its header line."); return; }
      setRowsRead(read.rows.length);
      setPreview(buildImportPreview(read.rows, sessions));
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function confirm() {
    if (!preview) return;
    setAuditSessions(applyImportPreview(sessions, preview));
    setApplied(`${preview.create.length} added, ${preview.update.length} changed, ${preview.removed.length} removed, ${preview.unchanged} unchanged.`);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function exportCalendar() {
    downloadCsv(toCsv([...CALENDAR_HEADERS], calendarRowsOut(sessions)), "ucc_iqa_calendar.csv");
  }

  const counts = countsByKind(sessions);
  return (
    <div>
      <h3 style={{ margin: 0, fontSize: 14 }}>IQA calendar</h3>
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
        Import the calendar as a .csv or .xlsx instead of typing it in. Area title, owning department, document code
        and the independence rule are NOT imported: they are read, compared against the Policy and Procedure register
        and this app's own rule, and any disagreement is listed for you rather than quietly resolved. Nothing is saved
        until you confirm the preview.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          aria-label="IQA calendar file"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          style={{ ...inputStyle, padding: 6, fontSize: 12 }}
        />
        <button onClick={exportCalendar} disabled={!sessions.length} style={{ cursor: sessions.length ? "pointer" : "default", fontSize: 12, fontWeight: 700, padding: "7px 13px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: sessions.length ? INK : "#94a3b8" }}>
          ⬇ Export calendar (CSV)
        </button>
        <span style={{ fontSize: 11.5, color: "#64748b" }}>
          In the plan now: {counts.audit} audit, {counts.support} supporting, {counts.programme} programme day{counts.programme === 1 ? "" : "s"}.
        </span>
      </div>

      {error && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 8 }}>{error}</div>}
      {applied && <div style={{ fontSize: 12, color: "#166534", marginTop: 8 }}>Imported {fileName}. {applied}</div>}
      {missing.length > 0 && (
        <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 8 }}>
          Columns this file does not have: {missing.join(", ")}. Anything they would have filled in is left blank.
        </div>
      )}

      {preview && <PreviewPanel p={preview} rowsRead={rowsRead} fileName={fileName} onConfirm={confirm} onCancel={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }} />}
    </div>
  );
}

function sheetGrid(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false }) as string[][])
    .map((r) => r.map((c) => String(c ?? "")));
}

function PreviewPanel({ p, rowsRead, fileName, onConfirm, onCancel }: { p: ImportPreview; rowsRead: number; fileName: string; onConfirm: () => void; onCancel: () => void }) {
  // Rows in the FILE, not rows that landed. Counting only the ones that fitted
  // read as "1 row read" for a four-row file, which hid the three that did not.
  return (
    <div style={{ marginTop: 12, border: "1px solid #cbd5e1", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Preview of {fileName} — nothing has been saved yet</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.7 }}>
        {rowsRead} row{rowsRead === 1 ? "" : "s"} in this file.
        {" "}<b>{p.create.length}</b> to add, <b>{p.update.length}</b> to change, <b>{p.unchanged}</b> already the same,
        {" "}<b>{p.removed.length}</b> to remove, <b>{p.rejected.length}</b> that do not fit.
        {p.keptByHand > 0 && <> {p.keptByHand} session{p.keptByHand === 1 ? "" : "s"} you added by hand will not be touched.</>}
      </div>

      <Block label={`To add (${p.create.length})`} open={p.create.length > 0}>
        {p.create.map((s) => (
          <div key={s.id} style={rowStyle}>
            {s.day} {s.startTime && `${s.startTime} `}· {sessionKind(s)} · {s.activityType || "(no activity type)"}
            {s.scopeIds[0] && <> · <b>{s.scopeIds[0]}</b></>}
            {s.status && <span style={pillStyle}>{s.status}</span>}
          </div>
        ))}
      </Block>

      <Block label={`To change (${p.update.length})`} open={p.update.length > 0}>
        {p.update.map((u) => (
          <div key={u.before.id} style={rowStyle}>
            {u.after.day} {u.after.startTime} · {u.after.activityType}{u.after.scopeIds[0] ? ` · ${u.after.scopeIds[0]}` : ""}
            <div style={{ color: "#b45309", marginLeft: 10 }}>{u.changes.join(" · ")}</div>
          </div>
        ))}
      </Block>

      <Block label={`To remove — from an earlier import, not in this file (${p.removed.length})`} open={p.removed.length > 0}>
        {p.removed.map((s) => <div key={s.id} style={rowStyle}>{s.day} {s.startTime} · {s.activityType}{s.scopeIds[0] ? ` · ${s.scopeIds[0]}` : ""}</div>)}
      </Block>

      <Block label={`Does not fit (${p.rejected.length})`} open={p.rejected.length > 0} tone="#b91c1c">
        {p.rejected.map((r) => (
          <div key={r.rowNumber} style={rowStyle}>
            <b>Row {r.rowNumber}</b> — {r.reason}
            <div style={{ color: "#94a3b8", marginLeft: 10 }}>{r.summary}</div>
          </div>
        ))}
      </Block>

      <Block label={`Disagrees with the register (${p.disagreements.length})`} open={p.disagreements.length > 0} tone="#b45309">
        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 4 }}>
          The register's value is what gets used. These are listed so you can correct whichever side is wrong.
        </div>
        {p.disagreements.map((d, n) => (
          <div key={n} style={rowStyle}>
            <b>Row {d.rowNumber}</b> · {d.scopeId} · {d.field}: file says "{d.inFile}", register says "{d.inRegister}"
          </div>
        ))}
      </Block>

      <Block label={`Independence differs from this app's rule (${p.independence.length})`} open={p.independence.length > 0} tone="#b45309">
        {p.independence.map((m, n) => (
          <div key={n} style={rowStyle}>
            <b>Row {m.rowNumber}</b> · {m.scopeId}: file says "{m.inFile}", this app says "{m.appSays}"
          </div>
        ))}
      </Block>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={onConfirm} style={{ cursor: "pointer", border: "none", background: GOLD, color: "#16202e", fontWeight: 700, padding: "8px 16px", borderRadius: 8 }}>
          Import these {p.create.length + p.update.length + p.removed.length} changes
        </button>
        <button onClick={onCancel} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontWeight: 600, padding: "8px 16px", borderRadius: 8 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const rowStyle = { fontSize: 11.5, color: "#334155", padding: "2px 0", lineHeight: 1.6 } as const;
const pillStyle = { marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "1px 6px" } as const;

function Block({ label, open: initial, tone, children }: { label: string; open: boolean; tone?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", border: "none", background: "transparent", padding: 0, fontSize: 11.5, fontWeight: 700, color: tone ?? "#475569" }}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div style={{ marginTop: 2, marginLeft: 12, maxHeight: 260, overflowY: "auto" }}>{children}</div>}
    </div>
  );
}
