import assert from "node:assert/strict";
import test from "node:test";
import { createSignedJob, verifySignedJob } from "../src/dispatch.mjs";

const signingKey = "unit-test-signing-key".repeat(2);

test("signs and verifies controller-to-worker jobs", () => {
  const job = createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 11,
      commentUserId: 42,
      reviewContext: null,
    },
    {
      model: "opencode/big-pickle",
      prompt: "fix it",
    },
    signingKey,
  );

  const verified = verifySignedJob(job, signingKey, job.issued_at + 1);
  assert.equal(verified.repository, "owner/repo");
  assert.equal(verified.pull_number, 7);
  assert.equal(verified.comment_user_id, 42);
  assert.equal(verified.model, "opencode/big-pickle");
});

test("rejects tampered worker jobs", () => {
  const job = createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 11,
      commentUserId: 42,
      reviewContext: null,
    },
    {
      model: "opencode/big-pickle",
      prompt: "fix it",
    },
    signingKey,
  );

  assert.throws(
    () => verifySignedJob({ ...job, prompt: "do something else" }, signingKey, job.issued_at),
    /signature is invalid/,
  );
});

test("rejects expired worker jobs", () => {
  const job = createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 11,
      commentUserId: 42,
      reviewContext: null,
    },
    {
      model: "opencode/big-pickle",
      prompt: "fix it",
    },
    signingKey,
  );

  assert.throws(
    () => verifySignedJob(job, signingKey, job.issued_at + 31 * 60),
    /expired/,
  );
});
