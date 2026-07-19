# MVP QA Checklist — Manual end-to-end test

> **Audience:** anyone (Ramon, Rafaela, a community volunteer) willing to click through the app before the Casa da Cidade beta.
> **Time:** ~45–60 minutes for the full walkthrough.
> **What "MVP-ready" means here:** every MVP.md FR (FR01–FR14) works, every blocker from the most recent code-review pass is fixed, and the seeded fixtures below let you exercise each one without re-running any setup.
>
> **If you find something broken:** file an issue with the exact scenario #, expected vs actual behavior, the account you were signed in as, and a screenshot if visual.

---

## 0. Pre-flight (one-time setup, ~10 min)

### 0.1. Database & fixtures

```bash
docker compose up -d db
pnpm exec prisma migrate deploy          # apply all pending migrations
pnpm exec prisma db seed                 # idempotent — safe to re-run
```

Expected: `pnpm exec prisma db seed` ends with a "done. Try signing in with:" banner listing five accounts. Confirm with:

```bash
docker exec precisase-db-1 psql -U precisase -d precisase \
  -c "SELECT (SELECT count(*) FROM users)    AS users,
             (SELECT count(*) FROM posts)    AS posts,
             (SELECT count(*) FROM interests) AS interests;"
```

Expected row: `users=5, posts=8, interests=3`.

### 0.2. App

```bash
pnpm dev            # Next.js dev server on http://localhost:3000
```

In a separate terminal, start the notification worker so FR11 (closure notifications) can actually dispatch:

```bash
pnpm worker         # polls every 10s
```

Expected: `[notification-worker] starting (poll interval: 10000ms, …)` followed by a `processed N notification(s)` line within ~10s if any are queued.

### 0.3. The five test accounts (every password is `password123`)

| Account | Role | UI locale | Country | Notes |
|---|---|---|---|---|
| `ana.silva@example.com` | user | pt-PT | PT | Owns 2 posts (1 pending, 1 active with 1 interest from João) |
| `joao.santos@example.com` | user | pt-PT | PT | Owns 2 posts (1 active offer, 1 closed); expressed interest in Ana's sofa post |
| `maria.costa@example.com` | user | pt-BR | BR | Owns 2 posts in BR; the donation posts are her |
| `carlos.moderator@example.com` | moderator | pt-PT | PT | Sees the moderation queue; can approve/reject/close any post |
| `priya.en@example.com` | user | en | US | Owns 1 active + 1 rejected post in EN |

> **All five accounts use the same password: `password123`.** This is dev-only seed data; production will require email verification (not in MVP).

---

## 1. Internationalization (the language switcher)

The whole point of the most recent change is that the URL no longer carries the locale — switching happens via the header dropdown.

### 1.1. The switcher itself

| Step | Action | Expected |
|---|---|---|
| 1 | Open `/` (anonymous) | Browser URL stays `/` — no `/pt-PT/` prefix. |
| 2 | Look at the header | A `<select>` element appears with three options: `Português (PT)`, `Português (BR)`, `English`. |
| 3 | Select `English` | URL stays `/`. The page content (heading, subtitle, button labels) switches to English **without a full page reload**. |
| 4 | Select `Português (BR)` | Content switches to BR-Portuguese. |
| 5 | Select `Português (PT)` | Content switches to PT-Portuguese. |
| 6 | Open browser devtools → Application → Cookies | You see a `NEXT_LOCALE` cookie whose value matches your last selection. |

✅ Pass when: URL never changes; UI text follows the selection; cookie persists.
❌ Report if: URL gets a prefix; UI doesn't update; cookie is missing.

### 1.2. Locale-aware dates

| Step | Action | Expected |
|---|---|---|
| 1 | As Ana, open `/my-posts` | The "Publicado em" line on each post shows a calendar date. |
| 2 | Open the same page in a different browser tab after switching the language to BR | The same date renders in BR conventions (e.g. `15/03/2026`). |
| 3 | Switch back to pt-PT | Date renders as `15/03/2026`. |

✅ Pass when: format follows the URL locale's default region.
❌ Report if: date doesn't change between locales; date renders as `03/15/2026` (American) when in pt-PT.

### 1.3. URL-prefixed bookmarks still work

| Step | Action | Expected |
|---|---|---|
| 1 | Manually type `/pt-PT/posts/[id]` in the URL bar (using any post UUID from `docker exec precisase-db-1 psql -U precisase -d precisase -c "SELECT id FROM posts;"`) | Middleware strips the prefix and renders the page in your current locale (NOT in pt-PT). |

✅ Pass when: the legacy URL works and renders in your selected locale.
❌ Report if: 404 on prefixed URLs.

---

## 2. Sign up

| Step | Action | Expected |
|---|---|---|
| 1 | Click "Entrar" / "Sign in" → "Criar conta" / "Create account" | Sign-up form appears. |
| 2 | Leave all fields blank, click submit | Error: name required (catalog message). |
| 3 | Type a name, type mismatched passwords, submit | Error: passwords don't match. |
| 4 | Type matching passwords, uncheck consent, submit | Error: consent required. |
| 5 | Type matching passwords + consent, submit | Redirects to `/signin`. |
| 6 | Sign in with the new credentials | Lands on `/`; header shows your initials in the user-avatar spot. |

✅ Pass when: all four error states show distinct messages and the happy path lands at `/signin`.
❌ Report if: any error message is missing, doesn't translate, or the signin page is wrong.

> **Note:** emails are NOT sent for signup. There's no email verification flow (out of MVP scope). The ConsoleMailer writes to `.dev-outbox/emails.jsonl` — check there if a flow expects email and you see nothing.

---

## 3. The shop window (anonymous browsing)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign out (top-right avatar / Sign in link). | URL stays `/`. |
| 2 | Browse `/` (anonymous) | You see 4–6 active posts in the grid: Ana's sofa request, João's English-classes offer, Maria's baby-clothes donation, Maria's diapers request, Priya's Spanish-partner request. |
| 3 | Click the category filter "Voluntariado" / "Volunteering" | Only volunteer posts show. |
| 4 | Click "Doação" / "Donation" | Only donation posts show. |
| 5 | Type `sofá` in the search box, submit | Ana's sofa post is the only result. |
| 6 | Type `xyz123`, submit | "No results" empty state. |
| 7 | Click "Ver mais" / "Load more" if visible | Page 2 loads (if any); URL stays `/` with `?after=…`. |

✅ Pass when: filter, search, pagination all work; results count is accurate; empty state is shown when no match.
❌ Report if: filters don't filter; search returns nothing for "sofá" or returns too much; "Load more" doesn't change anything.

---

## 4. View a post (the contact panel)

### 4.1. Anonymous → can't see contact info until interested

| Step | Action | Expected |
|---|---|---|
| 1 | Open any active post as anonymous | Page renders fully — title, description, category, author name. **No contact panel** (no email/phone/WhatsApp). |
| 2 | Look for a "Manifestar interesse" / "Express interest" button | Button visible. |
| 3 | Click it | Redirects to `/signin` (must be authenticated to express interest). |

### 4.2. After expressing interest (do this in step 8 below, then return here)

| Step | Action | Expected |
|---|---|---|
| 1 | Return to the post detail page | The contact panel appears: contact method + value (e.g. `912 345 678`) and a WhatsApp link. |
| 2 | Click the WhatsApp link | WhatsApp opens with the right number — NOT Nigeria (the bug that was fixed). |

✅ Pass when: contact panel only shows after interest is recorded; WhatsApp link opens with the correct country code.

---

## 5. Post creation (FR01)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Ana | Header shows "A" avatar. |
| 2 | Click "Publicar" / "Post" | Create-post form renders. |
| 3 | Type a title, description, leave type=categories filled | All fields work. |
| 4 | Click "Submit" with consent checked | Toast: "Post submitted for approval." Redirects to `/my-posts`. |
| 5 | Open `/my-posts` | Your new post is there with status `pending`. |
| 6 | Try the same flow with a phone contact method (set contact method to `phone` or `whatsapp`) | Same flow. |

### 5.1. Phone validation edge cases

| Step | Action | Expected |
|---|---|---|
| 1 | Set country select to `Portugal (+351)`, type `123` (3 digits) | Error: phone too short. |
| 2 | Type `912 345 678` (9 digits, domestic format) | OK — stored as `+351912345678`. |
| 3 | Set country to `Brasil (+55)`, type `91234-5678` (8 digits, BR landline) | OK — stored as `+55912345678`. |
| 4 | Type `xyz` | Error: not a number. |

> ✅ Pass when: every domestic-format input is normalized to the right country code, and bad inputs show specific error messages.

---

## 6. Moderation (FR15)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Carlos (moderator) | Header shows "Moderação" / "Moderation" link. |
| 2 | Click Moderation | Queue shows only Ana's pending post. Rejected posts are NOT in the queue (they appear in the author's `/my-posts` view instead). |
| 3 | Click "Approve" on Ana's pending post | Toast: success. Post disappears from queue. |
| 4 | Sign out, sign in as Ana | `/my-posts` shows the previously-pending post as `active` now. |
| 5 | Sign in as Ana, create another post (now Ana has 2 pending); sign back in as Carlos | Reject the new one with a reason like "Título não é descritivo". |
| 6 | Sign in as Ana | The rejected post shows up with the rejection reason banner. |

> **Note about the queue:** The moderation queue currently shows `pending` posts. Rejected posts are NOT in the queue (they're in the author's `/my-posts` view instead). This is intentional (ARCHITECTURE.md §5.3).
> ✅ Pass when: approve/reject both work; rejected posts appear in the author's view with the reason.

---

## 7. Edit an active post (FR03 — the flow you couldn't do before)

This is the **biggest gap closed in the latest patch**. It was previously missing entirely.

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Ana | Open `/my-posts`. |
| 2 | Find Ana's active "Procuro alguém para ajudar a mudar um sofá" post | It should now show an **"Editar"** / "Edit" button next to the existing "Ver" / "View" link. (Before the patch, this button didn't exist.) |
| 3 | Click "Editar" | Form opens: title, description, contact method, contact value (NO type/category segments — those are not editable on an active post). |
| 4 | Change the title, click "Guardar alterações" / "Save changes" | Toast: "Post atualizado." Redirects to `/my-posts`. |
| 5 | Open the same post in the shop window | The new title appears. |

✅ Pass when: the Edit button is there, form lacks type/category, save succeeds, title updates.
❌ Report if: no Edit button on active posts; form shows type/category toggles; save fails or doesn't update the title.

---

## 8. Express interest (FR09) + the FR11 closure notification flow

### 8.1. Express interest

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as João. Open Maria's "Doação de roupas de bebê" post (he's not the author, so the button is visible). | The "Manifestar interesse" / "Express interest" button is visible. |
| 2 | Click it | Toast: "Interesse registado." The button is replaced by the contact panel. |
| 3 | Refresh the page | The contact panel stays visible (interest persists). |
| 4 | Click the WhatsApp link on Maria's contact panel | Opens WhatsApp with `+5511912345678` (Brazil — the bug-fixed code path, not Nigeria). |

### 8.2. FR11 — closing a post should notify interested users

| Step | Action | Expected |
|---|---|---|
| 1 | As João, in a separate browser tab keep Maria's clothing-donation post open (you now expressed interest in 8.1, and Ana is also interested from the seed). | Tab state. |
| 2 | Sign out, sign in as Maria (the author of that post). Open `/my-posts`, find the clothing-donation post (status `active`). | The post is in her list. |
| 3 | Click "Marcar como resolvido" / "Mark as resolved" | Toast: success. Post status flips to `closed`. |
| 4 | Tail the worker output (the terminal where you ran `pnpm worker`). | Within ~10s you see a line like `processed 2 notification(s) — sent: 2, retrying: 0, failed: 0` (deduplicated: Ana + João = 2 distinct users; not 3+). |
| 5 | Open `.dev-outbox/emails.jsonl`. | Two JSON lines for `post_closed`: one to João, one to Ana. Subject keys (`messages/<locale>.json → email.post_closed.*`) match the recipient's UI locale (pt-PT for both). |

✅ Pass when: closing a post queues one notification per interested user (deduplicated), and the worker dispatches them within ~10s.
❌ Report if: no notification is queued; worker says 0 processed; emails are missing from the outbox.

---

## 9. Resubmit a rejected post

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Priya | `/my-posts` shows Priya's rejected "Free laptop" post. |
| 2 | Click "Editar e reenviar" / "Edit and resubmit" | Form opens with type/category/title/description/contact (this is the original "Resubmit" flow). |
| 3 | Edit the description, click "Reenviar para aprovação" / "Resubmit" | Toast: success. Post status flips to `pending`. |
| 4 | Sign out, sign in as Carlos | The resubmitted post appears in the moderation queue. |

✅ Pass when: resubmit flow works and the rejected → pending transition is reflected.
❌ Report if: resubmit does nothing or leaves status as `rejected`.

---

## 10. Reopen a closed post (FR05)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as João | `/my-posts` shows his closed "Pintura grátis para um quarto (encerrado)" post. |
| 2 | Click "Reabrir" / "Reopen" | Toast: success. Status flips to `active`. |

✅ Pass when: closed → active transition works.

---

## 11. Profile editing (FR13)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Ana | Click the avatar in the header → `/profile`. |
| 2 | Form shows: email (read-only), role (read-only), locale (read-only), displayName, phone (with country select), church affiliation | All four read-only fields are correctly populated from the seed. |
| 3 | Click the phone country dropdown | Five options: PT/BR/US/GB/ES. Default `PT`. |
| 4 | Change the phone to an invalid number, save | Error: "Introduz um número de telefone válido para o país selecionado." (or English equivalent). |
| 5 | Set phone to a valid PT number like `912 345 678`, save | Success. Reload — the phone field shows the canonical form. |

✅ Pass when: read-only fields are read-only, invalid phones are rejected, valid phones normalize.
❌ Report if: read-only fields are editable; invalid phones are accepted; valid phones aren't normalized.

---

## 12. Time zone display

| Step | Action | Expected |
|---|---|---|
| 1 | Open any post as Ana | The "Publicado em" line shows a calendar date in your locale format (e.g. `15/03/2026` for pt-PT). |
| 2 | Cross-check: the date should match the post's `createdAt` in your browser's TZ | For Lisbon (Europe/Lisbon), a post created at 23:30 UTC on March 15 should show `15/03/2026`. For São Paulo (UTC-3), the same post should also show `15/03/2026` (since 23:30 UTC = 20:30 in São Paulo). |
| 3 | For a post created at 02:00 UTC, verify the date rolls over correctly per TZ | pt-PT (Lisbon, UTC+0 in winter / UTC+1 in summer): at 02:00 UTC = 02:00 local → same day. For Asia/Tokyo (UTC+9): at 02:00 UTC = 11:00 local → same day. |

> The platform ships `Europe/Lisbon` / `America/Sao_Paulo` / `America/New_York` as the time-zone defaults for pt-PT / pt-BR / en URL locales. Authenticated users can change their TZ via the profile page (but that feature isn't wired up yet — see "Known limitations" below).

✅ Pass when: dates are stable for any given UTC instant within the same calendar day across pt-PT / pt-BR / en visitors.
❌ Report if: the same post shows different dates within the same calendar day across the locales.

---

## 13. Account deletion (NFR08 / GDPR)

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as Priya | Profile → bottom: "Eliminar a minha conta" / "Delete my account" section. |
| 2 | Click "Eliminar conta" / "Delete account" | Confirmation prompt appears. |
| 3 | Type your password, confirm | Toast: success. You're redirected to `/` and signed out. |
| 4 | Try to sign in again as Priya | "Invalid credentials" or similar (account soft-deleted). |
| 5 | Verify in the DB | `docker exec precisase-db-1 psql -U precisase -d precisase -c "SELECT email, \"displayName\", \"deletedAt\" FROM users WHERE email = 'priya.en@example.com';"` shows the user with `displayName = 'Utilizador removido'`, `deletedAt` set. |

✅ Pass when: account is soft-deleted; sign-in is blocked; PII is anonymized; original email is replaced (`deleted-priya.en@example.com@precisase.invalid`).
❌ Report if: account can still sign in; PII is intact; sign-in redirects you somewhere broken.

---

## 14. Cleanup & re-seed

When the walkthrough is done:

```bash
# Wipe the dev DB and re-seed for the next tester.
docker exec precisase-db-1 psql -U precisase -d precisase -c "TRUNCATE users, posts, interests, notifications, audit_logs, consent_records, moderation_actions RESTART IDENTITY CASCADE;"
pnpm exec prisma db seed
```

This is idempotent — the seed itself skips existing records — so `prisma db seed` alone is enough most of the time; the `TRUNCATE` is just to start from a clean slate.

---

## 15. Sign-off

When you're done, file an issue (or a brief Loom-style summary) with:

- ✅ / ❌ for each scenario
- The account(s) you used for each step
- Screenshots of anything that looks visually off
- Browser + OS (Chrome on Mac, Firefox on Linux, etc.) — there are known CSS grid quirks that vary
- Any console errors from devtools (Cmd+Opt+J → Console tab)

A scenario counts as **passed** when the "Expected" column matches what you saw, in your chosen locale, across at least 2 of the 3 supported locales.

---

## Known limitations / out-of-scope for MVP

These are known gaps that should NOT block sign-off. If you find them confusing, mention them but don't treat them as bugs:

1. **Time-zone edit widget** — the user can have a TZ recorded (set at signup from the browser), but there's no profile UI to change it. Pick a different `country` setting in the profile form (eventually — currently the profile form doesn't expose country either).
2. **Edit-active-post type/category change** — `PostService.editActivePost` deliberately doesn't allow changing `type` or `category` while a post is active (could be confusing for browsers looking at the page mid-edit). The form correctly omits those fields.
3. **Email verification** — none. Anyone can sign up with any email.
4. **No "forgot password"** — out of MVP scope.
5. **Email delivery is dev-mode** — `ConsoleMailer` writes to `.dev-outbox/emails.jsonl`, not real inboxes. The notification worker IS real, but the mailer is stubbed.
6. **C6 (atomicity of state transitions)** — if the process dies mid-state-change, the audit log could be inconsistent with the post state. Real but rare.
7. **C7 (expressInterest TOCTOU)** — concurrent interest clicks from the same user may produce a "duplicate" error in the edge case, instead of being idempotent.

These are tracked in the existing code-review artifacts and are not MVP blockers.

---

## Quick reference: routes

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Shop window listing |
| `/posts/[id]` | public read; contact panel gated on interest | Post detail |
| `/posts/new` | auth | Create-post form |
| `/my-posts` | auth | Author's posts (any status) |
| `/my-posts/[id]/edit` | auth | Edit active post (NEW) or resubmit rejected (existing) |
| `/profile` | auth | Profile edit |
| `/signin`, `/signup` | public | Auth |
| `/moderation` | moderator | Pending queue |
| `/privacy` | public | Privacy policy |
