# Scanned Document Evidence Skill

## Scanned PDFs are different from text PDFs

A scanned PDF is a photograph of a printed document. It contains no machine-readable text. Text extraction from a scanned PDF yields very few characters (typically under 50) or produces garbled OCR fragments. A scanned PDF with very little extractable text must NOT be treated as a fully read document.

## Detection: suspectedScannedPdf

Flag a PDF as suspectedScannedPdf = true when:
- Total extractable text is under 50 characters (quality: "none")
- Average text per page is under 200 characters (quality: "low")

These thresholds indicate the PDF is likely a scan with no selectable text layer.

## Audit cues visible in scanned documents

Even without full text extraction, scanned documents may still provide audit signals. An auditor or AI vision model reviewing the scan image can observe:
- Presence of handwritten or stamped signatures → suggests approval or sign-off
- Official letterhead or logos → confirms institutional origin
- Date fields, version numbers → indicate currency and version control
- Blank vs filled-in form fields → a mostly-blank form is weak evidence; a filled form is stronger
- Approval/witness boxes → signed boxes suggest the process was followed
- Missing pages or cut-off sections → raises completeness concerns
- Low-quality / blurry scan → human verification is required before relying on it

## Signed document evidence

A signed document proves approval only if the signer's role AND a date are visible. A signature alone without a date or role is insufficient. A document that is "signed" but the signer's name/role is illegible cannot be credited as having been properly approved.

## Mostly-blank form

A mostly-blank or partially completed form is Weak evidence at best. It shows the institution has the form template, but not that the process was carried out.

## Human verification required

Scanned PDFs with suspectedScannedPdf = true must be flagged as requiring human verification. The AI auditor should note: "This PDF appears to be a scan with little extractable text. The content description below is from OCR/vision and may be incomplete. An auditor should manually review the physical document or request a text-based copy."
