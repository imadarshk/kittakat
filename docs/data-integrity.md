# Data integrity and recovery

The authoritative records live in the server's D1 database. Browser storage holds interface preferences and pending invite state, not the financial ledger.

## Enforced controls

- Every space read, mutation, and export checks the authenticated user's membership. Only an entry's original creator can correct it; only involved people can review it. Invitation rotation is owner-only.
- The server accepts financial inputs, validates space participants, recalculates portions, and generates IDs, creator attribution, timestamps, revision numbers, notifications and audit events. Client-supplied derived fields have no authority.
- Amounts use integer paisa with BigInt intermediate calculations. Invalid splits and unsafe aggregate totals are rejected before persistence.
- Entry changes, revision snapshots, reviews, notifications and audit events are committed in one atomic D1 batch. Space-version and entry-revision preconditions reject competing stale writes instead of silently losing changes.
- Migration `0002_ledger_integrity.sql` makes financial snapshots and audit events append-only with database triggers. UPDATE, DELETE, ordinary REPLACE and explicit SQLite rowid replacement paths are rejected. Every correction requires the next sequential revision, original creator and a reason. Entry identity and the space's owner/currency are fixed.
- Corrections keep the old financial payload. A disputed entry remains flagged until the disputer accepts a later correction; review acceptance never reapplies money.
- API results use `Cache-Control: no-store`. Passwords use salted PBKDF2 hashes; session tokens are stored as hashes and sent in HttpOnly cookies. JSON mutations require the same origin. SQL inputs use bound parameters.

## Trust boundary

These controls prevent members from silently rewriting saved history through the application and protect historical records against accidental or unauthorized DML using the application's database connection. They do not make a privileged database administrator powerless: someone who controls deployment or database administration can alter schema, remove triggers, or restore a different database. Claims of absolute tamper-proof storage would be incorrect.

There is no independent cryptographic notarization or external write-once archive in this release. Keep hosting, GitHub and database administration access restricted. Public source never contains production database files, sessions, credentials or expense exports.

## Recovery

Cloudflare documents built-in D1 Time Travel point-in-time recovery for its production storage backend: 7 days on Workers Free or 30 days on Workers Paid. Retention and administrative access for the Sites-managed database have not been independently inspected through this integration; a successful Sites deployment does not establish a separately tested restore procedure.

For a self-hosted deployment, the database administrator should:

1. Verify the database backend and available recovery window with `npx wrangler d1 info kittakat` and `npx wrangler d1 time-travel info kittakat`.
2. Take a private full SQL export with `npx wrangler d1 export kittakat --remote --output=/PRIVATE_BACKUP_DIRECTORY/kittakat.sql`. Store backups outside the public repository with restricted access and a retention policy. A full export contains sensitive account and financial data.
3. Test restoration into a separate non-production database, run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and compare members, entry counts, revision history and balances with the export. Verify the append-only triggers are present.
4. Before a production recovery, stop writes, preserve the current database export and recovery bookmark, identify the incident timestamp, and have the responsible administrator review the exact recovery target. Point-in-time restore overwrites the database in place. No production restore has been executed by this change.

For Sites-managed hosting, use the hosting owner's supported recovery/support path; do not substitute local emulator credentials or an unrelated Cloudflare account. Excel/CSV reports are useful user records but are not complete server backups.

Provider references: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Verification

`npm test` exercises real SQLite queries, membership isolation, precision, concurrent writes, rollback, correction/dispute history, and direct-SQL mutation attempts. Regression tests include `rowid`, `_rowid_`, and `oid` conflicts with recursive triggers disabled. `npm run test:integration` exercises the actual Worker HTTP API against a disposable local D1 database and refuses remote URLs.

All migration files are append-only once published. Future changes must use a new migration rather than changing an applied migration. The protection migration installs triggers without backfilling or rewriting existing rows.
