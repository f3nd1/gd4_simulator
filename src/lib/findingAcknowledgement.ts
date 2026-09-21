// Acknowledgement: the honest replacement for an "Official / Unofficial"
// column on a findings log.
//
// Marking your own nonconformity unofficial removes it from the count, which
// is what makes that column corrosive: the log stops recording what the
// auditor found and starts recording what was negotiated afterwards. What the
// column is actually used for at UCC is visible in the annotation on one of
// them, "we are revamping our entire procedure" — that is not an unofficial
// NC, that is an NC the auditee accepts and already has work under way on.
//
// So nothing here can change a finding's type or severity. An acknowledged NC
// is still an NC in every count, every export and every report. The only thing
// acknowledgement changes is whether the finding is OPEN AND UNACKNOWLEDGED,
// which is the number a management review should be reading.

export type AcknowledgementFields = {
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  agreedAction?: string;
  agreedDueDate?: string;
};

export type AcknowledgementState = "none" | "partial" | "acknowledged";

// An acknowledgement counts only when BOTH halves are there: a named person
// and the date they accepted it. "Accepted by nobody" and "accepted at no
// point in time" are not acceptances, and a half-filled record would otherwise
// quietly read as one.
export function acknowledgementState(f: AcknowledgementFields): AcknowledgementState {
  const who = (f.acknowledgedBy ?? "").trim();
  const when = (f.acknowledgedAt ?? "").trim();
  if (who && when) return "acknowledged";
  if (who || when || (f.agreedAction ?? "").trim() || (f.agreedDueDate ?? "").trim()) return "partial";
  return "none";
}

export function isAcknowledged(f: AcknowledgementFields): boolean {
  return acknowledgementState(f) === "acknowledged";
}

// What is still missing, said plainly, so a half-filled record shows what it
// needs rather than sitting in an unexplained in-between state.
export function acknowledgementGap(f: AcknowledgementFields): string {
  if (acknowledgementState(f) !== "partial") return "";
  const missing: string[] = [];
  if (!(f.acknowledgedBy ?? "").trim()) missing.push("who accepted it");
  if (!(f.acknowledgedAt ?? "").trim()) missing.push("the date they accepted it");
  return missing.length ? `Not yet acknowledged: still needs ${missing.join(" and ")}.` : "";
}

// An agreed action with no date is a wish. This is advisory text, never a
// block: an auditor may legitimately record the commitment before the date is
// agreed.
export function agreedActionNote(f: AcknowledgementFields): string {
  const action = (f.agreedAction ?? "").trim();
  const due = (f.agreedDueDate ?? "").trim();
  if (action && !due) return "An agreed action with no date cannot be followed up. Add the date it is due by.";
  if (!action && due) return "A due date with no agreed action does not say what is due.";
  return "";
}

// True when the agreed date has passed and the finding is still open. Computed,
// never stored: a stored flag is the bug Finding.overdue already has, where it
// is written false at every creation site and can never become true.
export function agreedActionOverdue(f: AcknowledgementFields, closed: boolean, today: Date = new Date()): boolean {
  const due = (f.agreedDueDate ?? "").trim();
  if (!due || closed) return false;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return false;
  // Compare whole days, so a date due today is not overdue until tomorrow.
  const endOfDue = new Date(t);
  endOfDue.setHours(23, 59, 59, 999);
  return today.getTime() > endOfDue.getTime();
}

// One line for the log and the register. Deliberately never says "closed" or
// "resolved": acknowledgement is the auditee accepting the finding, not the
// finding going away.
export function acknowledgementSummary(f: AcknowledgementFields): string {
  if (acknowledgementState(f) !== "acknowledged") return "";
  const who = (f.acknowledgedBy ?? "").trim();
  const when = shortDate((f.acknowledgedAt ?? "").trim());
  const due = (f.agreedDueDate ?? "").trim() ? `, due ${shortDate((f.agreedDueDate ?? "").trim())}` : "";
  return `Acknowledged by ${who} on ${when}${due}`;
}

export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
