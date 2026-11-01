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
