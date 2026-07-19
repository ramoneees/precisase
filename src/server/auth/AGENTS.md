# AGENTS — `src/server/auth/`

**Authentication data layer. Separate from the main repository family by design.**

## OVERVIEW

Implements the `AuthUserRepository` port (declared in `../services/auth-service.ts`). Plus the signup write path (User + ConsentRecord creation per `docs/ARCHITECTURE.md` §7.5, BR06).

## STRUCTURE

```
src/server/auth/
└── user-repository.ts     # The one file. Implements AuthUserRepository + createUserWithConsent.
```

That's it. One file, ~120 lines.

## WHY A SEPARATE DIR?

`src/server/auth/` exists as a sibling of `src/server/repositories/` (not inside it) because the auth port family was built in parallel to the main one. The module docstring at the top of `user-repository.ts` records this — the historical "parallel workstream" justification predates the recent i18n cleanup that collapsed the duplicate `prisma-client.ts` files.

**Don't merge this into `repositories/`.** The auth code is intentionally isolated to keep its own dependency tree (the auth flow doesn't need to know about posts, interests, etc., and vice versa). The split makes it easy to swap the auth implementation later (e.g. Clerk, Supabase) without touching the main repos.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Add a new auth-related DB query | `user-repository.ts` | Add the method to the `AuthUserRepository` interface in `../services/auth-service.ts` first, then implement here |
| Change the signup flow (User + ConsentRecord creation) | `createUserWithConsent` in `user-repository.ts` | Wrapped in `prisma.$transaction` so a partial failure can't leave a user with consent but no row, or vice versa |
| Change NextAuth wiring (JWT shape, callbacks, providers) | `src/auth.ts` | Not in this dir — that's the NextAuth config, not the data layer |
| Change password hashing parameters | `src/server/services/password-service.ts` | Not in this dir — that's the algorithm wrapper |

## CONVENTIONS (specific to this dir)

- **The interface lives in `../services/auth-service.ts`**, not here. Implementations match the port verbatim.
- **Returns narrow `AuthUserRecord` from `findUserByEmail`.** Don't return the full `User` row — that would leak `phoneE164`/`consentAt`/etc. to the auth flow which doesn't need them.
- **Distinct password hashing** uses argon2id (algorithm 2). Hardcoded — see the comment in `src/server/services/password-service.ts` for why (`isolatedModules: true` makes the `Algorithm` const enum unsusable across module boundaries).
- **Session augmentation is on the JWT side**, not the DB side. `src/auth.ts` reads `User.country`/`User.timeZone`/`User.currency` at login time and copies them onto the JWT/session. After login, no further DB hits are needed for these fields.

## ANTI-PATTERNS

- **Do not import anything from `src/server/repositories/`.** Auth has its own port; the two repository families don't share types.
- **Do not put business logic in this file.** It's a port implementation. Validation, password verification, etc. live in `../services/auth-service.ts`.
- **Do not log the user's email on failed login.** The "unknown email" / "wrong password" cases are deliberately indistinguishable to prevent email enumeration.

## UNIQUE STYLES

- **`createUserWithConsent` is the only multi-table write in this dir.** It's wrapped in `prisma.$transaction` (User insert + 2 ConsentRecord inserts) so the user can never exist without their consent trail. The transaction is in this implementation, not the port — that's correct (the port's `AccountDeletionRepository` has a similar pattern).

## NOTES

- The `User` table is shared between auth (for password/email) and the main domain (for `authorId` FKs). Auth owns the *write* side; the main repos own *read* projections of it (via `select: { displayName: true }` and similar).
- `createUserWithConsent`'s `country`/`timeZone`/`currency` parameters are optional — derived from the URL locale at the signup Server Action if absent. See `src/app/[locale]/signup/actions.ts`.
- This is the only directory in `src/server/` whose Prisma client import comes from `./prisma-client` (relative). All other repositories use the absolute `@/server/repositories/prisma-client`. That's a historical artifact, not a convention to copy.
