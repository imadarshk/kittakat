# Dummy members implementation plan

> Execute inline with superpowers:executing-plans and test-driven development.

**Goal:** Let space creators add people without accounts who participate fully in finances but never review entries.

**Architecture:** Extend the existing user identity discriminant, preserve memberships and ledger identifiers, and filter only authentication and review workflows.

**Tech stack:** TypeScript, React, SQLite/D1, existing Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-02-dummy-members-design.md`.

## Constraints and review focus

- Preserve all existing migrations and financial calculations.
- Deny non-owner creation and forged dummy identities, including sessions.
- Preserve pending real reviews and dispute resolution after corrections.
- Keep different spaces and duplicate names as separate identities.
- Keep API, UI and CSV/Excel status calculations consistent.
- Verify transaction rollback and persistence across database reopen.

## Tasks

- [x] Add failing tests in `tests/dummy-members.test.ts` against real SQLite for owner authorization, input validation, credentials, isolation, splits, repayments, reviews, revisions, exports and persistence. Run and observe feature-missing failures.
- [x] Extend `lib/types.ts`, `db/schema.ts` and `lib/server/service.ts`: implement `addDummyMember(user: User, spaceId: string, displayName: unknown): Promise<string>` atomically, block dummy authentication, and omit their review/notification rows. Add POST `/api/spaces/:id/members` in the existing API route. Update `entryStatus` in `lib/domain.ts` to accept optional member identities and exempt only known dummy members; supply members from UI and exports. Run tests.
- [x] Add the owner-only form to People, pass `mutate` from the app, label dummy members in selectors and explain review exemption. Update user docs and add HTTP integration coverage. Run full tests, typecheck, lint, Node production build, HTTP integration and browser smoke checks.
- [ ] Review the complete diff, commit, pull the current base, push a feature branch, create a PR and merge using the user's explicit authorization. Verify remote main includes the commit.
