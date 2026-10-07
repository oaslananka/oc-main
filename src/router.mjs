import http from "node:http";
import https from "node:https";

const PORT = Number.parseInt(process.env.ROUTER_PORT || "8788", 10);
const PUBLIC_PATH = process.env.GITHUB_INGRESS_PATH?.trim() || "/github";
const TARGETS = (process.env.GITHUB_WEBHOOK_TARGETS ||
  "http://controller:8787/github/oc-main")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => new URL(value));

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

if (!Number.isSafeInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error("ROUTER_PORT must be a valid TCP port");
}
if (!PUBLIC_PATH.startsWith("/") || PUBLIC_PATH.includes("?") || PUBLIC_PATH.includes("#")) {
  throw new Error("GITHUB_INGRESS_PATH must be an absolute URL path");
}
if (TARGETS.length === 0) {
  throw new Error("GITHUB_WEBHOOK_TARGETS must contain at least one target");
}
for (const target of TARGETS) {
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("GitHub webhook targets must use http or https");
  }
  if (target.username || target.password || target.hash || target.search) {
    throw new Error("GitHub webhook targets must not contain credentials, query, or fragment");
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Webhook payload too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function forwardedHeaders(headers, bodyLength) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  result["content-length"] = String(bodyLength);
  return result;
}

function forward(target, requestHeaders, rawBody) {
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: forwardedHeaders(requestHeaders, rawBody.length),
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        let size = 0;

        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("Webhook target response exceeded the size limit"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode || 502,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Webhook target timed out"));
    });
    request.on("error", reject);
    request.end(rawBody);
  });
}

function respond(response, status, body = "") {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    respond(response, 200, "ok\n");
    return;
  }

  if (request.method !== "POST" || request.url !== PUBLIC_PATH) {
    respond(response, 404, "not found\n");
    return;
  }

  try {
    const rawBody = await readBody(request);
    const results = await Promise.all(
      TARGETS.map((target) => forward(target, request.headers, rawBody)),
    );

    const unauthorized = results.find((result) => result.status === 401);
    if (unauthorized) {
      respond(response, 401, unauthorized.body.toString("utf8") || "invalid signature\n");
      return;
    }

    const failed = results.find(
      (result) => result.status < 200 || result.status >= 300,
    );
    if (failed) {
      console.error(
        `github router downstream failure status=${failed.status} delivery=${request.headers["x-github-delivery"] || "unknown"}`,
      );
      respond(response, 502, "downstream webhook failed\n");
      return;
    }

    console.log(
      `github router delivered event=${request.headers["x-github-event"] || "unknown"} delivery=${request.headers["x-github-delivery"] || "unknown"} targets=${results.length}`,
    );
    respond(response, 202, "accepted\n");
  } catch (error) {
    console.error("github router error", error);
    respond(response, 502, "router failed\n");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `github webhook router listening on :${PORT} at ${PUBLIC_PATH}; targets=${TARGETS.length}`,
  );
});
