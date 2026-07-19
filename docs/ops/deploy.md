# Deploy — staging, prod, rollback, secrets

> **Audience:** operators (Ramon now; Rafael Santos / church IT after
> handoff).
> **Scope:** how code goes from a merged PR to running on a server, how
> to roll it back in under five minutes, and the database-migration
> considerations that complicate rollback. For rotating individual
> secrets (including at handoff), see `docs/ops/handoff-to-church.md`.
> **Cross-reference:** `docs/ARCHITECTURE.md` §3.1 (deployable), §8.2
> (per-environment overrides), §13 (build tooling).

---

## 0. Replace before use

- `<APP_DOMAIN>` — the apex domain (e.g. `precisase.casadacidade.pt`).
- `<prev-sha>` — the previous green commit SHA, looked up per drill
  (see §4).
- `<new-sha>` — the SHA being deployed.

---

## 1. Staging — on-merge auto-deploy

Triggered automatically when a PR is merged to `main`.

```mermaid
flowchart LR
    PR[Merge PR to main] --> CI[ci.yml: lint + tsc + test + build + i18n-parity]
    CI --> D[deploy.yml: build + push image]
    D --> SSH[SSH to Ramon's server]
    SSH --> Pull[docker compose pull]
    Pull --> Up[docker compose up -d web worker]
    Up --> Mig[prisma migrate deploy]
    Mig --> Verify[curl /api/health]
```

### 1.1. What `.github/workflows/deploy.yml` does

1. Builds the Docker image from the repo `Dockerfile`.
2. Pushes it to GHCR with two tags:
   - `ghcr.io/ramoneees/precisase:${{ github.sha }}` — immutable,
     used for rollback.
   - `ghcr.io/ramoneees/precisase:staging` — rolling, what staging
     `docker compose pull` always grabs.
3. SSHes to the docker host (Ramon's server, via the `appleboy/ssh-action`
   action using `SSH_HOST`, `SSH_USERNAME`, `SSH_KEY` GitHub Secrets).
4. On the host:
   ```bash
   cd /opt/precisase
   docker compose -f docker-compose.yml -f docker-compose.staging.yml pull
   docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d web worker
   docker compose -f docker-compose.yml -f docker-compose.staging.yml exec web \
     pnpm exec prisma migrate deploy
   ```

### 1.2. Verify

```bash
curl -fsS https://staging.<APP_DOMAIN>/api/health | jq .
```

Expected: HTTP `200`, JSON body containing the new SHA in the `sha`
field. The `/api/health` endpoint is the single source of truth for
"which version is live" — every deploy confirmation starts here.

---

## 2. Prod — `workflow_dispatch` with approval gate

Prod deploys are **manual**: a GitHub Actions `workflow_dispatch`
trigger, gated by a GitHub Environment approval.

### 2.1. One-time setup (GitHub repo settings)

- **Settings → Environments → New environment → `production`**.
- **Required reviewers:** add at least one reviewer (Ramon today; a
  church reviewer post-handoff). Any `workflow_dispatch` run targeting
  `environment: production` now pauses for human approval before any
  job runs.

### 2.2. Trigger

- GitHub Actions UI → **Deploy** workflow → **Run workflow** →
  select the `production` environment → confirm.
- The workflow run pauses in `Waiting for review`. A configured
  reviewer clicks **Review deployments** → tick `production` →
  **Approve and deploy**.

### 2.3. What runs after approval

Same sequence as staging (§1.1), plus:
- Image also tagged `:prod` and `:latest`.
- SSH target uses the **prod** compose file and prod secrets.
- After the deploy completes, the workflow runs the §2.4 health check
  and fails the run if it does not pass within 60s.

### 2.4. Verify

```bash
curl -fsS https://<APP_DOMAIN>/api/health | jq .
```

Expected: HTTP `200`, JSON body containing the deployed SHA.

---

## 3. The `--webpack` build flag (why we don't use turbopack)

`package.json`:

```json
"build": "next build --webpack"
```

This is an **explicit opt-out of turbopack**. Reason: the Sentry SDK
(`@sentry/next.js` 10.20+) currently supports Next.js 16 production
builds only on the **webpack** code path. Turbopack is not yet GA at
the version Next.js 16 ships, and Sentry's turbopack support is
incomplete (silent source-map upload failures and missing
`SentryServerConfig` integration). We chose webpack on prod builds so
Sentry instrumentation stays reliable.

- **Dev (`next dev`)** stays turbopack — that path works fine, is much
  faster, and Sentry dev instrumentation is not a requirement.
- **Revisit when:** Sentry publishes a "turbopack GA" announcement
  that covers Next.js 16 source-map upload + server config. Then
  remove `--webpack` and verify a deploy end to end.

No production setting should toggle this — it is a build-time decision
that ships in `package.json`. If a CI step or a wrapper script ever
overrides the `build` script, it must keep `--webpack`.

---

## 4. Rollback in under 5 minutes

Rollback = re-run an earlier known-good image. **It does NOT roll back
database migrations** — see §5.

### 4.1. Identify the previous green SHA

GitHub Actions UI → **Deploy** workflow → find the most recent
successful (green) run before the broken one → copy the commit SHA
(`github.sha` column). Call this `<prev-sha>`.

If GitHub Actions itself is down and you cannot reach the UI:

```bash
# On the docker host — list the last 10 images GHCR has served.
docker images ghcr.io/ramoneees/precisase --format '{{.Tag}} {{.ID}} {{.CreatedAt}}' | head
```

The SHA-tagged image (`:<prev-sha>`) is immutable and will still be
present locally unless `docker system prune` has run.

### 4.2. Roll back via GitHub Actions (preferred)

Run the Deploy workflow on `workflow_dispatch` with the `sha` input
set to `<prev-sha>` (the workflow's build step must respect that
input and `docker pull` instead of rebuild; if it does not, use §4.3).

### 4.3. Roll back directly on the host (if GitHub is down)

```bash
cd /opt/precisase

# Re-tag the immutable SHA image as :prod, then bounce the services.
docker tag ghcr.io/ramoneees/precisase:<prev-sha> ghcr.io/ramoneees/precisase:prod
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d web worker
```

### 4.4. Verify

```bash
curl -fsS https://<APP_DOMAIN>/api/health | jq -r .sha
```

Expected: prints `<prev-sha>`. If it prints the broken SHA, the
`up -d` step did not actually swap the container — `docker compose ps`
to check the container age and `docker inspect` to confirm the image
digest.

---

## 5. Database migrations

`prisma migrate deploy` runs as the **last** step of every deploy
(§1.1, §2.3). Implications:

- A deploy is **not** atomic across app + DB. The new app image starts,
  then migrations run. Code that depends on a migration that has not
  yet applied will error for the seconds-to-minutes window in between.
  Mitigations:
  - Keep migrations additive (add column → backfill → read in app →
    only then drop the old column).
  - Run `prisma migrate deploy` synchronously inside the deploy
    workflow, after `up -d` (current behaviour), so the health check
    at the end implies both app + DB are live.

- **Rollback does NOT revert migrations.** A column-drop migration
  applied during deploy N cannot be undone by re-deploying image
  N-1 — the old code path will fail at runtime because the column is
  gone. For changes that drop columns or tables, document the
  rollback procedure explicitly in the migration's `migration.sql`
  comment header BEFORE merging.

- **Known migration-history consideration** (from `AGENTS.md`): the
  migration `20260718192700_add_user_church_affiliation/migration.sql`
  contains `CREATE INDEX` statements without `IF NOT EXISTS` that
  collide on shadow-DB replay. New migrations should always use
  `IF NOT EXISTS` for `CREATE INDEX` / `CREATE EXTENSION` so they
  remain idempotent under `migrate deploy` as well as future shadow-DB
  replays.

---

## 6. Secrets rotation

Rotation of individual secrets (`AUTH_SECRET`,
`CONTACT_ENCRYPTION_KEY`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SIGNING_SECRET`, `CLOUDFLARE_TUNNEL_TOKEN`,
`POSTGRES_PASSWORD`, etc.) is documented in
**`docs/ops/handoff-to-church.md` §"Secrets rotation checklist"**.
That is the canonical list — `deploy.md` only references it.

The deploy-time mechanics are:

```bash
# 1. Update /opt/precisase/.env on the docker host with the new value(s).
# 2. Bounce the affected services so the new env is loaded:
cd /opt/precisase
docker compose -f docker-compose.yml -f docker-compose.<environment>.yml up -d \
  web worker
# 3. Verify:
curl -fsS https://<environment-subdomain>.<APP_DOMAIN>/api/health | jq .
```

GitHub Secrets (`SSH_HOST`, `SSH_USERNAME`, `SSH_KEY`, `GHCR_TOKEN`)
rotate via repo Settings → Secrets and variables → Actions, not via
`.env`. After rotating any of these, run the Deploy workflow once on
staging to confirm the SSH path still works end to end.

---

## See also

- `docs/ops/handoff-to-church.md` — secrets rotation checklist and
  the full handoff procedure.
- `docs/ops/resend-setup.md` — Resend domain verification + webhook
  setup, which is deploy-time work (the webhook signing secret needs
  `up -d web` after being set).
- `docs/ops/backup-restore-drill.md` — the weekly backup drill.
- `docs/MVP-QA-CHECKLIST.md` — manual end-to-end QA walkthrough to
  run against staging after any non-trivial deploy.
