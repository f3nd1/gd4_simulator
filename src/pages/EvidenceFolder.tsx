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

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>Evidence folder index</h3>
      <p style={{ fontSize: 12.5, color: "#6b7280", marginTop: 0 }}>
        One evidence folder per GD4 sub-criterion. All folders live in Google Drive — the owning department is set up on the Audit Cycle page.
        "Check access" confirms this app can see the folder's files (including subfolders). "Run audit" does the whole pipeline in one click:
        it generates the Sub-Criterion Checklist lines if none exist yet, reads every supported file (PDF, Word, text/CSV, and images via AI),
        sets each line's status, and updates the band/score — shown in the result line below. To audit every linked folder at once, use
        "Audit all folders → score" on the Dashboard. Both require connecting Google Drive in Settings first.
      </p>

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

      <table>
        <thead>
          <tr><th>Sub-criterion</th><th>Owner</th><th>Status</th><th>Link</th><th>Last checked</th><th>Action</th></tr>
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
                    placeholder="https://drive.google.com/…"
                    value={f.folderLink || ""}
                    onChange={(e) => setFolderField(f.id, "folderLink", e.target.value)}
                    style={{ ...inputStyle, width: 140, padding: "4px 6px" }}
                  />
                  {f.folderLink && (
                    <a href={f.folderLink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, marginLeft: 4 }}>
                      Open
                    </a>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    value={f.lastCheckedDate || ""}
                    onChange={(e) => setFolderField(f.id, "lastCheckedDate", e.target.value)}
                    style={{ ...inputStyle, width: 130, padding: "4px 6px" }}
                  />
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      disabled={busy === "folderaccess" + f.id}
                      onClick={() => checkFolderAccess(f.id)}
                      style={{ cursor: "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", whiteSpace: "nowrap" }}
                    >
                      {busy === "folderaccess" + f.id ? "Checking…" : "Check access"}
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
              {f.accessCheckNote && (
                <tr>
                  <td colSpan={6} style={{ background: "#f8fafc", fontSize: 12, padding: "6px 10px" }}>
                    <Pill s={ACCESS_TONE[f.accessCheckStatus || "Not Connected"]}>{f.accessCheckStatus || "Not Connected"}</Pill>{" "}
                    {f.accessCheckNote} <span style={{ color: "#94a3b8" }}>— checked {f.accessCheckAt && new Date(f.accessCheckAt).toLocaleString()}</span>
                  </td>
                </tr>
              )}
              {f.lastAuditSummary && (
                <tr>
                  <td colSpan={6} style={{ background: "#f0fdf4", fontSize: 12, padding: "6px 10px" }}>
                    <Pill s="good">Audit</Pill>{" "}
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
