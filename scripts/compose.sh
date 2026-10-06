#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this helper with sudo so Docker can read /etc/oc-main/runtime-bootstrap." >&2
  exit 1
fi

if [[ ! -r /etc/oc-main/runtime-bootstrap ]]; then
  echo "Missing /etc/oc-main/runtime-bootstrap" >&2
  exit 1
fi

exec docker compose -f compose.yml "$@"
