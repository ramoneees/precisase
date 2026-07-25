/**
 * BrandingService — exposes the site-wide branding configuration (colors,
 * copy, logo) for use in Server Components and Server Actions.
 *
 * This is intentionally narrow: the layout only needs `primaryColor` and
 * `accentColor` to inject CSS custom-property overrides. Other branding
 * fields (logoUrl, siteName) are added as features require them.
 */

export interface BrandingConfig {
  primaryColor: string;
  accentColor: string;
  /** URL to the site logo image, or null if not configured */
  logoUrl: string | null;
  /** Site name for display, defaults to "Precisa-se" */
  siteName: string;
}

/** Site-wide configuration including branding and favicon */
export interface SiteConfig extends BrandingConfig {
  /** URL to the favicon image, or null if not configured */
  faviconUrl: string | null;
}

export interface BrandingRepository {
  getConfig(): Promise<SiteConfig>;
  updateConfig(config: Partial<SiteConfig>): Promise<void>;
}

export class BrandingService {
  constructor(private readonly repo: BrandingRepository) {}

  async getConfig(): Promise<SiteConfig> {
    return this.repo.getConfig();
  }

  async updateConfig(config: Partial<SiteConfig>): Promise<void> {
    await this.repo.updateConfig(config);
  }
}
