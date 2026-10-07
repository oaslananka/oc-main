import assert from "node:assert/strict";
import test from "node:test";
import { apiPath, installationTokenRequestBody, maintenanceCampaignBranchName, requiredChecksApiPaths } from "../src/github.mjs";

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
    primary: "oc-maintenance-issue-17",
    retry: "oc-maintenance-issue-17-comment-101",
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
