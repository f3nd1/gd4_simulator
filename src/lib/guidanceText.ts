// State-aware and mode-aware "what to do now" text for the next-step banner.
// Pure so the banner logic is unit-testable. Warm, plain, UK spelling, short.

import type { AuditMode } from "../types";

export type GuidancePage = "start-audit" | "evidence-folder" | "ppd-review" | "sub-checklist" | "findings";

export type GuidanceContext = {
  mode: AuditMode;
  // Evidence Folder state
  linkedFolders?: number;
  totalFolders?: number;
  pendingGates?: number;      // hybrid verdicts awaiting approval
  fullAuditRunning?: boolean;
  // PPD Review state
  ppdRun?: boolean;
  evidenceRun?: boolean;
  findingsCompiled?: boolean;
  // Findings state
  openDrafts?: number;
  openFindings?: number;
};

export function nextStepText(page: GuidancePage, ctx: GuidanceContext): string {
  switch (page) {
    case "start-audit":
      return "Choose how much you want the AI to do, then continue to Evidence Folder.";

    case "evidence-folder": {
      if ((ctx.pendingGates ?? 0) > 0) {
        return `You have ${ctx.pendingGates} AI verdict${ctx.pendingGates === 1 ? "" : "s"} waiting for your approval. Open the sub-criterion's review (its "View results" button) to approve, edit or reject each one beside the evidence that produced it.`;
      }
      if ((ctx.linkedFolders ?? 0) === 0) {
        return "Start by pasting a Google Drive link for each sub-criterion's Policy and Evidence folders, then check access.";
      }
      if (ctx.mode === "full-auto") {
        return ctx.fullAuditRunning
          ? "The full audit is running. You can watch progress or cancel at any time."
          : "Your folder links are set. Click 'Run full audit' at the top to assess everything in one go.";
      }
      if (ctx.mode === "manual") {
        return "Manual mode: open each sub-criterion's checklist and enter verdicts yourself. Ask the AI for a suggestion on any item when you want one.";
      }
      return "Pick Option A or B for a sub-criterion, then click its run button to start. You'll approve each result before it commits.";
    }

    case "ppd-review": {
      if (!ctx.ppdRun) return "Run the PPD review first: it checks whether your policy document covers each GD4 requirement.";
      if (!ctx.evidenceRun) return "PPD review done. Now switch to the Evidence tab and run the evidence assessment to check implementation.";
      if (!ctx.findingsCompiled) {
        return ctx.mode === "hybrid"
          ? "Review each AI verdict below. Edit any you disagree with, then compile findings."
          : "Both checks are done. Compile findings to add the gaps to the Findings register.";
      }
      return "This sub-criterion is assessed and compiled. Head to Findings to review what was raised, or back to Evidence Folder for the next one.";
    }

    case "sub-checklist": {
      if (ctx.mode === "manual") return "Mark each line Met, Partial or Not met and attach the evidence that proves it. The band updates as you go.";
      return "These verdicts drive the band. Adjust any line you disagree with, then raise findings for the gaps.";
    }

    case "findings": {
      if ((ctx.openDrafts ?? 0) > 0) return `You have ${ctx.openDrafts} draft finding${ctx.openDrafts === 1 ? "" : "s"} to review. Confirm each one to add it to the register.`;
      if ((ctx.openFindings ?? 0) > 0) return "Review your open findings, then work through closures in Quality Action / AFI.";
      return "No findings yet. Run an audit from Evidence Folder, or raise findings from failing checklist lines.";
    }
  }
}
