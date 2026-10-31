# t_dd94bdf6 — PR #10 typecheck red: deletedAt in chat-integration factories

Branch: feat/qa-g25-remove-guard (same branch, no new PR). Commit: 726fa4d.
Change: +2 lines in src/server/services/chat-integration.test.ts — `deletedAt: null,` added to InMemoryPostRepository.create and makeActivePost. Grep of PostRecord in *.test.ts: post-service.test.ts factories already had deletedAt.

## Verification
- pnpm exec tsc --noEmit → exit 0
- pnpm lint → 0 errors (8 pre-existing warnings, unrelated)
- pnpm test → 31 files / 287 tests passed
- pnpm build → exit 0
- CI run 40948935740 → SUCCESS (2m24s) https://github.com/ramoneees/precisase/actions/runs/40948935740
