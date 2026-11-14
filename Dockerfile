# S.M.I.P on a VPS.
#
# Two changes from a naive build matter here:
#   1. No native modules. SQLite runs on Node's built-in `node:sqlite`, so the
#      image needs no python/make/g++ toolchain and cannot break when the Node
#      patch version moves.
#   2. The runtime stage carries only production dependencies plus `dist/`, and
#      runs as the unprivileged `node` user with a healthcheck wired to /api/health.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ── Stage 2: production dependencies only ─────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# The SQLite cache lives here. Mount a volume on /app/src/data so collected
# mentions survive redeploys; the directory must exist and be writable.
RUN mkdir -p /app/src/data && chown -R node:node /app/src/data /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "dist/server.cjs"]
