#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${DOPPLER_TOKEN_FILE:-/run/secrets/runtime_bootstrap}"

if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "Doppler bootstrap credential is unavailable" >&2
  exit 1
fi

export DOPPLER_TOKEN
DOPPLER_TOKEN="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TOKEN_FILE")"

if [[ -z "$DOPPLER_TOKEN" ]]; then
  echo "Doppler bootstrap credential is empty" >&2
  exit 1
fi

exec /usr/local/bin/doppler run \
  --project oc-main \
  --config main \
  -- /usr/bin/env -u DOPPLER_TOKEN node /opt/oc-main/src/server.mjs
