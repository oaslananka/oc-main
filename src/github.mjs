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
            reject(new Error(message));
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
