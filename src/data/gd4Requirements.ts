import type { GD4Requirement, GD4SubCriterion, FlatAuditPoint } from "../types";
import { normalizeAuditRef } from "../lib/gd4Refs";

// Source of truth: EduTrust Guidance Document Version 4 (SkillsFuture
// Singapore, January 2025) — sections "Scoring and Banding System" and
// "Criterion Requirements". Criteria, sub-criteria, items, titles,
// Describe/Show requirements and Notes below are taken directly from that
// document. Nothing here is invented; this file must stay in sync with the
// official text if the GD4 guidance document is ever revised.

export type GD4Criterion = { id: string; title: string; points: number };

export const GD4_CRITERIA: GD4Criterion[] = [
  { id: "1", title: "Leadership and Strategic Planning", points: 60 },
  { id: "2", title: "Corporate Administration", points: 100 },
  { id: "3", title: "External Recruitment Agents", points: 60 },
  { id: "4", title: "Student Protection and Support Services", points: 200 },
  { id: "5", title: "Academic Systems and Processes", points: 200 },
  { id: "6", title: "Quality Assurance, Innovation and Continual Improvement", points: 50 },
  { id: "7", title: "Performance Outcomes", points: 330 },
];

export const GD4_SUB_CRITERIA: GD4SubCriterion[] = [
  { id: "1.1", criterionId: "1", title: "Leadership & Corporate Governance", description: "This sub-criterion examines the leadership's commitment in driving the PEI towards excellence, and how you manage your corporate governance and financial resources to ensure operational sustainability and good financial health." },
  { id: "1.2", criterionId: "1", title: "Strategic Planning", description: "This sub-criterion examines how you conduct your strategic planning to provide educational services that are aligned with your vision and mission. It also examines the alignment of your strategic plan with your plans on risk management, business continuity, resources and finance budgeting." },

  // 2.1 Human Resource is split into the GD4 Library's two sub-criteria
  // (2.1.1 / 2.1.2) so each carries its own Evidence Folder row and band.
  { id: "2.1.1", criterionId: "2", title: "Staff Selection and Management", description: "This sub-criterion examines your human resource management system for all staff — selection and recruitment, manpower planning and deployment, code of conduct, appraisal and performance monitoring, rewards and recognition, and talent management and retention — and how you review it for continual improvement." },
  { id: "2.1.2", criterionId: "2", title: "Staff Training and Development", description: "This sub-criterion examines how you determine, deliver and evaluate the training and development needs of all staff to build competencies, and how you review the training and development processes for continual improvement." },
  { id: "2.2", criterionId: "2", title: "Communication", description: "This sub-criterion examines how you communicate with internal and external stakeholders to ensure that relevant information is provided in an accurate and timely manner. It further examines your marketing and external communications such as advertisements of any permitted course accessible by or published to the public, and advertisements published by third parties on your behalf." },
  // 2.3 is split into the GD4 Library's 2.3.1 (Data & Information) and
  // 2.3.2 (Knowledge Management) sub-criteria.
  { id: "2.3.1", criterionId: "2", title: "Data and Information Management", description: "This sub-criterion examines how you collect, manage and secure data and information to measure achievement of your strategic KPIs and support decision-making, ensuring accuracy, reliability, accessibility, confidentiality and timely availability." },
  { id: "2.3.2", criterionId: "2", title: "Knowledge Management", description: "This sub-criterion examines how you collect, organise and share organisational knowledge, maintain up-to-date policy and operations manuals, and implement document control over revisions." },
  // 2.4 is split into the GD4 Library's three sub-criteria.
  { id: "2.4.1", criterionId: "2", title: "Feedback Management", description: "This sub-criterion examines your system for collecting, responding to and analysing feedback in a timely manner, including dispute resolution aligned with the Private Education Regulations." },
  { id: "2.4.2", criterionId: "2", title: "Student Satisfaction Survey", description: "This sub-criterion examines how you conduct student satisfaction surveys and use the findings in the review of academic and administrative processes." },
  { id: "2.4.3", criterionId: "2", title: "Staff Satisfaction Survey", description: "This sub-criterion examines how you conduct staff satisfaction surveys and use the findings to improve overall staff satisfaction and retention." },

  { id: "3.1", criterionId: "3", title: "Selection and Appointment of External Recruitment Agents", description: "This sub-criterion examines how you select and appoint external recruitment agents to ensure that only reliable and credible agents are engaged to recruit students for the PEI." },
  { id: "3.2", criterionId: "3", title: "Management and Evaluation of External Recruitment Agents", description: "This sub-criterion examines how you manage and evaluate external recruitment agents to ensure that the appointed agents are consistently providing quality services to the PEI's prospective students." },

  { id: "4.1", criterionId: "4", title: "Pre-Course Counselling, Student Selection and Admissions", description: "This sub-criterion examines how you conduct pre-course counselling for your prospective students. It also examines how you select and admit students to your courses." },
  { id: "4.2", criterionId: "4", title: "Student Contract, Fee Collection and Fee Protection Scheme", description: "This sub-criterion examines how you execute the student contract, how you inform students of fees payable/paid and implement fee protection for all fees paid by students, ensure accurate collection of fees and records of every payment made, and establish a revenue recognition policy to recognise fees on an accrual basis." },
  { id: "4.3", criterionId: "4", title: "Course Transfer, Deferment and Withdrawal", description: "This sub-criterion examines how you manage students' requests for course transfer, deferment and withdrawal." },
  { id: "4.4", criterionId: "4", title: "Refund", description: "This sub-criterion examines how you manage refunds for students under various conditions." },
  { id: "4.5", criterionId: "4", title: "Student Support Services", description: "This sub-criterion examines student support services that you provide to meet students' needs." },
  { id: "4.6", criterionId: "4", title: "Student Conduct and Attendance", description: "This sub-criterion examines how you monitor students' conduct and attendance and examines how you take appropriate and timely intervention actions for students with poor conduct or attendance." },

  // 5.1 is split into the GD4 Library's 5.1.1 / 5.1.2 sub-criteria (both
  // gate-sensitive, being under Criterion 5).
  { id: "5.1.1", criterionId: "5", title: "Course Design and Development", description: "This sub-criterion examines how you design and develop courses and modules, involve stakeholders and the Academic Board, and review the course design and development process for continual improvement." },
  { id: "5.1.2", criterionId: "5", title: "Course Review", description: "This sub-criterion examines how you review the curriculum of each course using assessment results, feedback, trend data and benchmarks, involve the Academic Board, and review the course and module review processes for continual improvement." },
  // 5.2 is split into the GD4 Library's 5.2.1 / 5.2.2 sub-criteria (both
  // gate-sensitive, being under Criterion 5).
  { id: "5.2.1", criterionId: "5", title: "Course Planning", description: "This sub-criterion examines how you plan each course — logistics and academic preparation, qualified staff, adequate resources and transition planning — and review the course planning process for continual improvement." },
  { id: "5.2.2", criterionId: "5", title: "Course Delivery", description: "This sub-criterion examines how you deliver courses against approved learning outcomes and delivery plans, monitor teaching quality, evaluate academic staff and review the course delivery and monitoring processes for continual improvement." },
  { id: "5.3", criterionId: "5", title: "Partnerships", description: "This sub-criterion examines how you manage your external academic partners to ensure that the partnerships add value to your organisation and your students." },
  { id: "5.4", criterionId: "5", title: "Student Learning", description: "This sub-criterion examines how you monitor student learning and take appropriate and timely intervention actions for students who have not met the required standards of achievement." },
  { id: "5.5", criterionId: "5", title: "Student Assessment", description: "This sub-criterion examines how you assess the learning outcomes of the students through various modes of assessments, including online assessment, if applicable. It also examines how you engage the Examination Board to develop and implement assessment policies and procedures, including the management of assessment results and appeals." },

  { id: "6.1", criterionId: "6", title: "Internal Assessment", description: "This sub-criterion examines how you conduct internal assessment to ensure alignment of your operations with documented policies and procedures to meet EduTrust requirements and verify effectiveness of your systems and processes." },
  { id: "6.2", criterionId: "6", title: "Management Review", description: "This sub-criterion examines how the Management reviews overall organisational performance to ensure that the PEI is on track to achieve its vision and mission." },
  { id: "6.3", criterionId: "6", title: "Innovation and Continual Improvement", description: "This sub-criterion examines how you commit yourself to involve stakeholders in efforts towards organisation excellence and innovation. It also examines your commitment towards making appropriate investments to enhance your institutional quality." },

  // Criterion 7 is a single sub-criterion 7.1 with one item, 7.1.1. 7.2
  // "Achievement of Outcomes" was folded in, and its four outcome areas
  // (student & graduate, service quality, operational, people development) are
  // all evidenced under 7.1.1 Measurement of Outcomes for this PEI, so they are
  // covered by that one item rather than tracked as separate lines. This is a
  // deliberate departure from the GD4 Library's 7.1/7.2 split (confirmed
  // 2026-07-05).
  { id: "7.1", criterionId: "7", title: "Measurement of Outcomes", description: "This sub-criterion examines how you identify, track and improve the outcomes of your systems to improve institution and academic quality, including the achievement of student and graduate, service quality, operational and people development outcomes." },
];

type RawItem = {
  id: string;
  subCriterionId: string;
  title: string;
  describeShow: string[];
  notes?: string[];
  expectedEvidence: string[];
};

const RAW_ITEMS: RawItem[] = [
  {
    id: "1.1.1",
    subCriterionId: "1.1",
    title: "Leadership and Corporate Governance",
    describeShow: [
      "Set your organisation's vision, mission and values",
      "Engage your key stakeholders to support the vision, mission and values",
      "Maintain a governance system with robust management and financial controls, that ensures transparency and accountability, and fulfils your responsibility to the community",
      "Monitor your financial statements regularly including ensuring that staff handling finances maintain accurate and proper record-keeping of financial data and fee payments",
      "Review your leadership and corporate governance system for continual improvement",
    ],
    notes: [
      "Key stakeholders refer to: a. individuals that the PEI provides a service to, for example students; and b. individuals or entities who play a critical role towards achieving the organisation's vision and mission, for example staff, academic and examination boards, educational partners, key partners, the community etc.",
      "The governance system encompasses, but is not limited to, management, financial and organisational controls, risk management, compliance with statutory and regulatory requirements, succession planning for top management, policies on ethical behaviour and programmes to support community involvement.",
      "For good financial practice, the annual financial statements should be certified by an independent external auditor based on guidelines stipulated by Accounting and Corporate Regulatory Authority (ACRA) Companies Act.",
    ],
    expectedEvidence: ["Governance system documentation", "Annual financial statements / external audit certification", "Stakeholder engagement records", "Governance review records"],
  },
  {
    id: "1.2.1",
    subCriterionId: "1.2",
    title: "Strategic Planning",
    describeShow: [
      "Your process in developing and implementing effective strategies to realise long-term and short-term goals, key performance indicators and related targets",
      "How you align your strategic plans with your risk management plan, business continuity plan, financial/budget plan and resource plan",
      "Your department/unit work plans that are aligned with your strategic plans",
      "How you review your department/unit plans and, where necessary, revise plans",
      "Your review of the strategic planning process and strategic plan for continual improvement",
    ],
    notes: ["Key performance indicators shall include and not limited to student experience and student learning outcomes."],
    expectedEvidence: ["Strategic plan document", "Risk management / business continuity / budget / resource plans", "Department work plans", "Strategic plan review records"],
  },

  {
    id: "2.1.1",
    subCriterionId: "2.1.1",
    title: "Staff Selection and Management",
    describeShow: [
      "Your human resource management system for all staff which is aligned to strategic goals and organisational values. The system shall include: selection and recruitment; manpower planning and deployment; staff code of conduct; appraisal and performance monitoring; rewards and recognition; talent management and retention",
      "Your review of the human resource system and practices for continual improvement",
    ],
    notes: [
      "Staff includes minimally full-time staff, part-time staff, academic and non-academic staff.",
      "Process for staff selection and recruitment shall include: a. setting selection criteria and minimum qualifications required for every job function before recruitment — for academic positions, Academic Board and external academic partners (if applicable) should set the selection criteria; b. verifying the originality of applicants' academic qualifications; c. approving all shortlisted staff before recruitment — for academic positions, approval by Academic Board and external academic partners (if applicable) is required.",
      "Including setting and monitoring of achievement of targets in individual staff work plans.",
      "Establish a system for succession planning and management.",
    ],
    expectedEvidence: ["HR management system / policy", "Selection and recruitment records", "Staff appraisal records", "HR system review records"],
  },
  {
    id: "2.1.2",
    subCriterionId: "2.1.2",
    title: "Staff Training and Development",
    describeShow: [
      "Determine the training and development needs to build up competencies of all staff",
      "Monitor and analyse the adequacy and effectiveness of the training and development provided to staff, for example transfer of learning to performance at work",
      "Review the training and development processes for continual improvement",
    ],
    expectedEvidence: ["Training needs analysis", "Training records and effectiveness evaluation", "Training process review records"],
  },
  {
    id: "2.2.1",
    subCriterionId: "2.2",
    title: "Internal Communication",
    describeShow: [
      "Your internal communication procedures for the dissemination of information to stakeholders in a timely manner",
      "How you ensure the accuracy of information provided to stakeholders",
      "Your review of the internal communication process and channels for continual improvement",
    ],
    expectedEvidence: ["Internal communication policy/procedure", "Communication records", "Communication process review records"],
  },
  {
    id: "2.2.2",
    subCriterionId: "2.2",
    title: "External Communication including Marketing",
    describeShow: [
      "Ensure the accuracy of information provided to stakeholders through your marketing practices. The procedures shall include vetting and approval by the Management prior to publication of advertisements and adherence to SSG Advertising Guidelines for the Private Education Sector",
      "Review your marketing and external communication procedures for continual improvement",
    ],
    notes: [
      "Advertisements may be broadly described as any form of commercial communication that PEIs use to promote itself, its courses, and its services to students or prospective students. This includes advertisements in all forms of medium and media, issued by the PEI or external student recruitment agents. They may include, without limitation, notices, circulars, pamphlets, brochures, prospectus, television advertisements, radio advertisements, internet or social media advertisements, placards, newspaper advertisements, magazine or journal advertisements, and verbal announcements.",
    ],
    expectedEvidence: ["Advertisement vetting and approval records", "SSG Advertising Guidelines compliance check", "Marketing procedure review records"],
  },
  {
    id: "2.3.1",
    subCriterionId: "2.3.1",
    title: "Data and Information Management",
    describeShow: [
      "Collect data and manage information to measure and evaluate the achievement of all key performance indicators and related targets in the strategic plan for decision-making",
      "Establish a process and system to collect, classify, store, analyse and manage data and relevant information of all students, graduates and staff for organisational learning and planning, and to support decision-making",
      "Ensure the accuracy, reliability and accessibility of compiled data",
      "Ensure the availability of required organisational data and information in a timely manner to relevant stakeholders",
      "Ensure the confidentiality and security of all data and information kept, including electronic data, course assessment materials and results",
      "Leverage a systematic process to analyse comparative data and information to drive organisational performance",
      "Review the data and information management systems, and confidentiality and security policy for continual improvement",
    ],
    notes: [
      "You shall comply to the Personal Data Protection Act.",
      "Comparative data can be obtained through benchmarking with processes and outcomes that represent the best practices for similar activities, within or outside the private education sector. Comparative data could be used in reviewing and improving key business processes.",
    ],
    expectedEvidence: ["Data management system documentation", "Data security / confidentiality policy", "Comparative data analysis records", "System review records"],
  },
  {
    id: "2.3.2",
    subCriterionId: "2.3.2",
    title: "Knowledge Management",
    describeShow: [
      "Collect, organise, share and systematically enable the use of organisational knowledge to create value and learning",
      "Maintain up-to-date policy and operations manual(s) that is/are readily accessible by staff",
      "Implement the document control procedure to keep track of the revision history of documents and the corresponding approval authority for the revisions",
      "Review the management of organisational knowledge for continual improvement",
    ],
    expectedEvidence: ["Policy and operations manuals", "Document control / revision history records", "Knowledge management review records"],
  },
  {
    id: "2.4.1",
    subCriterionId: "2.4.1",
    title: "Feedback Management",
    describeShow: [
      "Ensure an effective feedback management system",
      "Ensure that the dispute resolution policy and procedures are aligned with the Private Education Regulations and communicated to students",
      "Effectively use feedback to identify what drives positive experiences",
      "Review the feedback management system for continual improvement",
    ],
    notes: [
      "An effective feedback, which includes complaints and compliments, management system ensures that all feedback received are acknowledged and evaluated for follow-up action. Any action taken is recorded and made known to the person giving the feedback. All complaints shall be resolved within a reasonable time frame.",
    ],
    expectedEvidence: ["Feedback management policy/procedure", "Dispute resolution policy", "Feedback log and follow-up action records", "Feedback system review records"],
  },
  {
    id: "2.4.2",
    subCriterionId: "2.4.2",
    title: "Student Satisfaction Survey",
    describeShow: [
      "Conduct student satisfaction survey(s) for services rendered. The student satisfaction survey(s) shall cover the following: overall student satisfaction level; quality of student support services; physical facilities and infrastructure to support learning; effectiveness of communication; course counselling, if applicable; adequacy, accessibility and quality of teaching-learning resources and the school environment; academic staff performance i.e. quality of teaching; pre-course counselling experience of students; assessment methods and frequency",
      "Use student survey findings in the review of academic and administrative processes",
      "Review the procedure of conducting the student satisfaction survey for continual improvement",
    ],
    notes: ["You may consider conducting surveys after every module and after course completion or on an annual basis."],
    expectedEvidence: ["Student satisfaction survey instrument and results", "Review of academic/administrative processes using survey findings", "Survey procedure review records"],
  },
  {
    id: "2.4.3",
    subCriterionId: "2.4.3",
    title: "Staff Satisfaction Survey",
    describeShow: [
      "Conduct staff satisfaction survey for all staff. The staff satisfaction survey shall cover the following: overall staff satisfaction level; human resource policy and practices; physical facilities and infrastructure; training and development opportunities provided; effectiveness of communication; teaching-learning resources and support, for academic staff; assessment methods and frequency, for academic staff",
      "Use the staff survey findings in improving overall staff satisfaction and retention",
      "Review the procedure of conducting the staff satisfaction survey for continual improvement",
    ],
    expectedEvidence: ["Staff satisfaction survey instrument and results", "Action taken on staff survey findings", "Survey procedure review records"],
  },

  {
    id: "3.1.1",
    subCriterionId: "3.1",
    title: "Selection and Appointment of External Recruitment Agents",
    describeShow: [
      "Identify, select and appoint your recruitment agents. This includes the setting of selection criteria and approving shortlisted agents by the Management",
      "Ensure a renewable contract established with each of your appointed agents. This contract shall cover: contract period; roles and responsibilities, including conducting pre-course counselling; terms of engagement and code of conduct; any fee or commission payable, if applicable, to the agent by the student; non-collection of monies, other than the commission or fees payable to the agents, from the students under any circumstance; service performance indicators; actions to be taken by you if your agents breach the contract terms and conditions of termination; the provisions under which the laws of Singapore will apply to the contract",
      "Maintain an up-to-date agent list published on the website. The agent list shall include: the countries in which the agents recruit students and/or perform marketing roles; the start and end date of current contract; agents who are no longer representing the PEI, stating the effective date of non-representation",
      "Review the agent selection and appointment procedures for continual improvement",
    ],
    notes: ["The selection criteria for agents may include the following: a. track record; b. references; c. authorisation by respective government for recruitment activities, if applicable."],
    expectedEvidence: ["Agent selection criteria and approval records", "Signed agent contracts", "Published up-to-date agent list", "Selection/appointment procedure review records"],
  },
  {
    id: "3.2.1",
    subCriterionId: "3.2",
    title: "Management and Evaluation of External Recruitment Agents",
    describeShow: [
      "Manage your agents. This includes: ensuring agents have good understanding of critical information in order to provide pre-course counselling for prospective students. This could be carried out through continual training and timely updating of the agents on changes to such critical information; ensuring agents adhere to the agent contract and abide by the code of conduct at all times; taking appropriate and timely actions if any agent violates the contractual agreements and/or code of conduct; enrolling students from appointed agents only and maintain records of students recruited by each appointed agent; vetting and approving any promotional material and advertisement produced by the agents on your behalf",
      "Evaluate the performance of all your agents based on relevant evaluation criteria before contract renewal",
      "Review the agent management and evaluation procedures for continual improvement",
    ],
    notes: ["Evaluation criteria can include students' feedback and achievement of service performance indicators as stated in the agent contract."],
    expectedEvidence: ["Agent training/update records", "Agent contract compliance monitoring", "Agent performance evaluation records", "Management/evaluation procedure review records"],
  },

  {
    id: "4.1.1",
    subCriterionId: "4.1",
    title: "Pre-Course Counselling, Student Selection and Admissions",
    describeShow: [
      "Ensure all course counsellors are adequately trained and monitored for service delivery",
      "Provide relevant course information during pre-course counselling to all prospective students",
      "Execute student selection and admission procedures, including for Selection: verification of applicants' suitability for the course and that they meet course admission requirements; verification of the originality of supporting documents submitted by applicants; approval of shortlisted applicants by the Management and the relevant external university partners, if applicable; and for Admissions: communication with international students on the status of their Student's Pass application; matriculation of students with external academic partners, if applicable; orientation for newly enrolled students to inform them of essential course and student support services information",
      "Monitor staff performing the student selection and admissions to ensure that the procedures are adhered to",
      "Review the pre-course counselling, student selection and admissions procedures for continual improvement",
    ],
    notes: [
      "For Student's Pass holders, additional information shall be provided for the following areas: a. Student's Pass application requirements and procedures; b. informing these students that they are not permitted to engage in any form of employment or attend an industrial attachment/internship programme, whether paid or unpaid, without a valid work pass issued by Ministry of Manpower; c. other relevant Singapore laws.",
    ],
    expectedEvidence: ["Counsellor training/monitoring records", "Pre-course counselling materials", "Student selection and admissions records", "Procedure review records"],
  },
  {
    id: "4.2.1",
    subCriterionId: "4.2",
    title: "Student Contract",
    describeShow: [
      "Execute a student contract during course admission. The student contract execution procedure shall provide for the following: ensuring each student contract is meant for the admission of each student into one course; explaining the terms and conditions of the contract to each student and ensuring that each student fully understands them; ensuring that both you and the student acknowledge any amendment made; stipulating a cooling off period of at least 7 working days; signing a new contract or issuing an addendum to the existing contract for a student who wishes to repeat a module and when a course deferment or transfer request has been approved; ensuring that a breakdown of all fees, inclusive of any non-refundable fees, discounts/rebates and grants/funding given, are declared in the contract and marketing collaterals",
      "Ensure a copy of your student contract is made available for prospective students",
      "Review the student contract execution procedure for continual improvement",
    ],
    notes: ["You shall adopt the SSG-issued Standard Student Contract for all your students."],
    expectedEvidence: ["Signed student contract samples", "Cooling-off period and amendment acknowledgement records", "Contract execution procedure review records"],
  },
  {
    id: "4.2.2",
    subCriterionId: "4.2",
    title: "Fee Collection and Fee Protection Scheme",
    describeShow: [
      "Ensure the collection of fees (excluding application fees) only after the student contract has been executed, and fees collected from students do not exceed the applicable fee collection cap",
      "Ensure the issuance of an original receipt and maintenance of accurate records for every payment made by students",
      "Ensure that the Fee Protection Scheme (FPS) Insurance implementation complies with the requirements stated in the FPS Instruction Manual",
      "Establish a revenue recognition policy where fees from all courses are recognised on an accrual basis over the period in which the courses are conducted",
      "Review the fee collection and FPS implementation procedures for continual improvement",
    ],
    notes: ["Refer to the Fee Protection Scheme Instruction Manual for the applicable fee collection cap."],
    expectedEvidence: ["FPS-insured receipts", "Fee schedule and fee collection cap compliance check", "Revenue recognition policy", "FPS implementation review records"],
  },
  {
    id: "4.3.1",
    subCriterionId: "4.3",
    title: "Course Transfer, Deferment and Withdrawal",
    describeShow: [
      "Transfer, deferment and withdrawal policies and procedures and how these are communicated to students. The policies and procedures shall include: maximum processing time of not more than 4 weeks from the point of student's request to informing student of the outcome in writing; conditions for which a transfer or deferment application, stating the maximum deferment period, will be granted; informing Immigration & Checkpoints Authority of Singapore (ICA) of any change to the status of the Student's Pass (STP), if applicable; obtaining the parent's/legal guardian's written consent if student is under 18 years of age",
      "Maintain up-to-date transfer, deferment and withdrawal records",
      "Review the transfer, deferment and withdrawal policies and procedures for continual improvement",
    ],
    notes: [
      "Transfer: Student changes the course or period of study, from full-time to part-time or vice versa, but remains as a student of the PEI.",
      "Deferment: Student delays or postpones the course or module.",
      "Withdrawal: Student discontinues all courses with the PEI.",
    ],
    expectedEvidence: ["Transfer/deferment/withdrawal policy", "ICA notification records", "Transfer/deferment/withdrawal logs", "Procedure review records"],
  },
  {
    id: "4.4.1",
    subCriterionId: "4.4",
    title: "Refund",
    describeShow: [
      "Establish a refund policy and procedure which are communicated to all students, including prospective ones. The refund policy shall cover: maximum processing time of not more than 7 working days from the withdrawal/refund request for the issuing of refund; terms and conditions; any non-refundable fee, if applicable",
      "Communicate to students on the computation of the refund amount",
      "Maintain up-to-date and accurate refund records",
      "Review the refund policy and procedure for continual improvement",
    ],
    expectedEvidence: ["Refund policy document", "Refund computation communication records", "Refund records", "Refund policy review records"],
  },
  {
    id: "4.5.1",
    subCriterionId: "4.5",
    title: "Student Support Services",
    describeShow: [
      "Provide a range of student support services to meet the needs of students and enhance their educational experience",
      "Institute programmes to develop students holistically and value-add to their learning experiences",
      "Implement programmes and strategies to develop and promote students' education and career guidance and/or employability skills",
      "Communicate up-to-date information regarding student support services and programmes to students",
      "Evaluate and review the student support services and programmes for continual improvement",
    ],
    notes: [
      "Examples of student support services: medical insurance, pastoral counselling, activities to promote mental well-being, close collaboration with parent/legal guardian for students under 18 years of age, financial assistance scheme, alumni support, accommodation advice and bonding activities.",
      "Examples of holistic programmes: co-curricular activities, community involvement, student wellness and leadership development programmes.",
    ],
    expectedEvidence: ["Student support services policy/programme list", "Career guidance/employability records", "Communication of support services to students", "Support services review records"],
  },
  {
    id: "4.6.1",
    subCriterionId: "4.6",
    title: "Student Conduct and Attendance",
    describeShow: [
      "Establish a set of disciplinary policy and procedure to handle students with disciplinary issues, which are communicated to all students",
      "Set policy and procedures on attendance, which are communicated to all students",
      "Establish and implement a student attendance taking and monitoring system for all applicable learning modes, classroom-based learning, synchronous and asynchronous e-learning",
      "Implement timely intervention measures to help students with poor conduct or attendance",
      "Evaluate the intervention measures for effectiveness and improvement",
      "Review the student disciplinary and attendance policies and procedures, and the student attendance taking and monitoring system for continual improvement",
    ],
    expectedEvidence: ["Disciplinary policy and procedure", "Attendance policy and procedure", "Attendance records (sync and async modes)", "Intervention log", "Policy/system review records"],
  },

  {
    id: "5.1.1",
    subCriterionId: "5.1.1",
    title: "Course Design and Development",
    describeShow: [
      "Establish processes for determining the following: relevance of courses and modules, including industrial attachments, if applicable; admission requirements; learning objectives, outcomes and delivery plans, including modes of learning; assessment plans and objectives which include assessment modes, frequency, weighting, grading and award criteria",
      "Involve your stakeholders in the course design and development process, and the Academic Board in approval of courses",
      "Review the course design and development process for continual improvement",
    ],
    notes: ["Modes of learning may include face-to-face, synchronous or asynchronous e-learning."],
    expectedEvidence: ["Course design and development documentation", "Academic Board approval records", "Course design process review records"],
  },
  {
    id: "5.1.2",
    subCriterionId: "5.1.2",
    title: "Course Review",
    describeShow: [
      "Establish processes to review the curriculum of each course, including industrial attachments, if applicable, including: gathering inputs from stakeholders; analysing module assessment results and student and academic staff feedback; using trend data and benchmarks on the performance of students and graduates; reviewing in a timely manner course/module relevance, content, duration and admission requirements, if relevant; reviewing course delivery and adequacy and effectiveness of academic resources for teaching and learning; refining student learning outcomes",
      "Involve the Academic Board in the course/module review and approval of review outcomes",
      "Provide relevant course feedback and propose changes to courses for consideration by your external academic partners, if any",
      "Review the course and module review processes for continual improvement",
    ],
    expectedEvidence: ["Course review minutes", "Trend/benchmark data used in review", "Academic Board approval of review outcomes", "Updated curriculum document"],
  },
  {
    id: "5.2.1",
    subCriterionId: "5.2.1",
    title: "Course Planning",
    describeShow: [
      "Course planning process for each course which shall include the following: logistics preparation including planning course schedule, physical venues or online platforms; academic preparation, course content, lesson plans and appropriate teacher-student ratio; providing qualified academic and support staff; dissemination of relevant information to students prior to course commencement",
      "Process to provide and maintain adequate physical and academic resources to support teaching and learning",
      "Transition planning to handle transitions as a result of revisions made to courses",
      "Review of the course planning process for continual improvement",
    ],
    notes: ["Transition plan applies to introduction of new curriculum or courses, revisions to the title of courses or awards, and major changes to course content or mode of delivery."],
    expectedEvidence: ["Course planning documentation per course", "Resource adequacy records", "Transition plan", "Course planning process review records"],
  },
  {
    id: "5.2.2",
    subCriterionId: "5.2.2",
    title: "Course Delivery",
    describeShow: [
      "Ensure that course delivery is based on the approved learning outcomes and delivery plans",
      "Monitor the course delivery to ensure quality of teaching",
      "Evaluate the performance of academic staff and take appropriate and timely intervention actions",
      "Conduct regular reviews of the course delivery and monitoring processes for continual improvement",
    ],
    expectedEvidence: ["Course delivery monitoring records", "Academic staff performance evaluation", "Intervention action records", "Course delivery review records"],
  },
  {
    id: "5.3.1",
    subCriterionId: "5.3",
    title: "Partnerships",
    describeShow: [
      "Select, manage, monitor and review the performance of all external academic partners",
      "Ensure that you have renewable agreement(s) with all your external academic partners. The agreement(s) shall include critical details such as agreement duration, terms and conditions and mutual expectations of the partnership(s)",
      "Monitor and review the partnership management process for continual improvement",
    ],
    notes: [
      "If the partnerships involve recruitment of students on your behalf for the partners' financial gains, monetary interests, such partners are defined as external recruitment agents and the requirements in Criterion 3 shall apply to ensure that students' interests are protected.",
    ],
    expectedEvidence: ["External academic partner agreements", "Partner performance monitoring records", "Partnership process review records"],
  },
  {
    id: "5.4.1",
    subCriterionId: "5.4",
    title: "Student Learning",
    describeShow: [
      "Implement a learning support process, including intervention measures if required, to ensure students achieve the desired learning outcomes",
      "Provide periodic progress reports on academic and non-academic achievements to students and/or parents/guardians",
      "Evaluate the intervention measures for effectiveness and improvement",
      "Review the process of monitoring student learning and development for continual improvement",
    ],
    expectedEvidence: ["Learning support process documentation", "Progress reports to students/parents", "Intervention evaluation records", "Process review records"],
  },
  {
    id: "5.5.1",
    subCriterionId: "5.5",
    title: "Student Assessment",
    describeShow: [
      "Your assessment policy and procedures which are based on sound assessment principles to ensure the integrity of every assessment. The assessment policy and procedures shall be appropriate for the chosen mode(s) of assessment and include where applicable: scheduling of assessments and how students are informed of the schedule(s) in a timely manner; setting and communicating of code of conduct for students and invigilators to ensure academic integrity, including reporting and managing academic dishonesty; setting and vetting of test instruments and the marking and moderation of the assessments, including appointment of suitable personnel; secure storage and reproduction of confidential test material; informing students of assessment results, award and appeal process; re-sitting and/or deferred sitting of assessments",
      "Your assessment plan for every course conducted by you and your external partner(s), where applicable, including how you conduct each mode of assessment, and the relative weightings and criteria for grading and awards",
      "How you ensure that all major assessment papers set by you are approved by your Examination Board",
      "How you ensure that awards are approved by the relevant awarding authority, including your Examination Board for those awards conferred by you",
      "How the post-assessment analysis is considered for course review",
      "Review the assessment policy, procedures and plan for continual improvement",
    ],
    notes: [
      "Principles of assessment include validity, reliability and fairness.",
      "Academic dishonesty includes plagiarism and academic fraud such as cheating, collusion, falsification of data, false citation and contract cheating.",
      "For courses conducted by your external partners, the procedures shall indicate the party responsible for the setting and vetting of the test instruments and the marking and moderation of the assessments.",
      "The appeal process must be fair, without compromising the integrity of the assessment process. You, or your external academic partner, must allow at least seven working days from the release of assessment results for students to submit an appeal for results/awards and to release appeal results within a reasonable time from the date of appeal.",
    ],
    expectedEvidence: ["Assessment policy and procedures", "Assessment vetting records and grading criteria", "Examination Board approval records", "Moderation minutes", "Appeal process records"],
  },

  {
    id: "6.1.1",
    subCriterionId: "6.1",
    title: "Internal Assessment",
    describeShow: [
      "Conduct internal assessment to ensure the quality and effectiveness of all your systems and processes. The procedures shall include: defining assessment scope and methodology to ensure alignment of your operations with documented policies and procedures to meet EduTrust requirements and verify effectiveness of your systems and processes; deploying qualified/trained staff who are independent of the areas being assessed to conduct the internal assessment; compiling all strengths and Areas for Improvement (AFIs) and developing Corrective Action Plans (CAPs) for all AFIs; defining the owners and completion timelines for all CAPs; approving all CAPs prior to implementation by the Management; monitoring the implementation of the CAPs",
      "Review the internal assessment process for continual improvement",
    ],
    notes: ["Comparative studies and/or benchmark of Criterion 7 Performance Outcomes shall be used to verify effectiveness of your systems and processes."],
    expectedEvidence: ["Internal assessment scope and methodology", "Internal assessment reports", "AFI/CAP register with owners and timelines", "Internal assessment process review records"],
  },
  {
    id: "6.2.1",
    subCriterionId: "6.2",
    title: "Management Review",
    describeShow: [
      "Conduct timely management review which shall cover: the strategic and department/unit plans including strategies and achievement of targets for key performance indicators; financial status and resource utilisation including manpower; market analysis; external partnerships, if applicable; internal assessment, external reviews and related CAPs; survey findings and feedback received; risk management",
      "Make use of the findings from the management review for continual improvement. Owners and execution timelines are to be identified for the follow-up actions which are approved by the Management",
      "Monitor the implementation of the follow-up actions arising from management review",
      "Review the management review process for continual improvement",
    ],
    expectedEvidence: ["Management review minutes", "Follow-up action register with owners and timelines", "Implementation monitoring records", "Management review process review records"],
  },
  {
    id: "6.3.1",
    subCriterionId: "6.3",
    title: "Innovation and Continual Improvement",
    describeShow: [
      "Encourage and facilitate key stakeholders to contribute towards innovation and continual improvement",
      "Implement an improvement plan which adds value to students' learning experience",
      "Invest in appropriate resources, technologies, learning support services and facilities development and/or upgrading",
      "Evaluate the effectiveness of the innovation and improvement implemented",
      "Review the process for innovation and continual improvement",
    ],
    expectedEvidence: ["Improvement plan", "Stakeholder contribution records", "Investment records (resources/technology/facilities)", "Innovation effectiveness evaluation"],
  },

  {
    id: "7.1.1",
    subCriterionId: "7.1",
    title: "Measurement of Outcomes",
    describeShow: [
      "Establish policies and processes to identify and track relevant performance outcomes of your institutional and academic offerings. The policies and procedures shall include: identifying and tracking relevant performance outcomes; identifying and selecting relevant internal and/or external benchmarks or comparative data; setting the target based on the selected benchmarks or comparative data; measuring and analysing performance against benchmark targets/comparative data and taking corrective actions to address the gaps where targets are not met; making use of the analysis from the trend data to review the institutional and academic quality for continual improvement",
      "Ensure that your performance data is made available to relevant stakeholders",
      "Review the performance measurement process for continual improvement",
    ],
    notes: ["An example of a framework for outcomes measurement is provided in the official GD4 document."],
    expectedEvidence: ["Outcomes measurement framework", "Benchmark/comparative data sources", "Performance vs target analysis", "Performance measurement process review records"],
  },
];

// ── FlatAuditPoint derivation ────────────────────────────────────────────────
//
// Splits a Describe/Show bullet into a parent phrase and lettered children
// when the text contains ": " followed by at least two semicolon-separated
// sub-clauses — the standard GD4 list pattern (e.g. "covering: A; B; C").
// Parentheses depth is tracked so semicolons inside parenthetical phrases
// (nested sub-clauses) are not treated as separators.

function splitBySemicolon(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      if (i + 1 < text.length && text[i + 1] === " ") i++;
      continue;
    }
    current += c;
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts.filter(Boolean);
}

type StructuredDS =
  | { parent: string; children: { letter: string; text: string }[] }
  | { parent: string; children?: undefined };

function tryStructureDS(ds: string): StructuredDS {
  const colonIdx = ds.indexOf(": ");
  if (colonIdx === -1) return { parent: ds };
  const parent = ds.slice(0, colonIdx + 1);
  const afterColon = ds.slice(colonIdx + 2).trim();
  const parts = splitBySemicolon(afterColon);
  if (parts.length < 2) return { parent: ds };
  return {
    parent,
    children: parts.map((part, j) => ({
      letter: String.fromCharCode(97 + j),
      text: part.charAt(0).toUpperCase() + part.slice(1),
    })),
  };
}

function deriveItemFlatAuditPoints(raw: RawItem): FlatAuditPoint[] {
  const points: FlatAuditPoint[] = [];

  raw.describeShow.forEach((ds, i) => {
    const structured = tryStructureDS(ds);
    if (structured.children) {
      structured.children.forEach(({ letter, text }) => {
        points.push({
          ref: `${raw.id}.DS${i + 1}.${letter}`,
          gd4ItemId: raw.id,
          sourceType: "describeShow",
          text,
          parentText: structured.parent,
          sourceText: text,
          originalIndex: null,
        });
      });
    } else {
      points.push({
        ref: `${raw.id}.DS${i + 1}`,
        gd4ItemId: raw.id,
        sourceType: "describeShow",
        text: ds,
        sourceText: ds,
        originalIndex: i,
      });
    }
  });

  raw.expectedEvidence.forEach((ev, i) => {
    points.push({
      ref: `${raw.id}.EE${i + 1}`,
      gd4ItemId: raw.id,
      sourceType: "expectedEvidence",
      text: ev,
      sourceText: ev,
      originalIndex: i,
    });
  });

  (raw.notes ?? []).forEach((note, i) => {
    points.push({
      ref: `${raw.id}.N${i + 1}`,
      gd4ItemId: raw.id,
      sourceType: "note",
      text: note,
      sourceText: note,
      originalIndex: i,
    });
  });

  return points;
}

// Band descriptors: the app-invented per-item paraphrase set that lived here
// (bandDescriptorsFor) was removed — the OFFICIAL EduTrust §23 band table in
// data/edutrustRubric.ts is the single source of descriptor text now.

export const GD4_REQUIREMENTS: GD4Requirement[] = RAW_ITEMS.map((raw) => {
  const sub = GD4_SUB_CRITERIA.find((s) => s.id === raw.subCriterionId)!;
  const criterion = GD4_CRITERIA.find((c) => c.id === sub.criterionId)!;
  const itemCount = RAW_ITEMS.length;
  const gateSensitive = raw.subCriterionId === "4.2" || raw.subCriterionId === "4.6" || sub.criterionId === "5";
  return {
    id: raw.id,
    criterion: sub.criterionId,
    area: criterion.title,
    subCriterionId: raw.subCriterionId,
    itemNumber: raw.id,
    requirement: raw.title,
    intent: sub.description,
    describeShow: raw.describeShow,
    notes: raw.notes || [],
    maxPoints: criterion.points,
    weightage: Math.round((1 / itemCount) * 10000) / 10000,
    gateSensitive,
    expectedEvidence: raw.expectedEvidence,
    scoringNotes: gateSensitive ? "Gate-sensitive: official GD4 section 20 requires an average minimum of Band 3 in this sub-criterion/criterion." : undefined,
    flatAuditPoints: deriveItemFlatAuditPoints(raw),
  };
});

// Ref to plain-English label. A bare ref code ("6.2.1.DS1.b") means nothing to
// a non-technical auditor; every display site pairs the code with the official
// requirement text through this ONE map so labels never drift per file. All
// text below is the verbatim GD4 source already derived above (sub-criterion
// titles, item titles, flatAuditPoints text) - nothing is invented here.
// Keyed by exact ref, with a normalised-ref fallback because AI-echoed refs
// (checklist sourceRef/clause) can drift in case or carry a label prefix.
const REF_LABELS = new Map<string, string>();
const REF_LABELS_NORM = new Map<string, string>();
function registerRefLabel(ref: string, label: string): void {
  REF_LABELS.set(ref, label);
  const norm = normalizeAuditRef(ref);
  if (!REF_LABELS_NORM.has(norm)) REF_LABELS_NORM.set(norm, label);
}
for (const sc of GD4_SUB_CRITERIA) registerRefLabel(sc.id, sc.title);
for (const req of GD4_REQUIREMENTS) {
  registerRefLabel(req.id, req.requirement);
  for (const p of req.flatAuditPoints ?? []) registerRefLabel(p.ref, p.text);
}

export function refLabel(ref: string): string | undefined {
  const trimmed = ref.trim();
  return REF_LABELS.get(trimmed) ?? REF_LABELS_NORM.get(normalizeAuditRef(trimmed));
}

// "code - label", falling back to the bare code when no label is found so a
// display never shows "undefined" for an unrecognised ref.
export function refWithLabel(ref: string, sep = " - "): string {
  const label = refLabel(ref);
  return label ? `${ref}${sep}${label}` : ref;
}
