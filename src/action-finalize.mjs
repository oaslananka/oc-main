import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import {
  createPullRequestComment,
  createRepositoryInstallationToken,
  getPullRequest,
} from "./github.mjs";
import {
  commitChanges,
  hasChanges,
  pushHead,
} from "./git.mjs";
import {
  actionWorkRoot,
  readResult,
  readVerifiedJob,
} from "./action-state.mjs";

function truncate(text, limit = 5000) {
  const value = String(text || "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[output truncated]`;
}

async function main() {
  const config = loadConfig();
  const job = await readVerifiedJob(config.workerDispatchSecret);
  const result = await readResult();
  const baseToken = await createRepositoryInstallationToken(
    config,
    job.repository,
  );

  if (result.runStatus !== "success") {
    await createPullRequestComment(
      job.repository,
      job.pullNumber,
      `Run failed: ${truncate(result.error || "OpenCode failed")}`,
      baseToken,
    );
    return;
  }

  const changed = await hasChanges(job.repositoryDir);
  if (!changed) {
    await createPullRequestComment(
      job.repository,
      job.pullNumber,
      `Completed. No repository changes were produced.\n\n${truncate(result.output)}`,
      baseToken,
    );
    return;
  }

  const latest = await getPullRequest(
    job.repository,
    job.pullNumber,
    baseToken,
  );
  if (latest.head?.sha !== job.expectedHead) {
    throw new Error(
      "PR head changed while the GitHub Actions worker was running; retry the command",
    );
  }

  const headToken = await createRepositoryInstallationToken(
    config,
    job.headRepository,
  );
  const commitSha = await commitChanges(
    job.repositoryDir,
    "Apply requested change",
  );
  await pushHead({
    token: headToken,
    repositoryDir: job.repositoryDir,
    remote: job.remote,
    branch: job.headBranch,
  });

  await createPullRequestComment(
    job.repository,
    job.pullNumber,
    `Done. Pushed commit \`${commitSha.slice(0, 7)}\` to \`${job.headBranch}\`.\n\n${truncate(result.output)}`,
    baseToken,
  );
}

try {
  await main();
} finally {
  await fs.rm(actionWorkRoot(), { recursive: true, force: true });
}
