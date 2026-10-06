#!/usr/bin/env bash
set -euo pipefail

: "${CREDENTIALS_DIRECTORY:?systemd credentials directory is required}"

TOKEN_FILE="${CREDENTIALS_DIRECTORY}/doppler-token"
if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "Doppler credential is unavailable" >&2
  exit 1
fi

export DOPPLER_TOKEN
DOPPLER_TOKEN="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TOKEN_FILE")"

if [[ -z "$DOPPLER_TOKEN" ]]; then
  echo "Doppler credential is empty" >&2
  exit 1
fi


exec /usr/local/bin/doppler run   --project oc-main   --config main   --config-dir /var/lib/oc-main/doppler   --fallback=/var/lib/oc-main/doppler/fallback.json   -- /usr/bin/env -u DOPPLER_TOKEN /usr/bin/node /opt/oc-main/src/server.mjs
