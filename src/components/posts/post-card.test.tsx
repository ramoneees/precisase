import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import ptPT from "../../../messages/pt-PT.json";
import en from "../../../messages/en.json";
import { PostCard, type PostCardData } from "./post-card";
import { EmptyState } from "./empty-state";

// `@/i18n/navigation`'s `Link` wraps Next.js App Router APIs that aren't
// available outside of a running Next.js server — stubbed the same way
// `signup-form.test.tsx` stubs it, so these components can render in jsdom.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

function makeCard(overrides: Partial<PostCardData> = {}): PostCardData {
  return {
    id: "post-1",
    type: "request",
    categoryKey: "category.volunteering",
    title: "Preciso de ajuda a mudar um sofá",
    description:
      "Preciso de duas ou três pessoas disponíveis no sábado de manhã para ajudar a transportar um sofá.",
    authorName: "Ana Silva",
    createdAt: new Date("2026-06-01T10:00:00Z"),
    photoUrl: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    ...overrides,
  };
}

function renderCard(card: PostCardData, locale: "pt-PT" | "en" = "pt-PT") {
  const messages = locale === "pt-PT" ? ptPT : en;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="UTC"
    >
      <PostCard post={card} />
    </NextIntlClientProvider>,
  );
}

describe("PostCard", () => {
  it("renders the title, description, author, and badges for a request", () => {
    renderCard(makeCard({ type: "request" }));

    expect(
      screen.getByRole("heading", { name: "Preciso de ajuda a mudar um sofá" }),
    ).toBeInTheDocument();
    expect(screen.getByText(ptPT.post.type.request)).toBeInTheDocument();
    expect(screen.getByText(ptPT.category.volunteering)).toBeInTheDocument();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
  });

  it("renders the offer type badge for an offer post", () => {
    renderCard(
      makeCard({
        type: "offer",
        categoryKey: "category.donation",
        title: "Ofereço um colchão em bom estado",
      }),
    );

    expect(screen.getByText(ptPT.post.type.offer)).toBeInTheDocument();
    expect(screen.getByText(ptPT.category.donation)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ofereço um colchão em bom estado" }),
    ).toBeInTheDocument();
  });

  it("truncates a long description to ~110 characters", () => {
    const longDescription = "A".repeat(200);
    renderCard(makeCard({ description: longDescription }));

    const shown = screen.getByText(/^A+…$/);
    // 110 chars of "A" plus the ellipsis character.
    expect(shown.textContent).toHaveLength(111);
  });

  it("links to the post detail route", () => {
    renderCard(makeCard({ id: "post-42" }));

    expect(screen.getByRole("link")).toHaveAttribute("href", "/posts/post-42");
  });

  it("switches all copy when rendered under the en catalog, proving no hardcoded strings", () => {
    renderCard(makeCard({ type: "offer", categoryKey: "category.donation" }), "en");

    expect(screen.getByText(en.post.type.offer)).toBeInTheDocument();
    expect(screen.getByText(en.category.donation)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the translated empty-state title and description", () => {
    render(
      <NextIntlClientProvider locale="pt-PT" messages={ptPT} timeZone="UTC">
        <EmptyState />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(ptPT.listing.empty.title)).toBeInTheDocument();
    expect(screen.getByText(ptPT.listing.empty.description)).toBeInTheDocument();
  });

  it("switches strings when rendered under the en catalog", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <EmptyState />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(en.listing.empty.title)).toBeInTheDocument();
    expect(screen.getByText(en.listing.empty.description)).toBeInTheDocument();
  });
});
