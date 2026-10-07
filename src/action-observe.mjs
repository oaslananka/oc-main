import {
  readMaintenanceCampaignState,
} from "./campaign-state.mjs";
import { campaignObservationStopReason, observeMaintenanceCampaign } from "./campaign-observer.mjs";
import { loadConfig } from "./config.mjs";
import {
  FINALIZER_COMMENT_TOKEN_PERMISSIONS,
  MAINTENANCE_EVIDENCE_TOKEN_PERMISSIONS,
  createRepositoryInstallationToken,
  getPullRequest,
  tryUpdateMaintenanceCampaignStatus,
} from "./github.mjs";
import { readVerifiedJob } from "./action-state.mjs";
import { fetchMaintenanceQualityContext } from "./quality-context.mjs";

function positiveIteration(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function exactCampaignState(pr, job, secret) {
  const state = readMaintenanceCampaignState(pr?.body, secret);
  if (!state) {
    throw new Error("Maintenance observer requires trusted campaign state");
  }
  if (state.campaign_pr !== Number(job.pullNumber)) {
    throw new Error("Maintenance observer campaign PR identity is invalid");
  }
  return state;
}

async function main() {
  const config = loadConfig();
  const job = await readVerifiedJob(config.workerDispatchSecret);
  const iteration = positiveIteration(job.campaignIteration);
  if (job.mode !== "maintenance" || !iteration) {
    console.log("Observer skipped: prepared job is not an issue-origin maintenance campaign");
    return;
  }

  const readToken = await createRepositoryInstallationToken(
    config,
    job.repository,
    MAINTENANCE_EVIDENCE_TOKEN_PERMISSIONS,
  );
  const writeToken = await createRepositoryInstallationToken(
    config,
    job.repository,
    FINALIZER_COMMENT_TOKEN_PERMISSIONS,
  );

  async function loadSnapshot() {
    const before = await getPullRequest(
      job.repository,
      job.pullNumber,
      readToken,
    );
    if (before.state !== "open") {
      return { stop: true, reason: "pull-request-closed" };
    }
    if (
      !before.head?.sha ||
      !before.base?.sha ||
      !before.base?.ref
    ) {
      throw new Error("Maintenance observer pull request identity is incomplete");
    }

    const beforeState = exactCampaignState(
      before,
      job,
      config.workerDispatchSecret,
    );
    if (campaignObservationStopReason(beforeState, { iteration: job.campaignIteration, commentId: job.commentId })) {
      return { stop: true, reason: "campaign-advanced" };
    }

    const collected = await fetchMaintenanceQualityContext({
      repository: job.repository,
      pullNumber: job.pullNumber,
      baseSha: before.base.sha,
      headSha: before.head.sha,
      baseBranch: before.base.ref,
      token: readToken,
    });

    const latest = await getPullRequest(
      job.repository,
      job.pullNumber,
      readToken,
    );
    if (latest.state !== "open") {
      return { stop: true, reason: "pull-request-closed" };
    }
    if (!latest.head?.sha || !latest.base?.sha) {
      throw new Error("Maintenance observer live pull request identity is incomplete");
    }

    const state = exactCampaignState(
      latest,
      job,
      config.workerDispatchSecret,
    );
    if (campaignObservationStopReason(state, { iteration: job.campaignIteration, commentId: job.commentId })) {
      return { stop: true, reason: "campaign-advanced" };
    }

    return {
      state,
      currentHead: latest.head.sha,
      currentBaseSha: latest.base.sha,
      maxIterations: collected.evidence.policy.campaign.max_iterations,
      evidence: collected.evidence,
    };
  }

  async function updateStatus({ snapshot, decision }) {
    await tryUpdateMaintenanceCampaignStatus(
      job.repository,
      job.pullNumber,
      {
        state: snapshot.state,
        maxIterations: snapshot.maxIterations,
        phase: decision.statusPhase,
        evidence: snapshot.evidence,
        workerRunId: process.env.GITHUB_RUN_ID || null,
      },
      writeToken,
    );
  }

  const result = await observeMaintenanceCampaign({
    loadSnapshot,
    updateStatus,
  });

  if (result.stopped) {
    console.log("Observer stopped: " + result.stopReason);
    return;
  }
  console.log(
    "Observed maintenance campaign after " +
      result.attempts +
      " attempt(s): " +
      result.decision.action +
      " reason=" +
      result.decision.reason +
      (result.timedOut ? " timed_out=true" : ""),
  );
}

await main();
