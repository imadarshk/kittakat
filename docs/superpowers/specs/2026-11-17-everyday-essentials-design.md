# Everyday essentials

Date: 2026-11-17. Request: "make this repository better in every sense, add essential features, make it intuitive." The user opted out of further questions and asked to implement the proposed priorities.

## What was added and why

| Gap | Change |
|---|---|
| Balances showed debts but not how to clear them | Per-person **Settle up** inside Balances opens a repayment pre-filled with the pairwise net (`settlementFor`). |
| Mistakes (duplicates) could only be corrected, never removed | Creator-only **Cancel / Restore** with a required reason. |
| No account or space management | Change display name, change password, owner renames space and account-free people. |
| No overview of where money goes | **Insights** panel: category totals and six-month trend, whole space or your share. |
| Search only matched titles | Search also covers descriptions, categories and people. Adds filters for category, person, dates and cancelled entries. |
| Light-only interface, not installable | Dark appearance (system/light/dark) and a web manifest with icons. |

## Cancel / restore: approach

Chosen: cancellation is an ordinary appended revision whose payload is the previous payload plus `cancelled: true`; restore appends one without it. This reuses the immutable revision model, database triggers, review/dispute workflow, optimistic revision checks and notifications unchanged, and needs **no migration**. Domain functions (`calculateBalances`, `personalDebts`, `spendingInsights`) skip cancelled payloads; `entryStatus` reports `Cancelled` unless disputed. Reports keep cancelled rows with status *Cancelled* and exclude them from balances.

Rejected: hard deletion (violates the append-only ledger and its triggers); a separate `cancelled_at` column (bypasses revision history and review, and needs a migration).

A cancelled entry must be restored before it can be corrected, so the meaning of each revision stays unambiguous. New notification types `cancelled` and `restored` are stored in the existing text column.

## Account changes

- Password change requires the current password, is throttled (5 per 15 minutes per IP and account), rejects reuse, deletes **all** sessions and issues a fresh cookie for the current device.
- ChatGPT accounts have no password and cannot change one.
- Display names: 1–80 characters, trimmed. Owner-only rename of a space (audited) and of account-free members (audited, dummy accounts only).

## Dark appearance

All colour literals in `app/globals.css` became custom properties. Dark values are generated from the light palette by inverting HLS lightness with reduced saturation for backgrounds; shadows become black. `data-theme` on `<html>` overrides the system preference and is applied before paint by an inline script.

## Not done (deliberately)

- Leaving a space or removing members: historical entries reference members, so this needs a design for name retention and outstanding balances.
- Group-wide debt simplification: the original design explicitly keeps pairwise debts.
- Reformatting the existing densely written components: it would bury these changes in a whitespace diff. Better as a separate change.
