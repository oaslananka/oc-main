#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this helper with sudo so it can prepare /var/lib/oc-main." >&2
  exit 1
fi

if [[ ! -S /var/run/docker.sock ]]; then
  echo "Docker socket not found at /var/run/docker.sock" >&2
  exit 1
fi

export DOCKER_GID="${DOCKER_GID:-$(stat -c '%g' /var/run/docker.sock)}"

install -d -o 1000 -g 1000 -m 0700 \
  /var/lib/oc-main \
  /var/lib/oc-main/jobs \
  /var/lib/oc-main/controller-home

exec docker compose -f compose.yml "$@"
