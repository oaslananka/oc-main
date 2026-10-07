import { decideMaintenanceCampaignContinuation } from "./campaign-scheduler.mjs";
import { readMaintenanceCampaignState } from "./campaign-state.mjs";
import {
  getPullRequest,
  tryUpdateMaintenanceCampaignStatus,
} from "./github.mjs";
import { fetchMaintenanceQualityContext } from "./quality-context.mjs";

export const CAMPAIGN_OBSERVER_MAX_ATTEMPTS = 7;
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

function nonNegativeInteger(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
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

function observationLease(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Campaign observer state is missing");
  }
  return {
    pull: positiveInteger(state.campaign_pr, "campaign pull request"),
    iteration: nonNegativeInteger(state.iteration, "campaign iteration"),
    head: exactHead(state.expected_head, "campaign expected head"),
    terminal: state.terminal === true,
    inFlight: state.in_flight === true,
    lastCommentId:
      state.last_comment_id === null || state.last_comment_id === undefined
        ? null
        : positiveInteger(state.last_comment_id, "last comment ID"),
  };
}

function sameObservationLease(origin, current) {
  if (!current) return false;
  const left = observationLease(origin);
  const right = observationLease(current);
  return (
    left.pull === right.pull &&
    left.iteration === right.iteration &&
    left.head === right.head &&
    left.terminal === right.terminal &&
    left.inFlight === false &&
    right.inFlight === false &&
    left.lastCommentId === right.lastCommentId
  );
}

function supersededDecision() {
  return Object.freeze({
    action: "superseded",
    reason: "campaign-state-advanced",
    statusPhase: null,
    dispatchEligible: false,
  });
}

function shouldContinueObservation(decision) {
  return (
    decision.action === "hold" ||
    decision.action === "refresh-evidence" ||
    decision.reason === "required-checks-missing"
  );
}

function observedStatusPhase(decision, attempt, maximumAttempts) {
  if (
    decision.reason === "required-checks-missing" &&
    attempt < maximumAttempts
  ) {
    return "waiting-checks";
  }
  return decision.statusPhase;
}

async function collectCurrentHeadSnapshot({
  repository,
  pullNumber,
  state,
  readToken,
  campaignStateSecret,
  getPullRequestImpl,
  fetchMaintenanceQualityContextImpl,
  readCampaignStateImpl,
}) {
  const before = await getPullRequestImpl(repository, pullNumber, readToken);
  if (before.state !== "open") {
    throw new Error("Maintenance campaign pull request is not open");
  }
  if (!before.head?.sha || !before.base?.sha || !before.base?.ref) {
    throw new Error("Maintenance campaign pull request head/base is unavailable");
  }
  const beforeState = readCampaignStateImpl(
    before.body,
    campaignStateSecret,
  );
  if (!sameObservationLease(state, beforeState)) {
    return {
      superseded: true,
      currentHead: exactHead(before.head.sha, "current head"),
      evidence: null,
    };
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
  const afterState = readCampaignStateImpl(
    after.body,
    campaignStateSecret,
  );
  if (!sameObservationLease(state, afterState)) {
    return {
      superseded: true,
      currentHead: exactHead(after.head.sha, "current head"),
      evidence: null,
    };
  }

  return {
    superseded: false,
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
  campaignStateSecret,
  workerRunId = null,
  attempts = CAMPAIGN_OBSERVER_MAX_ATTEMPTS,
  delayMs = CAMPAIGN_OBSERVER_DELAY_MS,
  getPullRequestImpl = getPullRequest,
  fetchMaintenanceQualityContextImpl = fetchMaintenanceQualityContext,
  updateStatusImpl = tryUpdateMaintenanceCampaignStatus,
  readCampaignStateImpl = readMaintenanceCampaignState,
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

  async function observeAttempt(attempt) {
    const snapshot = await collectCurrentHeadSnapshot({
      repository,
      pullNumber,
      state,
      readToken,
      campaignStateSecret,
      getPullRequestImpl,
      fetchMaintenanceQualityContextImpl,
      readCampaignStateImpl,
    });
    if (snapshot.superseded) {
      return {
        attempt,
        decision: supersededDecision(),
        currentHead: snapshot.currentHead,
        evidence: null,
      };
    }
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
        phase: observedStatusPhase(
          decision,
          attempt,
          maximumAttempts,
        ),
        evidence: snapshot.evidence,
        workerRunId,
      },
      statusToken,
    );

    const result = {
      attempt,
      decision,
      currentHead: snapshot.currentHead,
      evidence: snapshot.evidence,
    };
    if (!shouldContinueObservation(decision) || attempt === maximumAttempts) {
      return result;
    }

    await sleepImpl(waitMs);
    return observeAttempt(attempt + 1);
  }

  return observeAttempt(1);
}