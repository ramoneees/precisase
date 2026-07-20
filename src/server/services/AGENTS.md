# AGENTS — `src/server/services/`

**Pure business logic. Port-driven. No Prisma imports here.** Unit-tested with in-memory fakes of each port.

## OVERVIEW

Each service file is the **single source of truth** for a domain concept. Services depend on a narrow `Repository` interface (in the same file) — never on Prisma. The Prisma-backed port implementations live in `../repositories/`.

## STRUCTURE

```
src/server/services/
├── post-service.ts            # Post state machine (FR01–FR05, FR08–FR11) — the central domain
├── interest-service.ts        # FR09 — express-interest flow + duplicate detection
├── notification-dispatch-service.ts  # Worker batch loop; per-row backoff
├── account-deletion-service.ts       # GDPR self-deletion (NFR08); PII anonymization
├── auth-service.ts            # verifyCredentials (argon2id) returns AuthenticatedUser
├── password-service.ts        # argon2id wrapper (hash/verify)
├── phone-service.ts           # libphonenumber-js E.164 normalization
└── *.test.ts                  # In-memory port fakes; no live DB needed
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Change post state machine | `post-service.ts` — methods `approvePost`/`rejectPost`/`closePost`/`reopenPost`/`resubmitPost`/`createPost`/`editActivePost` |
| Add a new state transition | Add the method to `PostService` + a new transition row in the state-machine doc comment at the top of the file. Mirror it in the `PostRepository` port only if a new DB query is needed. |
| Change a port's contract | Edit the `XxxRepository` interface in the same file as the service, then the Prisma impl in `../repositories/`. Tests catch the in-memory fake divergence. |
| Add a new error type | Add a `class XxxError extends Error { name = "XxxError" }` to the same file as the service that throws it. Export the class. Match the discriminated-union pattern (`result.ok ? ok : err` for multi-state errors). |
| Wire an event into the audit log | Find the state-transition method, add `await this.repo.addAuditLog(buildPostAuditEntry({...}))` immediately after the `repo.update()` call. |

## CONVENTIONS (specific to this dir)

- **One service per file.** No `index.ts` aggregator — callers import the named class directly.
- **Port interface lives in the same file as the service.** Example: `PostRepository` is declared in `post-service.ts`, implemented in `../repositories/prisma-post-repository.ts`. Keeping them in one file makes the port read like a header for the service.
- **Discriminated unions for cross-service errors.** `PhoneValidationResult = PhoneValidationOk | PhoneValidationError` (union). Avoid throwing bare `Error` — throw a named class so callers can `instanceof`-check.
- **State machine documentation at the top of `post-service.ts`.** ASCII diagram of the transitions; new transitions get a row in the diagram AND a method on the class.
- **Audit log on every state transition.** The `buildPostAuditEntry` helper in `post-service.ts` produces a uniform `AuditLogRecord`. All transitions route through it; raw `addAuditLog` calls are forbidden.
- **Domain types are local to the service file.** `PostRecord` in `post-service.ts`, `InterestRecord` in `interest-service.ts`. Do not import types across service files; ports are the public surface.

## ANTI-PATTERNS

- **Do not import from `@/generated/prisma/client` here.** Services are port-driven; only the repository implementations know about Prisma.
- **Do not call `parsePhoneNumberFromString("...", "PT")` directly.** Use `PhoneService.parse` so the country hint, dedup, and error code are consistent.
- **Do not put `contactValue` plaintext in logs.** PII; encrypted at the repository layer.
- **PostService state transitions are atomic.** Each transition method (`approvePost`/`rejectPost`/`closePost`/`reopenPost`/`resubmitPost`/`createPost`/`editActivePost`) wraps its full read+write sequence in `repo.withTransaction(fn)`; the Prisma-backed repo implements it via `prisma.$transaction`. C6 is closed. New transition methods must follow the same `withTransaction` shell + `*Tx` body pattern.

## UNIQUE STYLES

- **`PostSummary = Omit<PostRecord, "contactMethod" | "contactValue">`.** Used for list paths so the repository can ship a `select` projection that never decrypts the encrypted bytes. Don't add `contactMethod`/`contactValue` back to `PostSummary`.
- **`buildPostAuditEntry` helper** centralizes the `actorId`/`action`/`targetType: "Post"`/`targetId` shape. 7 call sites use it; if you're adding an 8th, the helper is the right entry point.
- **In-memory port fakes** live next to the tests (`post-service.test.ts` has `InMemoryPostRepository` at the top). Copy the existing fake's structure when adding a new one — the in-memory repo's behavior is part of the service's contract.

## NOTES

- The notification dispatch service is the **most test-covered** service (8 tests covering happy path, retries, max-attempts). If you're refactoring batch-dispatch logic, those tests are the safety net.
- The phone service has a known `libphonenumber-js` quirk in CJS contexts (tsx/seed) where the default export's metadata is undefined; the seed bypasses `PhoneService.parse` and stores E.164 directly. Don't reintroduce the bypass in app code.
