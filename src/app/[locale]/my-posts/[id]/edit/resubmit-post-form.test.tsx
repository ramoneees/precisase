import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ptPT from "../../../../../../messages/pt-PT.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ResubmitPostForm } from "./resubmit-post-form";
import { resubmitPostAction } from "./actions";

/**
 * The `resubmitPostAction` Server Action does real Prisma work via
 * `PostService`, so it's mocked here — this is a component test for the
 * form's own pre-fill and submit-disabled logic, not a live-DB test. Same
 * pattern as `posts/new/create-post-form.test.tsx`.
 */
vi.mock("./actions", () => ({
  resubmitPostAction: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: pushMock }),
}));

const categories = [
  { id: "cat-1", slug: "volunteering", key: "category.volunteering" },
  { id: "cat-2", slug: "donation", key: "category.donation" },
];

const initial = {
  type: "request" as const,
  categoryId: "cat-1",
  title: "Preciso de ajuda a mudar um sofá",
  description: "Descrição original do pedido.",
  contactMethod: "whatsapp" as const,
  contactValue: "912 345 678",
};

function renderForm(rejectedReason: string | null = "Falta informação de contacto.") {
  return render(
    <NextIntlClientProvider locale="pt-PT" messages={ptPT}>
      <ToastProvider>
        <ResubmitPostForm
          categories={categories}
          postId="post-1"
          rejectedReason={rejectedReason}
          initial={initial}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ResubmitPostForm", () => {
  beforeEach(() => {
    vi.mocked(resubmitPostAction).mockReset();
    pushMock.mockReset();
  });

  it("pre-fills the fields with the post's current values", () => {
    renderForm();

    expect(screen.getByLabelText(ptPT.myPosts.edit.titleLabel)).toHaveValue(initial.title);
    expect(screen.getByLabelText(ptPT.myPosts.edit.descriptionLabel)).toHaveValue(
      initial.description,
    );
    expect(screen.getByLabelText(ptPT.myPosts.edit.contactValueLabel)).toHaveValue(
      initial.contactValue,
    );
  });

  it("shows the rejection reason when present", () => {
    renderForm("Falta informação de contacto.");
    expect(screen.getByText("Falta informação de contacto.")).toBeInTheDocument();
  });

  it("keeps the submit button enabled when pre-filled with valid data, and disables it if title/description are cleared", async () => {
    const user = userEvent.setup();
    renderForm();

    const submitButton = screen.getByRole("button", {
      name: ptPT.myPosts.edit.submit,
    });
    expect(submitButton).toBeEnabled();

    await user.clear(screen.getByLabelText(ptPT.myPosts.edit.titleLabel));
    expect(submitButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(ptPT.myPosts.edit.titleLabel),
      "Novo título",
    );
    expect(submitButton).toBeEnabled();

    await user.clear(screen.getByLabelText(ptPT.myPosts.edit.descriptionLabel));
    expect(submitButton).toBeDisabled();
  });

  it("calls the server action with the edited values on submit", async () => {
    vi.mocked(resubmitPostAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderForm();

    const titleInput = screen.getByLabelText(ptPT.myPosts.edit.titleLabel);
    await user.clear(titleInput);
    await user.type(titleInput, "Título corrigido");

    await user.click(screen.getByRole("button", { name: ptPT.myPosts.edit.submit }));

    await vi.waitFor(() => expect(resubmitPostAction).toHaveBeenCalledTimes(1));
    expect(resubmitPostAction).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "post-1",
        title: "Título corrigido",
        description: initial.description,
        contactValue: initial.contactValue,
      }),
    );
  });

  it("does not call the server action when submission is blocked", () => {
    renderForm();
    expect(resubmitPostAction).not.toHaveBeenCalled();
  });
});
