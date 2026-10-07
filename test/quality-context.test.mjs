import assert from "node:assert/strict";
import test from "node:test";
import {
  codacyPullRequestIssuesUrl,
  fetchCodacyQualityContext,
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
