# Resend setup — transactional email + bounce/complaint webhook

> **Audience:** operators (Ramon now; Rafael Santos / church IT at handoff).
> **Scope:** everything you need to do in the Resend dashboard and at the
> DNS layer to take transactional email live for the Precisa-se app.
> **Cross-reference:** `docs/ARCHITECTURE.md` §4.5 (Resend chosen as the
> transactional email provider). For secret rotation at handoff, see
> `docs/ops/handoff-to-church.md`. For the deploy procedure that bounces
> the web container after you set `RESEND_WEBHOOK_SIGNING_SECRET`, see
> `docs/ops/deploy.md`.

---

## 0. Replace before use

This document contains the following placeholders. Replace each one with
the real value for the environment you are configuring:

- `<APP_DOMAIN>` — the apex domain the app is served at (e.g.
  `precisase.casadacidade.pt`). Staging uses `staging.<APP_DOMAIN>`.
- `<environment>` — `staging` or `prod` (used in prose, not commands).

---

## 1. Domain verification

Goal: Resend can send mail "From" `<APP_DOMAIN>` and inbox providers can
verify the signature.

1. Sign in to the Resend dashboard → **Domains** → **Add domain**.
2. Enter `<APP_DOMAIN>` and pick the region closest to the server
   (Frankfurt for Portugal-hosted prod).
3. Resend shows **five DNS records** to create at your DNS provider
   (Cloudflare today; the church's DNS provider after handoff):

   | # | Type | Name (host) | Value / content | Cloudflare note |
   |---|---|---|---|---|
   | 1 | `TXT`  | `<APP_DOMAIN>` (apex / `@`) | `v=spf1 include:amazonses.com ~all` | **TXT is fine proxied or grey** — Cloudflare doesn't proxy TXT. |
   | 2 | `CNAME` | `resend._domainkey.<APP_DOMAIN>` | DKIM selector 1, value from Resend | **Must be grey cloud (DNS only).** A proxied (orange) CNAME breaks DKIM because Cloudflare flattens it to the cloudflare.com IP. |
   | 3 | `CNAME` | `send.resend._domainkey.<APP_DOMAIN>` | DKIM selector 2 | **Grey cloud.** Same reason. |
   | 4 | `CNAME` | `send.<APP_DOMAIN>` → `feedback.resend.email` | (Resend bounce loop) | Grey cloud is correct. |
   | 5 | `TXT`  | `_dmarc.<APP_DOMAIN>` | See §3 below for the `p=` choice. | TXT, fine either way. |

   > **Gotcha (Cloudflare "DNS lookup flattened"):** records 2 and 3 MUST
   > have the orange cloud **off**. If you leave them on the orange
   > (proxied) setting, Cloudflare will hide Resend's DKIM CNAME behind
   > its own IP and Resend's verification will spin forever on
   > "Pending".

4. Back in Resend, click **Verify DNS records**. Wait 1–5 minutes. Status
   flips from **Pending** → **Verified**. If it is still **Pending** after
   15 minutes, the most common cause is a proxied DKIM CNAME — re-check
   the orange/grey cloud setting.

---

## 2. Webhook setup (bounce + complaint capture)

The app uses the `User.emailBouncedAt` and `User.emailComplainedAt`
columns to suppress sends (the `ResendMailer` checks both before every
API call). Those columns are populated by the webhook at
`/api/webhooks/resend`, which is svix-signed — so the webhook signing
secret is required.

1. Resend dashboard → **Webhooks** → **Create webhook**.
2. **Endpoint URL:**
   ```
   https://<APP_DOMAIN>/api/webhooks/resend
   ```
   - Staging: `https://staging.<APP_DOMAIN>/api/webhooks/resend`
   - Prod:    `https://<APP_DOMAIN>/api/webhooks/resend`
3. **Events to subscribe** — select ONLY these two:
   - `email.bounced`
   - `email.complained`

   > **Do NOT subscribe to `email.delivered` or `email.sent`.** The app
   > does not act on them, and Resend fires one event per message —
   > this would inflate webhook traffic ~100× with no benefit.

4. Click **Create webhook**.
5. On the resulting webhook detail page, click **Reveal** next to
   **Signing secret**. Copy the `whsec_...` value.
6. Set it in the target environment:
   ```bash
   # On the docker host at /opt/precisase/.env
   RESEND_WEBHOOK_SIGNING_SECRET=whsec_replace_with_real_value
   ```
7. Restart the web container so the new value is loaded:
   ```bash
   cd /opt/precisase
   docker compose -f docker-compose.yml -f docker-compose.<environment>.yml up -d web
   ```
   (For the full deploy sequence, including `prisma migrate deploy`, see
   `docs/ops/deploy.md`.)
8. Back in Resend → **Webhooks** → your webhook → **Send test** to fire
   a synthetic payload. Tail the web container logs; you should see a
   single `200 OK` line from `/api/webhooks/resend`. A `400` or `500`
   means the signature verification failed — re-check that the secret in
   `.env` matches and that the container was actually restarted.

---

## 3. DMARC policy choice

The DMARC TXT record (record #5 in §1) controls what inbox providers do
when a message fails DMARC alignment. Use a graduated rollout:

> **Precondition for `rua=` to work.** The examples below use
> `rua=mailto:postmaster@<APP_DOMAIN>`. Inbox providers will deliver
> aggregate reports to that address — but only if mail can reach it.
> If the church does NOT run inbound mail on `<APP_DOMAIN>` (no MX
> record — see `docs/ops/handoff-to-church.md` §2.1, MX is "most
> likely not required"), the reports will not arrive and the
> graduated rollout is flying blind. Two ways to fix:
>
> 1. **Add an MX pointing at a sink mailbox** the church monitors
>    (e.g. a free Cloudflare Email Routing address) so
>    `postmaster@<APP_DOMAIN>` is deliverable.
> 2. **Drop `rua=` entirely** from the record and accept no aggregate
>    reports. Use this only if a deliberate choice has been made to
>    skip DMARC monitoring — not the default.
>
> Option 1 is the recommended default. Re-confirm the MX is in place
> before deploying any record with `rua=`.

- **Staging:** `v=DMARC1; p=none; rua=mailto:postmaster@<APP_DOMAIN>`
  - `p=none` is **monitor only** — no action taken on failing mail, but
    aggregate reports still come back to the rua address (provided the
    precondition above is met). Use this in staging and for the first
    2 weeks of prod.

- **Prod (initial 2 weeks):** same `p=none` record. Collect and review
  DMARC reports (a `postmaster@` inbox that's actually monitored, or a
  third-party DMARC analyser — dmarcian, URIports, etc. — which case
  the `rua=` address is the analyser's, not `postmaster@<APP_DOMAIN>`).

- **Prod (after 2 weeks of clean reports):**
  `v=DMARC1; p=quarantine; pct=100; rua=mailto:postmaster@<APP_DOMAIN>`
  - Quarantines failing mail to recipients' spam folders. Inbox
    placement of legitimate mail is unaffected.

- **Prod (stretch goal, after another 2 clean weeks):**
  `p=reject; pct=100` — outright drops failing mail at the recipient.
  Recommended end state but only after a clean quarantine run.

> **Why not start at `p=reject`:** DMARC alignment also requires SPF and
> DKIM alignment. A misconfigured forwarder, mailing list, or Resend
> region change can trip these and a `p=reject` policy will silently
> discard legitimate mail. The gradual ramp exists to make those
> failures visible.

---

## 4. Verify end-to-end

Run all three of these after the §1 and §2 steps are complete on
**staging** (cheap, no real user impact).

### 4.1. Webhook is POST-only

```bash
curl -i https://staging.<APP_DOMAIN>/api/webhooks/resend
```

Expected: HTTP `405 Method Not Allowed` (the route only accepts POST).
Any other status (404, 502, 500) means routing/proxy is broken — check
Caddy and the Cloudflare Tunnel hostname first.

### 4.2. Trigger a real bounce

Trigger a notification email to Resend's synthetic bounce address:

```bash
# In the app, sign in as a test user and update its email to the
# Resend test bounce address:
docker exec precisase-db-1 psql -U precisase -d precisase -c \
  "UPDATE users SET email = 'bounced@resend.dev' WHERE email = '<test-user-email>';"
```

Then cause the app to send a notification to that user (e.g. close a
post that user expressed interest in, per the FR11 flow). Within ~60s
the Resend webhook should fire `email.bounced`.

### 4.3. Confirm the bounce was captured

```bash
docker exec precisase-db-1 psql -U precisase -d precisase -c \
  "SELECT email, email_bounced_at FROM users WHERE email = 'bounced@resend.dev';"
```

Expected: `email_bounced_at` is set to a recent timestamp. If it is
still NULL after ~2 minutes, the webhook is not landing — re-check §2
step 7 (container restart) and §2 step 8 (Resend "Send test" success).

### 4.4. Confirm suppression works

Send a second notification to the same user. The `ResendMailer` should
**skip the Resend API call entirely** and log a "suppressed" line. No
new event fires in the Resend dashboard.

---

## See also

- `docs/ops/deploy.md` — env rotation procedure and the `up -d web`
  step used in §2.7 above.
- `docs/ops/handoff-to-church.md` — what migrates at handoff, including
  rotating `RESEND_API_KEY` and `RESEND_WEBHOOK_SIGNING_SECRET` into the
  church's own Resend account.
- `docs/MVP-QA-CHECKLIST.md` — manual end-to-end walkthrough that
  exercises the FR11 closure-notification flow end to end.
