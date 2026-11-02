# Expense descriptions and photos implementation plan

> Execute inline with superpowers:executing-plans and test-driven development; request a fresh read-only review before merge.

**Goal:** Expense creators can write descriptions and attach photos that space members see inline with uploader attribution.

**Spec:** `docs/superpowers/specs/2026-11-02-expense-photos-design.md`.

**Architecture:** Optional expense fields, a separate append-only photo table, atomic financial saves, and private authenticated photo delivery. Preserve current finance/review rules and named dummy members.

## Review focus

- Existing expenses and persistent databases survive the additive migration.
- Cross-space/cross-entry references, forged metadata, dummy identities and anonymous photo requests cannot bypass authorization.
- Invalid/oversized data and late transaction failures leave no orphan photo records.
- Retained/removed images and descriptions remain correct in immutable revision history and reports.
- The form cannot submit while photos are being prepared; preprocessing failures remain actionable; viewer photos render inline.

## Tasks

1. Add failing real-SQLite service tests for description/photo persistence, authentication and isolation, photo validation, immutable history, rollback and exports; domain tests cover description limits. Confirm failures before implementation.
2. Extend `lib/types.ts`, `lib/domain.ts`, `db/schema.ts`; add generated migration and triggers. Implement shared photo validation in `lib/expense-photos.ts`, photo save/read methods in `lib/server/service.ts`, and protected GET/photo-aware body bounds in `app/api/[...path]/route.ts`. Test green and preserve old migration tests.
3. Add photo preparation and description-field components, integrate into `components/entry-form.tsx`, and add an inline viewer component for current and historical revisions. Add ledger indicators and export columns. Run typecheck/lint and tests; add real HTTP integration cases.
4. Verify both builds, the API, and browser add/view/correction behavior. Request independent review, resolve findings, commit, pull current main, create a PR, wait for CI, merge, pull merged main and confirm clean status and CI.
