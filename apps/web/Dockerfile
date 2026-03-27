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

# Fix @swc/helpers exports map resolution.
# The package uses exports: { "./_/*": "./cjs/*.cjs" } but Azure's
# WEBSITE_RUN_FROM_PACKAGE squashfs mount doesn't resolve this correctly.
# Create a physical _/ directory with the actual CJS files.
RUN SWC_DIR="web-standalone/node_modules/@swc/helpers" \
 && if [ -d "$SWC_DIR/cjs" ]; then \
      mkdir -p "$SWC_DIR/_" \
      && for f in "$SWC_DIR"/cjs/*.cjs; do \
           name=$(basename "$f" .cjs); \
           cp "$f" "$SWC_DIR/_/${name}.js"; \
         done; \
      echo "Created $(ls "$SWC_DIR/_" | wc -l) files in @swc/helpers/_/"; \
    else \
      echo "WARNING: @swc/helpers/cjs not found"; \
    fi
