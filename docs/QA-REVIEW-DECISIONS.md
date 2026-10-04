# QA Review Decisions — MVP "Casa da Cidade"

> **Source:** `Questionamentos_QA_MVP_Casa_da_Cidade.pdf` (7 pages, 33 topics), reviewed in ink during the requirements meeting — handwritten answers, checkmarks and strikethroughs are decisions, not suggestions. This document consolidates every decision and maps it against the current codebase (`~/dev/precisase`, commit `6f46568`).
>
> **How to read:** Handwritten-strikethrough on a printed question = "dismissed/answered". A "✓" = confirmed. An arrow note = the decided answer. Where a meeting decision diverges from implemented behavior, it is listed under **Gaps** with a proposed ticket.
>
> **Key scope decision:** the internal chat is CONFIRMED for the MVP ("Vai ser sempre pelo chat") and REPLACES the off-platform contact flow: interest → author notified → conversation happens in the platform's Messages area. The QA doc's own recommendation applies: chat deserves a separate refinement pass.

## 1. Publication lifecycle

| # | Question (summary) | Decision (handwritten) | Status in code |
|---|---|---|---|
| 1.1 | Initial state? | **Pendente** | ✅ `PostStatus.pending` is the schema default (BR01) |
| 1.2 | Editing allowed only while active? | ✓ (confirmed as printed) | ✅ `updatePost` guards on status |
| 1.3 | While pending: edit / cancel / delete? | ✓ (confirmed as printed) | ✅ Author edit + cancel/delete available; deletion final |
| 1.4 | What happens after rejection? | **Motivo, na plataforma** (reason shown on-platform) | ✅ `rejectedReason` persisted, `post_rejected` notification with reason |
| 1.5 | What does "remove" mean (no such state)? | **Excluir** (delete) | ✅ `ModerationActionType.remove` is a hard delete, distinct from `reject` — matches |
| 1.6 | Delete definitively or just close? | "2" (marginal note; treat as: both paths exist — close AND delete) | ✅ Close (FR04) and author delete both exist |
| 1.7 | Which transitions, who executes? | ✓ (state machine as printed) | ✅ §5.3 state machine enforced in `post-service.ts` |

## 2. Editing an approved publication

Decision: the section's bullets were struck through — editing an approved post does **not** trigger re-approval when the content is unchanged/equivalent (same rule recorded for reopening, see §7). Moderation re-review is reserved for changes that alter the substance.

- **Gap G-A (partial):** there is no diff/"what changed" view for moderators, and no explicit "material change → re-approval" rule in code. Current behavior: active post edits stay active, always.
- Suggested ticket: define which field changes are "material" (category, type, contact, photos) and force `active → pending` on those only.

## 3. Approval rule (RF15 × RN01 inconsistency)

Decision: **every** publication goes through moderation in the MVP — no exceptions, no trusted-user bypass. First bullet ✓; the "exceptions" bullets were struck out.

- **Gap G-B:** `docs/MVP.md` FR15 still reads "posts from users without prior trusted history require moderator approval", contradicting BR01. Uniformize FR15 wording to match BR01 (universal approval).
- Code is already correct (BR01 enforced; `pending` default regardless of caller).

## 4. Profiles & permissions

Decision: roles are Utilizador / Moderador / Administrador; a moderator/admin **cannot** approve or reject their own publication ("Não pode").

- **Gap G-C:** `approvePostTx` / `rejectPostTx` check `isModerator()` only — there is **no author ≠ moderator guard**. Add the check in the service layer (with test).

## 5. Account deletion / anonymization

Decision: **"Deleta tudo"** — deleting the account deletes the publications too. Not anonymization-with-surviving-posts.

- **Gap G-D (needs confirmation):** `AccountDeletionService` currently redacts the account in place and the posts survive (GDPR soft-delete pattern). Diverges from the handwritten decision.
- ⚠️ Confirm with the team before implementing: hard-deleting active posts removes listings other community members may be relying on, and archived conversations are retained for potential authority requests (D1). If confirmed, expand `AccountDeletionService` to delete the user's posts (interests cascade via posts; conversations tied to interests need explicit handling).

## 6. Validity / expiration

Decision: publications are valid for **60 days, renewable**; author receives a **reminder** (notification); if unattended → **deactivation** (post leaves the active listing).

- **Gap G-E:** no `expiresAt`/renewal concept in the schema; no reminder notification type. Suggested ticket:
  1. `Post.expiresAt timestamptz` (set to `+60d` on approval, refreshed on renewal)
  2. Renewal action (author-only) resetting `expiresAt`
  3. Reminder notification ~7 days before expiry (reuse the notification worker's poll)
  4. Expiry sweep: `active` posts past `expiresAt` → `closed` (deactivated), with the existing `post_closed` notification

## 7. Reopening

Decisions: reopening returns the post to active **without re-moderation if the content is unchanged**; ordering uses the **original date** ("com a primeira"); interests from the previous cycle are kept.

- ✅ Mostly aligned: `reopenPost` goes `closed → active` directly.
- **Gap G-F:** `reopenPost` should skip re-approval only when content is unchanged — but since editing an approved post never resets to pending (current behavior), reopening is already moderation-free. Aligns by default; document it.
- Ordering "original date": once G-G (approval-date ordering) lands, a reopened post keeps its original `publishedAt` — no extra work.

## 8. Rejection vs removal

Decisions: the moderator can **reject** (post returns to the author for editing → `rejected → pending` resubmission) or **exclude** (final); exclusion implies **user block by moderation** in serious cases.

- ✅ Reject-with-reason + edit-and-resubmit flow exists (`my-posts/[id]/edit` — "FR03, rejected -> pending").
- **Gap G-H:** no user block/suspension mechanism exists (QA item 29 deferred this too). If "removal implies author block" is intended as MVP, it needs a `User.blockedAt` + auth check + moderation UI. Recommend: defer to post-MVP, keep `remove` as post-only action for MVP.

## 9. Chat / Messages — scope CONFIRMED

Decision: **"Vai ser sempre pelo chat"** — all contact between author and interested user happens in the internal chat. The off-platform contact flow (reveal phone/WhatsApp, item 14 "→ Chat", item 15 struck out entirely) is replaced.

- ✅ Largely built: `Conversation`/`Message` models, Messages area, auto-conversation on interest, archive-on-close, first-unread notification (anti-spam), moderator read access behind `chat.moderator_read_access` feature flag.
- Follow-up (per the QA doc itself): run a **separate refinement pass on chat** (unread state, archiving UX, moderation reads, notification cadence) before beta.

## 10. Authentication & account

Decisions: email+password (social login struck out); **email verification required** ("Enquanto não validar, não publica"); password recovery via email; **2FA noted** (arrow on the heading).

- ✅ Email+password auth, password-reset-by-email flow, and opt-in TOTP 2FA (`mfaSecret`, `mfa-service.ts`) already exist.
- **Gap G-I:** no email-verification gate — signup is immediately functional. Suggested ticket: `User.emailVerifiedAt` + verification email + block `createPost` (and interest?) until verified. Decide the exact blocked-action set with the team.

## 11. Signup & profile

Decisions: required fields = **name + email + password + username**; everything editable later (email changes re-verified); unique identifier = **username** (the printed "telefone" struck out); **no minimum age**; **no church-affiliation link** in the MVP.

- **Gap G-J:** no `username` column; `displayName` is not unique. Suggested ticket: `User.username` (citext, unique, reserved-word filter) + signup form field + shown on posts instead of display name.

## 12. Publication fields & rules

Decision: **"A definir"** (to be defined) for required/optional fields, length limits, and photo rules — explicitly deferred by the reviewer. The QA doc records the semi-ready platform's behavior (up to 4 photos, JPEG/PNG/WebP, ≤5 MB each) as documentation, not as a decision.

- **Gap G-K (needs investigation):** the Prisma schema has **no Photo model** — the platform the QA tested accepted photos, this repo apparently does not implement them. Clarify which build the QA ran and whether photos are MVP scope before designing fields/limits.
- Type/category mutable after creation: undecided (left "a definir").

## 13. Terminology

Decision: unify **necessidade = oferta** terminology across document, interface and model.

- **Gap G-L:** audit user-facing strings and docs; the data model already uses a neutral `PostType.request/offer`. One-time copy pass in the three locales (pt-PT, pt-BR, en).

## 14–15. Contact method & contact-in-free-text

Decisions: contact is the **chat** ("→ Chat"); item 15 (blocking phone/email typed into title/description) struck out entirely — not an MVP rule.

- ✅ No contact-scrubbing validation exists (matches the strikethrough).
- Note: `Post.contactMethod/contactValue` (encrypted) still exists in the schema. With chat confirmed, decide whether it becomes vestigial (keep for audit/history) or is removed from new-post forms.

## 16. Interest

Decision: "Por enquanto fica tudo no site" — everything stays on-site for now. The printed flow (interest → author notified → contact revealed) is superseded by chat: interest → author notified → conversation opens.

- ✅ Aligned: interest creates the conversation automatically; one interest per user per post (`@@unique([postId, userId])`).
- Author self-interest: printed question, no handwritten answer — default answer (block author self-interest) is implemented (`interest-service` rejects it). Keep.

## 17. Notifications

Decision: **"Sempre no site por enquanto"** — in-app only for the MVP; no email channel yet.

- ⚠️ Divergence (flag, don't rip out): email sending via Resend is already implemented (bounced/complained handling, worker). The decision says in-app-first for now. Recommend: keep the worker, default notifications to `in_app`, treat email as an opt-in/admin channel — confirm with the team.
- Moderator alert on new pending post: no handwritten answer; currently no alert exists (moderators poll the panel). Optional ticket.

## 18. History & visibility by state

Decision: a finished publication is visible **only to its author** ("Uma publicação finalizada só quem vê é quem publicou").

- **Gap G-M:** closed posts are currently listable/accessible beyond the author (my-posts shows them; check public detail-route access for closed posts and lock it to the author). Implement: closed posts return 404 for non-authors on public routes.
- Pending posts by direct URL: visible to author + moderators only (current behavior — verify with a test).

## 18/19. Search

Decision: **"água → agua → Deve encontrar"** — search must be accent-insensitive. Partial matching already works (pg_trgm).

- **Gap G-N:** no `unaccent` anywhere. Suggested ticket: add the `unaccent` Postgres extension, rebuild `search_vector` as `to_tsvector(locale, unaccent(title || ' ' || description))`, normalize the query with `unaccent()` too, and keep the trigram index for partial matches. Remember: generated column + GIN index are raw SQL in the migration.

## 20. Shop window, filters & ordering

Decisions: order by **approval date** (underlined twice); the date shown on the card is the **approval date**; pagination (underlined) with page size **10** ("carregar mais" struck out).

- **Gap G-O:** listing orders by `createdAt desc` today; `publishedAt` is written but never used for ordering. Switch `listActive` ordering to `publishedAt desc` (fallback `createdAt` for legacy rows), display `publishedAt` on cards, change page size 24 → 10 and switch from cursor "load more" to numbered pagination (or keep cursor and just change the size — decide UX).
- Filter persistence on back-navigation: no handwritten answer; keep current behavior, note as open.

## 21. Location

Decision: stays free text in the description for the MVP; **"filtro a definir"** (location filter to be defined later). No structured field now.

- ✅ Aligned (no location field exists). Nothing to do.

## 22. Subcategories

Decision: **NÃO** — no subcategories in the MVP.

- ✅ Aligned (flat `Category`).

## 23. Draft & form abandonment

Decisions: **no draft concept**; leaving the form = data kept? — strikethrough on "são perdidos" leaves "ou guardados" ambiguous, but the ✓ on the unsaved-changes warning bullet confirms: **warn on unsaved changes**.

- **Gap G-P:** add a dirty-form warning (`beforeunload` + in-app navigation guard) on the new/edit post forms. No draft persistence.

## 24. Withdrawal of contact-sharing permission

Decision: section struck out entirely (X over the whole block) — moot in the chat model; interest cannot be "un-shared", the conversation is the record.

- ✅ Nothing to do. (If a "withdraw interest" action is ever requested, treat as new scope.)

## 25. Terms & Privacy updates

Decision: "ACDC" (marginal note — likely an internal reference, not a product decision; treat as open). No implementation implication for the MVP beyond the existing `ConsentRecord` versioning, which already supports re-acceptance flows.

## 26–33. Low priority / scope validation

| # | Topic | Decision | Status |
|---|---|---|---|
| 26 | Favorites/saved posts | No handwritten answer | Open — recommend out of MVP |
| 27 | Duplicate-post rules | No answer | Open — recommend out of MVP |
| 28 | Post limits per user | No answer | Open — recommend out of MVP |
| 29 | User block/suspension | No answer (see G-H) | Deferred; revisit if G-H confirms block-on-remove |
| 30 | Post reporting | No answer | Open — recommend out of MVP |
| 31 | Resolution-to-interested association | No answer (printed note: likely out of scope) | Out of MVP |
| 32 | Author name changes | No answer | Default: `displayName` denormalizes onto nothing — posts render live name; acceptable |
| 33 | Browser/device compatibility | No answer | Keep NFR01 (responsive desktop+mobile) |

Technical/security/audit section: deferred ("para depois") — retry on notification failure and admin-action audit already partially exist (`Notification.status/attempts`, `AuditLog` with actor + before/after). Revisit post-MVP.

## Consolidated gap list (ticket candidates)

| ID | Ticket | Effort | Confidence |
|---|---|---|---|
| G-A | Material-change re-approval rule for active-post edits | M | Medium — rule needs product definition first |
| G-B | Uniformize FR15 wording with BR01 in `docs/MVP.md` | S | High |
| G-C | Author-≠-moderator guard on approve/reject + tests | S | High |
| G-D | Account deletion deletes posts ("deleta tudo") | M | ⚠️ Needs team confirmation (GDPR/retention trade-off) |
| G-E | 60-day expiry + renewal + reminder + deactivation sweep | M | High |
| G-F | Document reopen-without-remoderation as intended behavior | S | High |
| G-G | (folded into G-O) ordering by approval date | — | — |
| G-H | User block on removal | M | ⚠️ Recommend defer; needs decision |
| G-I | Email verification gate ("no publish until verified") | M | High |
| G-J | Username as unique identifier + signup field | M | High |
| G-K | Photos: clarify QA-tested build vs repo (no Photo model) | S | ⚠️ Investigation first |
| G-L | Terminology pass (necessidade=oferta) across UI/docs | S | High |
| G-M | Closed posts visible to author only | S | High |
| G-N | Accent-insensitive search (unaccent) | S–M | High |
| G-O | Order + display by approval date; page size 10; numbered pagination | M | High |
| G-P | Unsaved-changes warning on post forms | S | High |

Suggested order: G-B, G-C, G-F, G-L (doc/copy, quick wins) → G-N, G-M, G-P, G-O (small code) → G-E, G-I, G-J (schema + flows) → G-A, G-D, G-H, G-K (need product decisions first).
