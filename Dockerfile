# syntax=docker/dockerfile:1
#
# Precisa-se — Next.js app image.
#
# This single image serves BOTH Compose services described in
# ARCHITECTURE.md §3.1 / §8.1:
#   - `web`    -> CMD ["node", "server.js"]  (default, see bottom of this file)
#   - `worker` -> overridden `command:` in docker-compose.yml, running the
#                 notification worker (src/worker/notification-worker.ts)
#                 via the `tsx` binary already present in `node_modules`.
#
# The `runner` stage below therefore ships two things side by side:
#   1. The Next.js `output: "standalone"` bundle (`.next/standalone` +
#      `.next/static` + `public`) — a self-contained, trimmed server used
#      by the `web` command.
#   2. The full `node_modules` + TypeScript source (`src/`, `messages/`,
#      `tsconfig.json`) copied straight from the `builder` stage — needed
#      so `tsx` can run `src/worker/notification-worker.ts` directly
#      (no separate compile step, no second image). This is a deliberate
#      trade-off: the image is larger than a web-only standalone image
#      would be, in exchange for §3.1's "no second codebase to maintain"
#      — one Dockerfile, one image tag, two `command:` overrides.

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=9.15.4

# ---------------------------------------------------------------------------
# Stage 1: base — shared Node + pnpm toolchain
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
# Corepack ships with Node but is opt-in; pin an exact pnpm version so
# builds are reproducible regardless of the corepack default at build time.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 2: deps — install dependencies (own layer for cache reuse)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: builder — compile the Next.js app (standalone output)
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets are needed at build time for the MVP; NEXT_PUBLIC_* build args
# can be added here later without changing this stage's shape.
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm build

# ---------------------------------------------------------------------------
# Stage 4: runner — minimal production runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root execution (Docker security hardening checklist).
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Next.js `output: "standalone"` (next.config.ts) produces a self-contained
# server bundle with only the node_modules it actually needs — this is what
# keeps the `web` command's dependency footprint small.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Notification worker runtime (§3.1, see comment at top of file): the full
# node_modules (superset of what standalone needs — includes `tsx` and
# every runtime dependency the worker's TypeScript imports resolve to) plus
# the TypeScript source itself, so `tsx` can execute
# src/worker/notification-worker.ts without a separate build/image.
# `node_modules` here is copied on top of (merged with) the trimmed one
# from `.next/standalone` above — Docker COPY merges directory contents, so
# the `web` command keeps working unchanged and simply ends up with a
# superset of modules available.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/messages ./messages
COPY --from=builder --chown=nextjs:nodejs /app/src ./src

USER nextjs
EXPOSE 3000

# Liveness check hits the app root. Switch to GET /health once that route
# is implemented (ARCHITECTURE.md §9: DB ping + worker liveness).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/', r => process.exit(r.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))"

# Default command runs the `web` service. The `worker` service in
# docker-compose.yml overrides this to run the notification worker via
# `tsx` instead — see the comment at the top of this file.
CMD ["node", "server.js"]
