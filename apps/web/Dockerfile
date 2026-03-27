FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

# ── Build stage ──
FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── Production stage ──
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy standalone output (includes node_modules with proper symlinks)
COPY --from=builder /app/apps/web/.next/standalone ./
# Copy static assets
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# Copy public dir if it exists (using a wildcard trick)
COPY --from=builder /app/apps/web/publi[c] ./apps/web/public

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
