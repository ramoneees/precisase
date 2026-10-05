# QA-Review Gap Plan — waves G-1..G-3 (gaps G-B..G-P)

Prometheus plan for Sisyphus (OpenCode exec). Scope: implement the QA review decisions
(`docs/QA-REVIEW-DECISIONS.md` @ `8b5b5b7`, read IN FULL). **Plan only — this document
implements nothing.** Style follows compasso `a04b7e0` / `m1-wave1.md` (ground truth →
decisions → tasks → hard constraints → done-when).

Rev 2 (2026-10-05): reworked per Momus round-1 review (card `t_9068ca20`, comment #76 —
REQUEST_CHANGES, 3 blocking + 4 minor). All 7 findings addressed; scope unchanged
(11 tickets, no renumbering); one NEW user gate added (U-7, FR16 remove flow).

Binding repo law (verified this run, commit `8b5b5b7` on `main`):
`AGENTS.md` (port pattern, co-located tests, i18n cookie, RBAC layering, audit-log-on-transition),
`CLAUDE.md` (project context), `docs/MVP.md` (BR01), `prisma/schema.prisma`.

---

## 0. Ground truth (verified 2026-10-05, commit 8b5b5b7)

Stack: Next.js `16.2.10`, Prisma `^7.8.0`, PG 16, next-intl `^4.13.2` (`localePrefix: "never"`,
locale in `NEXT_LOCALE` cookie), NextAuth `5.0.0-beta.31`, Vitest `^4.1.10` (jsdom, co-located
tests, in-memory port fakes). `package.json` @ 8b5b5b7.

- `Post.status` state machine lives in `src/server/services/post-service.ts` (846 lines);
  `PostRepository` port at `post-service.ts:155`; every state transition wrapped in
  `withTransaction` + `addAuditLog` (repo law).
- `approvePostTx` `post-service.ts:392` / `rejectPostTx` `post-service.ts:446` check
  `isModerator(actor)` (`post-service.ts:329`) ONLY — **no author ≠ moderator guard** (G-C real).
- `getPost` `post-service.ts:749-767`: non-active posts → author or moderator only, everyone
  else gets `PostNotFoundError` (404-shaped). Tests already cover closed-post visibility:
  `post-service.test.ts:823-838` ("returns a closed post to its own author",
  "throws PostNotFoundError for a closed post viewed by an anonymous visitor", plus
  stranger/pending/rejected variants at :774-:819). → **G-M is already enforced in the
  service layer**; only the moderation-panel visibility question remains (see T-GM).
- Listing (`src/app/[locale]/page.tsx`): `listActivePosts` with cursor `?after=`;
  `DEFAULT_LISTING_PAGE_SIZE = 24` (`post-service.ts:150`); ordering `createdAt desc` in
  `PrismaPostRepository.listActive` (`prisma-post-repository.ts:277`) AND in the FTS path
  `searchActivePostsViaFtsIndex` (`prisma-post-repository.ts:395` `ORDER BY created_at DESC`,
  cursor `created_at <` at :394). Card shows `post.createdAt`
  (`src/components/posts/post-card.tsx:67`). `publishedAt` written on approval
  (`post-service.ts:408-411`) but never used for ordering/display.
- Search: generated column `search_vector` = `to_tsvector(posts_search_config(locale), title
  || ' ' || description)` (migration `20260718181500_post_search_indexes/migration.sql:33-35`);
  GIN index + pg_trgm indexes same file; query uses `plainto_tsquery(posts_search_config(locale),
  search)` (`prisma-post-repository.ts:384`). **No `unaccent` anywhere** (G-N real).
- `reopenPostTx` (`post-service.ts:566-600`): author-only, `closed → active` direct, no
  re-moderation, keeps `publishedAt` untouched. Interests from previous cycle survive
  (no deletion anywhere in reopen). → **G-F: document-only**.
- Photos: `src/lib/post-photos.ts` reads `extraAttributes.photos: string[]`; new-post form
  uploads via `/api/uploads` (`src/app/api/uploads/route.ts`: JPEG/PNG/WebP only, 5 MB cap,
  up-to-4 in `create-post-form.tsx:15`). **No `Photo` model** — photos are extraAttributes.
  → G-K narrows to a doc-note + naming clarification (no ticket).
- Signup (`src/app/[locale]/signup/signup-form.tsx:30-92`): `displayName`, `email`,
  `password` (+ consent). No username (G-J real). `User` model `prisma/schema.prisma:124`
  has no `username`, no `emailVerifiedAt` (G-I real). `email` is already `@db.Citext @unique`.
- `AccountDeletionService` (`src/server/services/account-deletion-service.ts:1-90`):
  anonymize-in-place, posts survive, sent messages hard-deleted (G-D divergence, HOLD).
- Notification worker: `src/worker/notification-worker.ts` polls every 10 s
  (`NOTIFICATION_WORKER_POLL_INTERVAL_MS` :32) via `NotificationDispatchService`; channel
  `in_app`/`email` both exist. `NotificationType` enum `schema.prisma:91` — no expiry type.
- Contact: `Post.contactMethod/contactValue` (encrypted, `schema.prisma:225-229`) still in
  schema; chat confirmed as the contact flow (decisions §9/§16) — vestigial-field decision
  folded into HOLD gate U-3.
- i18n: catalogs `messages/{en,pt-PT,pt-BR}.json`; string parity across the 3 files is the
  repo convention; docs in English (AGENTS.md "never edit code-side strings").
- Migrations: `prisma migrate dev` is **broken on this repo** (AGENTS.md:110 — shadow-DB
  replay collision in `20260718192700_add_user_church_affiliation`, `CREATE INDEX`
  without `IF NOT EXISTS`). Sanctioned workaround: apply each new migration with
  `pnpm prisma db execute --file <migration.sql> --schema prisma/schema.prisma`, then
  record it with `pnpm prisma migrate resolve --applied <migration_name>`. This is the
  verification path every migration ticket below uses.
- No `remove` moderation flow exists. `ModerationActionType.remove` is a dead enum value
  (`schema.prisma:74`); `src/app/[locale]/moderation/actions.ts` exports only
  `approvePostAction` (:47) and `rejectPostAction` (:76); no `removePost` service method,
  no UI, no Prisma delete anywhere. FR16 ("approve, reject, or remove") is partially
  unbuilt → U-7.

### Divergence notes vs docs/QA-REVIEW-DECISIONS.md (must-read for Sisyphus)

1. The decisions doc was written against commit `6f46568`; HEAD is `8b5b5b7` (doc-only
   commit + hamburger-menu + review-fix commits since). The two status drifts found are
   listed above (G-M, G-K). **Task T-GM verifies G-M end-to-end; it does not assume the
   doc's "check public detail-route" claim.**
2. Decisions §17 (notifications in-app only): treated as already-resolved divergence — the
   doc itself says "flag, don't rip out". No ticket.
3. **Decisions §1.5 ("✅ remove is a hard delete — matches") is FALSE about the code.**
   The `remove` moderation flow does not exist (see ground truth above): only the enum
   value and the `ModerationActionRecord` type union. T-G1-2 is therefore scoped to
   approve/reject only; the missing FR16 remove flow is escalated as user gate **U-7** —
   it is a NEW gap for Ramon, not something a guard ticket invents.
4. i18n terminology (G-L): Momus's round-1 grep found **zero** occurrences of
   `necessidade`/`petição`/`procura` as type nouns in the pt-PT/pt-BR catalogs, `pedido`/
   `oferta` already consistent, and perfect key parity (340/340/340 identical sets).
   T-G1-4 is a verify-and-fix-residue pass, not a rewrite.

### Decisions settled in this plan (bind all tickets; Sisyphus does not re-decide)

- **D1 (G-E).** Post expiry = 60 days from approval. `Post.expiresAt timestamptz` (nullable).
  Set to `publishedAt + 60d` on approval; refreshed to `now + 60d` on renewal (author-only)
  and on reopen (renewal semantics per decisions §6/§7 — "interests kept", post re-enters
  active with fresh 60-day window). Reminder notification 7 days before expiry, in-app.
  Expiry sweep: `active → closed` with existing `post_closed` notification, reusing the
  notification worker's 10 s poll (a periodic sweep job in the worker, gated to run at most
  once per minute). No per-user renewal limits in MVP.
- **D2 (G-E).** New `NotificationType.postExpiryReminder` (migration + enum + payload
  `{ expiresAt }`); NOT a new channel — `in_app`. New `AuditLog` action strings:
  `post.renew`, `post.expire` (sweep), following the `post.*` convention in
  `buildPostAuditEntry`.
- **D3 (G-O).** Ordering switches to `publishedAt desc, id desc` (tie-break) with
  `coalesce(published_at, created_at)` fallback for legacy rows, in BOTH `listActive` and
  the FTS search path. Page size 24 → **10**. **Numbered pagination** (page param, offset
  based) replaces the cursor "load more" — decisions §20 struck out "carregar mais" and
  underlined "paginação"; numbered pages are the decided UX. Search + filters keep the same
  query params; `?after=` support is REMOVED in the same change (no dual mode).
- **D4 (G-O).** `PostSummary`/`PostCard` display `publishedAt` (approval date) instead of
  `createdAt`. `PostSummary` already carries `publishedAt` (`post-service.ts:128`) — card
  + page wire-up only. Card date label i18n key updated in all 3 locales.
- **D5 (G-N).** `unaccent` applied at BOTH index and query sides. **Index side requires an
  IMMUTABLE wrapper**: `unaccent()` is STABLE and generated-column expressions must be
  IMMUTABLE, so `to_tsvector(cfg, unaccent(...))` fails at `ALTER TABLE` ("generation
  expression is not immutable"). Add (in the same migration, mirroring the
  `posts_search_config` precedent in `20260718181500:14-29`):
  `CREATE FUNCTION immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL
  SAFE STRICT AS $$ SELECT unaccent('public.unaccent'::regdictionary, $1) $$;`
  — schema-qualified two-argument form pins the dictionary and search_path (PG docs F.48,
  https://postgresql.org/docs/current/unaccent.html, accessed 2026-10-05). Generated column
  becomes `to_tsvector(posts_search_config(locale), immutable_unaccent(title || ' ' ||
  description))` (drop+recreate, raw SQL). **Query side keeps plain `unaccent(search)`**
  (no immutability needed outside a generated column/index). `unaccent` is also added to
  the datasource `extensions` list in schema.prisma (currently `[pgcrypto, citext,
  pg_trgm]` at :19) alongside the raw `CREATE EXTENSION IF NOT EXISTS unaccent;`, keeping
  schema and DB consistent. pg_trgm indexes stay untouched.
- **D6 (G-I).** Blocked-action set = `createPost` + `expressInterest` (both entry points into
  community contact; publishing without verification would make the chat gate trivially
  bypassable). Chatting on an EXISTING conversation stays allowed (a verified-then-changed-email
  user must not be cut off mid-conversation). `User.emailVerifiedAt timestamptz` (nullable).
  Verification email reuses the hashed-token pattern of `PasswordResetToken`
  (`schema.prisma:186-202`): new `EmailVerificationToken` model. Signup blocks nothing at
  creation (account exists immediately) — the gate is on the two actions above. Existing
  users: backfill `emailVerifiedAt = createdAt` in the migration (they are already active
  community members; re-gating them is a breaking surprise). Re-verification on email change:
  OUT of scope here (no email-change flow exists today).
- **D7 (G-J).** `User.username`: `@db.Citext`, `@unique`, `3..24` chars, `^[a-z0-9_.]+$`
  (service-layer validation, citext handles case), reserved-words blocklist
  (`admin`, `moderador`, `moderator`, `root`, `system`, `suporte`, `support`, `api`, `null`)
  — keep the list in one exported const next to the signup validation. Signup form gains a
  username field (required); existing users get a migration backfill
  `username = 'user_' || left(md5(id::text), 8)` — underscore, NOT hyphen: the format
  MUST validate against D7's own `^[a-z0-9_.]+$` (a `'user-'` prefix would violate the
  regex every legacy row is expected to satisfy). Then profile edit field; post author
  chip shows `username` falling back to `displayName` when null (legacy). displayName
  stays (not unique, remains on profile).
- **D8 (G-P).** Dirty-form warning = `beforeunload` + in-app navigation guard, both via a
  small `useUnsavedChanges(dirty: boolean)` hook in `src/lib/` (client). Applied to
  `create-post-form.tsx` and `edit-post-form.tsx`. Dirty = any field changed from initial
  values (simple equality on the form state object, not field-level tracking). No draft
  persistence.
- **D9 (G-L).** Terminology pass scope: user-facing strings in `messages/{en,pt-PT,pt-BR}.json`
  + this plan's new keys. The data model stays neutral (`PostType.request/offer`). The QA
  decision ("necessidade = oferta" unify) means: one consistent noun pair per locale for
  request/offer used everywhere (e.g. pt: pedido/oferta, en: request/offer), no mixing of
  "necessidade/petição/procura" synonyms. Audit + edit catalogs ONLY — no code renames.
- **D10 (G-B).** FR15 wording change is a one-line edit in `docs/MVP.md:52` aligning with
  BR01 (`docs/MVP.md:57`); also strike the "trusted history" phrase from the MVP.md:22
  out-of-scope line if inconsistent after the edit. Docs stay English.
- **D11.** Every PR (ticket) must keep `pnpm test`, `pnpm lint`, `pnpm build` green and keep
  the 3-locale message parity (grep new keys across all 3 files). Conventional commits.

---

## WAVE 1 (G-1) — quick wins: docs + copy + one real guard

Parallelizable within the wave except where noted. No schema changes. Nothing here is
[HYBRID]/[BOSS].

### T-G1-1 — G-B: FR15 wording matches BR01 (docs only)

**Estimate:** 0.5–1 h. `(P)` (no file overlap with T-G1-2/3/4). Not [HYBRID]/[BOSS].

Files:
- `docs/MVP.md` (line 52 FR15; check line 22 + line 140 after edit)

Directive (D10): FR15 becomes "Approval workflow: every post requires moderator approval
before going live (BR01)." Remove "from users without prior trusted history". Verify no other
MVP.md line still implies conditional approval (`grep -n "trusted\|prior history" docs/MVP.md`).
Do NOT touch `docs/QA-REVIEW-DECISIONS.md` (historical record).

Acceptance criteria:
- FR15 text states universal approval, matching BR01 verbatim intent.
- `grep -in "trusted" docs/MVP.md` returns only the BR01/future-phase context (line ~57).
- No code changes in this ticket.

Verification: `git diff --stat` shows only `docs/MVP.md`; `pnpm test` still green (no-op check).

Commit: `docs(mvp): align FR15 with BR01 — universal moderator approval (G-B)`

Evidence: diff + grep output in the PR body.

### T-G1-2 — G-C: author ≠ moderator guard on approve/reject + tests

**Estimate:** 1–2 h. `(P)` (touches only post-service + its test; coordinate with T-G1-4 via
the plan's key list, no overlap). Not [HYBRID]/[BOSS].

**Scope: approve/reject ONLY.** There is no `remove` moderation flow in the codebase (dead
enum value `ModerationActionType.remove`, `schema.prisma:74`; `moderation/actions.ts`
exports only approve :47 / reject :76 — see divergence note 3). The missing FR16 remove
flow is user gate **U-7**, NOT part of this ticket; do not invent a remove action here.

Files:
- `src/server/services/post-service.ts` (`approvePostTx` :392, `rejectPostTx` :446 — add guard
  right after the `isModerator` check)
- `src/server/services/post-service.test.ts` (new `describe` block)

Directive: if `moderator.id === post.authorId` → throw `UnauthorizedPostActionError` (exists,
imported in `moderation/actions.ts:20`) with message "Moderators cannot moderate their own
posts." (QA §4: "Não pode"). Applies to both approve and reject.

Acceptance criteria:
- approve/reject by the post's own author-moderator throws
  `UnauthorizedPostActionError`, transaction aborts, no `ModerationAction` row, no status change.
- Approve/reject by a DIFFERENT moderator still works (existing tests keep passing).
- Admin is NOT exempt (role `admin` authoring a post gets the same block).

Tests (vitest, in-memory fake, co-located — repo convention):
- `throws when a moderator approves their own post` / `... rejects their own post`
- `allows a moderator to approve another author's post` (guard-not-too-greedy)
- `blocks an admin authoring-moderator too` (admin != bypass)

Verification: `pnpm vitest run src/server/services/post-service.test.ts`

Commit: `feat(moderation): block self-approval/rejection — author ≠ moderator guard (G-C)`

Evidence: new test names + run output in PR body.

### T-G1-3 — G-F: document reopen-without-re-moderation as intended

**Estimate:** 0.5 h. `(P)`. Not [HYBRID]/[BOSS].

Files:
- `docs/MVP.md` (FR05/reopen section — add explicit note)
- `src/server/services/post-service.ts` (KDoc on `reopenPost` :562 — expand the existing doc
  comment; ZERO behavior change)

Directive: record QA §7 decisions in both places: reopen goes `closed → active` directly with
no re-moderation because editing an active post never resets to pending (current, decided
behavior); reopened post keeps original `publishedAt` (ordering by original date — "com a
primeira"); interests from the previous cycle are kept. Cross-ref `docs/QA-REVIEW-DECISIONS.md` §7.

Acceptance criteria: docs + KDoc updated; `git diff` shows no logic lines; tests untouched & green.

Verification: `pnpm vitest run src/server/services/post-service.test.ts` (must be unchanged-green).

Commit: `docs(reopen): reopen never re-moderates; keeps publishedAt and prior interests (G-F)`

### T-G1-4 — G-L: terminology verify-and-fix-residue, 3 locales

**Estimate:** ~1 h. `(P)` (message catalogs only; touches no TS). Not [HYBRID]/[BOSS].

**Premise (rev 2):** round-1 grep found ZERO stray `necessidade`/`petição`/`procura`
type-nouns in the pt catalogs, `pedido`/`oferta` already consistent, and 340/340/340 key
parity (divergence note 4). This is a verification pass that fixes whatever residue it
finds — NOT a rewrite. Expected outcome: no-op diff or near-no-op.

Files:
- `messages/pt-PT.json`, `messages/pt-BR.json`, `messages/en.json` (audit)
- `docs/MVP.md` ONLY IF a user-visible FR string is quoted there inconsistently (check, likely no)

Directive (D9): audit every user-facing string for request/offer noun consistency. Rules:
- Fixed noun pair per locale: pt-PT/pt-BR `pedido` / `oferta`; en `request` / `offer`.
- Eliminate stray synonyms: `necessidade`, `petição`, `procura`, `precisa` as NOUNS for the
  post type (the brand name "Precisa-se" in UI chrome/header is NOT a post-type noun — keep).
- Type toggle, filters, badges (`TypeBadge`), empty states, form labels, my-posts labels,
  confirmation dialogs, notification payload strings (if any user-facing).

Acceptance criteria:
- No `necessidade`/`petição`/`procura` string survives in any catalog as a type descriptor
  (grep list in evidence — expected empty; if non-empty, that is the residue fixed).
- The 3 catalogs keep identical key sets (parity check — count keys per file, must match).
- Visual smoke: `/` shop window + `/posts/new` in pt-PT shows pedido/oferta consistently.

Verification: `node -e` key-parity script (or jq) proving equal key sets; grep evidence
(expected: zero matches, proving the round-1 finding holds at merge time).

Commit: `chore(i18n): verify request/offer terminology consistency across en, pt-PT, pt-BR (G-L)`

Evidence: grep before/after + key-parity output.

**Wave 1 merge gate:** each ticket = own PR; T-G1-2 needs a passing test run in CI; reviewer
(Ramon or delegated reviewer) checks G-L pt wording by eye (native-speaker gate [HYBRID]-lite:
Ramon reads the diff, no deploy needed).

---

## WAVE 2 (G-2) — small code: visibility, search, forms, listing

Order: T-G2-1 first; then T-G2-2, T-G2-3, T-G2-4 run in parallel (disjoint files except the
messages catalogs — new i18n keys are listed per ticket; merge order for catalog conflicts:
rebase, keys are additive).

### T-G2-1 — G-M: closed-posts author-only — verify end-to-end + close remaining hole

**Estimate:** 1–2 h. Runs FIRST in wave 2 (its outcome decides nothing else, but it owns the
post-visibility test surface). Not `(P)` with T-G2-4 (both touch listing/page). Not [HYBRID]/[BOSS].

Files:
- `src/server/services/post-service.test.ts` (add stranger-user × closed-post case if missing
  — verify at :823-:838 which cases exist; add only what's absent)
- `src/app/[locale]/moderation/page.tsx` (verify pending-only listing — already
  `listPendingPosts()`, fine)
- `src/app/[locale]/page.tsx` (confirm `listActive` filter only ever returns active — port
  contract; no change expected)

Directive: QA §18 decision "finished publication visible only to its author". Ground truth:
`getPost` already 404s non-authors for closed posts and tests cover author/anonymous. This
ticket CLOSES THE LOOP: (a) add the missing stranger-user × closed test if absent;
(b) confirm the public detail route renders `notFound()` from `PostNotFoundError`
(`posts/[id]/page.tsx:38-42` — already wired); (c) confirm my-posts listing showing the
author their own closed posts is intended (it is — author's own view). If (a)-(c) all hold,
this ticket is tests+evidence only; if any fails, fix in the service/page per existing patterns.

Acceptance criteria:
- Test matrix for getPost visibility: {anonymous, stranger, author, moderator, admin} ×
  {pending, active, closed, rejected} fully covered (fill gaps only).
- Detail route: closed post by direct URL → 404 for non-author (test or route-level evidence).

Verification: `pnpm vitest run src/server/services/post-service.test.ts`

Commit: `test(posts): complete closed-post author-only visibility matrix (G-M)`

### T-G2-2 — G-N: accent-insensitive search (unaccent)

**Estimate:** 2–4 h. `(P)` after T-G2-1. Not [HYBRID]/[BOSS]. Needs a local PG (docker compose
`make` target / `docker-compose.yml` db service) for migration verification — if the sandbox
has no DB, the migration SQL is still complete and verified syntax-wise; flag in PR.

Files:
- `prisma/migrations/<ts>_post_search_unaccent/migration.sql` (new, raw SQL)
- `src/server/repositories/prisma-post-repository.ts` (:384 query — wrap search with `unaccent()`)
- `prisma/schema.prisma` (datasource `extensions` += `unaccent` — currently `[pgcrypto,
  citext, pg_trgm]` at :19; plus comment on `Post.searchVector` — mention immutable_unaccent)
- `prisma/migrations/<ts>_post_search_unaccent/migration.sql` must follow the drop/recreate
  pattern of `20260718181500` (search_vector is a raw-SQL managed column; Prisma can't diff it)

Migration content (per D5 — note the IMMUTABLE wrapper; plain `unaccent()` in a generated
column is rejected by Postgres, "generation expression is not immutable", because the
function is STABLE):
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE wrapper, mirroring posts_search_config in 20260718181500:14-29.
-- Two-argument, schema-qualified form pins dictionary + search_path (PG docs F.48).
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT unaccent('public.unaccent'::regdictionary, $1) $$;

-- drop dependent index first, then column, then recreate with immutable_unaccent, then index
DROP INDEX IF EXISTS "posts_search_vector_idx";
ALTER TABLE "posts" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
        to_tsvector(posts_search_config(locale), immutable_unaccent(coalesce(title, '') || ' ' || coalesce(description, '')))
    ) STORED;
CREATE INDEX "posts_search_vector_idx" ON "posts" USING GIN ("search_vector");
```
Query side (`searchActivePostsViaFtsIndex`): `plainto_tsquery(posts_search_config(locale), unaccent(${search}))` — plain `unaccent()` is fine here (no immutability required outside a generated column).

Acceptance criteria:
- Migration applies cleanly on a fresh DB and on the current dev DB (CONCURRENTLY not needed —
  MVP table size; note the table rewrite in the PR).
- `unaccent('água') = unaccent('agua')` matches: seeded posts with accents are found by
  accent-free queries AND vice versa (manual psql evidence `SELECT ... WHERE search_vector @@
  plainto_tsquery('portuguese', unaccent('agua'))`).
- Trigram path (partial words) unchanged and still working.
- Unit tests: none possible without live DB (repo layer is Prisma-only by law) — evidence is
  psql/manual verification; keep service tests untouched-green.

Verification (per Hard constraint #4 — `prisma migrate dev` is broken on this repo,
AGENTS.md:110; use the sanctioned workaround):
`docker compose up -d db && pnpm prisma db execute --file prisma/migrations/<ts>_post_search_unaccent/migration.sql --schema prisma/schema.prisma && pnpm prisma migrate resolve --applied <ts>_post_search_unaccent`,
then manual search queries; `pnpm test`.

Commit: `feat(search): accent-insensitive full-text search via immutable unaccent wrapper (G-N)`

### T-G2-3 — G-P: unsaved-changes warning on post forms

**Estimate:** 1–2 h. `(P)` after T-G2-1 (no file overlap with T-G2-2/4? — touches forms only;
parallel-safe with T-G2-2). Not [HYBRID]/[BOSS].

Files:
- `src/lib/use-unsaved-changes.ts` (new client hook, D8)
- `src/app/[locale]/posts/new/create-post-form.tsx` (wire hook; reset dirty after successful submit)
- `src/app/[locale]/my-posts/[id]/edit/edit-post-form.tsx` (same)
- `messages/{en,pt-PT,pt-BR}.json` (warning string keys ×3)
- `src/app/[locale]/posts/new/create-post-form.test.tsx` + `edit-post-form.test.tsx` (add cases)

Directive (D8): hook exposes `useUnsavedChanges(dirty)` → registers `beforeunload` (browser
dialog) and in-app navigation guard. In-app guard mechanism: Next.js App Router has no router
event to intercept — use the `<Link>`-based nav check via `onNavigate` (next-intl `Link`
supports passing props? verify) or simplest compliant approach: confirm dialog on the
form's cancel/back button + `beforeunload` for everything else. **Sisyphus verifies the
mechanism on this Next 16.2.10 / next-intl 4.13.2 stack before implementing** — the accepted
fallback is: `beforeunload` (refresh/close) + explicit confirm on in-app nav buttons inside
these two forms (their cancel/back controls). Document the chosen mechanism in the hook's KDoc.

Acceptance criteria:
- Editing any field then refreshing → native "unsaved changes" dialog.
- In-app navigation away via the form's own cancel/back → custom confirm (i18n, 3 locales).
- Submitting successfully clears the dirty state (no dialog on post-submit nav).
- No dialog when the form was never edited.
- Tests: render form, change field, assert `beforeunload` handler registered / cancel-confirm
  fires (jsdom: assert on the hook's exposed state + confirm spy).

Verification: `pnpm vitest run src/app/\[locale\]/posts/new/create-post-form.test.tsx src/app/\[locale\]/my-posts/\[id\]/edit/edit-post-form.test.tsx`

Commit: `feat(forms): warn on unsaved changes in new/edit post forms (G-P)`

### T-G2-4 — G-O: publishedAt ordering + page size 10 + numbered pagination

**Estimate:** 3–4 h. After T-G2-1 (shares `page.tsx` surface). Not `(P)` with T-G2-1/3-locale
files (messages keys — coordinate via this plan's key list). Not [HYBRID]/[BOSS].

Files:
- `src/server/services/post-service.ts` (`DEFAULT_LISTING_PAGE_SIZE` 24→10 :150;
  `ListActivePostsFilter`: replace `after` cursor with `page: number` (:143-147))
- `src/server/repositories/prisma-post-repository.ts` (`listActive` :266-291: offset pagination
  `skip/take`, ordering `[{ publishedAt: "desc" }, { id: "desc" }]` with coalesce fallback —
  Prisma can't coalesce in orderBy, so use raw SQL or order by two generated sorts; simplest
  compliant: order by `publishedAt desc nulls last` then `createdAt desc`? — NO: decisions
  require single ordering key. Use `$queryRaw` ordering `ORDER BY coalesce(published_at, created_at) DESC, id DESC`
  for BOTH the plain and FTS paths, mirroring the existing raw pattern at :395; OR keep
  findMany with a computed sort column if cheaper — Sisyphus picks, but ordering expression
  must be identical in both paths)
- `src/app/[locale]/page.tsx` (page param parse, numbered pagination UI replacing `?after=`
  load-more at :207-210, `loadMore` key → `pagination.*` keys)
- `src/components/posts/post-card.tsx` (+ test): display `publishedAt` (fallback `createdAt`
  for legacy/null) instead of `createdAt` (:67)
- `messages/{en,pt-PT,pt-BR}.json` (new pagination keys ×3, remove `loadMore`)
- `src/app/[locale]/posts/[id]/page.tsx` detail date display — check which date it shows;
  align to publishedAt per decisions §20 (approval date is THE public date).

Acceptance criteria:
- `/` lists actives ordered by approval date desc; seeded legacy rows without `publishedAt`
  sort by `createdAt` seamlessly mixed (no nulls-first pile-up).
- Page size 10; numbered pagination (page 1..N, prev/next + numbers); `?after=` links gone;
  deep page with filters+search works (`?page=3&type=request&...`).
- Card + detail show approval date; i18n label says "Publicado" (published) — 3 locales.
- `PaginatedPosts` port shape updated (hasMore/nextCursor → page/hasNextPage or equivalent) —
  update the in-memory fake + all tests referencing the old shape.

Verification: `pnpm test` (fake updated), manual `/` browsing with seeds; `pnpm build`.

Commit: `feat(listing): order+display by approval date, page size 10, numbered pagination (G-O)`

**Wave 2 merge gate:** per-PR review + CI green; G-N requires the reviewer to have applied
the migration locally via the `db execute` + `migrate resolve` workaround (Hard constraint
#4 — there is NO CI DB run today; nobody can rely on `prisma migrate dev` until the
`20260718192700` shadow-DB bug is fixed).

---

## WAVE 3 (G-3) — schema + flows

Order: T-G3-1 (username) → T-G3-2 (email verification) → T-G3-3 (expiry). Reason: username
touches signup+schema; email-verification touches signup+schema+notifications; expiry touches
schema+notifications+worker. Serializing avoids schema.prisma / signup-form / messages-catalog
merge conflicts (three tickets all migrate + touch messages). If Sisyphus runs them on
separate branches merged serially, parallel DRAFTING is fine but merges are serial.

### T-G3-1 — G-J: username as unique identifier

**Estimate:** 3–4 h. First in wave 3. Not [HYBRID]/[BOSS] (reserved-list is a plan decision, D7).

Files:
- `prisma/schema.prisma` (User: add `username String? @unique @db.Citext @map("username")` —
  nullable during backfill, then tighten? NO: keep nullable-unique forever; citext unique
  index; validation `3..24`, regex, reserved words at the service layer per D7)
- `prisma/migrations/<ts>_add_user_username/migration.sql` (column + unique citext index +
  backfill `username = 'user_' || lower(left(md5(id::text), 8))` deterministic — underscore
  prefix per D7, validates against `^[a-z0-9_.]+$`)
- `src/server/auth/user-repository.ts` (signup: accept + persist username; unique-violation →
  typed error)
- `src/app/[locale]/signup/signup-form.tsx` (+ test): required username field, client
  validation mirroring D7
- `src/app/[locale]/signup/actions.ts`: pass-through + error mapping (`usernameTaken`)
- `src/server/services/post-service.ts` — no change; author chip: page-level join already
  fetches `displayName` (`posts/[id]/page.tsx:41`) — extend select to username, prefer
  username fallback displayName
- `src/app/[locale]/page.tsx` author-name lookup (:52-59 region): same prefer-username tweak
- `messages/*.json`: username label/help/taken ×3
- `prisma/seed.ts`: seed users get usernames

Acceptance criteria:
- Signup without username fails validation; with username works; duplicate (case-insensitive:
  `Joao` vs `joao`) → `usernameTaken` error surfaced in-form.
- `admin`, `moderator`, `root`, `api`, `null`, `system`, `suporte`, `support`, `moderador` rejected.
- Existing users after migration have deterministic usernames; posts render username when set.
- Unit tests: validation (regex/length/reserved) + duplicate signup path (in-memory fake);
  form test for field presence + error display.

Verification: `pnpm test`; migration on local DB via the sanctioned workaround (Hard
constraint #4): `pnpm prisma db execute --file prisma/migrations/<ts>_add_user_username/migration.sql --schema prisma/schema.prisma && pnpm prisma migrate resolve --applied <ts>_add_user_username`; manual signup.

Commit: `feat(users): username unique identifier — citext unique, signup field, author chip (G-J)`

### T-G3-2 — G-I: email verification gate

**Estimate:** 3–4 h. After T-G3-1 (signup form conflict). Not [HYBRID]/[BOSS]. ⚠️ Actual email
SENDING of the verification link in dev/staging is [HYBRID]-ish (needs Resend keys / inbox
check) — code + tests are not; the PR itself is not blocked, only live-send verification is.

Files:
- `prisma/schema.prisma`: `User.emailVerifiedAt DateTime?`; new `EmailVerificationToken` model
  (clone `PasswordResetToken` shape `schema.prisma:186-202`: hashed token, expiresAt, usedAt,
  `@@index([userId, expiresAt])`)
- `prisma/migrations/<ts>_add_email_verification/migration.sql`
- New `src/server/services/email-verification-service.ts` (+ test, in-memory fake):
  `issueVerification(user)` (token create + Notification `in_app`? NO — verification needs an
  EMAIL with a link; reuse Resend mailer + template, port-driven), `verify(token)` → sets
  `emailVerifiedAt`, `isVerified(user)`
- `src/server/services/post-service.ts`: `createPost` guard — author unverified → typed error
  `EmailNotVerifiedError` (export; map in form actions)
- `src/server/services/interest-service.ts`: same guard in `expressInterest`
- `src/server/notifications/` (template for verification email) + `src/worker/` no change
  (dispatch already generic over Notification rows — VERIFY the mailer renders arbitrary
  templates or needs a case; follow password-reset template pattern)
- `src/app/[locale]/signup/*`: post-signup redirect to a "check your email" state; banner
  component (messages keys ×3)
- `src/app/[locale]/verify-email/page.tsx` (new route: token consume → success/error)
- `src/app/[locale]/posts/new/*` + interest button: surface blocked-action error string
- `messages/*.json` keys ×3

Acceptance criteria:
- Unverified user: `createPost` and `expressInterest` throw `EmailNotVerifiedError`; verified
  user unaffected; EXISTING conversations still work for unverified users (D6).
- Verification link (hashed-token, expiring, single-use — usedAt prevents replay) verifies;
  re-request link throttled (reuse password-reset throttle pattern if present — check
  `password-reset-service.ts`; if none, simple per-user cooldown const).
- Migration backfills `emailVerifiedAt = created_at` for all existing users (D6).
- Unit tests: issue/verify/replay/expiry on in-memory fake; guards on both services; backfill
  SQL verified on local DB.

Verification: `pnpm test`; local migration via the sanctioned workaround (Hard constraint
#4): `pnpm prisma db execute --file prisma/migrations/<ts>_add_email_verification/migration.sql --schema prisma/schema.prisma && pnpm prisma migrate resolve --applied <ts>_add_email_verification`; manual: signup → (dev mail catch) → verify → publish.

Commit: `feat(auth): email verification gate on publish and interest (G-I)`

### T-G3-3 — G-E: 60-day expiry + renewal + reminder + sweep

**Estimate:** 6–8 h (rev 2: 4 h was not honest for schema+migration with enum care + 3
service methods + sweep + reminder dedupe + worker gating + my-posts UI + 3-locale i18n +
full test matrix + manual time-travel verification). Last in wave 3 (touches schema,
notifications, worker, my-posts UI). Not [HYBRID]/[BOSS] (60/7 constants are plan
decisions, D1/D2).

Files:
- `prisma/schema.prisma`: `Post.expiresAt DateTime? @map("expires_at") @db.Timestamptz()` +
  `@@index([status, expiresAt])` for the sweep; `NotificationType.postExpiryReminder`
- `prisma/migrations/<ts>_add_post_expiry/migration.sql`: column, index, enum value
  (`ALTER TYPE ... ADD VALUE 'post_expiry_reminder'` — needs care: add value BEFORE using it
  in the same migration is fine in PG 16 when the enum isn't used in the same statement's
  table rewrite; follow `20260816000002_add_chat_notification_type` pattern — READ IT FIRST)
- `src/server/services/post-service.ts`:
  - `approvePostTx`: set `expiresAt = now + 60d` alongside `publishedAt` (:408-411 region)
  - new `renewPost({ postId, actor })`: author-only, `active`-only, `expiresAt = now + 60d`,
    audit `post.renew`; TESTS
  - `reopenPostTx`: also reset `expiresAt = now + 60d` (D1)
  - new `sweepExpiredPosts(now)`: `active` posts with `expiresAt < now` → `closed`
    (+`closedAt = expiresAt`), `post_closed` notification per post (reuse closePost
    notification pattern — check whether closePost notifies AUTHOR or INTERESTED users;
    expiry deactivation notifies the AUTHOR), audit `post.expire`; TESTS with in-memory fake
- `src/worker/notification-worker.ts`: periodic sweep call — worker loop already polls every
  10 s; add a time-gated sweep (run at most once per minute, `SWEEP_INTERVAL_MS` env) calling
  `postService.sweepExpiredPosts(new Date())`; reminder emission: `sweepExpiredPosts` ALSO
    issues `postExpiryReminder` for posts entering their last 7 days (dedupe: only when
    `expiresAt - now` crosses 7d within this sweep window — simplest: track
    `lastReminderAt`? NO — simplest compliant: reminder when `expiresAt` between `now` and
    `now+7d` AND no `postExpiryReminder` notification exists for the post since
    `expiresAt - 7d`; implement dedupe as a repo query, keep it in the sweep)
- UI: my-posts row shows expiry countdown chip + "Renew" button (author-only, active posts)
  → `src/app/[locale]/my-posts/my-post-row.tsx` + `actions.ts` (call `renewPost`); messages ×3
- Backfill in migration: `UPDATE posts SET expires_at = published_at + interval '60 days' WHERE status = 'active' AND expires_at IS NULL` (posts lacking `publishedAt`? active posts always
  have it — approve sets it; verify with `SELECT count(*) FROM posts WHERE status='active' AND published_at IS NULL` before shipping the backfill; if >0, coalesce created_at).

Acceptance criteria:
- Approval sets expiry; renew extends to now+60d; reopen resets to now+60d; author-only.
- Sweep closes expired actives (one notification to author each, audit row each) exactly once
  (idempotent: second sweep run is a no-op).
- Reminder emitted ≤7 days before expiry, once per post per expiry cycle.
- Worker config: sweep interval env-tunable; default 60 s; disabled in vitest (no timers).
- Unit tests (in-memory fake): approve sets expiry; renew happy/deny paths; reopen resets;
  sweep closes + notifies + idempotent; reminder dedupe.

Verification: `pnpm test`; local migration via the sanctioned workaround (Hard constraint
#4): `pnpm prisma db execute --file prisma/migrations/<ts>_add_post_expiry/migration.sql --schema prisma/schema.prisma && pnpm prisma migrate resolve --applied <ts>_add_post_expiry`; manual time-travel: approve seed post, `UPDATE posts SET expires_at = now() - interval '1 hour'`, trigger worker once, observe closed status + notification.

Commit: `feat(posts): 60-day expiry with renewal, reminder notification and deactivation sweep (G-E)`

**Wave 3 merge gate:** serial merges in order G-J → G-I → G-E; after each, full `pnpm test` +
`pnpm build` + local migrate; after T-G3-3, a manual end-to-end pass on staging (deploy via
existing docker-compose.staging) is the wave exit [HYBRID].

---

## HOLD — user gates (NOT tickets; decisions for Ramon/team)

These require product/GDPR decisions before any ticket is written. Do NOT implement.

- **U-1 / G-A — material-change re-approval rule.** Needs product definition of "material"
  (category? type? contact? photos? description length delta?). Decisions doc §2 says
  re-review is reserved for substance-altering changes; the field list is undefined. Present
  options at the next meeting; then a ticket forces `active → pending` on those fields only.
- **U-2 / G-D — "deleta tudo" vs GDPR retention.** Handwritten decision says account
  deletion deletes posts; current `AccountDeletionService` anonymizes and posts survive
  (deliberate GDPR soft-delete, conversations retained for authority requests D1). Trade-off
  (community listings vanish vs archival obligations) needs explicit team confirmation —
  decisions doc itself flags "confirm before implementing".
- **U-3 / G-H — user block/suspension.** No mechanism exists; decisions §8 links blocks to
  serious-case removals; QA item 29 deferred it. Recommend post-MVP (doc's own recommendation).
- **U-4 / G-K — photos scope clarification.** Resolved-by-recon: photos ARE implemented
  (`extraAttributes.photos` + `/api/uploads`, ≤4, JPEG/PNG/WebP, 5 MB — `src/lib/post-photos.ts`,
  `src/app/api/uploads/route.ts:35-40`). The QA "no Photo model" gap was a modeling-perception
  issue, not missing functionality. Remaining decision for Ramon: whether photos deserve a
  first-class `Photo` model (validation, moderation, orphan cleanup) or stay in
  extraAttributes for MVP. No ticket until decided; if kept as-is, add one doc note to
  `docs/ARCHITECTURE.md` (fold into U-4 answer).
- **U-5 — vestigial `contactMethod/contactValue`.** With chat confirmed as the contact flow,
  decide: keep encrypted contact for audit/history vs remove from new-post forms. Affects
  forms, schema, crypto layer. Needs Ramon's call; small ticket once decided.
- **U-6 — moderator alert on new pending post.** No handwritten answer (decisions §17);
  optional `Notification` to moderators on `createPost`. Cheap ticket if wanted; needs a yes.
- **U-7 / FR16 — missing `remove` moderation flow (NEW, rev 2).** FR16 promises
  "approve, reject, or remove", but only approve/reject exist: `ModerationActionType.remove`
  is a dead enum value (`schema.prisma:74`), there is no `removePost` service method, no
  action, no UI, no delete call. Decisions §1.5 ("remove is a hard delete — matches") is
  wrong about the code (divergence note 3). Decisions needed from Ramon: (a) is remove a
  hard delete vs status change; (b) who may remove (moderator-any-post? admin-only?);
  (c) what happens to the author's data / notifications / interested users (interacts with
  the U-2 GDPR question); (d) does it get the author ≠ moderator conflict-of-interest guard
  from T-G1-2. Until decided, the enum value stays dead — no ticket.

## Hard constraints (all waves)

1. **Port-driven services:** every new behavior lives behind a service method + port
   interface; Prisma only in `src/server/repositories/prisma-*.ts` (AGENTS.md). In-memory
   fakes for unit tests; no live-DB unit tests.
2. **Co-located vitest tests**, one fake per port, following `post-service.test.ts` patterns
   (`repo.seed`, `makePost`).
3. **i18n:** new user-facing strings ONLY in `messages/{en,pt-PT,pt-BR}.json`, key parity
   across the 3 files, never code-side strings. UI copy PT-first sensibility (pt-PT primary
   locale, `User.uiLocale` default `pt-PT`).
4. **Migrations:** schema.prisma is truth for columns Prisma understands; generated columns /
   trigram / unaccent stay raw SQL with the drop-recreate pattern of `20260718181500`;
   enum-add follows `20260816000002`. There is NO CI DB today — and **`prisma migrate dev`
   is broken on this repo** (AGENTS.md:110: the historical `20260718192700` migration has
   bare `CREATE INDEX` statements that collide on shadow-DB replay). Every migration ticket
   verifies via the sanctioned workaround instead: `pnpm prisma db execute --file
   <migration.sql> --schema prisma/schema.prisma` then `pnpm prisma migrate resolve
   --applied <migration_name>`, with both outputs in the PR as evidence. (Fixing the
   historical migration to restore `migrate dev` is out of scope for this plan; flag it as
   a candidate follow-up ticket.)
5. **Audit log on every new state transition** (`post.renew`, `post.expire`) — repo law.
6. **RBAC defense-in-depth:** new actions (renew) check actor at service level; UI hides
   button for non-authors; page/action guards unchanged pattern.
7. **No secrets / PII in logs**; contact values remain encrypted-at-repo-boundary.
8. **Conventional commits** (examples per ticket); one ticket = one PR = one commit message.
9. **Server Actions import services from `@/server/service-instances`** — never construct
   services in actions/pages.
10. **`pnpm test`, `pnpm lint`, `pnpm build` green on every PR.**

## Done-when (milestone exit)

- All 11 tickets merged (4 + 4 + 3), each with green CI, migration evidence where applicable.
- `pnpm test` suite covers: self-moderation guard, full visibility matrix, username
  validation/uniqueness, email-verification gating (post+interest), expiry lifecycle
  (approve/renew/reopen/sweep/reminder-dedupe), pagination/ordering via updated fakes.
- Manual verification on local (or staging) DB: accent search finds `água`↔`agua`;
  page size 10 numbered pagination; approval-date on cards; signup→verify→publish flow;
  unverified user blocked from publish+interest; username uniqueness case-insensitive;
  my-posts renew button extends expiry; expired post auto-closes via worker sweep.
- HOLD list (U-1..U-7) presented to Ramon with options; outcomes recorded as new tickets or
  explicit wont-do.
- No HOLD item implemented without a decision.

## First 3 executor tasks (start the moment review passes)

1. **T-G1-1** (G-B FR15 docs) — smallest, zero risk, unblocks nothing but builds momentum.
2. **T-G1-2** (G-C guard + tests) — the only Wave-1 code change; independent of all others.
3. **T-G1-4** (G-L terminology ×3 locales) — parallel with the above; the longest Wave-1 ticket.

(T-G1-3 G-F doc-note can slot anywhere in Wave 1.)
