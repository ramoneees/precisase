"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { featureFlagService } from "@/server/service-instances";

export async function toggleCategoryAction(
  slug: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "moderator")) {
    return { ok: false, error: "forbidden" };
  }

  const result = await featureFlagService.toggleCategory(slug, isActive);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/posts/new");
    revalidatePath("/admin/settings");
  }
  return result;
}
