# IPTVISION PWA: the web app is built once, then served by a small Node server with SQLite inside.
# ffmpeg converts what the browser cannot play (MKV, AC3/MP2 audio); the video is copied, not re-encoded.

FROM node:24-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY shared ./shared
# The app shows the server version it was built with.
COPY server/package.json ./server/package.json
COPY web ./web
RUN cd web && npm run build

FROM node:24-alpine
RUN apk add --no-cache openssl tini ffmpeg
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY server/src ./server/src
COPY --from=web /src/server/public ./server/public
COPY casaos/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 HTTPS_PORT=8443
EXPOSE 8080 8443
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/session >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
