# कित्ताकाट — implementation design

Date: 2026-11-01. Authority: the user's final request to implement everything, including local username/password login, ChatGPT login on Sites, public GitHub, Nepali branding, and code/link space invitations. Earlier mockups establish the Atlas cream-and-ink appearance. Implementation is authorized; no further preference checkpoint is needed.

## Purpose and scope
Build a real multi-user shared NPR expense ledger with durable server records. Public visitors can register without email verification, log in, create spaces, join spaces with secret codes/links, enter expenses for selected people, review notifications, dispute and correct entries, record repayments, inspect personal debts and all revisions, and export Excel/CSV reports.

Brand name is exactly **कित्ताकाट**, logo exactly **क**, rendered with a Devanagari-capable font and refined motion. Other interface labels may remain English as in the approved mockups. Light Atlas cream-and-ink design, accessible phone navigation: Home, Balances, Add, People, Notifications. Settings accessed from a gear/desktop sidebar contains create/join/switch space, invitations, reports, sound preference, account controls, and the exact support message:

“If any bug found or want to add features, or want to change something email at Kittakat@adarshkhanal.com.np”

## Chosen implementation and alternatives
Chosen: React/TypeScript on the supported Sites Vinext starter, Cloudflare Worker API and D1 SQLite database, checked into a public `imadarshk/kittakat` repository. It supports real shared state and Sites hosting. A browser-only static app cannot provide shared authentication or durable group data. An unrelated external backend adds account/credential setup and is unnecessary. Self-hosting instructions use Cloudflare Wrangler/D1 with ChatGPT authentication disabled by default.

## Accounts and access
Local registration needs a unique username, display name, and password; no email or verification. Normalize usernames; allow Unicode letters/marks/numbers plus `_ . -`, 3–32 characters. Password 8–128 characters. Salted PBKDF2-SHA256 password hashes, 100,000 iterations for Worker compatibility; random opaque session tokens stored hashed, HttpOnly/SameSite cookies, expiry, constant-time verification, persistent login throttling, same-origin checks on mutations. Never expose hashes or session tokens through APIs.

ChatGPT login is an additional hosted-only option enabled by a runtime setting, default **off** for the GitHub/self-host version. Trust Sites identity only when that setting is enabled. Existing local sessions take precedence; otherwise provision an account from Sites' stable user ID. These are separate accounts; never silently link by email. Each account's access to a space is enforced server-side. Public website does not imply public expense data.

## Spaces
Space owner creates a named NPR space and is its first member. Random high-entropy join code works directly or through `/join?code=...`; visitors authenticate before joining. Members can view the current invitation code/link; owner can rotate it. Joining is idempotent. Every entry, revision, dispute, notification, and export is scoped to a space. Historical financial participants remain identifiable. Initial release has no destructive member/account/space deletion.

## Expenses and money
One payer per expense, separate from creator. Payer may be excluded from personal shares. Required fields: title, integer paisa amount, calendar date, common category, payer, explicit participants, split method and values. Everyone selects current space members; Specific people selects only checked members. Four methods: equal, exact integer paisa, percentages totaling 100%, positive weighted shares. Largest-remainder distribution with stable member order preserves every paisa. Positive costs, safe integer bounds, valid dates, valid membership, nonempty participants, no duplicates. Category presets plus Other. No bank transfer or currency conversion.

Personal debts offset only between the same pair: amounts owed by B from A's payments less amounts owed by A from B's payments, adjusted for repayments. Show both directions, totals and zero balances for every other member, plus contributing records. Do not silently replace these debts with group-wide simplified settlements. Group spending, own shares, paid totals, and net balances must reconcile.

## Reviews, disputes and revisions
Entries immediately affect balances. Notify affected participants and payer, excluding the actor; repayments notify sender/recipient. Creator's own review is accepted automatically. Others can accept or dispute with a nonempty reason. Accepting never reapplies money. Disputes notify the creator and everyone involved, remain in balances with a warning, and prompt the creator to correct the entry. Creator alone revises, with a required explanation and optimistic current-revision check. Store immutable snapshots; keep the original creator and all review/audit actions. New revision updates money immediately and resets review for affected people, including people removed by the correction. Each original dispute persists as Correction under review until that disputing member accepts a later revision. Multiple disputes resolve individually. Accepted members can dispute subsequently. Entries are not deleted.

## Notifications and exports
Durable in-app inbox, unread badge, mark read, accept/dispute actions, correction reason and entry detail. Refresh active state periodically while visible and on window focus. Notifications are in-app; no external email/push service is needed. Reports only in Settings. Date filters, CSV types for expenses/individual splits/repayments/balances/history, and a genuine `.xlsx` workbook containing those sheets. Avoid spreadsheet formula injection in text fields. Export only authenticated members' current space. Balances sheet means all-time current balance and is labeled as such even if expense/history rows are date-filtered.

## Data and atomicity
Users; hashed sessions; login attempt buckets; spaces; memberships; entries pointing at current revision; immutable revision JSON snapshots; per-revision reviews; persistent disputes; notifications; audit events. D1 migrations created with Drizzle, schema only. Batch related writes atomically. Unique `(entry,revision)` plus conditional revision update prevents overwriting concurrent corrections. Server validates all IDs against membership. Cross-space IDs and stale reviews/revisions are rejected.

## Interaction and motion
Short entrance and logo motion; press feedback; drawer/full-screen form transitions; distinct quiet synthesized cues for navigation, selection, error, success. Sound toggle remembers browser preference and unlocks on first gesture; honors reduced motion. Actual save confirmations follow successful server responses. Labels, keyboard navigation, focus management, and meaningful loading/error/empty states.

## Delivery and validation
Create and publish a public ChatGPT Site and public GitHub repository. No production sample accounts/data. Verify login, space membership isolation, join codes/links, all split modes and rounding, reciprocal balances, dispute lifecycle including removed participants/concurrency, repayments and exports. Browser-check phone and desktop, local passwords and hosted ChatGPT path. Provide literal deployed URL and repository URL. Keep secrets and local runtime/database files out of GitHub.
