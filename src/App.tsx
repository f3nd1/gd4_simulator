import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
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
import { EvidenceIntelligence } from "./pages/EvidenceIntelligence";
import { CriterionScorecard } from "./pages/CriterionScorecard";
import { RubricBanding } from "./pages/RubricBanding";
import { SubCriterionChecklist } from "./pages/SubCriterionChecklist";
import { Sampling } from "./pages/Sampling";
import { Interview } from "./pages/Interview";
import { Findings } from "./pages/Findings";
import { AFIClosure } from "./pages/AFIClosure";
import { AIReview } from "./pages/AIReview";
import { HumanDecisionLog } from "./pages/HumanDecisionLog";
import { AIDebugLog } from "./pages/AIDebugLog";
import { Finalisation } from "./pages/Finalisation";
import { ExportCentre } from "./pages/ExportCentre";
import { Settings } from "./pages/Settings";
import { AIMemories } from "./pages/AIMemories";
import { AICalibration } from "./pages/AICalibration";
import { ChangeLog } from "./pages/ChangeLog";
import { ProfileOfPei } from "./pages/ProfileOfPei";
import { FinalReport } from "./pages/FinalReport";
import { Analytics } from "./pages/Analytics";
import { Help } from "./pages/Help";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/help" element={<Help />} />
          <Route path="/profile-of-pei" element={<ProfileOfPei />} />
          <Route path="/draft-workspace" element={<DraftWorkspace />} />
          <Route path="/audit-cycle" element={<AuditCycle />} />
          <Route path="/auditors" element={<AuditorCreation />} />
          <Route path="/start-audit" element={<StartAudit />} />
          <Route path="/evidence-folder" element={<EvidenceFolder />} />
          <Route path="/gd4-scoring-setup" element={<GD4ScoringSetup />} />
          <Route path="/gd4-library" element={<GD4Library />} />
          <Route path="/pre-check-setup" element={<PreCheckChecklistSetup />} />
          <Route path="/evidence-intelligence" element={<EvidenceIntelligence />} />
          <Route path="/scorecard" element={<CriterionScorecard />} />
          <Route path="/rubric-banding" element={<RubricBanding />} />
          <Route path="/sub-checklist" element={<SubCriterionChecklist />} />
          <Route path="/sampling" element={<Sampling />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/afi-closure" element={<AFIClosure />} />
          {/* Diagnostic / superseded surfaces — inaccessible when developer
              tools are hidden in Settings (see DEVELOPER_TOOL_PATHS). The
              ChangeLog page keeps its own in-page guard for back-compat. */}
          <Route element={<DevToolsRoute />}>
            <Route path="/ai-review" element={<AIReview />} />
            <Route path="/human-decision-log" element={<HumanDecisionLog />} />
            <Route path="/ai-debug" element={<AIDebugLog />} />
            <Route path="/ai-calibration" element={<AICalibration />} />
          </Route>
          {/* Version History merged into Draft Workspace; keep the old path working. */}
          <Route path="/version-history" element={<Navigate to="/draft-workspace" replace />} />
          <Route path="/final-report" element={<FinalReport />} />
          <Route path="/finalisation" element={<Finalisation />} />
          <Route path="/export" element={<ExportCentre />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/ai-memories" element={<AIMemories />} />
          <Route path="/change-log" element={<ChangeLog />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
