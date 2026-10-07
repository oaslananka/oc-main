import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createSignedJob,
  unwrapSignedJob,
  verifySignedJob,
  wrapSignedJob,
} from "../src/dispatch.mjs";

const signingKey = "unit-test-signing-key".repeat(2);

function makeJob(
  command = {
    mode: "fix",
    model: "opencode/big-pickle",
    prompt: "fix it",
  },
) {
  return createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 11,
      commentUserId: 42,
      reviewContext: null,
    },
    command,
    signingKey,
  );
}

test("signs and verifies controller-to-worker capability manifests", () => {
  const job = makeJob();
  const verified = verifySignedJob(job, signingKey, job.issued_at + 1);
  assert.equal(verified.repository, "owner/repo");
  assert.equal(verified.mode, "fix");
  assert.equal(verified.agent, "build");
  assert.equal(verified.allow_edits, true);
  assert.ok(verified.capabilities.includes("edit"));
  assert.equal(verified.capabilities.includes("subagent"), false);
});

test("read-only modes sign immutable built-in plan profile", () => {
  const job = makeJob({
    mode: "review",
    model: "opencode/big-pickle",
    prompt: "review auth",
  });
  const verified = verifySignedJob(job, signingKey, job.issued_at);
  assert.equal(verified.agent, "plan");
  assert.equal(verified.allow_edits, false);
  assert.equal(verified.capabilities.includes("edit"), false);
});

test("rejects tampered prompts", () => {
  const job = makeJob();
  assert.throws(
    () =>
      verifySignedJob(
        { ...job, prompt: "do something else" },
        signingKey,
        job.issued_at,
      ),
    /signature is invalid/,
  );
});

test("rejects tampered capability profiles", () => {
  const job = makeJob();
  const tampered = { ...job, allow_edits: false };
  assert.throws(
    () => verifySignedJob(tampered, signingKey, job.issued_at),
    /(capability profile|signature is invalid)/,
  );
});

test("rejects expired worker jobs", () => {
  const job = makeJob();
  assert.throws(
    () => verifySignedJob(job, signingKey, job.issued_at + 31 * 60),
    /expired/,
  );
});

test("wraps repository dispatch payload in one top-level property", () => {
  const job = makeJob();
  const envelope = wrapSignedJob(job);
  assert.deepEqual(Object.keys(envelope), ["job"]);
  assert.equal(unwrapSignedJob(envelope), job);
});

test("rejects malformed repository dispatch envelopes", () => {
  const job = makeJob();
  assert.throws(() => unwrapSignedJob(job), /Invalid worker envelope/);
  assert.throws(
    () => unwrapSignedJob({ job, extra: true }),
    /Invalid worker envelope/,
  );
});

test("signs trigger kind and campaign iteration in manifest v3", () => {
  const job = createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 500,
      commentUserId: 900,
      triggerKind: "automation-status",
      campaignIteration: 2,
      reviewContext: null,
    },
    {
      mode: "maintenance",
      model: "opencode/nemotron-3-ultra-free",
      prompt: "continue maintenance",
    },
    signingKey,
  );
  const verified = verifySignedJob(job, signingKey, job.issued_at);

  assert.equal(verified.manifest_version, 3);
  assert.equal(verified.trigger_kind, "automation-status");
  assert.equal(verified.campaign_iteration, 2);
  assert.equal(verified.comment_id, 500);
});

test("automatic worker manifests require maintenance mode and iteration identity", () => {
  assert.throws(
    () =>
      createSignedJob(
        {
          repository: "owner/repo",
          pullNumber: 7,
          commentId: 500,
          commentUserId: 900,
          triggerKind: "automation-status",
          reviewContext: null,
        },
        {
          mode: "maintenance",
          model: "opencode/nemotron-3-ultra-free",
          prompt: "continue",
        },
        signingKey,
      ),
    /maintenance campaign iteration/,
  );
  assert.throws(
    () =>
      createSignedJob(
        {
          repository: "owner/repo",
          pullNumber: 7,
          commentId: 500,
          commentUserId: 900,
          triggerKind: "automation-status",
          campaignIteration: 2,
          reviewContext: null,
        },
        {
          mode: "fix",
          model: "opencode/big-pickle",
          prompt: "continue",
        },
        signingKey,
      ),
    /maintenance campaign iteration/,
  );
});

test("rejects trigger-kind or campaign-iteration tampering", () => {
  const job = createSignedJob(
    {
      repository: "owner/repo",
      pullNumber: 7,
      commentId: 500,
      commentUserId: 900,
      triggerKind: "automation-status",
      campaignIteration: 2,
      reviewContext: null,
    },
    {
      mode: "maintenance",
      model: "opencode/nemotron-3-ultra-free",
      prompt: "continue maintenance",
    },
    signingKey,
  );

  assert.throws(
    () =>
      verifySignedJob(
        { ...job, campaign_iteration: 3 },
        signingKey,
        job.issued_at,
      ),
    /signature is invalid/,
  );
  assert.throws(
    () =>
      verifySignedJob(
        { ...job, trigger_kind: "owner-comment" },
        signingKey,
        job.issued_at,
      ),
    /signature is invalid/,
  );
});

test("verifies legacy v2 worker manifests for already queued jobs", () => {
  const unsigned = {
    repository: "owner/repo",
    pull_number: 7,
    comment_id: 11,
    comment_user_id: 42,
    model: "opencode/big-pickle",
    mode: "fix",
    agent: "build",
    risk: "medium",
    allow_edits: true,
    capabilities: [
      "read",
      "glob",
      "grep",
      "list",
      "skills",
      "webfetch",
      "websearch",
      "shell",
      "edit",
    ],
    prompt: "fix it",
    review_context: null,
    issued_at: 1_700_000_000,
    nonce: "11111111-1111-4111-8111-111111111111",
  };
  const material = JSON.stringify([
    2,
    unsigned.repository,
    unsigned.pull_number,
    unsigned.comment_id,
    unsigned.comment_user_id,
    unsigned.model,
    unsigned.mode,
    unsigned.agent,
    unsigned.risk,
    unsigned.allow_edits,
    unsigned.capabilities,
    unsigned.prompt,
    unsigned.review_context,
    unsigned.issued_at,
    unsigned.nonce,
  ]);
  const signature =
    "sha256=" +
    crypto.createHmac("sha256", signingKey).update(material).digest("hex");
  const verified = verifySignedJob(
    { ...unsigned, signature },
    signingKey,
    unsigned.issued_at + 1,
  );

  assert.equal(verified.manifest_version, 2);
  assert.equal(verified.trigger_kind, "owner-comment");
  assert.equal(verified.campaign_iteration, null);
});
