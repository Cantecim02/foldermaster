# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    DOWNLOAD_DIR=/app/data/downloads \
    DATABASE_PATH=/app/data/editio.sqlite \
    HOME=/app/data \
    npm_config_cache=/app/data/npm-cache

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    fontconfig \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/cleanup-expired.js ./scripts/cleanup-expired.js

RUN mkdir -p /app/data/downloads/uploads /app/data/npm-cache /app/data/tmp \
  && chown -R node:node /app/data \
  && chown root:root /home/node \
  && chmod 755 /home/node \
  && chmod 750 /app/data /app/data/downloads /app/data/downloads/uploads /app/data/npm-cache /app/data/tmp \
  && chmod 755 /app \
  && chmod -R a-w /app/src /app/scripts \
  && chmod a-w /app/package.json /app/package-lock.json

ENV TMPDIR=/app/data/tmp


USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const port=process.env.PORT||4000; fetch('http://127.0.0.1:'+port+'/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start:prod"]
