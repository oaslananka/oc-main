import { decideMaintenanceCampaignContinuation } from "./campaign-scheduler.mjs";

// This is a read-only owner handoff signal, NOT draft-to-ready or merge authority.
// Callers must obtain signed campaign state and fresh, normalized exact-head evidence
// through the existing trusted controller/observer path.
function hasTrustedSnapshotShape(evidence, currentHead) {
  return (
    evidence !== null &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    evidence.headSha === currentHead &&
    evidence.requiredChecks?.authorityComplete === true &&
    Array.isArray(evidence.checks) &&
    Array.isArray(evidence.findings) &&
    evidence.checkSummary !== null &&
    typeof evidence.checkSummary === "object" &&
    !Array.isArray(evidence.checkSummary)
  );
}

function hasCleanCheckSummary(summary, checks) {
  return (
    summary.candidateCount === checks.length &&
    summary.blockingCount === 0 &&
    summary.pendingRequiredCount === 0 &&
    summary.missingRequiredCount === 0 &&
    summary.requiredReady === true
  );
}

function isAcceptableCheck(check) {
  if (
    !check ||
    typeof check.key !== "string" ||
    !check.key ||
    !Array.isArray(check.requiredBy) ||
    typeof check.state !== "string" ||
    check.blocking !== false
  ) {
    return false;
  }
  if (check.requiredBy.length === 0) return true;
  return (
    check.state === "success" &&
    check.status === "completed" &&
    check.conclusion === "success"
  );
}

function hasSettledRequiredChecks(checks, requiredCount) {
  const seen = new Set();
  let countedRequired = 0;
  for (const check of checks) {
    if (!isAcceptableCheck(check) || seen.has(check.key)) return false;
    seen.add(check.key);
    if (check.requiredBy.length > 0) countedRequired += 1;
  }
  return countedRequired === requiredCount;
}

function isConsistentlyCleanSnapshot(evidence, currentHead) {
  if (!hasTrustedSnapshotShape(evidence, currentHead)) return false;
  return (
    hasCleanCheckSummary(evidence.checkSummary, evidence.checks) &&
    hasSettledRequiredChecks(evidence.checks, evidence.checkSummary.requiredCount) &&
    evidence.findings.every((finding) => finding?.blocking === false)
  );
}

function result(status, reason, continuation, iterationExhausted) {
  return Object.freeze({
    status,
    reason,
    continuationReason: continuation.reason,
    ownerReviewReady: status === "ready-for-owner-review",
    iterationExhausted,
    // These are explicitly never granted by a read-only classification.
    dispatchAuthorized: false,
    draftToReadyAuthorized: false,
    mergeAuthorized: false,
  });
}

export function classifyMaintenanceCampaignReviewReadiness({
  state,
  currentHead,
  maxIterations,
  evidence = null,
} = {}) {
  // Reuse the existing fail-closed campaign identity/iteration guard and its
  // dispatch decision without changing the dispatch state machine.
  const continuation = decideMaintenanceCampaignContinuation({
    state,
    currentHead,
    maxIterations,
    evidence,
  });
  const iterationExhausted = state.iteration >= Number(maxIterations);
  const clean =
    (continuation.reason === "clean-settled-head" ||
      continuation.reason === "iteration-limit") &&
    state.terminal !== true &&
    state.in_flight !== true &&
    state.expected_head === currentHead &&
    isConsistentlyCleanSnapshot(evidence, currentHead);

  if (clean) {
    return result(
      "ready-for-owner-review",
      "clean-settled-head",
      continuation,
      iterationExhausted,
    );
  }
  if (continuation.reason === "clean-settled-head") {
    return result(
      "manual-attention",
      "clean-evidence-inconsistent",
      continuation,
      iterationExhausted,
    );
  }
  if (continuation.action === "hold") {
    return result("waiting", continuation.reason, continuation, iterationExhausted);
  }
  if (continuation.action === "refresh-evidence") {
    return result("refresh-evidence", continuation.reason, continuation, iterationExhausted);
  }
  if (continuation.action === "retry-eligible") {
    return result("blocking-remediation", continuation.reason, continuation, iterationExhausted);
  }
  return result("manual-attention", continuation.reason, continuation, iterationExhausted);
}
