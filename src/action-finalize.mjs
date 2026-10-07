import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import {
  FINALIZER_COMMENT_TOKEN_PERMISSIONS,
  completeMaintenanceCampaignDispatch,
  createPullRequestComment,
  createRepositoryInstallationToken,
  getPullRequest,
  tryUpdateMaintenanceCampaignStatus,
} from "./github.mjs";
import { commitChanges, hasChanges, pushHead } from "./git.mjs";
import { finalizationDecision } from "./finalize-policy.mjs";
import { readResult, readVerifiedJob } from "./action-state.mjs";

function truncate(text, limit = 5000) {
  const value = String(text || "");
  return value.length <= limit ? value : value.slice(0, limit) + "\n\n[output truncated]";
}

function commitMessageForMode(mode) {
  if (mode === "fix") return "fix: apply oc-main requested change";
  if (mode === "refactor") return "refactor: apply oc-main requested change";
  if (mode === "ci" || mode === "release") return "ci: apply oc-main requested change";
  if (mode === "maintenance") return "chore: apply maintenance remediation";
  return "chore: apply oc-main requested change";
}

function runLabel(job) {
  return "mode `" + job.mode + "`, agent `" + job.agent + "`, model `" + job.model + "`, risk `" + job.risk + "`";
}

async function main() {
  const config = loadConfig();
  const job = await readVerifiedJob(config.workerDispatchSecret);
  const result = await readResult();
  const baseToken = await createRepositoryInstallationToken(
    config,
    job.repository,
    FINALIZER_COMMENT_TOKEN_PERMISSIONS,
  );

  async function finishCampaign(newHead, terminal = false) {
    if (
      !Number.isSafeInteger(job.campaignIteration) ||
      job.campaignIteration <= 0
    ) {
      return null;
    }
    return completeMaintenanceCampaignDispatch(
      job.repository,
      {
        pullNumber: job.pullNumber,
        commentId: job.commentId,
        iteration: job.campaignIteration,
        expectedHead: job.expectedHead,
        newHead,
        terminal,
      },
      baseToken,
      config.workerDispatchSecret,
    );
  }

  async function updateCampaignStatus(state, phase) {
    if (!state) return;
    await tryUpdateMaintenanceCampaignStatus(
      job.repository,
      job.pullNumber,
      {
        state,
        maxIterations: job.qualityEvidence?.policy?.campaign?.max_iterations,
        phase,
        evidence: job.qualityEvidence,
        workerRunId: process.env.GITHUB_RUN_ID || null,
      },
      baseToken,
    );
  }

  if (result.runStatus === "incomplete") {
    const message =
      result.output || result.error || "The requested change was not completed.";
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "incomplete");
    await createPullRequestComment(
      job.repository,
      job.pullNumber,
      "Run incomplete (" + runLabel(job) + "). No commit was pushed.\n\n" +
        truncate(message),
      baseToken,
    );
    return;
  }

  if (result.runStatus !== "success") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "failed");
    await createPullRequestComment(job.repository, job.pullNumber,
      "Run failed (" + runLabel(job) + "): " + truncate(result.error || "OpenCode failed"), baseToken);
    return;
  }

  const changed = await hasChanges(job.repositoryDir);
  const decision = finalizationDecision({
    runStatus: result.runStatus,
    allowEdits: job.allowEdits,
    changed,
  });

  if (decision === "blocked-read-only") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "blocked-read-only");
    await createPullRequestComment(job.repository, job.pullNumber,
      "Run blocked (" + runLabel(job) + "). The selected mode is read-only but the agent produced tracked-file changes, so nothing was pushed.\n\n" + truncate(result.output), baseToken);
    return;
  }

  if (decision === "completed-no-changes") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "completed-no-changes");
    await createPullRequestComment(job.repository, job.pullNumber,
      "Completed (" + runLabel(job) + "). No repository changes were produced.\n\n" + truncate(result.output), baseToken);
    return;
  }

  if (decision !== "push") {
    throw new Error("Unexpected finalizer decision: " + decision);
  }

  const latest = await getPullRequest(job.repository, job.pullNumber, baseToken);
  if (latest.head?.sha !== job.expectedHead) throw new Error("PR head changed while the GitHub Actions worker was running; retry the command");

  const headToken = await createRepositoryInstallationToken(
    config,
    job.headRepository,
    { contents: "write", workflows: "write" },
  );
  const commitSha = await commitChanges(job.repositoryDir, commitMessageForMode(job.mode));
  await pushHead({ token: headToken, repositoryDir: job.repositoryDir, remote: job.remote, branch: job.headBranch });
  const campaignState = await finishCampaign(commitSha, false);
  await updateCampaignStatus(campaignState, "pushed");
  await createPullRequestComment(job.repository, job.pullNumber,
    "Done (" + runLabel(job) + "). Pushed commit `" + commitSha.slice(0, 7) + "` to `" + job.headBranch + "`.\n\n" + truncate(result.output), baseToken);
}

try { await main(); } finally { await fs.rm(".oc-main-job", { recursive: true, force: true }); }
