import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthGate } from "./components/auth/AuthGate";
import { Layout } from "./components/layout/Layout";
import { DevToolsRoute } from "./components/layout/DevToolsRoute";
import { Dashboard } from "./pages/Dashboard";
import { DraftWorkspace } from "./pages/DraftWorkspace";
import { AuditCycle } from "./pages/AuditCycle";
import { AuditorCreation } from "./pages/AuditorCreation";
import { EvidenceFolder } from "./pages/EvidenceFolder";
import { StartAudit } from "./pages/StartAudit";
import { GD4ScoringSetup } from "./pages/GD4ScoringSetup";
import { GD4Library } from "./pages/GD4Library";
import { PreCheckChecklistSetup } from "./pages/PreCheckChecklistSetup";
import { DomainChecklistLibrary } from "./pages/DomainChecklistLibrary";
import { EvidenceIntelligence } from "./pages/EvidenceIntelligence";
import { CriterionScorecard } from "./pages/CriterionScorecard";
import { RubricBanding } from "./pages/RubricBanding";
import { SubCriterionChecklist } from "./pages/SubCriterionChecklist";
import { Sampling } from "./pages/Sampling";
import { Interview } from "./pages/Interview";
import { Findings } from "./pages/Findings";
import { Clarification } from "./pages/Clarification";
import { AFIClosure } from "./pages/AFIClosure";
import { AIReview } from "./pages/AIReview";
import { HumanDecisionLog } from "./pages/HumanDecisionLog";
import { RunLog } from "./pages/RunLog";
import { AIDebugLog } from "./pages/AIDebugLog";
import { Finalisation } from "./pages/Finalisation";
import { ExportCentre } from "./pages/ExportCentre";
import { Settings } from "./pages/Settings";
import { AIMemories } from "./pages/AIMemories";
import { AICalibration } from "./pages/AICalibration";
import { PromptReview } from "./pages/PromptReview";
import { ChangeLog } from "./pages/ChangeLog";
import { ProfileOfPei } from "./pages/ProfileOfPei";
import { FinalReport } from "./pages/FinalReport";
import { DataDashboard } from "./pages/DataDashboard";
import { Help } from "./pages/Help";
import { SelfCheck } from "./pages/SelfCheck";
import { People } from "./pages/People";
import { AdminRoute } from "./components/layout/AdminRoute";

export default function App() {
  return (
    // EVERY route, including /self-check. The gate wraps the router rather
    // than each route, so a page added later is covered by default instead of
    // by remembering.
    <AuthGate>
    <HashRouter>
      <Routes>
        {/* Deliberately OUTSIDE the Layout: a process owner checking their own
            area must not meet the audit workspace chrome (four stages, ~30
            pages, cycles, calibration) or the locked-cycle banner, which is
            written for the audit lead. Additive — no existing route changes. */}
        <Route path="/self-check" element={<SelfCheck />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<DataDashboard />} />
          <Route path="/help" element={<Help />} />
          <Route path="/draft-workspace" element={<DraftWorkspace />} />
          <Route path="/audit-cycle" element={<AuditCycle />} />
          <Route path="/auditors" element={<AuditorCreation />} />
          <Route path="/start-audit" element={<StartAudit />} />
          <Route path="/evidence-folder" element={<EvidenceFolder />} />
          <Route path="/gd4-library" element={<GD4Library />} />
          <Route path="/evidence-intelligence" element={<EvidenceIntelligence />} />
          <Route path="/scorecard" element={<CriterionScorecard />} />
          <Route path="/rubric-banding" element={<RubricBanding />} />
          <Route path="/sub-checklist" element={<SubCriterionChecklist />} />
          <Route path="/sampling" element={<Sampling />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/clarification" element={<Clarification />} />
          <Route path="/afi-closure" element={<AFIClosure />} />
          {/* Diagnostic / superseded surfaces — inaccessible when developer
              tools are hidden in Settings (see DEVELOPER_TOOL_PATHS). The
              ChangeLog page keeps its own in-page guard for back-compat. */}
          {/* Admin only, every one of them. The guard refuses rather than
              redirects; lib/auth/pageAccess.ts is the single list, and says
              which of these are write-locked in Postgres and which are only
              hidden. */}
          <Route element={<AdminRoute />}>
            <Route path="/settings" element={<Settings />} />
            <Route path="/gd4-scoring-setup" element={<GD4ScoringSetup />} />
            <Route path="/profile-of-pei" element={<ProfileOfPei />} />
            <Route path="/checklist-library" element={<DomainChecklistLibrary />} />
            <Route path="/pre-check-setup" element={<PreCheckChecklistSetup />} />
            <Route path="/ai-memories" element={<AIMemories />} />
            <Route path="/prompt-review" element={<PromptReview />} />
            <Route path="/people" element={<People />} />
            {/* Admin-only AND diagnostic: both guards, nested, so hiding the
                developer tools still hides them from the admin too. */}
            <Route element={<DevToolsRoute />}>
              <Route path="/ai-calibration" element={<AICalibration />} />
              <Route path="/change-log" element={<ChangeLog />} />
            </Route>
          </Route>
          <Route element={<DevToolsRoute />}>
            <Route path="/ai-review" element={<AIReview />} />
            <Route path="/human-decision-log" element={<HumanDecisionLog />} />
            <Route path="/run-log" element={<RunLog />} />
            <Route path="/ai-debug" element={<AIDebugLog />} />
          </Route>
          {/* Version History merged into Draft Workspace; keep the old path working. */}
          <Route path="/version-history" element={<Navigate to="/draft-workspace" replace />} />
          <Route path="/final-report" element={<FinalReport />} />
          <Route path="/finalisation" element={<Finalisation />} />
          <Route path="/export" element={<ExportCentre />} />

        </Route>
      </Routes>
    </HashRouter>
    </AuthGate>
  );
}
