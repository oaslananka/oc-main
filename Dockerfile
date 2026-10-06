FROM node:24.21.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-opencode.sh scripts/install-doppler.sh /tmp/installers/
RUN /tmp/installers/install-opencode.sh \
    && /tmp/installers/install-doppler.sh \
    && rm -rf /tmp/installers

WORKDIR /opt/oc-main

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node runtime ./runtime
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node doppler.yaml ./

RUN chmod 0755 scripts/*.sh

ENV NODE_ENV=production

USER node

ENTRYPOINT ["/opt/oc-main/scripts/run-with-doppler.sh"]
