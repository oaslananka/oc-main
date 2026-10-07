import { decideMaintenanceCampaignContinuation } from "./campaign-scheduler.mjs";
import {
  getPullRequest,
  tryUpdateMaintenanceCampaignStatus,
} from "./github.mjs";
import { fetchMaintenanceQualityContext } from "./quality-context.mjs";

export const CAMPAIGN_OBSERVER_MAX_ATTEMPTS = 4;
export const CAMPAIGN_OBSERVER_DELAY_MS = 20_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid campaign observer " + label);
  }
  return number;
}

function exactHead(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid campaign observer " + label);
  }
  return sha;
}

function shouldContinueObservation(decision) {
  return decision.action === "hold" || decision.action === "refresh-evidence";
}

async function collectCurrentHeadSnapshot({
  repository,
  pullNumber,
  readToken,
  getPullRequestImpl,
  fetchMaintenanceQualityContextImpl,
}) {
  const before = await getPullRequestImpl(repository, pullNumber, readToken);
  if (before.state !== "open") {
    throw new Error("Maintenance campaign pull request is not open");
  }
  if (!before.head?.sha || !before.base?.sha || !before.base?.ref) {
    throw new Error("Maintenance campaign pull request head/base is unavailable");
  }

  const observedHead = exactHead(before.head.sha, "observed head");
  const collected = await fetchMaintenanceQualityContextImpl({
    repository,
    pullNumber,
    baseSha: exactHead(before.base.sha, "base head"),
    headSha: observedHead,
    baseBranch: before.base.ref,
    token: readToken,
  });

  const after = await getPullRequestImpl(repository, pullNumber, readToken);
  if (after.state !== "open" || !after.head?.sha) {
    throw new Error("Maintenance campaign pull request changed during observation");
  }

  return {
    currentHead: exactHead(after.head.sha, "current head"),
    evidence: collected?.evidence || null,
  };
}

export async function observeMaintenanceCampaignCurrentHead({
  repository,
  pullNumber,
  state,
  readToken,
  statusToken,
  workerRunId = null,
  attempts = CAMPAIGN_OBSERVER_MAX_ATTEMPTS,
  delayMs = CAMPAIGN_OBSERVER_DELAY_MS,
  getPullRequestImpl = getPullRequest,
  fetchMaintenanceQualityContextImpl = fetchMaintenanceQualityContext,
  updateStatusImpl = tryUpdateMaintenanceCampaignStatus,
  sleepImpl = sleep,
} = {}) {
  const maximumAttempts = positiveInteger(attempts, "attempt count");
  if (maximumAttempts > CAMPAIGN_OBSERVER_MAX_ATTEMPTS) {
    throw new Error("Campaign observer attempt count exceeds trusted bound");
  }
  const waitMs = Number(delayMs);
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > CAMPAIGN_OBSERVER_DELAY_MS) {
    throw new Error("Invalid campaign observer delay");
  }

  let last = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const snapshot = await collectCurrentHeadSnapshot({
      repository,
      pullNumber,
      readToken,
      getPullRequestImpl,
      fetchMaintenanceQualityContextImpl,
    });
    const maxIterations =
      snapshot.evidence?.policy?.campaign?.max_iterations;
    const decision = decideMaintenanceCampaignContinuation({
      state,
      currentHead: snapshot.currentHead,
      maxIterations,
      evidence: snapshot.evidence,
    });

    await updateStatusImpl(
      repository,
      pullNumber,
      {
        state,
        maxIterations,
        phase: decision.statusPhase,
        evidence: snapshot.evidence,
        workerRunId,
      },
      statusToken,
    );

    last = {
      attempt,
      decision,
      currentHead: snapshot.currentHead,
      evidence: snapshot.evidence,
    };
    if (!shouldContinueObservation(decision) || attempt === maximumAttempts) {
      return last;
    }
    await sleepImpl(waitMs);
  }

  return last;
}