import http from "node:http";
import { loadConfig } from "./config.mjs";
import { parseCommand } from "./command.mjs";
import { createSignedJob } from "./dispatch.mjs";
import { dispatchRepositoryEvent } from "./github.mjs";
import { extractPullRequestTrigger, verifyWebhookSignature } from "./webhook.mjs";

const config = loadConfig();
const seenDeliveries = new Set();

function isDuplicate(id) {
  return Boolean(id && seenDeliveries.has(id));
}

function rememberDelivery(id) {
  if (!id) return;
  seenDeliveries.add(id);
  if (seenDeliveries.size > 10_000) {
    const oldest = seenDeliveries.values().next().value;
    seenDeliveries.delete(oldest);
  }
}

async function readBody(request, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Webhook payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function respond(response, status, body = "") {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    respond(response, 200, "ok\n");
    return;
  }

  if (request.method !== "POST" || request.url !== config.webhookPath) {
    respond(response, 404, "not found\n");
    return;
  }

  try {
    const rawBody = await readBody(request);
    const signature = request.headers["x-hub-signature-256"];
    if (!verifyWebhookSignature(rawBody, signature, config.githubWebhookSecret)) {
      respond(response, 401, "invalid signature\n");
      return;
    }

    const deliveryId = request.headers["x-github-delivery"];
    if (isDuplicate(deliveryId)) {
      respond(response, 202, "duplicate\n");
      return;
    }

    const eventName = request.headers["x-github-event"];
    const payload = JSON.parse(rawBody.toString("utf8"));
    const trigger = extractPullRequestTrigger(eventName, payload);
    if (!trigger) {
      rememberDelivery(deliveryId);
      respond(response, 202, "ignored\n");
      return;
    }

    if (!config.allowedUserIds.has(trigger.commentUserId)) {
      rememberDelivery(deliveryId);
      respond(response, 202, "ignored\n");
      return;
    }

    const command = parseCommand(trigger.commentBody, config);
    if (!command) {
      rememberDelivery(deliveryId);
      respond(response, 202, "ignored\n");
      return;
    }

    if (!trigger.repository || !trigger.pullNumber || !trigger.commentId) {
      throw new Error("Webhook payload is missing required repository or PR metadata");
    }

    const job = createSignedJob(
      trigger,
      command,
      config.workerDispatchSecret,
    );

    await dispatchRepositoryEvent(
      config,
      config.controlRepository,
      config.dispatchEventType,
      job,
    );

    rememberDelivery(deliveryId);
    console.log(
      `dispatched ${trigger.repository}#${trigger.pullNumber} from ${trigger.commentUserLogin || trigger.commentUserId}`,
    );
    respond(response, 202, "queued\n");
  } catch (error) {
    console.error("webhook error", error);
    respond(response, 500, "dispatch failed\n");
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    `oc-main listening on :${config.port} at ${config.webhookPath}`,
  );
});
