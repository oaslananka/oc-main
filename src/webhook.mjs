import {
  MAINTENANCE_CAMPAIGN_STATUS_BOT_LOGIN,
  MAINTENANCE_CAMPAIGN_STATUS_MARKER,
} from "./campaign-status.mjs";
import crypto from "node:crypto";

export function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function extractPullRequestTrigger(eventName, payload) {
  if (payload?.action !== "created") return null;

  if (eventName === "issue_comment") {
    if (!payload.issue?.pull_request) return null;
    return {
      repository: payload.repository?.full_name,
      pullNumber: payload.issue?.number,
      installationId: payload.installation?.id,
      commentId: payload.comment?.id,
      commentBody: payload.comment?.body,
      commentUserId: payload.comment?.user?.id,
      commentUserLogin: payload.comment?.user?.login,
      reviewContext: null,
    };
  }

  if (eventName === "pull_request_review_comment") {
    return {
      repository: payload.repository?.full_name,
      pullNumber: payload.pull_request?.number,
      installationId: payload.installation?.id,
      commentId: payload.comment?.id,
      commentBody: payload.comment?.body,
      commentUserId: payload.comment?.user?.id,
      commentUserLogin: payload.comment?.user?.login,
      reviewContext: {
        path: payload.comment?.path || null,
        line: payload.comment?.line ?? payload.comment?.original_line ?? null,
      },
    };
  }

  return null;
}
export function extractIssueCommentTrigger(eventName, payload) {
  if (eventName !== "issue_comment" || payload?.action !== "created") {
    return null;
  }
  if (payload.issue?.pull_request) return null;
  return {
    repository: payload.repository?.full_name,
    issueNumber: payload.issue?.number,
    installationId: payload.installation?.id,
    commentId: payload.comment?.id,
    commentBody: payload.comment?.body,
    commentUserId: payload.comment?.user?.id,
    commentUserLogin: payload.comment?.user?.login,
    reviewContext: null,
  };
}


export function extractCampaignStatusTrigger(eventName, payload) {
  if (
    eventName !== "issue_comment" ||
    payload?.action !== "edited" ||
    !payload.issue?.pull_request
  ) {
    return null;
  }
  const comment = payload.comment;
  if (
    comment?.user?.login !== MAINTENANCE_CAMPAIGN_STATUS_BOT_LOGIN ||
    comment?.user?.type !== "Bot" ||
    !String(comment?.body || "").includes(MAINTENANCE_CAMPAIGN_STATUS_MARKER)
  ) {
    return null;
  }
  return {
    repository: payload.repository?.full_name,
    pullNumber: payload.issue?.number,
    installationId: payload.installation?.id,
    commentId: comment?.id,
    commentUserId: comment?.user?.id,
    commentUserLogin: comment?.user?.login,
  };
}
