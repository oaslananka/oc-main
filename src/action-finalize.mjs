import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import {
  FINALIZER_COMMENT_TOKEN_PERMISSIONS,
  MAINTENANCE_READ_TOKEN_PERMISSIONS,
  completeMaintenanceCampaignDispatch,
  createPullRequestComment,
  createRepositoryInstallationToken,
  getPullRequest,
  tryUpdateMaintenanceCampaignStatus,
} from "./github.mjs";
import { commitChanges, hasChanges, pushHead } from "./git.mjs";
import { observeMaintenanceCampaignCurrentHead } from "./campaign-observer.mjs";
import { finalizationDecision } from "./finalize-policy.mjs";
import { renderRunComment } from "./comment-report.mjs";
import { readResult, readVerifiedJob } from "./action-state.mjs";

function commitMessageForMode(mode) {
  if (mode === "fix") return "fix: apply oc-main requested change";
  if (mode === "refactor") return "refactor: apply oc-main requested change";
  if (mode === "ci" || mode === "release") return "ci: apply oc-main requested change";
  if (mode === "maintenance") return "chore: apply maintenance remediation";
  return "chore: apply oc-main requested change";
}

async function main() {
  const config = loadConfig();
  const job = await readVerifiedJob(config.workerDispatchSecret);
  const result = await readResult();
  function publicComment(outcome, extra = {}) {
    return renderRunComment({
      outcome,
      job,
      repository: config.controlRepository,
      runId: process.env.GITHUB_RUN_ID,
      ...extra,
    });
  }
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

  async function observeCampaign(state) {
    if (!state) return;
    try {
      const readToken = await createRepositoryInstallationToken(
        config,
        job.repository,
        MAINTENANCE_READ_TOKEN_PERMISSIONS,
      );
      await observeMaintenanceCampaignCurrentHead({
        repository: job.repository,
        pullNumber: job.pullNumber,
        state,
        readToken,
        statusToken: baseToken,
        campaignStateSecret: config.workerDispatchSecret,
        workerRunId: process.env.GITHUB_RUN_ID || null,
      });
    } catch (error) {
      console.error("maintenance campaign observation failed", error);
    }
  }

  if (result.runStatus === "incomplete") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "incomplete");
    await createPullRequestComment(
      job.repository,
      job.pullNumber,
      publicComment("incomplete"),
      baseToken,
    );
    await observeCampaign(campaignState);
    return;
  }

  if (result.runStatus !== "success") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "failed");
    await createPullRequestComment(job.repository, job.pullNumber,
      publicComment("failed", { error: result.error }), baseToken);
    await observeCampaign(campaignState);
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
      publicComment("blocked-read-only"), baseToken);
    await observeCampaign(campaignState);
    return;
  }

  if (decision === "completed-no-changes") {
    const campaignState = await finishCampaign(job.expectedHead, false);
    await updateCampaignStatus(campaignState, "completed-no-changes");
    await createPullRequestComment(job.repository, job.pullNumber,
      publicComment("completed-no-changes", { output: result.output }), baseToken);
    await observeCampaign(campaignState);
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
    publicComment("pushed", { commitSha }), baseToken);
  await observeCampaign(campaignState);
}

try { await main(); } finally { await fs.rm(".oc-main-job", { recursive: true, force: true }); }
