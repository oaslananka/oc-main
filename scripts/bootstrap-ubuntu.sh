#!/usr/bin/env bash
set -euo pipefail

OPENCODE_VERSION="${OPENCODE_VERSION:-1.18.35}"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)
    ASSET="opencode-linux-x64.tar.gz"
    SHA256="c8f888b451f5494a18f858fffb0e0b68f4e4baa9c241761c5f206884f0fa640d"
    ;;
  aarch64|arm64)
    ASSET="opencode-linux-arm64.tar.gz"
    SHA256="f7f2ba59ee8aa94d388f9696575a32d20e71c2ee48def9f80fc693a60fec6c72"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

sudo apt-get update
sudo apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git nodejs npm

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/${ASSET}" -o "$tmp/opencode.tar.gz"
echo "${SHA256}  $tmp/opencode.tar.gz" | sha256sum -c -
tar -xzf "$tmp/opencode.tar.gz" -C "$tmp"
sudo install -m 0755 "$tmp/opencode" /usr/local/bin/opencode

node --version
/usr/local/bin/opencode --version
bwrap --version
