#!/usr/bin/env bash
set -euo pipefail

DOPPLER_VERSION="3.76.6"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)
    ASSET="doppler_${DOPPLER_VERSION}_linux_amd64.tar.gz"
    SHA256="67e4e020761adf3ffe5a030712d61721b4e2752182670bf90de5a2a88e4961e3"
    ;;
  aarch64|arm64)
    ASSET="doppler_${DOPPLER_VERSION}_linux_arm64.tar.gz"
    SHA256="621456ac08436c4037a72c8641e4bdcccd0e404ab43b79a61d449445bb02e6e5"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}/${ASSET}" -o "$tmp/doppler.tar.gz"
echo "${SHA256}  $tmp/doppler.tar.gz" | sha256sum -c -
tar -xzf "$tmp/doppler.tar.gz" -C "$tmp"
sudo install -m 0755 "$tmp/doppler" /usr/local/bin/doppler

/usr/local/bin/doppler --version
