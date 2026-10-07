import assert from "node:assert/strict";
import test from "node:test";
import {
  codacyPullRequestIssuesUrl,
  fetchCodacyQualityContext,
  fetchMaintenanceQualityContext,
  formatCodacyQualityContext,
} from "../src/quality-context.mjs";

const payload = {
  data: [
    {
      deltaType: "Added",
      commitIssue: {
        filePath: ".github/workflows/release.yml",
        lineNumber: 12,
        lineText: "id-token: write",
        message: "Hardcoded tokens are a security risk.",
        patternInfo: {
          id: "Semgrep_codacy.yaml.security.hard-coded-tokens",
          severityLevel: "Error",
        },
      },
    },
    {
      deltaType: "Existing",
      commitIssue: {
        filePath: "old.js",
        lineNumber: 1,
        message: "existing",
        patternInfo: { id: "old", severityLevel: "Low" },
      },
    },
  ],
};

test("builds the bounded public Codacy PR URL", () => {
  assert.equal(
    codacyPullRequestIssuesUrl("oaslananka/ssh-mcp-pro", 65),
    "https://api.codacy.com/api/v3/analysis/organizations/gh/oaslananka/repositories/ssh-mcp-pro/pull-requests/65/issues",
  );
});

test("formats only newly added Codacy findings", () => {
  const text = formatCodacyQualityContext(payload);
  assert.match(text, /1 newly added finding/);
  assert.match(text, /hard-coded-tokens/);
  assert.match(text, /release\.yml:12/);
  assert.doesNotMatch(text, /old\.js/);
});

test("fetches Codacy quality context without credentials", async () => {
  const fetchImpl = async (url, options) => {
    assert.match(url, /pull-requests\/65\/issues$/);
    assert.equal(options.headers.Accept, "application/json");
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  };

  const text = await fetchCodacyQualityContext(
    "oaslananka/ssh-mcp-pro",
    65,
    { fetchImpl, timeoutMs: 1000 },
  );
  assert.match(text, /Hardcoded tokens/);
});

test("fails soft when Codacy context is unavailable", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    async json() {
      return {};
    },
  });
  assert.equal(
    await fetchCodacyQualityContext("owner/repo", 1, { fetchImpl }),
    "Codacy context unavailable: HTTP 404.",
  );
});

test("collects exact-head maintenance checks, base deltas, and base policy", async () => {
  const checkRunsImpl = async (_repository, sha) => {
    if (sha === "a".repeat(40)) {
      return [
        { name: "build", status: "completed", conclusion: "success", output: {} },
        {
          name: "osv-scanner / osv-scan",
          status: "completed",
          conclusion: "success",
          output: {},
        },
      ];
    }
    return [
      { name: "build", status: "completed", conclusion: "failure", output: {} },
      {
        name: "osv-scanner / osv-scan",
        status: "completed",
        conclusion: "success",
        output: {},
      },
    ];
  };

  const result = await fetchMaintenanceQualityContext(
    {
      repository: "owner/repo",
      pullNumber: 7,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      baseBranch: "main",
      token: "test-token",
    },
    {
      checkRunsImpl,
      requiredChecksImpl: async () => ({
        names: ["build"],
        sources: ["repository-rules"],
        warnings: [],
      }),
      policyTextImpl: async () => `
version: 1
required_checks:
  inherit_from_github: true
  names:
    - osv-scanner / osv-scan
analyzers:
  sonar:
    policy: advisory
    block_new:
      - critical
`,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      }),
    },
  );

  assert.equal(result.evidence.requiredChecks.authorityComplete, true);
  assert.equal(result.evidence.checkSummary.requiredCount, 2);
  const build = result.evidence.checks.find((item) => item.name === "build");
  assert.equal(build.delta, "new");
  assert.equal(build.blocking, true);
  assert.match(result.text, /Candidate head:/);
  assert.match(result.text, /Required-check authority: repository-rules/);
  assert.match(result.text, /BLOCKING/);
});

test("includes bounded dependency PR discovery as read-only maintenance evidence", async () => {
  const result = await fetchMaintenanceQualityContext(
    {
      repository: "owner/repo",
      pullNumber: 9,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      baseBranch: "main",
      token: "test-token",
    },
    {
      checkRunsImpl: async () => [],
      requiredChecksImpl: async () => ({
        names: [],
        sources: ["repository-rules"],
        warnings: [],
      }),
      policyTextImpl: async () => `
version: 1
campaign:
  max_iterations: 4
  max_dependencies_per_batch: 2
required_checks:
  inherit_from_github: true
`,
      pullRequestsImpl: async () => [
        {
          number: 41,
          state: "open",
          title: "Bump alpha from 1.0.0 to 1.0.1",
          html_url: "https://github.com/owner/repo/pull/41",
          draft: false,
          user: { login: "dependabot[bot]", type: "Bot" },
          head: {
            ref: "dependabot/npm_and_yarn/alpha-1.0.1",
            sha: "c".repeat(40),
          },
          base: { ref: "main", sha: "a".repeat(40) },
          labels: [{ name: "dependencies" }],
        },
        {
          number: 42,
          state: "open",
          title: "Bump beta from 1.0.0 to 1.0.1",
          html_url: "https://github.com/owner/repo/pull/42",
          draft: false,
          user: { login: "dependabot[bot]", type: "User" },
          head: {
            ref: "dependabot/npm_and_yarn/beta-1.0.1",
            sha: "d".repeat(40),
          },
          base: { ref: "main", sha: "a".repeat(40) },
          labels: [],
        },
      ],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { data: [] };
        },
      }),
    },
  );

  assert.equal(result.evidence.dependencyPullRequests.length, 1);
  assert.equal(result.evidence.dependencyPullRequests[0].number, 41);
  assert.equal(result.evidence.dependencyPullRequests[0].ecosystem, "npm");
  assert.equal(result.evidence.dependencyPullRequests[0].updateScope, "patch");
  assert.equal(result.evidence.dependencyPlan.readOnly, true);
  assert.equal(result.evidence.dependencyPlan.maxDependenciesPerBatch, 2);
  assert.deepEqual(result.evidence.dependencyPlan.lanes[0].pullNumbers, [41]);
  assert.match(result.text, /Dependency PR evidence: 1 recognized bot PR/);
  assert.match(result.text, /dependency PR #41/);
  assert.match(result.text, /read-only planning evidence/);
  assert.doesNotMatch(result.text, /dependency PR #42/);
});
