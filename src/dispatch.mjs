import crypto from "node:crypto";

const MAX_JOB_AGE_SECONDS = 30 * 60;

function material(payload) {
  return JSON.stringify([
    1,
    payload.repository,
    payload.pull_number,
    payload.comment_id,
    payload.comment_user_id,
    payload.model,
    payload.prompt,
    payload.review_context ?? null,
    payload.issued_at,
    payload.nonce,
  ]);
}

function signature(payload, secret) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(material(payload))
    .digest("hex")}`;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return number;
}

export function createSignedJob(trigger, command, secret) {
  const unsigned = {
    repository: trigger.repository,
    pull_number: positiveInteger(trigger.pullNumber, "pull number"),
    comment_id: positiveInteger(trigger.commentId, "comment ID"),
    comment_user_id: positiveInteger(trigger.commentUserId, "comment user ID"),
    model: command.model,
    prompt: command.prompt,
    review_context: trigger.reviewContext ?? null,
    issued_at: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  return {
    ...unsigned,
    signature: signature(unsigned, secret),
  };
}

export function verifySignedJob(payload, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Worker payload is missing");
  }

  const normalized = {
    repository: String(payload.repository || ""),
    pull_number: positiveInteger(payload.pull_number, "pull number"),
    comment_id: positiveInteger(payload.comment_id, "comment ID"),
    comment_user_id: positiveInteger(payload.comment_user_id, "comment user ID"),
    model: String(payload.model || ""),
    prompt: String(payload.prompt || ""),
    review_context: payload.review_context ?? null,
    issued_at: positiveInteger(payload.issued_at, "issued_at"),
    nonce: String(payload.nonce || ""),
  };

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized.repository)) {
    throw new Error("Invalid worker repository");
  }
  if (!normalized.model || !normalized.prompt || normalized.prompt.length > 20_000) {
    throw new Error("Invalid worker model or prompt");
  }
  if (!/^[0-9a-f-]{36}$/i.test(normalized.nonce)) {
    throw new Error("Invalid worker nonce");
  }

  const age = nowSeconds - normalized.issued_at;
  if (age < -60 || age > MAX_JOB_AGE_SECONDS) {
    throw new Error("Worker payload is expired");
  }

  const provided = String(payload.signature || "");
  const expected = signature(normalized, secret);
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Worker payload signature is invalid");
  }

  return normalized;
}
