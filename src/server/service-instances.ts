/**
 * Shared, ready-to-use service instances wired to their Prisma-backed
 * repositories. `PostService`/`InterestService` are deliberately
 * repository-agnostic (see their unit tests, which use in-memory fakes) —
 * this is the one place that wires them to the real Prisma implementations
 * for use from Server Components / Server Actions / Route Handlers.
 *
 * Other views built on top of this shared layout (create-post form,
 * "my posts", moderation queue) should import `postService` /
 * `interestService` from here rather than re-instantiating their own
 * `PrismaPostRepository`/`PrismaInterestRepository`.
 */

import { PostService } from "@/server/services/post-service";
import { PrismaPostRepository } from "@/server/repositories/prisma-post-repository";
import { InterestService } from "@/server/services/interest-service";
import { PrismaInterestRepository } from "@/server/repositories/prisma-interest-repository";
import { AccountDeletionService } from "@/server/services/account-deletion-service";
import { PrismaAccountDeletionRepository } from "@/server/repositories/prisma-account-deletion-repository";
import { PasswordService } from "@/server/services/password-service";

export const postService = new PostService(new PrismaPostRepository());
export const interestService = new InterestService(new PrismaInterestRepository());

const passwordService = new PasswordService();
export const accountDeletionService = new AccountDeletionService(
  new PrismaAccountDeletionRepository(),
  passwordService,
  passwordService,
);
