import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { AppHeader } from "./app-header";

/**
 * Component test for the header's chat unread + moderation pending badges
 * (chat plan Task 11, decision D2). Everything the async Server Component
 * touches at request time is mocked: `auth()` (session), the
 * `service-instances` singletons (branding / conversation / post services),
 * `next/headers` (MFA warn header), `next-intl/server` (`getTranslations` —
 * backed by the REAL message catalogs so a missing i18n key fails the test,
 * matching the parity-by-grep convention), and the sibling layout modules.
 *
 * The mock `t()` does not evaluate ICU plural syntax — only plain
 * `{value}` interpolation — which is fine here: assertions target the
 * numeric badge pill and link labels, never pluralized copy.
 */

// `vi.hoisted` + an explicit signature: next-auth v5's `auth` is
// overloaded (it doubles as a middleware wrapper), so inferring the mock's
// type from the real module would bind it to the NextMiddleware overload.
const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/server/service-instances", () => ({
  brandingService: {
    getConfig: vi.fn(async () => ({
      siteName: "Precisa-se",
      logoUrl: null,
      primaryColor: "#2F6B4F",
    })),
  },
  conversationService: { countUnread: vi.fn(async () => 0) },
  postService: { listPendingPosts: vi.fn(async () => []) },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const catalogs: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
      en: () => import("../../../messages/en.json"),
      "pt-PT": () => import("../../../messages/pt-PT.json"),
      "pt-BR": () => import("../../../messages/pt-BR.json"),
    };
    const load = catalogs[locale] ?? catalogs.en;
    const catalog = (await load()).default as unknown;
    const scope = namespace
      .split(".")
      .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], catalog);
    return (key: string, values?: Record<string, number | string>) => {
      let text = (scope as Record<string, string>)?.[key] ?? `${namespace}.${key}`;
      if (values) {
        for (const [name, value] of Object.entries(values)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    };
  }),
}));

// Link/from the i18n navigation wrappers — plain anchors keep the test
// focused on badge behavior; useRouter/usePathname cover LanguageSwitcher
// imports (mocked away below).
vi.mock("@/i18n/navigation", async () => {
  const react = await import("react");
  return {
    Link: (props: React.ComponentProps<"a">) => react.createElement("a", props),
    redirect: vi.fn(),
    useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/",
  };
});

vi.mock("./language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("./sign-out-action", () => ({ signOutAction: vi.fn() }));
vi.mock("./mobile-nav", () => ({ MobileNav: () => null }));

import { conversationService, postService } from "@/server/service-instances";

function mockSession(user: Session["user"] | null): void {
  authMock.mockResolvedValue(user === null ? null : { user, expires: "2026-12-31" });
}

async function renderHeader(locale: "en" | "pt-PT" = "en") {
  const ui = await AppHeader({ locale });
  return render(ui);
}

describe("AppHeader chat + moderation badges (chat plan Task 11, D2)", () => {
  beforeEach(() => {
    authMock.mockReset();
    vi.mocked(conversationService.countUnread).mockClear();
    vi.mocked(conversationService.countUnread).mockResolvedValue(0);
    vi.mocked(postService.listPendingPosts).mockClear();
    vi.mocked(postService.listPendingPosts).mockResolvedValue([]);
  });

  it("shows no Messages link for anonymous visitors", async () => {
    mockSession(null);
    await renderHeader();

    expect(screen.queryByRole("link", { name: "Messages" })).toBeNull();
  });

  it("renders a Messages link with the unread-count badge for signed-in users", async () => {
    mockSession({ id: "user-1", name: "Ana", role: "user" });
    vi.mocked(conversationService.countUnread).mockResolvedValue(3);

    await renderHeader();

    const messagesLink = screen.getByRole("link", { name: /Messages/ });
    expect(messagesLink).toHaveAttribute("href", "/messages");
    expect(messagesLink).toHaveTextContent("3");
    expect(conversationService.countUnread).toHaveBeenCalledWith("user-1");
  });

  it("renders the Messages link without a badge when nothing is unread", async () => {
    mockSession({ id: "user-1", name: "Ana", role: "user" });

    await renderHeader();

    const messagesLink = screen.getByRole("link", { name: /Messages/ });
    expect(messagesLink).toHaveTextContent("Messages");
    // No numeric pill rendered alongside the label.
    expect(messagesLink.textContent?.match(/\d+/)).toBeNull();
  });

  it("renders the moderation pending-count badge for moderators only", async () => {
    mockSession({ id: "mod-1", name: "Mod", role: "moderator" });
    vi.mocked(postService.listPendingPosts).mockResolvedValue([
      { id: "post-1" },
      { id: "post-2" },
    ] as Awaited<ReturnType<typeof postService.listPendingPosts>>);

    await renderHeader("pt-PT");

    const moderationLink = screen.getByRole("link", { name: /Moderação/ });
    expect(moderationLink).toHaveTextContent("2");
    expect(postService.listPendingPosts).toHaveBeenCalledTimes(1);
  });

  it("renders no moderation badge for regular users", async () => {
    mockSession({ id: "user-1", name: "Ana", role: "user" });

    await renderHeader();

    expect(screen.queryByRole("link", { name: /Moderação|Moderation/ })).toBeNull();
    expect(postService.listPendingPosts).not.toHaveBeenCalled();
  });
});
