FROM node:24.21.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-doppler.sh /tmp/install-doppler.sh
RUN /tmp/install-doppler.sh && rm -f /tmp/install-doppler.sh

WORKDIR /opt/oc-main

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node doppler.yaml ./

RUN chmod 0755 scripts/*.sh

ENV NODE_ENV=production
ENV HOME=/tmp/oc-main-home

USER node

ENTRYPOINT ["/opt/oc-main/scripts/run-with-doppler.sh"]
