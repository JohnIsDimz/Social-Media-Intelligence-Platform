# S.M.I.P on a VPS.
#
# Notes that matter here:
#   1. No native modules and no database driver on disk: storage is Supabase over
#      HTTPS, so the image needs no python/make/g++ toolchain and holds no state.
#   2. The runtime stage carries only production dependencies plus `dist/`, and
#      runs as the unprivileged `node` user with a healthcheck wired to /api/health.
#      The container is stateless: redeploying it loses nothing.

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

RUN chown -R node:node /app

EXPOSE 3000

# Liveness, not readiness: /api/health returns 503 when Supabase is unreachable,
# and restarting the container would not fix a wrong key or an unapplied schema.
# The check therefore only asks whether the process answers at all.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.status<600?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "dist/server.cjs"]
