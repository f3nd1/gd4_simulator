# Source Citation Verification Skill

## Core principle

Every positive APSR claim must be backed by specific, cited source chunk IDs. Uncited positive claims are not acceptable and must be downgraded or flagged.

## Per-dimension citation requirements

**Approach** — must cite policy/procedure chunks:
- The cited chunk must be from the Policy & Procedure bucket.
- The chunk must contain documented policy text, procedures, SOPs, frameworks, or guidelines.
- A policy chunk proves the approach EXISTS — it does not prove it is implemented.

**Processes** — must cite implementation record chunks:
- The cited chunk must be from the Actual Evidence bucket.
- The chunk must contain dated records of activities carried out: logs, registers, attendance sheets, screenshots, forms with filled-in data, minutes with actions recorded.
- A policy document in the Actual Evidence bucket does NOT prove processes.

**Systems & Outcomes** — must cite data/trend/result chunks:
- The cited chunk must contain measured results, outcome data, trend analysis, survey results, KPI dashboards, or comparison against targets.
- Implementation records (logs, attendance) prove processes only — they do NOT prove outcomes unless they include aggregated results or comparison against a target.

**Review** — must cite review/decision/improvement chunks:
- The cited chunk must contain evidence of a review process: minutes of a quality review meeting, a management review decision, an improvement action log with closures, or a cycle-complete record showing what was changed as a result of review.
- A meeting minute that says only "meeting held" or "items discussed" without recording decisions or follow-up actions is insufficient for Review evidence.

## Downgrade rules

- If a dimension has a positive status (Meeting / Deployed / Evident) but sourceChunkIds is empty or absent → downgrade that dimension's status to the lowest category (Not evident) and add a note: "Downgraded: no source chunks cited to support this claim."
- If a policy chunk is cited for the Processes dimension → flag as insufficient: "A policy document was cited as implementation evidence; this does not prove deployment."
- If an implementation record chunk is cited for the Approach dimension → note that the chunk shows implementation but the documented approach (policy) still needs to be cited separately.

## Verifier strictness

A second-pass citation verifier must be STRICTER than the first-pass auditor:
- Re-examine every chunk cited. Does the chunk text actually support the claim made?
- A chunk that mentions the topic obliquely (e.g. "training records exist") is not sufficient — the chunk must show the specific evidence type required.
- Reject positive verdicts where the only citation is a title page, table of contents, or cover sheet.
