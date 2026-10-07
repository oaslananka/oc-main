import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  extractCampaignStatusTrigger,
  extractIssueCommentTrigger,
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

test("extracts ordinary issue comments for trusted campaign routing", () => {
  const trigger = extractIssueCommentTrigger("issue_comment", {
    action: "created",
    repository: { full_name: "owner/repo" },
    installation: { id: 42 },
    issue: { number: 17 },
    comment: {
      id: 101,
      body: "/oc maintenance remediate current blockers",
      user: { id: 9, login: "owner" },
    },
  });
  assert.equal(trigger.repository, "owner/repo");
  assert.equal(trigger.issueNumber, 17);
  assert.equal(trigger.commentId, 101);
  assert.equal(trigger.commentUserId, 9);
});

test("does not classify pull request comments as issue campaign triggers", () => {
  assert.equal(
    extractIssueCommentTrigger("issue_comment", {
      action: "created",
      issue: { number: 7, pull_request: {} },
    }),
    null,
  );
});

test("extracts only canonical bot edited sticky status wakeups", () => {
  const trigger = extractCampaignStatusTrigger("issue_comment", {
    action: "edited",
    repository: { full_name: "owner/repo" },
    installation: { id: 42 },
    issue: { number: 17, pull_request: {} },
    comment: {
      id: 501,
      body:
        "status\n<!-- oc-main-maintenance-campaign-status:v1 -->",
      user: {
        id: 900,
        login: "oaslananka-ops[bot]",
        type: "Bot",
      },
    },
  });

  assert.equal(trigger.repository, "owner/repo");
  assert.equal(trigger.pullNumber, 17);
  assert.equal(trigger.commentId, 501);
  assert.equal(trigger.commentUserId, 900);
});

test("ignores created, human, lookalike and unrelated bot status comments", () => {
  const base = {
    repository: { full_name: "owner/repo" },
    issue: { number: 17, pull_request: {} },
    comment: {
      id: 501,
      body:
        "status\n<!-- oc-main-maintenance-campaign-status:v1 -->",
      user: {
        id: 900,
        login: "oaslananka-ops[bot]",
        type: "Bot",
      },
    },
  };

  assert.equal(
    extractCampaignStatusTrigger("issue_comment", {
      ...base,
      action: "created",
    }),
    null,
  );
  assert.equal(
    extractCampaignStatusTrigger("issue_comment", {
      ...base,
      action: "edited",
      comment: {
        ...base.comment,
        user: { id: 900, login: "oaslananka-ops[bot]", type: "User" },
      },
    }),
    null,
  );
  assert.equal(
    extractCampaignStatusTrigger("issue_comment", {
      ...base,
      action: "edited",
      comment: {
        ...base.comment,
        user: { id: 900, login: "oaslananka-ops-helper[bot]", type: "Bot" },
      },
    }),
    null,
  );
  assert.equal(
    extractCampaignStatusTrigger("issue_comment", {
      ...base,
      action: "edited",
      comment: {
        ...base.comment,
        user: { id: 901, login: "other-bot[bot]", type: "Bot" },
      },
    }),
    null,
  );
});
