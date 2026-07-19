import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { LanguageSwitcher } from "./language-switcher";
import { signOutAction } from "./sign-out-action";

/**
 * Shared sticky header, used from the root `[locale]/layout.tsx` so every
 * route (listing, detail, create-post, my-posts, moderation, signin,
 * signup) gets the same nav. Server Component — it reads the session
 * directly via `auth()` (docs/ARCHITECTURE.md §4.4) rather than passing
 * session data down as props, so it re-checks on every request.
 *
 * RBAC note (§7.2, defense-in-depth): hiding the "Moderação" link here is
 * the UI half of the check — `moderation/page.tsx` re-verifies
 * `session.user.role` server-side regardless of whether this link was
 * rendered, since a hidden link is not an access control.
 */
export async function AppHeader({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const session = await auth();
  const role = session?.user?.role;
  const isModerator = role === "moderator" || role === "admin";
  const displayName = session?.user?.name ?? null;

  return (
    <header className="sticky top-0 z-40 border-b border-[#E3DED2] bg-white">
      <nav className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#2F6B4F] font-heading text-sm font-extrabold text-white">
            P
          </span>
          <span className="font-heading text-lg font-extrabold text-[#232922]">
            {t("brand")}
          </span>
        </Link>

        <div className="hidden items-center gap-6 text-sm font-medium text-[#232922] sm:flex">
          <Link href="/" className="hover:text-[#2F6B4F]">
            {t("home")}
          </Link>
          <Link href="/posts/new" className="hover:text-[#2F6B4F]">
            {t("publish")}
          </Link>
          <Link href="/my-posts" className="hover:text-[#2F6B4F]">
            {t("myPosts")}
          </Link>
          {isModerator ? (
            <Link href="/moderation" className="hover:text-[#2F6B4F]">
              {t("moderation")}
            </Link>
          ) : null}
        </div>

        <LanguageSwitcher />

        {session?.user ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/profile"
              aria-label={t("myAccount")}
              title={displayName ?? t("myAccount")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E6F0EA] text-sm font-semibold text-[#2F6B4F] hover:opacity-80"
            >
              {getInitials(displayName)}
            </Link>
            <form action={signOutAction.bind(null, locale)}>
              <button
                type="submit"
                className="shrink-0 rounded-full border border-[#E3DED2] px-3 py-1.5 text-sm font-medium text-[#232922] hover:bg-[#F5F2EA]"
              >
                {t("signOut")}
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/signin"
            className="shrink-0 rounded-full bg-[#2F6B4F] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t("signIn")}
          </Link>
        )}
      </nav>
    </header>
  );
}

function getInitials(name: string | null): string {
  if (!name) {
    return "?";
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}
