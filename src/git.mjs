import path from "node:path";
import { runProcess } from "./process.mjs";

function githubAuthEnv(token) {
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
  };
}

async function git(args, options = {}) {
  return runProcess("git", ["-c", "core.hooksPath=/dev/null", ...args], options);
}

export async function clonePullRequestHead({
  token,
  repository,
  branch,
  destination,
  authorName = "oc-main[bot]",
  authorEmail = "oc-main[bot]@users.noreply.github.com",
}) {
  const remote = `https://github.com/${repository}.git`;
  await runProcess(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "clone",
      "--single-branch",
      "--branch",
      branch,
      remote,
      destination,
    ],
    { env: githubAuthEnv(token), timeoutMs: 300_000 },
  );

  await git(["config", "user.name", authorName], { cwd: destination });
  await git(["config", "user.email", authorEmail], { cwd: destination });

  const head = await git(["rev-parse", "HEAD"], { cwd: destination });
  return { initialHead: head.stdout.trim(), remote };
}

export async function hasChanges(repositoryDir) {
  const result = await git(["status", "--porcelain"], { cwd: repositoryDir });
  return result.stdout.trim().length > 0;
}

export async function commitChanges(repositoryDir, message) {
  await git(["add", "-A"], { cwd: repositoryDir });
  await git(["diff", "--cached", "--check"], { cwd: repositoryDir });
  await git(["commit", "-m", message], { cwd: repositoryDir, timeoutMs: 120_000 });
  const head = await git(["rev-parse", "HEAD"], { cwd: repositoryDir });
  return head.stdout.trim();
}

export async function pushHead({ token, repositoryDir, remote, branch }) {
  await git(["remote", "set-url", "origin", remote], { cwd: repositoryDir });
  await git(["push", "origin", `HEAD:${branch}`], {
    cwd: repositoryDir,
    env: githubAuthEnv(token),
    timeoutMs: 300_000,
  });
}

export function displayBranch(repository, branch) {
  return `${repository}:${branch}`;
}

export function repositoryDirectory(jobDir) {
  return path.join(jobDir, "repo");
}
