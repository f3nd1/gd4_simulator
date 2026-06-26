import type { GD4Requirement, GD4SubCriterion } from "../types";

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
  { id: "1.1", criterionId: "1", title: "Leadership & Corporate Governance", description: "This sub-criterion examines how the leadership demonstrates commitment to develop the PEI and achieve excellence, and how you manage your corporate governance and financial resources to ensure operational sustainability and good financial health." },
  { id: "1.2", criterionId: "1", title: "Strategic Planning", description: "This sub-criterion examines how you conduct your strategic planning to provide educational services that are aligned with your vision and mission. It also examines the alignment of your strategic plan with your plans on risk management, business continuity, resources and finance budgeting." },

  { id: "2.1", criterionId: "2", title: "Human Resource", description: "This sub-criterion examines your human resource management system in the areas of staff selection, recruitment, management, training and development." },
  { id: "2.2", criterionId: "2", title: "Communication", description: "This sub-criterion examines how you communicate with internal and external stakeholders to ensure that relevant information is provided in an accurate and timely manner. It further examines your marketing and external communications such as advertisements of any permitted course accessible by or published to the public, and advertisements published by third parties on your behalf." },
  { id: "2.3", criterionId: "2", title: "Data, Information and Knowledge Management", description: "This sub-criterion examines how you establish systems to harness data and information effectively for organisational learning, planning and to support decision-making." },
  { id: "2.4", criterionId: "2", title: "Feedback Management", description: "This sub-criterion examines your system in collecting, responding to and analysing feedback in a timely manner." },

  { id: "3.1", criterionId: "3", title: "Selection and Appointment of External Recruitment Agents", description: "This sub-criterion examines how you select and appoint external recruitment agents to ensure that only reliable and credible agents are engaged to recruit students for the PEI." },
  { id: "3.2", criterionId: "3", title: "Management and Evaluation of External Recruitment Agents", description: "This sub-criterion examines how you manage and evaluate external recruitment agents to ensure that they deliver quality services to prospective students." },

  { id: "4.1", criterionId: "4", title: "Pre-Course Counselling, Student Selection and Admissions", description: "This sub-criterion examines how you conduct pre-course counselling for your prospective students. It also examines how you select and admit students to your courses." },
  { id: "4.2", criterionId: "4", title: "Student Contract, Fee Collection and Fee Protection Scheme", description: "This sub-criterion examines how you execute the student contract, how you inform students of fees payable/paid and implement fee protection for all fees paid by students, ensure accurate collection of fees and records of every payment made; and establish a revenue recognition policy to recognise fees on an accrual basis." },
  { id: "4.3", criterionId: "4", title: "Course Transfer, Deferment and Withdrawal", description: "This sub-criterion examines your policies and procedures for course transfer, deferment and withdrawal." },
  { id: "4.4", criterionId: "4", title: "Refund", description: "This sub-criterion examines how you manage refunds for students under various conditions." },
  { id: "4.5", criterionId: "4", title: "Student Support Services", description: "This sub-criterion examines how you plan and provide student support services to enhance student well-being in support of a holistic education." },
  { id: "4.6", criterionId: "4", title: "Student Conduct and Attendance", description: "This sub-criterion examines your policies and procedures on student conduct and attendance, and how you take appropriate and timely intervention actions for students with poor conduct or attendance." },

  { id: "5.1", criterionId: "5", title: "Course Design, Development and Review", description: "This sub-criterion examines how you design, develop and review the courses offered. It also examines how you engage the Academic Board (or any external academic partners) in these processes." },
  { id: "5.2", criterionId: "5", title: "Course Planning and Delivery", description: "This sub-criterion examines how you plan the course delivery to ensure that the course outcomes are achieved; and how you plan, manage and monitor the use of academic resources." },
  { id: "5.3", criterionId: "5", title: "Partnerships", description: "This sub-criterion examines how you manage your external academic partners to ensure that the partnerships add value to your organisation and your students." },
  { id: "5.4", criterionId: "5", title: "Student Learning", description: "This sub-criterion examines how you monitor student learning and take appropriate and timely intervention actions for students who have not met the required standards of achievement." },
  { id: "5.5", criterionId: "5", title: "Student Assessment", description: "This sub-criterion examines how you assess the learning outcomes of the students through various modes of assessments (including online assessment, if applicable). It also examines how you engage the Examination Board to develop and implement assessment policies and procedures, including the management of assessment results and appeals." },

  { id: "6.1", criterionId: "6", title: "Internal Assessment", description: "This sub-criterion examines how you conduct internal assessment to ensure alignment of your operations with documented policies and procedures to meet EduTrust requirements and verify effectiveness of your systems and processes." },
  { id: "6.2", criterionId: "6", title: "Management Review", description: "This sub-criterion examines how the Management reviews overall organisational performance to ensure that the PEI is on track to achieve its vision and mission." },
  { id: "6.3", criterionId: "6", title: "Innovation and Continual Improvement", description: "This sub-criterion examines how you commit yourself to involve stakeholders in efforts towards organisation excellence and innovation. It also examines your commitment towards making appropriate investments to enhance your institutional quality." },

  { id: "7.1", criterionId: "7", title: "Measurement of Outcomes", description: "This sub-criterion examines how you identify, track and improve the outcomes of your systems to improve institution and academic quality." },
  { id: "7.2", criterionId: "7", title: "Achievement of Outcomes", description: "This sub-criterion examines the achievement of outcomes in four aspects: Student and Graduate Outcomes, Service Quality Outcomes, Operational Outcomes and People Development Outcomes." },
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
      "Engage your key stakeholders to support the vision, mission and values",
      "Maintain a governance system with robust management and financial controls, that ensures transparency and accountability, and fulfils your responsibility to the community",
      "Monitor your financial statements regularly, including ensuring that staff handling finances maintain accurate and proper record-keeping of financial data and fee payments",
      "Review your leadership and corporate governance system for continual improvement",
    ],
    notes: [
      "Key stakeholders refer to individuals the PEI provides a service to (e.g. students), and individuals or entities supporting the vision and mission (e.g. staff, academic and examination boards, educational partners, key partners, the community etc).",
      "The governance system encompasses, but is not limited to, management, financial and organisational controls, risk management, compliance with statutory and regulatory requirements, succession planning for top management, policies on ethical behaviour and programmes to support community involvement.",
      "For good financial practice, the annual financial statements should be certified by an independent external auditor based on guidelines stipulated by ACRA Companies Act.",
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
    notes: ["Key performance indicators shall include and not be limited to student experience and student learning outcomes."],
    expectedEvidence: ["Strategic plan document", "Risk management / business continuity / budget / resource plans", "Department work plans", "Strategic plan review records"],
  },

  {
    id: "2.1.1",
    subCriterionId: "2.1",
    title: "Staff Selection and Management",
    describeShow: [
      "Your human resource management system for all staff (full-time, part-time, academic and non-academic) which is aligned to strategic goals and organisational values, including: selection and recruitment; manpower planning and deployment; staff code of conduct; appraisal and performance monitoring; rewards and recognition; talent management and retention",
      "Your review of the human resource system and practices for continual improvement",
    ],
    notes: [
      "Staff includes minimally full-time staff, part-time staff, academic and non-academic staff.",
      "Process for staff selection and recruitment shall include setting selection criteria and minimum qualifications before recruitment (for academic positions, set by Academic Board and external academic partners if applicable), and approving all shortlisted staff before recruitment (for academic positions, approval by Academic Board and external academic partners if applicable).",
      "Appraisal and performance monitoring includes setting and monitoring achievement of targets in individual staff work plans.",
      "Establish a system for succession planning and management.",
    ],
    expectedEvidence: ["HR management system / policy", "Selection and recruitment records", "Staff appraisal records", "HR system review records"],
  },
  {
    id: "2.1.2",
    subCriterionId: "2.1",
    title: "Staff Training and Development",
    describeShow: [
      "Determine the training and development needs to build up competencies of all staff",
      "Monitor and analyse the adequacy and effectiveness of the training and development provided to staff (e.g. transfer of learning to performance at work)",
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
      "Ensure the accuracy of information provided to stakeholders through your marketing practices, with procedures including vetting and approval by Management prior to publication of advertisements and adherence to SSG Advertising Guidelines for the Private Education Sector",
      "Review your marketing and external communication procedures for continual improvement",
    ],
    notes: [
      "Advertisements may be broadly described as any form of commercial communication that PEIs use to promote itself, its courses, and its services to students or prospective students, in all forms of medium and media, issued by the PEI or external student recruitment agents (notices, circulars, pamphlets, brochures, prospectus, TV/radio advertisements, internet or social media advertisements, placards, newspaper/magazine/journal advertisements, and verbal announcements).",
    ],
    expectedEvidence: ["Advertisement vetting and approval records", "SSG Advertising Guidelines compliance check", "Marketing procedure review records"],
  },
  {
    id: "2.3.1",
    subCriterionId: "2.3",
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
      "You shall comply with the Personal Data Protection Act.",
      "Comparative data can be obtained through benchmarking with processes and outcomes that represent the best practices for similar activities, within or outside the private education sector. Comparative data could be used in reviewing and improving key business processes.",
    ],
    expectedEvidence: ["Data management system documentation", "Data security / confidentiality policy", "Comparative data analysis records", "System review records"],
  },
  {
    id: "2.3.2",
    subCriterionId: "2.3",
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
    subCriterionId: "2.4",
    title: "Feedback Management",
    describeShow: [
      "Ensure an effective feedback management system",
      "Ensure that the dispute resolution policy and procedures are aligned with the Private Education Regulations and communicated to students",
      "Effectively use feedback to identify what drives positive experiences",
      "Review the feedback management system for continual improvement",
    ],
    notes: [
      "An effective feedback (including complaints and compliments) management system ensures that all feedback received are acknowledged and evaluated for follow-up action. Any action taken is recorded and made known to the person giving the feedback. All complaints shall be resolved within a reasonable time frame.",
    ],
    expectedEvidence: ["Feedback management policy/procedure", "Dispute resolution policy", "Feedback log and follow-up action records", "Feedback system review records"],
  },
  {
    id: "2.4.2",
    subCriterionId: "2.4",
    title: "Student Satisfaction Survey",
    describeShow: [
      "Conduct student satisfaction survey(s) for services rendered, covering: overall student satisfaction level; quality of student support services; physical facilities and infrastructure to support learning; effectiveness of communication; pre-course counselling experience of students; adequacy, accessibility and quality of teaching-learning resources and the school environment; academic staff performance (quality of teaching); assessment methods and frequency",
      "Use student survey findings in the review of academic and administrative processes",
      "Review the procedure of conducting the student satisfaction survey for continual improvement",
    ],
    notes: ["You may consider conducting surveys after every module and after course completion or on an annual basis."],
    expectedEvidence: ["Student satisfaction survey instrument and results", "Review of academic/administrative processes using survey findings", "Survey procedure review records"],
  },
  {
    id: "2.4.3",
    subCriterionId: "2.4",
    title: "Staff Satisfaction Survey",
    describeShow: [
      "Conduct staff satisfaction survey for all staff, covering: overall staff satisfaction level; human resource policy and practices; physical facilities and infrastructure; training and development opportunities provided; effectiveness of communication; teaching-learning resources and support (for academic staff); assessment methods and frequency (for academic staff)",
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
      "Identify, select and appoint your recruitment agents, including setting selection criteria and approving shortlisted agents by Management",
      "Ensure a renewable contract established with each appointed agent, covering: contract period; roles and responsibilities (including pre-course counselling); terms of engagement and code of conduct; fee or commission payable by the student, if applicable; non-collection of monies from students under any circumstance; service performance indicators; actions if agents breach contract terms and conditions of termination; provisions under which the laws of Singapore apply",
      "Maintain an up-to-date agent list published on the website, including: countries in which agents recruit/market; start and end date of current contract; agents no longer representing the PEI with effective date of non-representation",
      "Review the agent selection and appointment procedures for continual improvement",
    ],
    notes: ["Selection criteria for agents may include track record, references, and authorisation by respective government for recruitment activities, if applicable."],
    expectedEvidence: ["Agent selection criteria and approval records", "Signed agent contracts", "Published up-to-date agent list", "Selection/appointment procedure review records"],
  },
  {
    id: "3.2.1",
    subCriterionId: "3.2",
    title: "Management and Evaluation of External Recruitment Agents",
    describeShow: [
      "Manage your agents: ensuring agents have good understanding of critical information for pre-course counselling (via continual training and timely updates); ensuring agents adhere to the contract and code of conduct; taking timely action on violations; enrolling students from appointed agents only and maintaining records of students recruited by each agent; vetting and approving promotional material and advertisements produced by agents on your behalf",
      "Evaluate the performance of all your agents based on relevant evaluation criteria before contract renewal",
      "Review the agent management and evaluation procedures for continual improvement",
    ],
    notes: ["Evaluation should be based on relevant performance indicators as stated in the agent contract."],
    expectedEvidence: ["Agent training/update records", "Agent contract compliance monitoring", "Agent performance evaluation records", "Management/evaluation procedure review records"],
  },

  {
    id: "4.1.1",
    subCriterionId: "4.1",
    title: "Pre-Course Counselling, Student Selection and Admissions",
    describeShow: [
      "Ensure all course counsellors are adequately trained and monitored for service delivery",
      "Provide relevant course information during pre-course counselling to all prospective students",
      "Execute student selection and admission procedures, including: selection (verification of eligibility against admission requirements; verification of originality of supporting documents; approval of shortlisted applicants by Management and relevant external university partners if applicable); admissions (processing of application; matriculation with external academic partners if applicable; orientation for newly enrolled students)",
      "Monitor staff performing the student selection and admissions to ensure that the procedures are adhered to",
      "Review the pre-course counselling, student selection and admissions procedures for continual improvement",
    ],
    notes: [
      "Course information for international students should cover Student Pass requirements, informing students they are not permitted to engage in employment or industrial attachment/internship without a valid work pass issued by the Ministry of Manpower, and other relevant Singapore laws.",
    ],
    expectedEvidence: ["Counsellor training/monitoring records", "Pre-course counselling materials", "Student selection and admissions records", "Procedure review records"],
  },
  {
    id: "4.2.1",
    subCriterionId: "4.2",
    title: "Student Contract",
    describeShow: [
      "Execute a student contract during course admission, with the execution procedure providing for: each student contract meant for admission into one course; explaining terms and conditions to each student and ensuring understanding; acknowledgement of any amendment by both parties; a cooling off period of at least 7 working days; signing a new contract or issuing an addendum for module repeats, deferment or transfer; declaring a full breakdown of fees (including non-refundable fees, discounts/rebates and grants/funding) in the contract and marketing collaterals",
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
      "Your transfer, deferment and withdrawal policies and procedures and how these are communicated to students, including: the process from receiving a request to informing the student of the outcome in writing; conditions and maximum deferment period for which an application will be granted; informing ICA of any change to student pass status; handling of any fee implications arising from the request",
      "Maintain up-to-date transfer, deferment and withdrawal records",
      "Review the transfer, deferment and withdrawal policies and procedures for continual improvement",
    ],
    notes: [
      "Transfer: student changes the course or period of study (full-time to part-time or vice versa) but remains a student of the PEI.",
      "Deferment: student delays or postpones the course (or module).",
      "Withdrawal: student discontinues all courses with the PEI.",
    ],
    expectedEvidence: ["Transfer/deferment/withdrawal policy", "ICA notification records", "Transfer/deferment/withdrawal logs", "Procedure review records"],
  },
  {
    id: "4.4.1",
    subCriterionId: "4.4",
    title: "Refund",
    describeShow: [
      "Establish a refund policy and procedure communicated to all students (including prospective ones), covering: maximum processing time of not more than 7 working days from the withdrawal/refund request; terms and conditions; any non-refundable fee, if applicable",
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
      "Provide career guidance and/or employability skills support",
      "Communicate up-to-date information regarding student support services and programmes to students",
      "Evaluate and review the student support services and programmes for continual improvement",
    ],
    notes: [
      "Examples of student support services: medical insurance, pastoral counselling, activities to promote mental well-being, close collaboration with parent/legal guardian for students under 18, financial assistance scheme, alumni support, accommodation advice and bonding activities.",
      "Examples of holistic programmes: co-curricular activities, community involvement, student wellness and leadership development programmes.",
    ],
    expectedEvidence: ["Student support services policy/programme list", "Career guidance/employability records", "Communication of support services to students", "Support services review records"],
  },
  {
    id: "4.6.1",
    subCriterionId: "4.6",
    title: "Student Conduct and Attendance",
    describeShow: [
      "Establish a set of disciplinary policy and procedure to handle students with disciplinary issues, communicated to all students",
      "Set policy and procedures on attendance, communicated to all students",
      "Establish and implement a student attendance taking and monitoring system for all applicable learning modes (classroom-based, synchronous and asynchronous e-learning)",
      "Implement timely intervention measures to help students with poor conduct or attendance",
      "Evaluate the intervention measures for effectiveness and improvement",
      "Review the student disciplinary and attendance policies and procedures, and the attendance taking and monitoring system, for continual improvement",
    ],
    expectedEvidence: ["Disciplinary policy and procedure", "Attendance policy and procedure", "Attendance records (sync and async modes)", "Intervention log", "Policy/system review records"],
  },

  {
    id: "5.1.1",
    subCriterionId: "5.1",
    title: "Course Design and Development",
    describeShow: [
      "Establish processes for determining: relevance of courses and modules, including industrial attachments if applicable; admission requirements; learning objectives, outcomes and delivery plans, including modes of learning; assessment plans and objectives (modes, frequency, weighting, grading and award criteria)",
      "Involve your stakeholders in the course design and development process, and the Academic Board in approval of courses",
      "Review the course design and development process for continual improvement",
    ],
    notes: ["Modes of learning may include face-to-face, synchronous or asynchronous e-learning."],
    expectedEvidence: ["Course design and development documentation", "Academic Board approval records", "Course design process review records"],
  },
  {
    id: "5.1.2",
    subCriterionId: "5.1",
    title: "Course Review",
    describeShow: [
      "Establish processes to review the curriculum of each course (including industrial attachments if applicable), including: gathering inputs from stakeholders; analysing module assessment results and student/academic staff feedback; using trend data and benchmarks on student and graduate performance; reviewing in a timely manner course/module relevance, content, duration and admission requirements; reviewing course delivery and adequacy/effectiveness of academic resources; refining student learning outcomes",
      "Involve the Academic Board in the course/module review and approval of review outcomes",
      "Provide relevant course feedback and propose changes to courses for consideration by external academic partners, if any",
      "Review the course and module review processes for continual improvement",
    ],
    expectedEvidence: ["Course review minutes", "Trend/benchmark data used in review", "Academic Board approval of review outcomes", "Updated curriculum document"],
  },
  {
    id: "5.2.1",
    subCriterionId: "5.2",
    title: "Course Planning",
    describeShow: [
      "Your course planning process for each course, including: logistics preparation (schedule, physical venues or online platforms); academic preparation (course content, lesson plans, appropriate teacher-student ratio); providing qualified academic and support staff; dissemination of relevant information to students prior to course commencement",
      "Process to provide and maintain adequate physical and academic resources to support teaching and learning",
      "Transition planning to handle transitions arising from revisions made to courses",
      "Review of the course planning process for continual improvement",
    ],
    notes: ["Transition plans apply to introduction of new curriculum or courses, revisions to course/award titles, and major changes to course content or mode of delivery."],
    expectedEvidence: ["Course planning documentation per course", "Resource adequacy records", "Transition plan", "Course planning process review records"],
  },
  {
    id: "5.2.2",
    subCriterionId: "5.2",
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
      "Ensure that you have renewable agreement(s) with all your external academic partners, including critical details such as agreement duration, terms and conditions and mutual expectations of the partnership(s)",
      "Monitor and review the partnership management process for continual improvement",
    ],
    notes: [
      "If a partner is engaged for monetary gains (monetary interests) in recruiting students, that partner is defined as an external recruitment agent under Criterion 3, and student interests must be protected accordingly.",
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
      "Your assessment policy and procedures based on sound assessment principles (validity, reliability, fairness) to ensure the integrity of every assessment, appropriate for the chosen mode(s), including: scheduling and timely communication of schedules; code of conduct for students and invigilators including reporting/managing academic dishonesty; setting and vetting of test instruments and marking/moderation, including appointment of suitable personnel; secure storage and reproduction of confidential test material; informing students of results, award and appeal process; re-sitting and/or deferred sitting of assessments",
      "Your assessment plan for every course conducted by you and your external partner(s), where applicable, including how each mode of assessment is conducted and the relative weightings and criteria for grading and awards",
      "How you ensure that all major assessment papers set by you are approved by your Examination Board",
      "How you ensure that awards are approved by the relevant awarding authority, including your Examination Board for awards conferred by you",
      "How the post-assessment analysis is considered for course review",
      "Review the assessment policy, procedures and plan for continual improvement",
    ],
    notes: [
      "Principles of assessment include validity, reliability and fairness.",
      "Academic dishonesty includes plagiarism and academic fraud such as cheating, collusion, falsification of data, false citation and contract cheating.",
      "For courses conducted by external partners, the procedures shall indicate the party responsible for setting, vetting, marking and moderation.",
      "The appeal process must be fair, without compromising assessment integrity. You, or your external academic partner, must allow at least seven working days from release of results for students to submit an appeal, and release appeal results within a reasonable time.",
    ],
    expectedEvidence: ["Assessment policy and procedures", "Assessment vetting records and grading criteria", "Examination Board approval records", "Moderation minutes", "Appeal process records"],
  },

  {
    id: "6.1.1",
    subCriterionId: "6.1",
    title: "Internal Assessment",
    describeShow: [
      "Conduct internal assessment to ensure the quality and effectiveness of all your systems and processes, with procedures including: defining assessment scope and methodology; deploying qualified/trained staff independent of the areas being assessed; compiling all strengths and AFIs and developing Corrective Action Plans (CAPs) for all AFIs; defining owners and completion timelines for all CAPs; Management approving all CAPs prior to implementation; monitoring the implementation of the CAPs",
      "Review the internal assessment process for continual improvement",
    ],
    notes: ["Comparative studies and/or benchmarking of Criterion 7 Performance Outcomes shall be used to verify effectiveness of your systems and processes."],
    expectedEvidence: ["Internal assessment scope and methodology", "Internal assessment reports", "AFI/CAP register with owners and timelines", "Internal assessment process review records"],
  },
  {
    id: "6.2.1",
    subCriterionId: "6.2",
    title: "Management Review",
    describeShow: [
      "Conduct timely management review covering: strategic and department/unit plans including strategies and achievement of KPI targets; financial status and resource utilisation including manpower; market analysis; external partnerships, if applicable; internal assessment, external reviews and related CAPs; survey findings and feedback received; risk management",
      "Make use of the findings from the management review for continual improvement, with owners and execution timelines identified for follow-up actions approved by Management",
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
      "Implement an improvement plan which adds value to the institution and enhances student experience",
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
      "Establish policies and processes to identify and track relevant performance outcomes of your institutional and academic offerings, including: identifying and tracking relevant performance outcomes; identifying and selecting relevant internal and/or external benchmarks or comparative data; setting targets based on the selected benchmarks or comparative data; measuring and analysing performance against benchmark targets/comparative data and taking corrective actions where targets are not met; using trend data analysis to review institutional and academic quality for continual improvement",
      "Ensure that your performance data is made available to relevant stakeholders",
      "Review the performance measurement process for continual improvement",
    ],
    expectedEvidence: ["Outcomes measurement framework", "Benchmark/comparative data sources", "Performance vs target analysis", "Performance measurement process review records"],
  },
  {
    id: "7.2.1",
    subCriterionId: "7.2",
    title: "Student and Graduate Outcomes",
    describeShow: [
      "Your performance in producing quality outcomes from the courses you offered, measured using relevant indicators and benchmarks",
      "For all courses, measure performance of your students and graduates against appropriate benchmarks from comparable local or international institutions and/or standards",
      "Provide reasons and improvement actions taken or planned where targets/benchmarks are not met",
    ],
    notes: [
      "For students: track and measure attrition rate, passing rate, and quality of passes (e.g. distinctions, honours) or equivalent.",
      "For graduates of External Degree Programmes, measurement of graduate employment outcomes shall include results of the Private Education Institution Graduate Employment Survey (GES). For other courses, track and measure graduation rate and graduate achievements (e.g. employment rate, results in major examinations such as IB or IGCE, placement in tertiary institutions, TRAQOM for SSG Registered Training Providers) or equivalent.",
    ],
    expectedEvidence: ["Student attrition/passing/quality-of-passes data", "Graduate outcomes data (GES where applicable)", "Three-year trend and benchmark comparison", "Improvement actions for unmet targets"],
  },
  {
    id: "7.2.2",
    subCriterionId: "7.2",
    title: "Service Quality Outcomes",
    describeShow: [
      "Your performance in achieving targets for key performance indicators (KPIs) identified for Service Quality",
      "Track three-year trends and measure the performance against comparative targets or appropriate benchmarks",
      "Provide reasons and improvement actions taken or planned where targets/benchmarks are not met",
    ],
    notes: ["Track and measure: student satisfaction rate on quality of teaching; service level agreement on resolving complaints; overall student satisfaction rate."],
    expectedEvidence: ["Service quality KPI data", "Three-year trend data", "Improvement actions for unmet targets"],
  },
  {
    id: "7.2.3",
    subCriterionId: "7.2",
    title: "Operational Outcomes",
    describeShow: [
      "Your performance in producing intended outcomes from your day-to-day operations to ensure effectiveness and efficiency",
      "Track three-year trends and measure the performance against comparative targets or appropriate benchmarks",
      "Provide reasons and improvement actions taken or planned where targets/benchmarks are not met",
    ],
    notes: ["Track and measure: liquidity ratio (current assets/current liabilities); debt-equity ratio; cost/time saving or investment in appropriate resources, technologies, learning support services and facilities development and upgrading, or equivalent."],
    expectedEvidence: ["Operational KPI / financial ratio data", "Three-year trend data", "Improvement actions for unmet targets"],
  },
  {
    id: "7.2.4",
    subCriterionId: "7.2",
    title: "People Development Outcomes",
    describeShow: [
      "Your performance in producing intended outcomes from your human resource systems and processes, in the areas of staff satisfaction, training and development",
      "Track three-year trends and measure the performance against comparative targets or appropriate benchmarks",
      "Provide reasons and improvement actions taken or planned where targets/benchmarks are not met",
    ],
    notes: ["Track and measure: overall staff satisfaction rate; average training hours per staff including part-time academic staff, or equivalent."],
    expectedEvidence: ["Staff satisfaction / training hours data", "Three-year trend data", "Improvement actions for unmet targets"],
  },
];

// Official EduTrust scoring rubric (GD4 section 23) — identical four-dimension,
// five-band table applies across all items; reproduced verbatim.
export const RUBRIC_BAND_DESCRIPTORS: Record<string, Record<string, string>> = {
  Approach: {
    "Band 1": "No organised approach to item requirements is evident",
    "Band 2": "The beginning of an organised approach is evident",
    "Band 3": "An effective and organised approach meeting the minimum requirement is evident",
    "Band 4": "An effective, efficient and organised approach meeting overall requirements is evident",
    "Band 5": "An effective, efficient and well-integrated approach meeting all requirements is evident",
  },
  Processes: {
    "Band 1": "Processes are not in place or in their infancy stage",
    "Band 2": "Processes are established but with weak deployment in key areas",
    "Band 3": "Processes are deployed and well-managed by owners in key areas",
    "Band 4": "Intended processes are well-managed by owners; desired outputs are produced by these processes",
    "Band 5": "All processes are well-managed by owners leading to quality outputs by all processes",
  },
  "Systems & Outcomes": {
    "Band 1": "Systems and outcomes are non-existent",
    "Band 2": "Systems do not interact with one another; there are limited outcomes",
    "Band 3": "Key systems are established, producing limited outcomes",
    "Band 4": "Key systems are interacting with one another, producing desired outcomes with no conflicts",
    "Band 5": "All systems are interacting with one another, producing good quality outcomes",
  },
  Review: {
    "Band 1": "No planned review; no improvement is made",
    "Band 2": "Early stages of review; improvements to systems and processes are limited",
    "Band 3": "There is evidence that the systems and processes are regularly reviewed and action plans for improvement are implemented",
    "Band 4": "Implemented action plans for improvement are monitored for effectiveness and to bring about positive impact resulting in favourable outcomes",
    "Band 5": "Many to most trends and current performance levels are evaluated against relevant comparisons and/or benchmarks",
  },
};

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
    bandDescriptors: {
      "Band 1": "Not evident — see the four-dimension rubric (Approach/Processes/Systems & Outcomes/Review) on the GD4 Library item screen.",
      "Band 2": "Beginning — see the four-dimension rubric on the GD4 Library item screen.",
      "Band 3": "Meeting Expectation — see the four-dimension rubric on the GD4 Library item screen.",
      "Band 4": "Exceeding — see the four-dimension rubric on the GD4 Library item screen.",
      "Band 5": "Excellent — see the four-dimension rubric on the GD4 Library item screen.",
    },
    scoringNotes: gateSensitive ? "Gate-sensitive: official GD4 section 20 requires an average minimum of Band 3 in this sub-criterion/criterion." : undefined,
  };
});
