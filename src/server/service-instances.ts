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
import { PasswordResetService } from "@/server/services/password-reset-service";
import { PrismaPasswordResetRepository } from "@/server/repositories/prisma-password-reset-repository";
import { MfaService } from "@/server/services/mfa-service";
import { PrismaMfaRepository } from "@/server/repositories/prisma-mfa-repository";
import { FeatureFlagService } from "@/server/services/feature-flag-service";
import { PrismaFeatureFlagRepository } from "@/server/repositories/prisma-feature-flag-repository";
import { BrandingService } from "@/server/services/branding-service";
import { PrismaBrandingRepository } from "@/server/repositories/prisma-branding-repository";
import { prisma } from "@/server/repositories/prisma-client";

export const postService = new PostService(new PrismaPostRepository());
export const interestService = new InterestService(new PrismaInterestRepository());

const passwordService = new PasswordService();
export const accountDeletionService = new AccountDeletionService(
  new PrismaAccountDeletionRepository(),
  passwordService,
  passwordService,
);

export const passwordResetService = new PasswordResetService(
  new PrismaPasswordResetRepository(),
  passwordService,
);

export const mfaService = new MfaService(new PrismaMfaRepository(), passwordService);

const featureFlagRepo = new PrismaFeatureFlagRepository();
export const featureFlagService = new FeatureFlagService(featureFlagRepo);

export const brandingService = new BrandingService(new PrismaBrandingRepository(prisma));
