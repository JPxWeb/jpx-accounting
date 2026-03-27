# ---------------------------------------------------------------------------
# JPX Accounting – Next.js Web App (multi-stage Docker build)
# Deployed as a container to Azure App Service.
# ---------------------------------------------------------------------------

# Stage 1: Build
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

# Copy entire monorepo (filtered by .dockerignore)
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all workspace packages (contracts, domain, ui-tokens, etc.) then web
RUN pnpm build

# Stage 2: Production runner
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Copy the standalone output from builder.
# Next.js standalone includes server.js + minimal node_modules.
# Using cp -rL in the builder would break the Docker layer cache,
# so we copy directly — symlinks inside the container work fine
# because the pnpm store is also present in the builder stage.
# We use a multi-stage copy which naturally dereferences symlinks.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 8080

# Next.js standalone server.js respects PORT and HOSTNAME env vars
CMD ["node", "apps/web/server.js"]
