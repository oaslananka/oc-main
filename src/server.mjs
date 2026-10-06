import http from "node:http";
import { loadConfig } from "./config.mjs";
import { parseCommand } from "./command.mjs";
import { JobQueue } from "./queue.mjs";
import { runPullRequestJob } from "./runner.mjs";
import { extractPullRequestTrigger, verifyWebhookSignature } from "./webhook.mjs";

const config = loadConfig();
const queue = new JobQueue(config.maxConcurrentJobs);
const seenDeliveries = new Set();

function rememberDelivery(id) {
  if (!id) return true;
  if (seenDeliveries.has(id)) return false;
  seenDeliveries.add(id);
  if (seenDeliveries.size > 10_000) {
    const oldest = seenDeliveries.values().next().value;
    seenDeliveries.delete(oldest);
  }
  return true;
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

  if (request.method !== "POST" || request.url !== "/webhook") {
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
    if (!rememberDelivery(deliveryId)) {
      respond(response, 202, "duplicate\n");
      return;
    }

    const eventName = request.headers["x-github-event"];
    const payload = JSON.parse(rawBody.toString("utf8"));
    const trigger = extractPullRequestTrigger(eventName, payload);
    if (!trigger) {
      respond(response, 202, "ignored\n");
      return;
    }

    if (!config.allowedUserIds.has(trigger.commentUserId)) {
      respond(response, 202, "ignored\n");
      return;
    }

    const command = parseCommand(trigger.commentBody, config);
    if (!command) {
      respond(response, 202, "ignored\n");
      return;
    }

    if (!trigger.repository || !trigger.pullNumber || !trigger.installationId) {
      throw new Error("Webhook payload is missing required repository or PR metadata");
    }

    queue.enqueue(() => runPullRequestJob({ config, trigger, command }));
    console.log(
      `queued ${trigger.repository}#${trigger.pullNumber} from ${trigger.commentUserLogin || trigger.commentUserId}`,
    );
    respond(response, 202, "queued\n");
  } catch (error) {
    console.error("webhook error", error);
    respond(response, 400, "bad request\n");
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`oc-main listening on :${config.port}`);
});
