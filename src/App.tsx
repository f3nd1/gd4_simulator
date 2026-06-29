import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { DraftWorkspace } from "./pages/DraftWorkspace";
import { AuditCycle } from "./pages/AuditCycle";
import { AuditorCreation } from "./pages/AuditorCreation";
import { EvidenceFolder } from "./pages/EvidenceFolder";
import { GD4ScoringSetup } from "./pages/GD4ScoringSetup";
import { GD4Library } from "./pages/GD4Library";
import { EvidenceMatrix } from "./pages/EvidenceMatrix";
import { EvidenceIntelligence } from "./pages/EvidenceIntelligence";
import { CriterionScorecard } from "./pages/CriterionScorecard";
import { RubricBanding } from "./pages/RubricBanding";
import { SubCriterionChecklist } from "./pages/SubCriterionChecklist";
import { Sampling } from "./pages/Sampling";
import { Interview } from "./pages/Interview";
import { Findings } from "./pages/Findings";
import { AFIClosure } from "./pages/AFIClosure";
import { AIReview } from "./pages/AIReview";
import { HumanReview } from "./pages/HumanReview";
import { ReAudit } from "./pages/ReAudit";
import { ManagementReview } from "./pages/ManagementReview";
import { Finalisation } from "./pages/Finalisation";
import { ExportCentre } from "./pages/ExportCentre";
import { Settings } from "./pages/Settings";
import { SchoolContext } from "./pages/SchoolContext";
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
          <Route path="/school-context" element={<SchoolContext />} />
          <Route path="/draft-workspace" element={<DraftWorkspace />} />
          <Route path="/audit-cycle" element={<AuditCycle />} />
          <Route path="/auditors" element={<AuditorCreation />} />
          <Route path="/evidence-folder" element={<EvidenceFolder />} />
          <Route path="/gd4-scoring-setup" element={<GD4ScoringSetup />} />
          <Route path="/gd4-library" element={<GD4Library />} />
          <Route path="/evidence-matrix" element={<EvidenceMatrix />} />
          <Route path="/evidence-intelligence" element={<EvidenceIntelligence />} />
          <Route path="/scorecard" element={<CriterionScorecard />} />
          <Route path="/rubric-banding" element={<RubricBanding />} />
          <Route path="/sub-checklist" element={<SubCriterionChecklist />} />
          <Route path="/sampling" element={<Sampling />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/afi-closure" element={<AFIClosure />} />
          <Route path="/ai-review" element={<AIReview />} />
          <Route path="/human-review" element={<HumanReview />} />
          <Route path="/re-audit" element={<ReAudit />} />
          {/* Version History merged into Draft Workspace; keep the old path working. */}
          <Route path="/version-history" element={<Navigate to="/draft-workspace" replace />} />
          <Route path="/final-report" element={<FinalReport />} />
          <Route path="/management-review" element={<ManagementReview />} />
          <Route path="/finalisation" element={<Finalisation />} />
          <Route path="/export" element={<ExportCentre />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
