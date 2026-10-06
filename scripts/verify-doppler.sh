#!/usr/bin/env bash
set -euo pipefail

: "${DOPPLER_TOKEN:?DOPPLER_TOKEN must be set}"

exec /usr/local/bin/doppler run \
  --project oc-main \
  --config main \
  -- /usr/bin/env -u DOPPLER_TOKEN node -e '
const required = [
  "PORT",
  "WEBHOOK_PATH",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_WEBHOOK_SECRET",
  "ALLOWED_GITHUB_USER_IDS",
  "DEFAULT_MODEL",
  "ALLOWED_MODELS",
  "WORK_ROOT",
  "MAX_CONCURRENT_JOBS",
  "OPENCODE_TIMEOUT_MS",
  "SANDBOX_MODE",
];

if (process.env.SANDBOX_MODE === "docker") {
  required.push("OPENCODE_WORKER_IMAGE", "DOCKER_SOCKET");
}
if (process.env.SANDBOX_MODE === "bwrap") {
  required.push("OPENCODE_BIN");
}

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error("Missing Doppler keys: " + missing.join(", "));
  process.exit(1);
}
console.log("Doppler configuration contains all required oc-main runtime keys.");
'
