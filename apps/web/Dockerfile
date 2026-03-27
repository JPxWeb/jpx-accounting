FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

# Copy entire monorepo
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all workspace packages
RUN pnpm build

# The standalone output is now at /app/apps/web/.next/standalone
# and static assets at /app/apps/web/.next/static
# CI will extract these via docker cp
