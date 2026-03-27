FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

WORKDIR /app

# Copy entire monorepo
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all workspace packages
RUN pnpm build

# Dereference ALL pnpm symlinks in standalone output.
# This is critical: docker cp preserves symlinks, but Azure App Service
# cannot resolve symlinks that pointed to the pnpm virtual store inside
# this container. cp -rL follows all symlinks and creates real files.
RUN cp -rL apps/web/.next/standalone web-standalone \
 && cp -rL apps/web/.next/static web-standalone/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -rL apps/web/public web-standalone/apps/web/public; fi
