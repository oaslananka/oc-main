#!/usr/bin/env bash
set -euo pipefail

OPENCODE_VERSION="${OPENCODE_VERSION:-2.0.24}"
PACKAGE="@opencode/cli@${OPENCODE_VERSION}"

command -v npm >/dev/null 2>&1 || { echo "npm is required to install OpenCode v2" >&2; exit 1; }

npm install --global --no-audit --no-fund --loglevel=error "$PACKAGE"

resolved="$(command -v opencode)"
if [[ -z "$resolved" ]]; then
  echo "OpenCode binary was not installed" >&2
  exit 1
fi

if [[ "$resolved" != "/usr/local/bin/opencode" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    ln -sfn "$resolved" /usr/local/bin/opencode
  else
    sudo ln -sfn "$resolved" /usr/local/bin/opencode
  fi
fi

actual_raw="$(/usr/local/bin/opencode --version | tr -d "\\r" | tail -n 1)"
actual="${actual_raw#opencode v}"
actual="${actual#v}"
if [[ "$actual" != "$OPENCODE_VERSION" ]]; then
  echo "Expected OpenCode ${OPENCODE_VERSION}, got ${actual_raw}" >&2
  exit 1
fi

echo "OpenCode ${actual} installed from ${PACKAGE}"
