"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { brandingService } from "@/server/service-instances";
import type { SiteConfig } from "@/server/services/branding-service";

export async function updateBrandingAction(
  config: Partial<SiteConfig>
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, error: "forbidden" };
  }

  // Validate hex colors if provided
  if (config.primaryColor && !/^#[0-9A-F]{6}$/i.test(config.primaryColor)) {
    return { ok: false, error: "errorInvalidColor" };
  }
  if (config.accentColor && !/^#[0-9A-F]{6}$/i.test(config.accentColor)) {
    return { ok: false, error: "errorInvalidColor" };
  }

  await brandingService.updateConfig(config);
  revalidatePath("/", "layout"); // Invalidate all pages
  return { ok: true };
}
