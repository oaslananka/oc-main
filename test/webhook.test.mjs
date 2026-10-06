import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  extractPullRequestTrigger,
  verifyWebhookSignature,
} from "../src/webhook.mjs";

test("verifies GitHub webhook signatures", () => {
  const raw = Buffer.from('{"ok":true}');
  const secret = "test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyWebhookSignature(raw, "sha256=deadbeef", secret), false);
});

test("extracts PR issue comments", () => {
  const trigger = extractPullRequestTrigger("issue_comment", {
    action: "created",
    repository: { full_name: "owner/repo" },
    installation: { id: 42 },
    issue: { number: 7, pull_request: {} },
    comment: { id: 1, body: "/oc fix it", user: { id: 9, login: "owner" } },
  });

  assert.equal(trigger.repository, "owner/repo");
  assert.equal(trigger.pullNumber, 7);
  assert.equal(trigger.commentUserId, 9);
});

test("ignores ordinary issue comments", () => {
  assert.equal(
    extractPullRequestTrigger("issue_comment", {
      action: "created",
      issue: { number: 7 },
    }),
    null,
  );
});
