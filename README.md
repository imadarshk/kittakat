# कित्ताकाट

**साझा खर्च, स्पष्ट हिसाब।** Shared expenses for your people, in Nepalese rupees.

कित्ताकाट is a responsive shared expense app with a Nepali **क** motion logo, real server accounts, isolated financial spaces, unequal splits, pairwise balances, repayments, review notifications, and immutable correction history.

## Features

- Create a username and password without email verification, then use those credentials to log in.
- Create independent NPR spaces. Invite members with a secret code or shared link; replace an invitation code when needed.
- Record title, amount, date, common category, payer, and Everyone or Specific people.
- Split equally, by exact amounts, percentages, or shares. Integer paisa and deterministic largest-remainder allocation preserve every paisa.
- See what each person owes you and what you owe each person, with supporting expense records.
- Expenses and repayments affect balances immediately. Involved members can accept or dispute with a reason.
- Disputes notify the creator and everyone involved. Corrections require an explanation, preserve earlier revisions, and remain under review until each disputing person accepts a later revision.
- Notifications in the main navigation; Excel/CSV reports, create/join spaces and invitations inside Settings.
- Motion and quiet interface sounds, with reduced-motion support and a sound preference.

## Authentication modes

The GitHub/self-hosted version defaults to **username/password accounts only**. It does not display a ChatGPT sign-in button. No email provider or API key is required.

The ChatGPT Sites deployment additionally enables dispatch-owned ChatGPT sign-in through a hosting-only `ENABLE_CHATGPT_AUTH=true` runtime variable. Never enable that mode on an untrusted proxy that accepts arbitrary identity headers. Local-password and ChatGPT identities are separate accounts; email addresses are not used to silently link them.

Passwords are salted PBKDF2-SHA256 hashes (100,000 iterations for Worker compatibility). Session tokens are opaque, stored hashed, and sent in HttpOnly/SameSite cookies. Mutation requests are checked for same-origin access; login attempts are throttled. Every space read/write/export checks membership server-side. Production deployments should use HTTPS.

## Local development

Requires Node.js 22.13+ (Node.js 24 recommended), npm and Git. The database runs locally through Cloudflare's D1 emulator.

```sh
npm ci
npm run build
```

Apply the generated schema migrations to the local database, once per migration:

```sh
npm run db:migrate:local
npm run dev
```

The migration helper configures the generated build’s migration directory and applies only pending migrations. Local state is never published. Visit the loopback URL printed by the development server. ChatGPT mode remains off unless explicitly configured for a trusted Sites environment.

```sh
npm test
npm run typecheck
npm run test:integration
```

The integration test creates disposable accounts and spaces in the local database. It refuses remote URLs. Set `KITTAKAT_TEST_URL` to the local preview URL if it uses another port. It never seeds a production deployment.

## Deploy the GitHub version to Cloudflare

This is a full-stack application, so GitHub Pages alone cannot host its login and database. The repository is ready to deploy as a Cloudflare Worker with D1.

```sh
npm ci
npx wrangler login
npx wrangler d1 create kittakat
npm run build
node scripts/self-host-config.mjs --database-id YOUR_D1_DATABASE_UUID --name kittakat
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

Use the D1 UUID returned by `d1 create`. The setup script modifies generated build configuration and explicitly disables ChatGPT sign-in for this version. Run it again after rebuilding before deploying. All app records are stored in your D1 database; no data is stored in GitHub.

## Reports and records

Settings provides CSV downloads for expenses, individual portions, repayments, balances and history, plus a real `.xlsx` workbook with all five sheets. Date filters apply to expenses/repayments and the action dates in revision history. The balance sheet is explicitly **all-time current balance**, including pending/disputed entries, even when other sheets are filtered. Text is exported safely to prevent spreadsheet formula interpretation.

XLSX monetary values whose paisa integers exceed 15 digits are exported as exact decimal text to preserve every paisa in Excel. Ordinary amounts remain numeric. Spreadsheet formulas treat these exceptional large values as text.

No destructive entry deletion is provided. Correct an entry to create a new immutable revision. Disputed amounts stay included and visibly flagged; acceptance never applies the amount twice.

Database triggers also enforce append-only financial revisions and audit events. They reject updates, deletions, and SQLite replacement conflicts, including explicit rowid conflicts. An entry cannot move between spaces, change its original creator or creation timestamp, or point to a missing/skipped revision. See [Data integrity and recovery](docs/data-integrity.md) for the trust boundary, verification, and recovery procedure.

## Support

If any bug found or want to add features, or want to change something email at [Kittakat@adarshkhanal.com.np](mailto:Kittakat@adarshkhanal.com.np)

## Architecture

React + TypeScript on the supported Vinext runtime; Cloudflare Worker API; D1 SQLite and Drizzle schema migrations. The domain module and export writer are platform-independent and covered by native Node tests. No external app credentials or paid AI model calls are needed to run the expense tracker.
