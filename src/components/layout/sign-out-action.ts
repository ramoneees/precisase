"use server";

import { signOut } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

/** Bound with the current locale in `AppHeader`'s sign-out form. */
export async function signOutAction(locale: AppLocale) {
  await signOut({ redirect: false });
  redirect({ href: "/", locale });
}
