function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid scheduler " + label);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid scheduler " + label);
  }
  return number;
}

function commitSha(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid scheduler " + label);
  }
  return sha;
}

function normalizedState(state, maxIterations) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Scheduler campaign state is missing");
  }
  const iteration = nonNegativeInteger(state.iteration, "iteration");
  const maximum = positiveInteger(maxIterations, "max iterations");
  if (maximum > 8 || iteration > 8) {
    throw new Error("Invalid scheduler iteration bound");
  }
  return {
    expectedHead: commitSha(state.expected_head, "expected head"),
    iteration,
    maximum,
    terminal: state.terminal === true,
    inFlight: state.in_flight === true,
  };
}

function normalizedEvidence(evidence) {
  if (evidence === null || evidence === undefined) return null;
  if (typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Invalid scheduler evidence");
  }

  const summary = evidence.checkSummary || {};
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  return {
    head: commitSha(evidence.headSha, "evidence head"),
    authorityComplete: evidence.requiredChecks?.authorityComplete === true,
    requiredCount: nonNegativeInteger(summary.requiredCount, "required count"),
    blockingChecks: nonNegativeInteger(summary.blockingCount, "blocking check count"),
    pendingRequired: nonNegativeInteger(
      summary.pendingRequiredCount,
      "pending required count",
    ),
    missingRequired: nonNegativeInteger(
      summary.missingRequiredCount,
      "missing required count",
    ),
    requiredReady: summary.requiredReady === true,
    blockingFindings: findings.filter((finding) => finding?.blocking === true)
      .length,
  };
}

function decision(action, reason, statusPhase, extra = {}) {
  return Object.freeze({
    action,
    reason,
    statusPhase,
    dispatchEligible: action === "retry-eligible",
    ...extra,
  });
}

export function decideMaintenanceCampaignContinuation({
  state,
  currentHead,
  maxIterations,
  evidence = null,
} = {}) {
  const campaign = normalizedState(state, maxIterations);
  const head = commitSha(currentHead, "current head");

  if (campaign.terminal) {
    return decision("owner-review", "campaign-terminal", "owner-review", {
      terminal: true,
    });
  }
  if (campaign.inFlight) {
    return decision("hold", "iteration-in-flight", "dispatching");
  }
  if (campaign.expectedHead !== head) {
    return decision("owner-review", "campaign-head-stale", "owner-review", {
      requiresEvidenceRefresh: true,
    });
  }
  if (campaign.iteration > campaign.maximum) {
    return decision(
      "owner-review",
      "iteration-policy-conflict",
      "owner-review",
      { terminal: true },
    );
  }
  if (campaign.iteration === campaign.maximum) {
    return decision("owner-review", "iteration-limit", "owner-review", {
      terminal: true,
    });
  }

  const snapshot = normalizedEvidence(evidence);
  if (!snapshot) {
    return decision("refresh-evidence", "evidence-missing", "waiting-checks", {
      requiresEvidenceRefresh: true,
    });
  }
  if (snapshot.head !== head) {
    return decision("refresh-evidence", "evidence-stale", "waiting-checks", {
      requiresEvidenceRefresh: true,
    });
  }
  if (!snapshot.authorityComplete) {
    return decision(
      "owner-review",
      "required-check-authority-incomplete",
      "owner-review",
    );
  }
  if (snapshot.missingRequired > 0) {
    return decision(
      "owner-review",
      "required-checks-missing",
      "owner-review",
    );
  }
  if (snapshot.pendingRequired > 0) {
    return decision(
      "hold",
      "required-checks-pending",
      "waiting-checks",
    );
  }

  const requiredStateConsistent =
    snapshot.requiredReady === (snapshot.blockingChecks === 0);
  if (!requiredStateConsistent) {
    return decision(
      "owner-review",
      "required-check-state-inconsistent",
      "owner-review",
    );
  }

  const blocking =
    snapshot.blockingChecks > 0 || snapshot.blockingFindings > 0;
  if (blocking) {
    return decision(
      "retry-eligible",
      "blocking-regression",
      "ready-remediation",
      {
        blockingChecks: snapshot.blockingChecks,
        blockingFindings: snapshot.blockingFindings,
      },
    );
  }

  return decision("owner-review", "clean-settled-head", "owner-review");
}
