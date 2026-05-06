# ═══════════════════════════════════════════════════════════════════════════
# MCP SERVER DOCKERFILE
# ═══════════════════════════════════════════════════════════════════════════
#
# Multi-stage Dockerfile per MCP Infrastructure & Deployment Standard §3:
# alpine base, non-root UID 1001, runtime stage named `runtime`,
# HEALTHCHECK against /health, EXPOSE 3000, ENV PORT=3000.
#
# IMPORTANT: The database must be pre-built BEFORE running docker build.
# It is NOT built during the Docker build because the full DB includes
# ingested data (12K+ case law entries) that requires hours of network
# scraping. Build it locally first, then bake it into the image.
#
# Free tier (seeds only, ~45 MB):
#   npm run build:db
#   docker build -t swedish-law-mcp .
#
# Full tier (seeds + ingested case law, ~80 MB):
#   npm run build:db
#   npm run ingest:cases:full-archive
#   npm run build:db:paid
#   docker build -t swedish-law-mcp .
#
# ═══════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────
# STAGE 1: BUILD
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# STAGE 2: RUNTIME
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS runtime

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY data/database.db ./data/database.db

# Non-root user (UID 1001 per infrastructure standard §3)
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nodejs -G nodejs \
    && chown -R nodejs:nodejs /app/data
USER nodejs

ENV NODE_ENV=production
ENV PORT=3000
# WASM SQLite loads the entire DB into memory — 122MB DB needs extra heap
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV SWEDISH_LAW_DB_PATH=/app/data/database.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{r.ok||process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/http-server.js"]
