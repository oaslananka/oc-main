import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { verifySignedJob } from "./dispatch.mjs";
import { createRepositoryInstallationToken, getPullRequest } from "./github.mjs";
import { clonePullRequestHead } from "./git.mjs";
import { buildAgentPrompt } from "./opencode.mjs";
import { writeJob } from "./action-state.mjs";

const config = loadConfig();
const payload = verifySignedJob(JSON.parse(process.env.OC_JOB_PAYLOAD || "{}"), config.workerDispatchSecret);

if (!config.allowedUserIds.has(payload.comment_user_id)) throw new Error("Worker payload user is not allowlisted");
if (!config.allowedModels.has(payload.model)) throw new Error("Worker payload model is not allowlisted");

await fs.rm(".oc-main-job", { recursive: true, force: true });
await fs.mkdir(".oc-main-job", { recursive: true });

const baseToken = await createRepositoryInstallationToken(config, payload.repository);
const pr = await getPullRequest(payload.repository, payload.pull_number, baseToken);
if (pr.state !== "open") throw new Error("Pull request is not open");
if (!pr.head?.repo?.full_name || !pr.head?.ref || !pr.head?.sha) throw new Error("Pull request head repository is unavailable");

const headRepository = pr.head.repo.full_name;
const headBranch = pr.head.ref;
const expectedHead = pr.head.sha;
const headToken = await createRepositoryInstallationToken(config, headRepository);
const repositoryDir = path.resolve(".oc-main-job/repo");
const { initialHead, remote } = await clonePullRequestHead({
  token: headToken, repository: headRepository, branch: headBranch, destination: repositoryDir,
});
if (initialHead !== expectedHead) throw new Error("Checked-out PR head does not match GitHub; retry the command");

const homeDir = path.resolve(".oc-main-job/home");
await fs.mkdir(".oc-main-job/home/.config", { recursive: true });
await fs.cp("runtime/opencode", ".oc-main-job/home/.config/opencode", { recursive: true });

const prompt = buildAgentPrompt({
  repository: payload.repository,
  pullNumber: payload.pull_number,
  task: payload.prompt,
  reviewContext: payload.review_context,
  mode: payload.mode,
  risk: payload.risk,
  capabilities: payload.capabilities,
  allowEdits: payload.allow_edits,
});

await writeJob({
  repository: payload.repository, pullNumber: payload.pull_number, commentId: payload.comment_id,
  model: payload.model, mode: payload.mode, agent: payload.agent, risk: payload.risk,
  allowEdits: payload.allow_edits, capabilities: payload.capabilities, prompt,
  headRepository, headBranch, expectedHead, repositoryDir, homeDir, remote,
  opencodeBin: config.opencodeBin, opencodeTimeoutMs: config.opencodeTimeoutMs,
}, config.workerDispatchSecret);

console.log("Prepared " + payload.repository + "#" + payload.pull_number + " at " + expectedHead.slice(0, 12) +
  " mode=" + payload.mode + " agent=" + payload.agent + " risk=" + payload.risk);
