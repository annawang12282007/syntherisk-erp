FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_SOURCE_URL=https://github.com/annawang12282007/syntherisk-erp
ENV NEXT_PUBLIC_SOURCE_URL=$NEXT_PUBLIC_SOURCE_URL
ARG NEXT_PUBLIC_LICENSE_URL=https://github.com/annawang12282007/syntherisk-erp/blob/main/LICENSE
ENV NEXT_PUBLIC_LICENSE_URL=$NEXT_PUBLIC_LICENSE_URL
# Build-only random secret. Runtime requires its own persisted environment secret.
RUN BETTER_AUTH_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))") APP_URL=http://localhost:3000 pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/LICENSE /app/NOTICE ./
RUN mkdir -p /app/data/attachments /app/backups && chown -R node:node /app/data /app/backups
USER node
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
