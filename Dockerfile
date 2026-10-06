FROM node:24.21.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      jq \
      python3 \
      python3-pip \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-opencode.sh scripts/install-doppler.sh /tmp/installers/
RUN /tmp/installers/install-opencode.sh \
    && /tmp/installers/install-doppler.sh \
    && rm -rf /tmp/installers

WORKDIR /opt/oc-main

COPY package.json ./
COPY src ./src
COPY runtime ./runtime
COPY scripts ./scripts
COPY doppler.yaml ./

RUN chmod 0755 scripts/*.sh

ENV NODE_ENV=production

ENTRYPOINT ["/opt/oc-main/scripts/run-with-doppler.sh"]
