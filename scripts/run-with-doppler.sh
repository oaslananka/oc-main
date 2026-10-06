#!/usr/bin/env bash
set -euo pipefail

TOKEN_FILE="${DOPPLER_TOKEN_FILE:-}"

if [[ -z "$TOKEN_FILE" && -n "${CREDENTIALS_DIRECTORY:-}" ]]; then
  TOKEN_FILE="${CREDENTIALS_DIRECTORY}/doppler-token"
fi

if [[ -z "$TOKEN_FILE" || ! -r "$TOKEN_FILE" ]]; then
  echo "Doppler credential is unavailable" >&2
  exit 1
fi

export DOPPLER_TOKEN
DOPPLER_TOKEN="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TOKEN_FILE")"

if [[ -z "$DOPPLER_TOKEN" ]]; then
  echo "Doppler credential is empty" >&2
  exit 1
fi

install -d -m 0700 "${HOME:-/var/lib/oc-main/controller-home}" /var/lib/oc-main/jobs

exec /usr/local/bin/doppler run \
  --project oc-main \
  --config main \
  -- /usr/bin/env -u DOPPLER_TOKEN node /opt/oc-main/src/server.mjs
