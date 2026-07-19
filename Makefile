# Precisa-se — operator convenience targets.
#
# Wraps the deploy/backup/restore flows documented under `docs/ops/` so a
# tired on-call doesn't have to remember exact docker compose `-f` overlays
# or `gh workflow run` flags. Run `make help` for the target list.
#
# References:
#   - docs/ops/deploy.md            (deploy-staging, deploy-prod)
#   - docs/ops/backup-restore-drill.md (drill-restore)
#   - docs/ops/backup.md            (backup-now)
#   - .github/workflows/deploy.yml  (the workflow these targets invoke)

.PHONY: help drill-restore deploy-staging deploy-prod backup-now

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

drill-restore: ## Spin up drill-db, restore latest prod backup, run smoke-test queries, tear down
	@echo "[drill] Restoring latest prod backup into an isolated drill-db."
	@echo "[drill] Full runbook: docs/ops/backup-restore-drill.md"
	@set -euo pipefail; \
		docker compose -f docker-compose.yml -f docker-compose.drill.yml up -d drill-db; \
		trap 'docker compose -f docker-compose.yml -f docker-compose.drill.yml down -v' EXIT; \
		LATEST_BACKUP=$$(ls -t backups/daily/*.sql.gz | head -1); \
		echo "[drill] Restoring $$LATEST_BACKUP..."; \
		gunzip -c "$$LATEST_BACKUP" \
			| docker compose -f docker-compose.yml -f docker-compose.drill.yml exec -T drill-db psql -U "$${POSTGRES_USER:-precisase}" -d "$${POSTGRES_DB:-precisase}"; \
		echo "[drill] Smoke-test row counts..."; \
		docker compose -f docker-compose.yml -f docker-compose.drill.yml exec -T drill-db psql -U "$${POSTGRES_USER:-precisase}" -d "$${POSTGRES_DB:-precisase}" \
			-c "SELECT count(*) AS users FROM \"User\";" \
			-c "SELECT count(*) AS posts FROM \"Post\";" \
			-c "SELECT count(*) AS notifications FROM \"Notification\";"; \
		echo "[drill] OK — restore drill passed."

deploy-staging: ## Trigger the staging deploy workflow via gh
	@set -euo pipefail; \
		gh workflow run deploy.yml -r main; \
		echo "[deploy] Triggered. Run URL:"; \
		sleep 2; \
		gh run list --workflow=deploy.yml --limit=1 --json url --jq '.[0].url'

deploy-prod: ## Trigger the prod deploy workflow (requires approval in GitHub)
	@set -euo pipefail; \
		SHA=$$(git rev-parse HEAD); \
		echo "[deploy] Triggering prod deploy for $$SHA"; \
		gh workflow run deploy.yml -f sha="$$SHA"; \
		echo "[deploy] Approval required — open this URL to review and approve:"; \
		sleep 2; \
		gh run list --workflow=deploy.yml --limit=1 --json url --jq '.[0].url'

backup-now: ## Run a one-shot backup via the backup container
	@set -euo pipefail; \
		echo "[backup] Running one-shot pg_dump via the `backup` service..."; \
		docker compose run --rm backup /usr/local/bin/backup.sh
