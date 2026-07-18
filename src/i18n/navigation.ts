import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

// Lightweight wrappers around Next.js' navigation APIs that are aware of
// the locale-prefixed routing config above.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
