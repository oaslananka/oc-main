import crypto from "node:crypto";
import { capabilityProfile, isSupportedMode } from "./capabilities.mjs";

const MAX_JOB_AGE_SECONDS = 30 * 60;

function material(payload) {
  return JSON.stringify([
    2, payload.repository, payload.pull_number, payload.comment_id,
    payload.comment_user_id, payload.model, payload.mode, payload.agent,
    payload.risk, payload.allow_edits, payload.capabilities, payload.prompt,
    payload.review_context ?? null, payload.issued_at, payload.nonce,
  ]);
}

function signature(payload, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(material(payload)).digest("hex");
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid " + label);
  return number;
}

function normalizedCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("Invalid worker capabilities");
  const result = value.map((item) => String(item || ""));
  if (result.some((item) => !/^[a-z-]+$/.test(item))) throw new Error("Invalid worker capabilities");
  return result;
}

export function createSignedJob(trigger, command, secret) {
  const profile = capabilityProfile(command.mode, command.prompt);
  const unsigned = {
    repository: trigger.repository,
    pull_number: positiveInteger(trigger.pullNumber, "pull number"),
    comment_id: positiveInteger(trigger.commentId, "comment ID"),
    comment_user_id: positiveInteger(trigger.commentUserId, "comment user ID"),
    model: command.model, mode: profile.mode, agent: profile.agent,
    risk: profile.risk, allow_edits: profile.allowEdits, capabilities: profile.capabilities,
    prompt: command.prompt, review_context: trigger.reviewContext ?? null,
    issued_at: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(),
  };
  return { ...unsigned, signature: signature(unsigned, secret) };
}

export function verifySignedJob(payload, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== "object") throw new Error("Worker payload is missing");
  const mode = String(payload.mode || "");
  if (!isSupportedMode(mode)) throw new Error("Invalid worker mode");

  const normalized = {
    repository: String(payload.repository || ""),
    pull_number: positiveInteger(payload.pull_number, "pull number"),
    comment_id: positiveInteger(payload.comment_id, "comment ID"),
    comment_user_id: positiveInteger(payload.comment_user_id, "comment user ID"),
    model: String(payload.model || ""), mode, agent: String(payload.agent || ""),
    risk: String(payload.risk || ""), allow_edits: payload.allow_edits === true,
    capabilities: normalizedCapabilities(payload.capabilities),
    prompt: String(payload.prompt || ""), review_context: payload.review_context ?? null,
    issued_at: positiveInteger(payload.issued_at, "issued_at"), nonce: String(payload.nonce || ""),
  };

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized.repository)) throw new Error("Invalid worker repository");
  if (!normalized.model || !normalized.prompt || normalized.prompt.length > 20_000) throw new Error("Invalid worker model or prompt");
  if (!/^[0-9a-f-]{36}$/i.test(normalized.nonce)) throw new Error("Invalid worker nonce");

  const profile = capabilityProfile(normalized.mode, normalized.prompt);
  if (normalized.agent !== profile.agent || normalized.risk !== profile.risk ||
      normalized.allow_edits !== profile.allowEdits ||
      JSON.stringify(normalized.capabilities) !== JSON.stringify(profile.capabilities)) {
    throw new Error("Worker capability profile is invalid");
  }

  const age = nowSeconds - normalized.issued_at;
  if (age < -60 || age > MAX_JOB_AGE_SECONDS) throw new Error("Worker payload is expired");

  const provided = String(payload.signature || "");
  const expected = signature(normalized, secret);
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Worker payload signature is invalid");
  }
  return normalized;
}

export function wrapSignedJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Error("Signed job is missing");
  }
  return { job };
}

export function unwrapSignedJob(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Worker envelope is missing");
  }
  const keys = Object.keys(envelope);
  if (keys.length !== 1 || keys[0] !== "job") {
    throw new Error("Invalid worker envelope");
  }
  if (!envelope.job || typeof envelope.job !== "object" || Array.isArray(envelope.job)) {
    throw new Error("Worker envelope job is missing");
  }
  return envelope.job;
}
