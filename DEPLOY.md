# Deploying ServiceSetu

Target: **https://services.hiideals.com**, served through a Cloudflare tunnel.

Four containers on one private network plus the tunnel. Nothing is exposed to
the internet directly: cloudflared dials out to Cloudflare and traffic returns
down that connection, so the server accepts no inbound connections at all.
That is also why this works behind CGNAT, where port forwarding cannot.

```
  the internet
        |
   Cloudflare  ..... TLS terminates here, certificate is automatic
        |
        |  (outbound connection, opened by the server)
        |
  +-----------------------------------------------+
  |  cloudflared                                   |
  |       |                                        |
  |  web  |  nginx, serves the built app           |
  |       +-- /api/* --> api:5000                  |
  |  api      Node, the API                        |
  |            +-------> db:5432                   |
  |  db       PostgreSQL 18                        |
  +-----------------------------------------------+
         volumes: pgdata, uploads
```

## Before you start

On the server you need Docker Engine and the Compose plugin:

```bash
docker --version          # 24 or newer
docker compose version    # v2.17 or newer
```

v2.17 matters: the deployment uses `service_completed_successfully`, which
earlier versions do not understand.

---

## 1. Get the code onto the server

```bash
git clone https://github.com/Hi-ideals/Service_Mitra_Clg_Project.git
cd Service_Mitra_Clg_Project
```

## 2. Write the configuration

```bash
cp .env.docker.example .env
```

Open `.env` and change four things. Everything else has a working
default.

**The domain settings** are already correct in the template - leave them:

```ini
APP_URL=https://services.hiideals.com
CORS_ORIGINS=https://services.hiideals.com
COOKIE_SECURE=true
```

`COOKIE_SECURE=true` is right here because Cloudflare serves the site over
HTTPS. It must only be false if you ever go back to plain HTTP.

**Generate two different secrets:**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it twice, once for each.

| Setting | What to put |
|---|---|
| `DB_PASSWORD` | Something long. Not `postgres`. |
| `JWT_ACCESS_SECRET` | First generated value |
| `JWT_REFRESH_SECRET` | Second generated value — **not the same as the first** |
| `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | Your Gmail address and app password |

`EMAIL_FROM` must contain the same address as `SMTP_USER`. A mismatch fails SPF
and Gmail drops the message with no bounce — this has already caught us once.

**Leave `COOKIE_SECURE=false` alone while you are on HTTP.** It is explained in
§7 and it is the one setting that will silently break sign-in.

The name `.env` matters: compose reads it automatically for every command.
Call it anything else and `logs`, `ps` and `down` all need `--env-file`,
and forgetting it on one of them gives a variable-interpolation error that
points nowhere near the real problem.

`.env` is already in `.gitignore`. Keep it that way.

## 3. Create the uploads folder

KYC documents are written to a folder on the host rather than into Docker's
internal storage, so you can see them and back them up with ordinary tools.

```bash
mkdir -p data/uploads
sudo chown -R 1000:1000 data/uploads
```

The `chown` matters. The API container runs as a non-root user (uid 1000), and
when Docker has to create a missing bind-mount path it creates it owned by
root - the container then cannot write, and uploads fail with an error that
never mentions permissions.

To keep documents on another disk, set an absolute `UPLOADS_PATH` in `.env`
and create that path instead.

## 4. Build and start

```bash
docker compose up -d --build
```

First run takes a few minutes: it pulls Postgres and nginx, installs
dependencies and builds the frontend bundle.

The order is enforced, not hoped for — `db` becomes healthy, then `migrate`
applies the schema and seeds the catalogue and exits, then `api` starts, then
`web`.

## 5. Watch it come up

```bash
docker compose ps
docker compose logs -f migrate     # should exit 0 after seeding
docker compose logs -f api
```

You are looking for:

```
ServiceSetu API listening on http://localhost:5000/api/v1  [production]
```

`docker compose ps` should show `db`, `api` and `web` as **healthy**, and
`migrate` as **exited (0)**.

## 6. Check it on the server

The domain does not work yet - the tunnel is step 7. For now the site is
reachable only from the machine itself, which is exactly what you want to
confirm before publishing it.

```bash
curl -I http://localhost:8082/
curl -s http://localhost:8082/api/v1/categories/tree | head -c 200
```

A `200` and a list of categories means the whole stack is working. If you are
on the same network you can also open `http://192.168.29.193:8082` in a
browser to see it rendered.

## 7. Put it on the domain

The stack is now running, reachable only from the server itself. The tunnel
publishes it at services.hiideals.com without opening a port or needing a public
IP.

### Prerequisite

`hiideals.com` must use Cloudflare's nameservers. Check:

```bash
dig NS hiideals.com +short
```

If that does not show `*.ns.cloudflare.com`, add the domain at
dash.cloudflare.com (free plan is fine) and change the nameservers at your
registrar. Propagation is usually under an hour.

### Create the tunnel

1. **one.dash.cloudflare.com** -> **Networks -> Tunnels** -> *Create a tunnel*
2. Type: **Cloudflared**. Name it `servicesetu`.
3. It shows an install command containing `--token eyJhIjoi...` - copy **just
   the token**, the long string after `--token`.
4. On the *Route tunnel* step:
   - Subdomain: `services`
   - Domain: `hiideals.com`
   - Service type: **HTTP**
   - URL: `web:80`

   `web:80` is the container name on the compose network, which is how
   cloudflared reaches nginx. Not localhost, and not the published port.

### Start it

Put the token in `.env`:

```ini
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

Then:

```bash
docker compose --profile tunnel up -d
```

The `--profile tunnel` matters. Without it the cloudflared container is
skipped entirely and nothing reaches the domain.

### Check

```bash
docker compose logs cloudflared --tail=20
```

Look for `Registered tunnel connection`. Then from any machine:

```bash
curl -I https://services.hiideals.com
```

The DNS record is created for you by the tunnel - you do not add one by hand.

### The cookie rule

The refresh token is an HttpOnly cookie. Browsers refuse to store a `Secure`
cookie on a plain-HTTP origin - silently, with nothing in the console and
nothing in any log. The symptom is specific: sign-in appears to work, you see
the dashboard for a moment, and the next page load returns you to sign-in.

`COOKIE_SECURE=true` is correct behind the tunnel, because the browser is on
HTTPS. Only set it false if you ever serve the site over plain HTTP again.

---

## 8. Create your admin

The database was seeded with the catalogue only — **no accounts exist**, by
design. The demo accounts share one published password and have no business on
a machine other people can reach.

Register through the site at `https://services.hiideals.com/register`, then promote
yourself:

```bash
docker compose exec db psql -U postgres -d servicesetu \
  -c "UPDATE users SET role = 'admin', email_verified_at = NOW() WHERE email = 'you@example.com';"
```

Sign out and back in. You will land on the admin console.

---

## Day-to-day

**Deploy a change**

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on every `up`. Seeding is idempotent — it upserts
the catalogue and creates no accounts — so repeating it is safe.

**Logs**

```bash
docker compose logs -f api
docker compose logs --tail=100 web
```

### Two-factor authentication for admins

Set `TOTP_ENCRYPTION_KEY` in `.env` before anyone tries to switch 2FA on:

```bash
openssl rand -hex 32
```

It encrypts the authenticator secrets, so a stolen database backup cannot be
used to generate codes. Until it is set, the account screen says 2FA is
unavailable rather than failing at the moment somebody enables it.

**Set it once and leave it alone.** Changing it invalidates every enrolled
authenticator app - everyone with 2FA on must use a recovery code to get back
in and set it up again.

Each admin then turns it on from **My account → Two-factor authentication**:
scan the QR code with Google Authenticator, Authy or any TOTP app, confirm a
code, and save the ten recovery codes somewhere physical. They are shown once
and only their hashes are kept, so nothing can display them again.

It is **required**, not offered: `REQUIRE_ADMIN_2FA` defaults to on, and an
admin who has not enrolled gets no session at all - only a ten-minute token
that is good for finishing the setup and is rejected by every other endpoint.
There is no admin route that could be reached by forgetting to guard it.

Two consequences of that:

- The server **will not start** without `TOTP_ENCRYPTION_KEY` while this is on.
  That is deliberate. Mandatory 2FA with nowhere to store secrets means no
  admin can ever sign in, and a deployment that fails with a message saying
  what to set beats a business discovering at 9am that it has no administrator.
- Admin sessions that already existed stop working within fifteen minutes of
  the deploy, because token refresh is refused too.

**Each database needs its own enrolment.** Your laptop and the server hold
different databases, so you scan a QR on each. Outside production the
authenticator entry is labelled `ServiceMitra (development)` so the two do not
look identical in the app.

### If you are the only administrator

Then your recovery codes are the only way back in that does not involve a
database password. Before you rely on this:

1. **Make a second admin account.** One admin plus a lost phone plus lost codes
   is a problem only SQL can solve. Two admins rescue each other.
2. **Scan the same QR with two phones.** Both then show the same code. For a
   small team this is more reliable than any backup scheme.
3. **Print the recovery codes.** Not a screenshot on the phone that holds the
   authenticator - that is both factors in one place.
4. **Keep `TOTP_ENCRYPTION_KEY` in a password manager as well as `.env`.** Lose
   it and every enrolled app stops working at once.

### Getting back in

Three ways, in order of preference.

**A recovery code.** Enter it instead of the six digits at the sign-in prompt.
Each works once.

**Turn the requirement off** long enough to sort it out:

```bash
# in .env
REQUIRE_ADMIN_2FA=false
```
```bash
docker compose up -d api
```

**Remove 2FA from one account** directly:

```bash
docker compose exec -T db psql -U postgres -d servicesetu -c   "DELETE FROM user_totp WHERE user_id = (SELECT id FROM users WHERE email = 'them@example.com');"
```

Both of the last two are deliberate back doors with the server password in
front of them. They are also why that password, and `BACKUPS_PATH`, matter as
much as they do.

### Backups

The application backs itself up. Every `BACKUP_EVERY_HOURS` (24 by default) it
writes two files into `BACKUPS_PATH` on the host:

```
servicemitra-2026-10-13-0300-database.sql.gz   the whole database
servicemitra-2026-10-13-0300-files.tar.gz      the uploaded KYC documents
```

Both halves matter. The database holds the verification *decisions*; the
documents are the evidence behind them, they are not in the database, and they
cannot be regenerated. A restore from one without the other gives you a
platform whose every document link is broken.

`BACKUP_KEEP` runs are kept and older ones are deleted, so the folder cannot
fill the disk. An admin can also take one on demand, and download either file,
from **Admin → Backup**. Every download is written to the audit log.

Create the folder before the first start, like the uploads one:

```bash
mkdir -p data/backups && sudo chown -R 1000:1000 data/backups
```

**This is not yet an offsite backup.** Those files sit on the same disk as the
database they protect. One line of cron fixes that — run `crontab -e` and add:

```bash
30 3 * * * rsync -a --delete /opt/Service_Setu/data/backups/ backup@elsewhere:/srv/servicemitra/
```

Any destination works: another server, a NAS, `rclone` to object storage. What
matters is that it is not this machine.

**Check that it is actually running.** The admin screen shows the age of the
newest backup; so does the host:

```bash
ls -lh data/backups | tail -5
```

If the newest file is older than a day, open **Admin → Backup** — it reports
why in words, and the usual cause is `pg_dump` missing from the API image after
a PostgreSQL major upgrade.

**Restore the database**

```bash
gunzip -c data/backups/servicemitra-2026-10-13-0300-database.sql.gz   | docker compose exec -T db psql -U postgres -d servicesetu
```

The dump is taken with `--clean --if-exists`, so it drops and recreates what it
restores and can be loaded over an existing database.

**Restore the documents**

```bash
tar xzf data/backups/servicemitra-2026-10-13-0300-files.tar.gz -C data --strip-components=0
```

The archive contains an `uploads/` directory, so unpacking it in `data/` puts
the files back exactly where the API expects them.

**By hand, without the application** — if the API will not start:

```bash
docker compose exec -T db pg_dump -U postgres servicesetu | gzip > backup-$(date +%F).sql.gz
tar czf ~/uploads-$(date +%F).tar.gz -C data uploads
```

**Stop**

```bash
docker compose down           # keeps the volumes
docker compose down -v        # DESTROYS the database. Uploads now survive,
                              # being a folder rather than a volume.
```

`-v` is not recoverable. There is no confirmation prompt.

---

## When something is wrong

**`web` is up but the API 502s** — the API is not healthy yet, or it crashed.
`docker compose logs api`. A boot failure is almost always a missing or
malformed value in `.env`; the API refuses to start rather than run
misconfigured, and says which variable.

**Registration or sign-in fails with "Origin ... is not allowed"** —
`CORS_ORIGINS` in `.env` does not match the address in the browser's bar. An
origin is scheme + host + port and they are compared exactly, so a site on
`:8082` needs `CORS_ORIGINS=https://services.hiideals.com`. Fix it, then
`docker compose up -d api`.

**Sign-in bounces straight back to the login page** — `COOKIE_SECURE`. See §7.

**`migrate` exited non-zero** — the schema was not applied and `api` will not
start. Read `docker compose logs migrate`. The migration runner is checksummed,
so an edited migration that has already run is refused on purpose.

**Port 80 already in use** — set `WEB_PORT=8080` in `.env` and reach the
site at `https://services.hiideals.com:8080`.

**Uploads fail with a permission error** — the uploads folder is owned by
root. Docker creates a missing bind-mount path that way, and the container
runs as uid 1000:

```bash
sudo chown -R 1000:1000 data/uploads
docker compose restart api
```

**Uploads fail with 413** — nginx caps the body at 10 MB and the API at
`MAX_UPLOAD_MB` (5). Raise `client_max_body_size` in `frontend/nginx.conf` as
well, or the request never reaches the API to be explained properly.

---

## Still outstanding before real customers

- `RAZORPAY_WEBHOOK_SECRET` is empty and `PAYMENT_DRIVER=mock`. No real money
  moves until both are set.
- WhatsApp codes need the Meta credentials in `.env`; without them every
  code quietly falls back to email, which works but is not what you set up.
- An offsite copy of `data/backups`. The application takes the backups and
  prunes them, but it cannot put them on another machine — that is the cron
  line in the Backups section above, and until it is set up a fire takes the
  backups with the server.
