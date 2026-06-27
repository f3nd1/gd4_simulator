import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { Card, inputStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { FolderStatus } from "../types";

const SUMMARY_CAP = 180; // chars shown before the audit summary collapses

const STATUSES: FolderStatus[] = ["Good", "In Progress", "Partial", "Missing"];
const ACCESS_TONE = { Connected: "good", Error: "critical", "Not Connected": "medium" } as const;

export function EvidenceFolder() {
  const folders = useWorkspaceStore((s) => s.folders);
  const departments = useWorkspaceStore((s) => s.departments);
  const setFolderField = useWorkspaceStore((s) => s.setFolderField);
  const checkFolderAccess = useWorkspaceStore((s) => s.checkFolderAccess);
  const auditFolderContents = useWorkspaceStore((s) => s.auditFolderContents);
  const busy = useWorkspaceStore((s) => s.busy);
  const additionalInfo = useWorkspaceStore((s) => s.additionalInfo);
  const setAdditionalInfoLink = useWorkspaceStore((s) => s.setAdditionalInfoLink);
  const checkAdditionalInfoAccess = useWorkspaceStore((s) => s.checkAdditionalInfoAccess);
  const [checkingAdditional, setCheckingAdditional] = useState(false);

  // Deep link from the Dashboard recheck report (/evidence-folder?sub=1.1):
  // scroll the matching folder row into view and briefly highlight it so the
  // auditor doesn't have to hunt for it among all 24.
  const [searchParams] = useSearchParams();
  const focusSub = searchParams.get("sub");
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  useEffect(() => {
    if (!focusSub) return;
    const row = rowRefs.current[focusSub];
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.style.transition = "background 0.3s";
    row.style.background = "#fff7e0";
    const t = setTimeout(() => {
      row.style.background = "";
    }, 2200);
    return () => clearTimeout(t);
  }, [focusSub, folders]);

  // Filter by criterion (e.g. "1") and/or sub-criterion (e.g. "1.2"), derived
  // from the folders themselves so the options always match what's present.
  const [critFilter, setCritFilter] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const criteria = useMemo(() => [...new Set(folders.map((f) => f.subCriterionId.split(".")[0]))].sort((a, b) => Number(a) - Number(b)), [folders]);
  const subCriteria = useMemo(
    () => folders.filter((f) => !critFilter || f.subCriterionId.split(".")[0] === critFilter).map((f) => ({ id: f.subCriterionId, name: f.folderName })),
    [folders, critFilter]
  );
  const visibleFolders = folders.filter(
    (f) => (!critFilter || f.subCriterionId.split(".")[0] === critFilter) && (!subFilter || f.subCriterionId === subFilter)
  );

  // Per-row "show full audit summary" toggles (summaries can be long).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Two tabs: each sub-criterion has a Policy & Procedure folder and an Actual
  // Evidence folder. The Link column + Check access act on the active tab;
  // Run audit reads both. Default to Evidence so existing single-link
  // workspaces show their folders straight away.
  const [tab, setTab] = useState<"policy" | "evidence">("evidence");
  const isPolicy = tab === "policy";
  const linkField: "policyLink" | "folderLink" = isPolicy ? "policyLink" : "folderLink";
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Evidence folder index</h3>
        <button onClick={() => setShowHelp((h) => !h)} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "3px 8px", color: "#6b7280" }}>
          {showHelp ? "Hide help" : "Show help"}
        </button>
      </div>
      {showHelp && (
        <>
          <p style={{ fontSize: 12.5, color: "#6b7280" }}>
            One evidence folder per GD4 sub-criterion. All folders live in Google Drive — the owning department is set up on the Audit Cycle page.
            "Check access" confirms this app can see the folder's files (including subfolders). "Run audit" does the whole pipeline in one click:
            it generates the Sub-Criterion Checklist lines if none exist yet, reads every supported file (PDF, Word, text/CSV, and images via AI),
            sets each line's status, and updates the band/score — shown in the result line below. To audit every linked folder at once, use
            "Audit all folders → score" on the Dashboard. Both require connecting Google Drive in Settings first.
          </p>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", background: "#f8fafc", marginBottom: 10, fontSize: 12 }}>
            <b style={{ fontSize: 11.5, color: "#475569" }}>Link two folders per sub-criterion, using the tabs below:</b>
            <ol style={{ margin: "4px 0 4px", paddingLeft: 18, color: "#475569" }}>
              <li><b>1. Policy &amp; Procedure</b> — the documented approach</li>
              <li><b>2. Actual Evidence</b> — records showing it is implemented</li>
            </ol>
            <span style={{ color: "#6b7280" }}>
              "Run audit" reads both folders and reports a per-type breakdown. (If you only link one, the audit still works and falls back to reading subfolders named "Policy"/"Procedure" inside it.) General, school-wide documents that aren't tied to one sub-criterion go in the <b>Additional info</b> folder below. Omit NRIC/FIN details before uploading.
            </span>
          </div>
        </>
      )}

      <div style={{ border: "1px solid #d8c7a4", borderRadius: 10, padding: "10px", background: "#fffaf0", marginBottom: 12, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <b style={{ fontSize: 12, color: "#7a5b12" }}>Additional info — general supporting documents (school-wide, applies to all criteria)</b>
          {additionalInfo.accessStatus && <Pill s={ACCESS_TONE[additionalInfo.accessStatus]}>{additionalInfo.accessStatus}</Pill>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
          <input
            placeholder="https://drive.google.com/drive/folders/…"
            value={additionalInfo.link || ""}
            onChange={(e) => setAdditionalInfoLink(e.target.value)}
            style={{ ...inputStyle, width: 280, padding: "4px 6px" }}
          />
          {additionalInfo.link && <a href={additionalInfo.link} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>Open</a>}
          <button
            disabled={checkingAdditional}
            onClick={async () => {
              setCheckingAdditional(true);
              try { await checkAdditionalInfoAccess(); } finally { setCheckingAdditional(false); }
            }}
            style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
          >
            {checkingAdditional ? "Checking…" : "Check access"}
          </button>
        </div>
        {additionalInfo.accessNote && (
          <div style={{ fontSize: 11.5, color: "#6b7280", marginBottom: 4 }}>
            {additionalInfo.accessNote}{additionalInfo.accessAt && <span style={{ color: "#94a3b8" }}> — checked {new Date(additionalInfo.accessAt).toLocaleString()}</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.3 }}>Filter</span>
        <select
          value={critFilter}
          onChange={(e) => { setCritFilter(e.target.value); setSubFilter(""); }}
          style={{ ...inputStyle, width: 150, padding: "5px 6px" }}
        >
          <option value="">All criteria</option>
          {criteria.map((c) => <option key={c} value={c}>Criterion {c}</option>)}
        </select>
        <select value={subFilter} onChange={(e) => setSubFilter(e.target.value)} style={{ ...inputStyle, width: 230, padding: "5px 6px" }}>
          <option value="">All sub-criteria</option>
          {subCriteria.map((s) => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
        </select>
        {(critFilter || subFilter) && (
          <button onClick={() => { setCritFilter(""); setSubFilter(""); }} style={{ cursor: "pointer", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 6, fontSize: 11, padding: "5px 9px" }}>
            Clear
          </button>
        )}
        <span style={{ fontSize: 11.5, color: "#94a3b8", marginLeft: "auto" }}>
          Showing {visibleFolders.length} of {folders.length}
        </span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 0, borderBottom: "2px solid #e2e8f0" }}>
        {([["policy", "1. Policy & Procedure"], ["evidence", "2. Actual Evidence"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              cursor: "pointer",
              border: "none",
              background: "transparent",
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              color: tab === key ? "#1f2937" : "#94a3b8",
              borderBottom: tab === key ? "2px solid #b8860b" : "2px solid transparent",
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: "#94a3b8" }}>
          {isPolicy ? "The documented approach" : "Records showing it's implemented"} · Run audit reads both tabs
        </span>
      </div>

      <table>
        <thead>
          <tr><th>Sub-criterion</th><th>Owner</th><th>Status</th><th>{isPolicy ? "Policy link" : "Evidence link"}</th><th>Last checked</th><th>Action</th></tr>
        </thead>
        <tbody>
          {visibleFolders.map((f) => (
            <Fragment key={f.id}>
              <tr className="rowh" ref={(el) => { rowRefs.current[f.subCriterionId] = el; }}>
                <td><b>{f.folderName}</b></td>
                <td>
                  <select value={f.owner} onChange={(e) => setFolderField(f.id, "owner", e.target.value)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                    <option value="">(unassigned)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.acronym}>
                        {d.acronym}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={f.status} onChange={(e) => setFolderField(f.id, "status", e.target.value as FolderStatus)} style={{ ...inputStyle, width: 110, padding: "4px 6px" }}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    placeholder={isPolicy ? "Policy folder link…" : "Evidence folder link…"}
                    value={f[linkField] || ""}
                    onChange={(e) => setFolderField(f.id, linkField, e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: "4px 6px" }}
                  />
                  {f[linkField] && (
                    <a href={f[linkField]} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, marginLeft: 4 }}>
                      Open
                    </a>
                  )}
                </td>
                <td style={{ fontSize: 11.5, color: "#475569", whiteSpace: "nowrap" }}>
                  {(() => {
                    const at = isPolicy ? f.policyAccessAt : f.accessCheckAt;
                    return at ? new Date(at).toLocaleString() : <span style={{ color: "#cbd5e1" }}>— not checked</span>;
                  })()}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      disabled={busy === `folderaccess:${tab}:` + f.id}
                      onClick={() => checkFolderAccess(f.id, tab)}
                      style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
                    >
                      {busy === `folderaccess:${tab}:` + f.id ? "Checking…" : "Check access"}
                    </button>
                    <button
                      disabled={busy === "folderaudit" + f.id}
                      onClick={() => auditFolderContents(f.id)}
                      style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
                    >
                      {busy === "folderaudit" + f.id ? "Auditing…" : "Run audit"}
                    </button>
                  </div>
                </td>
              </tr>
              {(isPolicy ? f.policyAccessNote : f.accessCheckNote) && (
                <tr>
                  <td colSpan={6} style={{ background: "#f8fafc", fontSize: 12, padding: "6px 10px" }}>
                    <Pill s={ACCESS_TONE[(isPolicy ? f.policyAccessStatus : f.accessCheckStatus) || "Not Connected"]}>{(isPolicy ? f.policyAccessStatus : f.accessCheckStatus) || "Not Connected"}</Pill>{" "}
                    {isPolicy ? f.policyAccessNote : f.accessCheckNote}{" "}
                    <span style={{ color: "#94a3b8" }}>— checked {(isPolicy ? f.policyAccessAt : f.accessCheckAt) && new Date((isPolicy ? f.policyAccessAt : f.accessCheckAt)!).toLocaleString()}</span>
                  </td>
                </tr>
              )}
              {f.lastAuditSummary && (
                <tr>
                  <td colSpan={6} style={{ background: "#f0fdf4", fontSize: 12, padding: "6px 10px" }}>
                    <Pill s="good">Audit</Pill>{" "}
                    <Pill s={f.lastAuditLive ? "progress" : "medium"}>{f.lastAuditLive ? "AI" : "Offline estimate"}</Pill>{" "}
                    {f.lastAuditLive === false && f.lastAuditError && (
                      <span style={{ color: "#9a6b15" }} title={f.lastAuditError}>(AI unavailable — used keyword fallback) </span>
                    )}
                    {f.lastAuditSummary.length > SUMMARY_CAP && !expanded[f.id]
                      ? `${f.lastAuditSummary.slice(0, SUMMARY_CAP)}… `
                      : `${f.lastAuditSummary} `}
                    {f.lastAuditSummary.length > SUMMARY_CAP && (
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [f.id]: !e[f.id] }))}
                        style={{ cursor: "pointer", border: "none", background: "transparent", color: "#2563eb", fontSize: 11.5, padding: 0, textDecoration: "underline" }}
                      >
                        {expanded[f.id] ? "Show less" : "Show full result"}
                      </button>
                    )}{" "}
                    <span style={{ color: "#94a3b8" }}>— audited {f.lastAuditAt && new Date(f.lastAuditAt).toLocaleString()}</span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
