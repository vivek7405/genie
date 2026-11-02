# Production image for the genie webjs app.
#
# Works with a plain `docker build` / `docker compose up`, and with any host
# that builds from a Dockerfile.
#
# webjs serves .ts directly by stripping types at the runtime layer, so there is
# NO JavaScript build step (webjs is buildless end to end; there is no bundler or
# esbuild fallback). This image runs the app on **Bun**: the type-strip comes from
# `amaro`, the server serves via Bun.serve, and `webjs db migrate` runs under Bun
# (the CLI resolves drizzle-kit without npx, #570), so no Node is needed. webjs also
# runs on Node 24+; for a Node base instead, swap to `node:24-alpine` and start with
# `npm start`.
#
# Security headers are set by the framework, not the proxy. webjs emits
# X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and
# Permissions-Policy on every response, plus Strict-Transport-Security in
# production over HTTPS (detected from X-Forwarded-Proto on the trusted
# edge). So the baseline needs no reverse-proxy config. Override or extend
# per path with package.json "webjs": { "headers": [...] }. See the
# framework AGENTS.md "Secure response headers" section.
FROM oven/bun:1-slim

# The Debian-based oven/bun image ships ca-certificates for outbound TLS (e.g. a
# managed Postgres). SQLite uses the built-in bun:sqlite (no native module), so no
# build toolchain is needed.

WORKDIR /app

# Install deps first so this layer is cached unless the manifests change.
# bun.lock is optional (absent when scaffolded with --no-install); the glob keeps
# the COPY working with or without it. SQLite uses the built-in bun:sqlite, so no
# native dependency or postinstall is involved.
# Production dependencies only: the image never runs the type checker, the
# test runner or the browser tests, and leaving them out keeps it a fraction
# of the size. What the boot itself runs (drizzle-kit for `webjs db migrate`,
# the Tailwind CLI for the CSS compile) is a production dependency for that
# reason. bun's package cache is emptied in the same layer: it is a second copy
# of every package fetched and would otherwise ship in the image.
COPY package.json bun.lock* ./
RUN bun install --production && bun pm cache rm

# App source. node_modules and local state are excluded via .dockerignore.
COPY . .

# Drizzle has no client-codegen step, so there is nothing to build here. The
# database is migrated at boot via `webjs start` (the `webjs.start.before`
# step runs `webjs db migrate`). See the CMD note below.

ENV NODE_ENV=production
# webjs start reads $PORT (default 8080). compose and most hosts set it.
ENV PORT=8080
EXPOSE 8080

# Platform-neutral readiness gate. webjs answers /__webjs/ready with 503 until
# the instance is fully warm (analysis + first vendor attempt), then 200. This
# HEALTHCHECK is honoured by Docker, compose, and most Docker-based platforms,
# so the gate works the same everywhere instead of needing a per-platform file.
# The probe is dependency-free (the runtime's built-in fetch, no curl/wget). For
# platforms that read their own config, point the equivalent knob at the same
# path (Railway healthcheckPath, Render healthCheckPath, Fly [checks], k8s
# readinessProbe); see AGENTS.md "Health and readiness probes".
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=5 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/__webjs/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# `bun --bun run start` runs the `start` script on Bun (the server serves via
# Bun.serve). `webjs start` runs the `webjs.start.before` steps: `webjs db migrate`
# (resolves drizzle-kit and runs it under Bun, no npx, #570) and, for a UI app,
# the Tailwind compile under `bun --bun` (no Node / npm in the image, #947), both
# idempotent, then serves on $PORT.
CMD ["bun", "--bun", "run", "start"]
