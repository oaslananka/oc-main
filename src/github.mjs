import crypto from "node:crypto";
import https from "node:https";

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

function repositoryPath(repository) {
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

  return parts.map(encodeURIComponent).join("/");
}

function positiveId(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return String(numeric);
}

async function request(pathname, { token, method = "GET", body } = {}) {
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
        path: apiPath(pathname),
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

export async function createInstallationToken(config, installationId) {
  const safeInstallationId = positiveId(installationId, "installation ID");
  const jwt = appJwt(config.githubAppId, config.githubPrivateKey);
  const result = await request(
    `app/installations/${safeInstallationId}/access_tokens`,
    {
      token: jwt,
      method: "POST",
    },
  );
  return result.token;
}

export async function createRepositoryInstallationToken(config, repository) {
  const safeRepository = repositoryPath(repository);
  const jwt = appJwt(config.githubAppId, config.githubPrivateKey);
  const installation = await request(`repos/${safeRepository}/installation`, {
    token: jwt,
  });
  return createInstallationToken(config, installation.id);
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
  const token = await createRepositoryInstallationToken(config, repository);
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

export async function createPullRequestComment(repository, pullNumber, body, token) {
  const safeRepository = repositoryPath(repository);
  const safePullNumber = positiveId(pullNumber, "pull request number");
  return request(`repos/${safeRepository}/issues/${safePullNumber}/comments`, {
    token,
    method: "POST",
    body: { body },
  });
}

function commitSha(value) {
  const sha = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Invalid GitHub commit SHA");
  return sha.toLowerCase();
}

function simpleBranchName(value) {
  const branch = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(branch)) {
    throw new Error("Branch name is not supported for required-check discovery");
  }
  return branch;
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
    return Buffer.from(result.content.replace(/\\n/g, ""), "base64").toString("utf8");
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
  const safeRepository = repositoryPath(repository);
  const safeBranch = simpleBranchName(branch);
  const names = new Set();
  const sources = [];
  const warnings = [];

  try {
    const rules = await request(
      `repos/${safeRepository}/rules/branches/${encodeURIComponent(safeBranch)}`,
      { token },
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
      `repos/${safeRepository}/branches/${encodeURIComponent(safeBranch)}/protection/required_status_checks`,
      { token },
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
    warnings.push(
      "Legacy branch protection required checks unavailable: " +
        String(error?.message || error),
    );
  }

  return {
    names: [...names].sort(),
    sources,
    warnings,
  };
}

