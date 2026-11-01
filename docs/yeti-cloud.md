# Kittakat on Yeti Cloud

The Node target uses Node 24's built-in SQLite and requires no separate database account, password, or additional npm dependency.

## Build and start

```sh
npm ci --include=dev
npm run build:node
npm start
```

The production server listens on port 8080; `PORT` and `HOST` override its address. `npm run build` still produces the Cloudflare build; `npm run start:cloudflare` previews that build locally. Both builds write to `dist`, so build the desired target before starting.

## Server settings

Use exactly one stateful Node 24 instance. SQLite is a local file: independent app instances would have independent records. Keep the database on persistent storage outside the Git deployment folder, `public`, and `dist`.

Set these environment variables using the actual persistent path supplied by the container:

```text
NODE_ENV=production
PORT=8080
KITTAKAT_DB_PATH=/absolute/persistent/private-directory/kittakat.sqlite
VINEXT_TRUSTED_HOSTS=kittakat.duckdns.org
```

`VINEXT_TRUSTED_HOSTS` enables recognition of HTTPS forwarded by the platform's trusted reverse proxy. Only enable it behind that proxy, with the app port private and forwarded headers replaced by the proxy. Add the environment hostname to the comma-separated allowlist if it also serves the app. Node mode always disables Sites-only ChatGPT identity headers. It uses the proxy-overwritten `x-real-ip` for authentication throttling and ignores `cf-connecting-ip`. Confirm the Yeti proxy replaces `x-real-ip`; never expose the Node port directly to the Internet.

The first API request opens the database and applies pending migrations from `drizzle`. Each migration runs in a transaction and is recorded with a SHA-256 digest. Add a new migration rather than changing one that has already run. Changed migrations stop initialization instead of silently changing financial records.

Configure the deployment post hook to run `npm ci --include=dev` and `npm run build:node` in the application directory before restarting it. Preserve the private data directory through the platform's volume/redeploy settings. Git cleanup and app replacement must never remove that directory.

## Domain and encryption

Point `kittakat.duckdns.org` at the platform's external address and bind that hostname to the environment. DNS alone does not tell a shared load balancer which app to serve. Install a certificate for this exact hostname, configure renewal, and redirect HTTP to HTTPS. Enter real passwords only over HTTPS.

## Records and backups

GitHub stores code. The private SQLite database stores accounts and expenses. Do not commit it or expose it through a public download folder.

Take a consistent backup before updates. With the app stopped, copy the database and any `-wal`/`-shm` files together. For a live backup use SQLite's online backup API or the sqlite3 shell's `.backup` command; copying only the main database while writes are active can miss committed WAL records. Keep an encrypted backup separate from the server and check restoration. An expense CSV or Excel export is useful but does not replace a full database backup.

Deleting the environment or its persistent volume can delete the only copy of records. Do not overwrite the production database during a routine code rollback.

## Updating

1. Back up the database.
2. Deploy the reviewed Git commit, retaining the private data directory.
3. Run `npm ci --include=dev` and `npm run build:node`.
4. Restart the single app process.
5. Check the HTTPS home page, `/api/bootstrap`, and your own login.


## This installation

- Repository: https://github.com/imadarshk/kittakat (main)
- Environment: `env-6468131`
- Application node: `27007`, Node.js 24.22.2
- Nginx balancer node: `27008`, public address `45.115.217.211`
- Public hostname: `kittakat.duckdns.org`
- Application checkout: `/home/jelastic/ROOT/kittakat`
- Private records: `/home/jelastic/ROOT/kittakat-data/kittakat.sqlite`
- Process configuration: `/home/jelastic/ROOT/ecosystem.config.js`
- Actual app port: `3000`, matching Yeti's automatic forwarding (the generic npm start default is 8080)
- Certificate: Let's Encrypt, issued for `kittakat.duckdns.org`, with the platform's renewal add-on installed
- Application release: `27bf10b63dd3c1da29e52fcf7b80270d4e95dc70`

The checkout and records are sibling folders inside Yeti's preserved `ROOT` directory. The app serves only its own public/build assets; the private records folder is outside the checkout. Update this checkout using Git rather than replacing the entire `ROOT` directory. The container's existing `/etc/jelastic/redeploy.conf` preserves `ROOT` during container updates. Deleting the whole environment is different and still requires an independent backup.

PM2 keeps the `kittakat` process running and its configuration was saved with `pm2 save`. The original demonstration app is stopped. The Nginx gateway sends traffic to the app on private port 3000 and replaces the client IP and protocol headers. Its HTTP server redirects to HTTPS except for `/.well-known/acme-challenge/`, which remains reachable for certificate renewal. The redirect is configured in `/etc/nginx/nginx-jelastic.conf`; recheck it after changing the environment topology because the platform may regenerate its configuration.

The Let's Encrypt add-on reports automatic renewal one month before expiry and sends an email notification. The current certificate expires on 30 January 2027. Future renewal has not yet occurred.

### Opening and using your app

Visit **https://kittakat.duckdns.org** and choose **Create account** to create your own app login. This is a fresh Yeti database; existing records or accounts from a Cloudflare deployment were not imported. A GitHub login and a Kittakat app login are separate things.

GitHub stores the recipe for the app. Yeti runs it. DuckDNS is the address people use to find it. The SQLite file stores the actual accounts and expense records, so it must be protected separately from the code.

### Operational commands for this server

In Yeti, open **Web SSH on application node 27007**. These commands inspect or restart the existing app:

```sh
pm2 status
pm2 logs kittakat --lines 50 --nostream
pm2 restart kittakat
pm2 save
```

Future GitHub changes are **not automatically deployed**. After making a consistent database backup, update this installation with:

```sh
cd /home/jelastic/ROOT/kittakat
git pull --ff-only origin main
npm ci --include=dev
npm run build:node
pm2 restart /home/jelastic/ROOT/ecosystem.config.js --update-env
pm2 save
```

Stop if any command fails and inspect the error before proceeding. This simple update procedure involves a short interruption while the production build is replaced. A code rollback must preserve the database, and database migrations may require a separate recovery decision.

No scheduled or off-server database backup has been configured. The private `backups` directory is prepared, but directory creation alone does not protect records. Before storing important records, arrange encrypted independent backups and verify restoration. The backup guidance above explains how to obtain a consistent database copy.

### Verification and cost record

On 1 November 2026, 62 automated tests, type checking, linting, both build targets, and 72 local HTTP integration checks passed. GitHub CI passed for the application release. Public checks verified the home page and all 17 linked JS/CSS assets, database bootstrap, secure session cookie attributes, rejection of a foreign-origin mutation, and 404 responses for database/configuration paths. HTTP returns 308 to HTTPS, while the certificate challenge route is not redirected. The app responded after a PM2 restart, and the login page loaded in Safari Personal.

The approved configuration is one Node 24 app server plus a small Nginx balancer with a public IPv4 address. Yeti displayed a total estimate of **NPR 2.149–6.08/hour after beta**, approximately **NPR 1,547–4,378 for 30 days** of continuous operation, before other charges. The interface labeled it free during beta. This is a recorded estimate, not a price guarantee or spending cap; check the Yeti billing dashboard for current charges.
