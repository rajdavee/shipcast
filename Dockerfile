# One image, many services: pick the service with SHIPCAST_SERVICE.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg chromium fonts-noto-color-emoji fonts-liberation git ca-certificates python3 python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium \
    SHIPCAST_HOME=/data \
    SHIPCAST_BIND=0.0.0.0

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services ./services
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN npm run build && npm install -g @anthropic-ai/claude-code
ENV NODE_ENV=production

EXPOSE 4317 4320 4321 4322 4323
CMD ["sh", "-c", "node services/${SHIPCAST_SERVICE:-api}/src/main.ts"]
