FROM node:22-bookworm-slim

WORKDIR /workspace

# Git is used only to apply/check a proposal inside the disposable image.
# No repository metadata, credentials, sockets, or host worktree are copied.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

ENV NODE_ENV=test \
    CI=true \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    GAUSS_RUNTIME_MODE=suspended \
    TURING_AUTOSCALER_ENABLED=false \
    TURING_RADIATION_SCHEDULER_ENABLED=false \
    TURING_NETWORK_INVENTORY_ENABLED=false

CMD ["sh", "/workspace/scripts/self-modification/container-entrypoint.sh"]
