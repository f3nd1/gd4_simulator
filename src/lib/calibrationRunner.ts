// Impure orchestration for the AI Calibration page's Consistency and A-vs-B
// tabs: gathers Drive folder text, runs the EXISTING engines
// (runPPDRequirementsReview / runEvidenceAssessment for Option A;
// runStagedPolicyAudit / runStagedEvidenceAudit / runStagedOutcomeReviewAudit
// + buildStagedApsr for Option B) into a SCRATCH result, and judges outputs
// against the benchmark AFIs with the same AI-judge prompt the Benchmark tab
// uses.
//
// GUARANTEE: nothing here writes to ppdReviewResults, evidenceAssessments,
// the checklist, or the findings register — the user's real audit results
// are untouched. The only workspace writes are (a) the fileTextCache (a
// read cache, identical to what a normal run would cache) and (b) an AI
// Review Log entry per engine run so cost/tokens land in the existing log.
//
// NOT imported by any test file: it pulls driveClient (pdfjs Worker), which
// is unavailable under Vitest. All score math lives in calibrationTesting.ts.

import { useWorkspaceStore, composeSchoolContext } from "../store/useWorkspaceStore";
import { useAISettingsStore } from "../store/useAISettingsStore";
import { useGoogleDriveStore } from "../store/useGoogleDriveStore";
import { parseFolderId, listFolderFilesRecursive, exportFileText, IMAGE_MIME_TYPES } from "./drive/driveClient";
import {
  runPPDRequirementsReview, runEvidenceAssessment,
  runStagedPolicyAudit, runStagedEvidenceAudit, runStagedOutcomeReviewAudit, buildStagedApsr,
  type PPDRequirementInput, type EvidenceAssessmentInput,
} from "./ai/agentRuntime";
import { deriveApsrStatus } from "./ai/simulateAI";
import { chatComplete, effectiveSettings, aiOfflineReason, type AIUsage } from "./ai/aiClient";
import { GD4_REQUIREMENTS } from "../data/gd4Requirements";
import { useBenchmarkAfiStore } from "../store/useBenchmarkAfiStore";
import type { EvidenceFolder } from "../types";
import { ppdVerdictToStatus, countGaps, countByType, bandEstimate, type ScratchStatus } from "./calibrationTesting";

const MAX_PART_CHARS = 24_000;

export type ScratchProgress = (stage: string) => void;

// One scratch engine run's normalised output — everything the score math
// and the A-vs-B display need, with no store writes.
export type ScratchRunOutput = {
  ok: boolean;
  error?: string;
  // Per requirement line: normalised status + the engine's reasoning and the
  // evidence (chunk file names / refs) it cited, so the UI can drill in.
  lines: { ref: string; text: string; status: ScratchStatus; note: string; evidence: string[] }[];
  gapCount: number;
  byType: { NC: number; OFI: number; OBS: number };
  bandEstimate: number | null;
  // Text digest of this run's negative results, for the benchmark judge.
  digest: string;
};

export function folderOf(subCriterionId: string): EvidenceFolder | undefined {
  return useWorkspaceStore.getState().folders.find((f) => f.subCriterionId === subCriterionId);
}

export function foldersConnected(subCriterionId: string): boolean {
  const f = folderOf(subCriterionId);
  return !!f && (!!parseFolderId(f.policyLink || "") || !!parseFolderId(f.folderLink || ""));
}

export function aiReady(): string | null {
  const s = useAISettingsStore.getState();
  return aiOfflineReason(s);
}

// Reads every supported file in one Drive folder into the same
// "[CHUNK:Cnnn] --- path ---" text format the real runs feed the engines.
// Uses (and fills) the workspace fileTextCache exactly like a normal run;
// failed reads are skipped and reported, never fabricated.
async function gatherText(folderLink: string | undefined, label: string, signal: AbortSignal, onProgress: ScratchProgress, chunkStart: { n: number }, chunkFiles: Record<string, string>): Promise<{ text: string; files: number; failed: string[] }> {
  const folderId = parseFolderId(folderLink || "");
  if (!folderId) return { text: "", files: 0, failed: [] };
  const token = useGoogleDriveStore.getState().getValidToken();
  if (!token) throw new Error("Google Drive is not connected — connect it in Settings or on the Evidence Folder page.");
  onProgress(`Listing ${label} folder…`);
  const files = (await listFolderFilesRecursive(folderId, token)).filter((f) => !IMAGE_MIME_TYPES.has(f.mimeType));
  const parts: string[] = [];
  const failed: string[] = [];
  let read = 0;
  for (const file of files) {
    if (signal.aborted) throw new Error("Cancelled");
    onProgress(`Reading ${label} file ${++read}/${files.length}: ${file.path.split("/").pop()}`);
    const cacheKey = `${file.id}:${file.modifiedTime ?? ""}`;
    const cached = useWorkspaceStore.getState().fileTextCache[cacheKey];
    let body: string | null = cached ? cached.text : null;
    if (!cached) {
      const readToken = await useGoogleDriveStore.getState().getFreshToken();
      if (!readToken) throw new Error("Google Drive token expired mid-run and could not be refreshed.");
      try {
        body = await exportFileText(file, readToken, signal);
        if (body != null) {
          const text = body;
          useWorkspaceStore.setState((st) => ({ fileTextCache: { ...st.fileTextCache, [cacheKey]: { text, charCount: text.length, fileKind: file.mimeType, fileName: file.path.split("/").pop() || file.path, filePath: file.path, cachedAt: Date.now() } } }));
        }
      } catch {
        failed.push(file.path.split("/").pop() || file.path);
        continue;
      }
    }
    if (!body) continue;
    const fileName = file.path.split("/").pop() || file.path;
    const totalParts = Math.ceil(body.length / MAX_PART_CHARS) || 1;
    for (let pi = 0; pi < totalParts; pi++) {
      const chunkId = `C${String(++chunkStart.n).padStart(3, "0")}`;
      const partLabel = totalParts > 1 ? ` (part ${pi + 1} of ${totalParts})` : "";
      parts.push(`[CHUNK:${chunkId}] --- ${file.path}${partLabel} ---\n${body.slice(pi * MAX_PART_CHARS, (pi + 1) * MAX_PART_CHARS)}`);
      chunkFiles[chunkId] = fileName;
    }
  }
  return { text: parts.join("\n\n"), files: files.length, failed };
}

function analysisSettings() {
  const ai = useAISettingsStore.getState();
  return effectiveSettings(ai, { purpose: "analysis", context: composeSchoolContext(useWorkspaceStore.getState().schoolContext) });
}

// Cost/token logging into the EXISTING AI Review Log — same surface every
// other AI feature uses, marked as a calibration scratch run.
function logRun(agent: string, subjectId: string, verdict: string, usage?: AIUsage) {
  useWorkspaceStore.getState().pushAIReviewLog({
    agent,
    reviewType: "Calibration",
    subjectId,
    verdict,
    confidence: "High",
    keyConcerns: [],
    recommendedAction: "Measurement run only (scratch) — did not touch audit results.",
    live: true,
    usage,
  });
}

function buildDigest(lines: ScratchRunOutput["lines"]): string {
  const gaps = lines.filter((l) => l.status !== "Met");
  if (gaps.length === 0) return "No gaps raised — every line assessed Met.";
  return gaps.map((l) => `[${l.ref}] ${l.status}: ${l.note.slice(0, 300)}`).join("\n");
}

// Runs Option A (PPD review, then the evidence assessment when an evidence
// folder is linked) as a scratch run. Line status: the evidence verdict when
// the evidence stage ran, else the mapped PPD verdict.
export async function runScratchA(subCriterionId: string, signal: AbortSignal, onProgress: ScratchProgress, ruleInjection?: string): Promise<ScratchRunOutput> {
  const fail = (error: string): ScratchRunOutput => ({ ok: false, error, lines: [], gapCount: 0, byType: { NC: 0, OFI: 0, OBS: 0 }, bandEstimate: null, digest: "" });
  try {
    const folder = folderOf(subCriterionId);
    if (!folder) return fail("No folder row for this sub-criterion.");
    const items = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId);
    const requirements: PPDRequirementInput[] = items.flatMap((item) =>
      (item.flatAuditPoints ?? []).filter((p) => p.sourceType === "describeShow").map((p) => ({ ref: p.ref, gd4ItemId: item.id, requirementText: p.text }))
    );
    if (requirements.length === 0) return fail("No requirement lines for this sub-criterion.");
    const chunkStart = { n: 0 };
    const chunkFiles: Record<string, string> = {};
    const policy = await gatherText(folder.policyLink || folder.folderLink, "policy", signal, onProgress, chunkStart, chunkFiles);
    if (!policy.text) return fail("No readable Policy & Procedure text — link/check the policy folder first.");
    const settings = analysisSettings();
    onProgress("Option A — PPD requirements review…");
    const ppd = await runPPDRequirementsReview(requirements, policy.text, settings, {
      criterionId: subCriterionId, ruleInjection, signal, onProgress: (d) => onProgress(`Option A — PPD review: ${d}`),
    });
    logRun("Calibration · Option A (PPD)", subCriterionId, `${ppd.rows.length} lines reviewed`, ppd.usage);

    const byRef = new Map(requirements.map((r) => [r.ref, r]));
    const cite = (ids: string[] | undefined) => [...new Set((ids ?? []).map((id) => chunkFiles[id] ?? id))];
    let lines: ScratchRunOutput["lines"];
    const evidence = await gatherText(folder.folderLink, "evidence", signal, onProgress, chunkStart, chunkFiles);
    if (evidence.text) {
      onProgress("Option A — evidence assessment…");
      const inputs: EvidenceAssessmentInput[] = ppd.rows.map((r) => ({ ref: r.ref, requirementText: r.requirementText, ppdVerdict: r.verdict, ppdExtract: r.fullComment || r.shortComment, promises: r.promises }));
      const ev = await runEvidenceAssessment(inputs, evidence.text, settings, {
        criterionId: subCriterionId, ruleInjection, signal, onProgress: (d) => onProgress(`Option A — evidence: ${d}`),
      });
      logRun("Calibration · Option A (Evidence)", subCriterionId, `${ev.rows.length} lines assessed`, ev.usage);
      const evByRef = new Map(ev.rows.map((r) => [r.ref, r]));
      lines = ppd.rows.map((r) => {
        const e = evByRef.get(r.ref);
        const status: ScratchStatus = e && !e.failed && (e.verdict === "Met" || e.verdict === "Partial" || e.verdict === "Not met")
          ? e.verdict
          : ppdVerdictToStatus(r.verdict);
        return { ref: r.ref, text: byRef.get(r.ref)?.requirementText ?? r.requirementText, status, note: e?.comment || r.fullComment || r.shortComment, evidence: cite([...(r.chunkIds ?? []), ...(e?.chunkIds ?? [])]) };
      });
    } else {
      lines = ppd.rows.map((r) => ({ ref: r.ref, text: r.requirementText, status: ppdVerdictToStatus(r.verdict), note: r.fullComment || r.shortComment, evidence: cite(r.chunkIds) }));
    }
    const statuses = lines.map((l) => l.status);
    return { ok: true, lines, gapCount: countGaps(statuses), byType: countByType(statuses), bandEstimate: bandEstimate(statuses), digest: buildDigest(lines) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// Runs Option B (the three staged passes + deterministic APSR merge) as a
// scratch run. Line status: deriveApsrStatus over buildStagedApsr — the same
// derivation the real staged audit commits.
export async function runScratchB(subCriterionId: string, signal: AbortSignal, onProgress: ScratchProgress, ruleInjection?: string): Promise<ScratchRunOutput> {
  const fail = (error: string): ScratchRunOutput => ({ ok: false, error, lines: [], gapCount: 0, byType: { NC: 0, OFI: 0, OBS: 0 }, bandEstimate: null, digest: "" });
  try {
    const folder = folderOf(subCriterionId);
    if (!folder) return fail("No folder row for this sub-criterion.");
    const items = GD4_REQUIREMENTS.filter((r) => r.subCriterionId === subCriterionId);
    const points = items.flatMap((item) => item.flatAuditPoints ?? []);
    if (points.length === 0) return fail("No audit points for this sub-criterion.");
    const chunkStart = { n: 0 };
    const chunkFiles: Record<string, string> = {};
    const policy = await gatherText(folder.policyLink || folder.folderLink, "policy", signal, onProgress, chunkStart, chunkFiles);
    const evidence = await gatherText(folder.folderLink !== folder.policyLink ? folder.folderLink : undefined, "evidence", signal, onProgress, chunkStart, chunkFiles);
    if (!policy.text && !evidence.text) return fail("No readable documents — link/check the folders first.");
    const settings = analysisSettings();

    onProgress("Option B — policy pass…");
    const pol = await runStagedPolicyAudit(points, policy.text || evidence.text, settings, { criterionId: subCriterionId, ruleInjection, signal, onProgress: (d) => onProgress(`Option B — policy: ${d}`) });
    onProgress("Option B — evidence pass…");
    const ev = await runStagedEvidenceAudit(points, evidence.text || policy.text, pol.rows, settings, { criterionId: subCriterionId, ruleInjection, signal, onProgress: (d) => onProgress(`Option B — evidence: ${d}`) });
    onProgress("Option B — outcome & review pass…");
    const out = await runStagedOutcomeReviewAudit(points, [policy.text, evidence.text].filter(Boolean).join("\n\n"), settings, { criterionId: subCriterionId, ruleInjection, signal, onProgress: (d) => onProgress(`Option B — outcomes: ${d}`) });
    logRun("Calibration · Option B (staged)", subCriterionId, `${points.length} audit points, 3 passes`);

    const polByRef = new Map(pol.rows.map((r) => [r.ref, r]));
    const evByRef = new Map(ev.rows.map((r) => [r.ref, r]));
    const outByRef = new Map(out.rows.map((r) => [r.ref, r]));
    const cite = (ids: string[]) => [...new Set(ids.map((id) => chunkFiles[id] ?? id))];
    const lines = points.map((p) => {
      const apsr = buildStagedApsr(polByRef.get(p.ref), evByRef.get(p.ref), outByRef.get(p.ref));
      const status = deriveApsrStatus(apsr);
      const note = [apsr.approach.note, apsr.processes.note].filter(Boolean).join(" | ");
      const evidence = cite([...(apsr.approach.sourceChunkIds ?? []), ...(apsr.processes.sourceChunkIds ?? []), ...(apsr.systemsOutcomes.sourceChunkIds ?? [])]);
      return { ref: p.ref, text: p.text, status, note, evidence };
    });
    const statuses = lines.map((l) => l.status);
    return { ok: true, lines, gapCount: countGaps(statuses), byType: countByType(statuses), bandEstimate: bandEstimate(statuses), digest: buildDigest(lines) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function runScratch(path: "A" | "B", subCriterionId: string, signal: AbortSignal, onProgress: ScratchProgress, ruleInjection?: string): Promise<ScratchRunOutput> {
  return path === "A" ? runScratchA(subCriterionId, signal, onProgress, ruleInjection) : runScratchB(subCriterionId, signal, onProgress, ruleInjection);
}

// Judges one scratch run's output against the sub-criterion's benchmark
// AFIs — the SAME prompt shape the Benchmark tab's match analysis uses.
// Scratch-only: never writes to the calibration matches store.
export async function judgeVsBenchmark(subCriterionId: string, digest: string, signal: AbortSignal): Promise<{ judged: boolean; caught: number; partial: number; missed: number }> {
  const afis = useBenchmarkAfiStore.getState().entries.filter((a) => a.subCriterion === subCriterionId && a.kind === "AFI");
  if (afis.length === 0) return { judged: false, caught: 0, partial: 0, missed: 0 };
  try {
    const system = `You are judging whether an internal AI audit tool caught the same gaps a real SSG EduTrust assessor raised. For each REAL finding, compare it against the tool's results and verdict exactly one of:
"caught" — the tool raised a finding or negative verdict covering the SAME gap (same obligation, same failure mode).
"partial" — the tool flagged the same area (same requirement/topic) but missed the specific gap the assessor named.
"missed" — the tool rated the area Adequate/Met or did not flag it at all.
Respond with JSON only: {"results": [{"id": string, "status": "caught"|"partial"|"missed"}]}`;
    const user = `REAL assessor findings for sub-criterion ${subCriterionId}:\n${afis.map((a) => `[${a.id}] (${a.findingPattern}) ${a.findingText}`).join("\n\n")}\n\nThe tool's results for sub-criterion ${subCriterionId}:\n${digest}`;
    let usage: AIUsage | undefined;
    const content = await chatComplete([{ role: "system", content: system }, { role: "user", content: user }], analysisSettings(), { temperature: 0.1, signal, onUsage: (u) => { usage = u; } });
    logRun("Calibration · benchmark judge", subCriterionId, `${afis.length} real AFIs judged`, usage);
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { results?: Array<{ id?: unknown; status?: unknown }> };
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const counts = { caught: 0, partial: 0, missed: 0 };
    for (const a of afis) {
      const r = results.find((x) => String(x.id) === a.id);
      const st = r?.status === "caught" || r?.status === "partial" || r?.status === "missed" ? r.status : "missed";
      counts[st]++;
    }
    return { judged: true, ...counts };
  } catch {
    return { judged: false, caught: 0, partial: 0, missed: 0 };
  }
}
