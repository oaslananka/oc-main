import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { createPullRequestComment, createRepositoryInstallationToken, getPullRequest } from "./github.mjs";
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
  return "chore: apply oc-main requested change";
}

function runLabel(job) {
  return "mode `" + job.mode + "`, agent `" + job.agent + "`, model `" + job.model + "`, risk `" + job.risk + "`";
}

async function main() {
  const config = loadConfig();
  const job = await readVerifiedJob(config.workerDispatchSecret);
  const result = await readResult();
  const baseToken = await createRepositoryInstallationToken(config, job.repository);

  if (result.runStatus !== "success") {
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
    await createPullRequestComment(job.repository, job.pullNumber,
      "Run blocked (" + runLabel(job) + "). The selected mode is read-only but the agent produced tracked-file changes, so nothing was pushed.\n\n" + truncate(result.output), baseToken);
    return;
  }

  if (decision === "completed-no-changes") {
    await createPullRequestComment(job.repository, job.pullNumber,
      "Completed (" + runLabel(job) + "). No repository changes were produced.\n\n" + truncate(result.output), baseToken);
    return;
  }

  if (decision !== "push") {
    throw new Error("Unexpected finalizer decision: " + decision);
  }

  const latest = await getPullRequest(job.repository, job.pullNumber, baseToken);
  if (latest.head?.sha !== job.expectedHead) throw new Error("PR head changed while the GitHub Actions worker was running; retry the command");

  const headToken = await createRepositoryInstallationToken(config, job.headRepository);
  const commitSha = await commitChanges(job.repositoryDir, commitMessageForMode(job.mode));
  await pushHead({ token: headToken, repositoryDir: job.repositoryDir, remote: job.remote, branch: job.headBranch });
  await createPullRequestComment(job.repository, job.pullNumber,
    "Done (" + runLabel(job) + "). Pushed commit `" + commitSha.slice(0, 7) + "` to `" + job.headBranch + "`.\n\n" + truncate(result.output), baseToken);
}

try { await main(); } finally { await fs.rm(".oc-main-job", { recursive: true, force: true }); }
