import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { verifySignedJob } from "./dispatch.mjs";
import {
  createRepositoryInstallationToken,
  getPullRequest,
} from "./github.mjs";
import { clonePullRequestHead } from "./git.mjs";
import {
  buildAgentPrompt,
  opencodeConfigHome,
} from "./opencode.mjs";
import { actionWorkRoot, writeJob } from "./action-state.mjs";

const RUNTIME_CONFIG = path.resolve("runtime", "opencode");

const config = loadConfig();
const payload = verifySignedJob(
  JSON.parse(process.env.OC_JOB_PAYLOAD || "{}"),
  config.workerDispatchSecret,
);

if (!config.allowedUserIds.has(payload.comment_user_id)) {
  throw new Error("Worker payload user is not allowlisted");
}
if (!config.allowedModels.has(payload.model)) {
  throw new Error("Worker payload model is not allowlisted");
}

const workRoot = actionWorkRoot();
await fs.rm(workRoot, { recursive: true, force: true });
await fs.mkdir(workRoot, { recursive: true });

const baseToken = await createRepositoryInstallationToken(
  config,
  payload.repository,
);
const pr = await getPullRequest(
  payload.repository,
  payload.pull_number,
  baseToken,
);

if (pr.state !== "open") throw new Error("Pull request is not open");
if (!pr.head?.repo?.full_name || !pr.head?.ref || !pr.head?.sha) {
  throw new Error("Pull request head repository is unavailable");
}

const headRepository = pr.head.repo.full_name;
const headBranch = pr.head.ref;
const expectedHead = pr.head.sha;
const headToken = await createRepositoryInstallationToken(
  config,
  headRepository,
);

const repositoryDir = path.join(workRoot, "repo");
const { initialHead, remote } = await clonePullRequestHead({
  token: headToken,
  repository: headRepository,
  branch: headBranch,
  destination: repositoryDir,
});

if (initialHead !== expectedHead) {
  throw new Error("Checked-out PR head does not match GitHub; retry the command");
}

const homeDir = path.join(workRoot, "home");
const opencodeConfigDir = opencodeConfigHome(homeDir);
await fs.mkdir(path.dirname(opencodeConfigDir), { recursive: true });
await fs.cp(RUNTIME_CONFIG, opencodeConfigDir, { recursive: true });

const prompt = buildAgentPrompt({
  repository: payload.repository,
  pullNumber: payload.pull_number,
  task: payload.prompt,
  reviewContext: payload.review_context,
});

await writeJob(
  {
    repository: payload.repository,
    pullNumber: payload.pull_number,
    commentId: payload.comment_id,
    model: payload.model,
    prompt,
    headRepository,
    headBranch,
    expectedHead,
    repositoryDir,
    homeDir,
    remote,
    opencodeBin: config.opencodeBin,
    opencodeTimeoutMs: config.opencodeTimeoutMs,
  },
  config.workerDispatchSecret,
);

console.log(
  `Prepared ${payload.repository}#${payload.pull_number} at ${expectedHead.slice(0, 12)}`,
);
