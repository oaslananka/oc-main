function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid campaign continuation " + label);
  }
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid campaign continuation " + label);
  }
  return number;
}

function commitSha(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid campaign continuation " + label);
  }
  return sha;
}

function normalizedState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Campaign continuation state is missing");
  }
  return {
    expectedHead: commitSha(state.expected_head, "expected head"),
    iteration: nonNegativeInteger(state.iteration, "iteration"),
    terminal: state.terminal === true,
    inFlight: state.in_flight === true,
  };
}

function normalizedEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Campaign continuation evidence is missing");
  }

  const maxIterations = positiveInteger(
    evidence?.policy?.campaign?.max_iterations,
    "max iterations",
  );
  if (maxIterations > 8) {
    throw new Error("Invalid campaign continuation max iterations");
  }

  const checkSummary = evidence.checkSummary || {};
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];

  return {
    headSha: commitSha(evidence.headSha, "evidence head"),
    maxIterations,
    authorityComplete: evidence?.requiredChecks?.authorityComplete === true,
    requiredCount: nonNegativeInteger(
      checkSummary.requiredCount ?? 0,
      "required check count",
    ),
    blockingCount: nonNegativeInteger(
      checkSummary.blockingCount ?? 0,
      "blocking check count",
    ),
    pendingRequiredCount: nonNegativeInteger(
      checkSummary.pendingRequiredCount ?? 0,
      "pending required check count",
    ),
    missingRequiredCount: nonNegativeInteger(
      checkSummary.missingRequiredCount ?? 0,
      "missing required check count",
    ),
    blockingFindingCount: findings.filter(
      (finding) => finding?.blocking === true,
    ).length,
  };
}

function decision(action, details = {}) {
  return Object.freeze({ action, ...details });
}

export function decideMaintenanceCampaignContinuation({
  state,
  currentHead,
  evidence,
}) {
  const campaign = normalizedState(state);
  const snapshot = normalizedEvidence(evidence);
  const head = commitSha(currentHead, "current head");

  if (campaign.expectedHead !== head) {
    return decision("stale-head", {
      expectedHead: campaign.expectedHead,
      currentHead: head,
    });
  }

  if (snapshot.headSha !== head) {
    return decision("stale-evidence", {
      currentHead: head,
      evidenceHead: snapshot.headSha,
    });
  }

  if (campaign.terminal) {
    return decision("terminal", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
    });
  }

  if (campaign.inFlight) {
    return decision("busy", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
    });
  }

  if (campaign.iteration >= snapshot.maxIterations) {
    return decision("iteration-limit", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
    });
  }

  if (!snapshot.authorityComplete) {
    return decision("wait-authority", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
    });
  }

  if (
    snapshot.pendingRequiredCount > 0 ||
    snapshot.missingRequiredCount > 0
  ) {
    return decision("wait-checks", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
      requiredCount: snapshot.requiredCount,
      pendingRequiredCount: snapshot.pendingRequiredCount,
      missingRequiredCount: snapshot.missingRequiredCount,
    });
  }

  if (
    snapshot.blockingCount > 0 ||
    snapshot.blockingFindingCount > 0
  ) {
    return decision("remediate-eligible", {
      iteration: campaign.iteration,
      maxIterations: snapshot.maxIterations,
      blockingCheckCount: snapshot.blockingCount,
      blockingFindingCount: snapshot.blockingFindingCount,
    });
  }

  return decision("owner-review", {
    iteration: campaign.iteration,
    maxIterations: snapshot.maxIterations,
    requiredCount: snapshot.requiredCount,
  });
}
