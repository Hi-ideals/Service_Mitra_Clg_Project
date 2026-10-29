# ServiceSetu API
#
# Two stages so the runtime image carries production dependencies only - the
# dev toolchain is left behind in the builder rather than shipped to a server.

# ---------------------------------------------------------------- deps
FROM node:22-alpine AS deps

WORKDIR /app

# Only the manifests, so this layer is rebuilt when dependencies change rather
# than on every source edit.
COPY package.json package-lock.json ./

# `npm ci` installs exactly the lockfile, which is the point of having one.
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------- runtime
#
# Pinned to Alpine 3.23 rather than floating on `node:22-alpine`, because that
# is the first Alpine release carrying postgresql18-client - and the backup
# feature needs a pg_dump matching the postgres:18 server in compose. pg_dump
# refuses outright to dump a server newer than itself.
#
# If the database image ever moves to a new major version, this package must
# move with it. The admin backup screen reports a mismatch in words an admin
# can act on rather than failing silently, but it reports it after the fact.
FROM node:22-alpine3.23 AS runtime

# tini reaps zombies and forwards signals properly. Without an init, a SIGTERM
# from `docker stop` reaches PID 1 in a way Node ignores, so the graceful
# shutdown this app implements - draining requests, closing the pool - never
# runs and the container is killed after the timeout instead.
#
# postgresql18-client is pg_dump, for the backups the admin console takes, and
# tar archives the uploads directory alongside them - the KYC documents are
# files, and no database dump covers them.
RUN apk add --no-cache tini postgresql18-client tar

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

# The uploads directory holds KYC documents. It is a mount point for a volume
# in compose; created here with the right owner so the container can write to
# it even if someone runs the image without one.
RUN mkdir -p /app/uploads/private /app/uploads/public /app/logs /app/backups \
 && chown -R node:node /app/uploads /app/logs /app/backups

# Drops root. The API binds 5000, which needs no privilege.
USER node

EXPOSE 5000

# Reports unhealthy until the API answers, which is what lets compose hold the
# web container back until the API is genuinely serving rather than merely
# started.
HEALTHCHECK --interval=15s --timeout=4s --start-period=25s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/v1/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
