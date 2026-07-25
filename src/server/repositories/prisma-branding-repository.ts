/**
 * Prisma-backed implementation of BrandingRepository.
 * Reads from the `SiteConfig` table (key-value store) using the key
 * "branding". Falls back to hardcoded defaults (matching globals.css)
 * if the row doesn't exist yet.
 */

import { PrismaClient } from "@/generated/prisma/client";
import type { SiteConfig, BrandingRepository } from "@/server/services/branding-service";

// Defaults match the existing globals.css variables
const DEFAULT_PRIMARY = "#2f6b4f";
const DEFAULT_ACCENT = "#c4622d";
const DEFAULT_SITE_NAME = "Precisa-se";
const BRANDING_KEY = "branding";

export class PrismaBrandingRepository implements BrandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getConfig(): Promise<SiteConfig> {
    const row = await this.prisma.siteConfig.findUnique({
      where: { key: BRANDING_KEY },
      select: {
        value: true,
      },
    });

    if (!row) {
      return {
        primaryColor: DEFAULT_PRIMARY,
        accentColor: DEFAULT_ACCENT,
        logoUrl: null,
        faviconUrl: null,
        siteName: DEFAULT_SITE_NAME,
      };
    }

    // The JSON value is expected to be an object with branding fields.
    // If the shape is unexpected, fall back to defaults rather than throwing.
    const json = row.value as Record<string, unknown> | null;
    return {
      primaryColor: typeof json?.primaryColor === "string" ? json.primaryColor : DEFAULT_PRIMARY,
      accentColor: typeof json?.accentColor === "string" ? json.accentColor : DEFAULT_ACCENT,
      logoUrl: typeof json?.logoUrl === "string" ? json.logoUrl : null,
      faviconUrl: typeof json?.faviconUrl === "string" ? json.faviconUrl : null,
      siteName: typeof json?.siteName === "string" ? json.siteName : DEFAULT_SITE_NAME,
    };
  }

  async updateConfig(config: Partial<SiteConfig>): Promise<void> {
    // Fetch current config to merge with updates
    const current = await this.getConfig();

    // Merge partial config with current values
    const updated = {
      ...current,
      ...config,
    };

    // Upsert the branding configuration
    await this.prisma.siteConfig.upsert({
      where: { key: BRANDING_KEY },
      update: {
        value: updated,
      },
      create: {
        key: BRANDING_KEY,
        value: updated,
      },
    });
  }
}
