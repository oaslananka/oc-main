import assert from "node:assert/strict";
import test from "node:test";
import { publicFailureReason, renderRunComment } from "../src/comment-report.mjs";

const base = {
  job: { mode: "maintenance" },
  repository: "oaslananka/oc-main",
  runId: "38697803162",
};

test("failed runs never post raw stderr, JSONL, diffs, or credentials", () => {
  const error = 'OpenCode returned exit code 1 (unexplained-exit-one): ' +
    'diff --git a/secret b/secret\n{"type":"step-start","token":"private"}\n' +
    "PRIVATE_VALUE_123";
  const comment = renderRunComment({ ...base, outcome: "failed", error });
  assert.match(comment, /Unexpected process exit/);
  assert.match(comment, /code 1/);
  assert.match(comment, /actions\/runs\/38697803162/);
  for (const snippet of ["diff --git", "step-start", "PRIVATE_VALUE_123", "token"]) {
    assert.doesNotMatch(comment, new RegExp(snippet));
  }
  assert.ok(comment.length < 500);
  assert.match(comment, /Dependency maintenance — Failed/);
  assert.doesNotMatch(comment.split("\n")[0], /agent|nemotron|oc-main|OpenCode/);
});

test("unclassified failures disclose no raw exception text", () => {
  assert.equal(publicFailureReason("secret=PRIVATE_VALUE_123 unknown failure"),
    "Execution failed (see Actions for diagnostics)");
  assert.equal(publicFailureReason("/usr/local/bin/opencode exceeded the time limit"),
    "Execution timed out");
  assert.equal(publicFailureReason("/usr/local/bin/opencode exceeded the output limit"),
    "Execution output limit exceeded");
});

test("successful edits use verified commit only, not model output claims", () => {
  const comment = renderRunComment({
    ...base,
    outcome: "pushed",
    commitSha: "b1586f2ab8c2291500c5c54f9eb965398bea3d34",
    output: "All tests passed\nPRIVATE_VALUE_123\ndiff --git",
  });
  assert.match(comment, /b1586f2/);
  assert.match(comment, /model claims are not CI evidence/);
  assert.doesNotMatch(comment, /PRIVATE_VALUE_123|diff --git|All tests passed/);
});

test("read-only answers remain useful but diagnostics are omitted", () => {
  const comment = renderRunComment({
    ...base,
    outcome: "completed-no-changes",
    output: "This update only changes the action pin.",
  });
  assert.match(comment, /This update only changes the action pin/);
  const raw = renderRunComment({
    ...base,
    outcome: "completed-no-changes",
    output: 'Result\n{"type":"text","part":{"text":"PRIVATE_VALUE_123"}}',
  });
  assert.match(raw, /Output contained diagnostic data/);
  assert.doesNotMatch(raw, /PRIVATE_VALUE_123/);
});

test("incomplete, blocked and invalid run metadata remain bounded", () => {
  for (const outcome of ["incomplete", "blocked-read-only"]) {
    const comment = renderRunComment({
      ...base, outcome,
      output: "PRIVATE_VALUE_123".repeat(1000),
      error: "PRIVATE_VALUE_123",
    });
    assert.ok(comment.length < 500);
    assert.doesNotMatch(comment, /PRIVATE_VALUE_123/);
  }
  const comment = renderRunComment({
    ...base, outcome: "failed",
    repository: "owner/repo\nmalicious",
    runId: "invalid",
    error: "failure",
  });
  assert.doesNotMatch(comment, /https:|malicious/);
  assert.throws(() => renderRunComment({ ...base, outcome: "pushed", commitSha: "bad" }));
});
