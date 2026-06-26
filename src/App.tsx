import { HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./pages/Dashboard";
import { DraftWorkspace } from "./pages/DraftWorkspace";
import { AuditCycle } from "./pages/AuditCycle";
import { AuditorCreation } from "./pages/AuditorCreation";
import { AuditorChecklist } from "./pages/AuditorChecklist";
import { EvidenceFolder } from "./pages/EvidenceFolder";
import { GD4ScoringSetup } from "./pages/GD4ScoringSetup";
import { GD4Library } from "./pages/GD4Library";
import { EvidenceMatrix } from "./pages/EvidenceMatrix";
import { EvidenceIntelligence } from "./pages/EvidenceIntelligence";
import { CriterionScorecard } from "./pages/CriterionScorecard";
import { RubricBanding } from "./pages/RubricBanding";
import { Sampling } from "./pages/Sampling";
import { Interview } from "./pages/Interview";
import { Findings } from "./pages/Findings";
import { AFIClosure } from "./pages/AFIClosure";
import { AIReview } from "./pages/AIReview";
import { HumanReview } from "./pages/HumanReview";
import { ReAudit } from "./pages/ReAudit";
import { VersionHistory } from "./pages/VersionHistory";
import { ManagementReview } from "./pages/ManagementReview";
import { Finalisation } from "./pages/Finalisation";
import { ExportCentre } from "./pages/ExportCentre";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/draft-workspace" element={<DraftWorkspace />} />
          <Route path="/audit-cycle" element={<AuditCycle />} />
          <Route path="/auditors" element={<AuditorCreation />} />
          <Route path="/checklist" element={<AuditorChecklist />} />
          <Route path="/evidence-folder" element={<EvidenceFolder />} />
          <Route path="/gd4-scoring-setup" element={<GD4ScoringSetup />} />
          <Route path="/gd4-library" element={<GD4Library />} />
          <Route path="/evidence-matrix" element={<EvidenceMatrix />} />
          <Route path="/evidence-intelligence" element={<EvidenceIntelligence />} />
          <Route path="/scorecard" element={<CriterionScorecard />} />
          <Route path="/rubric-banding" element={<RubricBanding />} />
          <Route path="/sampling" element={<Sampling />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/afi-closure" element={<AFIClosure />} />
          <Route path="/ai-review" element={<AIReview />} />
          <Route path="/human-review" element={<HumanReview />} />
          <Route path="/re-audit" element={<ReAudit />} />
          <Route path="/version-history" element={<VersionHistory />} />
          <Route path="/management-review" element={<ManagementReview />} />
          <Route path="/finalisation" element={<Finalisation />} />
          <Route path="/export" element={<ExportCentre />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
