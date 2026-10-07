# MVP.md — "Precisa-se" (Casa da Cidade Community Platform)

> Machine-readable project brief. Written in English for LLM/agent consumption (coding assistants, planning tools). Source of truth for business context lives in `CLAUDE.md` (English, human-facing). Keep both in sync when scope changes.

**Provisional app name: "Precisa-se"** (not final — chosen for covering both requests and offers without sounding donation-only).

## 1. Project summary

Build a web application that matches "needs" with "offers" inside a church community (Casa da Cidade). It is not a job board or a donation site in isolation — it's a single matching mechanism covering volunteering, donation of goods/services, and (future phase) paid job opportunities. Tone: community/trust-based (church referral), not transactional marketplace.

Origin: an earlier volunteering platform (`voluntariado.casadacidade.com`) existed ~1–2 years ago, used to turn the church building into a Sunday coworking space and allocate volunteers to partner companies. It's being rebuilt from scratch — no existing codebase to reuse.

## 2. MVP scope

**In scope (MVP):**
- Volunteering (requests + offers)
- Donations of goods/services (requests + offers)

**Out of scope (future phases):**
- Paid job/recruitment matching (phase 2/3 — same data model, different form/category)
- WhatsApp bot as an entry interface
- Volunteer reputation/ranking system with auto-approval ("Golden Plus" trusted publishers)
- Unification with the church's existing app (family/children registration, etc.)

**Guiding constraint:** the platform must remain the central "shop window" of opportunities. A prior similar platform failed because a WhatsApp-based bot let people bypass the platform entirely, killing its use as the central listing. Any messaging integration must drive traffic back to the platform, not replace it.

## 3. Functional requirements (FR)

### 3.1 Posting needs and offers
- **FR01 — Create post**: Authenticated user creates a post with: type (need/offer), category (volunteering/donation), title, description, preferred contact method.
- **FR02 — Categorization**: Every post belongs to one category (volunteering or donation) and one type (request or offer), enabling filtering.
- **FR03 — Edit post**: Author can edit title, description, and contact info while the post is active.
- **FR04 — Close post**: Author can mark a post as "resolved/fulfilled," removing it from the active listing and signaling to interested parties that it's no longer needed.
- **FR05 — Reopen post**: Author can reopen a previously closed post. Reopening goes `closed → active` directly, with no re-moderation: editing an active post never resets it to pending (decided behavior — see `docs/QA-REVIEW-DECISIONS.md` §7), so the reopened post returns to the listing without moderator re-approval. The reopened post keeps its original `publishedAt` (ordering by original publication date — "com a primeira") and keeps the interests expressed in the previous cycle.

### 3.2 Discovery ("shop window")
- **FR06 — Active listing**: Show all active posts, sortable by date, filterable by category and type.
- **FR07 — Keyword search**: Free-text search over title/description.
- **FR08 — Post detail view**: Full description and available contact info.

### 3.3 Contact and response
- **FR09 — Express interest**: Interested user can register interest and/or get the author's contact (phone/WhatsApp) to continue off-platform.
- **FR10 — Notify author**: Author is notified (email, WhatsApp, or in-app) when someone expresses interest.
- **FR11 — Closure notification**: When a post is closed, all users who previously expressed interest are notified that the need is already resolved.

### 3.4 User account
- **FR12 — Sign up / login**: Email+password (or social login if feasible).
- **FR13 — Basic profile**: Name, contact info, optional community/church affiliation.
- **FR14 — Post history**: User can view their own posts (active and closed).

### 3.5 Moderation
- **FR15 — Approval workflow**: Every post requires moderator approval before going live (BR01).
- **FR16 — Moderation panel**: Simple admin area to approve, reject, or remove posts.

## 4. Business rules (BR)

- **BR01 — Approval by default**: Every post requires moderator approval by default in the MVP, since no reputation/trust system exists yet. (Direct publishing for trusted users is a future-phase requirement, not MVP.)
- **BR02 — Single state per post**: A post is in exactly one state: pending approval, active, closed/resolved, or rejected.
- **BR03 — Closure ownership**: Only the post's author (or a moderator) can mark it as resolved.
- **BR04 — Contact info required**: Every post must include at least one valid contact method (phone/WhatsApp or email), since final negotiation happens off-platform.
- **BR05 — Unified data model**: Volunteering and donations are categories of the same "need/offer" entity, not separate modules — to allow reuse when the job/recruitment phase is added.
- **BR06 — Consent required**: Users must explicitly consent to storage/use of their contact data (GDPR/LGPD).
- **BR07 — No payments**: The MVP does not process payments, financial donations, or any monetary transaction.

## 5. Non-functional requirements (NFR)

### 5.1 Usability
- **NFR01 — Responsive web app**: Must work well on both desktop and mobile browsers. No native app in the MVP (decision from kickoff meeting).
- **NFR02 — Low-friction posting**: Creating a post should take a few steps, ideally under 2 minutes, given a broad range of digital literacy among users.

### 5.2 Internationalization (i18n)
- **NFR03 — Multi-language support**: The application must be built with i18n from the start — all user-facing strings externalized (no hardcoded text in templates/components), using a standard i18n framework/library (e.g., i18next, react-intl, or the framework's built-in i18n routing).
- **NFR04 — Default locale**: Portuguese (pt-PT) is the default/primary language for the MVP (community is based in Portugal), with the architecture ready to add English and Brazilian Portuguese (pt-BR) as additional locales without structural rework.
- **NFR05 — Locale-aware formatting**: Dates, and any numeric/currency values shown in the future job phase, must respect locale formatting conventions.
- **NFR06 — Right-to-left readiness (optional/nice-to-have)**: Not required for MVP locales, but avoid layout patterns that would make RTL support difficult later (e.g., hardcoded left/right instead of logical start/end CSS properties).

### 5.3 Security & privacy
- **NFR07 — Data protection**: Contact and account data stored securely; HTTPS in transit; access control on sensitive data.
- **NFR08 — GDPR/LGPD compliance**: Explicit consent flow, clear privacy policy, user-triggered data deletion.
- **NFR09 — Restricted admin access**: Moderation panel accessible only to users with a moderator/admin role.

### 5.4 Availability & infrastructure
- **NFR10 — Hosting**: MVP can run on Ramon's personal server (16GB RAM, Cloudflare tunnel) or church-owned VMs, exposed securely via tunnel/reverse proxy — never exposing internal network directly.
- **NFR11 — Backups**: Database must have a backup routine, consistent with the church's existing daily-replicated backup practice.
- **NFR12 — Staging environment**: A separate test/staging environment from production, following the precedent set by the church's bookstore app.

### 5.5 Maintainability & evolution
- **NFR13 — Extensible data model**: The need/offer model must support the future job/recruitment category and a future reputation/ranking system without structural rework.
- **NFR14 — Basic observability**: Error and usage logging sufficient for diagnosis and iteration.

### 5.6 Performance
- **NFR15 — Expected load**: Must handle, without advanced optimization, a mid-sized community's volume (tens to a few hundred concurrent active posts).

## 6. Technical implementation notes

### 6.1 Suggested architecture
- Responsive web frontend (e.g., Next.js/React) with i18n routing (e.g., next-intl or built-in Next.js i18n) built in from day one, not retrofitted.
- Backend API (REST or GraphQL).
- Relational database (e.g., PostgreSQL) for posts, users, moderation states.
- Auth: own implementation (secure password hashing) or third-party OAuth.
- Notifications via email and/or WhatsApp Business API for interest/closure alerts — never replacing the platform as the primary channel.

### 6.2 Infrastructure & deploy
- Initial deploy on Ramon's server, containerized (Docker), exposed via Cloudflare Tunnel.
- Future migration path to church-owned VM infrastructure, supported by Rafael Santos (church IT) and Tiago Alves.
- Git-based version control with a simple CI pipeline for staging build/deploy.

### 6.3 Data model (high level)
- **User**: registration data, contact, role (regular user / moderator).
- **Post**: type (request/offer), category (volunteering/donation), title, description, contact, status (pending/active/closed/rejected), author, timestamps.
- **Interest**: records of who expressed interest in which post, to enable closure notifications.

### 6.4 Open technical questions
- Fully manual moderation vs. lightweight automation (e.g., blocked keyword filters)?
- Notification provider/cost (transactional email, WhatsApp API)?
- Who owns QA before launch?

## 7. Risks

- **R1 — "White elephant" effect**: If WhatsApp remains the de facto negotiation channel, the platform stops being used as the central shop window (happened before, per team's prior experience).
- **R2 — Duplicate/wasted contacts**: Without the closure mechanism (FR04/FR11), requesters keep receiving contacts for already-resolved needs.
- **R3 — Scope creep**: Reputation system, unification with the church app, and WhatsApp bot are all high-risk scope expanders — keep them out of MVP.
- **R4 — Legal exposure**: Collecting contact data without proper GDPR/LGPD handling creates legal risk for the church.

## 8. Next steps

- [ ] Tiago Alves: send draft/flowchart of a "need" lifecycle (post → response → resolution).
- [ ] Ramon Rios: validate this requirements doc with the team.
- [ ] Rafaela Bento: help build the flow diagram for alignment before the next meeting.
- [ ] Team: schedule an alignment meeting with diagram + consolidated requirements.

## 9. Suggested build order for an implementing agent

1. Data model + migrations (User, Post, Interest) with i18n-ready schema (no hardcoded locale-specific strings in DB).
2. Auth (sign up/login, roles: user/moderator).
3. Post CRUD (create/edit/close/reopen) — FR01–FR05.
4. i18n setup (locale files, default pt-PT, string extraction) — NFR03–NFR05.
5. Listing/search/filter ("shop window") — FR06–FR08.
6. Interest/contact flow + notifications — FR09–FR11.
7. Moderation panel — FR15–FR16.
8. Backups + staging environment — NFR11–NFR12.
9. Privacy/consent flow (GDPR/LGPD) — NFR08, BR06.
