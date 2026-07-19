import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import ptPT from "../../../../../../messages/pt-PT.json";
import en from "../../../../../../messages/en.json";
import { ToastProvider } from "@/components/ui/toast-provider";
import { EditPostForm, type EditPostFormMode } from "./edit-post-form";
import { editActivePostAction } from "./edit-active-post-action";
import { resubmitPostAction } from "./actions";

vi.mock("./edit-active-post-action", () => ({
  editActivePostAction: vi.fn(),
}));
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

function makeInitial(overrides: Partial<Parameters<typeof EditPostForm>[0]["initial"]> = {}) {
  return {
    type: "request" as const,
    categoryId: "cat-1",
    title: "Preciso de voluntários",
    description: "Descrição original do pedido.",
    contactMethod: "email" as const,
    contactValue: "ana@example.com",
    ...overrides,
  };
}

function renderForm(mode: EditPostFormMode, locale: "pt-PT" | "en" = "pt-PT", rejectedReason: string | null = null) {
  const messages = locale === "pt-PT" ? ptPT : en;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <ToastProvider>
        <EditPostForm
          categories={categories}
          postId="post-1"
          mode={mode}
          rejectedReason={rejectedReason}
          initial={makeInitial()}
          phoneCountry="PT"
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EditPostForm", () => {
  beforeEach(() => {
    vi.mocked(editActivePostAction).mockReset();
    vi.mocked(resubmitPostAction).mockReset();
  });

  describe("mode = active", () => {
    it("calls editActivePostAction on submit (FR03, edit active post)", async () => {
      vi.mocked(editActivePostAction).mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      renderForm("active");

      await user.clear(screen.getByLabelText("Título"));
      await user.type(screen.getByLabelText("Título"), "Título atualizado");
      await user.click(screen.getByRole("button", { name: "Guardar alterações" }));

      await vi.waitFor(() => expect(editActivePostAction).toHaveBeenCalledTimes(1));
      expect(editActivePostAction).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: "post-1",
          title: "Título atualizado",
          contactValue: "ana@example.com",
          phoneCountry: "PT",
        }),
      );
      expect(resubmitPostAction).not.toHaveBeenCalled();
    });

    it("sends the user-selected phoneCountry when editing a phone post (active mode)", async () => {
      vi.mocked(editActivePostAction).mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      render(
        <NextIntlClientProvider locale="pt-PT" messages={ptPT} timeZone="UTC">
          <ToastProvider>
            <EditPostForm
              categories={categories}
              postId="post-1"
              mode="active"
              rejectedReason={null}
              initial={makeInitial({ contactMethod: "phone", contactValue: "912 345 678" })}
              phoneCountry="PT"
            />
          </ToastProvider>
        </NextIntlClientProvider>,
      );

      await user.selectOptions(screen.getByLabelText("País"), "BR");
      await user.click(screen.getByRole("button", { name: "Guardar alterações" }));

      await vi.waitFor(() => expect(editActivePostAction).toHaveBeenCalledTimes(1));
      expect(editActivePostAction).toHaveBeenCalledWith(
        expect.objectContaining({ phoneCountry: "BR" }),
      );
    });

    it("labels the phone-country dropdown with the country key, not the contact-method label", () => {
      render(
        <NextIntlClientProvider locale="pt-PT" messages={ptPT} timeZone="UTC">
          <ToastProvider>
            <EditPostForm
              categories={categories}
              postId="post-1"
              mode="active"
              rejectedReason={null}
              initial={makeInitial({ contactMethod: "phone", contactValue: "912 345 678" })}
              phoneCountry="PT"
            />
          </ToastProvider>
        </NextIntlClientProvider>,
      );

      expect(screen.getByLabelText("País")).toBeInTheDocument();
      expect(screen.getByLabelText("Contacto preferido")).toBeInTheDocument();
    });

    it("does not show the type/category segmented toggles (active edits don't change type/category)", () => {
      renderForm("active");
      expect(screen.queryByRole("group", { name: "Tipo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Categoria" })).not.toBeInTheDocument();
    });
  });

  describe("mode = rejected", () => {
    it("calls resubmitPostAction on submit (FR03, resubmit rejected post)", async () => {
      vi.mocked(resubmitPostAction).mockResolvedValue({ ok: true });
      const user = userEvent.setup();
      renderForm("rejected", "pt-PT", "Falta informação de contacto.");

      await user.click(screen.getByRole("button", { name: "Reenviar para aprovação" }));

      await vi.waitFor(() => expect(resubmitPostAction).toHaveBeenCalledTimes(1));
      expect(resubmitPostAction).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: "post-1",
          title: "Preciso de voluntários",
          categoryId: "cat-1",
        }),
      );
      expect(editActivePostAction).not.toHaveBeenCalled();
    });

    it("shows the rejection-reason banner when one is provided", () => {
      renderForm("rejected", "pt-PT", "Falta informação de contacto.");

      expect(screen.getByText("Falta informação de contacto.")).toBeInTheDocument();
      expect(screen.getByText("Motivo da rejeição:")).toBeInTheDocument();
    });
  });
});