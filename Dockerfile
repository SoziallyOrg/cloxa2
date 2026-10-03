# syntax=docker/dockerfile:1
#
# Builds apps/web (Next.js, App Router) for the Hostinger VPS. Multi-stage so
# the runtime image only ever contains the standalone server output — no
# monorepo source, no dev dependencies, no build-time secrets.
#
# Update the pinned digest with:
#   docker pull node:24-alpine
#   docker inspect --format='{{index .RepoDigests 0}}' node:24-alpine
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
# glibc compat shims some native addons (e.g. sharp) expect on Alpine.
RUN apk add --no-cache libc6-compat
RUN corepack enable

# --- pruner ---------------------------------------------------------------
# Slices the monorepo down to what @cloxa/web actually needs: its own source
# plus the workspace packages it depends on, with a matching pruned lockfile.
FROM base AS pruner
WORKDIR /app
RUN corepack prepare pnpm@11.25.0 --activate
COPY . .
RUN pnpm dlx turbo@2.5.6 prune @cloxa/web --docker

# --- installer --------------------------------------------------------------
FROM base AS installer
WORKDIR /app
RUN corepack prepare pnpm@11.25.0 --activate

# Dependencies first (cached while only source changes).
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
# `turbo prune` only follows files reachable from workspace package.jsons, so
# the shared root tsconfig (extended by every package's tsconfig.json) is
# missed. Pull it from the pruner's untouched source copy.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# Build-time public config. NEXT_PUBLIC_* values are inlined into the client
# bundle by design (they are not secret). CLOXA_SITE_URL is read at build
# time too, by next.config.ts, to pin the Server Actions allowed origin — it
# is not a secret, just the app's own public URL.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG CLOXA_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV CLOXA_SITE_URL=${CLOXA_SITE_URL}

# `apps/web/src/lib/env.server.ts` validates its server-only env with zod at
# module load, and that module is imported from code that `next build`
# evaluates (route handlers, the proxy). In production mode the schema
# requires real-looking values for things that are actually runtime secrets
# (SUPABASE_SECRET_KEY, AUTH_HASH_PEPPER, FLOW_COOKIE_SECRET, an Ed25519
# export-signing key). None of these are NEXT_PUBLIC_*, so Next never inlines
# them into the client bundle or the standalone server output — only
# NEXT_PUBLIC_* values get baked in. These placeholders exist purely to
# satisfy validation during the build; they are build-stage shell/ENV state
# only and are discarded when the final `runner` stage below starts from a
# fresh base and copies just the standalone build output. The real values are
# injected at container start via `env_file` (see deploy/docker-compose.yml).
ENV SUPABASE_SECRET_KEY=docker-build-placeholder-unused-at-runtime
ENV AUTH_HASH_PEPPER=docker-build-placeholder-pepper-0000000000000
ENV FLOW_COOKIE_SECRET=docker-build-placeholder-cookie-secret-000000
ENV CLOXA_PROXY_MODE=append:1
ENV EXPORT_SIGNING_KEY_ID=docker-build-placeholder
ENV NODE_ENV=production
# Emit the standalone server.js the runtime stage copies (see next.config.ts).
ENV CLOXA_STANDALONE=1

# A throwaway Ed25519 key: only its *shape* matters for the build-time zod
# check (see apps/web/src/lib/exports/signing.ts). It is not published
# anywhere and never signs a real export.
RUN EXPORT_SIGNING_KEY="$(node -e 'const {generateKeyPairSync}=require("node:crypto");const {privateKey}=generateKeyPairSync("ed25519");process.stdout.write(Buffer.from(privateKey.export({format:"pem",type:"pkcs8"})).toString("base64"))')" \
    pnpm turbo run build --filter=@cloxa/web

# --- runner -----------------------------------------------------------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next's standalone output mirrors the traced file tree from
# outputFileTracingRoot (the monorepo root, see apps/web/next.config.ts), so
# the server entrypoint lands at apps/web/server.js rather than at the image
# root. Static assets and public files are not part of the standalone trace
# and must be copied in separately.
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
