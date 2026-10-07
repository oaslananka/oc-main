export function finalizationDecision({ runStatus, allowEdits, changed }) {
  if (runStatus !== "success") return "failure";
  if (!allowEdits && changed) return "blocked-read-only";
  if (!changed) return "completed-no-changes";
  return "push";
}
