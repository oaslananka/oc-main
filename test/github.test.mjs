import assert from "node:assert/strict";
import test from "node:test";
import { CAMPAIGN_CONTROL_TOKEN_PERMISSIONS, FINALIZER_COMMENT_TOKEN_PERMISSIONS, FINALIZER_HEAD_CONVERGENCE_ATTEMPTS, FINALIZER_HEAD_CONVERGENCE_DELAY_MS, MAINTENANCE_READ_TOKEN_PERMISSIONS, apiPath, installationTokenRequestBody, maintenanceCampaignBranchNames, openPullRequestsApiPath, requiredChecksApiPaths, waitForPullRequestHeadAfterPush } from "../src/github.mjs";

test("apiPath produces a relative GitHub API path", () => {
  assert.equal(
    apiPath("repos/owner/repo/pulls/1"),
    "/repos/owner/repo/pulls/1",
  );
});

test("apiPath rejects path traversal", () => {
  assert.throws(
    () => apiPath("repos/owner/../issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiPath("repos/owner/%2e%2e/issues"),
    /path traversal/,
  );
  assert.throws(
    () => apiPath("repos/owner/%2Fadmin"),
    /path traversal/,
  );
});

test("apiPath rejects absolute URLs", () => {
  assert.throws(
    () => apiPath("https://example.com/anything"),
    /invalid GitHub API path/,
  );
});

test("required-check discovery safely encodes slash branch names", () => {
  assert.deepEqual(requiredChecksApiPaths("owner/repo", "feature/maintenance-v1"), {
    rules: "/repos/owner/repo/rules/branches/feature%2Fmaintenance-v1",
    protection:
      "/repos/owner/repo/branches/feature%2Fmaintenance-v1/protection/required_status_checks",
  });
});

test("required-check discovery rejects unsafe branch names", () => {
  for (const branch of [
    "../main",
    "feature//oops",
    "/main",
    "main/",
    "refs/heads/../main",
    "feature@{1}",
    "locks.lock",
  ]) {
    assert.throws(
      () => requiredChecksApiPaths("owner/repo", branch),
      /Branch name is not supported/,
      branch,
    );
  }
});

test("installation tokens are scoped to one repository and explicit permissions", () => {
  assert.deepEqual(
    installationTokenRequestBody("owner/repo", {
      contents: "read",
      pull_requests: "read",
    }),
    {
      repositories: ["repo"],
      permissions: {
        contents: "read",
        pull_requests: "read",
      },
    },
  );
});

test("installation token policy rejects unscoped or broad permissions", () => {
  assert.throws(
    () => installationTokenRequestBody("owner/repo", {}),
    /requires explicit permissions/,
  );
  assert.throws(
    () =>
      installationTokenRequestBody("owner/repo", {
        secrets: "write",
      }),
    /Unsupported GitHub installation token permission/,
  );
  assert.throws(
    () =>
      installationTokenRequestBody("owner/repo", {
        administration: "write",
      }),
    /Unsupported GitHub installation token permission/,
  );
});

test("maintenance campaign branch names are bounded and deterministic", () => {
  assert.deepEqual(maintenanceCampaignBranchNames(17, 101), {
    primary: "oc-maintenance-issue-17-comment-101",
    retry: "oc-maintenance-issue-17-comment-101-retry",
  });
});

test("installation token policy permits campaign pull request writes", () => {
  assert.deepEqual(
    installationTokenRequestBody("owner/repo", {
      contents: "write",
      issues: "write",
      pull_requests: "write",
    }),
    {
      repositories: ["repo"],
      permissions: {
        contents: "write",
        issues: "write",
        pull_requests: "write",
      },
    },
  );
});

test("finalizer comment token uses pull request write", () => {
  assert.deepEqual(FINALIZER_COMMENT_TOKEN_PERMISSIONS, {
    pull_requests: "write",
  });
  assert.deepEqual(
    installationTokenRequestBody(
      "owner/repo",
      FINALIZER_COMMENT_TOKEN_PERMISSIONS,
    ),
    {
      repositories: ["repo"],
      permissions: { pull_requests: "write" },
    },
  );
});

test("campaign control token can read base policy and update PR metadata", () => {
  assert.deepEqual(CAMPAIGN_CONTROL_TOKEN_PERMISSIONS, {
    contents: "read",
    pull_requests: "write",
  });
  assert.deepEqual(
    installationTokenRequestBody(
      "owner/repo",
      CAMPAIGN_CONTROL_TOKEN_PERMISSIONS,
    ),
    {
      repositories: ["repo"],
      permissions: {
        contents: "read",
        pull_requests: "write",
      },
    },
  );
});

test("open PR discovery uses a bounded GitHub API path", () => {
  assert.equal(
    openPullRequestsApiPath("owner/repo", 2),
    "/repos/owner/repo/pulls?state=open&sort=created&direction=asc&per_page=100&page=2",
  );
  assert.throws(
    () => openPullRequestsApiPath("owner/repo", 0),
    /Invalid open pull request page/,
  );
  assert.throws(
    () => openPullRequestsApiPath("owner/repo", 4),
    /Invalid open pull request page/,
  );
});

test("maintenance read token is explicitly read-only", () => {
  assert.deepEqual(MAINTENANCE_READ_TOKEN_PERMISSIONS, {
    administration: "read",
    checks: "read",
    contents: "read",
    pull_requests: "read",
  });
  assert.deepEqual(
    installationTokenRequestBody(
      "owner/repo",
      MAINTENANCE_READ_TOKEN_PERMISSIONS,
    ),
    {
      repositories: ["repo"],
      permissions: {
        administration: "read",
        checks: "read",
        contents: "read",
        pull_requests: "read",
      },
    },
  );
});

test("waits only while GitHub still reports the prepared head after push", async () => {
  const prepared = "a".repeat(40);
  const pushed = "b".repeat(40);
  const observed = [prepared, prepared, pushed];
  const sleeps = [];
  const pull = await waitForPullRequestHeadAfterPush({
    repository: "owner/repo",
    pullNumber: 7,
    preparedHead: prepared,
    newHead: pushed,
    token: "test-token",
    getPullRequestImpl: async () => ({
      state: "open",
      head: { sha: observed.shift() },
    }),
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.equal(pull.head.sha, pushed);
  assert.deepEqual(sleeps, [
    FINALIZER_HEAD_CONVERGENCE_DELAY_MS,
    FINALIZER_HEAD_CONVERGENCE_DELAY_MS,
  ]);
});

test("fails closed on an unexpected third-party head after push", async () => {
  const prepared = "a".repeat(40);
  const pushed = "b".repeat(40);
  const thirdParty = "c".repeat(40);
  let slept = false;

  await assert.rejects(
    () =>
      waitForPullRequestHeadAfterPush({
        repository: "owner/repo",
        pullNumber: 7,
        preparedHead: prepared,
        newHead: pushed,
        token: "test-token",
        getPullRequestImpl: async () => ({
          state: "open",
          head: { sha: thirdParty },
        }),
        sleepImpl: async () => {
          slept = true;
        },
      }),
    /unexpected commit after push/,
  );
  assert.equal(slept, false);
});

test("fails closed when the prepared head never converges to the pushed commit", async () => {
  const prepared = "a".repeat(40);
  const pushed = "b".repeat(40);
  let calls = 0;

  await assert.rejects(
    () =>
      waitForPullRequestHeadAfterPush({
        repository: "owner/repo",
        pullNumber: 7,
        preparedHead: prepared,
        newHead: pushed,
        token: "test-token",
        attempts: FINALIZER_HEAD_CONVERGENCE_ATTEMPTS,
        delayMs: 0,
        getPullRequestImpl: async () => {
          calls += 1;
          return { state: "open", head: { sha: prepared } };
        },
        sleepImpl: async () => {},
      }),
    /did not converge to the pushed commit/,
  );
  assert.equal(calls, FINALIZER_HEAD_CONVERGENCE_ATTEMPTS);
});

test("bounds finalizer post-push convergence configuration", async () => {
  await assert.rejects(
    () =>
      waitForPullRequestHeadAfterPush({
        repository: "owner/repo",
        pullNumber: 7,
        preparedHead: "a".repeat(40),
        newHead: "b".repeat(40),
        token: "test-token",
        attempts: FINALIZER_HEAD_CONVERGENCE_ATTEMPTS + 1,
      }),
    /Invalid finalizer head convergence attempt count/,
  );
  await assert.rejects(
    () =>
      waitForPullRequestHeadAfterPush({
        repository: "owner/repo",
        pullNumber: 7,
        preparedHead: "a".repeat(40),
        newHead: "b".repeat(40),
        token: "test-token",
        delayMs: FINALIZER_HEAD_CONVERGENCE_DELAY_MS + 1,
      }),
    /Invalid finalizer head convergence delay/,
  );
});
