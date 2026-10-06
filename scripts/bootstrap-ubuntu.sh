#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  bubblewrap \
  ca-certificates \
  curl \
  git \
  nodejs \
  npm

"$(dirname "$0")/install-opencode.sh"
"$(dirname "$0")/install-doppler.sh"

node --version
/usr/local/bin/opencode --version
/usr/local/bin/doppler --version
bwrap --version
