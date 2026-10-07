import { decideMaintenanceCampaignContinuation } from "./campaign-scheduler.mjs";
import { readMaintenanceCampaignState } from "./campaign-state.mjs";
import { createSignedJob, wrapSignedJob } from "./dispatch.mjs";
import {
  MAINTENANCE_READ_TOKEN_PERMISSIONS,
  abortMaintenanceCampaignDispatch,
  beginAutomaticMaintenanceCampaignDispatch,
  createRepositoryInstallationToken,
  dispatchRepositoryEvent,
  getPullRequest,
} from "./github.mjs";
import { fetchMaintenanceQualityContext } from "./quality-context.mjs";

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Invalid automatic maintenance " + label);
  }
  return number;
}

function exactHead(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Invalid automatic maintenance " + label);
  }
  return sha;
}

function automaticTask(state) {
  if (
    state?.version !== 2 ||
    typeof state.auto_task_prompt !== "string" ||
    !state.auto_task_prompt.trim() ||
    typeof state.auto_model !== "string" ||
    !state.auto_model
  ) {
    return null;
  }
  return {
    prompt: state.auto_task_prompt,
    model: state.auto_model,
  };
}

function sameIdleCampaign(left, right) {
  if (!left || !right) return false;
  return (
    left.version === right.version &&
    left.campaign_pr === right.campaign_pr &&
    left.source_issue === right.source_issue &&
    left.source_comment_id === right.source_comment_id &&
    left.expected_head === right.expected_head &&
    left.iteration === right.iteration &&
    left.terminal === right.terminal &&
    left.in_flight === false &&
    right.in_flight === false &&
    left.last_comment_id === right.last_comment_id &&
    left.auto_task_prompt === right.auto_task_prompt &&
    left.auto_model === right.auto_model
  );
}

function automaticPrompt(state, reservation) {
  return (
    "Automatic maintenance continuation for authorized issue #" +
    state.source_issue +
    "; trusted iteration " +
    reservation.iteration +
    "/" +
    reservation.maxIterations +
    ". Re-evaluate the prepared current-head maintenance evidence and remediate only current blockers without weakening repository gates. Original authorized maintenance task: " +
    state.auto_task_prompt
  );
}

export async function evaluateAutomaticMaintenanceWakeup({
  config,
  trigger,
  createRepositoryInstallationTokenImpl = createRepositoryInstallationToken,
  getPullRequestImpl = getPullRequest,
  readCampaignStateImpl = readMaintenanceCampaignState,
  fetchMaintenanceQualityContextImpl = fetchMaintenanceQualityContext,
  decideContinuationImpl = decideMaintenanceCampaignContinuation,
  beginAutomaticDispatchImpl = beginAutomaticMaintenanceCampaignDispatch,
  abortDispatchImpl = abortMaintenanceCampaignDispatch,
  createSignedJobImpl = createSignedJob,
  dispatchRepositoryEventImpl = dispatchRepositoryEvent,
} = {}) {
  const repository = String(trigger?.repository || "");
  const pullNumber = positiveInteger(trigger?.pullNumber, "pull request");
  const triggerCommentId = positiveInteger(
    trigger?.commentId,
    "status comment ID",
  );
  const triggerUserId = positiveInteger(
    trigger?.commentUserId,
    "status comment user ID",
  );
  const wakeupIteration = positiveInteger(
    trigger?.expectedIteration,
    "wakeup iteration",
  );
  const wakeupHead = exactHead(trigger?.expectedHead, "wakeup head");

  const readToken = await createRepositoryInstallationTokenImpl(
    config,
    repository,
    MAINTENANCE_READ_TOKEN_PERMISSIONS,
  );
  const before = await getPullRequestImpl(repository, pullNumber, readToken);
  if (before?.state !== "open") {
    return { dispatched: false, reason: "closed" };
  }
  if (!before.head?.sha || !before.base?.sha || !before.base?.ref) {
    throw new Error("Automatic maintenance pull request head/base is unavailable");
  }

  const beforeState = readCampaignStateImpl(
    before.body,
    config.workerDispatchSecret,
  );
  const task = automaticTask(beforeState);
  if (!task) {
    return { dispatched: false, reason: "legacy-or-no-auto-task" };
  }
  if (
    beforeState.iteration !== wakeupIteration ||
    beforeState.expected_head !== wakeupHead
  ) {
    return { dispatched: false, reason: "stale-wakeup" };
  }
  if (!config.allowedModels.has(task.model)) {
    return { dispatched: false, reason: "model-not-allowed" };
  }
  if (beforeState.in_flight || beforeState.terminal) {
    return {
      dispatched: false,
      reason: beforeState.in_flight ? "iteration-in-flight" : "campaign-terminal",
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
  if (after?.state !== "open" || !after.head?.sha) {
    return { dispatched: false, reason: "changed-during-evaluation" };
  }
  const afterState = readCampaignStateImpl(
    after.body,
    config.workerDispatchSecret,
  );
  if (!sameIdleCampaign(beforeState, afterState)) {
    return { dispatched: false, reason: "campaign-state-advanced" };
  }

  const currentHead = exactHead(after.head.sha, "current head");
  const evidence = collected?.evidence || null;
  const maxIterations = evidence?.policy?.campaign?.max_iterations;
  const decision = decideContinuationImpl({
    state: afterState,
    currentHead,
    maxIterations,
    evidence,
  });
  if (decision.action !== "retry-eligible") {
    return {
      dispatched: false,
      reason: decision.reason,
      decision,
    };
  }

  const reservation = await beginAutomaticDispatchImpl(config, {
    repository,
    pullNumber,
    triggerCommentId,
    expectedHead: currentHead,
    expectedIteration: afterState.iteration,
  });
  if (!reservation.dispatch) {
    return {
      dispatched: false,
      reason: reservation.reason,
      decision,
      reservation,
    };
  }

  const command = {
    mode: "maintenance",
    model: task.model,
    prompt: automaticPrompt(afterState, reservation),
  };
  const workerTrigger = {
    repository,
    pullNumber,
    commentId: triggerCommentId,
    commentUserId: triggerUserId,
    triggerKind: "automation-status",
    campaignIteration: reservation.iteration,
    reviewContext: null,
  };
  const job = createSignedJobImpl(
    workerTrigger,
    command,
    config.workerDispatchSecret,
  );

  try {
    await dispatchRepositoryEventImpl(
      config,
      config.controlRepository,
      config.dispatchEventType,
      wrapSignedJob(job),
    );
  } catch (error) {
    try {
      await abortDispatchImpl(config, {
        repository,
        pullNumber,
        commentId: triggerCommentId,
        iteration: reservation.iteration,
        expectedHead: reservation.expectedHead,
        maxIterations: reservation.maxIterations,
      });
    } catch (rollbackError) {
      console.error(`automatic campaign dispatch rollback failed for ${repository}#${pullNumber}`, rollbackError);
    }
    throw error;
  }

  return {
    dispatched: true,
    reason: "retry-eligible",
    iteration: reservation.iteration,
    expectedHead: reservation.expectedHead,
    decision,
    job,
  };
}
