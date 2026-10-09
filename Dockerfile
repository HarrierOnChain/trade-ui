# Trade UI for a server: `docker compose up -d` (see docker-compose.yml).
# The vault lives in the /data volume; back it up.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No install scripts: nothing here needs them (Electron's would only fetch
# the desktop runtime).
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build && npm run bundle

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TRADE_UI_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist/server ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.mjs"]
