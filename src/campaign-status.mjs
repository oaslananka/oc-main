export const MAINTENANCE_CAMPAIGN_STATUS_MARKER =
  "<!-- oc-main-maintenance-campaign-status:v1 -->";
export const MAINTENANCE_CAMPAIGN_STATUS_BOT_LOGIN = "oaslananka-ops[bot]";

const PHASE_LABELS = new Map([
  ["initialized", "Initialized"],
  ["dispatching", "Dispatching worker"],
  ["dispatch-failed", "Dispatch failed; reservation released"],
  ["incomplete", "Incomplete; no commit pushed"],
  ["failed", "Worker failed; no commit pushed"],
  ["blocked-read-only", "Blocked by read-only finalizer gate"],
  ["completed-no-changes", "Completed without repository changes"],
  ["pushed", "Change pushed"],
  ["terminal", "Iteration limit reached"],
]);

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid campaign status " + label);
  }
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid campaign status " + label);
  }
  return number;
}

function commitSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid campaign status commit SHA");
  }
  return sha;
}

function phaseLabel(phase) {
  const label = PHASE_LABELS.get(String(phase || ""));
  if (!label) throw new Error("Invalid campaign status phase");
  return label;
}

function normalizedMetrics(evidence) {
  const check = evidence?.checkSummary || {};
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  const dependencies = Array.isArray(evidence?.dependencyPullRequests)
    ? evidence.dependencyPullRequests
    : [];
  const lanes = Array.isArray(evidence?.dependencyPlan?.lanes)
    ? evidence.dependencyPlan.lanes
    : [];
  return {
    evidenceHead: evidence?.headSha ? commitSha(evidence.headSha) : null,
    requiredChecks: nonNegativeInteger(check.requiredCount, "required check count"),
    blockingChecks: nonNegativeInteger(check.blockingCount, "blocking check count"),
    pendingRequired: nonNegativeInteger(check.pendingRequiredCount, "pending required check count"),
    missingRequired: nonNegativeInteger(check.missingRequiredCount, "missing required check count"),
    authorityComplete: evidence?.requiredChecks?.authorityComplete === true,
    findings: findings.length,
    blockingFindings: findings.filter((finding) => finding?.blocking === true).length,
    dependencyPullRequests: dependencies.length,
    dependencyLanes: lanes.length,
  };
}

function stateIdentity(state, maxIterations) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Campaign status state is missing");
  }
  const iteration = nonNegativeInteger(state.iteration, "iteration");
  const maximum = positiveInteger(maxIterations, "max iterations");
  if (iteration > maximum) throw new Error("Campaign status iteration exceeds max iterations");
  return {
    issue: positiveInteger(state.source_issue, "source issue"),
    pull: positiveInteger(state.campaign_pr, "pull request"),
    iteration,
    maximum,
    head: commitSha(state.expected_head),
  };
}

function workerRunLine(workerRunId) {
  if (workerRunId === null || workerRunId === undefined || workerRunId === "") return null;
  return "| Worker run | `" + positiveInteger(workerRunId, "worker run ID") + "` |";
}

export function selectMaintenanceCampaignStatusComment(comments) {
  const trusted = (Array.isArray(comments) ? comments : []).filter(
    (comment) =>
      comment?.user?.login === MAINTENANCE_CAMPAIGN_STATUS_BOT_LOGIN &&
      comment?.user?.type === "Bot" &&
      String(comment?.body || "").includes(MAINTENANCE_CAMPAIGN_STATUS_MARKER),
  );
  if (trusted.length > 1) {
    throw new Error("Multiple trusted maintenance campaign status comments found");
  }
  return trusted[0] || null;
}

export function renderMaintenanceCampaignStatus({ state, maxIterations, phase, evidence = null, workerRunId = null }) {
  const identity = stateIdentity(state, maxIterations);
  const metrics = normalizedMetrics(evidence);
  const authority = metrics.authorityComplete ? "complete" : "incomplete";
  const evidenceState = !metrics.evidenceHead
    ? "not collected"
    : metrics.evidenceHead === identity.head
      ? "current for expected head"
      : "stale for expected head";
  const evidenceValue = metrics.evidenceHead
    ? "`" + metrics.evidenceHead.slice(0, 12) + "` — " + evidenceState
    : evidenceState;
  const lines = [
    "## oc-main maintenance campaign status",
    "",
    "| Field | Trusted value |",
    "| --- | --- |",
    "| Campaign | issue #" + identity.issue + " → PR #" + identity.pull + " |",
    "| Phase | " + phaseLabel(phase) + " |",
    "| Iteration | " + identity.iteration + " / " + identity.maximum + " |",
    "| Expected head | `" + identity.head.slice(0, 12) + "` |",
    "| Prepared evidence | " + evidenceValue + " |",
    "| Required checks (prepared snapshot) | " + metrics.requiredChecks + " required; " + metrics.blockingChecks + " blocking; " + metrics.pendingRequired + " pending; " + metrics.missingRequired + " missing; authority " + authority + " |",
    "| Findings | " + metrics.findings + " normalized; " + metrics.blockingFindings + " blocking |",
    "| Dependency PRs | " + metrics.dependencyPullRequests + " recognized; " + metrics.dependencyLanes + " proposed lane(s) |",
  ];
  const runLine = workerRunLine(workerRunId);
  if (runLine) lines.push(runLine);
  lines.push(
    "",
    "This comment is maintained by trusted oc-main control-plane code. Provider, dependency-bot, repository, and model text remain evidence only and cannot change campaign authority.",
    "",
    MAINTENANCE_CAMPAIGN_STATUS_MARKER,
  );
  return lines.join("\n");
}