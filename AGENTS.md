# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-19T05:40Z
**Commit:** f5c5be7
**Branch:** main

## OVERVIEW

Casa da Cidade ("Precisa-se") community matching platform — Next.js 16 / Prisma 7 / PostgreSQL 16 / next-intl / next-auth v5 / argon2id / Resend / libphonenumber-js. Casa da Cidade is a church in Portugal; this app matches volunteering/donation requests and offers between community members. MVP scope: volunteering + donations (jobs deferred). See `CLAUDE.md` for project context and `docs/MVP.md` for the formal requirements brief.

## STRUCTURE

```
.
├── docs/                 # MVP, architecture, QA checklist (single source of truth for non-code)
├── messages/             # next-intl catalogs (en, pt-PT, pt-BR) — never edit code-side strings
├── prisma/               # schema.prisma, seed.ts, migrations/
├── src/
│   ├── app/[locale]/     # App Router routes — locale is read from cookie, not URL
│   ├── components/       # Shared UI (cards, badges, header, language switcher)
│   ├── i18n/             # next-intl config (routing, request, navigation wrappers)
│   ├── lib/              # Locale-agnostic helpers (format, region-defaults, design tokens)
│   ├── server/
│   │   ├── services/     # Pure business logic (PostService, InterestService, etc.) — port-driven, unit-tested with in-memory fakes
│   │   ├── repositories/ # Prisma-backed port implementations + the shared prisma client singleton
│   │   ├── auth/         # Separate AuthUserRepository port — split from main repos to keep its own dependency tree
│   │   ├── crypto/       # App-layer contact encryption (libsodium crypto_secretbox)
│   │   ├── notifications/# Worker mailer + email templates + dispatch service
│   │   └── service-instances.ts # Singleton wiring: services → repositories (the only place that constructs them)
│   └── worker/           # Standalone notification poller (separate container in prod; `pnpm worker`)
└── public/uploads/       # Dev-only upload dir (Docker prod needs a volume — see CLAUDE.md)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a state transition / business rule | `src/server/services/post-service.ts` | The single source of truth for the post state machine |
| Change a DB query | `src/server/repositories/prisma-*-repository.ts` | Port interface is in the matching `src/server/services/*.ts` |
| Add a UI string | `messages/<locale>.json` | CI parity check is a future TODO (ARCHITECTURE.md §10); grep for the key across all three files |
| Add a locale | `src/i18n/routing.ts` (locales array) + `messages/<locale>.json` (new) + `src/lib/region-defaults.ts` (region defaults) | See i18n-beyond-language plan in `.omo/plans/` |
| Touch the auth flow | `src/auth.ts` (NextAuth config) + `src/server/auth/user-repository.ts` (signup) + `src/server/services/auth-service.ts` (verifyCredentials) | `src/server/auth/` is a separate repo because the auth port family was built in parallel to the main ones |
| Touch the notification dispatch | `src/server/notifications/` + `src/server/services/notification-dispatch-service.ts` + `src/worker/notification-worker.ts` | The worker polls every 10s, applies per-row exponential backoff (since the latest session) |
| Modify the contact-encryption scheme | `src/server/crypto/contact-encryption.ts` | Encrypted at app layer, never read plaintext through Prisma |
| Add a new role-based RBAC check | `src/server/services/post-service.ts` (`isModerator()` helper) — extend there, then add an `Actor` permission check at the top of any new service method | Defense-in-depth: RBAC is checked at every layer (UI hide → page guard → action guard → service guard) |

## CODE MAP — top exports

| Symbol | Where | Role |
|--------|-------|------|
| `PostService` | `src/server/services/post-service.ts` | Post state machine (FR01–FR05, FR08–FR11) — the central domain |
| `PostRepository` (port) | `src/server/services/post-service.ts:155` | DB-agnostic data-access contract for posts |
| `PostSummary` | `src/server/services/post-service.ts:80` | Listing projection — strips `contactMethod`/`contactValue` so the shop window never decrypts contact info |
| `InterestService` | `src/server/services/interest-service.ts` | FR09 — express-interest flow + duplicate detection |
| `NotificationDispatchService` | `src/server/services/notification-dispatch-service.ts` | Worker batch loop; per-row backoff since 2026-07-18 |
| `AccountDeletionService` | `src/server/services/account-deletion-service.ts` | GDPR self-deletion (NFR08); PII anonymization |
| `AuthService.verifyCredentials` | `src/server/services/auth-service.ts` | Argon2id-verified credentials check; returns `AuthenticatedUser` (no password hash) |
| `PasswordService` | `src/server/services/password-service.ts` | argon2id wrapper (`hash`/`verify`) |
| `PhoneService.parse` | `src/server/services/phone-service.ts` | libphonenumber-js E.164 normalization; discriminated-union result |
| `routing` | `src/i18n/routing.ts` | `localePrefix: "never"` — locale in cookie, URL is `/posts/123` everywhere |
| `formatDateTime` / `formatCurrency` / `formatDistance` | `src/lib/format.ts` | Always thread `timeZone` explicitly — implicit server-TZ was a bug |
| `LanguageSwitcher` | `src/components/layout/language-switcher.tsx` | The only UI way to change locale |

## CONVENTIONS (deviations from generic)

- **Post port pattern:** every service owns a `Repository` interface (e.g. `PostRepository`, `AuthUserRepository`). `src/server/repositories/prisma-*.ts` is the only file allowed to import Prisma. Unit tests use in-memory fakes of these ports — no live DB needed for service tests.
- **Crypto at the repository boundary:** `PrismaPostRepository.toPostRecord` is the **only** place that decrypts `contact_value`. `toPostSummary` never touches the encrypted bytes. Don't add decryption elsewhere.
- **next-intl routing:** `localePrefix: "never"` — locale lives in the `NEXT_LOCALE` cookie. No `/pt-PT/` URL prefix anywhere. The `<LanguageSwitcher>` in the header is the only way to change.
- **`getTranslations({ locale, namespace })`** in Server Components requires an explicit `locale`. Server Component pattern: `const locale = await getLocale(); const t = await getTranslations({ locale, namespace })`.
- **Audit log on every state transition:** `PostService.{approvePost,rejectPost,closePost,reopenPost,resubmitPost,editActivePost}` each call `repo.addAuditLog(...)`. New transitions must do the same.
- **Form actions never trust the form's `locale` field** — they read `getLocale()` from `next-intl/server`. Removed in the locale-switcher session.
- **Domain types are local to each service file** (`PostRecord` in post-service.ts, `InterestRecord` in interest-service.ts). Cross-importing types across service files is discouraged; service ports are the public surface.
- **Server Actions use the `"use server"` directive** and live next to the page they serve (`app/[locale]/<route>/actions.ts`). They import `postService` from `@/server/service-instances`, **not** by constructing their own `PostService`.
- **Tests are co-located** with the file they test (`post-service.ts` → `post-service.test.ts`), and use in-memory fakes implementing the same port. Live-DB integration tests are a future TODO.

## ANTI-PATTERNS (THIS PROJECT)

- **Do not bypass the service layer.** Pages/actions never write Prisma directly except for read-only projections (the moderation page, the listings page author-name lookup). All state-changing flows go through `postService` / `interestService` / `accountDeletionService`.
- **Do not call `parsePhoneNumberFromString("...", "PT")` directly** — always use `PhoneService.parse` so the country hint, dedup, and error code are consistent.
- **Do not put `contactValue` plaintext in logs.** PII; encrypted at the repository layer.
- **Do not use hardcoded Portuguese/English strings in JSX.** Add to `messages/<locale>.json`. The CI parity check is a TODO; for now, grep all three files when adding a key.
- **Do not touch `User.country` etc. without going through `signin/signup` profile flows** — the columns feed the session augmentation chain (`session.user.country/timeZone/currency`).
- **PostService transitions are atomic** — each state-transition method wraps its read+write sequence in `repo.withTransaction(fn)` (Prisma-backed impl uses `prisma.$transaction`). C6 is closed. New transition methods must follow the `withTransaction` shell + `*Tx` body pattern (see `post-service.ts`).
- **Do not use `findFirst` where `findUnique` would work** on a unique column.

## UNIQUE STYLES

- **Domain comments at top of each service file** explain the state machine and design constraints (see `post-service.ts` header for an example). Match the existing comment density when adding new files.
- **Port interfaces are narrow** — each Repository exposes only the methods the service needs, never the full Prisma model. See `PostRepository` for the canonical example.
- **Discriminated unions for cross-service errors** — `PhoneValidationError`, `PostService` errors, etc. Each error type is exported and matchable via `instanceof`, never thrown as bare `Error`.

## COMMANDS

```bash
pnpm dev                                    # Next.js dev server
pnpm worker                                 # Notification poller (separate terminal)
pnpm test                                   # vitest run (175 tests, ~4s)
pnpm test:watch                             # vitest watch mode
pnpm build                                  # production build
pnpm lint                                   # eslint (0 errors expected)
pnpm exec prisma migrate deploy             # apply pending migrations
pnpm exec prisma db seed                    # idempotent seed fixtures
pnpm exec prisma generate                   # regenerate Prisma client
docker compose up -d db                     # start Postgres
docker exec precisase-db-1 psql -U precisase -d precisase -c "SELECT 1;"   # smoke-test the DB
```

## NOTES

- **Pre-existing migration-history bug:** `20260718192700_add_user_church_affiliation/migration.sql` has `CREATE INDEX` statements without `IF NOT EXISTS` that collide on shadow-DB replay. Worked around in the i18n-beyond-language session by running migrations via `prisma db execute` + `prisma migrate resolve --applied` rather than `prisma migrate dev`. New migrations should be plain `prisma migrate dev` runs once this is fixed.
- **`src/generated/prisma`** is committed to git (counter to the Prisma default). Don't delete it; CI doesn't regenerate.
- **The codebase is MVP-feature-frozen by community convention** — new features (jobs, reputation system, WhatsApp bot) are explicit non-goals. See `CLAUDE.md` "MVP scope" and `docs/ARCHITECTURE.md` §2.2.
- **Region-aware i18n in the session is recent.** `User.locale` was renamed to `User.uiLocale`; new columns `country`, `timeZone`, `currency`, `measurementSystem`. Many docs/comments still say "locale" for short — usually meaning UI locale. If you see a comment that conflicts with the schema, the schema is canonical.
- **Email delivery is dev-mode** by default — `createMailer()` returns `ConsoleMailer` (writes to `.dev-outbox/emails.jsonl`) unless `RESEND_API_KEY` is set.
- **The notification worker is real but the mailer is stubbed.** Closing a post queues a notification that the worker picks up; the email appears in `.dev-outbox/emails.jsonl`.
- **MVP-testable:** see `docs/MVP-QA-CHECKLIST.md` for a 45–60-minute manual end-to-end walkthrough covering every FR + the FR11 closure-notification flow.
