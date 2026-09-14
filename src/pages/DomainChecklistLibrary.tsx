import { useMemo, useRef, useState } from "react";
import { Card, inputStyle, filterSelectStyle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { PARSED_DOMAIN_FILES, DOMAIN_EXPERTISE_LABELS, domainExpertiseFor } from "../data/skills/domainExpertise";
import { useChecklistVerdictStore, type StoredChecklistVerdict } from "../store/useChecklistVerdictStore";
import { assembleVerdictRows, buildChecklistVerdictCsv, NOT_YET_ASSESSED } from "../lib/checklistVerdictExport";
import { GD4_CRITERIA } from "../data/gd4Requirements";
import { scopeTitle } from "../lib/evidenceScope";
import { DOMAIN_SKILL_CONSUMERS } from "../lib/domainSkillUsage";
import { downloadCsv } from "../lib/auditCsvExport";
import { assembleWorksheetRows, buildWorksheetCsv, type AskType, type WorksheetQuestion } from "../lib/manualWorksheet";
import { runWorksheetConversion } from "../lib/ai/worksheetWriter";
import { aiOfflineReason } from "../lib/ai/aiClient";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useWorksheetQuestionStore, questionSourceHash, questionStateFor, type QuestionState } from "../store/useWorksheetQuestionStore";
import {
  domainRowsFor,
  buildDomainChecklistCsv,
  mergeDomainChecklistCsv,
  subCriterionOfRef,
  SECTION_KIND_LABEL,
  type DomainChecklistRow,
  type DomainImportReport,
  type DomainSectionKind,
} from "../lib/domainChecklist";
import { useDomainChecklistStore } from "../store/useDomainChecklistStore";

// The Audit Checklist Library: the in-app editor for the criterion domain-
// expertise checklists that ship as src/data/skills/criterion-{1..7}-*.md and
// are injected into every AI audit call for that criterion.
//
// The markdown files stay the seed; this page stores only a diff (edit /
// hide / add), so an untouched install sends the AI exactly what it always
// did. The "Text sent to the AI" panel below each criterion renders the real
// composed output, so what you read here is what the model reads.

const CRITERION_IDS = ["1", "2", "3", "4", "5", "6", "7"];

// The walkthrough question's state against its check. "Stale" is shown rather
// than silently serving text written from wording that has since changed.
const QUESTION_TONE: Record<QuestionState, string> = {
  missing: "neutral", current: "good", stale: "medium", "old-prompt": "medium", edited: "progress", "edited-stale": "medium",
};
const QUESTION_LABEL: Record<QuestionState, string> = {
  missing: "No question yet",
  current: "Question ready",
  stale: "Stale — check changed since",
  "old-prompt": "Written by an older question writer",
  edited: "Your wording",
  "edited-stale": "Your wording · check changed since",
};

const VERDICT_TONE: Record<string, string> = {
  Met: "good",
  Partial: "medium",
  "Not met": "critical",
  "Not applicable": "neutral",
  "Not assessed": "neutral",
};

const STATUS_TONE: Record<DomainChecklistRow["status"], string> = {
  "built-in": "neutral",
  "built-in-edited": "progress",
  "custom-active": "good",
  "custom-draft": "medium",
  removed: "critical",
};

const STATUS_LABEL: Record<DomainChecklistRow["status"], string> = {
  "built-in": "Built-in",
  "built-in-edited": "Edited",
  "custom-active": "Added · active",
  "custom-draft": "Added · draft",
  removed: "Hidden",
};

// The checks are markdown that goes to the AI verbatim, so **bold**/*italic*
// markers are part of the payload and MUST survive an edit. They are rendered
// here for readability only; the edit box always shows the raw text, so the
// markers stay visible exactly where they can be changed.
function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <b key={i}>{p.slice(2, -2)}</b>;
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <i key={i}>{p.slice(1, -1)}</i>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const muted: React.CSSProperties = { fontSize: 11.5, color: "#94a3b8" };
const btn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
  border: "1px solid #cbd5e1", background: "#fff", color: "#334155", cursor: "pointer", whiteSpace: "nowrap",
};
const btnPrimary: React.CSSProperties = { ...btn, border: "1px solid #99f6e4", background: "#f0fdfa", color: "#0f766e" };
const btnDanger: React.CSSProperties = { ...btn, border: "1px solid #fecaca", color: "#b91c1c" };
// Compact control for the per-question row, where four sit side by side.
const iconBtn: React.CSSProperties = { ...btn, padding: "1px 6px", fontSize: 11, lineHeight: 1.5 };

export function DomainChecklistLibrary() {
  const overrides = useDomainChecklistStore((s) => s.overrides);
  const editItem = useDomainChecklistStore((s) => s.editItem);
  const revertItem = useDomainChecklistStore((s) => s.revertItem);
  const setRemoved = useDomainChecklistStore((s) => s.setRemoved);
  const addItem = useDomainChecklistStore((s) => s.addItem);
  const updateCustom = useDomainChecklistStore((s) => s.updateCustom);
  const setVerified = useDomainChecklistStore((s) => s.setVerified);
  const deleteCustom = useDomainChecklistStore((s) => s.deleteCustom);
  const replaceOverrides = useDomainChecklistStore((s) => s.replaceOverrides);
  const resetAll = useDomainChecklistStore((s) => s.resetAll);

  const [critFilter, setCritFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | DomainSectionKind>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addSection, setAddSection] = useState("");
  const [addText, setAddText] = useState("");
  const [addRefs, setAddRefs] = useState("");
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [importReport, setImportReport] = useState<DomainImportReport | null>(null);
  const [worksheet, setWorksheet] = useState<string | null>(null);
  const [worksheetBusy, setWorksheetBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiSettings = useAISettingsStore((s) => s);
  const questions = useWorksheetQuestionStore((s) => s.entries);
  // Read here as well as inside ChecklistVerdicts: the export needs the whole
  // map, and the count drives the button label.
  const verdicts = useChecklistVerdictStore((s) => s.entries);
  const verdictCount = Object.keys(verdicts).length;
  const putQuestions = useWorksheetQuestionStore((s) => s.putMany);
  const editQuestion = useWorksheetQuestionStore((s) => s.editQuestion);
  const addQuestion = useWorksheetQuestionStore((s) => s.addQuestion);
  const removeQuestion = useWorksheetQuestionStore((s) => s.removeQuestion);
  const moveQuestion = useWorksheetQuestionStore((s) => s.moveQuestion);
  // Which single question is open for editing, as "<checkId>|<questionId>".
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [qText, setQText] = useState("");
  const [qType, setQType] = useState<AskType>("Document");
  // Which check has its "add a question" form open.
  const [addingQuestionFor, setAddingQuestionFor] = useState<string | null>(null);
  // Local to this component, never a module singleton — that is what kept the
  // audit runs' shared-abort bug from being reintroduced here.
  const worksheetAbort = useRef<AbortController | null>(null);

  const rowsByCriterion = useMemo(() => {
    const out: Record<string, DomainChecklistRow[]> = {};
    for (const cid of CRITERION_IDS) out[cid] = domainRowsFor(PARSED_DOMAIN_FILES[cid], overrides);
    return out;
  }, [overrides]);

  const allRows = useMemo(() => CRITERION_IDS.flatMap((c) => rowsByCriterion[c]), [rowsByCriterion]);

  const stats = useMemo(() => ({
    total: allRows.length,
    edited: allRows.filter((r) => r.status === "built-in-edited").length,
    active: allRows.filter((r) => r.status === "custom-active").length,
    draft: allRows.filter((r) => r.status === "custom-draft").length,
    hidden: allRows.filter((r) => r.status === "removed").length,
  }), [allRows]);

  // Sub-criteria that actually appear as a tag, so the filter never offers a
  // value that would return nothing.
  const subOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      if (critFilter !== "all" && r.criterionId !== critFilter) continue;
      for (const ref of r.subCriterionIds) set.add(subCriterionOfRef(ref));
    }
    return [...set].sort();
  }, [allRows, critFilter]);

  const matches = (r: DomainChecklistRow) => {
    if (critFilter !== "all" && r.criterionId !== critFilter) return false;
    if (kindFilter !== "all" && r.sectionKind !== kindFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    // A check with no ref is criterion-wide, and MUST still show when a
    // sub-criterion is selected: filtering 4.2 used to hide every C4 red flag,
    // so the walkthrough sheet for 4.2 silently lost the FPS checks. It is
    // labelled "applies across criterion N" on the row so it reads as scope,
    // not as a mis-tag.
    if (subFilter !== "all") {
      const tagged = r.subCriterionIds.some((ref) => subCriterionOfRef(ref) === subFilter);
      const criterionWide = r.subCriterionIds.length === 0 && r.criterionId === subCriterionOfRef(subFilter).split(".")[0];
      if (!tagged && !criterionWide) return false;
    }
    const q = search.trim().toLowerCase();
    if (q && !r.text.toLowerCase().includes(q) && !r.sectionKey.toLowerCase().includes(q)) return false;
    return true;
  };

  const visibleCount = allRows.filter(matches).length;

  const startEdit = (r: DomainChecklistRow) => { setEditingId(r.id); setDraftText(r.text); };
  const saveEdit = (r: DomainChecklistRow) => {
    const text = draftText.trim();
    if (!text) return;
    if (r.custom) updateCustom(r.id, text);
    else if (text === r.originalText) revertItem(r.id);
    else editItem(r.id, text);
    setEditingId(null);
  };

  const submitAdd = () => {
    const text = addText.trim();
    if (!addingFor || !addSection || !text) return;
    addItem({ criterionId: addingFor, sectionKey: addSection, text, subCriteriaText: addRefs, note: "Added in the Audit Checklist Library" });
    setAddText(""); setAddRefs(""); setAddingFor(null);
  };

  const onExport = () => {
    const rows = allRows.filter(matches);
    downloadCsv(buildDomainChecklistCsv(rows), `gd4-audit-checklist-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // Walkthrough questions are a stored property of each check now, so the page
  // can answer "which of these need writing?" without any AI call.
  const stateOf = (r: DomainChecklistRow): QuestionState => questionStateFor(questions[r.id], r.text);
  const needsWriting = (r: DomainChecklistRow) => {
    const st = stateOf(r);
    // "edited-stale" is deliberately excluded: the user reworded it by hand, so
    // a bulk regeneration must warn about it, never overwrite it.
    // "old-prompt" IS included: the check is unchanged but an older writer
    // produced the question, and rewriting it is the whole point of the badge.
    return st === "missing" || st === "stale" || st === "old-prompt";
  };

  const questionsToWrite = allRows.filter(matches).filter((r) => r.status !== "removed").filter(needsWriting).length;

  // Regeneration is always explicit and always scoped — one check, or the
  // missing/stale ones in view. Nothing regenerates on its own.
  const generateQuestions = async (targets: DomainChecklistRow[], label: string) => {
    if (targets.length === 0) { setWorksheet("Walkthrough questions: every check in view already has one. Nothing to write."); return; }
    const offline = aiOfflineReason(aiSettings);
    if (offline) { setWorksheet(`Walkthrough questions are written by AI, and ${offline}`); return; }

    const ctrl = new AbortController();
    worksheetAbort.current = ctrl;
    setWorksheetBusy(true);
    setWorksheet(`Walkthrough questions: writing ${label}…`);
    try {
      const { questionsById, failed } = await runWorksheetConversion(targets, aiSettings, {
        signal: ctrl.signal,
        onProgress: (p) => setWorksheet(`Walkthrough questions: writing ${label}… ${p.done} of ${p.total}`),
      });
      const next: Record<string, { questions: WorksheetQuestion[]; sourceHash: string }> = {};
      let questionCount = 0;
      for (const r of targets) {
        const qs = questionsById.get(r.id);
        if (qs && qs.length > 0) { next[r.id] = { questions: qs, sourceHash: questionSourceHash(r.text) }; questionCount += qs.length; }
      }
      putQuestions(next);
      const checksWritten = Object.keys(next).length;
      setWorksheet(
        ctrl.signal.aborted
          ? `Walkthrough questions: cancelled after writing ${questionCount} question${questionCount === 1 ? "" : "s"} for ${checksWritten} check${checksWritten === 1 ? "" : "s"}. Those are saved, so starting again picks up where it stopped.`
          : `Walkthrough questions: wrote ${questionCount} question${questionCount === 1 ? "" : "s"} across ${checksWritten} check${checksWritten === 1 ? "" : "s"}.` +
            (failed.length > 0 ? ` ${failed.length} check${failed.length === 1 ? "" : "s"} could not be written and stayed empty.` : "")
      );
    } catch (e) {
      setWorksheet(`Walkthrough questions: could not write them — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorksheetBusy(false);
      worksheetAbort.current = null;
    }
  };

  const saveQuestionEdit = (checkId: string, questionId: string) => {
    editQuestion(checkId, questionId, qText.trim(), qType);
    setEditingQuestionId(null);
  };

  const saveQuestionAdd = (r: DomainChecklistRow) => {
    addQuestion(r.id, qText.trim(), qType, questionSourceHash(r.text));
    setAddingQuestionFor(null);
    setQText("");
  };

  // The second, one-way export: the same checks turned into walkthrough
  // questions with blank answer columns. Deliberately NOT importable — it
  // carries no item_id or status, so it can never be fed back over the
  // edit format above.
  // The second, one-way export. It now writes what is already stored and makes
  // NO AI call at all: the questions live against their checks, so exporting is
  // a local file write. A check with no question yet still gets its row, with
  // the Describe and Show me cells blank and the count reported — silently
  // dropping it would hand Felix a worksheet that is quietly short.
  const onExportWorksheet = () => {
    const rows = allRows.filter(matches).filter((r) => r.status !== "removed");
    if (rows.length === 0) { setWorksheet("Manual worksheet: nothing to export — no checks match the current filters."); return; }

    const byId = new Map(rows.map((r) => [r.id, questions[r.id]?.questions ?? []]));
    const out = assembleWorksheetRows(rows, byId, { keepEmpty: true });
    downloadCsv(buildWorksheetCsv(out), `gd4-manual-worksheet-${new Date().toISOString().slice(0, 10)}.csv`);

    const missing = rows.filter((r) => (questions[r.id]?.questions ?? []).length === 0).length;
    const stale = rows.filter((r) => stateOf(r) === "stale" || stateOf(r) === "edited-stale").length;
    setWorksheet(
      `Manual worksheet: downloaded ${out.length} row${out.length === 1 ? "" : "s"} from ${rows.length} checks, with no AI call.` +
      (missing > 0 ? ` ${missing} check${missing === 1 ? " has" : "s have"} no question yet — those rows are blank.` : "") +
      (stale > 0 ? ` ${stale} question${stale === 1 ? " is" : "s are"} older than the check text.` : "")
    );
  };

  // Third export: the AI verdicts already stored against these checks. Purely a
  // local file write — no AI call, nothing generated, and it never merges the
  // policy and evidence buckets into one verdict (see checklistVerdictExport).
  //
  // Checks with no verdict yet are KEPT, marked "Not yet assessed". Measured on
  // the real library: every one of the 155 checks is reachable by auditing a
  // sub-criterion it applies to, so an empty row always means "no audit has
  // covered this area yet", which is the actionable half of the file. Unfiltered
  // after one sub-criterion that is 142 of 168 rows, so the count is reported
  // and the page's own filters are the way to narrow it.
  const onExportVerdicts = () => {
    const rows = allRows.filter(matches).filter((r) => r.status !== "removed");
    if (rows.length === 0) { setWorksheet("AI verdicts: nothing to export — no checks match the current filters."); return; }

    const shown = new Set(rows.map((r) => r.id));
    const mine = Object.values(verdicts).filter((v) => shown.has(v.checkId));
    const out = assembleVerdictRows(rows, mine);
    downloadCsv(buildChecklistVerdictCsv(out), `gd4-checklist-verdicts-${new Date().toISOString().slice(0, 10)}.csv`);

    const unassessed = out.filter((r) => r.verdict === NOT_YET_ASSESSED).length;
    const stale = out.filter((r) => r.stale === "Yes").length;
    setWorksheet(
      `AI verdicts: downloaded ${out.length} row${out.length === 1 ? "" : "s"} from ${rows.length} check${rows.length === 1 ? "" : "s"}, with no AI call.` +
      (unassessed > 0 ? ` ${unassessed} check${unassessed === 1 ? " has" : "s have"} no verdict yet — no audit has covered ${unassessed === 1 ? "its" : "their"} area, and ${unassessed === 1 ? "it is" : "they are"} marked "${NOT_YET_ASSESSED}".` : "") +
      (stale > 0 ? ` ${stale} verdict${stale === 1 ? " was" : "s were"} recorded against older wording of the check.` : "")
    );
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const { overrides: next, report } = mergeDomainChecklistCsv(PARSED_DOMAIN_FILES, overrides, text);
    setImportReport(report);
    if (report.errors.length === 0 || report.updated + report.added + report.removed > 0) replaceOverrides(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <h3 style={{ margin: "0 0 6px" }}>Audit checklist library</h3>
        <p style={{ fontSize: 12.5, color: "#475569", margin: "0 0 10px", lineHeight: 1.5 }}>
          The specialist checks, red flags and expected-evidence lists the AI applies for each criterion. These ship with the tool
          (from <code>src/data/skills/criterion-1..7</code>) and are injected into every AI audit call for that criterion.
          Editing here changes what the AI is told to look for. Nothing here scores anything by itself.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <Pill s="neutral">{stats.total} checks</Pill>
          {stats.edited > 0 && <Pill s="progress">{stats.edited} edited</Pill>}
          {stats.active > 0 && <Pill s="good">{stats.active} added · active</Pill>}
          {stats.draft > 0 && <Pill s="medium">{stats.draft} added · draft</Pill>}
          {stats.hidden > 0 && <Pill s="critical">{stats.hidden} hidden</Pill>}
          {stats.edited + stats.active + stats.draft + stats.hidden === 0 && <span style={muted}>Unchanged from the shipped checklists.</span>}
        </div>

        <button type="button" style={btn} onClick={() => setShowUsage((v) => !v)}>
          {showUsage ? "Hide" : "Show"} where these are used ({DOMAIN_SKILL_CONSUMERS.length} AI calls)
        </button>
        {showUsage && (
          <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "#f8fafc" }}>
            <div style={{ ...muted, marginBottom: 6 }}>
              A criterion&apos;s checklist is injected into every one of these calls whenever the work is on that criterion.
              This list is checked against the real call sites by a test, so it cannot drift out of date.
            </div>
            {DOMAIN_SKILL_CONSUMERS.map((c) => (
              <div key={c.fn} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#64748b", minWidth: 230 }}>{c.fn}</span>
                <span style={{ color: "#334155" }}>{c.surface}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={filterSelectStyle} value={critFilter} onChange={(e) => { setCritFilter(e.target.value); setSubFilter("all"); }}>
            <option value="all">All criteria</option>
            {GD4_CRITERIA.map((c) => <option key={c.id} value={String(c.id)}>{c.id} · {c.title}</option>)}
          </select>
          <select style={filterSelectStyle} value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
            <option value="all">All sub-criteria</option>
            {subOptions.map((s) => <option key={s} value={s}>{s} {scopeTitle(s)}</option>)}
          </select>
          <select style={filterSelectStyle} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
            <option value="all">All types</option>
            {(["checks", "red-flags", "expected-evidence", "analytics"] as DomainSectionKind[]).map((k) => (
              <option key={k} value={k}>{SECTION_KIND_LABEL[k]}</option>
            ))}
          </select>
          <select style={filterSelectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Any status</option>
            <option value="built-in">Built-in</option>
            <option value="built-in-edited">Edited</option>
            <option value="custom-active">Added · active</option>
            <option value="custom-draft">Added · draft</option>
            <option value="removed">Hidden</option>
          </select>
          <input style={{ ...inputStyle, flex: "1 1 200px", width: "auto" }} placeholder="Search the check text…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span style={muted}>{visibleCount} of {stats.total}</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <button type="button" style={btnPrimary} onClick={onExport} title="Download the checks currently shown as a re-importable CSV">⬇ Export CSV{visibleCount !== stats.total ? " (filtered)" : ""}</button>
          <button type="button" style={btnPrimary} onClick={() => fileRef.current?.click()}>⬆ Import CSV</button>
          <button
            type="button" style={btnPrimary} onClick={onExportWorksheet}
            title="Download the checks shown as a printable walkthrough worksheet. Writes the questions already stored against each check — no AI call, no waiting."
          >
            {`⬇ Manual worksheet (CSV)${visibleCount !== stats.total ? ` — ${visibleCount} shown` : ""}`}
          </button>
          <button
            type="button" style={btnPrimary} onClick={onExportVerdicts}
            title="Download what the AI concluded about each check in view, one row per bucket per audited sub-criterion. Reads verdicts already stored — no AI call. Checks nothing has audited yet are listed as Not yet assessed."
          >
            {`⬇ AI verdicts (CSV)${verdictCount > 0 ? ` — ${verdictCount} recorded` : ""}`}
          </button>
          <button
            type="button" style={{ ...btn, ...(worksheetBusy ? { opacity: 0.6, cursor: "wait" } : {}) }}
            disabled={worksheetBusy}
            onClick={() => void generateQuestions(allRows.filter(matches).filter((r) => r.status !== "removed").filter(needsWriting), "the missing and outdated questions")}
            title="Write walkthrough questions for the checks in view that have none, whose check text has changed since, or that an older question writer produced. Hand-edited questions are never overwritten."
          >
            {worksheetBusy ? "Writing…" : `✍ Generate missing/outdated questions${questionsToWrite > 0 ? ` (${questionsToWrite})` : ""}`}
          </button>
          {worksheetBusy && (
            <button type="button" style={btnDanger} onClick={() => worksheetAbort.current?.abort()}>Cancel</button>
          )}
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); }}
          />
          {(stats.edited + stats.active + stats.draft + stats.hidden) > 0 && (
            <button
              type="button" style={btnDanger}
              onClick={() => { if (confirm("Discard every edit, added check and hidden check, returning to the checklists that ship with the tool? Your audit results are not affected.")) resetAll(); }}
            >
              Reset to shipped checklists
            </button>
          )}
        </div>

        {worksheet && (
          <div style={{ marginTop: 10, border: "1px solid #dbeafe", background: "#f8fbff", borderRadius: 8, padding: 10, fontSize: 12.5 }}>
            {worksheet}
            {!worksheetBusy && <button type="button" style={{ ...btn, marginLeft: 8 }} onClick={() => setWorksheet(null)}>Dismiss</button>}
          </div>
        )}

        {importReport && (
          <div style={{ marginTop: 10, border: `1px solid ${importReport.errors.length ? "#fde68a" : "#bbf7d0"}`, background: importReport.errors.length ? "#fffbeb" : "#f0fdf4", borderRadius: 8, padding: 10, fontSize: 12.5 }}>
            <b>Import: </b>
            {importReport.updated} updated · {importReport.added} added · {importReport.removed} hidden/deleted · {importReport.restored} restored · {importReport.unchanged} unchanged
            {importReport.errors.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#92400e" }}>
                {importReport.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            <div style={{ ...muted, marginTop: 6 }}>
              A row left out of the file is never deleted. To remove a check, set its <code>status</code> to <code>removed</code>.
            </div>
            <button type="button" style={{ ...btn, marginTop: 6 }} onClick={() => setImportReport(null)}>Dismiss</button>
          </div>
        )}
      </Card>

      {CRITERION_IDS.filter((cid) => critFilter === "all" || cid === critFilter).map((cid) => {
        const rows = rowsByCriterion[cid].filter(matches);
        const parsed = PARSED_DOMAIN_FILES[cid];
        const crit = GD4_CRITERIA.find((c) => String(c.id) === cid);
        if (rows.length === 0 && addingFor !== cid) return null;

        const sections = parsed.sections.filter((s) => rows.some((r) => r.sectionKey === s.key));
        const orphanRows = rows.filter((r) => !parsed.sections.some((s) => s.key === r.sectionKey));

        return (
          <Card key={cid}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <h3 style={{ margin: 0 }}>Criterion {cid} · {crit?.title ?? ""}</h3>
              {subFilter !== "all" && <Pill s="progress">Sub-criterion {subFilter}</Pill>}
              <Pill s="neutral">{rows.length} check{rows.length === 1 ? "" : "s"}</Pill>
              {subFilter !== "all" && rows.some((r) => r.subCriterionIds.length === 0) && (
                <span style={{ ...muted, fontSize: 10.5 }}>
                  includes {rows.filter((r) => r.subCriterionIds.length === 0).length} that apply across the whole criterion
                </span>
              )}
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" style={btn} onClick={() => { setAddingFor(addingFor === cid ? null : cid); setAddSection(parsed.sections[0]?.key ?? ""); }}>
                  {addingFor === cid ? "Cancel" : "+ Add check"}
                </button>
                <button type="button" style={btn} onClick={() => setPreviewFor(previewFor === cid ? null : cid)}>
                  {previewFor === cid ? "Hide" : "View"} text sent to the AI
                </button>
              </span>
            </div>
            <div style={{ ...muted, marginBottom: 10 }}>
              🎓 {DOMAIN_EXPERTISE_LABELS[cid]} · feeds {DOMAIN_SKILL_CONSUMERS.length} AI calls whenever the audit is on this criterion
            </div>

            {addingFor === cid && (
              <div style={{ border: "1px dashed #99f6e4", background: "#f0fdfa", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f766e", marginBottom: 8 }}>New check for criterion {cid}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <label style={{ fontSize: 11.5, color: "#475569" }}>
                    Section
                    <select style={{ ...inputStyle, marginTop: 3 }} value={addSection} onChange={(e) => setAddSection(e.target.value)}>
                      {parsed.sections.map((s) => <option key={s.key} value={s.key}>{SECTION_KIND_LABEL[s.kind]} — {s.key}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 11.5, color: "#475569" }}>
                    The check, written as an instruction to the auditor
                    <textarea
                      style={{ ...inputStyle, marginTop: 3, minHeight: 70, resize: "vertical" }}
                      placeholder="e.g. Teacher deployment must be approved by the Academic Board before the module starts — check the approval is minuted and dated."
                      value={addText} onChange={(e) => setAddText(e.target.value)}
                    />
                  </label>
                  <label style={{ fontSize: 11.5, color: "#475569" }}>
                    Sub-criteria this applies to (optional, e.g. &quot;5.2.1 5.2.2&quot;)
                    <input style={{ ...inputStyle, marginTop: 3 }} value={addRefs} onChange={(e) => setAddRefs(e.target.value)} placeholder={`${cid}.1`} />
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" style={btnPrimary} onClick={submitAdd} disabled={!addText.trim()}>Add as draft</button>
                    <span style={muted}>Added checks start as a draft and are not sent to the AI until you approve them.</span>
                  </div>
                </div>
              </div>
            )}

            {previewFor === cid && (
              <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 10, fontSize: 10.5, lineHeight: 1.5, overflowX: "auto", maxHeight: 400, marginBottom: 12 }}>
                {domainExpertiseFor(cid)}
              </pre>
            )}

            {[...sections.map((s) => ({ key: s.key, kind: s.kind })), ...(orphanRows.length ? [{ key: "__orphan__", kind: "checks" as DomainSectionKind }] : [])].map((section) => {
              const sectionRows = section.key === "__orphan__" ? orphanRows : rows.filter((r) => r.sectionKey === section.key);
              if (sectionRows.length === 0) return null;
              return (
                <div key={section.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b" }}>
                      {SECTION_KIND_LABEL[section.kind]}
                    </span>
                    <span style={{ fontSize: 12, color: "#334155" }}>
                      {section.key === "__orphan__" ? "Checks whose section no longer exists in the shipped file" : section.key}
                    </span>
                  </div>

                  {sectionRows.map((r) => {
                    const editing = editingId === r.id;
                    return (
                      <div key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, marginBottom: 6, background: r.status === "removed" ? "#fef2f2" : "#fff", opacity: r.status === "removed" ? 0.75 : 1 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <Pill s={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                          {r.subCriterionIds.map((ref) => (
                            <span key={ref} style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: "#0f766e", background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 5, padding: "1px 5px" }}>{ref}</span>
                          ))}
                          {r.subCriterionIds.length === 0 && <span style={{ ...muted, fontSize: 10.5 }}>applies across criterion {cid}</span>}
                          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {!editing && <button type="button" style={btn} onClick={() => startEdit(r)}>Edit</button>}
                            {!editing && r.status === "built-in-edited" && (
                              <button type="button" style={btn} onClick={() => revertItem(r.id)} title="Restore the wording that ships with the tool">Revert</button>
                            )}
                            {!editing && r.custom && r.status !== "removed" && (
                              <button
                                type="button"
                                style={r.status === "custom-draft" ? btnPrimary : btn}
                                onClick={() => setVerified(r.id, r.status === "custom-draft")}
                                title={r.status === "custom-draft" ? "Approve this check so the AI receives it" : "Return this check to draft so the AI stops receiving it"}
                              >
                                {r.status === "custom-draft" ? "Approve" : "Return to draft"}
                              </button>
                            )}
                            {!editing && !r.custom && (
                              <button
                                type="button" style={r.status === "removed" ? btn : btnDanger}
                                onClick={() => setRemoved(r.id, r.status !== "removed")}
                                title={r.status === "removed" ? "Send this check to the AI again" : "Stop sending this check to the AI (it stays here and can be restored)"}
                              >
                                {r.status === "removed" ? "Restore" : "Hide"}
                              </button>
                            )}
                            {!editing && r.custom && (
                              <button type="button" style={btnDanger} onClick={() => { if (confirm("Delete this added check permanently?")) deleteCustom(r.id); }}>Delete</button>
                            )}
                          </span>
                        </div>

                        {editing ? (
                          <div style={{ marginTop: 8 }}>
                            <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                              <button type="button" style={btnPrimary} onClick={() => saveEdit(r)} disabled={!draftText.trim()}>Save</button>
                              <button type="button" style={btn} onClick={() => setEditingId(null)}>Cancel</button>
                              {!r.custom && <span style={{ ...muted, alignSelf: "center" }}>Saving the original wording back clears the edit.</span>}
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.5, marginTop: 6, whiteSpace: "pre-wrap" }}><InlineMd text={r.text} /></div>
                        )}

                        {!editing && r.status === "built-in-edited" && (
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ ...muted, cursor: "pointer" }}>Shipped wording</summary>
                            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, marginTop: 4, whiteSpace: "pre-wrap" }}><InlineMd text={r.originalText ?? ""} /></div>
                          </details>
                        )}

                        <ChecklistVerdicts checkId={r.id} checkText={r.text} />

                        {/* The walkthrough questions stored against this check.
                            Visible here so Felix can read the auditor-facing
                            form without exporting anything. Each is typed
                            Process or Document, can be reworded, reordered or
                            removed, and he can add his own — a hand question
                            survives every later regeneration. */}
                        {(() => {
                          const qs = stateOf(r);
                          const stored = questions[r.id];
                          const list = stored?.questions ?? [];
                          const adding = addingQuestionFor === r.id;
                          return (
                            <div style={{ marginTop: 8, borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 5 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b" }}>
                                  Walkthrough question{list.length === 1 ? "" : "s"}{list.length > 0 ? ` (${list.length})` : ""}
                                </span>
                                <Pill s={QUESTION_TONE[qs]}>{QUESTION_LABEL[qs]}</Pill>
                                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                  <button
                                    type="button" style={btn} disabled={worksheetBusy}
                                    onClick={() => void generateQuestions([r], "this check's questions")}
                                    title={list.some((q) => q.source === "hand")
                                      ? "Rewrite the AI-written questions on this check. Your own questions are kept."
                                      : "Write the walkthrough questions for this check with AI"}
                                  >
                                    {list.length > 0 ? "Regenerate" : "Write questions"}
                                  </button>
                                  <button type="button" style={btn} onClick={() => { setAddingQuestionFor(adding ? null : r.id); setEditingQuestionId(null); setQText(""); setQType("Document"); }}>
                                    {adding ? "Cancel" : "+ Add question"}
                                  </button>
                                </span>
                              </div>

                              {list.length === 0 && !adding && (
                                <div style={muted}>No questions yet. This check still appears in the worksheet, with its Question cell blank.</div>
                              )}

                              <div style={{ display: "grid", gap: 4 }}>
                                {list.map((q, qi) => {
                                  const key = `${r.id}|${q.id}`;
                                  const qEditing = editingQuestionId === key;
                                  if (qEditing) {
                                    return (
                                      <div key={q.id} style={{ display: "grid", gap: 6, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
                                        <select style={inputStyle} value={qType} onChange={(e) => setQType(e.target.value as AskType)}>
                                          <option value="Process">Process — describe how you do it</option>
                                          <option value="Document">Document — produce the record</option>
                                        </select>
                                        <textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} value={qText} onChange={(e) => setQText(e.target.value)} />
                                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                          <button type="button" style={btnPrimary} onClick={() => saveQuestionEdit(r.id, q.id)} disabled={!qText.trim()}>Save question</button>
                                          <button type="button" style={btn} onClick={() => setEditingQuestionId(null)}>Cancel</button>
                                          <span style={muted}>Saving makes it yours, and a regeneration will leave it alone.</span>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={q.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 8px", background: "#f8fafc", borderRadius: 6 }}>
                                      <span style={{
                                        fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", marginTop: 2,
                                        borderRadius: 4, padding: "1px 5px",
                                        color: q.askType === "Process" ? "#7c3aed" : "#0369a1",
                                        background: q.askType === "Process" ? "#f5f3ff" : "#f0f9ff",
                                        border: `1px solid ${q.askType === "Process" ? "#ddd6fe" : "#bae6fd"}`,
                                      }}>{q.askType}</span>
                                      <span style={{ fontSize: 12, color: "#334155", flex: 1 }}>
                                        {q.text}
                                        {q.source === "hand" && <span style={{ ...muted, fontSize: 10, marginLeft: 6 }}>· yours</span>}
                                      </span>
                                      <span style={{ display: "flex", gap: 4 }}>
                                        <button type="button" style={iconBtn} title="Move up" disabled={qi === 0} onClick={() => moveQuestion(r.id, q.id, -1)}>↑</button>
                                        <button type="button" style={iconBtn} title="Move down" disabled={qi === list.length - 1} onClick={() => moveQuestion(r.id, q.id, 1)}>↓</button>
                                        <button type="button" style={iconBtn} title="Reword this question" onClick={() => { setEditingQuestionId(key); setAddingQuestionFor(null); setQText(q.text); setQType(q.askType); }}>Edit</button>
                                        <button type="button" style={{ ...iconBtn, color: "#b23121" }} title="Remove this question" onClick={() => removeQuestion(r.id, q.id)}>✕</button>
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>

                              {adding && (
                                <div style={{ display: "grid", gap: 6, marginTop: 6, padding: 8, border: "1px dashed #bae6fd", background: "#f8fbff", borderRadius: 6 }}>
                                  <select style={inputStyle} value={qType} onChange={(e) => setQType(e.target.value as AskType)}>
                                    <option value="Process">Process — describe how you do it</option>
                                    <option value="Document">Document — produce the record</option>
                                  </select>
                                  <textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} placeholder="e.g. Show me the Academic Board minutes approving this lecturer before the module started." value={qText} onChange={(e) => setQText(e.target.value)} />
                                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <button type="button" style={btnPrimary} onClick={() => saveQuestionAdd(r)} disabled={!qText.trim()}>Add question</button>
                                    <span style={muted}>Your own questions are kept when this check is regenerated.</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        );
      })}

      {visibleCount === 0 && (
        <Card><p style={{ fontSize: 12.5, color: "#64748b", margin: 0 }}>No checks match these filters.</p></Card>
      )}
    </div>
  );
}

// The AI's own verdict on THIS check, from real audit runs.
//
// Until now the library shaped the model's prose and nothing more: the audit
// response schemas are keyed on the GD4 requirement ref, so no conclusion could
// be traced back to a specific check. Both audit paths now run the checks as
// their own pass and file the results here (see lib/checklistLibraryRun.ts).
//
// Read-only and display-only. Nothing shown here is scored, and nothing here is
// read by the banding engine — the page's promise that it "scores nothing by
// itself" still holds.
function ChecklistVerdicts({ checkId, checkText }: { checkId: string; checkText: string }) {
  const entries = useChecklistVerdictStore((s) => s.entries);
  const mine = Object.values(entries)
    .filter((v) => v.checkId === checkId)
    .sort((a, b) => (a.subCriterionId === b.subCriterionId ? a.bucket.localeCompare(b.bucket) : a.subCriterionId.localeCompare(b.subCriterionId)));
  const currentHash = questionSourceHash(checkText);

  return (
    <div style={{ marginTop: 8, borderTop: "1px dashed #e2e8f0", paddingTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#64748b" }}>
          AI verdicts{mine.length > 0 ? ` (${mine.length})` : ""}
        </span>
      </div>
      {mine.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
          No audit has assessed this check yet. Run an audit on a sub-criterion this check applies to, then come back.
        </div>
      ) : (
        mine.map((v) => <VerdictRow key={`${v.subCriterionId}::${v.bucket}`} v={v} stale={v.sourceHash !== currentHash} />)
      )}
    </div>
  );
}

function VerdictRow({ v, stale }: { v: StoredChecklistVerdict; stale: boolean }) {
  return (
    <div style={{ fontSize: 11.5, color: "#334155", padding: "5px 0", borderTop: "1px solid #f1f5f9", lineHeight: 1.5 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", color: "#0f766e" }}>{v.subCriterionId}</span>
        <span style={{ color: "#94a3b8" }}>·</span>
        <span style={{ color: "#64748b" }}>{v.bucket === "policy" ? "Policy documents" : "Evidence records"}</span>
        <Pill s={VERDICT_TONE[v.verdict] ?? "neutral"}>{v.verdict}</Pill>
        {stale && <Pill s="medium">Stale — check reworded since</Pill>}
        <span style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 10.5 }}>
          Option {v.path} · {new Date(v.runAt).toLocaleDateString()}{v.runId ? ` · ${v.runId}` : ""}
        </span>
      </div>
      {v.rationale && <div style={{ marginTop: 3, color: "#475569" }}>{v.rationale}</div>}
      {v.quote && (
        <div style={{ marginTop: 3, paddingLeft: 8, borderLeft: "2px solid #cbd5e1", color: "#64748b", fontStyle: "italic" }}>
          “{v.quote}”
        </div>
      )}
      {v.chunkIds.length > 0 && (
        <div style={{ marginTop: 3, color: "#94a3b8", fontSize: 10.5, fontFamily: "ui-monospace, monospace" }}>{v.chunkIds.join(", ")}</div>
      )}
    </div>
  );
}
