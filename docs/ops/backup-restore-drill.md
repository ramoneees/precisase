# Backup restore drill — weekly untested-backup check

> **Audience:** operators (Ramon now; church IT after handoff).
> **Cadence:** weekly (Sunday evening is suggested — minimises blast
> radius if a prod restore is needed Monday morning).
> **Why:** an untested backup is no backup. A `pg_dump` that fails to
> restore is silent until the worst possible moment. We find out by
> restoring, on a throwaway container, every week.
> **Scope:** restore the latest prod backup into an isolated `drill-db`
> container, run smoke queries, tear it down. Never touches the live
> `db` or staging DB.

---

## 0. Replace before use

- `<path-to-backup.dump>` — absolute path on the docker host to the
  prod backup file you want to test (e.g.
  `/opt/precisase/backups/precisase-2026-07-19.dump`).
- `<known-fixture-email>` — an email address you know exists in the
  prod backup (e.g. the operator's own account, or a documented
  fixture account). Replace in §4 step 4 only.
- `<operator-name>` — the human running the drill, for the sign-off
  table in §6.

---

## 1. Prerequisites

- `docker` and `docker compose` on the docker host (the same host that
  runs prod).
- `make` is optional but useful; if you do not have it, use the raw
  `docker compose -f docker-compose.yml -f docker-compose.drill.yml ...`
  commands shown inline below.
- A recent prod backup file accessible to the operator at
  `<path-to-backup.dump>`. The backup container writes to the
  `backup_data` volume (see `docker-compose.yml` §"backup"); in prod
  this is bind-mounted to the NAS-replicated path (§8.3).
- `psql` client (optional, only needed if you want to query `drill-db`
  from your laptop instead of `docker compose exec`).

---

## 2. Start the drill database

The overlay (`docker-compose.drill.yml`) defines `drill-db` with its
own volume (`drill_data`), port `5433:5432`, and a healthcheck. It
intentionally does NOT share state with the live `db`.

```bash
cd /opt/precisase

docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  up -d drill-db
```

If you have `make` and a `drill-restore` target, the equivalent is:

```bash
make drill-restore
```

## 3. Wait for drill-db to be healthy

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  exec drill-db pg_isready -U precisase
```

Expected output: `accepting connections`. If you see `connection
refused`, wait ~10s and re-run (the healthcheck has a 10s `start_period`).

## 4. Install required extensions BEFORE restore

The Precisa-se schema uses **`pgcrypto`**, **`citext`**, and
**`pg_trgm`**. `pg_restore` will fail with errors like
`ERROR: type "citext" does not exist` if the extensions are not
installed in the target database before restore. The `postgres:16-alpine`
image ships all three; they just need to be created.

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  exec drill-db psql -U precisase -d precisase \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  exec drill-db psql -U precisase -d precisase \
  -c "CREATE EXTENSION IF NOT EXISTS citext;"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  exec drill-db psql -U precisase -d precisase \
  -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

## 5. Restore the backup

Copy the backup file into the container, then `pg_restore`:

```bash
# Copy the dump into drill-db's /tmp
docker cp <path-to-backup.dump> \
  "$(docker compose -f docker-compose.yml -f docker-compose.drill.yml ps -q drill-db)":/tmp/backup.dump

# Restore. --clean --if-exists make the restore idempotent on re-runs;
# --no-owner lets the dump load even if the source OIDs reference roles
# that do not exist in the drill container.
docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  exec drill-db pg_restore \
    --clean --if-exists --no-owner \
    -U precisase -d precisase /tmp/backup.dump
```

**Exit code 0 = restore succeeded.** `pg_restore` may emit NOTICEs and
non-fatal WARNINGs — those are fine. Any `ERROR:` line is not; the
restore is broken. See §7 (Failure modes).

## 6. Smoke-test queries

Run all five. Each must return a positive count; if any is `0`, the
restore is incomplete (see §7).

```bash
docker compose -f docker-compose.yml -f docker-compose.drill.yml exec drill-db \
  psql -U precisase -d precisase -c \
  "SELECT (SELECT count(*) FROM users)         AS users,
          (SELECT count(*) FROM posts)         AS posts,
          (SELECT count(*) FROM notifications) AS notifications,
          (SELECT count(*) FROM audit_logs)    AS audit_logs;"
```

Assert: `users > 0`, `posts > 0`, `notifications > 0`, `audit_logs > 0`.
If `audit_logs` is `0` but the others are positive, you may have an
older backup from before auditing was added — record that in the
sign-off table and confirm with the team whether that is expected.

Then look up a known fixture (proves the row content, not just the
counts):

```bash
docker compose -f docker-compose.yml -f docker-compose.drill.yml exec drill-db \
  psql -U precisase -d precisase -c \
  "SELECT id, email, role, created_at FROM users WHERE email = '<known-fixture-email>';"
```

Expected: exactly one row, with the role and `created_at` you expect.

## 7. Tear down

```bash
cd /opt/precisase

docker compose \
  -f docker-compose.yml \
  -f docker-compose.drill.yml \
  down -v
```

The `-v` is critical — it destroys the `drill_data` volume so the next
drill starts clean. Without `-v`, the volume sticks around and the
next `pg_restore --clean --if-exists` is comparing against stale data.

## 8. Sign-off

Record each run in the table below. **Do not sign off if any step
failed** — a failed drill is the most important signal this procedure
produces. Instead, file an issue and treat the prod backup as
suspect until the next green drill.

| Date | Operator | Backup file | Row counts (users / posts / notifications / audit_logs) | Notes |
|---|---|---|---|---|
| `<YYYY-MM-DD>` | `<operator-name>` | `<path-to-backup.dump>` | `<e.g. 142 / 89 / 311 / 907>` | Replace with real values on each drill. |

## 9. Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `pg_restore: error: could not execute query: ERROR: type "citext" does not exist` | Extensions not created (§4 was skipped). | Run §4, then re-run §5. |
| `pg_restore: error: could not read from input file: end of file` | Backup file truncated / corrupt. | Treat the prod backup as corrupt — drill FAILED. Re-pull from NAS, re-test; if still corrupt, the nightly backup is broken. Page the operator on call. |
| `pg_restore: [archiver] incompatible version` | Backup from a newer pg_dump than the drill container. | Align versions: pin `drill-db` to the same major version as the source `db` (currently `postgres:16-alpine`). |
| Smoke count returns `0` for all tables | Restore landed in the wrong database, or extensions failed silently. | `psql -l` to list databases; confirm restore targeted `precisase` (the value of `$POSTGRES_DB`). |
| `psql: FATAL: password authentication failed` | `.env` mismatch (drill-db uses `${POSTGRES_PASSWORD}` from the host `.env`, same as prod). | Run `docker compose -f docker-compose.yml -f docker-compose.drill.yml config` and verify `POSTGRES_PASSWORD` is interpolated. |
| `docker compose down -v` left the volume behind | The volume was bound to a different compose project name. | Run `docker volume ls | grep drill_data` and `docker volume rm <project>_drill_data` manually. |

## See also

- `docs/ARCHITECTURE.md` §8.3 — backup schedule and NAS replication.
- `docs/ops/deploy.md` — the deploy procedure (referenced because the
  drill assumes a working prod database to back up).
- `docker-compose.drill.yml` — the overlay file itself.
