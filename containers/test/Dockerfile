FROM node:22-bookworm-slim

WORKDIR /workspace

# Install dependencies in an image layer. The repository and its .env files are
# copied only after this step; .dockerignore excludes all local credentials.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

ENV NODE_ENV=test \
    CI=true \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    PROXY_HOST=127.0.0.1 \
    PROXY_PORT=3001 \
    AUTH_REQUIRED=true \
    ALLOW_PRIVATE_NETWORK_ORIGINS=false \
    GAUSS_RUNTIME_MODE=suspended \
    TURING_AUTOSCALER_ENABLED=false \
    TURING_RADIATION_SCHEDULER_ENABLED=false \
    TURING_NETWORK_INVENTORY_ENABLED=false

# The default command is overridden by the Compose test service.
CMD ["npm", "test"]
