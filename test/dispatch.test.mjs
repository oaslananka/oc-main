import assert from "node:assert/strict";
import test from "node:test";
import { createSignedJob, verifySignedJob } from "../src/dispatch.mjs";

const signingKey = "unit-test-signing-key".repeat(2);

function makeJob(command = { mode: "fix", model: "opencode/big-pickle", prompt: "fix it" }) {
  return createSignedJob({
    repository: "owner/repo", pullNumber: 7, commentId: 11, commentUserId: 42, reviewContext: null,
  }, command, signingKey);
}

test("signs and verifies controller-to-worker capability manifests", () => {
  const job = makeJob();
  const verified = verifySignedJob(job, signingKey, job.issued_at + 1);
  assert.equal(verified.repository, "owner/repo");
  assert.equal(verified.mode, "fix");
  assert.equal(verified.agent, "orchestrator");
  assert.equal(verified.allow_edits, true);
  assert.ok(verified.capabilities.includes("edit"));
});

test("read-only modes sign immutable capability profiles", () => {
  const job = makeJob({ mode: "review", model: "opencode/big-pickle", prompt: "review auth" });
  const verified = verifySignedJob(job, signingKey, job.issued_at);
  assert.equal(verified.agent, "reviewer");
  assert.equal(verified.allow_edits, false);
  assert.equal(verified.capabilities.includes("edit"), false);
});

test("rejects tampered prompts", () => {
  const job = makeJob();
  assert.throws(() => verifySignedJob({ ...job, prompt: "do something else" }, signingKey, job.issued_at), /signature is invalid/);
});

test("rejects tampered capability profiles", () => {
  const job = makeJob();
  const tampered = { ...job, allow_edits: false };
  assert.throws(() => verifySignedJob(tampered, signingKey, job.issued_at), /(capability profile|signature is invalid)/);
});

test("rejects expired worker jobs", () => {
  const job = makeJob();
  assert.throws(() => verifySignedJob(job, signingKey, job.issued_at + 31 * 60), /expired/);
});
