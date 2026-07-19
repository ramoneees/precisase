# AGENTS — `src/server/repositories/`

**Prisma-backed port implementations.** The only directory in `src/` (other than `src/server/auth/`) that may import from `@/generated/prisma/client`.

## OVERVIEW

Each file here implements a `XxxRepository` interface declared in the matching `../services/<name>.ts` service. They translate domain types (`PostRecord`, `InterestRecord`, …) ↔ Prisma row types, and handle the **one and only** place that decrypts encrypted contact values (see `prisma-post-repository.ts:toPostRecord`).

## STRUCTURE

```
src/server/repositories/
├── prisma-client.ts                       # Singleton — the ONE shared `PrismaClient`
├── prisma-post-repository.ts              # Implements PostRepository
├── prisma-interest-repository.ts          # Implements InterestRepository
├── prisma-notification-repository.ts      # Implements NotificationDispatchRepository
└── prisma-account-deletion-repository.ts  # Implements AccountDeletionRepository
```

> Note: `prisma-auth-repository.ts` does **not** exist here — auth lives in `../auth/user-repository.ts` (a separate module by design; see `AGENTS.md` there).

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Change a DB query | The matching `prisma-<name>-repository.ts` | Cross-check the `select` clause — narrow projections matter for perf |
| Add a new method to a port | Edit the interface in `../services/<name>.ts` first, then the impl here | The in-memory fake in the test file will need updating too |
| Touch the `PrismaClient` config | `prisma-client.ts` | Single shared instance — do not create another one |
| Change the contact-encryption scheme | `prisma-post-repository.ts` — only `toPostRecord` decrypts; `toPostSummary` never touches the encrypted bytes | Don't add a second decrypt path elsewhere |

## CONVENTIONS (specific to this dir)

- **One Prisma import per file** — the file's `import { Prisma, type Xxx as PrismaXxx } from "@/generated/prisma/client"` is local to that implementation.
- **`select` projections everywhere.** `prisma-post-repository.ts` has `POST_SUMMARY_SELECT` for list paths; the full `Prisma.PostSelect` for the single-post path. Never use a default `findMany`/`findUnique` without an explicit `select` — the default returns every column including `phoneE164`/`consentAt`/etc.
- **Mappers between domain types and Prisma types live next to the impl.** `toPostRecord`, `toPostSummary`, `toInterestRecord`, `toNotificationRecord` — all are pure functions, all stay in the impl file. No `toXxx` exports; the function is internal.
- **Native `Buffer` for `Bytes` columns, wrapped in `Uint8Array` only at the Prisma boundary** if the type system requires it. (Prisma's `Bytes` type is `Uint8Array<ArrayBuffer>`; `Buffer` doesn't structurally satisfy it. Wrap where the type is consumed, not at the value source.)
- **Pagination via `paginate(rows, limit)` helper** — fetches `limit + 1`, returns `{ items, nextCursor }`. See the helper definition in `prisma-post-repository.ts`. The Prisma-side types are: `take: limit + 1`, plus a stable secondary `orderBy` (e.g. `[{ createdAt: "desc" }, { id: "desc" }]`) for tie-breaking on duplicate timestamps.
- **Distinct user IDs** for `listInterestedUserIds` (FR11 dedup) — use Prisma's `distinct: ["userId"]` option.

## ANTI-PATTERNS

- **Do not import services here.** Repositories are downstream of services; reversing the dependency is a layering violation.
- **Do not decrypt `contact_value` outside `prisma-post-repository.ts:toPostRecord`.** The bytes are encrypted at the app layer; the repository boundary is the only place that handles plaintext. `toPostSummary` deliberately never reads the column.
- **Do not create a second `PrismaClient`.** All consumers share the singleton from `prisma-client.ts`. (This was a deleted duplicate in a prior cleanup; see the changelog in `AGENTS.md` at the project root.)
- **Do not `await` inside `Promise.all` for things that don't have to run in parallel.** The list repos already batch; calling `prisma.notification.create` N times in a `Promise.all` is correct when each is independent.
- **Do not use `findFirst` where `findUnique` works** on a unique column (e.g. `email`).

## UNIQUE STYLES

- **`POST_SUMMARY_SELECT`** is the canonical `select` clause for every list-style post query. When adding a new method that returns `PostSummary[]`, reuse it — don't redefine inline.
- **`prisma-post-repository.ts:toPostSummary` returns `PostSummary` (no `contactMethod`/`contactValue`).** The shop window, my-posts list, and moderation queue all use this projection. Adding `contactMethod`/`contactValue` to this mapper would silently re-enable the PII over-exposure fixed in the i18n work.
- **`prisma-notification-repository.ts:listQueued` uses raw SQL** (`$queryRaw`) because per-row exponential backoff (`updated_at < now() - make_interval(...)`) is not expressible in Prisma's `where` API. This is the only place in the codebase that drops to `$queryRaw` for a non-FTS reason.

## NOTES

- The shared `prisma-client.ts` configures a `PrismaPg` adapter pointing at `DATABASE_URL`. In dev (`NODE_ENV !== "production"`) it's cached on `globalThis.__precisasePrismaClient` to survive Next.js Fast Refresh — the cache key is the implementation detail, not the surface.
- `prisma-post-repository.ts` is the **largest file in this directory** (~390 lines). It carries the most business-context (the encrypted-contact mapping, the FTS-aware search query, the cursor pagination). Treat modifications as high-blast-radius.
- The migrations folder (`prisma/migrations/`) is what the schema is *applied as*; the file (`prisma/schema.prisma`) is what gets *generated*. They can drift — if a migration fails to apply, fix it in the SQL file, not by regenerating the schema.
