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

