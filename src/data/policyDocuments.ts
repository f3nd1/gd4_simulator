// UCC's master Policy and Procedure register, as supplied by the audit lead.
//
// This is the SOURCE OF OWNERSHIP for GD4 scopes. An earlier version of this
// work inferred which department owned which scope by reading the GD4 text and
// guessing; seven of thirty were wrong. Ownership is now read off the real
// document codes instead, so the app can only ever claim what UCC's own filing
// claims.
//
// Codes are stored EXACTLY as written. PPD-OE-FN-1.1.1 is the one code that
// spells the division "OE" where every other Operational Excellence code says
// "OEE". That is the real code and is deliberately not normalised here — the
// audit lead is correcting it at source, and until then a "corrected" code in
// this app would not match the document on the shelf.
//
// Nothing in this app generates a document code. Only codes present in this
// list are ever shown.

export type PolicyDocument = {
  // The document code, verbatim.
  code: string;
  title: string;
  // The heading it sits under in UCC's register: a GD4 criterion, or a
  // management-system series (ISMS / PDPA / AIMS / HIRA).
  section: string;
  // The GD4 run scope this document covers. ABSENT means it is a real
  // controlled document that is not a GD4 audit scope — the ISMS, PDPA, AIMS
  // and HIRA series, and Provider Accreditation. They are held here so the
  // register is complete, and are never mapped to an audit area.
  scopeId?: string;
  // Set on the owning document when a scope has more than one. 1.1 is covered
  // by both Leadership and Corporate Governance and Financial Management; the
  // audit lead names SGL-CG as the primary owner.
  primary?: boolean;
};

// Version and last-updated deliberately do NOT live on these rows. They change
// whenever UCC revises a document, and a value baked into the bundle would be
// stale the moment it shipped and could only be corrected by a deploy. They
// are held per code in the workspace store instead (policyDocEdits), as a diff
// against this list, so the team edits them in the app and everyone sees it.
// What the team can edit per code, in the app. Both are free text: UCC's
// versions are written as "V1", "v0.2" and "Rev 3" in different series, and
// forcing a shape here would stop a real version being enterable.
export type PolicyDocEdit = { version?: string; updatedAt?: string };

export const POLICY_DOCUMENTS: PolicyDocument[] = [
  { code: "PPD-SGL-CG-1.1.1", title: "Leadership And Corporate Governance", section: "Criterion 1 - Leadership and Strategic Planning", scopeId: "1.1", primary: true },
  { code: "PPD-OE-FN-1.1.1", title: "Financial Management", section: "Criterion 1 - Leadership and Strategic Planning", scopeId: "1.1" },
  { code: "PPD-SGL-SQ-1.2.1", title: "Strategic Planning", section: "Criterion 1 - Leadership and Strategic Planning", scopeId: "1.2" },

  { code: "PPD-SES-MG-2.2.1", title: "Internal and External Communication", section: "Criterion 2 - Corporate Administration", scopeId: "2.2" },
  { code: "PPD-OEE-HR-2.1.1", title: "Staff Selection and Management", section: "Criterion 2 - Corporate Administration", scopeId: "2.1.1" },
  { code: "PPD-OEE-HR-2.1.2", title: "Staff Training and Development", section: "Criterion 2 - Corporate Administration", scopeId: "2.1.2" },
  { code: "PPD-OEE-IT-2.3.1", title: "Data and Information Management", section: "Criterion 2 - Corporate Administration", scopeId: "2.3.1" },
  { code: "PPD-OEE-IT-2.3.2", title: "Knowledge Management", section: "Criterion 2 - Corporate Administration", scopeId: "2.3.2" },
  { code: "PPD-SGL-SQ-2.4.1", title: "Feedback Management", section: "Criterion 2 - Corporate Administration", scopeId: "2.4.1" },
  { code: "PPD-SGL-SQ-2.4.2", title: "Student Satisfaction Survey", section: "Criterion 2 - Corporate Administration", scopeId: "2.4.2" },
  { code: "PPD-SGL-SQ-2.4.3", title: "Staff Satisfaction Survey", section: "Criterion 2 - Corporate Administration", scopeId: "2.4.3" },

  { code: "PPD-IT-ISMS-2.3.1a", title: "Information Risk Identification and Treatment", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1b", title: "Information Security Incident Management", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1c", title: "Secure Software Development and Coding Standards Policy", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1d", title: "Cryptographic Key Management", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1e", title: "Information Systems Capacity and Resource Management", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1f", title: "Change Management", section: "ISMS" },
  { code: "PPD-IT-ISMS-2.3.1g", title: "Document Control", section: "ISMS" },

  { code: "PPD-IT-PDPA-2.3.1a", title: "Data Protection and Security Policy", section: "PDPA" },
  { code: "PPD-IT-PDPA-2.3.1b", title: "Personal Data Protection Policy for Internal", section: "PDPA" },
  { code: "PPD-IT-PDPA-2.3.1c", title: "Website Privacy", section: "PDPA" },
  { code: "PPD-IT-PDPA-2.3.1d", title: "Data Breach Management Plan", section: "PDPA" },
  { code: "PPD-IT-PDPA-2.3.1e", title: "Data Protection Impact Assessment", section: "PDPA" },

  { code: "PPD-IT-AIMS-2.3.1a", title: "AI Development", section: "AIMS" },
  { code: "PPD-IT-AIMS-2.3.1b", title: "AI Deployment", section: "AIMS" },
  { code: "PPD-IT-AIMS-2.3.1c", title: "AI Incident Management", section: "AIMS" },
  { code: "PPD-IT-AIMS-2.3.1d", title: "AI System Impact and Risk Management", section: "AIMS" },

  { code: "PPD-SES-SL-3.1.1", title: "Selection And Appointment of External Recruitment Agents", section: "Criterion 3 - External Recruitment Agents", scopeId: "3.1" },
  { code: "PPD-SES-SL-3.2.1", title: "Management and Evaluation of Recruitment Agents", section: "Criterion 3 - External Recruitment Agents", scopeId: "3.2" },

  { code: "PPD-SSO-AD-4.1.1", title: "Pre-Course Counselling, Selection and Admissions", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.1" },
  { code: "PPD-SSO-AD-4.2.1", title: "Student Contract", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.2.1" },
  { code: "PPD-SSO-AD-4.2.2", title: "Fee Collection And Fee Protection Scheme", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.2.2" },
  { code: "PPD-SSO-SS-4.3.1", title: "Course Transfer, Deferment and Withdrawal", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.3" },
  { code: "PPD-SSO-SS-4.4.1", title: "Refund", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.4" },
  { code: "PPD-SSO-SS-4.5.1", title: "Student Support Services", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.5" },
  { code: "PPD-SSO-SS-4.6.1", title: "Student Conduct and Attendance", section: "Criterion 4 - Student Protection and Support Services", scopeId: "4.6" },

  { code: "PPD-ALI-CD-5.1.1", title: "Course Design and Development", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.1.1" },
  { code: "PPD-ALI-CD-5.1.2", title: "Course Review", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.1.2" },
  { code: "PPD-ALI-CD-5.3.1", title: "Partnerships", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.3" },
  { code: "PPD-ALI-CM-5.2.1", title: "Course Planning", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.2.1" },
  { code: "PPD-ALI-CM-5.2.2", title: "Course Delivery", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.2.2" },
  { code: "PPD-ALI-CM-5.4.1", title: "Student Learning", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.4" },
  { code: "PPD-ALI-CM-5.5.1", title: "Student Assessment", section: "Criterion 5 - Academic Systems and Processes", scopeId: "5.5" },

  { code: "PPD-SGL-SQ-6.1.1", title: "Internal Assessment and Quality Audits", section: "Criterion 6 - Quality Assurance, Innovation and Continual Improvement", scopeId: "6.1" },
  { code: "PPD-SGL-SQ-6.2.1", title: "Management Review", section: "Criterion 6 - Quality Assurance, Innovation and Continual Improvement", scopeId: "6.2" },
  { code: "PPD-SGL-SQ-6.3.1", title: "Innovation and Continual Improvement", section: "Criterion 6 - Quality Assurance, Innovation and Continual Improvement", scopeId: "6.3" },
  // Filed under Criterion 6 in UCC's register, but GD4 Criterion 6 has only
  // 6.1-6.3, so neither of these is an audit scope. Held, not mapped.
  { code: "PPD-OEE-FN-6.4.1", title: "Provider Accreditation and Evaluation", section: "Criterion 6 - Quality Assurance, Innovation and Continual Improvement" },
  { code: "PPD-SGL-SQ-6.5.3", title: "Hazard Identification and Risk Assessment", section: "Criterion 6 - Quality Assurance, Innovation and Continual Improvement" },

  { code: "PPD-SGL-SQ-6.5.3a", title: "Office Activities", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3b", title: "Manual Handling", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3c", title: "Use of Hand Tools", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3d", title: "Building Maintenance and Repair", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3e", title: "Use of Ladder", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3f", title: "Electrical Safety", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3g", title: "Emergency Preparedness and Response", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3h", title: "Slip, Trip & Fall Prevention", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3i", title: "Health Promotion", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3j", title: "Fatigue", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3k", title: "SG Secure Practice", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3l", title: "Prevention of Infectious Diseases Outbreak", section: "HIRA" },
  { code: "PPD-SGL-SQ-6.5.3m", title: "Mental Well-Being at Workplaces", section: "HIRA" },

  { code: "PPD-SGL-SQ-7.1.1", title: "Measurement of Outcomes", section: "Criterion 7 - Performance Outcomes", scopeId: "7.1" },
];
