import { describe, it, expect } from "vitest";
import {
  checkAuditorForRun, resolveRunAuditor, panelUnderMinNotice, runAuditorDisplay, independenceNotice,
  MSG_NO_AUDITORS_EXIST, MSG_NO_AUDITOR_SELECTED, MSG_PANEL_UNDER_MIN, AUDITOR_CREATION_PATH,
} from "../auditorGuard";
import { aiOfflineReason } from "../ai/aiClient";
import type { AuditorProfile } from "../../types";

function auditor(id: string, over: Partial<AuditorProfile> = {}): AuditorProfile {
  return { id, auditCycleId: "c1", name: id, type: "Internal", role: "Reviewer", strictness: 70, focusArea: "", checklistTemplateId: "t", ...over };
}

describe("checkAuditorForRun — the run gate", () => {
  it("(b) blocks with the 'no auditors exist' message when the roster is empty (run button disabled state)", () => {
    const r = checkAuditorForRun([], null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("none-exist");
      expect(r.message).toBe(MSG_NO_AUDITORS_EXIST);
      expect(r.message).toContain("Auditor Creation");
    }
  });

  it("(a) the 'none selected' message names the selector and Auditor Creation", () => {
    // The message constant is what the store banner shows when a run is refused.
    expect(MSG_NO_AUDITOR_SELECTED).toContain("Run audit as");
    expect(MSG_NO_AUDITOR_SELECTED).toContain("Auditor Creation");
    expect(AUDITOR_CREATION_PATH).toBe("/auditors");
  });

  it("passes with the explicit selection, and falls back Audit Lead → first (what the selector displays)", () => {
    const auds = [auditor("a1"), auditor("a2", { role: "Audit Lead" }), auditor("a3")];
    const explicit = checkAuditorForRun(auds, "a3");
    expect(explicit.ok && explicit.auditor.id).toBe("a3");
    const fallbackLead = checkAuditorForRun(auds, null);
    expect(fallbackLead.ok && fallbackLead.auditor.id).toBe("a2");
    expect(resolveRunAuditor([auditor("only")], "stale-id")?.id).toBe("only");
  });
});

describe("independenceNotice — ISO 19011 self-audit warning", () => {
  it("warns (case-insensitively) when the auditor's department owns the audited folder", () => {
    const msg = independenceNotice(auditor("a1", { name: "Tan", departmentId: "ACAD" }), "acad");
    expect(msg).toContain("Independence risk");
    expect(msg).toContain("Tan");
  });
  it("stays silent for a different department or when either side is unset", () => {
    expect(independenceNotice(auditor("a1", { departmentId: "ACAD" }), "REG")).toBeUndefined();
    expect(independenceNotice(auditor("a1"), "REG")).toBeUndefined();
    expect(independenceNotice(auditor("a1", { departmentId: "ACAD" }), "")).toBeUndefined();
    expect(independenceNotice(undefined, "REG")).toBeUndefined();
  });
});

describe("panelUnderMinNotice — (c) non-blocking panel warning", () => {
  const auds = [auditor("a1"), auditor("a2"), auditor("a3")];
  it("warns when the panel is on but has fewer than 2 assigned auditors", () => {
    expect(panelUnderMinNotice("on-demand", auds, [])).toBe(MSG_PANEL_UNDER_MIN);
    expect(panelUnderMinNotice("all", auds, ["a1"])).toBe(MSG_PANEL_UNDER_MIN);
    expect(MSG_PANEL_UNDER_MIN).toContain("Auditor Creation");
    expect(MSG_PANEL_UNDER_MIN).toContain("Off in Settings");
  });
  it("stays silent when the panel is Off or properly staffed", () => {
    expect(panelUnderMinNotice("off", auds, [])).toBeUndefined();
    expect(panelUnderMinNotice("nc-major-auto", auds, ["a1", "a2"])).toBeUndefined();
  });
});

describe("runAuditorDisplay — who the run will be attributed to", () => {
  it("shows name + perspective for the resolved auditor", () => {
    const d = runAuditorDisplay([auditor("Rachel", { reviewPerspective: "risk-challenger" })], null);
    expect(d.unassigned).toBe(false);
    expect(d.text).toBe("Rachel · Risk Challenger");
  });
  it("flags Unassigned as a warning state when no auditor resolves", () => {
    const d = runAuditorDisplay([], null);
    expect(d.unassigned).toBe(true);
    expect(d.text).toContain("Unassigned");
  });
});

describe("aiOfflineReason — no more silent offline fallback", () => {
  it("explains a missing key (per-device storage) and points at Settings", () => {
    const r = aiOfflineReason({ enabled: true, apiKey: "" });
    expect(r).toContain("Settings → OpenAI");
    expect(r).toContain("never syncs");
  });
  it("explains AI being switched off", () => {
    expect(aiOfflineReason({ enabled: false, apiKey: "sk-x" })).toContain("switched off");
    expect(aiOfflineReason({ enabled: false, apiKey: "" })).toContain("enable it and enter your key");
  });
  it("returns null when live AI is available", () => {
    expect(aiOfflineReason({ enabled: true, apiKey: "sk-x" })).toBeNull();
  });
});
