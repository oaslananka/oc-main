import crypto from "node:crypto";
import https from "node:https";
import {
  abortMaintenanceCampaignIteration as abortCampaignStateIteration,
  beginMaintenanceCampaignIteration as beginCampaignStateIteration,
  completeMaintenanceCampaignIteration as completeCampaignStateIteration,
  createInitialMaintenanceCampaignState,
  isMaintenanceCampaignBranchName,
  readMaintenanceCampaignState,
  writeMaintenanceCampaignState,
} from "./campaign-state.mjs";
import {
  renderMaintenanceCampaignStatus,
  selectMaintenanceCampaignStatusComment,
} from "./campaign-status.mjs";
import { resolveMaintenancePolicy } from "./maintenance-policy.mjs";

const API_HOSTNAME = "api.github.com";
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5_000_000;

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

function appJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: appId, iat: now - 60, exp: now + 540 }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

export function apiPath(pathname) {
  const relative = String(pathname).replace(/^\/+/, "");
  if (!relative || relative.includes("\\") || relative.includes("://")) {
    throw new Error("Refusing invalid GitHub API path");
  }

  for (const segment of relative.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Refusing invalid GitHub API path encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new Error("Refusing GitHub API path traversal");
    }
  }

  return `/${relative}`;
}

function repositoryParts(repository) {
  const parts = String(repository).split("/");
  if (parts.length !== 2) {
    throw new Error("Invalid GitHub repository full name");
  }

  for (const part of parts) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      !/^[A-Za-z0-9_.-]+$/.test(part)
    ) {
      throw new Error("Invalid GitHub repository full name");
    }
  }
  return parts;
}

function repositoryPath(repository) {
  return repositoryParts(repository).map(encodeURIComponent).join("/");
}

export const FINALIZER_COMMENT_TOKEN_PERMISSIONS = Object.freeze({
  pull_requests: "write",
});

export const CAMPAIGN_CONTROL_TOKEN_PERMISSIONS = Object.freeze({
  contents: "read",
  pull_requests: "write",
});

export const MAINTENANCE_EVIDENCE_TOKEN_PERMISSIONS = Object.freeze({
  administration: "read",
  checks: "read",
  contents: "read",
  pull_requests: "read",
});

const TOKEN_PERMISSION_LEVELS = new Map([
  ["administration", new Set(["read"])],
  ["checks", new Set(["read"])],
  ["contents", new Set(["read", "write"])],
  ["issues", new Set(["write"])],
  ["pull_requests", new Set(["read", "write"])],
  ["workflows", new Set(["write"])],
]);

export function installationTokenRequestBody(repository, permissions) {
  const [, name] = repositoryParts(repository);
  const entries = Object.entries(permissions || {});
  if (!entries.length) {
    throw new Error("Scoped GitHub installation token requires explicit permissions");
  }

  const normalized = {};
  for (const [permission, level] of entries) {
    const allowed = TOKEN_PERMISSION_LEVELS.get(permission);
    if (!allowed?.has(level)) {
      throw new Error(
        "Unsupported GitHub installation token permission: " +
          permission +
          "=" +
          level,
      );
    }
    normalized[permission] = level;
  }

  return {
    repositories: [name],
    permissions: normalized,
  };
}

function positiveId(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return String(numeric);
}

function validatedApiPath(pathname) {
  const value = String(pathname || "");
  if (
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("://") ||
    /[\r\n]/.test(value)
  ) {
    throw new Error("Refusing invalid prevalidated GitHub API path");
  }
  return value;
}

async function request(
  pathname,
  { token, method = "GET", body, prevalidatedPath = false } = {},
) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "oc-main",
    ...(payload
      ? {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
        }
      : {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: API_HOSTNAME,
        port: 443,
        path: prevalidatedPath ? validatedApiPath(pathname) : apiPath(pathname),
        method,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        let size = 0;

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("GitHub API response exceeded the size limit"));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }

          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const message =
              typeof parsed === "object" && parsed?.message
                ? parsed.message
                : `GitHub API request failed (${status})`;
            const error = new Error(message);
            error.status = status;
            reject(error);
            return;
          }

          resolve(parsed);
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("GitHub API request timed out"));
    });
    req.on("error", reject);

    if (payload) req.write(payload);
    req.end();
  });
}

export async function createInstallationToken(
  config,
  installationId,
  requestBody,
) {
  const safeInstallationId = positiveId(installationId, "installation ID");
  const jwt = appJwt(config.githubAppId, config.githubPrivateKey);
  const result = await request(
    `app/installations/${safeInstallationId}/access_tokens`,
    {
      token: jwt,
      method: "POST",
      body: requestBody,
    },
  );
  if (!result?.token) throw new Error("GitHub installation token response is missing a token");
  return result.token;
}

export async function createRepositoryInstallationToken(
  config,
  repository,
  permissions,
) {
  const safeRepository = repositoryPath(repository);
  const jwt = appJwt(config.githubAppId, config.githubPrivateKey);
  const installation = await request(`repos/${safeRepository}/installation`, {
    token: jwt,
  });
  return createInstallationToken(
    config,
    installation.id,
    installationTokenRequestBody(repository, permissions),
  );
}

export async function dispatchRepositoryEvent(
  config,
  repository,
  eventType,
  clientPayload,
) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(eventType)) {
    throw new Error("Invalid repository dispatch event type");
  }

  const safeRepository = repositoryPath(repository);
  const token = await createRepositoryInstallationToken(config, repository, {
    contents: "write",
  });
  await request(`repos/${safeRepository}/dispatches`, {
    token,
    method: "POST",
    body: {
      event_type: eventType,
      client_payload: clientPayload,
    },
  });
}

export async function getPullRequest(repository, pullNumber, token) {
  const safeRepository = repositoryPath(repository);
  const safePullNumber = positiveId(pullNumber, "pull request number");
  return request(`repos/${safeRepository}/pulls/${safePullNumber}`, { token });
}

async function updatePullRequestBody(repository, pullNumber, body, token) {
  const safeRepository = repositoryPath(repository);
  const safePullNumber = positiveId(pullNumber, "pull request number");
  return request(`repos/${safeRepository}/pulls/${safePullNumber}`, {
    token,
    method: "PATCH",
    body: { body: String(body || "") },
  });
}

export async function createIssueComment(repository, issueNumber, body, token) {
  const safeRepository = repositoryPath(repository);
  const safeIssueNumber = positiveId(issueNumber, "issue number");
  return request(`repos/${safeRepository}/issues/${safeIssueNumber}/comments`, {
    token,
    method: "POST",
    body: { body },
  });
}

export async function createPullRequestComment(repository, pullNumber, body, token) {
  return createIssueComment(repository, pullNumber, body, token);
}

async function listIssueComments(repository, issueNumber, token) {
  const safeRepository = repositoryPath(repository);
  const safeIssueNumber = positiveId(issueNumber, "issue number");
  const comments = [];
  for (let page = 1; page <= 3; page += 1) {
    const rows = await request(
      `repos/${safeRepository}/issues/${safeIssueNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    const pageComments = Array.isArray(rows) ? rows : [];
    comments.push(...pageComments);
    if (pageComments.length < 100) return comments;
  }
  throw new Error(
    "Maintenance campaign status comment scan exceeded 300 comments",
  );
}

async function updateIssueComment(repository, commentId, body, token) {
  const safeRepository = repositoryPath(repository);
  const safeCommentId = positiveId(commentId, "comment ID");
  return request(
    `repos/${safeRepository}/issues/comments/${safeCommentId}`,
    {
      token,
      method: "PATCH",
      body: { body: String(body || "") },
    },
  );
}

export async function updateMaintenanceCampaignStatus(
  repository,
  pullNumber,
  { state, maxIterations, phase, evidence = null, workerRunId = null },
  token,
) {
  const body = renderMaintenanceCampaignStatus({
    state,
    maxIterations,
    phase,
    evidence,
    workerRunId,
  });
  const comments = await listIssueComments(repository, pullNumber, token);
  const existing = selectMaintenanceCampaignStatusComment(comments);
  if (existing) {
    return updateIssueComment(repository, existing.id, body, token);
  }
  return createPullRequestComment(repository, pullNumber, body, token);
}

export async function tryUpdateMaintenanceCampaignStatus(
  repository,
  pullNumber,
  status,
  token,
) {
  try {
    return await updateMaintenanceCampaignStatus(
      repository,
      pullNumber,
      status,
      token,
    );
  } catch (error) {
    console.error("maintenance campaign status update failed", error);
    return null;
  }
}

export function maintenanceCampaignBranchNames(issueNumber, commentId) {
  const issue = positiveId(issueNumber, "issue number");
  const comment = positiveId(commentId, "comment ID");
  const primary = `oc-maintenance-issue-${issue}-comment-${comment}`;
  return { primary, retry: `${primary}-retry` };
}

async function getRepository(repository, token) {
  const safeRepository = repositoryPath(repository);
  return request(`repos/${safeRepository}`, { token });
}

async function getGitReference(repository, branch, token) {
  const safeRepository = repositoryPath(repository);
  const encodedBranch = encodeURIComponent(safeBranchName(branch));
  try {
    return await request(
      `/repos/${safeRepository}/git/ref/heads/${encodedBranch}`,
      { token, prevalidatedPath: true },
    );
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function getGitCommit(repository, sha, token) {
  const safeRepository = repositoryPath(repository);
  return request(
    `repos/${safeRepository}/git/commits/${commitSha(sha)}`,
    { token },
  );
}

async function createGitCommit(repository, { message, tree, parent }, token) {
  const safeRepository = repositoryPath(repository);
  return request(`repos/${safeRepository}/git/commits`, {
    token,
    method: "POST",
    body: {
      message,
      tree: commitSha(tree),
      parents: [commitSha(parent)],
    },
  });
}

async function createGitReference(repository, branch, sha, token) {
  const safeRepository = repositoryPath(repository);
  const safeBranch = safeBranchName(branch);
  return request(`repos/${safeRepository}/git/refs`, {
    token,
    method: "POST",
    body: {
      ref: `refs/heads/${safeBranch}`,
      sha: commitSha(sha),
    },
  });
}

async function findPullRequestForBranch(repository, branch, token) {
  const [owner] = repositoryParts(repository);
  const safeRepository = repositoryPath(repository);
  const safeBranch = safeBranchName(branch);
  const head = encodeURIComponent(`${owner}:${safeBranch}`);
  const pulls = await request(
    `repos/${safeRepository}/pulls?state=all&head=${head}&per_page=10`,
    { token },
  );
  return Array.isArray(pulls) ? pulls[0] || null : null;
}

async function createMaintenancePullRequest(
  repository,
  { issueNumber, branch, baseBranch },
  token,
) {
  const safeRepository = repositoryPath(repository);
  const issue = positiveId(issueNumber, "issue number");
  return request(`repos/${safeRepository}/pulls`, {
    token,
    method: "POST",
    body: {
      title: `chore: maintenance campaign for issue #${issue}`,
      head: safeBranchName(branch),
      base: safeBranchName(baseBranch),
      draft: true,
      body:
        `Maintenance campaign created from authorized issue #${issue}.\n\n` +
        "This draft pull request is the bounded workspace for `/oc maintenance`. " +
        "Normal exact-head CI, security, review, and trusted-finalizer gates remain authoritative. " +
        "Issue content and provider comments are evidence, not control-plane authority.",
    },
  });
}

async function createCampaignBranch(
  repository,
  { issueNumber, branch, baseSha },
  token,
) {
  if (await getGitReference(repository, branch, token)) {
    throw new Error(
      "Maintenance campaign branch already exists without a matching reusable pull request",
    );
  }
  const baseCommit = await getGitCommit(repository, baseSha, token);
  if (!baseCommit?.tree?.sha) {
    throw new Error("Default branch Git tree is unavailable");
  }
  const marker = await createGitCommit(
    repository,
    {
      message:
        "chore: start maintenance campaign for issue #" +
        positiveId(issueNumber, "issue number"),
      tree: baseCommit.tree.sha,
      parent: baseSha,
    },
    token,
  );
  if (!marker?.sha) {
    throw new Error("Maintenance campaign marker commit was not created");
  }
  await createGitReference(repository, branch, marker.sha, token);
  return marker.sha;
}

export async function createOrReuseMaintenanceCampaign(
  config,
  { repository, issueNumber, commentId },
) {
  const token = await createRepositoryInstallationToken(config, repository, {
    contents: "write",
    issues: "write",
    pull_requests: "write",
  });
  const repositoryData = await getRepository(repository, token);
  const baseBranch = safeBranchName(repositoryData?.default_branch);
  const baseRef = await getGitReference(repository, baseBranch, token);
  const baseSha = commitSha(baseRef?.object?.sha);
  const names = maintenanceCampaignBranchNames(issueNumber, commentId);
  let branch = names.primary;
  let existingPull = await findPullRequestForBranch(repository, branch, token);
  if (existingPull?.state === "open") {
    assertReusableMaintenanceCampaign(
      existingPull,
      { issueNumber, commentId },
      config.workerDispatchSecret,
    );
    return { pullRequest: existingPull, branch, reused: true };
  }
  if (existingPull) {
    return { pullRequest: existingPull, branch, reused: true, terminal: true };
  }

  if (await getGitReference(repository, branch, token)) {
    branch = names.retry;
    existingPull = await findPullRequestForBranch(repository, branch, token);
    if (existingPull?.state === "open") {
      assertReusableMaintenanceCampaign(
        existingPull,
        { issueNumber, commentId },
        config.workerDispatchSecret,
      );
      return { pullRequest: existingPull, branch, reused: true };
    }
    if (existingPull) {
      return { pullRequest: existingPull, branch, reused: true, terminal: true };
    }
  }

  const markerSha = await createCampaignBranch(
    repository,
    { issueNumber, branch, baseSha },
    token,
  );
  let pullRequest = await createMaintenancePullRequest(
    repository,
    { issueNumber, branch, baseBranch },
    token,
  );
  const campaignState = createInitialMaintenanceCampaignState({
    issueNumber,
    commentId,
    pullNumber: pullRequest.number,
    headSha: markerSha,
  });
  pullRequest = await updatePullRequestBody(
    repository,
    pullRequest.number,
    writeMaintenanceCampaignState(
      pullRequest.body,
      campaignState,
      config.workerDispatchSecret,
    ),
    token,
  );
  await createIssueComment(
    repository,
    issueNumber,
    `Maintenance campaign initialized in draft PR #${pullRequest.number}. ` +
      "The trusted worker will continue there; normal repository gates remain in force.",
    token,
  );

  return { pullRequest, branch, reused: false };
}

function assertReusableMaintenanceCampaign(
  pullRequest,
  { issueNumber, commentId },
  secret,
) {
  const state = readMaintenanceCampaignState(pullRequest?.body, secret);
  if (!state) {
    throw new Error("Existing maintenance campaign pull request has no trusted state");
  }
  if (
    state.source_issue !== Number(issueNumber) ||
    state.source_comment_id !== Number(commentId) ||
    state.campaign_pr !== Number(pullRequest.number)
  ) {
    throw new Error("Existing maintenance campaign identity does not match source command");
  }
  return state;
}

function campaignStateForPullRequest(pullRequest, secret) {
  const state = readMaintenanceCampaignState(pullRequest?.body, secret);
  if (!state) {
    if (isMaintenanceCampaignBranchName(pullRequest?.head?.ref)) {
      throw new Error(
        "Maintenance campaign branch is missing trusted campaign state",
      );
    }
    return null;
  }
  if (state.campaign_pr !== Number(pullRequest?.number)) {
    throw new Error("Maintenance campaign pull request identity is invalid");
  }
  return state;
}

export async function beginMaintenanceCampaignDispatch(
  config,
  { repository, pullNumber, commentId, nowSeconds = Math.floor(Date.now() / 1000) },
) {
  const token = await createRepositoryInstallationToken(
    config,
    repository,
    CAMPAIGN_CONTROL_TOKEN_PERMISSIONS,
  );
  const pullRequest = await getPullRequest(repository, pullNumber, token);
  const state = campaignStateForPullRequest(
    pullRequest,
    config.workerDispatchSecret,
  );
  if (!state) return { campaign: false, dispatch: true };
  if (pullRequest.state !== "open") {
    return { campaign: true, dispatch: false, reason: "closed" };
  }
  if (!pullRequest.head?.sha || !pullRequest.base?.sha) {
    throw new Error("Maintenance campaign pull request head/base is unavailable");
  }

  const policyText = await getMaintenancePolicyText(
    repository,
    pullRequest.base.sha,
    token,
  );
  const policyResult = resolveMaintenancePolicy(
    policyText,
    "base@" +
      String(pullRequest.base.sha).slice(0, 12) +
      ":.github/maintenance-policy.yml",
  );
  const maxIterations = policyResult.policy.campaign.max_iterations;
  const transition = beginCampaignStateIteration(state, {
    commentId,
    currentHead: pullRequest.head.sha,
    maxIterations,
    nowSeconds,
  });

  if (transition.action === "dispatch" || transition.action === "limit") {
    await updatePullRequestBody(
      repository,
      pullNumber,
      writeMaintenanceCampaignState(
        pullRequest.body,
        transition.state,
        config.workerDispatchSecret,
      ),
      token,
    );
    await tryUpdateMaintenanceCampaignStatus(
      repository,
      pullNumber,
      {
        state: transition.state,
        maxIterations,
        phase: transition.action === "limit" ? "terminal" : "dispatching",
      },
      token,
    );
  }

  return {
    campaign: true,
    dispatch: transition.action === "dispatch",
    reason: transition.action,
    iteration: transition.state.iteration,
    maxIterations,
    expectedHead: transition.state.expected_head,
    sourceIssue: transition.state.source_issue,
  };
}

export async function abortMaintenanceCampaignDispatch(
  config,
  {
    repository,
    pullNumber,
    commentId,
    iteration,
    expectedHead,
    maxIterations,
  },
) {
  const token = await createRepositoryInstallationToken(
    config,
    repository,
    CAMPAIGN_CONTROL_TOKEN_PERMISSIONS,
  );
  const pullRequest = await getPullRequest(repository, pullNumber, token);
  const state = campaignStateForPullRequest(
    pullRequest,
    config.workerDispatchSecret,
  );
  if (!state) return false;
  const next = abortCampaignStateIteration(state, {
    commentId,
    iteration,
    expectedHead,
  });
  await updatePullRequestBody(
    repository,
    pullNumber,
    writeMaintenanceCampaignState(
      pullRequest.body,
      next,
      config.workerDispatchSecret,
    ),
    token,
  );
  await tryUpdateMaintenanceCampaignStatus(
    repository,
    pullNumber,
    {
      state: next,
      maxIterations,
      phase: "dispatch-failed",
    },
    token,
  );
  return true;
}

export async function completeMaintenanceCampaignDispatch(
  repository,
  {
    pullNumber,
    commentId,
    iteration,
    expectedHead,
    newHead,
    terminal = false,
  },
  token,
  secret,
) {
  const pullRequest = await getPullRequest(repository, pullNumber, token);
  const state = campaignStateForPullRequest(pullRequest, secret);
  if (!state) return null;
  if (pullRequest.state !== "open") {
    throw new Error("Maintenance campaign pull request is not open");
  }
  if (pullRequest.head?.sha !== String(newHead || "").toLowerCase()) {
    throw new Error("Maintenance campaign head changed before state completion");
  }
  const next = completeCampaignStateIteration(state, {
    commentId,
    iteration,
    expectedHead,
    newHead,
    terminal,
  });
  await updatePullRequestBody(
    repository,
    pullNumber,
    writeMaintenanceCampaignState(pullRequest.body, next, secret),
    token,
  );
  return next;
}

function commitSha(value) {
  const sha = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Invalid GitHub commit SHA");
  return sha.toLowerCase();
}

function safeBranchName(value) {
  const branch = String(value || "").trim();
  const segments = branch.split("/");
  if (
    !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("//") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".lock"),
    )
  ) {
    throw new Error("Branch name is not supported for required-check discovery");
  }
  return branch;
}

export function requiredChecksApiPaths(repository, branch) {
  const safeRepository = repositoryPath(repository);
  const encodedBranch = encodeURIComponent(safeBranchName(branch));
  return {
    rules: `/repos/${safeRepository}/rules/branches/${encodedBranch}`,
    protection:
      `/repos/${safeRepository}/branches/${encodedBranch}/protection/required_status_checks`,
  };
}

export function openPullRequestsApiPath(repository, page = 1) {
  const safeRepository = repositoryPath(repository);
  const number = Number(page);
  if (!Number.isSafeInteger(number) || number < 1 || number > 3) {
    throw new Error("Invalid open pull request page");
  }
  return (
    "/repos/" +
    safeRepository +
    "/pulls?state=open&sort=created&direction=asc&per_page=100&page=" +
    number
  );
}

export async function listOpenPullRequests(repository, token) {
  const pulls = [];
  for (let page = 1; page <= 3; page += 1) {
    const result = await request(
      openPullRequestsApiPath(repository, page),
      { token, prevalidatedPath: true },
    );
    const rows = Array.isArray(result) ? result : [];
    pulls.push(...rows);
    if (rows.length < 100) break;
  }
  return pulls.slice(0, 300);
}

export async function listCheckRunsForCommit(repository, sha, token) {
  const safeRepository = repositoryPath(repository);
  const safeSha = commitSha(sha);
  const runs = [];
  for (let page = 1; page <= 3; page += 1) {
    const result = await request(
      `repos/${safeRepository}/commits/${safeSha}/check-runs?per_page=100&page=${page}`,
      { token },
    );
    const pageRuns = Array.isArray(result?.check_runs) ? result.check_runs : [];
    runs.push(...pageRuns);
    if (pageRuns.length < 100 || runs.length >= Number(result?.total_count || 0)) break;
  }
  return runs.slice(0, 300);
}

export async function getMaintenancePolicyText(repository, sha, token) {
  const safeRepository = repositoryPath(repository);
  const safeSha = commitSha(sha);
  try {
    const result = await request(
      `repos/${safeRepository}/contents/.github/maintenance-policy.yml?ref=${safeSha}`,
      { token },
    );
    if (
      !result ||
      Array.isArray(result) ||
      result.type !== "file" ||
      result.encoding !== "base64" ||
      typeof result.content !== "string"
    ) {
      throw new Error("Maintenance policy response is not a base64 file");
    }
    return Buffer.from(result.content.replace(/\s+/g, ""), "base64").toString("utf8");
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

function addRequiredChecksFromRules(names, rules) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule?.parameters?.required_status_checks || []) {
      const name = String(check?.context || "").trim();
      if (name) names.add(name);
    }
  }
}

export async function getRequiredStatusCheckNames(repository, branch, token) {
  const paths = requiredChecksApiPaths(repository, branch);
  const names = new Set();
  const sources = [];
  const warnings = [];

  try {
    const rules = await request(
      paths.rules,
      { token, prevalidatedPath: true },
    );
    addRequiredChecksFromRules(names, rules);
    sources.push("repository-rules");
  } catch (error) {
    warnings.push(
      "Repository rules unavailable: " + String(error?.message || error),
    );
  }

  try {
    const protection = await request(
      paths.protection,
      { token, prevalidatedPath: true },
    );
    for (const context of protection?.contexts || []) {
      const name = String(context || "").trim();
      if (name) names.add(name);
    }
    for (const check of protection?.checks || []) {
      const name = String(check?.context || "").trim();
      if (name) names.add(name);
    }
    sources.push("branch-protection");
  } catch (error) {
    if (error?.status !== 404) {
      warnings.push(
        "Legacy branch protection required checks unavailable: " +
          String(error?.message || error),
      );
    }
  }

  return {
    names: [...names].sort((a, b) => a.localeCompare(b)),
    sources,
    warnings,
  };
}

