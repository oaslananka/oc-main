import http from "node:http";
import { loadConfig } from "./config.mjs";
import { parseCommand } from "./command.mjs";
import { createSignedJob, wrapSignedJob } from "./dispatch.mjs";
import {
  abortMaintenanceCampaignDispatch,
  beginMaintenanceCampaignDispatch,
  createOrReuseMaintenanceCampaign,
  dispatchRepositoryEvent,
} from "./github.mjs";
import { extractIssueCommentTrigger, extractPullRequestTrigger, verifyWebhookSignature } from "./webhook.mjs";

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
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function campaignDispatchBody(reason) {
  if (reason === "busy") return "campaign busy\n";
  if (reason === "stale") return "campaign stale\n";
  if (reason === "duplicate") return "duplicate\n";
  return "campaign closed\n";
}

function acceptedTrigger(eventName, payload) {
  const pullTrigger = extractPullRequestTrigger(eventName, payload);
  const issueTrigger = pullTrigger
    ? null
    : extractIssueCommentTrigger(eventName, payload);
  return {
    pullTrigger,
    issueTrigger,
    trigger: pullTrigger || issueTrigger,
  };
}

function campaignPrompt(command, campaignDispatch, sourceIssue) {
  return {
    ...command,
    prompt:
      `Maintenance campaign originated from issue #${sourceIssue}; ` +
      `trusted iteration ${campaignDispatch.iteration}/${campaignDispatch.maxIterations}. ` +
      command.prompt,
  };
}

async function routeIssueCommand(issueTrigger, command) {
  if (!issueTrigger.issueNumber || command.mode !== "maintenance") {
    return { response: { status: 202, body: "ignored\n" } };
  }

  const campaign = await createOrReuseMaintenanceCampaign(config, {
    repository: issueTrigger.repository,
    issueNumber: issueTrigger.issueNumber,
    commentId: issueTrigger.commentId,
  });
  if (!campaign.pullRequest?.number) {
    throw new Error("Maintenance campaign pull request is unavailable");
  }
  if (campaign.terminal || campaign.pullRequest.state !== "open") {
    return { response: { status: 202, body: "campaign closed\n" } };
  }

  const workerTrigger = {
    ...issueTrigger,
    pullNumber: campaign.pullRequest.number,
  };
  const campaignDispatch = await beginMaintenanceCampaignDispatch(config, {
    repository: workerTrigger.repository,
    pullNumber: workerTrigger.pullNumber,
    commentId: workerTrigger.commentId,
  });
  if (!campaignDispatch.dispatch) {
    return {
      response: {
        status: 202,
        body: campaignDispatchBody(campaignDispatch.reason),
      },
    };
  }

  return {
    workerTrigger,
    workerCommand: campaignPrompt(
      command,
      campaignDispatch,
      issueTrigger.issueNumber,
    ),
    campaignDispatch,
  };
}

async function routePullCommand(pullTrigger, command) {
  if (!pullTrigger?.pullNumber) {
    throw new Error("Webhook payload is missing pull request metadata");
  }
  if (command.mode !== "maintenance") {
    return {
      workerTrigger: pullTrigger,
      workerCommand: command,
      campaignDispatch: null,
    };
  }

  const campaignDispatch = await beginMaintenanceCampaignDispatch(config, {
    repository: pullTrigger.repository,
    pullNumber: pullTrigger.pullNumber,
    commentId: pullTrigger.commentId,
  });
  if (campaignDispatch.campaign && !campaignDispatch.dispatch) {
    return {
      response: {
        status: 202,
        body: campaignDispatchBody(campaignDispatch.reason),
      },
    };
  }

  return {
    workerTrigger: pullTrigger,
    workerCommand: campaignDispatch.campaign
      ? campaignPrompt(
          command,
          campaignDispatch,
          campaignDispatch.sourceIssue,
        )
      : command,
    campaignDispatch,
  };
}

async function workerRoute(pullTrigger, issueTrigger, command) {
  return issueTrigger
    ? routeIssueCommand(issueTrigger, command)
    : routePullCommand(pullTrigger, command);
}

async function rollbackCampaignDispatch(route) {
  const campaignDispatch = route.campaignDispatch;
  if (!campaignDispatch?.campaign || !campaignDispatch.dispatch) return;
  try {
    await abortMaintenanceCampaignDispatch(config, {
      repository: route.workerTrigger.repository,
      pullNumber: route.workerTrigger.pullNumber,
      commentId: route.workerTrigger.commentId,
      iteration: campaignDispatch.iteration,
      expectedHead: campaignDispatch.expectedHead,
    });
  } catch (error) {
    console.error("campaign dispatch rollback failed", error);
  }
}

async function dispatchWorkerRoute(route) {
  const job = createSignedJob(
    route.workerTrigger,
    route.workerCommand,
    config.workerDispatchSecret,
  );
  try {
    await dispatchRepositoryEvent(
      config,
      config.controlRepository,
      config.dispatchEventType,
      wrapSignedJob(job),
    );
  } catch (error) {
    await rollbackCampaignDispatch(route);
    throw error;
  }
}

function rememberedResponse(deliveryId, response) {
  rememberDelivery(deliveryId);
  return response;
}

async function handleOcMainWebhook(rawBody, headers) {
  const signature = headers["x-hub-signature-256"];
  if (!verifyWebhookSignature(rawBody, signature, config.githubWebhookSecret)) {
    return { status: 401, body: "invalid signature\n" };
  }

  const deliveryId = headers["x-github-delivery"];
  if (isDuplicate(deliveryId)) {
    return { status: 202, body: "duplicate\n" };
  }

  const eventName = headers["x-github-event"];
  const payload = JSON.parse(rawBody.toString("utf8"));
  const { pullTrigger, issueTrigger, trigger } = acceptedTrigger(
    eventName,
    payload,
  );
  if (!trigger) {
    return rememberedResponse(deliveryId, {
      status: 202,
      body: "ignored\n",
    });
  }
  if (!config.allowedUserIds.has(trigger.commentUserId)) {
    return rememberedResponse(deliveryId, {
      status: 202,
      body: "ignored\n",
    });
  }

  const command = parseCommand(trigger.commentBody, config);
  if (!command) {
    return rememberedResponse(deliveryId, {
      status: 202,
      body: "ignored\n",
    });
  }
  if (!trigger.repository || !trigger.commentId) {
    throw new Error(
      "Webhook payload is missing required repository or comment metadata",
    );
  }

  const route = await workerRoute(pullTrigger, issueTrigger, command);
  if (route.response) {
    return rememberedResponse(deliveryId, route.response);
  }

  await dispatchWorkerRoute(route);
  rememberDelivery(deliveryId);
  console.log(
    `dispatched ${route.workerTrigger.repository}#${route.workerTrigger.pullNumber} from ${route.workerTrigger.commentUserLogin || route.workerTrigger.commentUserId}`,
  );
  return { status: 202, body: "queued\n" };
}

function isGitHubWebhookPath(url) {
  return url === config.githubIngressPath || url === config.webhookPath;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    respond(response, 200, "ok\n");
    return;
  }

  if (request.method !== "POST" || !isGitHubWebhookPath(request.url)) {
    respond(response, 404, "not found\n");
    return;
  }

  try {
    const rawBody = await readBody(request);

    // /github is the stable shared GitHub App ingress. Today it routes to the
    // oc-main consumer. Future consumers can be added here without changing
    // the GitHub App webhook URL. The raw body is kept byte-for-byte intact.
    const result = await handleOcMainWebhook(rawBody, request.headers);
    respond(response, result.status, result.body);
  } catch (error) {
    console.error("webhook error", error);
    respond(response, 500, "dispatch failed\n");
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    `oc-main listening on :${config.port}; ingress=${config.githubIngressPath}; consumer=${config.webhookPath}`,
  );
});
