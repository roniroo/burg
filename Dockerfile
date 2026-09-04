# Burg — development image.
#
# The app is a single Next.js service. The database, auth and storage come from
# Supabase, which runs its own container stack via the Supabase CLI (see DEV.md)
# rather than being reproduced here: it is a dozen services and the CLI already
# orchestrates them correctly.

# syntax=docker/dockerfile:1

# ---------- base ----------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- dependencies --------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# Native postinstalls (esbuild, unrs-resolver) are needed for vitest and lint.
RUN npm ci --no-audit --no-fund \
 && npm rebuild esbuild unrs-resolver

# ---------- development ---------------------------------------------------
# Source is bind-mounted by compose, so this layer only carries the toolchain.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# ---------- production build ----------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs the public env vars at build time; they are baked into the client
# bundle. Pass them with --build-arg to build a deployable image.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json next.config.ts ./
EXPOSE 3000
CMD ["npm", "run", "start"]
