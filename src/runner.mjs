import fs from "node:fs/promises";
import path from "node:path";
import {
  createInstallationToken,
  createPullRequestComment,
  getPullRequest,
} from "./github.mjs";
import {
  clonePullRequestHead,
  commitChanges,
  hasChanges,
  pushHead,
  repositoryDirectory,
} from "./git.mjs";
import {
  buildAgentPrompt,
  cleanOpenCodeOutput,
  opencodeConfigHome,
  runOpenCode,
} from "./opencode.mjs";

const RUNTIME_CONFIG = path.resolve("runtime", "opencode");

function truncate(text, limit = 5000) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[output truncated]`;
}

function publicError(error, workRoot) {
  return String(error?.message || error || "Unknown error")
    .replaceAll(workRoot, "[workspace]")
    .replace(/https:\/\/[^\s@]+@github\.com/gi, "https://github.com")
    .slice(0, 2000);
}

async function prepareAgentHome(jobDir) {
  const homeDir = path.join(jobDir, "home");
  const configDir = opencodeConfigHome(homeDir);
  await fs.mkdir(path.dirname(configDir), { recursive: true });
  await fs.cp(RUNTIME_CONFIG, configDir, { recursive: true });
  return homeDir;
}

export async function runPullRequestJob({ config, trigger, command }) {
  await fs.mkdir(config.workRoot, { recursive: true });
  const jobDir = await fs.mkdtemp(path.join(config.workRoot, "job-"));
  let token = null;

  try {
    token = await createInstallationToken(config, trigger.installationId);
    const pr = await getPullRequest(trigger.repository, trigger.pullNumber, token);

    if (pr.state !== "open") throw new Error("Pull request is not open");
    if (!pr.head?.repo?.full_name || !pr.head?.ref || !pr.head?.sha) {
      throw new Error("Pull request head repository is unavailable");
    }

    const headRepository = pr.head.repo.full_name;
    const headBranch = pr.head.ref;
    const expectedHead = pr.head.sha;
    const repoDir = repositoryDirectory(jobDir);
    const { initialHead, remote } = await clonePullRequestHead({
      token,
      repository: headRepository,
      branch: headBranch,
      destination: repoDir,
    });

    if (initialHead !== expectedHead) {
      throw new Error("Checked-out PR head does not match GitHub; retry the command");
    }

    const homeDir = await prepareAgentHome(jobDir);
    const prompt = buildAgentPrompt({
      repository: trigger.repository,
      pullNumber: trigger.pullNumber,
      task: command.prompt,
      reviewContext: trigger.reviewContext,
    });

    const result = await runOpenCode({
      repositoryDir: repoDir,
      homeDir,
      workRoot: config.workRoot,
      opencodeBin: config.opencodeBin,
      opencodeWorkerImage: config.opencodeWorkerImage,
      dockerSocket: config.dockerSocket,
      model: command.model,
      prompt,
      sandboxMode: config.sandboxMode,
      timeoutMs: config.opencodeTimeoutMs,
    });

    const summary = truncate(cleanOpenCodeOutput(result.stdout) || "Completed.");
    const changed = await hasChanges(repoDir);

    if (!changed) {
      await createPullRequestComment(
        trigger.repository,
        trigger.pullNumber,
        `Completed. No repository changes were produced.\n\n${summary}`,
        token,
      );
      return;
    }

    const latest = await getPullRequest(trigger.repository, trigger.pullNumber, token);
    if (latest.head?.sha !== expectedHead) {
      throw new Error("PR head changed while the run was in progress; retry the command");
    }

    const commitSha = await commitChanges(repoDir, "Apply requested change");
    await pushHead({
      token,
      repositoryDir: repoDir,
      remote,
      branch: headBranch,
    });

    await createPullRequestComment(
      trigger.repository,
      trigger.pullNumber,
      `Done. Pushed commit \`${commitSha.slice(0, 7)}\` to \`${headBranch}\`.\n\n${summary}`,
      token,
    );
  } catch (error) {
    console.error(
      `run failed for ${trigger.repository}#${trigger.pullNumber}:`,
      publicError(error, config.workRoot),
    );
    if (token) {
      try {
        await createPullRequestComment(
          trigger.repository,
          trigger.pullNumber,
          `Run failed: ${publicError(error, config.workRoot)}`,
          token,
        );
      } catch (commentError) {
        console.error("failed to post error comment", commentError);
      }
    }
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}
