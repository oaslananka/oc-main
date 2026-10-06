import path from "node:path";

const CURRENT_DEFAULT_MODELS = [
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/big-pickle",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function csv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function privateKey() {
  const base64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (base64) return Buffer.from(base64, "base64").toString("utf8");

  const plain = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (plain) return plain.replaceAll("\\n", "\n");

  throw new Error(
    "Missing GITHUB_APP_PRIVATE_KEY_BASE64 or GITHUB_APP_PRIVATE_KEY",
  );
}

function webhookPath() {
  const value = process.env.WEBHOOK_PATH?.trim() || "/oaslananka-ops";
  if (
    !value.startsWith("/") ||
    value.length > 200 ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("WEBHOOK_PATH must be a safe absolute URL path");
  }
  return value;
}

export function loadConfig() {
  const allowedModels = new Set(
    csv(process.env.ALLOWED_MODELS || CURRENT_DEFAULT_MODELS.join(",")),
  );
  const defaultModel =
    process.env.DEFAULT_MODEL?.trim() || CURRENT_DEFAULT_MODELS[0];

  if (!allowedModels.has(defaultModel)) {
    throw new Error("DEFAULT_MODEL must be present in ALLOWED_MODELS");
  }

  const allowedUserIds = new Set(
    csv(required("ALLOWED_GITHUB_USER_IDS")).map((value) => {
      const id = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("ALLOWED_GITHUB_USER_IDS must contain numeric GitHub IDs");
      }
      return id;
    }),
  );

  return {
    port: positiveInteger("PORT", 8787),
    webhookPath: webhookPath(),
    githubAppId: required("GITHUB_APP_ID"),
    githubPrivateKey: privateKey(),
    githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
    workerDispatchSecret: required("WORKER_DISPATCH_SECRET"),
    controlRepository: required("CONTROL_REPOSITORY"),
    dispatchEventType: process.env.DISPATCH_EVENT_TYPE?.trim() || "oc-run",
    allowedUserIds,
    allowedModels,
    defaultModel,
    opencodeBin: process.env.OPENCODE_BIN?.trim() || "/usr/local/bin/opencode",
    opencodeTimeoutMs: positiveInteger("OPENCODE_TIMEOUT_MS", 1_200_000),
    actionWorkRoot: path.resolve(
      process.env.OC_ACTION_WORK_ROOT?.trim() ||
        path.join(process.env.RUNNER_TEMP || "/tmp", "oc-main-job"),
    ),
  };
}
