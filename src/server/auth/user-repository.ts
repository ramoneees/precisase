/**
 * Prisma-backed implementation of the `AuthUserRepository` port
 * (src/server/services/auth-service.ts) plus the signup write path
 * (User + ConsentRecord creation, docs/ARCHITECTURE.md §7.5, BR06).
 *
 * Read-only usage of the `User` model for login; the only write path here
 * is signup, which does not touch Post/Interest/Category — the tables
 * owned by the parallel Prisma-repositories workstream.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/repositories/prisma-client";
import type { AuthRole, AuthUserRecord, AuthUserRepository } from "@/server/services/auth-service";

/** Current terms/privacy policy version recorded on ConsentRecord (§7.5). */
export const CONSENT_VERSION = "v1";

export class PrismaAuthUserRepository implements AuthUserRepository {
  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        displayName: true,
        role: true,
        country: true,
        timeZone: true,
        currency: true,
        deletedAt: true,
      },
    });
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      displayName: user.displayName,
      role: user.role as AuthRole,
      country: user.country,
      timeZone: user.timeZone,
      currency: user.currency,
      deletedAt: user.deletedAt,
    };
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`An account with email "${email}" already exists.`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export interface CreateUserWithConsentInput {
  email: string;
  passwordHash: string;
  displayName: string;
  uiLocale: string;
  /** ISO 3166-1 alpha-2 country code (PT, BR, US, …). Optional — derived from signup locale if absent. */
  country?: string | null;
  /** IANA time zone (Europe/Lisbon, …). Optional — derived from country if absent. */
  timeZone?: string | null;
  /** ISO 4217 currency code (EUR, BRL, …). Optional — derived from country if absent. */
  currency?: string | null;
}

export interface CreatedUser {
  id: string;
  email: string;
  displayName: string;
  role: AuthRole;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Creates a `User` row plus `terms` and `privacy` `ConsentRecord` rows
 * (§7.5, BR06 — sign-up requires accepting current terms/privacy scopes).
 * Both writes happen in a single transaction so a partially-consented user
 * can never exist.
 */
export async function createUserWithConsent(
  input: CreateUserWithConsentInput,
): Promise<CreatedUser> {
  const grantedAt = new Date();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          uiLocale: input.uiLocale,
          country: input.country ?? null,
          timeZone: input.timeZone ?? null,
          currency: input.currency ?? null,
          consentAt: grantedAt,
        },
      });

      await tx.consentRecord.createMany({
        data: [
          {
            userId: created.id,
            scope: "terms",
            version: CONSENT_VERSION,
            grantedAt,
          },
          {
            userId: created.id,
            scope: "privacy",
            version: CONSENT_VERSION,
            grantedAt,
          },
        ],
      });

      return created;
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as AuthRole,
    };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new EmailAlreadyRegisteredError(input.email);
    }
    throw error;
  }
}
