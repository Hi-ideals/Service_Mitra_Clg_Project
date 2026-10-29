# ServiceSetu - Backend API

Local service marketplace API. Node.js + Express.js + PostgreSQL, built in 12
phases against `ServiceSetu_Architecture_Overview.pdf`.

## Requirements

- Node.js 18+ (developed on 26)
- PostgreSQL 14+ (developed on 18)

## Setup

```bash
npm install
cp .env.example .env      # then set DB_PASSWORD and the JWT secrets
npm run db:create
npm run migrate
npm run seed
npm run dev
```

The API is then on `http://localhost:5000/api/v1` and liveness is on
`http://localhost:5000/health`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start with file watching |
| `npm start` | Start normally |
| `npm run db:create` | Create the database if it does not exist |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:status` | Show applied and pending migrations |
| `npm run migrate:down` | Roll back the most recent migration |
| `npm run db:reset` | Roll everything back and re-seed (development only) |
| `npm run seed` | Load seed data |
| `npm test` | Run the test suite (serially - see below) |

## Layout

```
src/
  config/      env validation, logger, domain constants
  db/          connection pool, migration runner, migrations, seeds
  middleware/  request context, validation, rate limits, error handler
  modules/     one folder per domain module (routes, controller, service, repository)
  routes/      API v1 router, health endpoints
  services/    cross-cutting services (notifications, storage, payments)
  jobs/        background workers
  utils/       error type, response envelope, helpers
```

Business rules live in `modules/*/​*.service.js` only. Routes declare access,
controllers translate HTTP, repositories talk SQL, and nothing else touches the
database.

## Conventions

**Response envelope.** Every success looks like
`{ success: true, message, data, meta? }`, every failure like
`{ success: false, error: { code, message, details? }, requestId }`.

**Correlation id.** Every request gets an `X-Request-Id` (generated, or passed
through from the client) which appears on the response and in every log line it
produced.

**Money** is stored and computed as integer minor units (paise), never floats.

**Transactions.** Anything that must agree with something else - a booking and
its payment, a refund and its ledger entry - is wrapped in `withTransaction`.

## Tests

These are integration tests against a real PostgreSQL database, not unit tests
with mocks. They run with `--test-concurrency=1` deliberately: several suites
book the same seeded provider, and in parallel they compete for that provider's
calendar and trip the double-booking constraint. The constraint is right; the
parallelism was wrong.

Each suite cleans up after itself and restores any seeded row it modified.

## Payments and email

Both default to a built-in test double, so nothing needs configuring to run the
app. `../SETUP_PAYMENTS_AND_EMAIL.md` covers connecting the real services.

**Payments** go through a driver interface in `src/services/payment/`. Nothing
outside that folder knows which gateway is in use - swapping `mock` for
`razorpay` is one environment variable.

A Razorpay webhook cannot reach localhost, so a completed checkout would
otherwise stay pending forever in development. `POST /payments/verify` closes
that gap: it takes the handshake the browser gets back, verifies the signature
against the key secret, then reads the payment from Razorpay's own API to
confirm it was captured for the right amount. The browser is the messenger, not
the authority. Worth keeping in production too - a webhook that never arrives
is a real failure mode.

**Verification codes go by email**, not SMS. Every SMS has a per-send cost and a
verification code is the highest-volume message the platform sends. In
development `EMAIL_DRIVER=console` prints the code to the log, so sign-up works
with no mail server at all.

## Health

| Endpoint | Meaning |
|----------|---------|
| `GET /health` | Process is alive. Never touches the database, so a database outage does not cause a restart loop. |
| `GET /health/ready` | Instance should receive traffic. Checks dependencies; returns 503 when the database is unreachable. |

## Background jobs

The API runs its own scheduler in-process. Every task is idempotent and
bounded, so moving them onto BullMQ later is a change of trigger, not of logic.

| Job | Every | Does |
|-----|-------|------|
| `expire-requests` | 5 min | Auto-cancels booking requests the provider never answered |
| `close-dispute-windows` | 15 min | Makes provider earnings payable once the window closes |
| `retry-notifications` | 10 min | Retries failed sends, capped at 3 attempts |
| `nudge-stalled-jobs` | 1 hour | Chases jobs accepted-but-not-started, or started-but-not-finished |
| `reconcile-payments` | 1 hour | Flags payments pending over 2 hours for a gateway check |
| `release-payouts` | 1 hour | Runs the payout batch for everyone eligible |
| `clean-orphaned-files` | 24 hours | Removes KYC files whose database rows have gone |

A job never runs concurrently with itself, and one that throws is logged and
skipped rather than taking the process down. `GET /health/ready` reports
scheduler state but does **not** fail on it - a broken reminder sweep must not
pull an instance out of the load balancer.

## API reference

`GET /api/v1/docs` returns the full endpoint list, generated by walking the
live Express router. It cannot drift from the code, because it *is* the code.

## Phase status

All 12 phases complete. See `../BACKEND_PHASES.md`.
