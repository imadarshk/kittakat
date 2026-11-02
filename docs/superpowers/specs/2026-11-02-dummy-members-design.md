# People without accounts

The space creator can add a named person without registering an account. These people are ordinary ledger members: they can pay expenses, share all four split methods, send or receive recorded repayments, appear in pairwise debts and all exports, and remain in immutable entry history. Only signed-in people perform actions; adding a dummy does not impersonate them.

Use a distinct `dummy` authentication type with no password, ChatGPT identity, or session. Allocate a fresh identifier and reserved internal username for each person and attach them to exactly the requested space. Authorize creation against the stored space owner, validate a trimmed display name of 1–80 characters, and insert identity, membership and owner-attributed audit in one transaction. Reject dummy identities at both session lookup and service authorization, consulting the stored identity rather than client-supplied fields.

Do not request reviews or create inbox notifications for dummy members. Acceptance status excludes them while still requiring every real participant and previous real reviewer after corrections. Do not manufacture an acceptance on their behalf. Financial calculations are unchanged.

The People page has an owner-only name form and labels these people “No account”; expense and repayment selectors distinguish them. Review details explain their exemption. Other members can record financial entries involving them just as they can for existing account holders.

## Approaches

Chosen implementation decision: extend the existing ledger identity with `authType: 'dummy'`. It preserves financial identifiers and foreign keys without changing money calculations. Existing SQLite stores authentication types as text without a check constraint, so this requires no data migration. A separate guest table would duplicate all membership queries; creating password accounts would incorrectly give dummy people login capabilities. Neither fits the request as closely.

No account claiming, deletion, conversion, or owner impersonation controls are added. Identical display names remain separate identities, as with registered users. “Except accepting and declining expenses” is interpreted as exempting dummy people from acceptance and disputes, including repayments and corrected revisions. This interpretation and implementation choice were stated in chat.
