# Handoff to the church — infra + secrets transfer

> **Audience:** Ramon Rios (current owner) and Rafael Santos (church IT
> point of contact).
> **Scope:** phase-2 handoff of the Precisa-se app from Ramon's
> personal infrastructure to the church's own infrastructure. This
> document lists what migrates, what stays, the secrets rotation
> checklist (the critical part — every secret rotates), and the
> cutover sequence.
> **Cross-reference:** `docs/ARCHITECTURE.md` §8 (deployment
> environments), §7.4 (PII encryption), §4.5 (Resend), §4.8 (Sentry).
> For the deploy procedure being handed off, see `docs/ops/deploy.md`.

---

## 0. Replace before use

- `<APP_DOMAIN>` — the apex domain at handoff (e.g.
  `precisase.casadacidade.pt`).
- `<handoff-date>` — the agreed cutover date.
- `<church-email>` — an email address on the church's domain (Rafael
  Santos's, or a shared `it@<church-domain>` mailbox).
- `<church-docker-host>` — the IP / hostname of the new docker host.
- `<church-nas-path>` — the NAS path that will receive the prod
  backups.

---

## 1. Context

The app is currently running on **Ramon Rios's** personal
infrastructure: a Cloudflare account, a 16GB self-hosted server, a GHCR
registry under the `ramoneees` GitHub account, and a Sentry org under
Ramon's email.

Phase-2 handoff means the church (point of contact: **Rafael Santos**)
takes over ownership of the running service. The goal is **full
handoff** — Ramon does not retain any permanent operational access. He
does retain historical commit attribution in git (that is immutable
and expected).

This document is the canonical list of what migrates, what to
provision on the church side, and the order to do it in. Do not start
the cutover (§5) until everything in §3 and §4 is provisioned and
tested against staging data.

---

## 2. What migrates

### 2.1. Domain DNS

From Ramon's Cloudflare account to the church's DNS provider (the
church is free to pick any DNS provider — Cloudflare is not a hard
dependency once the Tunnel is also migrated, see §2.2).

Record types to migrate:

| Type | Name | Value | Source |
|---|---|---|---|
| `A` / `AAAA` (or `CNAME` to the Tunnel hostname) | `<APP_DOMAIN>` (apex) | set by the new Cloudflare Tunnel hostname | new tunnel, §2.2 |
| `A` / `AAAA` / `CNAME` | `staging.<APP_DOMAIN>` | same, staging tunnel | new staging tunnel |
| `MX` | `<APP_DOMAIN>` | only if the church runs inbound mail — most likely **not required** | — |
| `TXT` (SPF) | `<APP_DOMAIN>` | `v=spf1 include:amazonses.com ~all` | `docs/ops/resend-setup.md` §1 |
| `CNAME` (DKIM 1) | `resend._domainkey.<APP_DOMAIN>` | from the church's Resend account | `docs/ops/resend-setup.md` §1 |
| `CNAME` (DKIM 2) | `send.resend._domainkey.<APP_DOMAIN>` | from the church's Resend account | `docs/ops/resend-setup.md` §1 |
| `CNAME` | `send.<APP_DOMAIN>` → `feedback.resend.email` | bounce loop | `docs/ops/resend-setup.md` §1 |
| `TXT` (DMARC) | `_dmarc.<APP_DOMAIN>` | graduated `p=` policy per §3 of resend-setup | `docs/ops/resend-setup.md` §3 |

> **Cloudflare note:** if the church picks Cloudflare as well, DKIM
> CNAMEs MUST be grey-cloud (DNS only), not proxied. See
> `docs/ops/resend-setup.md` §1 gotcha.

### 2.2. Cloudflare Tunnel

The current prod tunnel lives in Ramon's Cloudflare Zero Trust account.
The church provisions its own tunnel in its Zero Trust dashboard:

1. Church: Cloudflare Zero Trust → **Networks** → **Tunnels** →
   **Create a tunnel** → **Cloudflared**.
2. Note the **tunnel token** (the long base64 string starting with
   `eyJ...`).
3. Configure the public hostname (`<APP_DOMAIN>` and
   `staging.<APP_DOMAIN>`) to route to the `caddy` service on the
   internal docker network (`http://caddy:80`).
4. Set the new token as `CLOUDFLARE_TUNNEL_TOKEN` in the prod `.env`
   (and `CLOUDFLARE_TUNNEL_TOKEN_STAGING` in staging `.env`).
5. After cutover, **revoke** Ramon's old tunnel in Cloudflare Zero
   Trust → Tunnels → ... → Delete.

### 2.3. Sentry org

Two options — pick one:

- **Option A (preferred): transfer ownership** of the existing Sentry
  org to a church-controlled email (e.g. `it@<church-domain>`). No
  project rotation needed; the existing `SENTRY_DSN` keeps working.
- **Option B: new Sentry org under the church.** Create a new Sentry
  project, generate new `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`,
  and a new `SENTRY_AUTH_TOKEN`. Set them in `.env` and GitHub
  Secrets. Update `sentry.client.config.ts` / `sentry.server.config.ts`
  only if the DSN format differs (it should not).

### 2.4. GHCR / GitHub

Two options — pick one:

- **Option A (preferred): transfer the GitHub repo** to a church-owned
  GitHub org. GitHub preserves stars, issues, PRs, and history.
  Update `.github/workflows/deploy.yml`'s `IMAGE_NAME` env to the new
  org (`ghcr.io/<church-org>/precisase`). The GitHub Secrets
  (`SSH_HOST`, `SSH_USERNAME`, `SSH_KEY`) must be re-set in the new
  repo location — secrets do not transfer. No `GHCR_TOKEN` is needed
  (the workflow uses the auto-provided `GITHUB_TOKEN` — see §4.3).
- **Option B: fork** the repo into the church org. Update the deploy
  workflow's `IMAGE_NAME` env. The original under `ramoneees/precisase`
  becomes read-only / archived.

After either option, the GHCR package
`ghcr.io/ramoneees/precisase:...` should be deleted once the new
registry path is producing green deploys.

### 2.5. Backup target

The `backup_data` volume in `docker-compose.yml` is bind-mounted (in
prod) to a NAS-replicated path. At handoff:

1. Church: provision a NAS path (`<church-nas-path>`) writable by the
   docker daemon's user on `<church-docker-host>`.
2. Update the `backup` service's `volumes:` entry in
   `docker-compose.prod.yml` to point at `<church-nas-path>`.
3. Copy the historical backup set from Ramon's NAS into the new path
   (so historical recovery is still possible after Ramon's NAS is
   decommissioned).

### 2.6. SSH user privilege boundary

The deploy workflow (`appleboy/ssh-action` in
`.github/workflows/deploy.yml`) SSHes into `<church-docker-host>` and
runs `docker compose pull && up -d && exec -T ... prisma migrate
deploy`. The provisioned user must be able to do exactly that — and
nothing more.

Provision a **dedicated `precisase` user** on the docker host (not
the church admin's account, not `root`):

- Add to the `docker` group (or grant a narrow sudoers wrapper limited
  to `docker compose` subcommands the deploy script uses). Avoid full
  sudo.
- Home dir at `/opt/precisase` — the deploy `cd`s here and the
  `docker-compose*.yml` files live here. No write access outside it.
- SSH key auth only (no password). The matching private key is
  `SSH_KEY` in GitHub Secrets.
- No shell access for general use. If the church needs interactive
  ops, use a separate admin account with MFA — not the deploy user.

If a wrapper approach is preferred over the `docker` group, a
sudoers snippet like the following gives exactly the deploy surface:

```
precisase ALL=(root) NOPASSWD: /usr/bin/docker compose *
```

(Read it carefully before pasting — `docker compose *` is broad
because compose itself can mount arbitrary host paths. Prefer the
`docker` group with filesystem permissions scoping `/opt/precisase`
if your threat model warrants it.)

### 2.7. Server access

The church provisions the dedicated `precisase` SSH user per §2.6 on
`<church-docker-host>`. Ramon's SSH key is rotated out — the
`SSH_KEY` GitHub Secret is replaced with a key controlled by the
church.

---

## 3. What stays / Ramon-owned

Nothing — the goal is **full handoff**. The only thing Ramon
permanently retains is:

- **Git commit attribution.** Existing commits authored by Ramon
  remain authored by Ramon. This is immutable in git history and
  expected.
- **Historical commit rights** on the original GitHub repo (read-only
  after the transfer / archive in §2.4).

---

## 4. Secrets rotation checklist (the critical part)

Every secret in `.env` and in GitHub Secrets MUST be rotated at
handoff. None carry over. The order matters: rotate the new values
into the church's `.env` **before** the cutover (§5), and only then
revoke Ramon's versions.

### 4.1. App secrets (in `.env`)

| Secret | Rotation procedure |
|---|---|
| `AUTH_SECRET` | Regenerate: `openssl rand -base64 32`. **Rotating this invalidates all active sessions** — every user gets signed out at cutover. Plan for that. |
| `CONTACT_ENCRYPTION_KEY` | **Special — not a simple env swap.** See §4.2 below. |
| `RESEND_API_KEY` | New key in the church's Resend account. Set in `.env`; revoke Ramon's key after cutover. |
| `RESEND_WEBHOOK_SIGNING_SECRET` | New webhook created in the church's Resend account (`docs/ops/resend-setup.md` §2). New `whsec_...` value in `.env`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | New tunnel (§2.2). |
| `CLOUDFLARE_TUNNEL_TOKEN_STAGING` | New staging tunnel. |
| `POSTGRES_PASSWORD` | Rotate the Postgres superuser password on the church-provisioned DB cluster. Update `DATABASE_URL` accordingly. The cutover DB is a fresh restore, so the password is set at restore time. |
| `SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` / `NEXT_PUBLIC_SENTRY_DSN` | Only if Option B in §2.3 (new Sentry org). |
| `MFA_ENFORCE_BEGIN_AT` | Re-set to the church's chosen enforcement date (typically `<handoff-date> + 14 days`). |
| `APP_URL` / `AUTH_URL` | Repoint to the church's `<APP_DOMAIN>` if it differs from the previous one. |

### 4.2. `CONTACT_ENCRYPTION_KEY` — the special case

This key encrypts `Post.contact_value` (FR09 contact details) with
libsodium `crypto_secretbox`, at the app layer — see
`docs/ARCHITECTURE.md §7.4` and `src/server/crypto/contact-encryption.ts`.
**All existing rows are encrypted with the old key.** A simple env
swap will leave every historical row unreadable.

> **Pre-flight check (before starting):** confirm there is NO code-side
> fallback. `src/server/crypto/contact-encryption.ts` reads ONLY
> `CONTACT_ENCRYPTION_KEY`. There is no `CONTACT_ENCRYPTION_KEY_PREVIOUS`
> mechanism. The procedure below is written for that single-key code —
> it re-encrypts every row *while the old key is still in `.env`*, then
> atomically swaps the env to the new key, then verifies all reads
> succeed. If a fallback has since been implemented, prefer the dual-key
> procedure documented in the source file instead.

Rotation procedure (a careful, separate task — not done in the same
step as the rest of §4). Schedule a brief maintenance window; users
can still read/write posts during it (the app keeps working with the
old key throughout), but new writes during the window will need to be
re-encrypted too — the procedure's tail-end loop covers that.

1. **Generate the new key** (do NOT yet put it in `.env`):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Save the output as `<NEW_KEY>`; keep `<OLD_KEY>` (the current value
   of `CONTACT_ENCRYPTION_KEY`) handy too. Both are 44-char base64.

2. **Take a fresh DB backup.** If anything goes wrong, you restore from
   this and try again. Do not skip.

3. **Run the re-encryption ad-hoc.** No shipped script exists — run it
   as a one-off Node REPL or `.cjs` file ON THE DB HOST (so the new
   ciphertext never transits a network in plaintext). The procedure:
   ```javascript
   // rotate-contact-key.cjs — run ON THE DB HOST, against the prod DB.
   // Reads OLD_KEY and NEW_KEY from argv (never the env — the app's env
   // stays pointed at OLD_KEY until step 5).
   const sodium = require("libsodium-wrappers");
   const { PrismaClient } = require("@prisma/client");
   const OLD_KEY = Buffer.from(process.argv[2], "base64");
   const NEW_KEY = Buffer.from(process.argv[3], "base64");
   if (OLD_KEY.length !== 32 || NEW_KEY.length !== 32) {
     throw new Error("both keys must decode to 32 bytes");
   }
   (async () => {
     await sodium.ready;
     const prisma = new PrismaClient();
     const BATCH = 100;
     let cursor = undefined;
     let processed = 0;
     let failed = 0;
     while (true) {
       const rows = await prisma.post.findMany({
         where: { contactValue: { not: null } },
         take: BATCH,
         ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
         orderBy: { id: "asc" },
       });
       if (rows.length === 0) break;
       cursor = rows[rows.length - 1].id;
       for (const row of rows) {
         try {
           // Decrypt with OLD_KEY.
           const buf = Buffer.from(row.contactValue);
           const nonce = buf.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
           const box = buf.subarray(sodium.crypto_secretbox_NONCEBYTES);
           const plain = sodium.crypto_secretbox_open_easy(box, nonce, OLD_KEY);
           // Re-encrypt with NEW_KEY (fresh nonce).
           const newNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
           const newBox = sodium.crypto_secretbox_easy(plain, newNonce, NEW_KEY);
           const newCiphertext = Buffer.concat([Buffer.from(newNonce), Buffer.from(newBox)]);
           await prisma.post.update({
             where: { id: row.id },
             data: { contactValue: newCiphertext },
           });
           processed++;
         } catch (err) {
           failed++;
           console.error(`post ${row.id}: ${err.message}`);
         }
       }
       console.log(`processed ${processed}, failed ${failed}`);
     }
     console.log(`DONE — processed ${processed}, failed ${failed}`);
     await prisma.$disconnect();
   })();
   ```
   Run it with: `node rotate-contact-key.cjs <OLD_KEY> <NEW_KEY>`.

4. **Verify row counts.** `failed` MUST be 0. Cross-check: the count of
   `Post` rows with non-null `contact_value` (from `psql`) MUST equal
   `processed`. If any row failed, stop — investigate before continuing.
   The backup from step 2 is your undo.

5. **Atomically swap the env.** In `.env`, replace
   `CONTACT_ENCRYPTION_KEY=<OLD_KEY>` with `CONTACT_ENCRYPTION_KEY=<NEW_KEY>`.
   Restart the web container immediately: `docker compose ... up -d web`.

6. **Verify all reads succeed.** Hit a few known posts via the UI
   (moderation page, post detail page) and confirm the contact info
   still displays. If any row shows blank/contact-decrypt-error, that
   row was missed by the loop — restore from the step 2 backup and
   retry from step 3 (the script is idempotent against already-rotated
   rows because decrypt-with-OLD will fail on them; you'd need to
   decrypt-with-NEW instead — easiest path is restore-and-redo).

7. **Re-run the loop once more** to catch any rows written by the app
   between step 3 and step 5 (those are still OLD_KEY ciphertext). Use
   the same command — it'll process the stragglers and skip the
   already-NEW rows (the catch block logs them, but `failed` staying
   low + matching the expected straggler count is the signal).

8. **Destroy `rotate-contact-key.cjs`** and clear shell history. The
   keys were on the command line; treat the host as needing a key-hygiene
   pass.

**Treat this as a multi-hour task with verification, not a 5-minute
env swap.** A mistake here means every historical post loses its
contact info permanently.

### 4.3. GitHub Secrets (in repo Settings → Secrets and variables → Actions)

| Secret | Rotation procedure |
|---|---|
| `SSH_HOST` | The new docker host (`<church-docker-host>`). |
| `SSH_USERNAME` | The church-provisioned SSH user (see §2.6 for privilege boundary). |
| `SSH_KEY` | Private key matching a public key authorised on the church docker host. |

> **No `GHCR_TOKEN` to rotate.** The deploy workflow authenticates to
> GHCR via the auto-provided `${{ secrets.GITHUB_TOKEN }}` (short-lived,
> per-workflow-run — see `.github/workflows/deploy.yml`). What actually
> moves is the GitHub repo/org ownership (§2.4): once the repo is in the
> church's org, the auto-token carries the new org's `packages: write`
> scope automatically.

---

## 5. What Rafael Santos needs from Ramon

Before the cutover, Rafael needs:

1. **Latest prod DB backup** (`pg_dump` file). Delivered via secure
   file transfer to the church's NAS at `<church-nas-path>`. This is
   the restore source for the church-provisioned DB.
2. **The list of env var keys.** This document (§4) is that list —
   it doubles as the church's pre-cutover `.env` template.
3. **Walk-through of `docs/ops/deploy.md`.** Especially §1 (staging
   auto-deploy), §2 (prod approval gate), §4 (rollback). Also
   walk-through of `docs/MVP-QA-CHECKLIST.md` so the church can run
   the post-cutover QA pass.
4. **Access to the GitHub repo.** Per §2.4: either transfer the repo
   to the church org, or invite Rafael as admin of the existing repo
   (then archive it post-cutover).
5. **The Resend DNS records list** from `docs/ops/resend-setup.md` §1,
   so the church's DNS provider can be pre-configured 24h ahead of
   cutover (DNS propagation is the slow part of §6).

---

## 6. Cutover sequence

High-level — refined into a runbook with timestamps at handoff prep
time.

1. **T-7 days:** Church-provisioned infra (docker host, NAS, DNS
   provider, Cloudflare account, Resend account, Sentry org or
   project, GitHub org) is ready. All §3 secrets are generated but
   not yet active.
2. **T-1 day:**
   - **Lower DNS TTL** on the current `<APP_DOMAIN>` records to
     60s. This makes the cutover flip fast and predictable.
   - Church DNS provider is pre-configured with all records from §2.1
     (DKIM, SPF, DMARC, tunnel CNAME) but NOT yet pointing the apex
     at the new tunnel — leave those `A`/`CNAME` records unset or
     set to a placeholder.
3. **T-0 (cutover window, ~30 min):**
   - **Final prod backup** taken on Ramon's infra.
   - **Restore the final backup** into the church DB cluster
     (using the drill procedure in
     `docs/ops/backup-restore-drill.md`, against the church's
     `drill-db`, then promoted to prod).
   - **Run the `CONTACT_ENCRYPTION_KEY` rotation** procedure (§4.2)
     on the restored DB.
   - **Rotate all other secrets** into the church's `.env` (§4.1)
     and GitHub Secrets (§4.3).
   - **Flip DNS:** set the apex `A`/`CNAME` at the church's DNS
     provider to the new Cloudflare Tunnel hostname.
   - **Revoke** Ramon's Cloudflare Tunnel token, Resend API key,
     Resend webhook, Sentry key (if Option B), and remove Ramon's
     public key from the `precisase` SSH user's `authorized_keys`
     (§2.6). Then delete the old GHCR package
     (`ghcr.io/ramoneees/precisase`) — no `GHCR_TOKEN` exists to
     revoke (§4.3); revocation is by deleting the package.
4. **T+0 to T+24h:** monitor.
   - `curl https://<APP_DOMAIN>/api/health` every 5 min for the
     first hour; every 30 min thereafter. Confirm 200s and stable
     SHA.
   - Watch Sentry for new errors.
   - Watch Resend dashboard for delivery / bounce rate spikes.
   - Confirm the next nightly backup lands in `<church-nas-path>`
     at 02:00 and is restorable (run the drill).
5. **T+7 days:** decommission Ramon's infra.
   - Archive / shut down the old docker host.
   - Delete the old GHCR package
     (`ghcr.io/ramoneees/precisase:...`).
   - Cancel Ramon's Cloudflare Zero Trust seat if it was being paid
     for the church app.
   - Ramon's commit attribution remains in git history (intended).

---

## See also

- `docs/ops/deploy.md` — the deploy procedure Rafael will inherit.
- `docs/ops/resend-setup.md` — DNS records list that the church DNS
  provider needs ahead of cutover (§5 item 5 above).
- `docs/ops/backup-restore-drill.md` — used during the cutover DB
  restore verification.
- `docs/ARCHITECTURE.md §7.4` — the PII encryption scheme that
  makes `CONTACT_ENCRYPTION_KEY` rotation a non-trivial task.
- `docs/MVP-QA-CHECKLIST.md` — the post-cutover QA walkthrough.
