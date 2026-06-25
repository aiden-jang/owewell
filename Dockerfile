# Single-origin production image: Fastify serves the API (/api) and the built web app.
FROM node:22-slim AS base
# Prisma's query engine needs OpenSSL at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
# Install deps first (cached unless a package.json or the lockfile changes).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
# Build shared, server, and web.
COPY . .
RUN pnpm --filter @owe-well/server exec prisma generate
RUN pnpm -r build

FROM base AS runner
ENV NODE_ENV=production
ENV WEB_DIR=/app/packages/web/dist
# Bring over the installed deps + build output. DATABASE_URL is provided at runtime.
COPY --from=build /app /app
EXPOSE 3000
# Apply any pending migrations, then start the server (which serves the web app too).
CMD ["sh", "-c", "pnpm --filter @owe-well/server exec prisma migrate deploy && node packages/server/dist/index.js"]
